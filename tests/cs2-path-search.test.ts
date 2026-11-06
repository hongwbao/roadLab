import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  Cs2CompiledPathGraph,
  Cs2PathSearch,
  Cs2SourceHeap,
  SourceRandom32,
  deriveCs2WorkerSeed,
  searchCs2Path,
  type Cs2SearchGraph,
  type Cs2SearchQuery,
  type Cs2SearchResult,
} from "../src/simulation/cs2-path-search";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-path-search-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  mvid: string;
  source: string;
  extraction: { sources: { signature: string; sha256: string }[] };
  randomCases: {
    seed: number;
    index: number;
    draws: { sample: number; integer: number; state: number }[];
  }[];
  cases: {
    id: string;
    graph: Cs2SearchGraph;
    query: Cs2SearchQuery;
    expected: Omit<Cs2SearchResult, "requestId" | "revision"> & {
      error: number;
    };
  }[];
};

it("keeps original-DLL RNG evidence distinct from the full source-extracted executor", () => {
  expect(oracle.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
  expect(oracle.source).toContain("automatically extracted wholesale");
  expect(oracle.source).toContain("directly execute original DLL");
  expect(oracle.extraction.sources).toHaveLength(7);
  expect(oracle.cases).toHaveLength(243);
});

it("matches original RandomSeed action mixing and every sequential Unity RNG draw", () => {
  for (const row of oracle.randomCases) {
    const random = new SourceRandom32(deriveCs2WorkerSeed(row.seed, row.index));
    for (const draw of row.draws) {
      expect({
        sample: random.nextFloat(0.5, 1),
        integer: random.nextUInt(),
        state: random.state,
      }).toEqual({ ...draw, sample: Math.fround(draw.sample) });
    }
  }
});

function normalize(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isInteger(value) && Math.abs(value) <= 0xffffffff
      ? value
      : Math.fround(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, v]) =>
            v !== undefined &&
            v !== null &&
            !["error", "requestId", "revision"].includes(key),
        )
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}

for (const row of oracle.cases) {
  it(`matches the source executor's complete result for ${row.id}`, () => {
    expect(normalize(searchCs2Path(row.graph, row.query))).toEqual(
      normalize(row.expected),
    );
  });
}

it("preserves heap, closed state and random draws across one-pop cooperative yields", () => {
  for (const row of oracle.cases) {
    const search = new Cs2PathSearch(
      new Cs2CompiledPathGraph(row.graph),
      row.query,
    );
    for (let guard = 0; !search.result && guard < 10000; guard++)
      search.step(1);
    expect(normalize(search.result), row.id).toEqual(normalize(row.expected));
  }
});

it("uses the source four-ary heap comparison tree for tied children", () => {
  const heap = new Cs2SourceHeap();
  [0, 1, 1, 1, 1, 1, 1].forEach((cost, node) => heap.insert({ cost, node }));
  const nodes = Array.from({ length: 7 }, () => heap.extract()!.node);
  expect(nodes).toEqual([0, 6, 5, 4, 3, 2, 1]);
});

it("rejects stale revisions and unsupported world methods before graph exploration", () => {
  const { graph, query } = oracle.cases[0];
  expect(searchCs2Path(graph, { ...query, revision: 2 }).status).toBe("stale");
  expect(
    searchCs2Path(graph, {
      ...query,
      parameters: { ...query.parameters, methods: 1 },
    }).status,
  ).toBe("unsupported");
  const search = new Cs2PathSearch(graph, query);
  expect(search.cancel().status).toBe("cancelled");
  expect(search.step()).toEqual(search.result);
});
