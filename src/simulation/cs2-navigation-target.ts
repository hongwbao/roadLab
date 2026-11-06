/** Source-derived normal-road navigation target kernel. See CS2_NAVIGATION_TARGET.md. */
import {
  CS2_BASE_CAR,
  CS2_NAVIGATION_TIMESTEP,
  cs2BrakingDistance,
  cs2MaxBrakingSpeed,
  type CS2CarData,
} from "./cs2-driving";
import type {
  CS2MotionNavigation,
  CS2MotionQuaternion,
  CS2MotionState,
  CS2MotionVector,
} from "./cs2-motion";

export type CS2NavigationCurve = {
  id: string;
  points: readonly [
    CS2MotionVector,
    CS2MotionVector,
    CS2MotionVector,
    CS2MotionVector,
  ];
  length: number;
  width: number;
  widthOffset?: readonly [number, number];
  /** Source NetLaneData.Twoway means a shared-direction lane, not a two-way road. */
  twoway?: boolean;
  highway?: boolean;
  lit?: boolean;
};
export type CS2NavigationCurrentState = {
  laneId: string | null;
  changeLaneId?: string | null;
  /** x: target cursor, y: reserved endpoint, z: route interval end. */
  curvePosition: CS2MotionVector;
  changeProgress: number;
  lanePosition: number;
  flags: number;
  duration: number;
  distance: number;
};
export type CS2NavigationQueuedLane = {
  laneId: string;
  start: number;
  end: number;
  flags: number;
  valid?: boolean;
};
export const CS2_NAV_TARGET_FLAGS = {
  EndReached: 2,
  TransformTarget: 8,
  ParkingSpace: 0x10,
  Validated: 0x10000,
  TurnLeft: 0x40000,
  TurnRight: 0x80000,
  PushBlockers: 0x100000,
  HighBeams: 0x200000,
  RequestSpace: 0x400000,
  Connection: 0x1000000,
  ResetSpeed: 0x2000000,
  Area: 0x4000000,
  CanReverse: 0x10000000,
} as const;
const f = Math.fround,
  dt = CS2_NAVIGATION_TIMESTEP,
  tiny = f(1.1754944e-38);
const copy = (v: CS2MotionVector): CS2MotionVector => ({
  x: f(v.x),
  y: f(v.y),
  z: f(v.z),
});
const add = (a: CS2MotionVector, b: CS2MotionVector): CS2MotionVector => ({
  x: f(f(a.x) + f(b.x)),
  y: f(f(a.y) + f(b.y)),
  z: f(f(a.z) + f(b.z)),
});
const sub = (a: CS2MotionVector, b: CS2MotionVector): CS2MotionVector => ({
  x: f(f(a.x) - f(b.x)),
  y: f(f(a.y) - f(b.y)),
  z: f(f(a.z) - f(b.z)),
});
const mul = (a: CS2MotionVector, n: number): CS2MotionVector => ({
  x: f(f(a.x) * f(n)),
  y: f(f(a.y) * f(n)),
  z: f(f(a.z) * f(n)),
});
const dot = (a: CS2MotionVector, b: CS2MotionVector) =>
  f(f(f(f(a.x) * f(b.x)) + f(f(a.y) * f(b.y))) + f(f(a.z) * f(b.z)));
const length = (a: CS2MotionVector) => f(Math.sqrt(dot(a, a)));
const distance = (a: CS2MotionVector, b: CS2MotionVector) => length(sub(a, b));
const lerp = (a: number, b: number, t: number) =>
  f(f(a) + f(f(t) * f(f(b) - f(a))));
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const saturate = (n: number) => clamp(n, 0, 1);
const mix = (a: CS2MotionVector, b: CS2MotionVector, t: number) =>
  add(a, mul(sub(b, a), t));
const cross = (a: CS2MotionVector, b: CS2MotionVector) => ({
  x: f(f(f(a.y) * f(b.z)) - f(f(a.z) * f(b.y))),
  y: f(f(f(a.z) * f(b.x)) - f(f(a.x) * f(b.z))),
  z: f(f(f(a.x) * f(b.y)) - f(f(a.y) * f(b.x))),
});
const rotate = (q: CS2MotionQuaternion, v: CS2MotionVector) => {
  const t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q.w)), cross(q, t));
};
const normal = (v: CS2MotionVector) => {
  const n = dot(v, v);
  return n > tiny ? mul(v, f(1 / f(Math.sqrt(n)))) : { x: 0, y: 0, z: 0 };
};
const negative = (n: number) => n < 0 || Object.is(n, -0);

/** Original Colossal MathUtils.Position(Bezier4x3,float). */
export function cs2NavigationCurvePosition(
  curve: CS2NavigationCurve,
  parameter: number,
) {
  const t = f(parameter),
    u = f(1 - t),
    threeT = f(3 * t),
    a = f(f(u * u) * u),
    b = f(f(threeT * u) * u),
    c = f(f(threeT * t) * u),
    d = f(f(t * t) * t);
  return add(
    add(
      add(mul(curve.points[0], a), mul(curve.points[1], b)),
      mul(curve.points[2], c),
    ),
    mul(curve.points[3], d),
  );
}
function tangent(curve: CS2NavigationCurve, parameter: number) {
  const t = f(parameter),
    u = f(1 - t),
    threeT = f(3 * t),
    a = f(f(u * f(-1 + t)) * 3),
    b = f(f(u * f(1 - threeT)) * 3),
    c = f(f(t * f(2 - threeT)) * 3),
    d = f(f(t * t) * 3);
  return add(
    add(
      add(mul(curve.points[0], a), mul(curve.points[1], b)),
      mul(curve.points[2], c),
    ),
    mul(curve.points[3], d),
  );
}
/** VehicleUtils.GetLaneOffset; width offsets are the explicit NodeLane component. */
export function cs2LaneOffset(
  curve: CS2NavigationCurve,
  parameter: number,
  vehicleWidth: number,
  lanePosition: number,
  bicycle = false,
) {
  const offsets = curve.widthOffset ?? [0, 0],
    width = f(f(curve.width) + lerp(offsets[0], offsets[1], parameter)),
    occupied = bicycle ? f(f(vehicleWidth) * 0.5) : f(vehicleWidth);
  return f(f(lanePosition) * Math.max(0, f(width - occupied)));
}
/** VehicleUtils.GetLanePosition: lateral offset is perpendicular in the XZ plane. */
export function cs2LanePosition(
  curve: CS2NavigationCurve,
  parameter: number,
  offset: number,
) {
  const result = cs2NavigationCurvePosition(curve, parameter),
    forward = tangent(curve, parameter),
    squared = f(f(forward.x * forward.x) + f(forward.z * forward.z)),
    scale = squared > tiny ? f(1 / f(Math.sqrt(squared))) : 0,
    x = f(forward.x * scale),
    z = f(forward.z * scale);
  result.x = f(result.x + f(z * f(offset)));
  result.z = f(result.z + f(-x * f(offset)));
  return result;
}
const lanePoint = (
  curve: CS2NavigationCurve,
  t: number,
  width: number,
  position: number,
  bicycle: boolean,
) =>
  cs2LanePosition(curve, t, cs2LaneOffset(curve, t, width, position, bicycle));

/** Direct port of UpdateNavigationJob.MoveTarget's one-curve overload. */
export function cs2MoveRoadTarget(input: {
  comparePosition: CS2MotionVector;
  minDistance: number;
  curve: CS2NavigationCurve;
  curvePosition: CS2MotionVector;
  vehicleWidth: number;
  lanePosition: number;
  bicycle?: boolean;
}) {
  const { curve } = input,
    delta = copy(input.curvePosition),
    compare = copy(input.comparePosition),
    minimum = f(input.minDistance),
    bicycle = input.bicycle ?? false,
    endpoint = lanePoint(
      curve,
      delta.z,
      input.vehicleWidth,
      input.lanePosition,
      bicycle,
    );
  if (distance(compare, endpoint) < minimum) {
    delta.x = delta.z;
    return { enough: false, targetPosition: endpoint, curvePosition: delta };
  }
  let start = delta.x,
    end = delta.z;
  for (let i = 0; i < 8; i++) {
    const t = lerp(start, end, 0.5),
      point = lanePoint(
        curve,
        t,
        input.vehicleWidth,
        input.lanePosition,
        bicycle,
      );
    if (distance(compare, point) < minimum) start = t;
    else end = t;
  }
  delta.x = end;
  return {
    enough: true,
    targetPosition: lanePoint(
      curve,
      end,
      input.vehicleWidth,
      input.lanePosition,
      bicycle,
    ),
    curvePosition: delta,
  };
}
const lineDistance = (
  a: CS2MotionVector,
  b: CS2MotionVector,
  p: CS2MotionVector,
) => {
  const delta = sub(b, a),
    relative = sub(p, a),
    squared = dot(delta, delta),
    t = squared !== 0 ? saturate(f(dot(delta, relative) / squared)) : 0;
  return distance(mul(delta, t), relative);
};
/** Original two-curve search measures distance to the lateral segment, not its blend point. */
export function cs2MoveChangingLaneTarget(input: {
  comparePosition: CS2MotionVector;
  minDistance: number;
  curve1: CS2NavigationCurve;
  curve2: CS2NavigationCurve;
  curvePosition: CS2MotionVector;
  blend: number;
  vehicleWidth: number;
  lanePosition1: number;
  lanePosition2: number;
  bicycle?: boolean;
}) {
  const delta = copy(input.curvePosition),
    compare = copy(input.comparePosition),
    minimum = f(input.minDistance),
    blend = saturate(f(input.blend)),
    bicycle = input.bicycle ?? false,
    pair = (t: number) =>
      [
        lanePoint(
          input.curve1,
          t,
          input.vehicleWidth,
          input.lanePosition1,
          bicycle,
        ),
        lanePoint(
          input.curve2,
          t,
          input.vehicleWidth,
          input.lanePosition2,
          bicycle,
        ),
      ] as const;
  let [a, b] = pair(delta.z);
  if (lineDistance(a, b, compare) < minimum) {
    delta.x = delta.z;
    return {
      enough: false,
      targetPosition: mix(a, b, blend),
      curvePosition: delta,
    };
  }
  let start = delta.x,
    end = delta.z;
  for (let i = 0; i < 8; i++) {
    const t = lerp(start, end, 0.5);
    [a, b] = pair(t);
    if (lineDistance(a, b, compare) < minimum) start = t;
    else end = t;
  }
  delta.x = end;
  [a, b] = pair(end);
  return {
    enough: true,
    targetPosition: mix(a, b, blend),
    curvePosition: delta,
  };
}

export type CS2RoadTargetInput = {
  state: CS2MotionState;
  navigation: CS2MotionNavigation;
  current: CS2NavigationCurrentState;
  nextLanes: readonly CS2NavigationQueuedLane[];
  lanes: ReadonlyMap<string, CS2NavigationCurve>;
  vehicleWidth: number;
  frontExtent: number;
  pivotOffset: number;
  car?: CS2CarData;
  /** Result of the speed/conflict iterator before the target update. */
  maxSpeed: number;
  oncoming?: number;
  canChangeLane?: number;
  /** One explicit [0,1) sample from the host navigation random stream. */
  random01: number;
  temporaryBlocker?: boolean;
  previousTemporaryBlocker?: boolean;
  upcomingTurnFlags?: number;
  leftHandTraffic?: boolean;
  /** Source GetNextLane, used when a lane change continues across a node. */
  selectNextLane?: (
    previousLane: string,
    nextRequestedLane: string,
  ) => string | undefined;
};

/** Normal road/node part of UpdateNavigationTarget with ECS inputs supplied explicitly. */
export function cs2UpdateRoadNavigationTarget(input: CS2RoadTargetInput) {
  const F = CS2_NAV_TARGET_FLAGS,
    turnMask = F.TurnLeft | F.TurnRight,
    current = {
      ...input.current,
      curvePosition: copy(input.current.curvePosition),
      changeProgress: f(input.current.changeProgress),
      lanePosition: f(input.current.lanePosition),
      duration: f(input.current.duration),
      distance: f(input.current.distance),
    },
    nextLanes = input.nextLanes.map((l) => ({ ...l })),
    navigation: CS2MotionNavigation = {
      targetPosition: copy(input.navigation.targetPosition),
      maxSpeed: f(input.maxSpeed),
      targetRotation: {
        ...(input.navigation.targetRotation ?? { x: 0, y: 0, z: 0, w: 0 }),
      },
    },
    car =
      current.flags & F.Connection
        ? {
            ...(input.car ?? CS2_BASE_CAR),
            maxSpeed: f(277.77777),
            acceleration: f(277.77777),
            braking: f(277.77777),
          }
        : {
            ...(input.car ?? CS2_BASE_CAR),
            maxSpeed: f((input.car ?? CS2_BASE_CAR).maxSpeed),
            braking: f((input.car ?? CS2_BASE_CAR).braking),
          },
    currentSpeed =
      current.flags & F.Connection
        ? length(input.state.velocity)
        : Math.min(length(input.state.velocity), car.maxSpeed),
    reversing = negative(f(input.navigation.maxSpeed));
  const sideEffects: { laneId: string; duration: number; distance: number }[] =
    [];
  if (current.flags & (F.Area | F.ParkingSpace | F.TransformTarget))
    throw new Error(
      "Navigation target requires a normal road/node lane; Area, ParkingSpace and TransformTarget need their world components",
    );
  if (!current.laneId) {
    navigation.maxSpeed = Math.max(0, f(currentSpeed - f(car.braking * dt)));
    return {
      navigation,
      current,
      nextLanes,
      sideEffects,
      odometerDelta: 0,
      spawnBlocked: false,
      endReached: (current.flags & F.EndReached) !== 0,
      consumed: 0,
      deferredLane: undefined as CS2NavigationQueuedLane | undefined,
    };
  }
  const getLane = (id: string) => {
    const lane = input.lanes.get(id);
    if (!lane) throw new Error(`Missing navigation curve: ${id}`);
    return lane;
  };
  const apply = () => {
    if (current.flags & F.ResetSpeed) return;
    if (current.laneId && (current.duration !== 0 || current.distance !== 0))
      sideEffects.push({
        laneId: current.laneId,
        duration: current.duration,
        distance: current.distance,
      });
    current.duration = 0;
    current.distance = 0;
  };
  let signedPivot = f(reversing ? -input.pivotOffset : input.pivotOffset),
    compare = copy(input.state.position);
  if (signedPivot < 0) {
    compare = add(
      compare,
      rotate(input.state.rotation, { x: 0, y: 0, z: signedPivot }),
    );
    signedPivot = -signedPivot;
  }
  const minimumDistance = f(
      Math.max(1, f(navigation.maxSpeed * dt)) + signedPivot,
    ),
    oldDistance = lerp(
      distance(compare, navigation.targetPosition),
      0,
      input.oncoming ?? 0,
    );
  const targetLanePosition = () => {
    const turn = current.flags & turnMask;
    return -clamp(
      current.lanePosition,
      turn === F.TurnRight ? 0 : -0.5,
      turn === F.TurnLeft ? 0 : 0.5,
    );
  };
  if (current.changeLaneId) {
    const destinationPosition = targetLanePosition(),
      cap = f(1 + f(input.frontExtent * f(0.05))),
      factor = f(f(input.canChangeLane ?? 1) * dt);
    let a = f(f(0.4) * factor),
      b = f(f(f(0.6) * saturate(f(currentSpeed * f(0.05)))) * factor);
    a = Math.min(a, Math.max(0, f(1 - current.changeProgress)));
    current.changeProgress = Math.min(
      cap,
      f(current.changeProgress + f(a + b)),
    );
    if (
      current.changeProgress === cap ||
      (current.flags & (F.Connection | F.ResetSpeed)) !== 0
    ) {
      apply();
      current.lanePosition = destinationPosition;
      current.laneId = current.changeLaneId;
      current.changeLaneId = null;
      current.flags &= ~turnMask;
    }
  }
  if ((current.flags & turnMask) === 0)
    current.flags |= (input.upcomingTurnFlags ?? 0) & turnMask;
  if (
    !!input.temporaryBlocker !== !!input.previousTemporaryBlocker ||
    current.duration >= 30
  )
    apply();
  if (input.temporaryBlocker) {
    if (current.duration >= 5) current.flags |= F.PushBlockers;
  } else if (current.duration >= 5) current.flags &= ~F.PushBlockers;
  current.duration = f(current.duration + dt);
  let odometerDelta = 0;
  if (currentSpeed > f(0.01)) {
    odometerDelta = f(currentSpeed * dt);
    current.distance = f(current.distance + odometerDelta);
    const turn = current.flags & turnMask,
      min = turn === F.TurnRight ? 0 : -0.5,
      max = turn === F.TurnLeft ? 0 : 0.5,
      gain = Math.min(1, f(odometerDelta * f(turn !== 0 ? 0.01 : 0.002))),
      correction = Math.min(1, f(odometerDelta * f(0.1)));
    current.lanePosition = f(
      current.lanePosition -
        f(
          f(
            Math.max(0, f(current.lanePosition - 0.5)) +
              Math.min(0, f(current.lanePosition + 0.5)),
          ) * correction,
        ),
    );
    current.lanePosition = lerp(
      current.lanePosition,
      lerp(min, max, input.random01),
      gain,
    );
  }
  let spawnBlocked = false;
  if (current.flags & F.ResetSpeed) {
    if (current.distance > f(10 + f(currentSpeed * 0.5))) {
      current.flags &= ~F.ResetSpeed;
      current.distance = 0;
      current.duration = 0;
    } else if (current.duration > 60) spawnBlocked = true;
  }
  let consumed = 0,
    deferredLane: CS2NavigationQueuedLane | undefined;
  if (oldDistance < minimumDistance) {
    for (;;) {
      if (current.flags & (F.Area | F.ParkingSpace | F.TransformTarget)) break;
      navigation.targetRotation = { x: 0, y: 0, z: 0, w: 0 };
      const lane = getLane(current.laneId!);
      let result: ReturnType<typeof cs2MoveRoadTarget>;
      if (current.changeLaneId)
        result = cs2MoveChangingLaneTarget({
          comparePosition: compare,
          minDistance: minimumDistance,
          curve1: lane,
          curve2: getLane(current.changeLaneId),
          curvePosition: current.curvePosition,
          blend: current.changeProgress,
          vehicleWidth: input.vehicleWidth,
          lanePosition1: current.lanePosition,
          lanePosition2: targetLanePosition(),
        });
      else {
        if ((input.oncoming ?? 0) !== 0) {
          const offset = cs2LaneOffset(
              lane,
              current.curvePosition.x,
              input.vehicleWidth,
              current.lanePosition,
            ),
            width = f(
              lane.width +
                lerp(
                  (lane.widthOffset ?? [0, 0])[0],
                  (lane.widthOffset ?? [0, 0])[1],
                  current.curvePosition.x,
                ),
            ),
            candidate = lerp(
              offset,
              f(input.vehicleWidth * (input.leftHandTraffic ? -0.5 : 0.5)),
              Math.min(1, input.oncoming ?? 0),
            );
          if (input.leftHandTraffic ? candidate < offset : candidate > offset)
            current.lanePosition = f(
              candidate / Math.max(0.1, f(width - input.vehicleWidth)),
            );
        }
        const lanePosition =
          current.curvePosition.z < current.curvePosition.x
            ? -current.lanePosition
            : current.lanePosition;
        result = cs2MoveRoadTarget({
          comparePosition: compare,
          minDistance: minimumDistance,
          curve: lane,
          curvePosition: current.curvePosition,
          vehicleWidth: input.vehicleWidth,
          lanePosition,
        });
      }
      current.curvePosition = result.curvePosition;
      navigation.targetPosition = result.targetPosition;
      if (result.enough) {
        if (!lane.twoway) current.flags &= ~F.CanReverse;
        break;
      }
      if (nextLanes.length === 0) {
        if (
          distance(compare, navigation.targetPosition) < f(1 + signedPivot) &&
          currentSpeed < f(0.1)
        )
          current.flags |= F.EndReached;
        break;
      }
      const next = nextLanes[0];
      if (
        (next.flags & (F.ParkingSpace | F.Validated)) === F.ParkingSpace ||
        next.valid === false ||
        !input.lanes.has(next.laneId)
      )
        break;
      if (next.flags & (F.Area | F.ParkingSpace | F.TransformTarget)) {
        deferredLane = { ...next };
        break;
      }
      if (current.flags & F.Connection) {
        if (next.flags & F.TransformTarget) next.flags |= F.ResetSpeed;
        else if ((next.flags & F.Connection) === 0) {
          if (
            distance(compare, navigation.targetPosition) >=
              f(1 + signedPivot) ||
            currentSpeed > 3
          )
            break;
          next.flags |= F.ResetSpeed;
        }
      }
      const nextCurve = getLane(next.laneId);
      if (current.flags & F.HighBeams && nextCurve.highway && !nextCurve.lit)
        next.flags |= F.HighBeams;
      apply();
      const continuation: string | undefined = current.changeLaneId
        ? input.selectNextLane?.(current.laneId!, next.laneId)
        : undefined;
      if (continuation && continuation !== next.laneId) {
        current.laneId = continuation;
        current.changeLaneId = next.laneId;
      } else {
        current.laneId = next.laneId;
        current.changeLaneId = null;
        current.changeProgress = 0;
      }
      current.curvePosition = {
        x: f(next.start),
        y: f(next.start),
        z: f(next.end),
      };
      current.flags = next.flags | (current.flags & F.PushBlockers);
      nextLanes.shift();
      consumed++;
    }
  }
  navigation.maxSpeed = Math.min(
    navigation.maxSpeed,
    f(distance(input.state.position, navigation.targetPosition) / dt),
  );
  if ((current.flags & (F.Connection | F.ResetSpeed)) === 0) {
    const direction = sub(navigation.targetPosition, compare),
      targetDistance = length(direction),
      facing = dot(
        rotate(input.state.rotation, { x: 0, y: 0, z: 1 }),
        normal(direction),
      );
    if (reversing) {
      if (targetDistance < f(1 + signedPivot) || facing < f(0.8))
        navigation.maxSpeed = -Math.min(3, navigation.maxSpeed);
      else if (currentSpeed >= f(0.1))
        navigation.maxSpeed = -Math.max(
          0,
          Math.min(navigation.maxSpeed, f(currentSpeed - f(car.braking * dt))),
        );
    } else if (
      targetDistance >= f(1 + signedPivot) &&
      (!current.changeLaneId || current.changeProgress <= 0) &&
      facing < f(0.7)
    ) {
      if (currentSpeed >= f(0.1))
        navigation.maxSpeed = Math.max(
          0,
          Math.min(navigation.maxSpeed, f(currentSpeed - f(car.braking * dt))),
        );
      else {
        navigation.maxSpeed = -Math.min(3, navigation.maxSpeed);
        current.flags |= F.CanReverse;
      }
    }
  }
  return {
    navigation,
    current,
    nextLanes,
    sideEffects,
    odometerDelta,
    spawnBlocked,
    endReached: (current.flags & F.EndReached) !== 0,
    consumed,
    deferredLane,
  };
}

/** Original curve-distance tail of CarLaneSpeedIterator, with explicit state. */
export function cs2AdvanceNavigationCurve(input: {
  curve: CS2NavigationCurve;
  changeCurve?: CS2NavigationCurve;
  blend?: number;
  first?: boolean;
  start: number;
  end: number;
  position: CS2MotionVector;
  distance: number;
  previousPosition: CS2MotionVector;
  previousDistance: number;
}) {
  const blend = saturate(f(input.blend ?? 0)),
    a = cs2NavigationCurvePosition(input.curve, input.start),
    b = input.changeCurve
      ? cs2NavigationCurvePosition(input.changeCurve, input.start)
      : a,
    start =
      input.first === false
        ? copy(input.position)
        : input.changeCurve
          ? mix(a, b, blend)
          : a,
    end = cs2NavigationCurvePosition(
      input.changeCurve ?? input.curve,
      input.end,
    ),
    portion = Math.abs(f(f(input.end) - f(input.start))),
    curveLength = input.changeCurve
      ? lerp(input.curve.length, input.changeCurve.length, blend)
      : f(input.curve.length),
    amount = Math.max(
      f(0.001),
      lerp(distance(start, end), f(curveLength * portion), portion),
    );
  return {
    position: end,
    distance: f(f(input.distance) + amount),
    previousPosition:
      amount > 1 ? copy(input.position) : copy(input.previousPosition),
    previousDistance:
      amount > 1 ? f(input.distance) : f(input.previousDistance),
    amount,
  };
}

/** Geometry cursor for normal lane-speed scanning; world checks stay in evaluate. */
export function cs2ScanNavigationGeometry(input: {
  position: CS2MotionVector;
  current: CS2NavigationCurrentState;
  nextLanes: readonly CS2NavigationQueuedLane[];
  lanes: ReadonlyMap<string, CS2NavigationCurve>;
  vehicleWidth: number;
  frontExtent: number;
  car?: CS2CarData;
  maxSpeed: number;
  speedRange: { min: number; max: number };
  safeTimeStep: number;
  distanceOffset: number;
  evaluate?: (visit: {
    laneId: string;
    changeLaneId?: string | null;
    distance: number;
    frontDistance: number;
    position: CS2MotionVector;
    start: number;
    end: number;
  }) => number | undefined;
}) {
  const lane = input.current.laneId
    ? input.lanes.get(input.current.laneId)
    : undefined;
  if (!lane) throw new Error("Missing current navigation curve for speed scan");
  const car = input.car ?? CS2_BASE_CAR,
    current = input.current,
    change = current.changeLaneId
      ? input.lanes.get(current.changeLaneId)
      : undefined,
    blend = saturate(f(current.changeProgress)),
    turns =
      current.flags &
      (CS2_NAV_TARGET_FLAGS.TurnLeft | CS2_NAV_TARGET_FLAGS.TurnRight),
    destinationPosition = -clamp(
      current.lanePosition,
      turns === CS2_NAV_TARGET_FLAGS.TurnRight ? 0 : -0.5,
      turns === CS2_NAV_TARGET_FLAGS.TurnLeft ? 0 : 0.5,
    ),
    p = lanePoint(
      lane,
      current.curvePosition.x,
      input.vehicleWidth,
      !change && current.curvePosition.z < current.curvePosition.x
        ? -current.lanePosition
        : current.lanePosition,
      false,
    ),
    changePosition = change
      ? lanePoint(
          change,
          current.curvePosition.x,
          input.vehicleWidth,
          destinationPosition,
          false,
        )
      : p;
  let cursor = {
      position: cs2NavigationCurvePosition(
        change ?? lane,
        current.curvePosition.x,
      ),
      distance: distance(
        input.position,
        change ? mix(p, changePosition, blend) : p,
      ),
      previousPosition: copy(input.position),
      previousDistance: 0,
      amount: 0,
    },
    maxSpeed = f(input.maxSpeed),
    stopped = false,
    first = true;
  const visits: {
    laneId: string;
    distance: number;
    frontDistance: number;
    position: CS2MotionVector;
    start: number;
    end: number;
    changeLaneId?: string | null;
  }[] = [];
  const visit = (
    curve: CS2NavigationCurve,
    start: number,
    end: number,
    changeCurve?: CS2NavigationCurve,
  ) => {
    const row = {
      laneId: curve.id,
      changeLaneId: changeCurve?.id,
      distance: cursor.distance,
      frontDistance: f(
        f(cursor.distance - input.frontExtent) + input.distanceOffset,
      ),
      position: copy(cursor.position),
      start,
      end,
    };
    visits.push(row);
    const cap = input.evaluate?.(row);
    if (cap !== undefined && cap < maxSpeed)
      maxSpeed = clamp(f(cap), input.speedRange.min, input.speedRange.max);
    cursor = cs2AdvanceNavigationCurve({
      curve,
      changeCurve,
      blend,
      first,
      start,
      end,
      ...cursor,
    });
    first = false;
    stopped =
      f(f(cursor.distance + input.distanceOffset) - 20) >=
        cs2BrakingDistance(car, maxSpeed, input.safeTimeStep) ||
      maxSpeed === input.speedRange.min;
  };
  visit(lane, current.curvePosition.x, current.curvePosition.z, change);
  if (!stopped)
    for (const next of input.nextLanes) {
      const curve = input.lanes.get(next.laneId);
      if (!curve) continue;
      visit(curve, next.start, next.end);
      if (stopped) break;
    }
  if (!stopped)
    maxSpeed = Math.min(
      maxSpeed,
      clamp(
        cs2MaxBrakingSpeed(car, cursor.distance, dt),
        input.speedRange.min,
        input.speedRange.max,
      ),
    );
  return { ...cursor, maxSpeed, visits, stopped };
}
