import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2CurrentLaneCache,
  applyCS2LaneCacheCommands,
  cs2AddLaneObject,
  cs2UpdateLaneObject,
  cs2RemoveLaneObject,
  cs2LaneCacheObjectBounds,
  cs2LaneCacheMinBounds,
  cs2LaneCacheMaxBounds,
  type CS2BlockedLane,
  type CS2LaneCacheBody,
  type CS2LaneCacheBounds,
  type CS2LaneCacheCurrent,
  type CS2LaneCacheCommand,
} from "../src/simulation/cs2-lane-cache";
import type { CS2LaneSpeedLaneObject } from "../src/simulation/cs2-lane-speed";

type EncodedWorld = {
  entities: string[];
  laneObjects: Record<string, CS2LaneSpeedLaneObject[]>;
  searchTree: Record<string, CS2LaneCacheBounds>;
};
type CacheCase = {
  id: string;
  entity: string;
  world: EncodedWorld;
  before: CS2LaneCacheCurrent;
  after: CS2LaneCacheCurrent;
  blocked: CS2BlockedLane[];
  newBlocked: CS2BlockedLane[] | null;
  body: CS2LaneCacheBody;
  expected: {
    constructorState: CS2LaneCacheCurrent;
    commands: CS2LaneCacheCommand[];
    blocked: CS2BlockedLane[];
    remainingNewBlocked: CS2BlockedLane[] | null;
    laneObjects: EncodedWorld["laneObjects"];
    searchTree: EncodedWorld["searchTree"];
    warnings: string[];
  };
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-cache-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    kind: string;
    sha256: string;
    mvid: string;
    methods: { type: string; name: string; ilSha256: string }[];
    changes: string[];
  };
  cases: CacheCase[];
  boundsCases: {
    body: CS2LaneCacheBody;
    expected: {
      object: CS2LaneCacheBounds;
      min: CS2LaneCacheBounds;
      max: CS2LaneCacheBounds;
    };
  }[];
  bufferCases: {
    id: string;
    buffer: CS2LaneSpeedLaneObject[];
    operations: {
      kind: "add" | "update" | "remove";
      object: string;
      curvePosition: readonly [number, number];
    }[];
    expected: CS2LaneSpeedLaneObject[][];
  }[];
};
function f32<T>(value: T, field = ""): T {
  if (typeof value === "number")
    return (field === "flags" ? value : Math.fround(value)) as T;
  if (Array.isArray(value)) return value.map((x) => f32(x)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, f32(v, key)]),
    ) as T;
  return value;
}
function compare(actual: unknown, expected: unknown, path = "state") {
  if (typeof expected === "number")
    expect(
      Math.abs((actual as number) - Math.fround(expected)),
      path,
    ).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 7e-7));
  else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((x, i) =>
      compare((actual as unknown[])[i], x, `${path}[${i}]`),
    );
  } else if (expected && typeof expected === "object") {
    expect(Object.keys(actual as object).sort(), path).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, value] of Object.entries(expected))
      compare(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
  } else expect(actual, path).toEqual(expected);
}
function run(row: CacheCase) {
  const copy = f32(row),
    current = copy.before,
    blocked = copy.blocked,
    laneObjects = new Map(Object.entries(copy.world.laneObjects)),
    searchTree = new Map(Object.entries(copy.world.searchTree)),
    world = { entities: new Set(copy.world.entities), laneObjects, searchTree },
    cache = new CS2CurrentLaneCache(world, current, blocked),
    constructorState = structuredClone(current),
    newBlocked = copy.newBlocked ?? undefined,
    commands = cache.checkChanges(
      copy.entity,
      copy.after,
      copy.body,
      newBlocked,
    ),
    warnings = applyCS2LaneCacheCommands(commands, laneObjects, searchTree);
  return {
    constructorState,
    commands,
    blocked,
    remainingNewBlocked: newBlocked ?? null,
    laneObjects: Object.fromEntries(laneObjects),
    searchTree: Object.fromEntries(searchTree),
    warnings,
  };
}

describe("complete source CurrentLaneCache dictionary oracle", () => {
  it("retains full-method source extraction and genuine original bounds execution provenance", () => {
    expect(oracle.provenance.kind).toContain(
      "automatic complete CurrentLaneCache",
    );
    expect(oracle.provenance.kind).toContain(
      "original ObjectUtils/Mathematics DLLs execute directly",
    );
    expect(oracle.provenance.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(
      oracle.provenance.methods.some(
        (m) => m.name === "CheckChanges" && m.ilSha256.length === 64,
      ),
    ).toBe(true);
    expect(
      oracle.provenance.changes.some((x) =>
        x.includes("method bodies unchanged"),
      ),
    ).toBe(true);
  });
  for (const row of oracle.cases)
    it(`matches commands, membership, blocked diffs and tree state: ${row.id}`, () => {
      const result = run(row);
      expect(result.constructorState).toEqual(
        f32(row.expected.constructorState),
      );
      compare(result, row.expected, row.id);
    });
});

it("matches all original ObjectUtils and extracted cache min/max bounds with rotations and circular geometry", () => {
  expect(oracle.boundsCases).toHaveLength(256);
  for (const row of oracle.boundsCases) {
    const body = f32(row.body);
    compare(
      cs2LaneCacheObjectBounds(body),
      row.expected.object,
      "original ObjectUtils",
    );
    compare(
      cs2LaneCacheMinBounds(body),
      row.expected.min,
      "minimum containment bounds",
    );
    compare(
      cs2LaneCacheMaxBounds(body),
      row.expected.max,
      "maximum refresh bounds",
    );
  }
});
for (const row of oracle.bufferCases)
  it(`matches every literal NetUtils mutation and equal-y ordering: ${row.id}`, () => {
    const buffer = f32(row.buffer);
    row.operations.forEach((op, index) => {
      if (op.kind === "add")
        cs2AddLaneObject(buffer, op.object, op.curvePosition);
      else if (op.kind === "update")
        cs2UpdateLaneObject(buffer, op.object, op.curvePosition);
      else cs2RemoveLaneObject(buffer, op.object);
      expect(buffer).toEqual(f32(row.expected[index]));
    });
  });

it("moves ordinary membership to the source target lane without inventing blocked rear occupancy", () => {
  const row = oracle.cases.find(
      (x) => x.id === "ordinary-target-advances-body-still-on-old-lane",
    )!,
    result = run(row);
  expect(result.blocked).toEqual([]);
  expect(result.commands).toEqual([
    { kind: "lane-remove", lane: "a", object: "self" },
    {
      kind: "lane-add",
      lane: "b",
      object: "self",
      curvePosition: [0, Math.fround(0.2)],
    },
  ]);
  expect(result.laneObjects.a).toEqual([]);
  expect(result.laneObjects.b[0].object).toBe("self");
});
it("sorts by reservation y and preserves source equal-y insertion and update behavior", () => {
  const buffer: CS2LaneSpeedLaneObject[] = [];
  cs2AddLaneObject(buffer, "ahead-x", [0.9, 0.2]);
  cs2AddLaneObject(buffer, "behind-x", [0.1, 0.8]);
  expect(buffer.map((x) => x.object)).toEqual(["ahead-x", "behind-x"]);
  cs2AddLaneObject(buffer, "equal-y-new", [0.7, 0.2]);
  expect(buffer.map((x) => x.object)).toEqual([
    "equal-y-new",
    "ahead-x",
    "behind-x",
  ]);
  cs2UpdateLaneObject(buffer, "behind-x", [0.1, 0.2]);
  expect(buffer.map((x) => x.object)).toEqual([
    "behind-x",
    "equal-y-new",
    "ahead-x",
  ]);
});
it("matches the source NativeQuadTree.Update missing-item error contract", () => {
  expect(() =>
    applyCS2LaneCacheCommands(
      [
        {
          kind: "tree-update",
          object: "missing",
          bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
        },
      ],
      new Map(),
      new Map(),
    ),
  ).toThrow("Item not found (NativeQuadTree.Update)!");
});
