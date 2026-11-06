import {
  createCs2PathWorkerEngine,
  type Cs2PathWorkerRequest,
  type Cs2PathWorkerResponse,
} from "./cs2-path-worker";
import type {
  Cs2SearchGraph,
  Cs2SearchQuery,
  Cs2SearchResult,
} from "./cs2-path-search";

export type Cs2PathTransport = {
  readonly kind: "worker" | "in-process";
  postMessage(message: Cs2PathWorkerRequest): void;
  setReceiver(receiver: (message: Cs2PathWorkerResponse) => void): void;
  terminate(): void;
};

/** Same protocol and execution engine as the real Worker, with structured-clone
 * semantics. Useful for deterministic tests and hosts without Worker support.
 */
export function createCs2InProcessTransport(): Cs2PathTransport {
  let receiver: (message: Cs2PathWorkerResponse) => void = () => {};
  let stopped = false;
  const engine = createCs2PathWorkerEngine((message) => {
    const copy = structuredClone(message);
    queueMicrotask(() => {
      if (!stopped) receiver(copy);
    });
  });
  return {
    kind: "in-process",
    setReceiver(next) {
      receiver = next;
    },
    postMessage(message) {
      const copy = structuredClone(message);
      queueMicrotask(() => {
        if (!stopped) engine.handle(copy);
      });
    },
    terminate() {
      stopped = true;
      engine.terminate();
    },
  };
}

export function createCs2BrowserPathTransport(): Cs2PathTransport {
  const worker = new Worker(new URL("./cs2-path-worker.ts", import.meta.url), {
    type: "module",
  });
  let generation = 0;
  let receiver: (message: Cs2PathWorkerResponse) => void = () => {};
  worker.onmessage = (event: MessageEvent<Cs2PathWorkerResponse>) =>
    receiver(event.data);
  worker.onerror = (event) =>
    receiver({
      type: "error",
      generation,
      message: event.message || "Path worker failed",
    });
  return {
    kind: "worker",
    setReceiver(next) {
      receiver = next;
    },
    postMessage(message) {
      if (message.type === "configure") generation = message.generation;
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
  };
}

function terminal(
  query: Cs2SearchQuery,
  status: Cs2SearchResult["status"],
  reason?: string,
): Cs2SearchResult {
  return {
    requestId: query.requestId,
    revision: query.revision,
    status,
    steps: [],
    cost: -1,
    distance: -1,
    duration: -1,
    expanded: 0,
    graphTraversal: 0,
    randomState: 0,
    inverted: false,
    ...(reason ? { reason } : {}),
  };
}

/** One graph installation per configuration, small per-query messages, and
 * cancellation/generation fencing independent of browser message timing.
 */
export class Cs2PathService {
  readonly transport: Cs2PathTransport;
  private generation = 0;
  private revision: number | undefined;
  private disposed = false;
  private error: string | undefined;
  private nextToken = 0;
  private pending = new Map<
    number,
    {
      query: Cs2SearchQuery;
      generation: number;
      token: number;
      resolve: (result: Cs2SearchResult) => void;
    }
  >();
  constructor(options: { transport?: Cs2PathTransport; budget?: number } = {}) {
    this.transport =
      options.transport ??
      (typeof Worker === "undefined"
        ? createCs2InProcessTransport()
        : createCs2BrowserPathTransport());
    this.budget = options.budget ?? 512;
    this.transport.setReceiver((message) => this.receive(message));
  }
  private budget: number;
  get mode() {
    return this.transport.kind;
  }
  get pendingCount() {
    return this.pending.size;
  }
  configure(graph: Cs2SearchGraph) {
    if (this.disposed) throw new Error("Path service is disposed");
    for (const item of this.pending.values())
      item.resolve(terminal(item.query, "stale"));
    this.pending.clear();
    this.generation++;
    this.revision = graph.revision;
    this.error = undefined;
    this.transport.postMessage({
      type: "configure",
      generation: this.generation,
      graph,
      budget: this.budget,
    });
  }
  submit(query: Cs2SearchQuery): Promise<Cs2SearchResult> {
    if (this.disposed)
      return Promise.resolve(
        terminal(query, "cancelled", "Path service is disposed"),
      );
    if (query.revision !== this.revision)
      return Promise.resolve(terminal(query, "stale"));
    if (this.error)
      return Promise.resolve(terminal(query, "unsupported", this.error));
    if (this.pending.has(query.requestId))
      throw new Error("Duplicate path request ID");
    return new Promise((resolve) => {
      const token = ++this.nextToken;
      this.pending.set(query.requestId, {
        query,
        generation: this.generation,
        token,
        resolve,
      });
      this.transport.postMessage({
        type: "query",
        generation: this.generation,
        token,
        query,
      });
    });
  }
  cancel(requestId: number) {
    const item = this.pending.get(requestId);
    if (!item) return;
    this.pending.delete(requestId);
    item.resolve(terminal(item.query, "cancelled"));
    this.transport.postMessage({
      type: "cancel",
      generation: item.generation,
      token: item.token,
      requestId,
    });
  }
  private receive(message: Cs2PathWorkerResponse) {
    if (this.disposed || message.generation !== this.generation) return;
    if (message.type === "error") {
      this.error = message.message;
      for (const item of this.pending.values())
        item.resolve(terminal(item.query, "unsupported", message.message));
      this.pending.clear();
      return;
    }
    if (message.type !== "result") return;
    const item = this.pending.get(message.result.requestId);
    if (
      !item ||
      item.token !== message.token ||
      item.generation !== message.generation ||
      item.query.revision !== message.result.revision
    )
      return;
    this.pending.delete(message.result.requestId);
    item.resolve(message.result);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of this.pending.values())
      item.resolve(
        terminal(item.query, "cancelled", "Path service was disposed"),
      );
    this.pending.clear();
    this.transport.terminate();
  }
}
