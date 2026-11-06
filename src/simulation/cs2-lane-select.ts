/** Full ordinary-car lane selection state machine. Source evidence: CS2_LANE_SELECT.md.
 * Vehicle navigation flags, Net lane flags, and owner-buffer indices are separate.
 */
import {
  cs2NavigationCurvePosition,
  type CS2NavigationCurve,
  type CS2NavigationCurrentState,
  type CS2NavigationQueuedLane,
} from "./cs2-navigation-target";
import type { V } from "../core/types";
import type { CS2LaneReservation } from "./cs2-conflicts";
import { cs2ReservationPriority } from "./cs2-conflicts";
import type {
  CS2LaneSpeedWorld,
  CS2LaneSpeedLaneObject,
} from "./cs2-lane-speed";
import type { Cs2CompiledNetwork } from "./cs2-network";

export const CS2_SELECT_VEHICLE_FLAGS = {
  updateOptimalLane: 4,
  transformTarget: 8,
  reserved: 0x80,
  fixedLane: 0x100,
  groupTarget: 0x800,
  queue: 0x1000,
  ignoreBlocker: 0x2000,
  isBlocked: 0x4000,
  turnLeft: 0x40000,
  turnRight: 0x80000,
  fixedStart: 0x800000,
} as const;
export const CS2_SELECT_SLAVE_FLAGS = {
  allowChange: 1,
  middleStart: 0x800,
  middleEnd: 0x1000,
} as const;
export type CS2LaneSelectLane = {
  owner?: string;
  /** Original packed PathNodes, not geometric endpoints. */
  nodes?: { start: bigint; middle: bigint; end: bigint };
  slave?: {
    flags: number;
    minIndex: number;
    maxIndex: number;
    masterIndex: number;
    subIndex?: number;
  };
  master?: boolean | { minIndex: number; maxIndex: number };
  curve?: CS2NavigationCurve;
  carLane?: { flags: number; blockageStart?: number; blockageEnd?: number };
  reservation?: CS2LaneReservation;
  objects?: readonly CS2LaneSpeedLaneObject[];
};
export type CS2LaneSelectObject = {
  /** Moving component presence; a stopped moving car still has Moving. */
  moving: boolean;
  controller?: string | null;
  queueing?: boolean;
};
export type CS2LaneSelectWorld = {
  lanes: ReadonlyMap<string, CS2LaneSelectLane>;
  /** Full ordered SubLane buffers. Slave indices are absolute into these arrays. */
  owners: ReadonlyMap<
    string,
    readonly { laneId: string; pathMethods: number }[]
  >;
  objects: ReadonlyMap<string, CS2LaneSelectObject>;
  /** Explicit RoadLab topology adapter only. Omit with original PathNode snapshots.
   * Source itself uses PathNode.Equals/EqualsIgnoreCurvePos, implemented below. */
  connects?: (
    from: string,
    to: string,
    mode: "end-start" | "end-middle" | "middle-start",
  ) => boolean;
};
export type CS2LaneSelectOptions = {
  entity: string;
  blocker?: string | null;
  priority: number;
  leftHandTraffic?: boolean;
  turnAhead?: boolean;
  forbidNetFlags?: number;
  preferNetFlags?: number;
  pathMethods?: number;
};
export type CS2LaneSelectSnapshot = {
  buffer: readonly number[];
  bufferPos: number;
  laneSwitchCost: number;
  laneSwitchBaseCost: number;
  prevLane: string | null;
};
export type CS2LaneSelectTrace = CS2LaneSelectSnapshot & {
  stage: string;
  current?: CS2NavigationCurrentState;
  lane?: CS2NavigationQueuedLane;
};
const F = CS2_SELECT_VEHICLE_FLAGS,
  S = CS2_SELECT_SLAVE_FLAGS;
const f = Math.fround,
  MAX = f(3.4028234663852886e38),
  UNREACHABLE = 1_000_000;
const add = (a: number, b: number) => f(f(a) + f(b));
const mul = (a: number, b: number) => f(f(a) * f(b));
const sub = (a: number, b: number) => f(f(a) - f(b));
const copyCurrent = (
  c: CS2NavigationCurrentState,
): CS2NavigationCurrentState => ({
  ...c,
  curvePosition: { ...c.curvePosition },
});
const selectable = (flags: number) => !(flags & (F.reserved | F.fixedLane));
const ignoreCurve = (a: bigint, b: bigint) =>
  ((a ^ b) & 0xffffffff8000ffffn) === 0n;

function laneDriveCosts(
  flags: number,
  methods: number,
  index: number,
  min: number,
  max: number,
  options: CS2LaneSelectOptions,
) {
  const kerb =
    !!(flags & 4) === !!options.leftHandTraffic ? max - index : index - min;
  const bicycle = methods !== 16384 ? add(1.4, mul(kerb, 0.4)) : 0;
  const prefer = options.preferNetFlags ?? 0,
    path = options.pathMethods ?? 2;
  let drive = !(flags & prefer) && prefer !== 0 ? f(0.4) : 0;
  if (flags & (options.forbidNetFlags ?? 1 | 0x8000 | 0x40000000))
    drive = options.priority < 108 ? f(4.9) : f(0.9);
  if (path === 16384) drive = add(drive, bicycle);
  return { drive: methods & path ? drive : MAX, bicycle };
}

/** Original private GetLane{Switch,Priority,Drive}Cost/GetBicycleDriveCost;
 * exposed together for direct original-DLL vectors, not a new selection policy.
 */
export function cs2LaneSelectScalarCosts(
  input: CS2LaneSelectOptions & {
    coefficient: number;
    numLanes: number;
    lanePriority: number;
    netFlags: number;
    subLanePathMethods: number;
    index: number;
    minIndex: number;
    maxIndex: number;
  },
) {
  const costs = laneDriveCosts(
    input.netFlags,
    input.subLanePathMethods,
    input.index,
    input.minIndex,
    input.maxIndex,
    input,
  );
  return {
    switchCost: mul(input.numLanes ** 3, input.coefficient),
    priorityCost: f(Math.max(0, input.lanePriority - input.priority)),
    driveCost: costs.drive,
    bicycleCost: costs.bicycle,
  };
}

/** Game.Simulation.CarLaneSelectIterator, methods 70–761. Method hashes in docs.
 * A new iterator is created per navigation decision; the source has 96 float slots.
 */
export class CS2CarLaneSelectIterator {
  private readonly buffer = new Float32Array(96);
  private bufferPos = 0;
  private laneSwitchCost = 0;
  private laneSwitchBaseCost = 0;
  private prevLane: string | null = null;
  constructor(
    readonly world: CS2LaneSelectWorld,
    readonly options: CS2LaneSelectOptions,
  ) {}
  snapshot(): CS2LaneSelectSnapshot {
    return {
      buffer: Array.from(this.buffer),
      bufferPos: this.bufferPos,
      laneSwitchCost: this.laneSwitchCost,
      laneSwitchBaseCost: this.laneSwitchBaseCost,
      prevLane: this.prevLane,
    };
  }
  private lane(id: string): CS2LaneSelectLane {
    const lane = this.world.lanes.get(id);
    if (!lane)
      throw new Error(`Missing lane selection component snapshot: ${id}`);
    return lane;
  }
  private group(id: string) {
    const lane = this.world.lanes.get(id),
      slave = lane?.slave;
    if (!slave) return null;
    const buffer =
      lane.owner === undefined ? undefined : this.world.owners.get(lane.owner);
    if (!buffer) throw new Error(`Missing owner SubLane buffer: ${id}`);
    const min = slave.minIndex,
      max = Math.min(slave.maxIndex, buffer.length - 1);
    if (min < 0 || max < min)
      throw new Error(`Invalid source SlaveLane range: ${id}`);
    return { lane, slave, buffer, min, max, count: max - min + 1 };
  }
  private write(value: number) {
    if (this.bufferPos >= this.buffer.length || this.bufferPos < 0)
      throw new Error("Source CarLaneSelectBuffer's 96 slots exceeded");
    this.buffer[this.bufferPos++] = value;
  }
  private read(index: number) {
    if (index < 0 || index >= this.buffer.length)
      throw new Error(`Invalid source lane cost cursor: ${index}`);
    return this.buffer[index];
  }
  private setSwitch(flags: number) {
    this.laneSwitchCost = add(
      this.laneSwitchBaseCost,
      flags & S.allowChange ? 1 : 5,
    );
    if (this.options.turnAhead)
      this.laneSwitchCost = mul(this.laneSwitchCost, 7);
  }
  private switchCost(count: number) {
    return mul(count * count * count, this.laneSwitchCost);
  }
  private priorityCost(id: string) {
    const r = this.world.lanes.get(id)?.reservation;
    return r
      ? f(Math.max(0, cs2ReservationPriority(r) - this.options.priority))
      : 0;
  }
  private methods() {
    return this.options.pathMethods ?? 2;
  }
  private driveCost(
    id: string,
    methods: number,
    index: number,
    min: number,
    max: number,
    bicycleOnly = false,
  ) {
    const car = this.world.lanes.get(id)?.carLane;
    if (!car) return 0;
    const costs = laneDriveCosts(
      car.flags,
      methods,
      index,
      min,
      max,
      this.options,
    );
    return bicycleOnly ? costs.bicycle : costs.drive;
  }
  private objectCost(id: string, end: number, unit: number, flags: number) {
    const object = this.world.objects.get(id);
    if (object?.moving || (object?.queueing && flags & F.queue)) return unit;
    return add(10_000_000, mul(-1_000_000, end));
  }
  private futureObjects(
    id: string,
    index: number,
    unit: number,
    flags: number,
  ) {
    const objects = this.world.lanes.get(id)?.objects ?? [];
    if (index >= 2 || !this.options.blocker) return mul(unit, objects.length);
    let value = 0;
    for (const object of objects)
      value = add(
        value,
        object.object === this.options.blocker
          ? this.objectCost(object.object, object.curvePosition[1], unit, flags)
          : unit,
      );
    return value;
  }
  private currentObjects(
    id: string,
    minPosition: number,
    unit: number,
    flags: number,
  ) {
    let value = 0;
    for (const object of this.world.lanes.get(id)?.objects ?? []) {
      if (
        object.curvePosition[1] > minPosition &&
        object.object !== this.options.entity &&
        this.world.objects.get(object.object)?.controller !==
          this.options.entity
      )
        value = add(
          value,
          this.objectCost(object.object, object.curvePosition[1], unit, flags),
        );
    }
    return value;
  }
  private connects(
    from: string,
    to: string,
    fromFlags: number,
    toFlags: number,
  ) {
    const mode =
      fromFlags & S.middleEnd
        ? "end-middle"
        : toFlags & S.middleStart
          ? "middle-start"
          : "end-start";
    if (this.world.connects) return this.world.connects(from, to, mode);
    const a = this.lane(from).nodes,
      b = this.lane(to).nodes;
    if (!a || !b)
      throw new Error(`Missing original Lane PathNodes: ${from} -> ${to}`);
    return mode === "end-middle"
      ? ignoreCurve(a.end, b.middle)
      : mode === "middle-start"
        ? ignoreCurve(a.middle, b.start)
        : a.end === b.start;
  }
  private range(
    from: string,
    fromFlags: number,
    nextId: string,
    nextFlags: number,
  ) {
    const group = this.group(nextId);
    if (!group) throw new Error(`Expected SlaveLane next group: ${nextId}`);
    if (nextFlags & F.groupTarget) return [group.min, group.max] as const;
    let min = 100000,
      max = -100000;
    for (let i = group.min; i <= group.max; i++)
      if (
        this.connects(
          from,
          group.buffer[i].laneId,
          fromFlags,
          group.slave.flags,
        )
      ) {
        min = Math.min(min, i);
        max = i;
      }
    return [min, max] as const;
  }
  private rangeToFixed(
    group: NonNullable<ReturnType<CS2CarLaneSelectIterator["group"]>>,
    next: CS2NavigationQueuedLane,
  ) {
    let min = 100000,
      max = -100000;
    for (let i = group.min; i <= group.max; i++) {
      const id = group.buffer[i].laneId;
      if (
        next.flags & F.groupTarget
          ? id === next.laneId
          : this.connects(id, next.laneId, group.slave.flags, 0)
      ) {
        min = Math.min(min, i);
        max = i;
        if (next.flags & F.groupTarget) break;
      }
    }
    return [min, max] as const;
  }
  /** CalculateLaneCosts(nav,index) or CalculateLaneCosts(nav,next,index). */
  calculateLaneCosts(
    nav: CS2NavigationQueuedLane,
    index: number,
    next?: CS2NavigationQueuedLane,
  ): void {
    const group = selectable(nav.flags) ? this.group(nav.laneId) : null;
    if (!next) {
      if (!group) return;
      const unit = mul(Math.abs(sub(nav.end, nav.start)), 0.49);
      for (let i = group.min; i <= group.max; i++) {
        const lane = group.buffer[i];
        this.write(
          add(
            add(
              this.futureObjects(lane.laneId, index, unit, nav.flags),
              this.priorityCost(lane.laneId),
            ),
            this.driveCost(
              lane.laneId,
              lane.pathMethods,
              i,
              group.min,
              group.max,
            ),
          ),
        );
      }
      return;
    }
    if (group) {
      this.setSwitch(group.slave.flags);
      const unit = mul(
        mul(Math.abs(sub(nav.end, nav.start)), 0.49),
        f(2 / (2 + index)),
      );
      const following = selectable(next.flags) ? this.group(next.laneId) : null;
      if (following) {
        const offset = this.bufferPos - following.count;
        let firstCost = UNREACHABLE,
          lastCost = UNREACHABLE,
          first = 100000,
          last = -100000;
        for (let i = group.min; i <= group.max; i++) {
          const lane = group.buffer[i],
            [min, max] = this.range(
              lane.laneId,
              group.slave.flags,
              next.laneId,
              next.flags,
            );
          let cost = UNREACHABLE;
          if (min <= max) {
            for (let j = following.min; j <= following.max; j++)
              cost = Math.min(
                cost,
                add(
                  this.read(offset + j - following.min),
                  j < min
                    ? this.switchCost(min - j)
                    : j > max
                      ? this.switchCost(j - max)
                      : 0,
                ),
              );
            cost = add(
              cost,
              this.futureObjects(lane.laneId, index, unit, nav.flags),
            );
            if (first === 100000) {
              firstCost = cost;
              first = i;
            }
            lastCost = cost;
            last = i;
            cost = add(
              add(cost, this.priorityCost(lane.laneId)),
              this.driveCost(
                lane.laneId,
                lane.pathMethods,
                i,
                group.min,
                group.max,
              ),
            );
          }
          this.write(cost);
        }
        if (first <= last)
          for (let i = group.min; i <= group.max; i++)
            if (i < first || i > last) {
              const lane = group.buffer[i];
              let cost = add(
                i > last ? lastCost : firstCost,
                this.switchCost(Math.max(first - i, i - last)),
              );
              cost = add(
                add(cost, this.priorityCost(lane.laneId)),
                this.driveCost(
                  lane.laneId,
                  lane.pathMethods,
                  i,
                  group.min,
                  group.max,
                ),
              );
              this.buffer[this.bufferPos - group.max + i - 1] = cost;
            }
      } else {
        const transform = !!(next.flags & F.transformTarget),
          [min, max] = transform
            ? [100000, -100000]
            : this.rangeToFixed(group, next);
        for (let i = group.min; i <= group.max; i++) {
          const lane = group.buffer[i];
          let cost =
            !transform && min <= max
              ? this.switchCost(Math.max(0, min - i, i - max))
              : 0;
          cost = add(
            cost,
            this.futureObjects(lane.laneId, index, unit, nav.flags),
          );
          cost = add(
            add(cost, this.priorityCost(lane.laneId)),
            this.driveCost(
              lane.laneId,
              lane.pathMethods,
              i,
              group.min,
              group.max,
            ),
          );
          this.write(cost);
        }
      }
    }
    this.laneSwitchBaseCost = add(this.laneSwitchBaseCost, 0.01);
  }
  private turnFlags(id: string, currentIndex: number, changeIndex: number) {
    if (changeIndex === currentIndex) return 0;
    const invert = !!((this.world.lanes.get(id)?.carLane?.flags ?? 0) & 4);
    return changeIndex < currentIndex !== invert ? F.turnLeft : F.turnRight;
  }
  /** UpdateOptimalLane(ref CarCurrentLane, next): initiates, cancels or reverses a change. */
  updateCurrentLane(
    source: CS2NavigationCurrentState,
    next?: CS2NavigationQueuedLane,
  ): CS2NavigationCurrentState {
    const current = copyCurrent(source);
    let chosen = current.changeLaneId ?? current.laneId;
    let targetIndex = 0,
      originIndex = 0,
      changeIndex = 0;
    const group =
      chosen && !(current.flags & F.fixedLane) ? this.group(chosen) : null;
    if (group) {
      this.setSwitch(group.slave.flags);
      for (let i = group.min; i <= group.max; i++)
        if (group.buffer[i].laneId === chosen) {
          targetIndex = originIndex = i;
          break;
        }
      if (current.changeLaneId)
        for (let i = group.min; i <= group.max; i++)
          if (group.buffer[i].laneId === current.laneId) {
            originIndex = i;
            break;
          }
      const following =
        next && selectable(next.flags) ? this.group(next.laneId) : null;
      const fixedRange =
        next && !following && !(next.flags & F.transformTarget)
          ? this.rangeToFixed(group, next)
          : null;
      let best = MAX;
      for (let i = group.min; i <= group.max; i++) {
        const lane = group.buffer[i];
        let cost: number;
        if (following && next) {
          const [min, max] = this.range(
            lane.laneId,
            group.slave.flags,
            next.laneId,
            next.flags,
          );
          cost = UNREACHABLE;
          if (min <= max) {
            for (let j = min; j <= max; j++)
              cost = Math.min(
                cost,
                this.read(this.bufferPos - following.count + j - following.min),
              );
            cost = add(
              cost,
              this.currentObjects(
                lane.laneId,
                current.curvePosition.x,
                f(0.49),
                current.flags,
              ),
            );
            cost = add(cost, this.priorityCost(lane.laneId));
          }
        } else if (
          !fixedRange ||
          (i >= fixedRange[0] && i <= fixedRange[1]) ||
          fixedRange[0] > fixedRange[1]
        ) {
          cost = add(
            this.currentObjects(
              lane.laneId,
              current.curvePosition.x,
              f(0.49),
              current.flags,
            ),
            this.priorityCost(lane.laneId),
          );
        } else cost = UNREACHABLE;
        const a = Math.abs(i - targetIndex),
          b = Math.abs(i - originIndex);
        cost = add(cost, this.switchCost(a !== 0 && b > a ? b : a));
        if (this.methods() === 16384)
          cost = add(
            cost,
            this.driveCost(
              lane.laneId,
              lane.pathMethods,
              i,
              group.min,
              group.max,
              true,
            ),
          );
        if (!(lane.pathMethods & this.methods())) cost = MAX;
        if (cost < best) {
          best = cost;
          chosen = lane.laneId;
          changeIndex = i;
        }
      }
    }
    if (chosen !== current.laneId) {
      if (chosen !== current.changeLaneId) {
        current.changeLaneId = chosen;
        current.changeProgress = 0;
        current.flags =
          (current.flags & ~(F.turnLeft | F.turnRight)) |
          this.turnFlags(current.laneId!, originIndex, changeIndex);
      }
    } else if (current.changeLaneId) {
      current.flags &= ~(F.turnLeft | F.turnRight);
      if (current.changeProgress === 0) current.changeLaneId = null;
      else {
        current.laneId = current.changeLaneId;
        current.changeLaneId = chosen;
        current.changeProgress = Math.min(
          1,
          Math.max(0, sub(1, current.changeProgress)),
        );
        current.flags |= this.turnFlags(
          current.laneId,
          originIndex,
          changeIndex,
        );
      }
    }
    this.prevLane = current.changeLaneId ?? current.laneId;
    this.laneSwitchCost = 10_000_000;
    return current;
  }
  /** UpdateOptimalLane(ref CarNavigationLane): source forward buffer pop/order. */
  updateNavigationLane(
    source: CS2NavigationQueuedLane,
  ): CS2NavigationQueuedLane {
    const nav = { ...source },
      group = this.group(nav.laneId);
    if (group) {
      if (
        !(nav.flags & (F.reserved | F.fixedLane | F.fixedStart)) &&
        this.prevLane &&
        this.world.lanes.get(this.prevLane)?.nodes
      ) {
        this.bufferPos -= group.count;
        const previousFlags =
          this.world.lanes.get(this.prevLane)?.slave?.flags ?? 0;
        let [min, max] =
          nav.flags & F.groupTarget
            ? [100000, -100000]
            : this.range(this.prevLane, previousFlags, nav.laneId, nav.flags);
        if (min > max) {
          min = group.min;
          max = group.max;
        }
        let best = MAX,
          selected = group.min;
        for (let i = group.min; i <= group.max; i++) {
          const value = add(
            this.read(this.bufferPos + i - group.min),
            i < min
              ? this.switchCost(min - i)
              : i > max
                ? this.switchCost(i - max)
                : 0,
          );
          if (value < best) {
            best = value;
            selected = i;
          }
        }
        nav.laneId = group.buffer[selected].laneId;
      }
      this.setSwitch(group.slave.flags);
    } else this.laneSwitchCost = 10_000_000;
    this.prevLane = nav.laneId;
    this.laneSwitchBaseCost = sub(this.laneSwitchBaseCost, 0.01);
    return nav;
  }
}

/** CarNavigationSystem.UpdateNavigationJob.IsBlockedLane, 1227–1254.
 * Slave blockage is read from the master, not copied from a random member.
 */
export function cs2IsSelectLaneBlocked(
  world: CS2LaneSelectWorld,
  id: string,
  range: readonly [number, number],
): boolean {
  let lane = world.lanes.get(id);
  if (lane?.slave) {
    const masterId =
      lane.owner &&
      world.owners.get(lane.owner)?.[lane.slave.masterIndex]?.laneId;
    lane = masterId ? world.lanes.get(masterId) : undefined;
    if (!lane?.master) return false;
  }
  const car = lane?.carLane,
    min = car?.blockageStart ?? 255,
    max = car?.blockageEnd ?? 0;
  return (
    !!car &&
    max >= min &&
    Math.min(...range) <= mul(max, 0.003921569) &&
    Math.max(...range) >= mul(min, 0.003921569)
  );
}

/** FillNavigationPaths' final lane-selection stage, lines1131–1198. Path window
 * fill/validation remains the caller's responsibility (source normal window 12).
 */
export function cs2SelectOptimalLanes(
  input: CS2LaneSelectOptions & {
    world: CS2LaneSelectWorld;
    current: CS2NavigationCurrentState;
    nextLanes: readonly CS2NavigationQueuedLane[];
    /** Cost-buffer snapshots are opt-in to avoid allocations in the actual engine. */
    captureTrace?: boolean;
  },
) {
  let current = copyCurrent(input.current),
    nextLanes = input.nextLanes.map((l) => ({ ...l }));
  const trace: CS2LaneSelectTrace[] = [];
  if (!(current.flags & F.updateOptimalLane))
    return { current, nextLanes, invalidPath: null, updated: false, trace };
  current.flags &= ~F.updateOptimalLane;
  if (current.flags & F.isBlocked) {
    if (
      current.laneId &&
      cs2IsSelectLaneBlocked(input.world, current.laneId, [
        current.curvePosition.x,
        current.curvePosition.z,
      ])
    )
      return { current, nextLanes, invalidPath: -1, updated: true, trace };
    for (let i = 0; i < nextLanes.length; i++)
      if (
        cs2IsSelectLaneBlocked(input.world, nextLanes[i].laneId, [
          nextLanes[i].start,
          nextLanes[i].end,
        ])
      )
        return { current, nextLanes, invalidPath: i, updated: true, trace };
    current.flags =
      (current.flags & ~(F.fixedLane | F.isBlocked)) | F.ignoreBlocker;
  }
  const iterator = new CS2CarLaneSelectIterator(input.world, {
    ...input,
    turnAhead: nextLanes.some((l) => !!(l.flags & (F.turnLeft | F.turnRight))),
  });
  const record = (stage: string, lane?: CS2NavigationQueuedLane) => {
    if (input.captureTrace)
      trace.push({
        ...iterator.snapshot(),
        stage,
        ...(lane ? { lane: { ...lane } } : {}),
        current: copyCurrent(current),
      });
  };
  if (nextLanes.length) {
    const last = nextLanes.length - 1;
    iterator.calculateLaneCosts(nextLanes[last], last);
    record(`cost:${last}`, nextLanes[last]);
    for (let i = last - 1; i >= 0; i--) {
      iterator.calculateLaneCosts(nextLanes[i], i, nextLanes[i + 1]);
      record(`cost:${i}`, nextLanes[i]);
    }
    current = iterator.updateCurrentLane(current, nextLanes[0]);
    record("current");
    for (let i = 0; i < nextLanes.length; i++) {
      nextLanes[i] = iterator.updateNavigationLane(nextLanes[i]);
      nextLanes[i].flags &= ~F.reserved;
      record(`forward:${i}`, nextLanes[i]);
    }
  } else if (current.curvePosition.x !== current.curvePosition.z) {
    current = iterator.updateCurrentLane(current);
    record("current");
  }
  return { current, nextLanes, invalidPath: null, updated: true, trace };
}

/** Source GetNextLane: first connected member in the ordered next group.
 * Unlike a route nomination, the requested member itself has no priority here.
 */
export function cs2GetNextSelectLane(
  world: CS2LaneSelectWorld,
  previous: string,
  requested: string,
): string | null {
  const next = world.lanes.get(requested),
    prev = world.lanes.get(previous);
  if (!next?.slave || !prev?.nodes) return null;
  const buffer = next.owner && world.owners.get(next.owner);
  if (!buffer) throw new Error(`Missing owner SubLane buffer: ${requested}`);
  for (
    let i = next.slave.minIndex;
    i <= Math.min(next.slave.maxIndex, buffer.length - 1);
    i++
  ) {
    const candidate = buffer[i].laneId;
    if (
      world.connects
        ? world.connects(previous, candidate, "end-start")
        : prev.nodes.end === world.lanes.get(candidate)?.nodes?.start
    )
      return candidate;
  }
  return null;
}

const subtractVector = (a: V, b: V): V => ({
  x: sub(a.x, b.x),
  y: sub(a.y, b.y),
  z: sub(a.z, b.z),
});
const scaleVector = (a: V, b: number): V => ({
  x: mul(a.x, b),
  y: mul(a.y, b),
  z: mul(a.z, b),
});
const dot = (a: V, b: V) =>
  add(add(mul(a.x, b.x), mul(a.y, b.y)), mul(a.z, b.z));
function segmentDistance(a: V, b: V, position: V) {
  const delta = subtractVector(b, a),
    offset = subtractVector(position, a),
    square = dot(delta, delta);
  const t =
    square === 0 ? 0 : Math.min(1, Math.max(0, f(dot(delta, offset) / square)));
  const difference = subtractVector(scaleVector(delta, t), offset);
  return { distanceSquared: dot(difference, difference), t };
}
/** Original Colossal.MathUtils.DistanceSquared(Bezier4x3,float3): 16 chords,
 * then exactly four local two-segment refinements; no arbitrary sampling budget.
 */
export function cs2SelectCurveDistanceSquared(
  curve: CS2NavigationCurve,
  position: V,
) {
  let result = MAX,
    t = 0,
    start = 0,
    a = curve.points[0];
  for (let i = 1; i <= 16; i++) {
    const next = f(i / 16),
      b = cs2NavigationCurvePosition(curve, next),
      distance = segmentDistance(a, b, position);
    if (distance.distanceSquared < result) {
      result = distance.distanceSquared;
      t = add(start, mul(sub(next, start), distance.t));
    }
    start = next;
    a = b;
  }
  let step = f(1 / 32);
  for (let i = 0; i < 4; i++) {
    const centre = cs2NavigationCurvePosition(curve, t),
      before = cs2NavigationCurvePosition(curve, Math.max(0, sub(t, step))),
      after = cs2NavigationCurvePosition(curve, Math.min(1, add(t, step))),
      left = segmentDistance(centre, before, position),
      right = segmentDistance(centre, after, position);
    if (left.distanceSquared < right.distanceSquared) {
      t = Math.max(0, sub(t, mul(step, left.t)));
      result = left.distanceSquared;
    } else {
      t = Math.min(1, add(t, mul(step, right.t)));
      result = right.distanceSquared;
    }
    step = mul(step, 0.5);
  }
  return { distanceSquared: result, t };
}

/** Source GetSlaveLaneFromMasterLane overloads + GetRandomLane. randomState is
 * the live Unity.Mathematics.Random.state (constructor warm-up already consumed).
 * Pass fixedStartCurrent only in FillNavigationPaths' first-lane FixedLane &&
 * !Connection branch. A resolved TransformTarget position is an explicit input.
 */
export function cs2ResolveLaneSelectionMaster(input: {
  world: CS2LaneSelectWorld;
  lane: CS2NavigationQueuedLane;
  randomState: number;
  isBicycle?: boolean;
  fixedStartCurrent?: CS2NavigationCurrentState;
  transformPosition?: V | null;
}) {
  const lane = { ...input.lane },
    component = input.world.lanes.get(lane.laneId);
  let randomState = input.randomState >>> 0;
  const nextInt = (max: number) => {
    const value = randomState;
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    randomState >>>= 0;
    return Math.floor((value * max) / 4294967296);
  };
  if (!component?.master) {
    lane.flags |= F.fixedLane;
    return { lane, randomState };
  }
  const buffer = component.owner && input.world.owners.get(component.owner);
  if (!buffer)
    throw new Error(`Missing master owner SubLane buffer: ${lane.laneId}`);
  if (typeof component.master !== "object")
    throw new Error(`MasterLane min/max indices required: ${lane.laneId}`);
  const { minIndex, maxIndex } = component.master,
    methods = input.isBicycle ? 16384 : 2;
  let compare: V | null = null;
  const current = input.fixedStartCurrent;
  if (current) {
    if (current.flags & F.transformTarget)
      compare = input.transformPosition ?? null;
    else {
      const curve =
        current.laneId && input.world.lanes.get(current.laneId)?.curve;
      if (!curve)
        throw new Error(
          `Missing current Curve for fixed-start selection: ${current.laneId}`,
        );
      compare = cs2NavigationCurvePosition(curve, current.curvePosition.z);
    }
  }
  if (compare) {
    let best = MAX,
      selected = minIndex;
    for (let i = minIndex; i <= Math.min(maxIndex, buffer.length - 1); i++)
      if (buffer[i].pathMethods & methods) {
        const curve = input.world.lanes.get(buffer[i].laneId)?.curve;
        if (!curve) throw new Error(`Missing slave Curve: ${buffer[i].laneId}`);
        const distance = cs2SelectCurveDistanceSquared(
          curve,
          compare,
        ).distanceSquared;
        if (distance < best) {
          best = distance;
          selected = i;
        }
      }
    lane.laneId = buffer[selected].laneId;
    lane.flags |= F.fixedStart;
  } else {
    let count = 0,
      selected: string | null = null;
    for (let i = minIndex; i <= maxIndex; i++)
      if (buffer[i].pathMethods & methods)
        if (nextInt(++count) === 0) selected = buffer[i].laneId;
    if (count === 0)
      selected = buffer[minIndex + nextInt(maxIndex + 1 - minIndex)].laneId;
    lane.laneId = selected!;
  }
  return { lane, randomState };
}

/** Original CheckBlocker flag transitions and stored max-speed byte. The speed
 * iterator reports physical safety separately; this only schedules selection.
 */
export function cs2CheckLaneSelectionBlocker(input: {
  world: CS2LaneSelectWorld;
  current: CS2NavigationCurrentState;
  previousBlocker: string | null;
  blocker: string | null;
  blockerType: number;
  maxSpeed: number;
}) {
  const current = copyCurrent(input.current),
    changed = input.blocker !== input.previousBlocker;
  if (changed) current.flags &= ~(F.ignoreBlocker | 0x8000);
  if (input.blocker) {
    const object = input.world.objects.get(input.blocker);
    if (!object?.moving) {
      if (object?.queueing && current.flags & F.queue) {
        if (input.maxSpeed <= 3) current.flags |= 0x8000;
      } else {
        current.flags |= F.updateOptimalLane;
        if (input.maxSpeed <= 3) current.flags |= F.isBlocked;
      }
    } else if (changed) current.flags |= F.updateOptimalLane;
  }
  const scaled = mul(input.maxSpeed, 2.2949998),
    floor = Math.floor(scaled),
    remainder = scaled - floor;
  const rounded =
    remainder === 0.5
      ? floor % 2 === 0
        ? floor
        : floor + 1
      : Math.round(scaled);
  return {
    current,
    blocker: {
      entity: input.blocker,
      type: input.blockerType,
      maxSpeed: Math.min(255, Math.max(0, rounded)),
    },
  };
}

/** Adapter over the one compiled RoadLab network. Its synthetic owner indices
 * are not claimed to reproduce a missing CS2 prefab's SubLane allocation.
 * Connectivity delegates to actual physical successors; raw source snapshots
 * instead use exact packed PathNode equality with no callback.
 */
export function cs2CreateLaneSelectWorld(
  network: Cs2CompiledNetwork,
  speedWorld: CS2LaneSpeedWorld,
  options: { queueing?: (object: string) => boolean } = {},
): CS2LaneSelectWorld {
  const lanes = new Map<string, CS2LaneSelectLane>(),
    owners = new Map<string, { laneId: string; pathMethods: number }[]>();
  let node = 1n;
  for (const group of network.groups.values()) {
    const members = [...group.members],
      multi = members.length > 1,
      buffer = members.map((laneId) => ({ laneId, pathMethods: 2 }));
    if (multi) buffer.push({ laneId: group.master, pathMethods: 2 });
    owners.set(group.id, buffer);
    for (const [i, entry] of buffer.entries()) {
      const original = network.lanes.get(entry.laneId),
        live = speedWorld.lanes.get(entry.laneId);
      lanes.set(entry.laneId, {
        owner: group.id,
        nodes: { start: node++, middle: node++, end: node++ },
        ...(i < members.length && multi
          ? {
              slave: {
                flags: group.allowChange ? S.allowChange : 0,
                minIndex: 0,
                maxIndex: members.length - 1,
                masterIndex: members.length,
                subIndex: i,
              },
            }
          : {}),
        ...(i === members.length
          ? { master: { minIndex: 0, maxIndex: members.length - 1 } }
          : {}),
        curve: live?.curve ?? original?.curve,
        carLane: { flags: live?.carLane.flags ?? original?.laneFlags ?? 0 },
        reservation: live?.reservation,
        objects: live?.objects,
      });
    }
  }
  const objects = new Map<string, CS2LaneSelectObject>();
  for (const [id, object] of speedWorld.objects)
    objects.set(id, {
      moving: object.velocity !== undefined,
      controller: object.controller,
      queueing: options.queueing?.(id) ?? false,
    });
  return {
    lanes,
    owners,
    objects,
    connects: (from, to) => network.successors.get(from)?.includes(to) ?? false,
  };
}
