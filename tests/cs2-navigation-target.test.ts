import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import {
  cs2MoveCar,
  type CS2MotionVector,
  type CS2MotionState,
} from "../src/simulation/cs2-motion";
import {
  CS2_NAV_TARGET_FLAGS,
  cs2AdvanceNavigationCurve,
  cs2LaneOffset,
  cs2LanePosition,
  cs2MoveChangingLaneTarget,
  cs2MoveRoadTarget,
  cs2ScanNavigationGeometry,
  cs2UpdateRoadNavigationTarget,
  type CS2NavigationCurve,
  type CS2NavigationCurrentState,
  type CS2RoadTargetInput,
} from "../src/simulation/cs2-navigation-target";

type Points = number[][];
type CurveDTO = {
  Id: string;
  Points: Points;
  Length: number;
  Width: number;
  WidthOffset: number[];
  Twoway: boolean;
  Highway: boolean;
  Lit: boolean;
};
type CurrentDTO = {
  LaneId: string | null;
  ChangeLaneId: string | null;
  CurvePosition: number[];
  ChangeProgress: number;
  LanePosition: number;
  Flags: number;
  Duration: number;
  Distance: number;
};
type QueueDTO = {
  LaneId: string;
  Start: number;
  End: number;
  Flags: number;
  Valid: boolean;
};
type NormalInput = {
  Curves: CurveDTO[];
  Current: CurrentDTO;
  NextLanes: QueueDTO[];
  Position: number[];
  Velocity: number[];
  Rotation: number[];
  TargetPosition: number[];
  TargetRotation: number[];
  PreviousMaxSpeed: number;
  MaxSpeed: number;
  VehicleWidth: number;
  FrontExtent: number;
  PivotOffset: number;
  CarMaxSpeed: number;
  Braking: number;
  Random01: number;
  Oncoming: number;
  CanChangeLane: number;
  TemporaryBlocker: boolean;
  PreviousTemporaryBlocker: boolean;
  UpcomingTurnFlags: number;
  LeftHandTraffic: boolean;
  Continuations: Record<string, string>;
};
type NormalOutput = {
  TargetPosition: number[];
  TargetRotation: number[];
  MaxSpeed: number;
  Current: CurrentDTO;
  NextLanes: QueueDTO[];
  SideEffects: { LaneId: string; Duration: number; Distance: number }[];
  OdometerDelta: number;
  SpawnBlocked: boolean;
  EndReached: boolean;
  Consumed: number;
};
type SingleInput = {
  points: Points;
  delta: number[];
  compare: number[];
  lanePosition: number;
  minDistance: number;
  width: number;
  widthOffset: number[];
  vehicleWidth: number;
  bicycle: boolean;
};
type DualInput = {
  points1: Points;
  points2: Points;
  delta: number[];
  compare: number[];
  blend: number;
  minDistance: number;
  width1: number;
  width2: number;
  widthOffset1: number[];
  widthOffset2: number[];
  lanePosition1: number;
  lanePosition2: number;
  vehicleWidth: number;
  bicycle: boolean;
};
type TargetOutput = { enough: boolean; target: number[]; delta: number[] };
type Oracle = {
  source: { game_sha256: string; classification: string };
  singleCases: { input: SingleInput; output: TargetOutput }[];
  dualCases: { input: DualInput; output: TargetOutput }[];
  offsetCases: {
    input: {
      t: number;
      lanePosition: number;
      bicycle: boolean;
      width: number;
      widthOffset: number[];
      vehicleWidth: number;
    };
    output: number;
  }[];
  pointCases: {
    input: { points: Points; t: number; offset: number };
    output: number[];
  }[];
  normalCases: { input: NormalInput; output: NormalOutput }[];
  normalTraces: {
    name: string;
    steps: {
      input: NormalInput;
      output: NormalOutput;
      motion: { Position: number[]; Velocity: number[]; Rotation: number[] };
    }[];
  }[];
  advanceCases: {
    input: {
      Curve: CurveDTO;
      ChangeCurve: CurveDTO;
      Delta: number[];
      Blend: number;
      Mode: number;
      Position: number[];
      Distance: number;
      PreviousPosition: number[];
      PreviousDistance: number;
    };
    output: {
      Position: number[];
      Distance: number;
      PreviousPosition: number[];
      PreviousDistance: number;
    };
  }[];
};
const oracle: Oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-navigation-target-oracle.json", import.meta.url),
    "utf8",
  ),
);
const p = (a: number[]): CS2MotionVector => ({ x: a[0], y: a[1], z: a[2] }),
  q = (a: number[]) => ({ ...p(a), w: a[3] }),
  values = (a: CS2MotionVector) => [a.x, a.y, a.z];
const curve = (
  points: Points,
  width = 3.5,
  widthOffset: number[] = [0, 0],
  id = "a",
  length = 30,
): CS2NavigationCurve => ({
  id,
  points: [p(points[0]), p(points[1]), p(points[2]), p(points[3])],
  length,
  width,
  widthOffset: [widthOffset[0], widthOffset[1]],
});
const fromCurve = (c: CurveDTO): CS2NavigationCurve => ({
  ...curve(c.Points, c.Width, c.WidthOffset, c.Id, c.Length),
  twoway: c.Twoway,
  highway: c.Highway,
  lit: c.Lit,
});
const fromCurrent = (a: CurrentDTO): CS2NavigationCurrentState => ({
  laneId: a.LaneId,
  changeLaneId: a.ChangeLaneId,
  curvePosition: p(a.CurvePosition),
  changeProgress: a.ChangeProgress,
  lanePosition: a.LanePosition,
  flags: a.Flags,
  duration: a.Duration,
  distance: a.Distance,
});
const input = (a: NormalInput): CS2RoadTargetInput => ({
  state: {
    position: p(a.Position),
    velocity: p(a.Velocity),
    rotation: q(a.Rotation),
  },
  navigation: {
    targetPosition: p(a.TargetPosition),
    maxSpeed: a.PreviousMaxSpeed,
    targetRotation: q(a.TargetRotation),
  },
  current: fromCurrent(a.Current),
  nextLanes: a.NextLanes.map((c) => ({
    laneId: c.LaneId,
    start: c.Start,
    end: c.End,
    flags: c.Flags,
    valid: c.Valid,
  })),
  lanes: new Map(a.Curves.map((c) => [c.Id, fromCurve(c)])),
  vehicleWidth: a.VehicleWidth,
  frontExtent: a.FrontExtent,
  pivotOffset: a.PivotOffset,
  car: { ...CS2_BASE_CAR, maxSpeed: a.CarMaxSpeed, braking: a.Braking },
  maxSpeed: a.MaxSpeed,
  oncoming: a.Oncoming,
  canChangeLane: a.CanChangeLane,
  random01: a.Random01,
  temporaryBlocker: a.TemporaryBlocker,
  previousTemporaryBlocker: a.PreviousTemporaryBlocker,
  upcomingTurnFlags: a.UpcomingTurnFlags,
  leftHandTraffic: a.LeftHandTraffic,
  selectNextLane: (previous, next) => a.Continuations[previous + ">" + next],
});
const close = (actual: number[], expected: number[], context: string) =>
  actual.forEach((v, i) =>
    expect(
      Math.abs(v - expected[i]),
      `${context}[${i}] ${v} vs ${expected[i]}`,
    ).toBeLessThan(0.00003 + Math.abs(expected[i]) * 0.000002),
  );
function compare(
  actual: ReturnType<typeof cs2UpdateRoadNavigationTarget>,
  expected: NormalOutput,
  label: string,
) {
  close(
    values(actual.navigation.targetPosition),
    expected.TargetPosition,
    label + " target",
  );
  close([actual.navigation.maxSpeed], [expected.MaxSpeed], label + " speed");
  const c = actual.current,
    e = expected.Current;
  expect(c.laneId, label).toBe(e.LaneId);
  expect(c.changeLaneId ?? null, label).toBe(e.ChangeLaneId);
  expect(c.flags, label).toBe(e.Flags);
  close(values(c.curvePosition), e.CurvePosition, label + " cursor");
  close(
    [c.changeProgress, c.lanePosition, c.duration, c.distance],
    [e.ChangeProgress, e.LanePosition, e.Duration, e.Distance],
    label + " state",
  );
  expect(
    actual.nextLanes.map((l) => l.laneId),
    label,
  ).toEqual(expected.NextLanes.map((l) => l.LaneId));
  expect(
    actual.sideEffects.map((l) => l.laneId),
    label,
  ).toEqual(expected.SideEffects.map((l) => l.LaneId));
  actual.sideEffects.forEach((v, i) =>
    close(
      [v.duration, v.distance],
      [expected.SideEffects[i].Duration, expected.SideEffects[i].Distance],
      label + " flow",
    ),
  );
  close([actual.odometerDelta], [expected.OdometerDelta], label + " odometer");
  expect(actual.spawnBlocked, label).toBe(expected.SpawnBlocked);
  expect(actual.endReached, label).toBe(expected.EndReached);
  expect(actual.consumed, label).toBe(expected.Consumed);
}

it("retains original DLL identity and distinguishes direct and source-extracted evidence", () => {
  expect(oracle.source.game_sha256).toBe(
    "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
  );
  expect(oracle.source.classification).toContain("not original ECS execution");
  expect(oracle.singleCases).toHaveLength(72);
  expect(oracle.dualCases).toHaveLength(45);
});
it("matches 72 directly invoked original single-curve MoveTarget cases", () => {
  for (const { input: a, output: b } of oracle.singleCases) {
    const result = cs2MoveRoadTarget({
      comparePosition: p(a.compare),
      minDistance: a.minDistance,
      curve: curve(a.points, a.width, a.widthOffset),
      curvePosition: p(a.delta),
      vehicleWidth: a.vehicleWidth,
      lanePosition: a.lanePosition,
      bicycle: a.bicycle,
    });
    expect(result.enough).toBe(b.enough);
    close(values(result.targetPosition), b.target, "single target");
    close(values(result.curvePosition), b.delta, "single cursor");
  }
});
it("matches 45 directly invoked original two-curve MoveTarget cases", () => {
  for (const { input: a, output: b } of oracle.dualCases) {
    const result = cs2MoveChangingLaneTarget({
      comparePosition: p(a.compare),
      minDistance: a.minDistance,
      curve1: curve(a.points1, a.width1, a.widthOffset1),
      curve2: curve(a.points2, a.width2, a.widthOffset2),
      curvePosition: p(a.delta),
      blend: a.blend,
      vehicleWidth: a.vehicleWidth,
      lanePosition1: a.lanePosition1,
      lanePosition2: a.lanePosition2,
      bicycle: a.bicycle,
    });
    expect(result.enough).toBe(b.enough);
    close(values(result.targetPosition), b.target, "dual target");
    close(values(result.curvePosition), b.delta, "dual cursor");
  }
});
it("matches 24 original lane-offset and 48 lane-position results", () => {
  expect(oracle.offsetCases).toHaveLength(24);
  expect(oracle.pointCases).toHaveLength(48);
  for (const { input: a, output: b } of oracle.offsetCases)
    close(
      [
        cs2LaneOffset(
          curve(oracle.singleCases[0].input.points, a.width, a.widthOffset),
          a.t,
          a.vehicleWidth,
          a.lanePosition,
          a.bicycle,
        ),
      ],
      [b],
      "offset",
    );
  for (const { input: a, output: b } of oracle.pointCases)
    close(values(cs2LanePosition(curve(a.points), a.t, a.offset)), b, "point");
});
it("matches 68 extracted normal-target phase cases", () => {
  expect(oracle.normalCases).toHaveLength(68);
  oracle.normalCases.forEach((test, i) =>
    compare(
      cs2UpdateRoadNavigationTarget(input(test.input)),
      test.output,
      `normal ${i}`,
    ),
  );
});
for (const trace of oracle.normalTraces)
  it(`matches the ${trace.name} source target+motion trace`, () => {
    let state: CS2MotionState | undefined,
      previous: ReturnType<typeof cs2UpdateRoadNavigationTarget> | undefined;
    for (const [i, test] of trace.steps.entries()) {
      const a = input(test.input);
      if (state) a.state = state;
      if (previous) {
        a.navigation = previous.navigation;
        a.current = previous.current;
        a.nextLanes = previous.nextLanes;
      }
      const result = cs2UpdateRoadNavigationTarget(a);
      compare(result, test.output, `${trace.name} ${i}`);
      const motion = cs2MoveCar({
        state: a.state,
        navigation: result.navigation,
        pivotOffset: a.pivotOffset,
        laneFlags: result.current.flags,
      });
      close(
        values(motion.state.position),
        test.motion.Position,
        "joined position",
      );
      close(
        values(motion.state.velocity),
        test.motion.Velocity,
        "joined velocity",
      );
      close(
        [...values(motion.state.rotation), motion.state.rotation.w],
        test.motion.Rotation,
        "joined rotation",
      );
      state = motion.state;
      previous = result;
    }
  });
it("matches 36 source curve-distance accumulation fragments", () => {
  expect(oracle.advanceCases).toHaveLength(36);
  for (const { input: a, output: b } of oracle.advanceCases) {
    const result = cs2AdvanceNavigationCurve({
      curve: fromCurve(a.Curve),
      changeCurve: a.Mode === 1 ? fromCurve(a.ChangeCurve) : undefined,
      blend: a.Blend,
      first: a.Mode !== 2,
      start: a.Delta[0],
      end: a.Delta[2],
      position: p(a.Position),
      distance: a.Distance,
      previousPosition: p(a.PreviousPosition),
      previousDistance: a.PreviousDistance,
    });
    close(values(result.position), b.Position, "advance position");
    close(
      [result.distance, result.previousDistance],
      [b.Distance, b.PreviousDistance],
      "advance distances",
    );
    close(
      values(result.previousPosition),
      b.PreviousPosition,
      "advance previous",
    );
  }
});
it("reports special world targets instead of silently using normal road geometry", () => {
  const a = input(oracle.normalCases[0].input);
  a.current.flags |= CS2_NAV_TARGET_FLAGS.Area;
  expect(() => cs2UpdateRoadNavigationTarget(a)).toThrow("normal road/node");
  const short = input(oracle.normalCases.at(-1)!.input);
  short.nextLanes[0].flags |= CS2_NAV_TARGET_FLAGS.Area;
  const result = cs2UpdateRoadNavigationTarget(short);
  expect(result.deferredLane?.laneId).toBe("node");
  expect(result.nextLanes[0].laneId).toBe("node");
});
it("retains caller-owned current and navigation state", () => {
  const a = input(oracle.normalCases[0].input),
    before = structuredClone({
      current: a.current,
      navigation: a.navigation,
      nextLanes: a.nextLanes,
    });
  cs2UpdateRoadNavigationTarget(a);
  expect({
    current: a.current,
    navigation: a.navigation,
    nextLanes: a.nextLanes,
  }).toEqual(before);
});
it("exposes per-lane speed checks while retaining the original scan horizon", () => {
  const a = input(oracle.normalCases.at(-1)!.input),
    args = {
      position: a.state.position,
      current: a.current,
      nextLanes: a.nextLanes,
      lanes: a.lanes,
      vehicleWidth: a.vehicleWidth,
      frontExtent: a.frontExtent,
      maxSpeed: 10,
      speedRange: { min: 0, max: 20 },
      safeTimeStep: 0.6,
      distanceOffset: 0,
    };
  const normal = cs2ScanNavigationGeometry(args);
  expect(normal.visits.map((v) => v.laneId)).toEqual(["a", "node", "out"]);
  expect(normal.stopped).toBe(true);
  const stop = cs2ScanNavigationGeometry({
    ...args,
    evaluate: (v) => (v.laneId === "node" ? 0 : undefined),
  });
  expect(stop.visits.map((v) => v.laneId)).toEqual(["a", "node"]);
  expect(stop.maxSpeed).toBe(0);
});
