import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2ProcessCarConnectPositions,
  cs2CalculateNodeCarSourcesBetween,
  type CS2NodeCarConnectionsInput,
  type CS2NodeCarConnectionsResult,
  type CS2LaneCompositionFlags,
} from "../src/simulation/cs2-lane-generation";
import { SourceRandom32 } from "../src/simulation/cs2-path-search";

type Case = {
  name: string;
  input: CS2NodeCarConnectionsInput;
  world: {
    owners: { owner: string; mergeLayers: number }[];
    compositions: { id: string; flags: CS2LaneCompositionFlags }[];
  };
  replies: {
    created: boolean;
    skipped: boolean;
    curviness: number;
    deltaNodeLaneIndex: number;
    advanceRandomDraws: number;
  }[];
  output: CS2NodeCarConnectionsResult;
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-generation-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  source: {
    gameSha256: string;
    mvid: string;
    extraction: {
      methods: { signature: string; line: number; sha256: string }[];
      originalMethods: { name: string; token: number; ilSha256: string }[];
      classification: string;
    };
  };
  cases: Case[];
};
function run(c: Case) {
  let index = 0;
  return cs2ProcessCarConnectPositions(
    {
      ownerMergeLayers: new Map(
        c.world.owners.map((v) => [v.owner, v.mergeLayers]),
      ),
      compositions: new Map(c.world.compositions.map((v) => [v.id, v.flags])),
    },
    c.input,
    (_, state) => {
      const spec = c.replies[index++ % c.replies.length];
      const rng = new SourceRandom32(1);
      rng.state = state.randomState;
      for (let n = 0; n < spec.advanceRandomDraws; n++) rng.nextUInt();
      return {
        created: spec.created,
        skipped: spec.skipped,
        curviness: Math.fround(spec.curviness),
        nodeLaneIndex: state.nodeLaneIndex + spec.deltaNodeLaneIndex,
        randomState: rng.state,
      };
    },
  );
}
const floats = new Set([
  "x",
  "y",
  "z",
  "order",
  "speedLimit",
  "priority",
  "curvePosition",
  "baseHeight",
  "elevation",
  "curviness",
]);
function compare(actual: unknown, expected: unknown, path = "result") {
  if (typeof actual === "number" && typeof expected === "number") {
    const key = path.split(".").at(-1)!;
    if (floats.has(key)) expect(actual, path).toBeCloseTo(expected, 6);
    else expect(actual, path).toBe(expected);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const a = actual as unknown[];
    expect(a.length, path).toBe(expected.length);
    for (let i = 0; i < expected.length; i++)
      compare(a[i], expected[i], `${path}.${i}`);
  } else if (expected !== null && typeof expected === "object") {
    expect(actual, path).toBeTypeOf("object");
    const a = actual as Record<string, unknown>;
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected))
      compare(a[k], v, `${path}.${k}`);
  } else expect(actual, path).toBe(expected);
}
describe("source node-car connection selection", () => {
  it("records complete original method identity and the explicit creation boundary", () => {
    expect(oracle.source.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(
      oracle.source.extraction.originalMethods.find(
        (v) => v.name === "CreateNodeCarLanes",
      )?.token,
    ).toBe(100680014);
    expect(
      oracle.source.extraction.methods.find((v) =>
        v.signature.includes("CreateNodeCarLanes("),
      )?.sha256,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(oracle.source.extraction.classification).toContain(
      "scripted callback boundary",
    );
  });
  for (const c of oracle.cases) it(c.name, () => compare(run(c), c.output));
  it("does not mutate source world buffers", () => {
    const c = oracle.cases.find((v) => v.name === "junction-4")!;
    const before = structuredClone(c);
    run(c);
    expect(c).toEqual(before);
  });
  it("keeps missing merge layers distinct from an actual zero mask", () => {
    const c = oracle.cases[0];
    expect(() =>
      cs2ProcessCarConnectPositions(
        {
          ownerMergeLayers: new Map(),
          compositions: new Map(
            c.world.compositions.map((v) => [v.id, v.flags]),
          ),
        },
        c.input,
        () => {
          throw new Error("unexpected callback");
        },
      ),
    ).toThrow("Missing owner mergeLayers");
    const zero = oracle.cases.find((v) => v.input.nodeMergeLayers === 0)!;
    expect(run(zero).calls.every((v) => v.request.isUnsafe)).toBe(true);
  });
  it("leaves empty input state untouched and does not invoke creation", () => {
    const c = oracle.cases.find((v) => v.name === "empty-0")!;
    const out = cs2ProcessCarConnectPositions(
      { ownerMergeLayers: new Map(), compositions: new Map() },
      c.input,
      () => {
        throw new Error("unexpected callback");
      },
    );
    expect(out.calls).toEqual([]);
    expect(out.nodeLaneIndex).toBe(c.input.nodeLaneIndex);
    expect(out.randomState).toBe(c.input.randomState);
  });
  it("preserves initial created connection keys while deduplicating subsequent acceptance", () => {
    const c = structuredClone(oracle.cases[0]);
    c.input.createdConnections = [
      [10, 0, 20, 0],
      [50, 4, 60, 2],
    ];
    expect(run(c).createdConnections).toEqual(c.input.createdConnections);
  });
  it("filters same-group, non-road and master sources from source-between counts", () => {
    const c = oracle.cases[0];
    const s = c.input.sources[0];
    const t = c.input.targets[0];
    const others = [
      { ...s, group: s.group },
      { ...s, group: 5, lane: { ...s.lane, flags: 4 | 8 } },
      { ...s, group: 5, lane: { ...s.lane, flags: 2 } },
    ];
    expect(cs2CalculateNodeCarSourcesBetween(s, t, others)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
