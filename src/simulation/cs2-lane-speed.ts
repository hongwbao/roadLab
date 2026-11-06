/** Stateful normal-car CarLaneSpeedIterator port. See CS2_LANE_SPEED.md. */
import type { V } from "../core/types";
import type { CS2CarData } from "./cs2-driving";
import {
  cs2BrakingDistance,
  cs2MaxBrakingSpeed,
  cs2MaxDriveSpeed,
} from "./cs2-driving";
import {
  cs2LanePosition,
  cs2NavigationCurvePosition,
  type CS2NavigationCurve,
} from "./cs2-navigation-target";
import {
  cs2ReservationOffset,
  cs2ReservationPriority,
  cs2VehiclePriority,
  type CS2LaneOverlap,
  type CS2LaneReservation,
} from "./cs2-conflicts";
import { CS2_ROAD_LANE_FLAGS as F } from "./cs2-road-rules";

export type Cs2BlockerType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const CS2_LANE_SPEED_BLOCKER = {
  none: 0,
  continuing: 1,
  crossing: 2,
  signal: 3,
  temporary: 4,
  limit: 5,
  caution: 6,
  spawn: 7,
  oncoming: 8,
} as const;
export type CS2LaneSpeedGeometry = { min: V; max: V; size: V };
export type CS2LaneSpeedObject = {
  /** Unsupported kinds are rejected when inspected, never treated as cars. */
  kind: "car" | "static" | "bicycle" | "train" | "pedestrian";
  position: V;
  velocity?: V;
  geometry?: CS2LaneSpeedGeometry;
  car?: CS2CarData;
  controller?: string | null;
  emergency?: boolean;
  /** Retained component state; source skips it only in deferred parking checks. */
  unspawned?: boolean;
};
export type CS2LaneSpeedLaneObject = {
  object: string;
  curvePosition: readonly [number, number];
};
export type CS2LaneSpeedLane = {
  curve: CS2NavigationCurve;
  kind?: "car" | "parking" | "pedestrian";
  carLane: {
    flags: number;
    speedLimit: number;
    curviness: number;
    cautionStart?: number;
    cautionEnd?: number;
  };
  condition?: { wear: number };
  signal?: { type: number; flags: number; blocker: string | null };
  reservation?: CS2LaneReservation;
  /** Preserve runtime buffer order: NetUtils orders objects by curvePosition.y. */
  objects?: readonly CS2LaneSpeedLaneObject[];
  overlaps?: readonly (CS2LaneOverlap & { other: string })[];
};
export type CS2LaneSpeedWorld = {
  lanes: ReadonlyMap<string, CS2LaneSpeedLane>;
  /** Effective prefab CarData/Geometry are resolved here, not invented by iterator. */
  objects: ReadonlyMap<string, CS2LaneSpeedObject>;
};
export type CS2LaneSpeedInitialState = {
  entity: string;
  ignore?: string | null;
  priority: number;
  timeStep: number;
  safeTimeStep: number;
  distanceOffset: number;
  speedLimitFactor: number;
  currentSpeed: number;
  prefabCar: CS2CarData;
  prefabGeometry: CS2LaneSpeedGeometry;
  speedRange: { min: number; max: number };
  pushBlockers?: boolean;
  isBicycle?: boolean;
  maxSpeed: number;
  canChangeLane: number;
  currentPosition: V;
  oncoming?: number;
  blocker?: string | null;
  blockerType?: Cs2BlockerType;
};
export type CS2LaneSpeedState = {
  maxSpeed: number;
  canChangeLane: number;
  currentPosition: V;
  oncoming: number;
  blocker: string | null;
  blockerType: Cs2BlockerType;
  laneOffsetPush: readonly [number, number];
  distance: number;
  previousDistance: number;
  previousPosition: V;
  lane: string | null;
  nextLane: string | null;
  curveOffset: readonly [number, number];
  nextOffset: readonly [number, number];
  temporaryLanes: readonly string[];
};
export type CS2LaneSpeedNextLane = {
  lane: string;
  curvePosition: readonly [number, number];
};
export type CS2LaneSpeedFirstInput = {
  lane: string;
  curveOffset: V;
  nextLane?: string | null;
  nextOffset?: readonly [number, number];
  laneOffset: number;
  requestSpace: boolean;
};
export type CS2LaneSpeedChangingInput = Omit<
  CS2LaneSpeedFirstInput,
  "lane" | "laneOffset"
> & {
  lane1: string;
  lane2: string;
  laneDelta: number;
  laneOffset1: number;
  laneOffset2: number;
};
export type CS2LaneSpeedNextInput = {
  lane: string;
  curveOffset: readonly [number, number];
  laneOffset: number;
  minOffset: number;
  nextLanes: readonly CS2LaneSpeedNextLane[];
  requestSpace: boolean;
  laneFlags: number;
};
export type CS2LaneSpeedResult = {
  stop: boolean;
  laneFlags: number;
  needSignal: boolean;
};
export class CS2LaneSpeedUnsupportedError extends Error {}

const f = Math.fround,
  B = CS2_LANE_SPEED_BLOCKER;
const add = (a: number, b: number) => f(f(a) + f(b));
const subtract = (a: number, b: number) => f(f(a) - f(b));
const multiply = (a: number, b: number) => f(f(a) * f(b));
const divide = (a: number, b: number) => f(f(a) / f(b));
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) =>
  add(a, multiply(subtract(b, a), t));
const vec = (v: V): V => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
const minus = (a: V, b: V): V => ({
  x: subtract(a.x, b.x),
  y: subtract(a.y, b.y),
  z: subtract(a.z, b.z),
});
const scale = (a: V, n: number): V => ({
  x: multiply(a.x, n),
  y: multiply(a.y, n),
  z: multiply(a.z, n),
});
const dot = (a: V, b: V) =>
  add(add(multiply(a.x, b.x), multiply(a.y, b.y)), multiply(a.z, b.z));
const length = (v: V) => f(Math.sqrt(dot(v, v)));
const distance = (a: V, b: V) => length(minus(a, b));
const normal = (v: V) => {
  const n = dot(v, v);
  return n > f(1.1754944e-38)
    ? scale(v, divide(1, f(Math.sqrt(n))))
    : { x: 0, y: 0, z: 0 };
};
const vectorLerp = (a: V, b: V, t: number): V => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});
const tuple = (v: readonly [number, number]): [number, number] => [
  f(v[0]),
  f(v[1]),
];
const bytePosition = (v: number) => multiply(v, 0.003921569);
// Unity stores Bezier control points as float3. Compile that immutable geometry
// once, even when RoadLab's world-fitting adapter originally produced doubles.
const sourceCurves = new WeakMap<CS2NavigationCurve, CS2NavigationCurve>();
const sourceCurve = (curve: CS2NavigationCurve) => {
  let result = sourceCurves.get(curve);
  if (!result) {
    result = {
      ...curve,
      points: curve.points.map(vec) as unknown as CS2NavigationCurve["points"],
      length: f(curve.length),
      width: f(curve.width),
      widthOffset: curve.widthOffset && tuple(curve.widthOffset),
    };
    sourceCurves.set(curve, result);
  }
  return result;
};
const position = (curve: CS2NavigationCurve, t: number) =>
  cs2NavigationCurvePosition(sourceCurve(curve), t);
function tangent(curve: CS2NavigationCurve, t: number): V {
  const u = subtract(1, t),
    threeT = multiply(3, t),
    coefficients = [
      multiply(multiply(u, add(-1, t)), 3),
      multiply(multiply(u, subtract(1, threeT)), 3),
      multiply(multiply(t, subtract(2, threeT)), 3),
      multiply(multiply(t, t), 3),
    ];
  return curve.points
    .map((p, i) => scale(p, coefficients[i]))
    .reduce((a, b) => ({
      x: add(a.x, b.x),
      y: add(a.y, b.y),
      z: add(a.z, b.z),
    }));
}
const turnMask =
  F.uTurnLeft |
  F.turnLeft |
  F.turnRight |
  F.uTurnRight |
  F.gentleTurnLeft |
  F.gentleTurnRight |
  F.forward;
const spaceBoundaryMask =
  turnMask |
  F.levelCrossing |
  F.yield |
  F.stop |
  F.roundabout |
  F.rightOfWay |
  F.trafficLights;

/** One navigation decision; construct anew for each source navigation update. */
export class CS2CarLaneSpeedIterator {
  readonly state: CS2LaneSpeedState;
  private curve: CS2NavigationCurve | null = null;
  constructor(
    readonly world: CS2LaneSpeedWorld,
    readonly initial: CS2LaneSpeedInitialState,
  ) {
    if (initial.isBicycle)
      throw new CS2LaneSpeedUnsupportedError("Bicycle iterator is deferred");
    this.state = {
      maxSpeed: f(initial.maxSpeed),
      canChangeLane: f(initial.canChangeLane),
      currentPosition: vec(initial.currentPosition),
      oncoming: f(initial.oncoming ?? 0),
      blocker: initial.blocker ?? null,
      blockerType: initial.blockerType ?? B.none,
      laneOffsetPush: [0, 0],
      distance: 0,
      previousDistance: 0,
      previousPosition: { x: 0, y: 0, z: 0 },
      lane: null,
      nextLane: null,
      curveOffset: [0, 0],
      nextOffset: [0, 0],
      temporaryLanes: [],
    };
  }
  private lane(id: string) {
    const lane = this.world.lanes.get(id);
    if (!lane) throw new Error(`Missing lane snapshot ${id}`);
    if (lane.kind && lane.kind !== "car")
      throw new CS2LaneSpeedUnsupportedError(
        `Lane kind ${lane.kind} deferred: ${id}`,
      );
    return lane;
  }
  private object(id: string) {
    const object = this.world.objects.get(id);
    if (!object) throw new Error(`Missing object snapshot ${id}`);
    if (object.kind !== "car" && object.kind !== "static")
      throw new CS2LaneSpeedUnsupportedError(
        `Object kind ${object.kind} deferred: ${id}`,
      );
    return object;
  }
  private own(id: string) {
    return (
      id === this.initial.entity ||
      this.object(id).controller === this.initial.entity
    );
  }
  private priority(id: string) {
    const object = this.world.objects.get(id);
    if (!object) return 0;
    if (
      object.kind === "bicycle" ||
      object.kind === "train" ||
      object.kind === "pedestrian"
    )
      this.object(id);
    return object.kind === "car" ? cs2VehiclePriority(!!object.emergency) : 0;
  }
  private braking(
    distance: number,
    step = this.initial.safeTimeStep,
    resultSpeed = 0,
  ) {
    return cs2MaxBrakingSpeed(
      this.initial.prefabCar,
      distance,
      step,
      resultSpeed,
    );
  }
  private limit(
    value: number,
    blocker: string | null,
    type: Cs2BlockerType,
    bounded = true,
  ) {
    if (value < this.state.maxSpeed) {
      this.state.maxSpeed = bounded
        ? clamp(
            value,
            f(this.initial.speedRange.min),
            f(this.initial.speedRange.max),
          )
        : f(value);
      this.state.blocker = blocker;
      this.state.blockerType = type;
    }
  }
  private modifiedDriveSpeed(speed: number, lane: CS2LaneSpeedLane) {
    if (!lane.condition) return speed;
    const n = clamp(multiply(subtract(lane.condition.wear, 2.5), f(2 / 15)));
    return multiply(speed, subtract(1, multiply(multiply(n, n), 0.5)));
  }
  private caution(
    lane: CS2LaneSpeedLane,
    speedLimit: number,
    offset: readonly [number, number],
    inverse: boolean,
    distanceOffset: number,
  ) {
    const a = lane.carLane.cautionStart ?? 255,
      b = lane.carLane.cautionEnd ?? 0;
    if (b < a) return;
    const min = bytePosition(a),
      max = bytePosition(b),
      lo = inverse ? offset[1] : offset[0],
      hi = inverse ? offset[0] : offset[1];
    if (max <= lo || min >= hi) return;
    const d = add(
        distanceOffset,
        multiply(
          lane.curve.length,
          Math.max(0, inverse ? subtract(hi, max) : subtract(min, lo)),
        ),
      ),
      speed = multiply(speedLimit, lane.carLane.flags & 0x100 ? 0.8 : 0.5);
    this.limit(
      Math.max(speed, this.braking(d, this.initial.safeTimeStep, speed)),
      null,
      B.caution,
    );
  }
  private firstSpeed(
    lane: CS2LaneSpeedLane,
    second: CS2LaneSpeedLane | undefined,
    delta: number,
  ) {
    const flags = lane.carLane.flags,
      speedLimit = multiply(
        lane.carLane.speedLimit,
        this.initial.speedLimitFactor,
      );
    let speed = cs2MaxDriveSpeed(
        this.initial.prefabCar,
        speedLimit,
        lane.carLane.curviness,
      ),
      yieldOverride = 0;
    const isRoundabout = !(flags & F.approach) && !!(flags & F.roundabout);
    if (!(flags & F.approach) && flags & (F.levelCrossing | F.trafficLights)) {
      if (lane.signal?.type === 1) yieldOverride = -1;
      else if (lane.signal?.type === 3) yieldOverride = 1;
    }
    speed = this.modifiedDriveSpeed(speed, lane);
    if (this.initial.priority < 102 && lane.reservation) {
      if (!second && cs2ReservationPriority(lane.reservation) === 102)
        speed = multiply(speed, 0.5);
      else if (
        second?.reservation &&
        (delta < f(0.9)
          ? cs2ReservationPriority(lane.reservation) === 102 ||
            cs2ReservationPriority(second.reservation) === 102
          : cs2ReservationPriority(second.reservation) === 102)
      )
        speed = multiply(speed, 0.5);
    }
    this.limit(speed, null, B.limit);
    return { flags, speedLimit, yieldOverride, isRoundabout };
  }
  private setLane(id: string, offset: readonly [number, number]) {
    this.state.lane = id;
    this.curve = this.lane(id).curve;
    this.state.curveOffset = tuple(offset);
  }
  private advance(end: V, start: V, interval: number, curveLength: number) {
    const travelled = Math.max(
      0.001,
      lerp(distance(start, end), multiply(curveLength, interval), interval),
    );
    if (travelled > 1) {
      this.state.previousPosition = { ...this.state.currentPosition };
      this.state.previousDistance = this.state.distance;
    }
    this.state.currentPosition = vec(end);
    this.state.distance = add(this.state.distance, travelled);
    const braking = cs2BrakingDistance(
      this.initial.prefabCar,
      this.state.maxSpeed,
      this.initial.safeTimeStep,
    );
    return (
      subtract(add(this.state.distance, this.initial.distanceOffset), 20) >=
        braking || this.state.maxSpeed === f(this.initial.speedRange.min)
    );
  }
  iterateFirstLane(input: CS2LaneSpeedFirstInput): CS2LaneSpeedResult {
    const lane = this.lane(input.lane),
      offset = vec(input.curveOffset),
      inverse = offset.z < offset.x,
      laneOffset = f(inverse ? -input.laneOffset : input.laneOffset),
      start = position(lane.curve, offset.x),
      lanePosition = cs2LanePosition(
        sourceCurve(lane.curve),
        offset.x,
        laneOffset,
      );
    this.state.previousPosition = { ...this.state.currentPosition };
    this.state.distance = distance(this.state.currentPosition, lanePosition);
    const values = this.firstSpeed(lane, undefined, 0),
      d = add(
        add(this.state.distance, -this.initial.prefabGeometry.max.z),
        this.initial.distanceOffset,
      );
    this.caution(lane, values.speedLimit, [offset.x, offset.z], inverse, d);
    this.setLane(input.lane, [offset.x, offset.z]);
    this.state.nextLane = input.nextLane ?? null;
    this.state.nextOffset = tuple(input.nextOffset ?? [0, 0]);
    this.state.currentPosition = start;
    this.checkCurrentLane(
      d,
      laneOffset,
      [offset.x, offset.y],
      inverse,
      false,
      false,
    );
    this.checkOverlappingLanes(
      d,
      offset.y,
      laneOffset,
      values.yieldOverride,
      values.speedLimit,
      values.isRoundabout,
      inverse,
      input.requestSpace,
      false,
    );
    const stop = this.advance(
      position(lane.curve, offset.z),
      start,
      Math.abs(subtract(offset.z, offset.x)),
      lane.curve.length,
    );
    return { stop, laneFlags: values.flags, needSignal: false };
  }
  iterateChangingLane(input: CS2LaneSpeedChangingInput): CS2LaneSpeedResult {
    const lane1 = this.lane(input.lane1),
      lane2 = this.lane(input.lane2),
      delta = clamp(f(input.laneDelta)),
      offset = vec(input.curveOffset),
      inverse = offset.z < offset.x,
      p1 = position(lane1.curve, offset.x),
      p2 = position(lane2.curve, offset.x),
      start = vectorLerp(p1, p2, delta),
      lateral = vectorLerp(
        cs2LanePosition(sourceCurve(lane1.curve), offset.x, input.laneOffset1),
        cs2LanePosition(sourceCurve(lane2.curve), offset.x, input.laneOffset2),
        delta,
      );
    this.state.previousPosition = { ...this.state.currentPosition };
    this.state.distance = distance(this.state.currentPosition, lateral);
    const values = this.firstSpeed(lane1, lane2, delta),
      d = add(
        add(this.state.distance, -this.initial.prefabGeometry.max.z),
        this.initial.distanceOffset,
      );
    this.caution(lane1, values.speedLimit, [offset.x, offset.z], inverse, d);
    if (delta < f(0.9)) {
      this.setLane(input.lane1, [offset.x, offset.z]);
      this.state.currentPosition = p1;
      this.checkCurrentLane(
        d,
        input.laneOffset1,
        [offset.x, offset.y],
        inverse,
        false,
        false,
      );
      this.checkOverlappingLanes(
        d,
        offset.y,
        input.laneOffset1,
        values.yieldOverride,
        values.speedLimit,
        values.isRoundabout,
        inverse,
        input.requestSpace,
        false,
      );
    }
    this.setLane(input.lane2, [offset.x, offset.z]);
    this.state.nextLane = input.nextLane ?? null;
    this.state.nextOffset = tuple(input.nextOffset ?? [0, 0]);
    this.state.currentPosition = p2;
    this.checkCurrentLane(
      d,
      input.laneOffset2,
      [offset.x, offset.y],
      inverse,
      true,
      delta === 0,
    );
    this.checkOverlappingLanes(
      d,
      offset.y,
      input.laneOffset2,
      0,
      values.speedLimit,
      values.isRoundabout,
      inverse,
      input.requestSpace,
      true,
    );
    const stop = this.advance(
      position(lane2.curve, offset.z),
      start,
      Math.abs(subtract(offset.z, offset.x)),
      lerp(lane1.curve.length, lane2.curve.length, delta),
    );
    return { stop, laneFlags: values.flags, needSignal: false };
  }
  iterateNextLane(input: CS2LaneSpeedNextInput): CS2LaneSpeedResult {
    if (!this.world.lanes.has(input.lane))
      return { stop: false, laneFlags: 0, needSignal: false };
    const lane = this.lane(input.lane),
      offset = tuple(input.curveOffset),
      originalFlags = lane.carLane.flags,
      speedLimit = multiply(
        lane.carLane.speedLimit,
        this.initial.speedLimitFactor,
      ),
      inverse = offset[1] < offset[0],
      front = f(-this.initial.prefabGeometry.max.z);
    let flags = originalFlags,
      drive = cs2MaxDriveSpeed(
        this.initial.prefabCar,
        speedLimit,
        lane.carLane.curviness,
      ),
      d = add(this.state.distance, front),
      yieldOverride = 0,
      roundabout = false,
      blocker: string | null = null,
      type: Cs2BlockerType = B.limit,
      needSignal = false;
    if (!(flags & F.approach)) {
      if (!(input.laneFlags & F.approach)) {
        flags &= ~(F.levelCrossing | F.stop | F.trafficLights);
        if (!(flags & F.sideConnection)) flags &= ~turnMask;
      }
      roundabout = !!(flags & F.roundabout);
      const brakingDistance = cs2BrakingDistance(
        this.initial.prefabCar,
        this.initial.currentSpeed,
        0,
      );
      const checkSpace = () => {
        const result = this.checkSpace(input.lane, offset, input.nextLanes);
        blocker = result.blocker;
        return result.space;
      };
      if (flags & (F.levelCrossing | F.trafficLights) && lane.signal) {
        if (!roundabout && brakingDistance <= d && !checkSpace()) {
          drive = 0;
          type = B.continuing;
        } else {
          needSignal = true;
          if (lane.signal.type === 1) {
            if (
              (this.initial.priority < 108 || lane.signal.flags & 2) &&
              brakingDistance <= add(d, 1)
            ) {
              drive = 0;
              blocker = lane.signal.blocker;
              type = B.signal;
              yieldOverride = 1;
            } else yieldOverride = -1;
          } else if (lane.signal.type === 2) {
            if (
              (this.initial.priority < 108 || lane.signal.flags & 2) &&
              brakingDistance <= d
            ) {
              drive = 0;
              blocker = lane.signal.blocker;
              type = B.signal;
            }
          } else if (lane.signal.type === 3) yieldOverride = 1;
        }
      } else if (flags & F.stop) {
        if (this.initial.priority < 108 && d >= f(1.1)) drive = 0;
        else if (!roundabout && brakingDistance <= d && !checkSpace()) {
          drive = 0;
          type = B.continuing;
        }
        yieldOverride = 1;
      } else if (
        flags & turnMask &&
        !roundabout &&
        brakingDistance <= d &&
        !checkSpace()
      ) {
        drive = 0;
        type = B.continuing;
      }
    }
    d = add(d, this.initial.distanceOffset);
    const cap =
      drive === 0
        ? this.braking(Math.max(0, subtract(d, 0.5)))
        : Math.max(
            this.modifiedDriveSpeed(drive, lane),
            this.braking(
              this.state.distance,
              this.initial.timeStep,
              this.modifiedDriveSpeed(drive, lane),
            ),
          );
    this.limit(cap, blocker, type);
    this.caution(lane, speedLimit, offset, inverse, d);
    this.setLane(input.lane, offset);
    this.state.nextLane = input.nextLanes[0]?.lane ?? null;
    this.state.nextOffset = tuple(input.nextLanes[0]?.curvePosition ?? [0, 0]);
    const min = (inverse ? offset[0] < 1 : offset[0] > 0)
      ? offset[0]
      : f(input.minOffset);
    this.checkCurrentLane(
      d,
      input.laneOffset,
      [min, min],
      inverse,
      false,
      false,
    );
    this.checkOverlappingLanes(
      d,
      min,
      input.laneOffset,
      yieldOverride,
      speedLimit,
      roundabout,
      inverse,
      input.requestSpace,
      false,
    );
    const stop = this.advance(
      position(lane.curve, offset[1]),
      this.state.currentPosition,
      Math.abs(subtract(offset[1], offset[0])),
      lane.curve.length,
    );
    return { stop, laneFlags: originalFlags, needSignal };
  }
  iterateTarget(targetPosition: V, maxLaneSpeed?: number) {
    const speed =
      maxLaneSpeed ??
      cs2MaxDriveSpeed(this.initial.prefabCar, f(11.111112), f(Math.PI / 12));
    let cap = this.braking(this.state.distance, this.initial.timeStep, speed);
    this.state.distance = add(
      this.state.distance,
      distance(this.state.currentPosition, targetPosition),
    );
    cap = Math.min(
      cap,
      this.braking(this.state.distance, this.initial.timeStep),
    );
    this.limit(cap, null, B.none);
  }
  private checkCurrentLane(
    distanceOffset: number,
    laneOffset: number,
    min: readonly [number, number],
    inverse: boolean,
    inverseLaneOffset: boolean,
    checkCanUse: boolean,
  ) {
    const entries = this.lane(this.state.lane!).objects ?? [],
      d = subtract(distanceOffset, 0.9);
    for (const entry of entries) {
      if (entry.object === this.initial.entity) continue;
      const object = this.object(entry.object),
        [x, y] = entry.curvePosition.map(f),
        backward = y < x;
      if (checkCanUse && object.controller === this.initial.entity) continue;
      const behind = inverse
        ? !backward
          ? x >= min[0]
          : y >= min[1] && (y > 0 || x >= min[0])
        : !backward
          ? y <= min[1] && (y < 1 || x <= min[0])
          : x <= min[0];
      if (behind) {
        if (
          checkCanUse &&
          multiply(subtract(x, min[0]), this.curve!.length) >
            -(object.geometry?.max.z ?? 0)
        )
          this.state.canChangeLane = 0;
        continue;
      }
      if (object.controller === this.initial.entity) continue;
      const speed = this.objectSpeed(entry.object, x),
        type = inverse === backward ? B.continuing : B.oncoming;
      this.updateMaxSpeed(
        entry.object,
        type,
        inverse ? -speed : speed,
        x,
        1,
        d,
        0,
        laneOffset,
        entry.object === this.initial.ignore,
        inverse,
        backward,
        inverseLaneOffset,
        this.state.currentPosition,
      );
    }
  }
  private objectSpeed(id: string, parameter: number) {
    const object = this.object(id);
    return object.velocity
      ? dot(object.velocity, normal(tangent(this.curve!, parameter)))
      : 0;
  }
  private updateMaxSpeed(
    id: string,
    type: Cs2BlockerType,
    objectSpeed: number,
    parameter: number,
    factor: number,
    distanceOffset: number,
    overlapOffset: number,
    _laneOffset: number,
    ignore: boolean,
    inverse1: boolean,
    inverse2: boolean,
    _inverseLaneOffset: boolean,
    current: V,
  ) {
    const object = this.object(id),
      rear = -(object.geometry?.min.z ?? 0),
      range =
        inverse1 !== inverse2
          ? [this.state.curveOffset[1], this.state.curveOffset[0]]
          : this.state.curveOffset,
      diff = range.map((x) =>
        inverse2 ? subtract(x, parameter) : subtract(parameter, x),
      );
    if (multiply(diff[1], this.curve!.length) >= rear) return;
    diff[0] = Math.min(0, diff[0]);
    const t = add(parameter, inverse2 ? diff[0] : -diff[0]),
      projected = position(this.curve!, t);
    let d = add(
      distance(projected, current),
      multiply(diff[0], this.curve!.length),
    );
    const physical = object.position;
    d =
      dot(
        minus(physical, current),
        minus(current, this.state.previousPosition),
      ) < 0
        ? Math.min(
            d,
            subtract(
              subtract(
                add(
                  distance(physical, this.state.previousPosition),
                  this.state.previousDistance,
                ),
                this.state.distance,
              ),
              Math.min(0, overlapOffset),
            ),
          )
        : Math.min(d, distance(physical, current));
    d = add(multiply(subtract(d, rear), factor), distanceOffset);
    let cap: number;
    if (objectSpeed > f(0.001) && object.car) {
      objectSpeed = multiply(
        Math.max(
          0,
          subtract(
            objectSpeed,
            multiply(multiply(object.car.braking, this.initial.timeStep), 2),
          ),
        ),
        factor,
      );
      if (this.initial.prefabCar.braking >= object.car.braking) {
        d = add(d, multiply(objectSpeed, this.initial.safeTimeStep));
        cap = this.braking(d, this.initial.safeTimeStep, objectSpeed);
      } else {
        d = add(
          d,
          cs2BrakingDistance(
            object.car,
            objectSpeed,
            this.initial.safeTimeStep,
          ),
        );
        cap = this.braking(d);
      }
    } else cap = this.braking(d);
    if (type === B.oncoming) {
      this.state.oncoming = Math.max(
        this.state.oncoming,
        subtract(2, multiply(cap, f(1 / 6))),
      );
      cap = clamp(
        Math.max(cap, 3),
        f(this.initial.speedRange.min),
        f(this.initial.speedRange.max),
      );
      this.limit(cap, null, type, false);
    } else {
      if (ignore && cap < 3) cap = 3;
      cap = clamp(
        cap,
        f(this.initial.speedRange.min),
        f(this.initial.speedRange.max),
      );
      this.limit(cap, id, type, false);
    }
  }
  private checkOverlappingLanes(
    origDistance: number,
    origMin: number,
    laneOffset: number,
    yieldOverride: number,
    speedLimit: number,
    roundabout: boolean,
    inverse: boolean,
    requestSpace: boolean,
    inverseLaneOffset: boolean,
  ) {
    const currentLane = this.lane(this.state.lane!),
      overlaps = currentLane.overlaps ?? [];
    if (!overlaps.length) return;
    origDistance = subtract(origDistance, 0.9);
    const originalId = this.state.lane!,
      originalCurve = this.curve!,
      originalOffset = tuple(this.state.curveOffset),
      ownReservation = currentLane.reservation;
    let roundaboutLimit = 1,
      priority = this.initial.priority;
    if (
      ownReservation &&
      cs2ReservationPriority(ownReservation) >= 108 &&
      priority < 106
    )
      priority = 106;
    for (const overlap of overlaps) {
      if (overlap.flags & 2048) continue;
      const positions = [
        overlap.thisStart,
        overlap.thisEnd,
        overlap.otherStart,
        overlap.otherEnd,
      ].map(bytePosition);
      if (
        inverse
          ? positions[0] >= originalOffset[0]
          : positions[1] <= originalOffset[0]
      )
        continue;
      this.setLane(
        overlap.other,
        inverse ? [positions[3], positions[2]] : [positions[2], positions[3]],
      );
      const other = this.lane(overlap.other),
        extra = Math.max(
          0,
          inverse
            ? subtract(positions[1], origMin)
            : subtract(origMin, positions[0]),
        ),
        entryMerge = inverse ? 2 | 32 : 1 | 16,
        exitMerge = inverse ? 1 | 16 : 2 | 32;
      if (
        roundabout &&
        overlap.priorityDelta > 0 &&
        overlap.flags & 128 &&
        positions[0] >= originalOffset[0]
      )
        positions[0] = roundaboutLimit = Math.min(
          roundaboutLimit,
          positions[0],
        );
      const offset = multiply(
          originalCurve.length,
          inverse
            ? subtract(originalOffset[0], positions[1])
            : subtract(positions[0], originalOffset[0]),
        ),
        d = add(origDistance, offset),
        factor = multiply(overlap.parallelism, f(1 / 128)),
        canStop =
          cs2BrakingDistance(
            this.initial.prefabCar,
            this.initial.currentSpeed,
            this.initial.timeStep,
          ) <= add(d, 0.9),
        type = overlap.flags & exitMerge ? B.continuing : B.crossing;
      let effectivePriority = priority;
      if (!(overlap.flags & entryMerge)) {
        const inside = inverse
          ? positions[1] >= origMin
          : positions[0] <= origMin;
        if (inside) {
          if (roundabout)
            (this.state.temporaryLanes as string[]).push(overlap.other);
        } else if (!(
          roundabout && this.state.temporaryLanes.includes(overlap.other)
        )) {
          let signalYield = yieldOverride;
          if (other.signal?.type === 1) signalYield++;
          else if (other.signal?.type === 3) signalYield--;
          let delta = signalYield !== 0 ? signalYield : overlap.priorityDelta;
          if (requestSpace && delta > 0) delta = 0;
          effectivePriority -= delta;
          if (other.reservation) {
            const reservationPriority = cs2ReservationPriority(
                other.reservation,
              ),
              threshold = inverse
                ? 0
                : Math.max(add(extra, positions[2]), this.state.curveOffset[0]);
            if (
              cs2ReservationOffset(other.reservation) > threshold ||
              reservationPriority > effectivePriority
            )
              this.limit(
                clamp(
                  this.braking(d),
                  f(this.initial.speedRange.min),
                  f(this.initial.speedRange.max),
                ),
                null,
                type,
                false,
              );
            else if (
              (overlap.flags & 1024
                ? 1
                : signalYield !== 0
                  ? yieldOverride
                  : overlap.priorityDelta) > 0
            ) {
              const cap = this.braking(d);
              if (cap >= multiply(speedLimit, 0.5))
                this.limit(cap, null, type, false);
            }
            if (canStop && !requestSpace && reservationPriority === 96) {
              const space = this.checkOverlapSpace(
                originalId,
                originalOffset,
                this.state.nextLane,
                this.state.nextOffset,
                [positions[0], positions[1]],
              );
              if (!space.space)
                this.limit(this.braking(d), space.blocker, type, false);
            }
          }
        }
      }
      // Original IL_051f: object scan is unconditional after reservation handling.
      for (const entry of other.objects ?? []) {
        if (this.own(entry.object)) continue;
        const object = this.object(entry.object),
          owner = object.controller ?? entry.object;
        let [x, y] = entry.curvePosition.map(f);
        const backward = y < x;
        let speed = this.objectSpeed(entry.object, x);
        if (
          !(overlap.flags & entryMerge) &&
          ((inverse ? positions[1] <= origMin : positions[0] >= origMin) ||
            (backward ? y < positions[3] : y > positions[2]))
        ) {
          if (this.priority(owner) > effectivePriority)
            y = add(
              y,
              divide(multiply(speed, 2), Math.max(1, this.curve!.length)),
            );
        }
        if (
          backward
            ? y >= subtract(positions[3], extra)
            : y <= add(positions[2], extra)
        )
          continue;
        speed = inverse ? -speed : speed;
        const current = position(
          this.curve!,
          backward !== inverse
            ? this.state.curveOffset[1]
            : this.state.curveOffset[0],
        );
        this.updateMaxSpeed(
          entry.object,
          type,
          speed,
          x,
          factor,
          d,
          offset,
          laneOffset,
          entry.object === this.initial.ignore,
          inverse,
          backward,
          inverseLaneOffset,
          current,
        );
      }
    }
  }
  private projectedRear(id: string, origin: V, direction: V) {
    const object = this.object(id);
    let available = subtract(
      dot(minus(object.position, origin), direction),
      -(object.geometry?.min.z ?? 0),
    );
    const speed = object.velocity ? dot(object.velocity, direction) : 0;
    if (speed > f(0.001) && object.car)
      available = add(
        available,
        cs2BrakingDistance(object.car, speed, this.initial.safeTimeStep),
      );
    return available;
  }
  private checkOverlapSpace(
    currentId: string,
    currentOffset: readonly [number, number],
    nextId: string | null,
    nextOffset: readonly [number, number],
    overlap: readonly [number, number],
  ) {
    const current = this.lane(currentId),
      ownLength = subtract(
        this.initial.prefabGeometry.max.z,
        this.initial.prefabGeometry.min.z,
      ),
      required = add(ownLength, 1);
    let available = multiply(
        current.curve.length,
        subtract(1, currentOffset[0]),
      ),
      needed = required,
      selected: string | null = null,
      blocker: string | null = null;
    for (const entry of current.objects ?? []) {
      if (entry.curvePosition[0] < currentOffset[0] || this.own(entry.object))
        continue;
      const object = this.object(entry.object);
      if (object.velocity && object.geometry) {
        needed = add(
          needed,
          add(subtract(object.geometry.max.z, object.geometry.min.z), 1),
        );
        blocker = entry.object;
      }
      if (entry.curvePosition[1] >= overlap[1]) {
        selected = entry.object;
        break;
      }
    }
    if (!selected && nextId && this.world.lanes.has(nextId)) {
      const next = this.lane(nextId);
      available = add(available, next.curve.length);
      for (const entry of next.objects ?? [])
        if (
          entry.curvePosition[0] >= nextOffset[0] &&
          !this.own(entry.object)
        ) {
          selected = entry.object;
          break;
        }
    }
    available = Math.max(available, required);
    if (selected) {
      const object = this.object(selected);
      if (object.velocity)
        available = this.projectedRear(
          selected,
          position(current.curve, overlap[1]),
          normal(tangent(current.curve, overlap[1])),
        );
      blocker = selected;
    }
    return available >= needed
      ? { space: true, blocker: null }
      : { space: false, blocker };
  }
  private checkSpace(
    currentId: string,
    offset: readonly [number, number],
    nextLanes: readonly CS2LaneSpeedNextLane[],
  ) {
    if (!nextLanes.length) return { space: true, blocker: null };
    const boundary = (lane: CS2LaneSpeedLane) =>
        !!(lane.carLane.flags & spaceBoundaryMask) &&
        !(lane.carLane.flags & F.approach),
      validStart = (entry: CS2LaneSpeedNextLane) =>
        entry.curvePosition[0] ===
        (entry.curvePosition[1] < entry.curvePosition[0] ? 1 : 0);
    let nextEntry = nextLanes[0];
    if (!validStart(nextEntry) || !this.world.lanes.has(nextEntry.lane))
      return { space: true, blocker: null };
    let next = this.lane(nextEntry.lane),
      inverse = nextEntry.curvePosition[1] < nextEntry.curvePosition[0];
    if (boundary(next)) return { space: true, blocker: null };
    const current = this.lane(currentId);
    if (!current.overlaps) return { space: true, blocker: null };
    const ownLength = subtract(
      this.initial.prefabGeometry.max.z,
      this.initial.prefabGeometry.min.z,
    );
    let hasCrossing = false,
      available = f(3.4028234663852886e38),
      needed = ownLength,
      count = 1,
      blocker: string | null = null,
      direction = normal(tangent(next.curve, nextEntry.curvePosition[0])),
      origin = position(next.curve, nextEntry.curvePosition[0]);
    if (inverse) direction = scale(direction, -1);
    const accumulate = (id: string) => {
      const object = this.object(id);
      if (!object.velocity || !object.geometry) return;
      needed = add(
        needed,
        add(subtract(object.geometry.max.z, object.geometry.min.z), 1),
      );
      count++;
      blocker = id;
      if (available >= ownLength)
        available = this.projectedRear(id, origin, direction);
    };
    for (const overlap of current.overlaps) {
      if (!(overlap.flags & (1 | 2 | 16 | 32 | 64 | 2048))) hasCrossing = true;
      else if (
        overlap.flags & (offset[1] < offset[0] ? 1 : 2) &&
        overlap.other !== nextEntry.lane
      ) {
        for (const entry of this.lane(overlap.other).objects ?? []) {
          if (this.own(entry.object)) continue;
          const object = this.object(entry.object),
            [x, y] = entry.curvePosition;
          if (
            y < x
              ? y >= bytePosition(overlap.otherEnd)
              : y <= bytePosition(overlap.otherStart)
          ) {
            if (
              this.priority(object.controller ?? entry.object) <
              this.initial.priority
            )
              continue;
          }
          accumulate(entry.object);
        }
      }
    }
    if (!hasCrossing) return { space: true, blocker };
    for (const entry of current.objects ?? [])
      if (!this.own(entry.object)) accumulate(entry.object);
    if (available !== f(3.4028234663852886e38) && available >= ownLength)
      return { space: true, blocker: null };
    available = 0;
    let index = 1;
    for (;;) {
      const objects = next.objects ?? [];
      for (let i = 0; i < objects.length; i++) {
        const entry = objects[inverse ? objects.length - 1 - i : i],
          [x, y] = entry.curvePosition;
        if (
          y < x !== inverse ||
          (inverse
            ? x > nextEntry.curvePosition[0]
            : x < nextEntry.curvePosition[0]) ||
          this.own(entry.object)
        )
          continue;
        const object = this.object(entry.object);
        if (!object.velocity) continue;
        const projected = add(
          available,
          this.projectedRear(entry.object, origin, direction),
        );
        if (projected >= needed) return { space: true, blocker: null };
        blocker = entry.object;
        if (--count === 0) return { space: false, blocker };
        needed = add(
          needed,
          add(
            object.geometry
              ? subtract(object.geometry.max.z, object.geometry.min.z)
              : 0,
            1,
          ),
        );
      }
      available = add(available, next.curve.length);
      if (Math.max(available, ownLength) >= needed)
        return { space: true, blocker: null };
      if (index >= nextLanes.length) return { space: false, blocker };
      nextEntry = nextLanes[index++];
      if (!validStart(nextEntry) || !this.world.lanes.has(nextEntry.lane))
        return { space: false, blocker };
      next = this.lane(nextEntry.lane);
      inverse = nextEntry.curvePosition[1] < nextEntry.curvePosition[0];
      if (boundary(next)) return { space: false, blocker };
      direction = normal(tangent(next.curve, nextEntry.curvePosition[0]));
      origin = position(next.curve, nextEntry.curvePosition[0]);
      if (inverse) direction = scale(direction, -1);
    }
  }
}
