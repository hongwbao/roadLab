import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2_MOTION_CAR_FLAGS,
  CS2_MOTION_LANE_FLAGS,
  CS2_MOTION_TIMESTEP,
  CS2_MOTION_TRANSFORM_FLAGS,
  cs2InterpolateTransform,
  cs2InterpolationFrames,
  cs2LookRotationSafe,
  cs2MotionEffectsChanged,
  cs2MotionSchedule,
  cs2MoveCar,
  cs2MoveTrailer,
  type CS2MotionFrame,
  type CS2MotionInput,
  type CS2MotionQuaternion,
  type CS2MotionState,
  type CS2MotionVector,
} from "../src/simulation/cs2-motion";

type SourceInput = {
  Position: number[];
  Velocity: number[];
  Rotation: number[];
  TargetPosition: number[];
  TargetRotation: number[];
  MaxSpeed: number;
  PivotOffset: number;
  LaneFlags: number;
  CarFlags: number;
  Seed: number;
  DayLightBrightness: number;
  TerrainPlane: number[];
};
type SourceOutput = {
  Position: number[];
  Velocity: number[];
  Rotation: number[];
  TargetPosition: number[];
  MaxSpeed: number;
  FramePosition: number[];
  FrameVelocity: number[];
  FrameRotation: number[];
  FrameFlags: number;
  ForceFullUpdate: boolean;
};
type SourceCase = { input: SourceInput; output: SourceOutput };
type FrameInput = {
  Position: number[];
  Velocity: number[];
  Rotation: number[];
  Flags: number;
};
type TrailerSourceInput = {
  TractorPosition: number[];
  TractorVelocity: number[];
  TractorRotation: number[];
  Position: number[];
  Velocity: number[];
  Rotation: number[];
  TractorAttach: number[];
  TrailerAttach: number[];
  PivotOffset: number;
  MovementType: number;
  Unspawned: boolean;
  TractorFrameFlags: number;
};
type Oracle = {
  source: {
    game_sha256: string;
    motion: string;
    motionExtraction: {
      classification: string;
      original_fragment_sha256: string;
    };
  };
  motionCases: SourceCase[];
  traces: { name: string; steps: SourceCase[] }[];
  frameCases: {
    frame: number;
    group: number;
    fraction: number;
    previous: number;
    frame1: number;
    frame2: number;
    position: number;
    changed: number;
  }[];
  interpolationCases: {
    a: FrameInput;
    b: FrameInput;
    t: number;
    position: number[];
    rotation: number[];
    flags: number;
  }[];
  trailerCases: {
    input: TrailerSourceInput;
    output: Omit<
      SourceOutput,
      "TargetPosition" | "MaxSpeed" | "ForceFullUpdate"
    >;
  }[];
};
const oracle: Oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-motion-oracle.json", import.meta.url),
    "utf8",
  ),
);
const point = (a: number[]): CS2MotionVector => ({ x: a[0], y: a[1], z: a[2] });
const rotation = (a: number[]): CS2MotionQuaternion => ({
  ...point(a),
  w: a[3],
});
const vectorValues = (a: CS2MotionVector) => [a.x, a.y, a.z];
const quaternionValues = (a: CS2MotionQuaternion) => [...vectorValues(a), a.w];
const input = (a: SourceInput): CS2MotionInput => ({
  state: {
    position: point(a.Position),
    velocity: point(a.Velocity),
    rotation: rotation(a.Rotation),
  },
  navigation: {
    targetPosition: point(a.TargetPosition),
    maxSpeed: a.MaxSpeed,
    targetRotation: rotation(a.TargetRotation),
  },
  pivotOffset: a.PivotOffset,
  carFlags: a.CarFlags,
  laneFlags: a.LaneFlags,
  seed: a.Seed,
  dayLightBrightness: a.DayLightBrightness,
  terrainHeight: (p) =>
    Math.fround(
      Math.fround(
        Math.fround(a.TerrainPlane[0]) +
          Math.fround(p.x * Math.fround(a.TerrainPlane[1])),
      ) + Math.fround(p.z * Math.fround(a.TerrainPlane[2])),
    ),
});
const frame = (a: FrameInput): CS2MotionFrame => ({
  position: point(a.Position),
  velocity: point(a.Velocity),
  rotation: rotation(a.Rotation),
  flags: a.Flags,
});
function close(actual: number[], expected: number[], context: string) {
  actual.forEach((value, i) =>
    expect(
      Math.abs(value - expected[i]),
      `${context}[${i}]: ${value} vs ${expected[i]}`,
    ).toBeLessThan(0.00003 + Math.abs(expected[i]) * 0.000002),
  );
}
function compare(
  actual: ReturnType<typeof cs2MoveCar>,
  expected: SourceOutput,
  context: string,
) {
  close(
    vectorValues(actual.state.position),
    expected.Position,
    context + " position",
  );
  close(
    vectorValues(actual.state.velocity),
    expected.Velocity,
    context + " velocity",
  );
  close(
    quaternionValues(actual.state.rotation),
    expected.Rotation,
    context + " rotation",
  );
  close(
    vectorValues(actual.localNavigation.targetPosition),
    expected.TargetPosition,
    context + " target",
  );
  close(
    [actual.localNavigation.maxSpeed],
    [expected.MaxSpeed],
    context + " maximum speed",
  );
  close(
    vectorValues(actual.frame.position),
    expected.FramePosition,
    context + " frame position",
  );
  close(
    vectorValues(actual.frame.velocity),
    expected.FrameVelocity,
    context + " frame velocity",
  );
  close(
    quaternionValues(actual.frame.rotation),
    expected.FrameRotation,
    context + " frame rotation",
  );
  expect(actual.frame.flags, context + " frame flags").toBe(
    expected.FrameFlags,
  );
  expect(actual.forceFullUpdate, context + " update request").toBe(
    expected.ForceFullUpdate,
  );
}

describe("source-extracted CarMoveJob kernel", () => {
  it("keeps source extraction provenance separate from original job execution", () => {
    expect(oracle.source.game_sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.motion).toContain("not original ECS job execution");
    expect(oracle.source.motionExtraction.classification).toContain(
      "source-extracted",
    );
    expect(oracle.source.motionExtraction.original_fragment_sha256).toBe(
      "6c4a86760e3ab422ce3bc6e75ff9a1bc63cd91abfc6a41124d5e1421744f301c",
    );
    expect(oracle.motionCases).toHaveLength(110);
    expect(oracle.traces).toHaveLength(5);
  });
  it("matches 110 C# source-kernel cases including flags, reversal, pivots and terrain", () => {
    oracle.motionCases.forEach((test, i) =>
      compare(cs2MoveCar(input(test.input)), test.output, `case ${i}`),
    );
  });
  for (const trace of oracle.traces) {
    it(`matches the 32-step ${trace.name} source-kernel trace`, () => {
      let state: CS2MotionState | undefined;
      trace.steps.forEach((test, i) => {
        const current = input(test.input);
        if (state) current.state = state;
        const actual = cs2MoveCar(current);
        compare(actual, test.output, `${trace.name} step ${i}`);
        state = actual.state;
      });
    });
  }
});

describe("direct original DLL interpolation methods", () => {
  it("matches 81 frame selections including uint wraparound and group offsets", () => {
    expect(oracle.frameCases).toHaveLength(81);
    for (const test of oracle.frameCases) {
      const result = cs2InterpolationFrames(
        test.frame,
        test.fraction,
        test.group,
        test.previous,
      );
      expect(result.frame1).toBe(test.frame1);
      expect(result.frame2).toBe(test.frame2);
      expect(result.changed).toBe(test.changed);
      close([result.position], [test.position], "frame fraction");
    }
  });
  it("matches original cubic position, quaternion slerp and light selection", () => {
    expect(oracle.interpolationCases).toHaveLength(40);
    for (const test of oracle.interpolationCases) {
      const actual = cs2InterpolateTransform(
        frame(test.a),
        frame(test.b),
        test.t,
      );
      close(
        vectorValues(actual.position),
        test.position,
        `interpolation ${test.t}`,
      );
      close(
        quaternionValues(actual.rotation),
        test.rotation,
        `rotation ${test.t}`,
      );
      expect(actual.flags).toBe(test.flags);
    }
  });
});

it("updates exactly one vehicle group per 60Hz frame and cycles four transform slots", () => {
  for (let frameIndex = 0; frameIndex < 128; frameIndex++) {
    const eligible = Array.from({ length: 16 }, (_, group) =>
      cs2MotionSchedule(frameIndex, group),
    ).filter((s) => s.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].updateGroup).toBe(frameIndex & 15);
    expect(eligible[0].transformFrameIndex).toBe((frameIndex >>> 4) & 3);
  }
  expect(CS2_MOTION_TIMESTEP).toBe(Math.fround(16 / 60));
});

it("preserves the source CannotReverse request and negative-zero sign bit", () => {
  const current = input(oracle.motionCases[0].input);
  current.navigation.maxSpeed = -0;
  current.carFlags = CS2_MOTION_CAR_FLAGS.CannotReverse;
  const stopped = cs2MoveCar(current);
  expect(stopped.forceFullUpdate).toBe(true);
  expect(stopped.localNavigation.maxSpeed).toBe(0);
  expect(stopped.frame.flags & CS2_MOTION_TRANSFORM_FLAGS.Reversing).toBe(0);
  current.navigation.maxSpeed = -4;
  const pending = cs2MoveCar(current);
  expect(pending.forceFullUpdate).toBe(true);
  expect(pending.localNavigation.maxSpeed).toBe(0);
  expect(Math.hypot(...vectorValues(pending.state.velocity))).toBeCloseTo(4, 4);
});

it("requires actual terrain access for Area and leaves the caller's state intact", () => {
  const current = input(oracle.motionCases[0].input),
    before = structuredClone(current.state),
    beforeNavigation = structuredClone(current.navigation);
  cs2MoveCar(current);
  expect(current.state).toEqual(before);
  expect(current.navigation).toEqual(beforeNavigation);
  current.laneFlags = CS2_MOTION_LANE_FLAGS.Area;
  current.terrainHeight = undefined;
  expect(() => cs2MoveCar(current)).toThrow("terrainHeight");
});

it("matches 36 extracted trailer-joint cases including Free, Locked and Unspawned", () => {
  expect(oracle.trailerCases).toHaveLength(36);
  oracle.trailerCases.forEach(({ input: a, output: expected }, i) => {
    const actual = cs2MoveTrailer({
      tractor: {
        position: point(a.TractorPosition),
        velocity: point(a.TractorVelocity),
        rotation: rotation(a.TractorRotation),
      },
      trailer: {
        position: point(a.Position),
        velocity: point(a.Velocity),
        rotation: rotation(a.Rotation),
      },
      tractorAttachPosition: point(a.TractorAttach),
      trailerAttachPosition: point(a.TrailerAttach),
      pivotOffset: a.PivotOffset,
      movementType:
        a.MovementType === 0
          ? "free"
          : a.MovementType === 1
            ? "locked"
            : "other",
      unspawned: a.Unspawned,
      tractorFrameFlags: a.TractorFrameFlags,
    });
    close(
      vectorValues(actual.state.position),
      expected.Position,
      `trailer ${i} position`,
    );
    close(
      vectorValues(actual.state.velocity),
      expected.Velocity,
      `trailer ${i} velocity`,
    );
    close(
      quaternionValues(actual.state.rotation),
      expected.Rotation,
      `trailer ${i} rotation`,
    );
    close(
      vectorValues(actual.frame.position),
      expected.FramePosition,
      `trailer ${i} frame position`,
    );
    close(
      vectorValues(actual.frame.velocity),
      expected.FrameVelocity,
      `trailer ${i} frame velocity`,
    );
    close(
      quaternionValues(actual.frame.rotation),
      expected.FrameRotation,
      `trailer ${i} frame rotation`,
    );
    expect(actual.frame.flags).toBe(expected.FrameFlags);
  });
});

it("uses safe identity rotations for zero and vertical look directions", () => {
  expect(cs2LookRotationSafe({ x: 0, y: 0, z: 0 })).toEqual({
    x: 0,
    y: 0,
    z: 0,
    w: 1,
  });
  expect(cs2LookRotationSafe({ x: 0, y: 1, z: 0 })).toEqual({
    x: 0,
    y: 0,
    z: 0,
    w: 1,
  });
});

it("keeps transform-frame values independent of mutable future simulation state", () => {
  const current = input(oracle.motionCases[0].input);
  current.navigation.targetRotation = { x: 0, y: 0, z: 0, w: 1 };
  const result = cs2MoveCar(current),
    frameBefore = structuredClone(result.frame),
    navigationBefore = structuredClone(result.localNavigation);
  result.state.position.x += 10;
  result.state.velocity.z = 50;
  result.state.rotation.w = 0;
  expect(result.frame).toEqual(frameBefore);
  expect(result.localNavigation).toEqual(navigationBefore);
});

it("requests effects updates only when aggregate main effects change", () => {
  const { MainLights, RearLights, WarningLights } = CS2_MOTION_TRANSFORM_FLAGS;
  expect(
    cs2MotionEffectsChanged(
      [RearLights, RearLights, RearLights, RearLights],
      0,
      RearLights | MainLights,
    ),
  ).toBe(true);
  expect(cs2MotionEffectsChanged([MainLights, MainLights, 0, 0], 0, 0)).toBe(
    false,
  );
  expect(cs2MotionEffectsChanged([MainLights, 0, 0, 0], 0, 0)).toBe(true);
  expect(cs2MotionEffectsChanged([0, 0, 0, 0], 0, RearLights)).toBe(false);
  expect(cs2MotionEffectsChanged([0, 0, 0, 0], 3, WarningLights)).toBe(true);
});
