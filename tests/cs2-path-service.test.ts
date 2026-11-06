import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import {
  Cs2PathService,
  createCs2InProcessTransport,
  type Cs2PathTransport,
} from "../src/simulation/cs2-path-service";
import {
  searchCs2Path,
  type Cs2SearchGraph,
  type Cs2SearchQuery,
} from "../src/simulation/cs2-path-search";
import {
  createCs2PathWorkerEngine,
  type Cs2PathWorkerRequest,
  type Cs2PathWorkerResponse,
} from "../src/simulation/cs2-path-worker";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-path-search-oracle.json", import.meta.url),
    "utf8",
  ),
) as { cases: { graph: Cs2SearchGraph; query: Cs2SearchQuery }[] };
const { graph, query } = fixture.cases[0];
afterEach(() => vi.useRealTimers());

it("runs source queries asynchronously against one installed graph with one-pop budgets", async () => {
  vi.useFakeTimers();
  const service = new Cs2PathService({
    transport: createCs2InProcessTransport(),
    budget: 1,
  });
  service.configure(graph);
  const requests = fixture.cases
    .slice(0, 6)
    .map((row) => service.submit(row.query));
  expect(service.pendingCount).toBe(6);
  await vi.runAllTimersAsync();
  expect(await Promise.all(requests)).toEqual(
    fixture.cases.slice(0, 6).map((row) => searchCs2Path(row.graph, row.query)),
  );
  expect(service.pendingCount).toBe(0);
  service.dispose();
});

function recordingTransport() {
  let receiver: (message: Cs2PathWorkerResponse) => void = () => {};
  const messages: Cs2PathWorkerRequest[] = [];
  const transport: Cs2PathTransport = {
    kind: "in-process",
    postMessage(message) {
      messages.push(structuredClone(message));
    },
    setReceiver(next) {
      receiver = next;
    },
    terminate: vi.fn(),
  };
  return {
    transport,
    messages,
    receive: (message: Cs2PathWorkerResponse) => receiver(message),
  };
}

it("serializes edges once at configuration and sends only query parameters thereafter", () => {
  const recorded = recordingTransport();
  const service = new Cs2PathService({ transport: recorded.transport });
  service.configure(graph);
  void service.submit(query);
  void service.submit({ ...query, requestId: 100 });
  expect(recorded.messages.map((m) => m.type)).toEqual([
    "configure",
    "query",
    "query",
  ]);
  for (const message of recorded.messages.slice(1)) {
    expect(JSON.stringify(message)).not.toContain('"edges"');
    expect(message).not.toHaveProperty("graph");
  }
  service.dispose();
});

it("ignores late cancelled results even when the same request ID is reused", async () => {
  const recorded = recordingTransport();
  const service = new Cs2PathService({ transport: recorded.transport });
  service.configure(graph);
  const first = service.submit(query);
  const old = recorded.messages[1];
  if (old.type !== "query") throw new Error("missing query");
  service.cancel(query.requestId);
  expect((await first).status).toBe("cancelled");
  const next = service.submit(query);
  const current = recorded.messages[3];
  if (current.type !== "query") throw new Error("missing replacement query");
  const result = searchCs2Path(graph, query);
  recorded.receive({
    type: "result",
    generation: old.generation,
    token: old.token,
    result,
  });
  expect(service.pendingCount).toBe(1);
  recorded.receive({
    type: "result",
    generation: current.generation,
    token: current.token,
    result,
  });
  expect(await next).toEqual(result);
  service.dispose();
});

it("invalidates pending work on every graph configuration, including reused revision numbers", async () => {
  const recorded = recordingTransport();
  const service = new Cs2PathService({ transport: recorded.transport });
  service.configure(graph);
  const oldRequest = service.submit(query);
  const old = recorded.messages[1];
  if (old.type !== "query") throw new Error("missing query");
  service.configure(graph);
  expect((await oldRequest).status).toBe("stale");
  const next = service.submit(query);
  const current = recorded.messages[3];
  if (current.type !== "query") throw new Error("missing replacement query");
  const result = searchCs2Path(graph, query);
  recorded.receive({
    type: "result",
    generation: old.generation,
    token: old.token,
    result,
  });
  expect(service.pendingCount).toBe(1);
  recorded.receive({
    type: "result",
    generation: current.generation,
    token: current.token,
    result,
  });
  expect(await next).toEqual(result);
  service.dispose();
});

it("cancels an active worker query without corrupting a replacement with the same ID", async () => {
  vi.useFakeTimers();
  const service = new Cs2PathService({
    transport: createCs2InProcessTransport(),
    budget: 1,
  });
  service.configure(graph);
  const old = service.submit(query);
  await Promise.resolve();
  service.cancel(query.requestId);
  const next = service.submit(query);
  await vi.runAllTimersAsync();
  expect((await old).status).toBe("cancelled");
  expect(await next).toEqual(searchCs2Path(graph, query));
  service.dispose();
});

it("rejects mismatched revisions and duplicate live request IDs without queuing extra work", async () => {
  const recorded = recordingTransport();
  const service = new Cs2PathService({ transport: recorded.transport });
  expect((await service.submit(query)).status).toBe("stale");
  service.configure(graph);
  expect((await service.submit({ ...query, revision: 999 })).status).toBe(
    "stale",
  );
  void service.submit(query);
  expect(() => service.submit(query)).toThrow("Duplicate");
  expect(recorded.messages).toHaveLength(2);
  service.dispose();
});

it("turns worker failures into explicit terminal results and can recover with a new configuration", async () => {
  const recorded = recordingTransport();
  const service = new Cs2PathService({ transport: recorded.transport });
  service.configure(graph);
  const pending = service.submit(query);
  recorded.receive({
    type: "error",
    generation: 1,
    message: "invalid network",
  });
  expect(await pending).toMatchObject({
    status: "unsupported",
    reason: "invalid network",
  });
  expect((await service.submit(query)).status).toBe("unsupported");
  service.configure(graph);
  void service.submit(query);
  expect(service.pendingCount).toBe(1);
  service.dispose();
});

it("disposes pending work and suppresses further transport activity", async () => {
  const recorded = recordingTransport();
  const service = new Cs2PathService({ transport: recorded.transport });
  service.configure(graph);
  const pending = service.submit(query);
  service.dispose();
  expect((await pending).status).toBe("cancelled");
  expect((await service.submit(query)).status).toBe("cancelled");
  expect(() => service.configure(graph)).toThrow("disposed");
  expect(recorded.transport.terminate).toHaveBeenCalledOnce();
});

it("the standalone worker rejects obsolete generations and reports graph errors", () => {
  const responses: Cs2PathWorkerResponse[] = [];
  const engine = createCs2PathWorkerEngine((message) =>
    responses.push(message),
  );
  engine.handle({ type: "configure", generation: 2, graph });
  engine.handle({ type: "query", generation: 1, token: 1, query });
  expect(responses.map((r) => r.type)).toEqual(["configured"]);
  engine.handle({
    type: "configure",
    generation: 3,
    graph: { ...graph, edges: [{ ...graph.edges[0], id: 99 }] },
  });
  expect(responses.at(-1)).toMatchObject({ type: "error", generation: 3 });
  engine.terminate();
});
