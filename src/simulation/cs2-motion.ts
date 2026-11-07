/**
 * CarMoveSystem.CarMoveJob scalar/vector kernel and transform interpolation.
 * Source: supplied Game.dll SHA256
 * 721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee.
 * See docs/CS2_MOTION.md for oracle provenance and world-side boundaries.
 */
export type CS2MotionVector = { x: number; y: number; z: number };
export type CS2MotionQuaternion = CS2MotionVector & { w: number };
export type CS2MotionState = {
  position: CS2MotionVector;
  velocity: CS2MotionVector;
  rotation: CS2MotionQuaternion;
};
export type CS2MotionNavigation = {
  targetPosition: CS2MotionVector;
  maxSpeed: number;
  /** All-zero quaternion is the original "no explicit rotation" sentinel. */
  targetRotation?: CS2MotionQuaternion;
};
export type CS2MotionFrame = CS2MotionState & { flags: number };
export type CS2MotionInput = {
  state: CS2MotionState;
  navigation: CS2MotionNavigation;
  pivotOffset: number;
  carFlags?: number;
  laneFlags?: number;
  seed?: number;
  dayLightBrightness?: number;
  /** Required for Area lanes; receives a world-space target position. */
  terrainHeight?: (position: CS2MotionVector) => number;
};

export const CS2_MOTION_TIMESTEP = Math.fround(4 / 15);
export const CS2_MOTION_HALF_TIMESTEP = Math.fround(CS2_MOTION_TIMESTEP * 0.5);
export const CS2_MOTION_LANE_FLAGS = {
  TurnLeft: 0x40000,
  TurnRight: 0x80000,
  HighBeams: 0x200000,
  Connection: 0x1000000,
  ResetSpeed: 0x2000000,
  Area: 0x4000000,
  CanReverse: 0x10000000,
} as const;
export const CS2_MOTION_CAR_FLAGS = {
  Emergency: 1,
  Warning: 8,
  Sign: 0x80,
  Interior: 0x100,
  Working: 0x200,
  SignalAnimation1: 0x400,
  SignalAnimation2: 0x800,
  CannotReverse: 0x1000,
} as const;
export const CS2_MOTION_TRANSFORM_FLAGS = {
  MainLights: 1,
  ExtraLights: 2,
  TurningLeft: 4,
  TurningRight: 8,
  Braking: 0x10,
  RearLights: 0x20,
  InteriorLights: 0x100,
  WarningLights: 0x400,
  Reversing: 0x800,
  WorkLights: 0x1000,
  SignalAnimation1: 0x2000,
  SignalAnimation2: 0x4000,
} as const;

const f = Math.fround;
const tiny = f(1.1754944e-38);
const zero = (): CS2MotionVector => ({ x: 0, y: 0, z: 0 });
const identity = (): CS2MotionQuaternion => ({ x: 0, y: 0, z: 0, w: 1 });
const copy = (v: CS2MotionVector): CS2MotionVector => ({
  x: f(v.x),
  y: f(v.y),
  z: f(v.z),
});
const qcopy = (q: CS2MotionQuaternion): CS2MotionQuaternion => ({
  ...copy(q),
  w: f(q.w),
});
const add = (a: CS2MotionVector, b: CS2MotionVector): CS2MotionVector => ({
  x: f(a.x + b.x),
  y: f(a.y + b.y),
  z: f(a.z + b.z),
});
const sub = (a: CS2MotionVector, b: CS2MotionVector): CS2MotionVector => ({
  x: f(a.x - b.x),
  y: f(a.y - b.y),
  z: f(a.z - b.z),
});
const mul = (v: CS2MotionVector, s: number): CS2MotionVector => ({
  x: f(v.x * s),
  y: f(v.y * s),
  z: f(v.z * s),
});
const dot = (a: CS2MotionVector, b: CS2MotionVector) =>
  f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z));
const cross = (a: CS2MotionVector, b: CS2MotionVector): CS2MotionVector => ({
  x: f(f(a.y * b.z) - f(a.z * b.y)),
  y: f(f(a.z * b.x) - f(a.x * b.z)),
  z: f(f(a.x * b.y) - f(a.y * b.x)),
});
const magnitude = (v: CS2MotionVector) => f(Math.sqrt(dot(v, v)));
const distance = (a: CS2MotionVector, b: CS2MotionVector) =>
  magnitude(sub(a, b));
const saturate = (v: number) => Math.max(0, Math.min(1, v));
const normalize = (v: CS2MotionVector, newLength = 1): CS2MotionVector => {
  const squared = dot(v, v);
  return squared > tiny
    ? mul(v, f(newLength * f(1 / f(Math.sqrt(squared)))))
    : zero();
};
const horizontalNormalize = (v: CS2MotionVector): CS2MotionVector => {
  const squared = f(f(v.x * v.x) + f(v.z * v.z));
  return squared > tiny ? mul(v, f(1 / f(Math.sqrt(squared)))) : zero();
};
const rotate = (q: CS2MotionQuaternion, v: CS2MotionVector) => {
  const t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q.w)), cross(q, t));
};

const bitBuffer = new ArrayBuffer(4);
const bitFloat = new Float32Array(bitBuffer);
const bitUint = new Uint32Array(bitBuffer);
const asUint = (value: number) => {
  bitFloat[0] = value;
  return bitUint[0];
};
const asFloat = (value: number) => {
  bitUint[0] = value;
  return bitFloat[0];
};
const qnormalize = (q: CS2MotionQuaternion): CS2MotionQuaternion => {
  const squared = f(
      f(f(f(q.x * q.x) + f(q.y * q.y)) + f(q.z * q.z)) + f(q.w * q.w),
    ),
    scale = f(1 / f(Math.sqrt(squared)));
  return { ...mul(q, scale), w: f(q.w * scale) };
};

/** Unity quaternion(float3x3), retaining its sign-selection convention. */
const matrixQuaternion = (
  a: CS2MotionVector,
  b: CS2MotionVector,
  c: CS2MotionVector,
): CS2MotionQuaternion => {
  const sign = asUint(a.x) & 0x80000000,
    x = f(b.y + asFloat(asUint(c.z) ^ sign)),
    mask1 = sign ? 0xffffffff : 0,
    mask2 = asUint(x) & 0x80000000 ? 0xffffffff : 0,
    flips = [0, 0x80000000, 0x80000000, 0x80000000].map(
      (v, i) =>
        v ^
        (mask1 & [0, 0x80000000, 0, 0x80000000][i]) ^
        (mask2 & [0x80000000, 0x80000000, 0x80000000, 0][i]),
    ),
    left = [f(1 + Math.abs(a.x)), a.y, c.x, b.z],
    right = [x, b.x, a.z, c.y];
  let value = left.map((v, i) => f(v + asFloat(asUint(right[i]) ^ flips[i])));
  if (mask1) value = [value[2], value[3], value[0], value[1]];
  if (!mask2) value = [value[3], value[2], value[1], value[0]];
  return qnormalize({ x: value[0], y: value[1], z: value[2], w: value[3] });
};

/** Unity quaternion.LookRotation for the already normalized source road tangent. */
export function cs2LookRotation(
  forward: CS2MotionVector,
  up: CS2MotionVector = { x: 0, y: 1, z: 0 },
) {
  const c = cross(up, forward);
  const right = mul(c, f(1 / f(Math.sqrt(dot(c, c)))));
  return matrixQuaternion(right, cross(forward, right), forward);
}

/** Unity quaternion.LookRotationSafe, world up is supplied by the original job. */
export function cs2LookRotationSafe(
  forward: CS2MotionVector,
  up: CS2MotionVector = { x: 0, y: 1, z: 0 },
) {
  forward = copy(forward);
  up = copy(up);
  const x = dot(forward, forward),
    y = dot(up, up),
    a = mul(forward, f(1 / f(Math.sqrt(x)))),
    b = mul(up, f(1 / f(Math.sqrt(y)))),
    c = cross(b, a),
    z = dot(c, c);
  if (
    !(Math.min(x, y, z) > f(1e-35) && Math.max(x, y, z) < f(1e35)) ||
    !Number.isFinite(x + y + z)
  )
    return identity();
  const right = mul(c, f(1 / f(Math.sqrt(z))));
  return matrixQuaternion(right, cross(a, right), a);
}

const randomLightFloat = (seed: number) => {
  let state = Math.max(1, (seed & 0xffff) ^ 2545) >>> 0;
  const next = () => {
    const old = state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return old;
  };
  next();
  next();
  next();
  const unit = f((next() >>> 9) / 8388608);
  return f(f(unit * f(0.1)) + f(-0.05));
};

/** One original 4/15-second CarMoveJob update; this is not a per-render-frame API. */
export function cs2MoveCar(input: CS2MotionInput) {
  const laneFlags = input.laneFlags ?? 0,
    carFlags = input.carFlags ?? 0,
    lane = CS2_MOTION_LANE_FLAGS,
    car = CS2_MOTION_CAR_FLAGS,
    light = CS2_MOTION_TRANSFORM_FLAGS,
    position = copy(input.state.position),
    oldVelocity = copy(input.state.velocity),
    oldRotation = qcopy(input.state.rotation),
    pivot = f(input.pivotOffset),
    targetRotation = qcopy(
      input.navigation.targetRotation ?? { x: 0, y: 0, z: 0, w: 0 },
    );
  let targetPosition = copy(input.navigation.targetPosition),
    maxSpeed = f(input.navigation.maxSpeed),
    desired = sub(targetPosition, position),
    reversing = asUint(maxSpeed) >>> 31 !== 0;
  const explicitRotation =
      targetRotation.x !== 0 ||
      targetRotation.y !== 0 ||
      targetRotation.z !== 0 ||
      targetRotation.w !== 0,
    speed = Math.abs(maxSpeed),
    area = (laneFlags & lane.Area) !== 0;
  let forceFullUpdate = false;
  if (reversing && (carFlags & car.CannotReverse) !== 0) {
    reversing = false;
    maxSpeed = 0;
    forceFullUpdate = true;
    // `speed` was read before this branch in the original job, intentionally.
  }
  const terrain = (point: CS2MotionVector) => {
    if (!input.terrainHeight)
      throw new Error("CS2 Area motion requires a terrainHeight sampler");
    return f(input.terrainHeight(point));
  };
  if (area) {
    if (!reversing) {
      const maxLength = f(Math.max(1, speed) + Math.max(0, pivot)),
        squared = f(f(desired.x * desired.x) + f(desired.z * desired.z));
      if (squared > f(maxLength * maxLength)) {
        const scale = f(maxLength * f(1 / f(Math.sqrt(squared))));
        desired.x = f(desired.x * scale);
        desired.z = f(desired.z * scale);
      }
      targetPosition.x = f(position.x + desired.x);
      targetPosition.z = f(position.z + desired.z);
    }
    targetPosition.y = terrain(targetPosition);
    desired.y = f(targetPosition.y - position.y);
  }
  desired = normalize(desired, speed);
  let velocity: CS2MotionVector;
  if (
    (laneFlags & (lane.Connection | lane.ResetSpeed)) !== 0 ||
    explicitRotation
  ) {
    velocity = desired;
  } else {
    const right = rotate(oldRotation, { x: 1, y: 0, z: 0 }),
      up = rotate(oldRotation, { x: 0, y: 1, z: 0 }),
      forward = rotate(oldRotation, { x: 0, y: 0, z: 1 }),
      local = {
        x: dot(right, desired),
        y: dot(up, desired),
        z: dot(forward, desired),
      },
      proximity = saturate(
        f(distance(targetPosition, position) - Math.min(1, Math.abs(pivot))),
      );
    if (reversing) {
      const facing = dot(forward, normalize(desired)),
        smooth = saturate(f(f(facing + 1) / f(f(-0.9) + 1))),
        reverseFactor =
          (laneFlags & lane.CanReverse) === 0
            ? 1
            : f(f(smooth * smooth) * f(3 - f(2 * smooth))),
        normalized = horizontalNormalize(local);
      local.x = f(f(f(f(1.5 * reverseFactor) * proximity) * local.x));
      local.z = f(
        proximity * f(f(Math.max(0, local.z) + 1) + Math.max(1, f(pivot * -4))),
      );
      local.y = f(
        normalized.y * f(f(local.x * normalized.x) + f(local.z * normalized.z)),
      );
      desired = sub(
        desired,
        add(add(mul(right, local.x), mul(up, local.y)), mul(forward, local.z)),
      );
      if (area) {
        targetPosition.x = f(position.x + desired.x);
        targetPosition.z = f(position.z + desired.z);
        targetPosition.y = terrain(targetPosition);
        desired.y = f(targetPosition.y - position.y);
      }
      velocity = add(mul(desired, 8), oldVelocity);
      if (dot(desired, forward) < 0) desired = mul(desired, -1);
      targetPosition = add(position, desired);
    } else {
      const horizontal = horizontalNormalize({ x: local.x, y: 0, z: local.z }),
        angle = f(Math.acos(horizontal.z)),
        maxAngle = f(f(speed * CS2_MOTION_TIMESTEP) / Math.max(1, -pivot));
      if (angle > maxAngle) {
        const normalized = horizontalNormalize(local);
        local.x = f(f(Math.sin(f(maxAngle * Math.sign(local.x)))) - local.x);
        local.z = f(f(Math.cos(maxAngle)) - local.z);
        local.x = f(local.x * proximity);
        local.z = f(local.z * proximity);
        local.y = f(
          normalized.y *
            f(f(local.x * normalized.x) + f(local.z * normalized.z)),
        );
        desired = add(
          desired,
          add(
            add(mul(right, local.x), mul(up, local.y)),
            mul(forward, local.z),
          ),
        );
        if (area) {
          targetPosition.x = f(position.x + desired.x);
          targetPosition.z = f(position.z + desired.z);
          targetPosition.y = terrain(targetPosition);
          desired.y = f(targetPosition.y - position.y);
        }
      }
      velocity = add(mul(desired, 8), oldVelocity);
      targetPosition = add(position, desired);
    }
  }
  velocity = normalize(velocity, speed);
  const oldSpeed = magnitude(oldVelocity),
    newSpeed = magnitude(velocity),
    halfDisplacement = mul(velocity, CS2_MOTION_HALF_TIMESTEP),
    framePosition = add(position, halfDisplacement);
  let frameRotation = oldRotation,
    rotation = oldRotation;
  if (explicitRotation) {
    frameRotation = targetRotation;
    rotation = targetRotation;
  } else if (newSpeed > f(0.01)) {
    const offset = { x: 0, y: 0, z: Math.min(0, pivot) };
    let direction = sub(
      targetPosition,
      add(position, rotate(oldRotation, offset)),
    );
    if (dot(direction, direction) > tiny) {
      frameRotation = cs2LookRotationSafe(normalize(direction));
      rotation = frameRotation;
    }
    direction = sub(
      targetPosition,
      add(framePosition, rotate(frameRotation, offset)),
    );
    if (dot(direction, direction) > tiny)
      rotation = cs2LookRotationSafe(normalize(direction));
  }
  let flags: number = light.RearLights;
  const brightness = f(
    f(input.dayLightBrightness ?? 1) + randomLightFloat(input.seed ?? 0),
  );
  if (brightness < 0.5)
    flags |=
      brightness < 0.25 && (laneFlags & lane.HighBeams) !== 0
        ? light.ExtraLights
        : light.MainLights;
  const brakingThreshold = f(
    f(oldSpeed * f(1 - f(CS2_MOTION_TIMESTEP / f(1 + oldSpeed)))) +
      f(f(0.1) * CS2_MOTION_TIMESTEP),
  );
  if (newSpeed <= brakingThreshold) flags |= light.Braking;
  if (reversing) flags |= light.Reversing;
  else {
    if ((laneFlags & lane.TurnLeft) !== 0) flags |= light.TurningLeft;
    if ((laneFlags & lane.TurnRight) !== 0) flags |= light.TurningRight;
  }
  if ((carFlags & (car.Emergency | car.Warning)) !== 0)
    flags |= light.WarningLights;
  if ((carFlags & (car.Sign | car.Working)) !== 0) flags |= light.WorkLights;
  if ((carFlags & car.Interior) !== 0) flags |= light.InteriorLights;
  if ((carFlags & car.SignalAnimation1) !== 0) flags |= light.SignalAnimation1;
  if ((carFlags & car.SignalAnimation2) !== 0) flags |= light.SignalAnimation2;
  return {
    state: {
      position: add(framePosition, halfDisplacement),
      velocity: copy(velocity),
      rotation: qcopy(rotation),
    },
    // The original Navigation component is read-only; only this local copy changes.
    localNavigation: {
      targetPosition: copy(targetPosition),
      maxSpeed,
      targetRotation: qcopy(targetRotation),
    },
    frame: {
      position: copy(framePosition),
      velocity: copy(velocity),
      rotation: qcopy(frameRotation),
      flags,
    },
    forceFullUpdate,
  };
}

/** CarMoveSystem.OnUpdate: update one of sixteen vehicle groups per 60Hz frame. */
export function cs2MotionSchedule(
  simulationFrame: number,
  updateGroup: number,
) {
  const frame = simulationFrame >>> 0;
  return {
    eligible: (frame & 15) === updateGroup,
    updateGroup: frame & 15,
    transformFrameIndex: (frame >>> 4) & 3,
  };
}

/** ObjectInterpolateSystem.CalculateUpdateFrames, including uint wraparound. */
export function cs2InterpolationFrames(
  simulationFrame: number,
  frameTime: number,
  updateGroup: number,
  previousSimulationFrame?: number,
) {
  const shifted = ((simulationFrame >>> 0) - (updateGroup >>> 0) - 32) >>> 0,
    block = shifted >>> 4,
    previousBlock =
      previousSimulationFrame === undefined
        ? block
        : (((previousSimulationFrame >>> 0) - (updateGroup >>> 0) - 32) >>>
            0) >>>
          4,
    frame1 = block & 3;
  return {
    frame1,
    frame2: (frame1 + 1) & 3,
    position: f(f((shifted & 15) + f(frameTime)) * f(0.0625)),
    changed: block === previousBlock ? 0 : block > previousBlock ? 1 : -1,
  };
}

const slerp = (
  a: CS2MotionQuaternion,
  b: CS2MotionQuaternion,
  t: number,
): CS2MotionQuaternion => {
  let d = f(dot(a, b) + f(a.w * b.w));
  if (d < 0) {
    d = -d;
    b = { ...mul(b, -1), w: -b.w };
  }
  if (d < f(0.9995)) {
    const angle = f(Math.acos(d)),
      scale = f(1 / f(Math.sqrt(f(1 - f(d * d))))),
      x = f(f(Math.sin(f(angle * f(1 - t)))) * scale),
      y = f(f(Math.sin(f(angle * t))) * scale);
    return { ...add(mul(a, x), mul(b, y)), w: f(f(a.w * x) + f(b.w * y)) };
  }
  return qnormalize({
    ...add(a, mul(sub(b, a), t)),
    w: f(a.w + f(t * f(b.w - a.w))),
  });
};

/** Original cubic Hermite-equivalent rendering path; t is not clamped. */
export function cs2InterpolateTransform(
  a: CS2MotionFrame,
  b: CS2MotionFrame,
  framePosition: number,
) {
  a = {
    position: copy(a.position),
    velocity: copy(a.velocity),
    rotation: qcopy(a.rotation),
    flags: a.flags,
  };
  b = {
    position: copy(b.position),
    velocity: copy(b.velocity),
    rotation: qcopy(b.rotation),
    flags: b.flags,
  };
  const t = f(framePosition),
    u = f(1 - t),
    p1 = add(a.position, mul(a.velocity, f(4 / 45))),
    p2 = sub(b.position, mul(b.velocity, f(4 / 45))),
    w0 = f(f(u * u) * u),
    w1 = f(f(f(3 * t) * u) * u),
    w2 = f(f(f(3 * t) * t) * u),
    w3 = f(f(t * t) * t);
  return {
    position: add(
      add(add(mul(a.position, w0), mul(p1, w1)), mul(p2, w2)),
      mul(b.position, w3),
    ),
    rotation: slerp(a.rotation, b.rotation, t),
    flags: t >= 0.5 ? b.flags : a.flags,
  };
}

/** Original aggregate light-effects invalidation, separated from ECS commands. */
export function cs2MotionEffectsChanged(
  previousFlags: readonly number[],
  frameIndex: number,
  nextFlags: number,
) {
  const mask =
    CS2_MOTION_TRANSFORM_FLAGS.MainLights |
    CS2_MOTION_TRANSFORM_FLAGS.ExtraLights |
    CS2_MOTION_TRANSFORM_FLAGS.WarningLights |
    CS2_MOTION_TRANSFORM_FLAGS.WorkLights;
  if ((((previousFlags[frameIndex] ?? 0) ^ nextFlags) & mask) === 0)
    return false;
  let before = 0,
    after = 0;
  previousFlags.forEach((flags, i) => {
    before |= flags;
    after |= i === frameIndex ? nextFlags : flags;
  });
  return ((before ^ after) & mask) !== 0;
}

export type CS2TrailerInput = {
  tractor: CS2MotionState;
  trailer: CS2MotionState;
  tractorAttachPosition: CS2MotionVector;
  trailerAttachPosition: CS2MotionVector;
  pivotOffset: number;
  movementType: "free" | "locked" | "other";
  unspawned?: boolean;
  /** Original head tractor's frame flags, including for later chain elements. */
  tractorFrameFlags: number;
};

/** CarTrailerMoveSystem.CarTrailerMoveJob, one joint of its ordered layout. */
export function cs2MoveTrailer(input: CS2TrailerInput) {
  const tractorPosition = copy(input.tractor.position),
    tractorVelocity = copy(input.tractor.velocity),
    tractorRotation = qcopy(input.tractor.rotation),
    previousPosition = copy(input.trailer.position),
    previousVelocity = copy(input.trailer.velocity),
    previousRotation = qcopy(input.trailer.rotation),
    tractorAttach = copy(input.tractorAttachPosition),
    trailerAttach = copy(input.trailerAttachPosition);
  let position = previousPosition,
    rotation = previousRotation;
  if (input.unspawned) {
    rotation = tractorRotation;
    position = sub(
      add(tractorPosition, rotate(tractorRotation, tractorAttach)),
      rotate(tractorRotation, trailerAttach),
    );
  } else if (input.movementType === "free") {
    const joint = add(tractorPosition, rotate(tractorRotation, tractorAttach)),
      pivot = add(
        previousPosition,
        rotate(previousRotation, {
          x: trailerAttach.x,
          y: trailerAttach.y,
          z: f(input.pivotOffset),
        }),
      );
    let direction = sub(joint, pivot);
    direction = add(
      direction,
      mul(tractorVelocity, f(CS2_MOTION_TIMESTEP * 0.25)),
    );
    direction = sub(direction, mul(previousVelocity, CS2_MOTION_HALF_TIMESTEP));
    rotation = tractorRotation;
    if (dot(direction, direction) > tiny)
      rotation = cs2LookRotationSafe(normalize(direction));
    position = sub(joint, rotate(rotation, trailerAttach));
  } else if (input.movementType === "locked") {
    rotation = tractorRotation;
    // Original uses the old trailer rotation for this offset, unlike Unspawned.
    position = sub(
      add(tractorPosition, rotate(tractorRotation, tractorAttach)),
      rotate(previousRotation, trailerAttach),
    );
  }
  const displacement = sub(position, previousPosition),
    velocity = {
      x: f(displacement.x / CS2_MOTION_TIMESTEP),
      y: f(displacement.y / CS2_MOTION_TIMESTEP),
      z: f(displacement.z / CS2_MOTION_TIMESTEP),
    };
  return {
    state: {
      position: copy(position),
      velocity: copy(velocity),
      rotation: qcopy(rotation),
    },
    frame: {
      position: mul(add(previousPosition, position), 0.5),
      velocity: copy(velocity),
      rotation: slerp(previousRotation, rotation, 0.5),
      flags: input.tractorFrameFlags,
    },
  };
}

/** The same original vector operations are used by lane connection generation. */
export {
  rotate as cs2RotateMotionVector,
  horizontalNormalize as cs2NormalizeMotionHorizontal,
};
