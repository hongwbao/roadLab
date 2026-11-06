import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import {
  CS2_MOTION_CAR_FLAGS,
  type CS2MotionState,
  type CS2MotionVector,
} from "../src/simulation/cs2-motion";
import type {
  CS2NavigationCurrentState,
  CS2NavigationCurve,
  CS2NavigationQueuedLane,
} from "../src/simulation/cs2-navigation-target";
import {
  Cs2VehicleRuntime,
  cs2ChooseVehicleUpdateGroup,
  cs2InitializeVehicleFrames,
  cs2ResetUpdatedVehicleFrames,
  type CS2RuntimeDecisionCallback,
  type CS2RuntimeFrame,
  type CS2RuntimeVehicleSeed,
} from "../src/simulation/cs2-vehicle-runtime";

type CurrentDTO = {
  LaneId: string;
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
type CurveDTO = {
  Id: string;
  Points: number[][];
  Length: number;
  Width: number;
  WidthOffset: number[];
  Twoway: boolean;
  Highway: boolean;
  Lit: boolean;
};
type FrameDTO = {
  Position: number[];
  Velocity: number[];
  Rotation: number[];
  Flags: number;
  StateTimer: number;
  State: number;
  Activity: number;
};
type SeedDTO = {
  id: number;
  updateGroup: number;
  data: {
    Current: CurrentDTO;
    NextLanes: QueueDTO[];
    Position: number[];
    Velocity: number[];
    Rotation: number[];
    TargetPosition: number[];
    TargetRotation: number[];
    PreviousMaxSpeed: number;
    VehicleWidth: number;
    FrontExtent: number;
    PivotOffset: number;
    CarMaxSpeed: number;
    Braking: number;
    Continuations: Record<string, string>;
  };
};
type DecisionDTO = {
  id: number;
  maxSpeed: number;
  random01: number;
  dayLightBrightness: number;
  current: CurrentDTO;
  nextLanes: QueueDTO[];
};
type VehicleDTO = {
  id: number;
  group: number;
  position: number[];
  velocity: number[];
  rotation: number[];
  target: number[];
  maxSpeed: number;
  current: CurrentDTO;
  nextLanes: QueueDTO[];
  frames: FrameDTO[];
  odometer: number;
  updates: number;
  display: {
    position: number[];
    rotation: number[];
    flags: number;
    frame1: number;
    frame2: number;
    fraction: number;
  };
};
type Oracle = {
  source: { game_sha256: string; classification: string };
  curves: CurveDTO[];
  seeds: SeedDTO[];
  trace: {
    frame: number;
    actions: string[];
    decisions: DecisionDTO[];
    events: string[];
    vehicles: VehicleDTO[];
  }[];
  frameCases: {
    frame: number;
    group: number;
    mode: string;
    state: { position: number[]; velocity: number[]; rotation: number[] };
    previous: FrameDTO[];
    output: FrameDTO[];
  }[];
  groupCases: { populations: number[]; output: number }[];
};
const oracle: Oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-vehicle-runtime-oracle.json", import.meta.url),
    "utf8",
  ),
);
const p = (a: number[]): CS2MotionVector => ({ x: a[0], y: a[1], z: a[2] }),
  q = (a: number[]) => ({ ...p(a), w: a[3] }),
  v = (a: CS2MotionVector) => [a.x, a.y, a.z],
  qa = (a: CS2MotionState["rotation"]) => [...v(a), a.w];
const current = (a: CurrentDTO): CS2NavigationCurrentState => ({
  laneId: a.LaneId,
  changeLaneId: a.ChangeLaneId,
  curvePosition: p(a.CurvePosition),
  changeProgress: a.ChangeProgress,
  lanePosition: a.LanePosition,
  flags: a.Flags,
  duration: a.Duration,
  distance: a.Distance,
});
const queue = (rows: QueueDTO[]): CS2NavigationQueuedLane[] =>
  rows.map((a) => ({
    laneId: a.LaneId,
    start: a.Start,
    end: a.End,
    flags: a.Flags,
    valid: a.Valid,
  }));
const frame = (a: FrameDTO): CS2RuntimeFrame => ({
  position: p(a.Position),
  velocity: p(a.Velocity),
  rotation: q(a.Rotation),
  flags: a.Flags,
  stateTimer: a.StateTimer,
  state: a.State,
  activity: a.Activity,
});
const curves = new Map<string, CS2NavigationCurve>(
  oracle.curves.map((c) => [
    c.Id,
    {
      id: c.Id,
      points: [p(c.Points[0]), p(c.Points[1]), p(c.Points[2]), p(c.Points[3])],
      length: c.Length,
      width: c.Width,
      widthOffset: [c.WidthOffset[0], c.WidthOffset[1]],
      twoway: c.Twoway,
      highway: c.Highway,
      lit: c.Lit,
    },
  ]),
);
const seed = (s: SeedDTO): CS2RuntimeVehicleSeed => ({
  id: s.id,
  updateGroup: s.updateGroup,
  car: {
    ...CS2_BASE_CAR,
    maxSpeed: s.data.CarMaxSpeed,
    braking: s.data.Braking,
  },
  geometry: {
    width: s.data.VehicleWidth,
    frontExtent: s.data.FrontExtent,
    pivotOffset: s.data.PivotOffset,
  },
  state: {
    position: p(s.data.Position),
    velocity: p(s.data.Velocity),
    rotation: q(s.data.Rotation),
  },
  navigation: {
    targetPosition: p(s.data.TargetPosition),
    maxSpeed: s.data.PreviousMaxSpeed,
    targetRotation: q(s.data.TargetRotation),
  },
  current: current(s.data.Current),
  nextLanes: queue(s.data.NextLanes),
  seed: s.id,
});
function makeRuntime() {
  const runtime = new Cs2VehicleRuntime(curves);
  oracle.seeds.forEach((s) => runtime.addVehicle(seed(s)));
  return runtime;
}
const close = (a: number[], b: number[], label: string) =>
  a.forEach((n, i) =>
    expect(Math.abs(n - b[i]), `${label}[${i}] ${n} vs ${b[i]}`).toBeLessThan(
      0.00004 + Math.abs(b[i]) * 0.000002,
    ),
  );
function compareFrame(a: CS2RuntimeFrame, b: FrameDTO, label: string) {
  close(v(a.position), b.Position, label + " position");
  close(v(a.velocity), b.Velocity, label + " velocity");
  close(qa(a.rotation), b.Rotation, label + " rotation");
  expect(a.flags, label).toBe(b.Flags);
  expect(a.stateTimer ?? 0, label).toBe(b.StateTimer);
  expect(a.state ?? 0, label).toBe(b.State);
  expect(a.activity ?? 0, label).toBe(b.Activity);
}
const decide: CS2RuntimeDecisionCallback = (vehicle, context) => {
  const row = oracle.trace[context.frame].decisions.find(
    (d) => d.id === vehicle.id,
  )!;
  if (!row)
    throw new Error("No scripted decision for an ineligible source group");
  const original = oracle.seeds.find((s) => s.id === vehicle.id)!;
  return {
    maxSpeed: row.maxSpeed,
    random01: row.random01,
    dayLightBrightness: row.dayLightBrightness,
    ...(context.frame === 39 && vehicle.id === 2
      ? {
          current: {
            ...vehicle.current,
            changeLaneId: row.current.ChangeLaneId,
            changeProgress: 0,
            flags: vehicle.current.flags | 0x80000,
          },
          nextLanes: queue(row.nextLanes),
        }
      : {}),
    selectNextLane: (a, b) => original.data.Continuations[a + ">" + b],
  };
};
function actions(runtime: Cs2VehicleRuntime, index: number) {
  for (const action of oracle.trace[index].actions)
    if (action.startsWith("full-update:"))
      runtime.applyFullUpdate(
        Number(action.split(":")[1]),
        undefined,
        false,
        index,
      );
}

it("keeps source-composition provenance distinct from a running Unity world", () => {
  expect(oracle.source.game_sha256).toBe(
    "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
  );
  expect(oracle.source.classification).toContain(
    "does not execute a Unity World",
  );
  expect(oracle.trace).toHaveLength(160);
  const travelled = oracle.trace.map((row) =>
    row.vehicles.find((v) => v.id === 2)!,
  );
  expect(new Set(travelled.map((v) => v.current.LaneId))).toEqual(
    new Set(["twoa", "twon", "righto"]),
  );
  expect(travelled.some((v) => v.current.ChangeLaneId === "rightn")).toBe(true);
  expect(
    oracle.trace.some((row) => row.actions.includes("full-update:1")),
  ).toBe(true);
  expect(
    oracle.trace.some((row) =>
      row.events.some((e) => e.startsWith("effects-updated:")),
    ),
  ).toBe(true);
});
it("matches 160 frame-exact target/motion/four-slot/display snapshots for two vehicles", () => {
  const runtime = makeRuntime();
  for (const row of oracle.trace) {
    actions(runtime, row.frame);
    const result = runtime.stepFrame(row.frame, decide);
    expect(result.updatedIds).toEqual(row.decisions.map((d) => d.id));
    expect(result.motionIds).toEqual(row.decisions.map((d) => d.id));
    expect(
      result.events.map((e) =>
        e.type === "lane-flow"
          ? `${e.type}:${e.id}:${e.laneId}`
          : `${e.type}:${e.id}`,
      ),
    ).toEqual(row.events);
    for (const expected of row.vehicles) {
      const a = runtime.getVehicle(expected.id)!;
      close(
        v(a.state.position),
        expected.position,
        `frame ${row.frame} physical position`,
      );
      close(v(a.state.velocity), expected.velocity, "velocity");
      close(qa(a.state.rotation), expected.rotation, "rotation");
      close(v(a.navigation.targetPosition), expected.target, "target");
      close(
        [a.navigation.maxSpeed, a.odometer],
        [expected.maxSpeed, expected.odometer],
        "speed/odometer",
      );
      expect(a.navigationUpdates).toBe(expected.updates);
      expect(a.motionUpdates).toBe(expected.updates);
      expect(a.current.laneId).toBe(expected.current.LaneId);
      expect(a.current.changeLaneId ?? null).toBe(
        expected.current.ChangeLaneId,
      );
      expect(a.current.flags).toBe(expected.current.Flags);
      close(
        v(a.current.curvePosition),
        expected.current.CurvePosition,
        "cursor",
      );
      close(
        [
          a.current.changeProgress,
          a.current.lanePosition,
          a.current.duration,
          a.current.distance,
        ],
        [
          expected.current.ChangeProgress,
          expected.current.LanePosition,
          expected.current.Duration,
          expected.current.Distance,
        ],
        "lane state",
      );
      expect(a.nextLanes.map((l) => l.laneId)).toEqual(
        expected.nextLanes.map((l) => l.LaneId),
      );
      a.frames.forEach((value, i) =>
        compareFrame(value, expected.frames[i], `frame ${row.frame} slot ${i}`),
      );
      const display = runtime.displayPose(expected.id, 0.375, row.frame)!;
      close(v(display.position), expected.display.position, "display position");
      close(
        qa(display.rotation),
        expected.display.rotation,
        "display rotation",
      );
      expect(display.flags).toBe(expected.display.flags);
      expect(display.selection.frame1).toBe(expected.display.frame1);
      expect(display.selection.frame2).toBe(expected.display.frame2);
      close(
        [display.selection.position],
        [expected.display.fraction],
        "display fraction",
      );
    }
  }
});
it("matches 96 source-created/loaded/updated/editor frame-buffer cases", () => {
  expect(oracle.frameCases).toHaveLength(96);
  for (const a of oracle.frameCases) {
    const state = {
        position: p(a.state.position),
        velocity: p(a.state.velocity),
        rotation: q(a.state.rotation),
      },
      old = a.previous.map(frame),
      result =
        a.mode === "created"
          ? cs2InitializeVehicleFrames(state, "created", a.frame, a.group)
          : a.mode === "loaded"
            ? cs2InitializeVehicleFrames(state, "loaded", a.frame, a.group, old)
            : cs2ResetUpdatedVehicleFrames(
                state,
                a.frame,
                a.group,
                old,
                a.mode === "editor-updated",
              );
    result.forEach((f, i) =>
      compareFrame(f, a.output[i], `${a.mode}/${a.frame}/${a.group}/${i}`),
    );
  }
});
it("matches source least-populated update-group selection and supports explicit assignment", () => {
  for (const c of oracle.groupCases)
    expect(cs2ChooseVehicleUpdateGroup(c.populations)).toBe(c.output);
  expect(cs2ChooseVehicleUpdateGroup(Array(16).fill(0), 7)).toBe(7);
  const runtime = new Cs2VehicleRuntime(curves);
  for (let i = 0; i < 17; i++)
    runtime.addVehicle({
      ...seed(oracle.seeds[0]),
      id: i,
      updateGroup: undefined,
    });
  expect(runtime.getVehicle(0)?.updateGroup).toBe(0);
  expect(runtime.getVehicle(15)?.updateGroup).toBe(15);
  expect(runtime.getVehicle(16)?.updateGroup).toBe(0);
});
it("keeps all physical outcomes equivalent at 20/30/60/144 render FPS", () => {
  const results = [];
  for (const fps of [20, 30, 60, 144]) {
    const runtime = makeRuntime();
    for (let render = 0; render <= Math.ceil((160 / 60) * fps); render++) {
      const ticks = Math.min(159, (render * 60) / fps),
        whole = Math.floor(ticks + 1e-9);
      while (runtime.frame < whole) {
        const next = runtime.frame + 1;
        actions(runtime, next);
        runtime.stepFrame(next, decide);
      }
      for (const vehicle of runtime.allVehicles())
        runtime.displayPose(vehicle.id, Math.max(0, ticks - whole), whole);
    }
    results.push(runtime.allVehicles());
  }
  for (const result of results.slice(1)) expect(result).toEqual(results[0]);
});
it("never advances physics from display calls or duplicate source frames and never drops catch-up frames", () => {
  const runtime = makeRuntime();
  runtime.advanceToFrame(63, decide);
  const before = runtime.allVehicles();
  for (let i = 0; i < 100; i++) runtime.displayPose(1, i / 100);
  expect(runtime.allVehicles()).toEqual(before);
  const duplicate = runtime.stepFrame(63, () => {
    throw new Error("must not decide twice");
  });
  expect(duplicate.updatedIds).toEqual([]);
  expect(runtime.allVehicles()).toEqual(before);
  expect(() => runtime.stepFrame(65, decide)).toThrow("advanceToFrame");
  const rows = runtime.advanceToFrame(95, decide);
  expect(rows).toHaveLength(32);
  expect(runtime.getVehicle(1)?.motionUpdates).toBe(6);
  expect(runtime.getVehicle(2)?.motionUpdates).toBe(6);
});
it("runs all navigation before owner AI and all motion against a frame-start physical snapshot", () => {
  const seen: number[] = [],
    runtime = new Cs2VehicleRuntime(curves, {
      afterNavigation: (vehicle, context) => {
        expect(
          [...context.navigationSnapshot.values()].every(
            (v) => v.lastNavigationFrame === 0 && v.lastMotionFrame === null,
          ),
        ).toBe(true);
        return vehicle.id === 1
          ? { navigation: { ...vehicle.navigation, maxSpeed: 0 } }
          : undefined;
      },
    });
  runtime.addVehicle({ ...seed(oracle.seeds[0]), updateGroup: 0 });
  runtime.addVehicle({ ...seed(oracle.seeds[1]), updateGroup: 0 });
  runtime.stepFrame(0, (vehicle, context) => {
    seen.push(context.physicalSnapshot.get(1)!.position.z);
    vehicle.state.position.z = 999;
    return { maxSpeed: 5, random01: 0.5 };
  });
  expect(seen).toEqual([0, 0]);
  expect(runtime.physicalState(1)?.position.z).toBe(0);
  expect(runtime.physicalState(2)!.position.z).toBeGreaterThan(0);
});
it("preserves source local-navigation scratch and emits rather than auto-applies full updates", () => {
  const reverse: CS2NavigationCurve = {
    ...curves.get("onea")!,
    id: "reverse",
    points: [p([0, 0, 0]), p([0, 0, -10]), p([0, 0, -20]), p([0, 0, -30])],
    length: 30,
  };
  const runtime = new Cs2VehicleRuntime(new Map([[reverse.id, reverse]]));
  const a = seed(oracle.seeds[0]);
  a.carFlags = CS2_MOTION_CAR_FLAGS.CannotReverse;
  a.navigation.maxSpeed = -1;
  a.current.laneId = reverse.id;
  a.nextLanes = [];
  runtime.addVehicle(a);
  const result = runtime.stepFrame(0, () => ({ maxSpeed: 3, random01: 0.5 })),
    stored = runtime.getVehicle(1)!;
  expect(result.events.some((e) => e.type === "full-update-requested")).toBe(
    true,
  );
  expect(stored.fullUpdatePending).toBe(true);
  expect(stored.navigation.maxSpeed).toBe(-3);
  expect(Math.hypot(...v(stored.state.velocity))).toBeCloseTo(3, 4);
  runtime.applyFullUpdate(1, undefined, false, 1);
  const reset = runtime.getVehicle(1)!;
  expect(reset.fullUpdatePending).toBe(false);
  reset.frames.forEach((f) => {
    expect(f.flags).toBe(0);
    expect(f.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.position).toEqual(reset.state.position);
  });
});
it("does not delete at a queue window end unless the owner checks the complete path-end mask", () => {
  const owner = (flags: number) => (flags & (1 | 2 | 0x10 | 0x200)) === 3;
  for (const terminal of [false, true]) {
    const runtime = new Cs2VehicleRuntime(curves, {
        afterNavigation: (vehicle) =>
          owner(vehicle.current.flags) ? { remove: true } : undefined,
      }),
      a = seed(oracle.seeds[0]);
    a.state.position = { x: 0, y: 0, z: 12 };
    a.state.velocity = { x: 0, y: 0, z: 0 };
    a.navigation.targetPosition = { ...a.state.position };
    a.current.curvePosition = { x: 1, y: 1, z: 1 };
    a.current.flags = terminal ? 1 : 0;
    a.nextLanes = [];
    runtime.addVehicle(a);
    const result = runtime.stepFrame(0, () => ({ maxSpeed: 0, random01: 0.5 }));
    expect(runtime.size).toBe(terminal ? 0 : 1);
    if (terminal) expect(result.motionIds).toEqual([]);
    else expect(runtime.getVehicle(1)!.current.flags & 2).toBe(2);
  }
});
it("loads four provided frames using the serialization frame clock instead of treating them as already initialized", () => {
  const a = oracle.frameCases.find(
      (c) => c.mode === "loaded" && c.frame === 16 && c.group === 7,
    )!,
    runtime = new Cs2VehicleRuntime(curves),
    s = seed(oracle.seeds[0]);
  s.updateGroup = 7;
  s.state = {
    position: p(a.state.position),
    velocity: p(a.state.velocity),
    rotation: q(a.state.rotation),
  };
  s.frames = a.previous.map(frame);
  s.frameInitialization = "loaded";
  s.initializationFrame = 16;
  runtime.addVehicle(s);
  runtime
    .getVehicle(1)!
    .frames.forEach((f, i) => compareFrame(f, a.output[i], "loaded add"));
});
