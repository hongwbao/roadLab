import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2CarLaneSpeedIterator,
  CS2LaneSpeedUnsupportedError,
  type CS2LaneSpeedChangingInput,
  type CS2LaneSpeedFirstInput,
  type CS2LaneSpeedInitialState,
  type CS2LaneSpeedLane,
  type CS2LaneSpeedNextInput,
  type CS2LaneSpeedObject,
  type CS2LaneSpeedState,
  type CS2LaneSpeedResult,
} from "../src/simulation/cs2-lane-speed";
import type { V } from "../src/core/types";

type Step =
  | { kind: "first"; input: CS2LaneSpeedFirstInput }
  | { kind: "changing"; input: CS2LaneSpeedChangingInput }
  | { kind: "next"; input: CS2LaneSpeedNextInput }
  | { kind: "target"; input: { targetPosition: V; maxLaneSpeed?: number } };
type Scenario = {
  id: string;
  world: {
    lanes: Record<string, CS2LaneSpeedLane>;
    objects: Record<string, CS2LaneSpeedObject>;
  };
  initial: CS2LaneSpeedInitialState;
  steps: Step[];
  expected: { result: CS2LaneSpeedResult | null; state: CS2LaneSpeedState }[];
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-speed-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    kind: string;
    sha256: string;
    mvid: string;
    changes: string[];
    methods: { name: string; ilSha256: string }[];
  };
  cases: Scenario[];
};

/** C# deserialization produces source float32 input fields. */
function f32<T>(input: T, field = ""): T {
  if (typeof input === "number")
    return (
      field === "flags" || field === "laneFlags" ? input : Math.fround(input)
    ) as T;
  if (Array.isArray(input)) return input.map((value) => f32(value)) as T;
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, f32(value, key)]),
    ) as T;
  return input;
}
function iterator(row: Scenario) {
  const world = f32(row.world);
  return new CS2CarLaneSpeedIterator(
    {
      lanes: new Map(Object.entries(world.lanes)),
      objects: new Map(Object.entries(world.objects)),
    },
    f32(row.initial),
  );
}
function run(it: CS2CarLaneSpeedIterator, step: Step) {
  const input = f32(step.input);
  switch (step.kind) {
    case "first":
      return it.iterateFirstLane(input as CS2LaneSpeedFirstInput);
    case "changing":
      return it.iterateChangingLane(input as CS2LaneSpeedChangingInput);
    case "next":
      return it.iterateNextLane(input as CS2LaneSpeedNextInput);
    case "target": {
      const target = input as { targetPosition: V; maxLaneSpeed?: number };
      it.iterateTarget(target.targetPosition, target.maxLaneSpeed);
      return null;
    }
  }
}
function compare(actual: unknown, expected: unknown, path: string) {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    // A few ULPs cover JS/C# sqrt/JIT arithmetic; branches, IDs and flags are exact.
    expect(
      Math.abs((actual as number) - Math.fround(expected)),
      path,
    ).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 5e-7));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((v, i) =>
      compare((actual as unknown[])[i], v, `${path}[${i}]`),
    );
  } else if (expected && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected))
      compare(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
  } else expect(actual, path).toEqual(expected);
}

describe("full original normal-car iterator method-chain oracle", () => {
  it("keeps source-extracted dictionary ECS separate from original DLL math execution", () => {
    expect(oracle.provenance.kind).toContain(
      "automatically extracted full original iterator",
    );
    expect(oracle.provenance.changes).toContain(
      "namespace changed to RoadLab.Oracle",
    );
    expect(
      oracle.provenance.changes.some((x) => x.includes("CheckParkingLane")),
    ).toBe(true);
    expect(oracle.provenance.sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(
      oracle.provenance.methods.filter((x) => x.name === "IterateFirstLane"),
    ).toHaveLength(2);
    for (const name of [
      "CheckSpace",
      "CheckOverlapSpace",
      "CheckCurrentLane",
      "CheckOverlappingLanes",
      "GetObjectSpeed",
      "UpdateMaxSpeed",
    ])
      expect(
        oracle.provenance.methods.some(
          (x) => x.name === name && x.ilSha256.length === 64,
        ),
      ).toBe(true);
  });
  for (const row of oracle.cases)
    it(`matches every source step and internal state: ${row.id}`, () => {
      const it = iterator(row);
      row.steps.forEach((step, index) => {
        expect(run(it, step), `result step ${index}`).toEqual(
          row.expected[index].result,
        );
        compare(it.state, row.expected[index].state, `${row.id} step ${index}`);
      });
    });
});

it("rejects unsupported vehicle/lane components explicitly instead of treating them as cars", () => {
  const row = structuredClone(
    oracle.cases.find((x) => x.id === "front-0.9-4")!,
  );
  row.world.objects.lead.kind = "train";
  expect(() => run(iterator(row), row.steps[0])).toThrow(
    CS2LaneSpeedUnsupportedError,
  );
  const bicycle = structuredClone(oracle.cases[0]);
  bicycle.initial.isBicycle = true;
  expect(() => iterator(bicycle)).toThrow("Bicycle iterator is deferred");
  const parking = structuredClone(oracle.cases[0]);
  parking.world.lanes.a.kind = "parking";
  expect(() => run(iterator(parking), parking.steps[0])).toThrow(
    "Lane kind parking deferred",
  );
});

function stateAfter(id: string, index: number) {
  const row = oracle.cases.find((row) => row.id === id)!;
  const it = iterator(row);
  for (let i = 0; i <= index; i++) run(it, row.steps[i]);
  return it.state;
}
it("always checks crossing bodies even when reservation admission was skipped", () => {
  expect(
    stateAfter("objects-even-when-reservation-gate-skipped-False", 1).blocker,
  ).toBeNull();
  const blocked = stateAfter(
    "objects-even-when-reservation-gate-skipped-True",
    1,
  );
  expect(blocked.blocker).toBe("cross-unconditional");
  expect(blocked.blockerType).toBe(2);
  expect(blocked.maxSpeed).toBeLessThan(8);
});
it("distinguishes reservation cursors from physical positions and denies an unsafe initial lane change", () => {
  expect(stateAfter("object-buffer-reservation-y-0.78", 0).blocker).toBeNull();
  expect(stateAfter("object-buffer-reservation-y-0.95", 0).blocker).toBe(
    "cursor-vs-body",
  );
  expect(stateAfter("change-rear-body-progress-0", 0).canChangeLane).toBe(0);
  expect(stateAfter("change-rear-body-progress-0.2", 0).canChangeLane).toBe(1);
});
it("retains the source IgnoreBlocker floor, oncoming response, roundabout memory and downstream space scan", () => {
  expect(stateAfter("ignore-floor-three-False", 0).maxSpeed).toBe(0);
  expect(stateAfter("ignore-floor-three-True", 0).maxSpeed).toBe(3);
  const oncoming = stateAfter("direction-False-oncoming-True-ignore-False", 0);
  expect(oncoming.blocker).toBeNull();
  expect(oncoming.blockerType).toBe(8);
  expect(oncoming.maxSpeed).toBe(3);
  expect(oncoming.oncoming).toBeGreaterThan(1);
  expect(
    stateAfter("roundabout-temporary-memory-objects-True", 0).temporaryLanes,
  ).toEqual(["x"]);
  expect(
    stateAfter("check-space-multiple-exit-blocked-False-boundary-False", 1)
      .maxSpeed,
  ).toBe(15);
  expect(
    stateAfter("check-space-multiple-exit-blocked-False-boundary-True", 1)
      .blockerType,
  ).toBe(1);
});
it("canonicalizes RoadLab's fitted double Bezier control points to original float3 geometry", () => {
  const row = oracle.cases[0],
    it = new CS2CarLaneSpeedIterator(
      {
        lanes: new Map(Object.entries(row.world.lanes)),
        objects: new Map(Object.entries(row.world.objects)),
      },
      row.initial,
    );
  row.steps.forEach((step, index) => {
    expect(run(it, step)).toEqual(row.expected[index].result);
    compare(it.state, row.expected[index].state, `raw-world step ${index}`);
  });
});

it("retains real Unspawned component input without inventing a filter in ordinary source methods", () => {
  for (const branch of ["current", "crossing", "overlap-space"]) {
    const hidden = oracle.cases.find(
      (row) => row.id === `unspawned-${branch}-True`,
    )!;
    const visible = oracle.cases.find(
      (row) => row.id === `unspawned-${branch}-False`,
    )!;
    expect(hidden.world.objects["flagged-object"].unspawned).toBe(true);
    expect(visible.world.objects["flagged-object"].unspawned).toBe(false);
    expect(hidden.expected).toEqual(visible.expected);
    const it = iterator(hidden);
    hidden.steps.forEach((step, index) => {
      expect(run(it, step)).toEqual(visible.expected[index].result);
      compare(
        it.state,
        visible.expected[index].state,
        `${branch} source Unspawned step ${index}`,
      );
    });
  }
});
