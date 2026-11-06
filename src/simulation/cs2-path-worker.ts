import {
  Cs2CompiledPathGraph,
  Cs2PathSearch,
  type Cs2SearchGraph,
  type Cs2SearchQuery,
  type Cs2SearchResult,
} from "./cs2-path-search";

export type Cs2PathWorkerRequest =
  | {
      type: "configure";
      generation: number;
      graph: Cs2SearchGraph;
      budget?: number;
    }
  | { type: "query"; generation: number; token: number; query: Cs2SearchQuery }
  | { type: "cancel"; generation: number; token: number; requestId: number };
export type Cs2PathWorkerResponse =
  | { type: "configured"; generation: number; revision: number }
  | {
      type: "result";
      generation: number;
      token: number;
      result: Cs2SearchResult;
    }
  | { type: "error"; generation: number; message: string };

/** An expansion budget is browser scheduling, not a cutoff in the source A*.
 * Query state, heap, RNG and graph survive each cooperative yield.
 */
export function createCs2PathWorkerEngine(
  send: (message: Cs2PathWorkerResponse) => void,
) {
  let graph: Cs2CompiledPathGraph | undefined;
  let generation = 0;
  let budget = 512;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const jobs = new Map<number, { search: Cs2PathSearch; token: number }>();
  const queue: { id: number; token: number }[] = [];
  const reply = (
    search: Cs2PathSearch,
    token: number,
    result: Cs2SearchResult,
  ) => {
    jobs.delete(search.query.requestId);
    send({ type: "result", generation, token, result });
  };
  const schedule = () => {
    if (timer !== undefined || !queue.length || stopped) return;
    timer = setTimeout(pump, 0);
  };
  const pump = () => {
    timer = undefined;
    if (stopped) return;
    while (queue.length && jobs.get(queue[0].id)?.token !== queue[0].token)
      queue.shift();
    const job = jobs.get(queue[0]?.id);
    if (!job) return;
    const { search, token } = job;
    try {
      const result = search.step(budget);
      if (result) {
        queue.shift();
        reply(search, token, result);
      }
    } catch (error) {
      queue.shift();
      reply(search, token, {
        ...search.cancel(),
        status: "unsupported",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    schedule();
  };
  return {
    handle(message: Cs2PathWorkerRequest) {
      if (stopped) return;
      if (message.type === "configure") {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        for (const job of jobs.values())
          send({
            type: "result",
            generation,
            token: job.token,
            result: { ...job.search.cancel(), status: "stale" },
          });
        jobs.clear();
        queue.length = 0;
        generation = message.generation;
        budget = Number.isFinite(message.budget)
          ? Math.max(1, Math.trunc(message.budget!))
          : 512;
        try {
          graph = new Cs2CompiledPathGraph(message.graph);
          send({ type: "configured", generation, revision: graph.revision });
        } catch (error) {
          graph = undefined;
          send({
            type: "error",
            generation,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (message.generation !== generation) return;
      if (message.type === "cancel") {
        const job = jobs.get(message.requestId);
        if (job && job.token === message.token)
          reply(job.search, job.token, job.search.cancel());
        return;
      }
      if (!graph) {
        send({
          type: "error",
          generation,
          message: "No graph has been configured",
        });
        return;
      }
      if (jobs.has(message.query.requestId)) {
        send({ type: "error", generation, message: "Duplicate request ID" });
        return;
      }
      try {
        const search = new Cs2PathSearch(graph, message.query);
        jobs.set(message.query.requestId, { search, token: message.token });
        if (search.result) reply(search, message.token, search.result);
        else {
          queue.push({ id: message.query.requestId, token: message.token });
          schedule();
        }
      } catch (error) {
        send({
          type: "error",
          generation,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    terminate() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      jobs.clear();
      queue.length = 0;
      graph = undefined;
    },
  };
}

const workerGlobal = globalThis as unknown as {
  postMessage?: (message: Cs2PathWorkerResponse) => void;
  onmessage?: (event: MessageEvent<Cs2PathWorkerRequest>) => void;
};
if (
  typeof document === "undefined" &&
  typeof workerGlobal.postMessage === "function"
) {
  const engine = createCs2PathWorkerEngine((message) =>
    workerGlobal.postMessage!(message),
  );
  workerGlobal.onmessage = (event) => engine.handle(event.data);
}
