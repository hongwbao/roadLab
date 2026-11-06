import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2CarLaneSelectIterator,
  cs2CreateLaneSelectWorld,
  cs2IsSelectLaneBlocked,
  cs2LaneSelectScalarCosts,
  cs2SelectOptimalLanes,
  cs2ResolveLaneSelectionMaster,
  cs2CheckLaneSelectionBlocker,
  cs2GetNextSelectLane,
  cs2SelectCurveDistanceSquared,
  type CS2LaneSelectLane,
  type CS2LaneSelectOptions,
  type CS2LaneSelectWorld,
} from "../src/simulation/cs2-lane-select";
import type {
  CS2NavigationCurrentState,
  CS2NavigationQueuedLane,
} from "../src/simulation/cs2-navigation-target";
import type { CS2LaneSpeedWorld } from "../src/simulation/cs2-lane-speed";
import type { Cs2CompiledNetwork } from "../src/simulation/cs2-network";

type FixtureInput = {
  name: string;
  lanes: {
    id: string;
    owner: string | null;
    nodes: string[] | null;
    slave: CS2LaneSelectLane["slave"] | null;
    master: boolean;
    carLane: CS2LaneSelectLane["carLane"] | null;
    priority: number | null;
    objects: { object: string; curvePosition: [number, number] }[];
  }[];
  owners: { id: string; lanes: { laneId: string; pathMethods: number }[] }[];
  objects: {
    id: string;
    moving: boolean;
    controller: string | null;
    queueing: boolean;
  }[];
  current: Omit<CS2NavigationCurrentState, "curvePosition"> & {
    curvePosition: [number, number, number];
  };
  nextLanes: CS2NavigationQueuedLane[];
  options: CS2LaneSelectOptions;
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-select-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  source: {
    gameSha256: string;
    mvid: string;
    classification: string;
    extraction: {
      methods: { signature: string; sha256: string; included: boolean }[];
    };
    originalMethods: { name: string; token: string; ilSha256: string }[];
  };
  cases: {
    input: FixtureInput;
    output: ReturnType<typeof cs2SelectOptimalLanes>;
  }[];
  dllCases: {
    coefficient: number;
    priority: number;
    forbidden: number;
    prefer: number;
    left: boolean;
    flags: number;
    path: number;
    methodsBits: number;
    index: number;
    lanePriority: number;
    switchCost: number;
    priorityCost: number;
    driveCost: number;
    bicycleCost: number;
  }[];
  helperCases: {
    mode: string;
    initialState: number;
    methodBits: number[];
    points: number[][][];
    output: ReturnType<typeof cs2ResolveLaneSelectionMaster>;
  }[];
  blockerCases: {
    moving: boolean;
    queueing: boolean;
    queueLane: boolean;
    changed: boolean;
    speed: number;
    flags: number;
    output: { flags: number; maxSpeed: number; blockerType: number };
  }[];
  distanceCases: {
    points: number[][];
    position: number[];
    output: { distanceSquared: number; t: number };
  }[];
};
function hydrate(input: FixtureInput) {
  const lanes = new Map<string, CS2LaneSelectLane>();
  for (const lane of input.lanes)
    lanes.set(lane.id, {
      owner: lane.owner ?? undefined,
      nodes: lane.nodes
        ? {
            start: BigInt(lane.nodes[0]),
            middle: BigInt(lane.nodes[1]),
            end: BigInt(lane.nodes[2]),
          }
        : undefined,
      slave: lane.slave ?? undefined,
      master: lane.master,
      carLane: lane.carLane ?? undefined,
      reservation:
        lane.priority === null
          ? undefined
          : {
              blocker: null,
              next: { offset: 0, priority: lane.priority },
              previous: { offset: 0, priority: 0 },
            },
      objects: lane.objects.map((object) => ({
        ...object,
        curvePosition: object.curvePosition.map(Math.fround) as [
          number,
          number,
        ],
      })),
    });
  const world: CS2LaneSelectWorld = {
    lanes,
    owners: new Map(input.owners.map((owner) => [owner.id, owner.lanes])),
    objects: new Map(input.objects.map((object) => [object.id, object])),
  };
  const c = input.current,
    [x, y, z] = c.curvePosition.map(Math.fround);
  const current: CS2NavigationCurrentState = {
    ...c,
    curvePosition: { x, y, z },
    changeProgress: Math.fround(c.changeProgress),
  };
  return {
    world,
    current,
    nextLanes: input.nextLanes.map((lane) => ({
      ...lane,
      start: Math.fround(lane.start),
      end: Math.fround(lane.end),
    })),
    ...input.options,
    captureTrace: true,
  };
}
function compare(actual: unknown, expected: unknown, path = "output") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(
      Math.abs((actual as number) - Math.fround(expected)),
      path,
    ).toBeLessThanOrEqual(Math.max(1e-7, Math.abs(expected) * 2e-7));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((value, i) =>
      compare((actual as unknown[])[i], value, `${path}[${i}]`),
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

describe("complete source-extracted lane selection iterator", () => {
  it("records original DLL identity, direct methods and unchanged extracted functional methods", () => {
    expect(oracle.source.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.source.classification).toContain("no Unity World executed");
    expect(oracle.source.originalMethods.map((method) => method.name)).toEqual([
      "GetLaneSwitchCost",
      "GetLanePriorityCost",
      "GetLaneDriveCost",
      "GetBicycleDriveCost",
    ]);
    for (const method of oracle.source.originalMethods)
      expect(method.ilSha256).toHaveLength(64);
    expect(
      oracle.source.extraction.methods.filter((method) => method.included),
    ).toHaveLength(12);
  });
  for (const row of oracle.cases)
    it(`matches buffer/cursor/current/forward entity choices: ${row.input.name}`, () => {
      compare(
        cs2SelectOptimalLanes(hydrate(row.input)),
        row.output,
        row.input.name,
      );
    });
  it("matches 160 direct original-DLL scalar calls (four methods each)", () => {
    for (const row of oracle.dllCases)
      compare(
        cs2LaneSelectScalarCosts({
          entity: "self",
          coefficient: row.coefficient,
          numLanes: row.index,
          priority: row.priority,
          lanePriority: row.lanePriority,
          forbidNetFlags: row.forbidden,
          preferNetFlags: row.prefer,
          leftHandTraffic: row.left,
          netFlags: row.flags,
          pathMethods: row.path,
          subLanePathMethods: row.methodsBits,
          index: row.index,
          minIndex: 0,
          maxIndex: 3,
        }),
        {
          switchCost: row.switchCost,
          priorityCost: row.priorityCost,
          driveCost: row.driveCost,
          bicycleCost: row.bicycleCost,
        },
      );
  });
});

it("initiates a source lane change without an invented speed/gap threshold", () => {
  const row = oracle.cases.find(
    (row) => row.input.name === "static-blocker-init-change",
  )!;
  const input = hydrate(row.input),
    copy = structuredClone(input.current);
  const selected = cs2SelectOptimalLanes(input);
  expect(selected.current.changeLaneId).toBe("g0l0");
  expect(selected.current.changeProgress).toBe(0);
  expect(selected.current.flags & 0x40000).toBeTruthy();
  expect(input.current).toEqual(copy);
  expect(
    cs2SelectOptimalLanes({ ...input, captureTrace: false }).trace,
  ).toEqual([]);
});

it("allows a direct two-lane change when the original cubic cost still selects it", () => {
  const row = oracle.cases.find(
    (row) => row.input.name === "direct-cross-two-lanes",
  )!;
  const selected = cs2SelectOptimalLanes(hydrate(row.input));
  expect(selected.current.laneId).toBe("g0l0");
  expect(selected.current.changeLaneId).toBe("g0l2");
  expect(selected.current.changeProgress).toBe(0);
  expect(selected.current.flags & 0x80000).toBeTruthy();
});

it("reverses a partially completed change by swapping lanes and complementing progress", () => {
  const row = oracle.cases.find(
    (row) => row.input.name === "change-cancel-or-reverse-0.2",
  )!;
  const selected = cs2SelectOptimalLanes(hydrate(row.input));
  expect(selected.current.laneId).toBe("g0l2");
  expect(selected.current.changeLaneId).toBe("g0l1");
  expect(selected.current.changeProgress).toBe(
    Math.fround(1 - Math.fround(0.2)),
  );
});

it("checks inclusive normalized blockage on the master while preserving source missing-master behavior", () => {
  const row = oracle.cases.find(
      (row) => row.input.name === "blocked-current-master",
    )!,
    world = hydrate(row.input).world;
  expect(cs2IsSelectLaneBlocked(world, "g0l1", [0, 1])).toBe(true);
  expect(cs2IsSelectLaneBlocked(world, "g0l1", [0.9, 1])).toBe(false);
  const master = world.lanes.get("master0")!;
  master.master = false;
  expect(cs2IsSelectLaneBlocked(world, "g0l1", [0, 1])).toBe(false);
});

it("retains source fixed 96-float capacity instead of silently truncating", () => {
  const row = oracle.cases.find((row) => row.input.name === "clear")!,
    input = hydrate(row.input);
  const iterator = new CS2CarLaneSelectIterator(input.world, input);
  for (let i = 0; i < 32; i++)
    iterator.calculateLaneCosts(input.nextLanes[0], 0);
  expect(iterator.snapshot().bufferPos).toBe(96);
  expect(() => iterator.calculateLaneCosts(input.nextLanes[0], 0)).toThrow(
    "96 slots exceeded",
  );
});

it("projects the shared network/speed snapshot once without parsing lane IDs or deriving Moving from speed", () => {
  const curve = {
    id: "opaque: left",
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 0, z: 3 },
    ],
    length: 3,
    width: 3,
  };
  const network = {
    groups: new Map([
      [
        "group",
        {
          id: "group",
          master: "master",
          members: ["opaque: left", "opaque: right"],
          allowChange: true,
        },
      ],
    ]),
    lanes: new Map(),
    successors: new Map([["opaque: left", ["out"]]]),
  } as unknown as Cs2CompiledNetwork;
  const speed: CS2LaneSpeedWorld = {
    lanes: new Map([
      [
        "opaque: left",
        {
          curve: {
            ...curve,
            points: curve.points as [
              (typeof curve.points)[0],
              (typeof curve.points)[0],
              (typeof curve.points)[0],
              (typeof curve.points)[0],
            ],
          },
          carLane: { flags: 0, speedLimit: 10, curviness: 0 },
          objects: [{ object: "zero", curvePosition: [0.2, 0.3] }],
        },
      ],
    ]),
    objects: new Map([
      [
        "zero",
        {
          kind: "car",
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        },
      ],
    ]),
  };
  const world = cs2CreateLaneSelectWorld(network, speed);
  expect(world.owners.get("group")?.map((l) => l.laneId)).toEqual([
    "opaque: left",
    "opaque: right",
    "master",
  ]);
  expect(world.objects.get("zero")?.moving).toBe(true);
  expect(world.connects?.("opaque: left", "out", "end-start")).toBe(true);
  expect(world.lanes.get("opaque: left")?.slave?.masterIndex).toBe(2);
});

const vector = (p: readonly number[]) => ({
  x: Math.fround(p[0]),
  y: Math.fround(p[1]),
  z: Math.fround(p[2]),
});
const curveFrom = (points: number[][], id = "curve") => ({
  id,
  points: points.map(vector) as [
    ReturnType<typeof vector>,
    ReturnType<typeof vector>,
    ReturnType<typeof vector>,
    ReturnType<typeof vector>,
  ],
  length: 20,
  width: 3.5,
});
it("matches source master nomination, live RNG state, FixedStart and unavailable method fallback", () => {
  for (const row of oracle.helperCases) {
    const lanes = new Map<string, CS2LaneSelectLane>();
    for (let i = 0; i < 3; i++)
      lanes.set("lane" + (i + 1), { curve: curveFrom(row.points[i]) });
    lanes.set("master", {
      owner: "owner",
      master: { minIndex: 1, maxIndex: 3 },
    });
    lanes.set("current", { curve: curveFrom(row.points[2]) });
    const world: CS2LaneSelectWorld = {
      lanes,
      objects: new Map(),
      owners: new Map([
        [
          "owner",
          [
            { laneId: "dummy", pathMethods: 0 },
            ...row.methodBits.map((pathMethods, i) => ({
              laneId: "lane" + (i + 1),
              pathMethods,
            })),
            { laneId: "master", pathMethods: 2 },
          ],
        ],
      ]),
    };
    const current: CS2NavigationCurrentState = {
      laneId: "current",
      curvePosition: { x: 0.2, y: 0.2, z: 1 },
      changeProgress: 0,
      lanePosition: 0,
      flags: row.mode.startsWith("transform") ? 8 : 0x100,
      duration: 0,
      distance: 0,
    };
    const actual = cs2ResolveLaneSelectionMaster({
      world,
      lane: {
        laneId: row.mode === "nonmaster" ? "lane2" : "master",
        start: 0,
        end: 1,
        flags: 4,
      },
      randomState: row.initialState,
      fixedStartCurrent: [
        "fixed-road",
        "transform-valid",
        "transform-missing",
      ].includes(row.mode)
        ? current
        : undefined,
      transformPosition:
        row.mode === "transform-valid" ? { x: 3.5, y: 0, z: 2 } : null,
    });
    expect(actual, row.mode).toEqual(row.output);
  }
});
it("matches 80 source CheckBlocker flag transitions and max-speed byte quantization", () => {
  const current = hydrate(oracle.cases[0].input).current;
  for (const row of oracle.blockerCases) {
    const world: CS2LaneSelectWorld = {
      lanes: new Map(),
      owners: new Map(),
      objects: new Map([
        ["blocker", { moving: row.moving, queueing: row.queueing }],
      ]),
    };
    const actual = cs2CheckLaneSelectionBlocker({
      world,
      current: { ...current, flags: row.flags },
      previousBlocker: row.changed ? "previous" : "blocker",
      blocker: "blocker",
      blockerType: row.output.blockerType,
      maxSpeed: Math.fround(row.speed),
    });
    expect(actual.current.flags).toBe(row.output.flags);
    expect(actual.blocker).toEqual({
      entity: "blocker",
      type: row.output.blockerType,
      maxSpeed: row.output.maxSpeed,
    });
  }
});
it("matches 96 direct original Colossal.Mathematics cubic-distance calls", () => {
  for (const row of oracle.distanceCases)
    compare(
      cs2SelectCurveDistanceSquared(
        curveFrom(row.points),
        vector(row.position),
      ),
      row.output,
      "cubic distance",
    );
});
it("continues a changing lane through the first actual connected slave in source owner order", () => {
  const world = hydrate(oracle.cases[0].input).world;
  const lanes = world.lanes as Map<string, CS2LaneSelectLane>;
  lanes.get("g1l0")!.nodes!.start = lanes.get("g0l1")!.nodes!.end;
  expect(cs2GetNextSelectLane(world, "g0l1", "g1l1")).toBe("g1l0");
  expect(cs2GetNextSelectLane(world, "g0l1", "master1")).toBe(null);
});
