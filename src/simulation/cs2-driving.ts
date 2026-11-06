/**
 * Scalar car navigation recovered from the user-supplied Game.dll.
 * Source identity: SHA256 721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee,
 * MVID 36b776ac-5007-4e06-81b3-242b2abfd5b6. See docs/CS2_DRIVING.md.
 * Distances are metres, times seconds, speeds m/s and turning values radians.
 */
export type CS2CarData = {
  maxSpeed: number;
  acceleration: number;
  braking: number;
  turningX: number;
  turningY: number;
};

const f = Math.fround;
const clamp = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x));

/** CarNavigationSystem.UpdateNavigationTarget: fixed navigation horizon. */
export const CS2_NAVIGATION_TIMESTEP = f(4 / 15);

/**
 * CarBasePrefab's class defaults after VehicleInitializeSystem unit conversion.
 * These are source defaults; concrete shipped vehicle assets may override them.
 */
export const CS2_BASE_CAR: Readonly<CS2CarData> = Object.freeze({
  maxSpeed: f(f(200) / f(3.6)),
  acceleration: 5,
  braking: 10,
  turningX: f(Math.PI / 2),
  turningY: f(Math.PI / 12),
});

/** VehicleUtils.GetMaxDriveSpeed(CarData, float, float). */
export function cs2MaxDriveSpeed(
  car: CS2CarData,
  speedLimit: number,
  curviness: number,
) {
  const top = f(f(car.turningX) * f(car.maxSpeed));
  const bottom = Math.max(
    f(1e-6),
    f(f(f(curviness) * f(car.maxSpeed)) + f(car.turningX) - f(car.turningY)),
  );
  return Math.min(f(speedLimit), Math.max(1, f(top / bottom)));
}

/** VehicleUtils.GetMaxBrakingSpeed, both float overloads. */
export function cs2MaxBrakingSpeed(
  car: CS2CarData,
  distance: number,
  timeStep: number,
  resultSpeed = 0,
) {
  const b = f(car.braking),
    reaction = f(f(timeStep) * b),
    squared = f(
      f(f(reaction * reaction) + f(f(2 * b) * f(distance))) +
        f(f(resultSpeed) * f(resultSpeed)),
    );
  return Math.max(0, f(f(Math.sqrt(Math.max(0, squared))) - reaction));
}

/** VehicleUtils.GetBrakingDistance(CarData, float, float). */
export function cs2BrakingDistance(
  car: CS2CarData,
  speed: number,
  timeStep: number,
) {
  const v = f(speed);
  return f(f(f(f(0.5 * v) * v) / f(car.braking)) + f(v * f(timeStep)));
}

/** Colossal.Mathematics.MathUtils.InverseSmoothStep(float, float, float). */
export function cs2InverseSmoothStep(a: number, b: number, x: number) {
  const t = clamp(f(f(f(x) - f(a)) / f(f(b) - f(a))), 0, 1);
  return f(0.5 - f(Math.sin(f(f(Math.asin(f(1 - f(2 * t)))) * f(1 / 3)))));
}

/** VehicleUtils.CalculateSpeedRange: acceleration falls as top speed approaches. */
export function cs2SpeedRange(
  car: CS2CarData,
  currentSpeed: number,
  timeStep: number,
) {
  const v = f(currentSpeed),
    dt = f(timeStep),
    acceleration = f(
      cs2InverseSmoothStep(car.maxSpeed, 0, v) * f(car.acceleration),
    ),
    min = Math.max(0, f(v + f(-f(car.braking) * dt))),
    max = Math.min(f(v + f(acceleration * dt)), Math.max(min, f(car.maxSpeed)));
  return { min, max };
}

/** VehicleUtils.GetDrivingStyle + PseudoRandomSeed.GetRandom(kDrivingStyle). */
export function cs2SafetyTime(
  simulationFrame: number,
  seed: number,
  bicycle = false,
) {
  let state = Math.max(1, (seed & 0xffff) ^ 45236) >>> 0;
  const next = () => {
    const old = state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return old;
  };
  next(); // Unity.Mathematics.Random constructor.
  next();
  next(); // PseudoRandomSeed.GetRandom discards two NextUInt calls.
  const random = f((next() >>> 9) / 8388608),
    phase = f(
      f((simulationFrame & 4095) * f(0.0015339808)) +
        f(random * f(Math.PI * 2)),
    );
  return f(
    f(bicycle ? 0.2 : 0.3) + f(f(bicycle ? 0.1 : 0.2) * f(Math.sin(phase))),
  );
}

/** CarNavigationSystem's extra front clearance at parking/creeping speeds. */
export function cs2LowSpeedDistanceOffset(speed: number) {
  const v = f(speed);
  return v < 1.5 ? Math.max(-0.5, f(-0.5 * f(f(1.5 - v) ** 2))) : 0;
}

export type CS2Point = { x: number; y: number; z: number };

/** NetUtils.CalculateCurviness(Curve, float), with a cubic lane centreline. */
export function cs2CurveCurviness(
  points: readonly [CS2Point, CS2Point, CS2Point, CS2Point],
  length: number,
  width: number,
) {
  length = f(length);
  width = f(width);
  if (length <= f(0.1)) return 0;
  const scale = (point: CS2Point, amount: number): CS2Point => ({
    x: f(point.x * amount),
    y: f(point.y * amount),
    z: f(point.z * amount),
  });
  const add = (a: CS2Point, b: CS2Point): CS2Point => ({
    x: f(a.x + b.x),
    y: f(a.y + b.y),
    z: f(a.z + b.z),
  });
  const subtract = (a: CS2Point, b: CS2Point): CS2Point => ({
    x: f(a.x - b.x),
    y: f(a.y - b.y),
    z: f(a.z - b.z),
  });
  const position = (t: number) => {
    const u = 1 - t;
    return add(
      add(
        add(scale(points[0], u ** 3), scale(points[1], 3 * t * u * u)),
        scale(points[2], 3 * t * t * u),
      ),
      scale(points[3], t ** 3),
    );
  };
  const tangent = (t: number) =>
    add(
      add(
        scale(subtract(points[1], points[0]), 3 * (1 - t) ** 2),
        scale(subtract(points[2], points[1]), 6 * t * (1 - t)),
      ),
      scale(subtract(points[3], points[2]), 3 * t * t),
    );
  const unit = (p: CS2Point): CS2Point | undefined => {
    const squared = f(f(f(p.x * p.x) + f(p.y * p.y)) + f(p.z * p.z));
    return squared > f(1.1754944e-38)
      ? scale(p, f(1 / Math.sqrt(squared)))
      : undefined;
  };
  const curvePart = (
    p1: CS2Point,
    t1: CS2Point,
    p2: CS2Point,
    t2: CS2Point,
  ) => {
    const distance = f(Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z)),
      a = unit(t1),
      b = unit(t2);
    if (!a || !b || distance < f(1e-6)) return 0;
    const dot = clamp(f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z)), -1, 1),
      angle = f(Math.acos(dot));
    return f(f(2 * f(Math.sin(f(angle * 0.5)))) / distance);
  };
  const positions = [
      points[0],
      position(0.25),
      position(0.5),
      position(0.75),
      points[3],
    ],
    tangents = [
      subtract(points[1], points[0]),
      tangent(0.25),
      tangent(0.5),
      tangent(0.75),
      subtract(points[3], points[2]),
    ];
  let value = 0;
  for (let i = 0; i < 4; i++)
    value = Math.max(
      value,
      curvePart(positions[i], tangents[i], positions[i + 1], tangents[i + 1]),
    );
  if (length < width * 2) {
    const t = clamp((length - width * 0.1) / (width * 2 - width * 0.1), 0, 1),
      blend = t * t * (3 - 2 * t),
      smaller = Math.min(
        value,
        curvePart(positions[0], tangents[0], positions[4], tangents[4]),
      );
    value = f(smaller + (value - smaller) * blend);
  }
  return value;
}

export type CS2Leader = {
  /** Bumper gap after geometric projection, before the low-speed offset. */
  gap: number;
  speed: number;
  braking: number;
};

/**
 * The scalar car/car branch of CarLaneSpeedIterator.UpdateMaxSpeed, after its
 * geometry/ECS lookups. Normal same-direction cars use distanceFactor = 1.
 * Full overlap, trains, bicycles and oncoming/ignored blocker branches are not
 * represented by this narrowed input contract.
 */
export function cs2FollowingSpeed(
  car: CS2CarData,
  leader: CS2Leader,
  timeStep: number,
  safeTimeStep: number,
  distanceOffset = 0,
) {
  let distance = f(f(leader.gap) + f(distanceOffset));
  let speed = f(leader.speed);
  if (speed > f(0.001)) {
    speed = Math.max(0, f(speed - f(f(f(leader.braking) * f(timeStep)) * 2)));
    if (car.braking >= leader.braking) {
      distance = f(distance + f(speed * f(safeTimeStep)));
      return cs2MaxBrakingSpeed(car, distance, safeTimeStep, speed);
    }
    distance = f(
      distance +
        cs2BrakingDistance(
          { ...car, braking: leader.braking },
          speed,
          safeTimeStep,
        ),
    );
  }
  return cs2MaxBrakingSpeed(car, distance, safeTimeStep);
}

export type CS2SpeedInput = {
  car?: CS2CarData;
  speed: number;
  speedLimit: number;
  curviness?: number;
  leader?: CS2Leader;
  /** Net distance from front bumper to an actual stopping target. */
  stopDistance?: number;
  simulationFrame?: number;
  seed?: number;
  /** Actual RoadLab integration step. Original navigation uses 4/15 seconds. */
  timeStep: number;
  navigationTimeStep?: number;
  safetyTime?: number;
};

/**
 * Browser adapter for the normal-car scalar decision. The returned target is a
 * CS2 navigation decision; nextSpeed/acceleration apply its target subject to
 * the source acceleration/braking range over RoadLab's small integration step.
 * This is not the original CarMoveSystem vector steering or
 * ECS update-group scheduler; keep that adaptation explicit in fidelity audits.
 */
export function cs2NavigateSpeed(input: CS2SpeedInput) {
  const car = input.car ?? CS2_BASE_CAR,
    speed = Math.min(Math.max(0, input.speed), car.maxSpeed),
    navigationStep = input.navigationTimeStep ?? CS2_NAVIGATION_TIMESTEP,
    safetyTime =
      input.safetyTime ??
      cs2SafetyTime(input.simulationFrame ?? 0, input.seed ?? 0),
    safeTimeStep = f(navigationStep + safetyTime),
    range = cs2SpeedRange(car, speed, navigationStep),
    distanceOffset = cs2LowSpeedDistanceOffset(speed);
  let target = Math.min(
    range.max,
    cs2MaxDriveSpeed(car, input.speedLimit, input.curviness ?? 0),
  );
  if (input.leader) {
    target = Math.min(
      target,
      cs2FollowingSpeed(
        car,
        input.leader,
        navigationStep,
        safeTimeStep,
        distanceOffset,
      ),
    );
  }
  if (input.stopDistance !== undefined && Number.isFinite(input.stopDistance)) {
    target = Math.min(
      target,
      cs2MaxBrakingSpeed(
        car,
        f(input.stopDistance + distanceOffset),
        safeTimeStep,
      ),
    );
  }
  const maxSpeed = clamp(target, range.min, range.max),
    actualStep = Math.min(Math.max(0, input.timeStep), navigationStep),
    integrationRange = cs2SpeedRange(car, speed, actualStep),
    nextSpeed = clamp(target, integrationRange.min, integrationRange.max),
    acceleration = actualStep > 0 ? (nextSpeed - speed) / actualStep : 0;
  return { maxSpeed, nextSpeed, acceleration, safeTimeStep, speedRange: range };
}
