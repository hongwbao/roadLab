/** Complete source navigation path-window lifecycle. See CS2_NAVIGATION_PATHS.md. */
import type { V } from "../core/types";
import {
  cs2BrakingDistance,
  CS2_NAVIGATION_TIMESTEP,
  type CS2CarData,
} from "./cs2-driving";
import type { CS2MotionQuaternion } from "./cs2-motion";
import {
  cs2ResolveLaneSelectionMaster,
  cs2SelectCurveDistanceSquared,
  cs2SelectOptimalLanes,
  type CS2LaneSelectWorld,
} from "./cs2-lane-select";
import {
  cs2NavigationCurvePosition,
  type CS2NavigationCurrentState,
  type CS2NavigationQueuedLane,
} from "./cs2-navigation-target";

export const CS2_NAV_PATH_FLAGS = {
  endOfPath: 1,
  updateOptimalLane: 4,
  transformTarget: 8,
  parkingSpace: 0x10,
  obsolete: 0x40,
  reserved: 0x80,
  fixedLane: 0x100,
  waypoint: 0x200,
  groupTarget: 0x800,
  interruption: 0x20000,
  turnLeft: 0x40000,
  turnRight: 0x80000,
  requestSpace: 0x400000,
  connection: 0x1000000,
  area: 0x4000000,
  roundabout: 0x8000000,
  canReverse: 0x10000000,
  clearedForPathfind: 0x20000000,
} as const;
const F = CS2_NAV_PATH_FLAGS;
const P = {
  pending: 1,
  failed: 2,
  obsolete: 4,
  scheduled: 8,
  append: 16,
  updated: 32,
};
const UNSET_INVALID_PATH = 10_000_000;
const f = Math.fround;
const plus = (a: number, b: number) => f(f(a) + f(b));
const minus = (a: number, b: number) => f(f(a) - f(b));
const times = (a: number, b: number) => f(f(a) * f(b));
const divide = (a: number, b: number) => f(f(a) / f(b));
const copyV = (a: V): V => ({ x: f(a.x), y: f(a.y), z: f(a.z) });
const addV = (a: V, b: V): V => ({
  x: plus(a.x, b.x),
  y: plus(a.y, b.y),
  z: plus(a.z, b.z),
});
const mulV = (a: V, b: number): V => ({
  x: times(a.x, b),
  y: times(a.y, b),
  z: times(a.z, b),
});
const cross = (a: V, b: V): V => ({
  x: minus(times(a.y, b.z), times(a.z, b.y)),
  y: minus(times(a.z, b.x), times(a.x, b.z)),
  z: minus(times(a.x, b.y), times(a.y, b.x)),
});
const copyCurrent = (
  c: CS2NavigationCurrentState,
): CS2NavigationCurrentState => ({
  ...c,
  changeLaneId: c.changeLaneId ?? null,
  curvePosition: copyV(c.curvePosition),
  changeProgress: f(c.changeProgress),
  lanePosition: f(c.lanePosition),
  duration: f(c.duration),
  distance: f(c.distance),
});

export type CS2NavigationPathElement = {
  target: string | null;
  delta: readonly [number, number];
  flags: number;
};
export type CS2NavigationPathsTransform = {
  position: V;
  rotation: CS2MotionQuaternion;
};
export type CS2NavigationPathsWorld = {
  selection: CS2LaneSelectWorld;
  /** Actual entity existence, independent of component presence. */
  entities: ReadonlySet<string>;
  parkingLanes: ReadonlyMap<string, { flags: number }>;
  connectionLanes: ReadonlyMap<string, { flags: number }>;
  pedestrianLanes: ReadonlySet<string>;
  transforms: ReadonlyMap<string, CS2NavigationPathsTransform>;
  positions: ReadonlyMap<string, V>;
  prefabRefs: ReadonlyMap<string, string | null>;
  buildings: ReadonlyMap<string, { lotDepth: number }>;
  /** All Owner components, including vehicle/controller ownership. */
  owners: ReadonlyMap<string, string | null>;
  propertyRenters: ReadonlyMap<string, string | null>;
};
export function createCS2NavigationPathsWorld(
  world: Pick<CS2NavigationPathsWorld, "selection" | "entities"> &
    Partial<CS2NavigationPathsWorld>,
): CS2NavigationPathsWorld {
  return {
    parkingLanes: new Map(),
    connectionLanes: new Map(),
    pedestrianLanes: new Set(),
    transforms: new Map(),
    positions: new Map(),
    prefabRefs: new Map(),
    buildings: new Map(),
    owners: new Map(),
    propertyRenters: new Map(),
    ...world,
  };
}
export type CS2NavigationPathsInput = {
  entity: string;
  priority: number;
  current: CS2NavigationCurrentState;
  nextLanes: readonly CS2NavigationQueuedLane[];
  pathOwner: { flags: number; elementIndex: number };
  path: readonly CS2NavigationPathElement[];
  /** Live Unity Random.state; no constructor warm-up here. */
  randomState: number;
  transform: CS2NavigationPathsTransform;
  velocity: V;
  target: string | null;
  car: CS2CarData;
  carFlags: number;
  isBicycle?: boolean;
  blocker?: string | null;
  leftHandTraffic?: boolean;
};
export type CS2NavigationFindLaneRequest = {
  kind: "find-current-lane";
  /** The source invokes these three spatial trees in this order. */
  scopes: readonly ["net", "static-objects", "areas"];
  position: V;
  minDistance: number;
  bounds: { min: V; max: V };
  carType: number;
  accessRestrictionOwner: string | null;
  current: CS2NavigationCurrentState;
};
export type CS2NavigationFindLaneReply = { current: CS2NavigationCurrentState };
export type CS2NavigationPathsOutput = {
  current: CS2NavigationCurrentState;
  nextLanes: CS2NavigationQueuedLane[];
  pathOwner: { flags: number; elementIndex: number };
  path: CS2NavigationPathElement[];
  randomState: number;
  invalidPath: number | null;
};
export type CS2NavigationPathsAdvance =
  | ({ status: "complete" } & CS2NavigationPathsOutput)
  | {
      status: "pending";
      request: CS2NavigationFindLaneRequest;
      transaction: CS2NavigationPathsTransaction;
    };
export type CS2NavigationPathsCallbacks = {
  findCurrentLane?: (
    request: CS2NavigationFindLaneRequest,
  ) => CS2NavigationFindLaneReply | undefined;
};

function sourceFindLaneRequest(
  world: CS2NavigationPathsWorld,
  input: Pick<
    CS2NavigationPathsInput,
    "entity" | "transform" | "velocity" | "isBicycle"
  >,
  current: CS2NavigationCurrentState,
): CS2NavigationFindLaneRequest {
  let owner = world.owners.get(input.entity) ?? null;
  if (owner && world.owners.has(owner)) owner = world.owners.get(owner) ?? null;
  if (owner && world.propertyRenters.has(owner))
    owner = world.propertyRenters.get(owner) ?? null;
  const position = addV(
    copyV(input.transform.position),
    mulV(copyV(input.velocity), times(CS2_NAVIGATION_TIMESTEP, 2)),
  );
  return {
    kind: "find-current-lane",
    scopes: ["net", "static-objects", "areas"],
    position,
    minDistance: 100,
    bounds: {
      min: {
        x: minus(position.x, 100),
        y: minus(position.y, 100),
        z: minus(position.z, 100),
      },
      max: {
        x: plus(position.x, 100),
        y: plus(position.y, 100),
        z: plus(position.z, 100),
      },
    },
    carType: input.isBicycle ? 16 : 1,
    accessRestrictionOwner: owner,
    current: copyCurrent(current),
  };
}

export type CS2FoundTrailerNavigationLane = {
  laneId: string | null;
  curvePosition: { x: number; y: number };
  nextLaneId: null;
  nextPosition: { x: number; y: number };
};
export type CS2TrailerLaneFindAdvance =
  | { status: "complete"; trailer: CS2FoundTrailerNavigationLane }
  | {
      status: "pending";
      request: CS2NavigationFindLaneRequest;
      transaction: CS2TrailerLaneFindTransaction;
    };
/** The trailer overload starts FindLaneIterator with its default result, and
 * resets the trailer's next-lane fields after the spatial query returns. */
export class CS2TrailerLaneFindTransaction {
  private waiting = false;
  private done = false;
  readonly request: CS2NavigationFindLaneRequest;
  constructor(
    world: CS2NavigationPathsWorld,
    input: Pick<
      CS2NavigationPathsInput,
      "entity" | "transform" | "velocity" | "isBicycle"
    >,
  ) {
    this.request = sourceFindLaneRequest(world, input, {
      laneId: null,
      changeLaneId: null,
      curvePosition: { x: 0, y: 0, z: 0 },
      flags: 0,
      changeProgress: 0,
      lanePosition: 0,
      duration: 0,
      distance: 0,
    });
  }
  advance(reply?: CS2NavigationFindLaneReply): CS2TrailerLaneFindAdvance {
    if (this.done) throw new Error("Trailer lane query already complete");
    if (!this.waiting) {
      if (reply) throw new Error("No pending trailer spatial query");
      this.waiting = true;
      return { status: "pending", request: this.request, transaction: this };
    }
    if (!reply)
      throw new Error(
        "Trailer FindLane spatial query requires an explicit reply",
      );
    this.done = true;
    return {
      status: "complete",
      trailer: {
        laneId: reply.current.laneId,
        curvePosition: {
          x: f(reply.current.curvePosition.x),
          y: f(reply.current.curvePosition.y),
        },
        nextLaneId: null,
        nextPosition: { x: 0, y: 0 },
      },
    };
  }
}
export function cs2FindTrailerNavigationLane(
  world: CS2NavigationPathsWorld,
  input: Pick<
    CS2NavigationPathsInput,
    "entity" | "transform" | "velocity" | "isBicycle"
  >,
  callbacks: CS2NavigationPathsCallbacks = {},
): CS2TrailerLaneFindAdvance {
  const transaction = new CS2TrailerLaneFindTransaction(world, input),
    result = transaction.advance();
  if (result.status === "complete") return result;
  const reply = callbacks.findCurrentLane?.(result.request);
  return reply ? transaction.advance(reply) : result;
}

/** Source IsContinuous. Exact PathNode identity, with the explicit adapter escape
 * hatch shared by the already checked lane-selection world. */
export function cs2NavigationPathIsContinuous(
  world: CS2LaneSelectWorld,
  previous: string | null,
  previousPosition: number,
  next: string | null,
  nextPosition: number,
) {
  let prev = previous;
  const lane = prev ? world.lanes.get(prev) : undefined;
  if (lane?.slave) {
    const buffer = lane.owner && world.owners.get(lane.owner);
    if (!buffer) throw new Error(`Missing source Owner.SubLanes: ${prev}`);
    const master = buffer[lane.slave.masterIndex].laneId;
    prev = master;
    if (!world.lanes.get(master)?.master)
      return { continuous: false, sameLane: false };
  }
  if (prev === next && f(previousPosition) === f(nextPosition))
    return { continuous: true, sameLane: true };
  const a = prev ? world.lanes.get(prev) : undefined,
    b = next ? world.lanes.get(next) : undefined;
  return {
    continuous: !!(
      a?.nodes &&
      b?.nodes &&
      (world.connects
        ? world.connects(prev!, next!, "end-start")
        : a.nodes.end === b.nodes.start)
    ),
    sameLane: false,
  };
}

/** VehicleUtils.ClearNavigationForPathfind, including brake-distance look-ahead.
 * This is distinct from the pending-path reserved-prefix truncation below. */
export function cs2ClearNavigationForPathfind(input: {
  world: CS2NavigationPathsWorld;
  current: CS2NavigationCurrentState;
  nextLanes: readonly CS2NavigationQueuedLane[];
  velocity: V;
  car: CS2CarData;
  isBicycle?: boolean;
}) {
  const current = copyCurrent(input.current);
  const nextLanes = input.nextLanes.map((l) => ({
    ...l,
    start: f(l.start),
    end: f(l.end),
  }));
  const eligible = (lane: string | null) =>
    !!lane &&
    (!!input.world.selection.lanes.get(lane)?.carLane ||
      (!!input.isBicycle && input.world.pedestrianLanes.has(lane)));
  const curveLength = (lane: string | null) => {
    const c = lane && input.world.selection.lanes.get(lane)?.curve;
    if (!c)
      throw new Error(`Missing Curve in ClearNavigationForPathfind: ${lane}`);
    return f(c.length);
  };
  if (!eligible(current.laneId)) {
    current.curvePosition.z = current.curvePosition.y;
    return { current, nextLanes };
  }
  const dt = CS2_NAVIGATION_TIMESTEP,
    ahead = plus(1.0666667, dt),
    v = copyV(input.velocity),
    speed = Math.min(
      f(
        Math.sqrt(
          plus(plus(times(v.x, v.x), times(v.y, v.y)), times(v.z, v.z)),
        ),
      ),
      f(input.car.maxSpeed),
    );
  let length = curveLength(current.laneId),
    reverse = current.curvePosition.z < current.curvePosition.x,
    distance = Math.max(
      0,
      minus(
        plus(cs2BrakingDistance(input.car, speed, dt), times(speed, ahead)),
        0.01,
      ),
    ),
    delta = plus(divide(distance, Math.max(f(1e-6), length)), 1e-6),
    end = plus(current.curvePosition.x, reverse ? -delta : delta);
  current.flags |= F.clearedForPathfind;
  if (
    reverse ? current.curvePosition.z <= end : end <= current.curvePosition.z
  ) {
    current.curvePosition.z = end;
    nextLanes.length = 0;
    return { current, nextLanes };
  }
  distance = minus(
    distance,
    times(
      length,
      Math.abs(minus(current.curvePosition.z, current.curvePosition.x)),
    ),
  );
  let count = 0;
  while (count < nextLanes.length && distance > 0) {
    const lane = nextLanes[count];
    if (!eligible(lane.laneId)) break;
    length = curveLength(lane.laneId);
    reverse = lane.end < lane.start;
    delta = divide(distance, Math.max(f(1e-6), length));
    end = plus(lane.start, reverse ? -delta : delta);
    lane.flags |= F.clearedForPathfind;
    count++;
    if (reverse ? lane.end <= end : end <= lane.end) {
      lane.end = end;
      break;
    }
    distance = minus(
      distance,
      times(length, Math.abs(minus(lane.end, lane.start))),
    );
  }
  if (count < nextLanes.length) nextLanes.length = count;
  return { current, nextLanes };
}

/** Transaction only pauses at the actual spatial search boundary. No partial
 * state or RNG is committed while waiting, and resume never reruns the prefix. */
export class CS2NavigationPathsTransaction {
  private readonly steps: Generator<
    CS2NavigationFindLaneRequest,
    CS2NavigationPathsOutput,
    CS2NavigationFindLaneReply
  >;
  private waiting = false;
  private done = false;
  private current: CS2NavigationCurrentState;
  private nextLanes: CS2NavigationQueuedLane[];
  private pathOwner: { flags: number; elementIndex: number };
  private path: CS2NavigationPathElement[];
  private randomState: number;
  private invalidPath = UNSET_INVALID_PATH;
  constructor(
    readonly world: CS2NavigationPathsWorld,
    readonly input: CS2NavigationPathsInput,
  ) {
    this.current = copyCurrent(input.current);
    this.nextLanes = input.nextLanes.map((l) => ({
      ...l,
      start: f(l.start),
      end: f(l.end),
    }));
    this.pathOwner = { ...input.pathOwner };
    this.path = input.path.map((p) => ({
      ...p,
      delta: [f(p.delta[0]), f(p.delta[1])],
    }));
    this.randomState = input.randomState >>> 0;
    this.steps = this.update();
  }
  advance(reply?: CS2NavigationFindLaneReply): CS2NavigationPathsAdvance {
    if (this.done)
      throw new Error("Navigation path transaction already complete");
    if (this.waiting && !reply)
      throw new Error("FindLane spatial query requires an explicit reply");
    if (!this.waiting && reply)
      throw new Error("No pending FindLane spatial query");
    const step = this.steps.next(reply as CS2NavigationFindLaneReply);
    this.waiting = !step.done;
    if (step.done) {
      this.done = true;
      return { status: "complete", ...step.value };
    }
    return { status: "pending", request: step.value, transaction: this };
  }
  private nextInt(max: number) {
    const old = this.randomState;
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    this.randomState >>>= 0;
    return Math.floor((old * max) / 4294967296);
  }
  private findLaneRequest(): CS2NavigationFindLaneRequest {
    this.current.flags &= ~(
      F.transformTarget |
      F.parkingSpace |
      F.obsolete |
      F.turnLeft |
      F.turnRight |
      F.area
    );
    this.current.laneId = null;
    this.current.changeLaneId = null;
    return sourceFindLaneRequest(this.world, this.input, this.current);
  }
  private transformTarget() {
    let target = this.input.target;
    if (target && this.world.propertyRenters.has(target))
      target = this.world.propertyRenters.get(target) ?? null;
    return target &&
      (this.world.transforms.has(target) || this.world.positions.has(target))
      ? target
      : null;
  }
  private transformPosition(entity: string | null): V | null {
    if (!entity) return null;
    const transform = this.world.transforms.get(entity);
    if (transform) {
      if (!this.world.prefabRefs.has(entity))
        throw new Error(
          `Missing PrefabRef for source transform target: ${entity}`,
        );
      const prefab = this.world.prefabRefs.get(entity);
      const building = prefab ? this.world.buildings.get(prefab) : undefined;
      if (!building) return copyV(transform.position);
      const q = transform.rotation,
        v = { x: 0, y: 0, z: times(building.lotDepth, 4) },
        t = mulV(cross(q, v), 2),
        rotated = addV(addV(v, mulV(t, q.w)), cross(q, t));
      return addV(copyV(transform.position), rotated);
    }
    const position = this.world.positions.get(entity);
    return position ? copyV(position) : null;
  }
  private updateSlave(lane: CS2NavigationQueuedLane, position: V) {
    const record = this.world.selection.lanes.get(lane.laneId);
    if (record?.slave) {
      const buffer =
        record.owner && this.world.selection.owners.get(record.owner);
      if (!buffer)
        throw new Error(`Missing source Owner.SubLanes: ${lane.laneId}`);
      let selected = record.slave.minIndex,
        min = f(3.4028234663852886e38);
      for (
        let i = record.slave.minIndex;
        i <= Math.min(record.slave.maxIndex, buffer.length - 1);
        i++
      ) {
        if (!(buffer[i].pathMethods & (this.input.isBicycle ? 16384 : 2)))
          continue;
        const curve = this.world.selection.lanes.get(buffer[i].laneId)?.curve;
        if (!curve)
          throw new Error(
            `Missing Curve for source slave selection: ${buffer[i].laneId}`,
          );
        const distance = cs2SelectCurveDistanceSquared(
          curve,
          position,
        ).distanceSquared;
        if (distance < min) {
          min = distance;
          selected = i;
        }
      }
      lane.laneId = buffer[selected].laneId;
    }
    lane.flags |= F.fixedLane;
  }
  private resolveMaster(lane: CS2NavigationQueuedLane, fixed: boolean) {
    const resolved = cs2ResolveLaneSelectionMaster({
      world: this.world.selection,
      lane,
      randomState: this.randomState,
      isBicycle: this.input.isBicycle,
      ...(fixed
        ? {
            fixedStartCurrent: this.current,
            transformPosition:
              this.current.flags & F.transformTarget
                ? this.transformPosition(this.current.laneId)
                : null,
          }
        : {}),
    });
    this.randomState = resolved.randomState;
    return resolved.lane;
  }
  private clearReservedPrefix() {
    if (!(this.current.flags & F.clearedForPathfind))
      this.current.curvePosition.z = this.current.curvePosition.y;
    let invalid = this.invalidPath;
    if (invalid > 0) {
      for (let i = 0; i < this.nextLanes.length; i++)
        if (!(this.nextLanes[i].flags & (F.reserved | F.clearedForPathfind))) {
          invalid = Math.min(i, invalid);
          break;
        }
    }
    invalid = Math.max(invalid, 0);
    if (invalid < this.nextLanes.length) this.nextLanes.length = invalid;
  }
  private fill() {
    if (!(this.current.flags & (F.endOfPath | F.parkingSpace | F.waypoint))) {
      for (let i = 0; i <= 12; i++) {
        if (i >= this.nextLanes.length) {
          if (i === 12) {
            if (this.pathOwner.flags & P.pending) break;
            const count = Math.min(
              40000,
              this.path.length - this.pathOwner.elementIndex,
            );
            if (count <= 0) break;
            const index = Math.trunc(
              (this.nextInt(count) * (this.nextInt(count) + 1)) / count,
            );
            const sampledTarget =
              this.path[this.pathOwner.elementIndex + index].target;
            if (
              sampledTarget !== null &&
              this.world.entities.has(sampledTarget)
            )
              break;
            this.invalidPath = this.nextLanes.length;
            return;
          }
          i = this.nextLanes.length;
          if (this.pathOwner.elementIndex >= this.path.length) {
            if (this.pathOwner.flags & P.pending) break;
            const target = this.transformTarget();
            if (i > 0) {
              const last = this.nextLanes[i - 1];
              if (
                !(last.flags & F.transformTarget) &&
                (this.input.carFlags & 6) !== 6 &&
                target
              ) {
                if (!(last.flags & F.groupTarget)) {
                  const lane = {
                    laneId: last.laneId,
                    flags: last.flags & (F.connection | F.area),
                    start: last.end,
                    end: last.end,
                  };
                  const position = this.transformPosition(target);
                  if (position) this.updateSlave(lane, position);
                  lane.flags |=
                    F.groupTarget | (this.input.carFlags & 2 ? F.endOfPath : 0);
                  this.nextLanes.push(lane);
                  this.current.flags |= F.updateOptimalLane;
                  if (this.input.carFlags & 2) break;
                  continue;
                }
                this.nextLanes.push({
                  laneId: target,
                  start: 0,
                  end: 0,
                  flags: F.endOfPath | F.transformTarget,
                });
                this.current.flags |= F.updateOptimalLane;
                break;
              }
              last.flags |= F.endOfPath;
              this.current.flags |= F.updateOptimalLane;
              break;
            }
            if (
              this.current.flags & F.transformTarget ||
              this.input.carFlags & 2 ||
              !target
            ) {
              this.current.flags |= F.endOfPath;
              break;
            }
            this.nextLanes.push({
              laneId: target,
              start: 0,
              end: 0,
              flags: F.endOfPath | F.transformTarget,
            });
            this.current.flags |= F.updateOptimalLane;
            break;
          }
          const element = this.path[this.pathOwner.elementIndex++];
          // Entity.Null never carries an ECS lane/transform component. The
          // original falls through all component checks and invalidates here.
          if (element.target === null) {
            this.invalidPath = i;
            return;
          }
          let lane: CS2NavigationQueuedLane = {
            laneId: element.target,
            start: element.delta[0],
            end: element.delta[1],
            flags: 0,
          };
          const component = this.world.selection.lanes.get(lane.laneId),
            carLane = component?.carLane;
          if (
            carLane ||
            (this.input.isBicycle &&
              this.world.pedestrianLanes.has(lane.laneId))
          ) {
            const netFlags = carLane?.flags ?? 0;
            if (
              this.input.isBicycle &&
              netFlags & 0x4000 &&
              !(element.flags & 2)
            ) {
              this.invalidPath = i;
              return;
            }
            if (!(netFlags & 0x100000)) {
              const left = !!(netFlags & (2 | 0x10 | 0x40000)),
                right = !!(netFlags & (0x20 | 0x20000 | 0x80000));
              if (left && !right) lane.flags |= F.turnLeft;
              if (right && !left) lane.flags |= F.turnRight;
            }
            if ((netFlags & (0x200000 | 0x400000)) === 0x400000)
              lane.flags |= F.roundabout;
            if (netFlags & 0x80 && !this.input.isBicycle)
              lane.flags |= F.canReverse;
            const owner = component?.owner;
            if (
              netFlags & 1 &&
              (netFlags & (2 | 0x20000) ||
                (!!owner && !!this.world.selection.lanes.get(owner)?.curve))
            )
              lane.flags |= F.requestSpace;
            lane.flags |= F.updateOptimalLane;
            this.current.flags |= F.updateOptimalLane;
            const previous = i === 0 ? this.current : this.nextLanes[i - 1];
            const previousId = previous.laneId,
              previousFlags = previous.flags;
            const previousParking =
              previousId && this.world.parkingLanes.get(previousId);
            if (previousFlags & F.parkingSpace && previousParking) {
              previous.flags &= ~(F.turnLeft | F.turnRight);
              if (previousParking.flags & 0x1000) previous.flags |= F.turnLeft;
              if (previousParking.flags & 0x800) previous.flags |= F.turnRight;
            }
            lane = this.resolveMaster(
              lane,
              i === 0 &&
                (this.current.flags & (F.fixedLane | F.connection)) ===
                  F.fixedLane,
            );
            if (element.flags & 2) {
              const previousId =
                  i === 0 ? this.current.laneId : this.nextLanes[i - 1].laneId,
                previousPosition =
                  i === 0
                    ? this.current.curvePosition.z
                    : this.nextLanes[i - 1].end,
                continuity = cs2NavigationPathIsContinuous(
                  this.world.selection,
                  previousId,
                  previousPosition,
                  element.target,
                  element.delta[0],
                );
              if (continuity.continuous) {
                if (continuity.sameLane) {
                  if (i === 0) this.current.curvePosition.z = element.delta[1];
                  else this.nextLanes[i - 1].end = element.delta[1];
                  continue;
                }
              } else lane.flags |= F.interruption;
            }
            this.nextLanes.push(lane);
            continue;
          }
          const parking = this.world.parkingLanes.get(lane.laneId);
          if (parking) {
            lane.flags |= F.parkingSpace | F.fixedLane;
            if (parking.flags & 0x800) lane.flags |= F.turnLeft;
            if (parking.flags & 0x1000) lane.flags |= F.turnRight;
            this.nextLanes.push(lane);
            if (i > 0) {
              const curve = component?.curve;
              if (!curve)
                throw new Error(`Missing parking Curve: ${lane.laneId}`);
              this.updateSlave(
                this.nextLanes[i - 1],
                cs2NavigationCurvePosition(curve, lane.end),
              );
            }
            this.current.flags |= F.updateOptimalLane;
            break;
          }
          const connection = this.world.connectionLanes.get(lane.laneId);
          if (connection) {
            lane.flags |=
              F.fixedLane | (connection.flags & 0x2000 ? F.area : F.connection);
            this.current.flags |= F.updateOptimalLane;
            if (connection.flags & 0x100) {
              lane.flags |= F.parkingSpace;
              this.nextLanes.push(lane);
              break;
            }
            this.nextLanes.push(lane);
            continue;
          }
          if (component?.nodes) {
            if (
              this.pathOwner.elementIndex >= this.path.length &&
              this.pathOwner.flags & P.pending
            ) {
              this.pathOwner.elementIndex--;
              break;
            }
            if (i > 0) {
              const curve = component.curve;
              if (!curve)
                throw new Error(`Missing waypoint Curve: ${lane.laneId}`);
              this.updateSlave(
                this.nextLanes[i - 1],
                cs2NavigationCurvePosition(curve, lane.end),
              );
              this.nextLanes[i - 1].flags |=
                F.waypoint |
                (this.pathOwner.elementIndex >= this.path.length
                  ? F.endOfPath
                  : 0);
            } else
              this.current.flags |=
                F.waypoint |
                (this.pathOwner.elementIndex >= this.path.length
                  ? F.endOfPath
                  : 0);
            this.current.flags |= F.updateOptimalLane;
            break;
          }
          const transform = this.world.transforms.get(lane.laneId);
          if (!transform) {
            this.invalidPath = i;
            return;
          }
          if (
            this.pathOwner.elementIndex >= this.path.length &&
            this.pathOwner.flags & P.pending
          ) {
            this.pathOwner.elementIndex--;
            break;
          }
          if (
            !(this.input.carFlags & 2) ||
            this.path.length > this.pathOwner.elementIndex
          ) {
            lane.flags |= F.transformTarget;
            this.nextLanes.push(lane);
            if (i > 0)
              this.updateSlave(this.nextLanes[i - 1], transform.position);
            this.current.flags |= F.updateOptimalLane;
          }
        } else {
          const lane = this.nextLanes[i];
          if (!this.world.entities.has(lane.laneId)) {
            this.invalidPath = i;
            return;
          }
          if (lane.flags & (F.endOfPath | F.parkingSpace | F.waypoint)) break;
        }
      }
    }
    const selection = cs2SelectOptimalLanes({
      world: this.world.selection,
      entity: this.input.entity,
      priority: this.input.priority,
      blocker: this.input.blocker,
      leftHandTraffic: this.input.leftHandTraffic,
      forbidNetFlags: this.input.isBicycle
        ? 0x40004000
        : 0x40000001 | (this.input.carFlags & 0x20 ? 0 : 0x8000),
      preferNetFlags: this.input.carFlags & 0x40 ? 0x8000 : 0,
      pathMethods: this.input.isBicycle ? 16384 : 2,
      current: this.current,
      nextLanes: this.nextLanes,
    });
    this.current = selection.current;
    this.nextLanes = selection.nextLanes;
    if (selection.invalidPath !== null)
      this.invalidPath = selection.invalidPath;
  }
  private *update(): Generator<
    CS2NavigationFindLaneRequest,
    CS2NavigationPathsOutput,
    CS2NavigationFindLaneReply
  > {
    if (!this.current.laneId || this.current.flags & F.obsolete) {
      this.invalidPath = -1;
      const reply = yield this.findLaneRequest();
      this.current = copyCurrent(reply.current);
      if (
        !this.current.laneId &&
        this.pathOwner.flags & P.updated &&
        this.path.length > this.pathOwner.elementIndex
      ) {
        const element = this.path[this.pathOwner.elementIndex],
          connection =
            element.target === null
              ? undefined
              : this.world.connectionLanes.get(element.target);
        const position = f(element.delta[0]);
        this.current = {
          laneId: element.target,
          changeLaneId: null,
          curvePosition: { x: position, y: position, z: position },
          flags:
            F.fixedLane |
            (connection
              ? connection.flags & 0x2000
                ? F.area
                : F.connection
              : 0),
          changeProgress: 0,
          lanePosition: 0,
          duration: 0,
          distance: 0,
        };
        this.invalidPath = UNSET_INVALID_PATH;
      } else if (
        !this.current.laneId &&
        this.pathOwner.flags & (P.pending | P.scheduled)
      )
        this.invalidPath = UNSET_INVALID_PATH;
    } else if (
      this.pathOwner.flags & (P.pending | P.failed | P.obsolete | P.updated) &&
      !(this.pathOwner.flags & P.append)
    )
      this.clearReservedPrefix();
    else if (!(this.pathOwner.flags & P.updated)) this.fill();
    if (this.invalidPath !== UNSET_INVALID_PATH) {
      if (this.invalidPath >= 0) {
        const cleared = cs2ClearNavigationForPathfind({
          world: this.world,
          current: this.current,
          nextLanes: this.nextLanes,
          velocity: this.input.velocity,
          car: this.input.car,
          isBicycle: this.input.isBicycle,
        });
        this.current = cleared.current;
        this.nextLanes = cleared.nextLanes;
      } else this.current.curvePosition.z = this.current.curvePosition.y;
      const invalid = Math.max(this.invalidPath, 0);
      if (invalid < this.nextLanes.length) this.nextLanes.length = invalid;
      this.path.length = 0;
      this.pathOwner.elementIndex = 0;
      this.pathOwner.flags |= P.obsolete;
    }
    return {
      current: this.current,
      nextLanes: this.nextLanes,
      pathOwner: this.pathOwner,
      path: this.path,
      randomState: this.randomState,
      invalidPath:
        this.invalidPath === UNSET_INVALID_PATH ? null : this.invalidPath,
    };
  }
}

export function cs2UpdateNavigationPaths(
  world: CS2NavigationPathsWorld,
  input: CS2NavigationPathsInput,
  callbacks: CS2NavigationPathsCallbacks = {},
): CS2NavigationPathsAdvance {
  let result = new CS2NavigationPathsTransaction(world, input).advance();
  while (result.status === "pending") {
    const reply = callbacks.findCurrentLane?.(result.request);
    if (!reply) return result;
    result = result.transaction.advance(reply);
  }
  return result;
}
