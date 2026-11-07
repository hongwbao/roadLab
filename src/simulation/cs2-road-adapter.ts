import {
  add,
  bezier,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  sub,
  tangent,
} from "../core/math";
import type { Connection, Road, V } from "../core/types";
import { cs2CurveCurviness } from "./cs2-driving";
import {
  backwardCs2LaneCosts,
  chooseCs2CurrentLane,
  calculateCs2PathCost,
  cs2CarDriveCosts,
  CS2_FALLBACK_PATH_WEIGHTS,
  CS2_PATH_METHOD,
  cs2LaneFlowSample,
  cs2TrafficTimeFactors,
  cs2UpdateLaneFlow,
  cs2FlowOffset,
  type Cs2FlowBuckets,
  type Cs2NavigationGroup,
} from "./cs2-routing";
import type { LaneTraffic } from "./lane-traffic";
import type { Step } from "./simulation";
import {
  cs2CalculateYieldOffset,
  cs2IsTurn,
  cs2NodeLaneFlags,
  cs2RoadCompositionPriority,
  type Cs2RoadRuleArm,
  type Cs2TurnClassification,
} from "./cs2-road-rules";

export type Cs2RoadConnectionGeometry = {
  id: string;
  junction: string;
  fromKey: string;
  toKey: string;
  source: Road;
  target: Road;
  from: V;
  c1: V;
  c2: V;
  to: V;
};

/** Decodes the browser's explicit highway metadata and physical node endpoints. */
export function deriveCs2ConnectionRules(
  connections: readonly Cs2RoadConnectionGeometry[],
  signalized: ReadonlySet<string> = new Set(),
) {
  const direction = (a: V, b: V) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    return length > 1e-6
      ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length }
      : { x: 0, z: 0 };
  };
  const arm = (road: Road, position: V, toward: V): Cs2RoadRuleArm => ({
    owner: road.id,
    position,
    tangent: direction(position, toward),
    highway: road.highwayRules === true,
    priority: cs2RoadCompositionPriority({
      speedLimit: road.speed / 3.6,
      forwardLanes: Math.max(road.lanesStart, road.lanesEnd),
      backwardLanes: road.twoWay ? Math.max(road.lanesStart, road.lanesEnd) : 0,
      highwayRules: road.highwayRules === true,
    }),
  });
  const nodes = new Map<
    string,
    {
      incoming: Map<string, Cs2RoadRuleArm>;
      outgoing: Map<string, Cs2RoadRuleArm>;
    }
  >();
  const endpoints = new Map<
    string,
    { source: Cs2RoadRuleArm; target: Cs2RoadRuleArm }
  >();
  for (const connection of connections) {
    const node = nodes.get(connection.junction) ?? {
      incoming: new Map(),
      outgoing: new Map(),
    };
    const source = arm(connection.source, connection.from, connection.c1);
    const target = arm(connection.target, connection.to, connection.c2);
    node.incoming.set(connection.fromKey, source);
    node.outgoing.set(connection.toKey, target);
    nodes.set(connection.junction, node);
    endpoints.set(connection.id, { source, target });
  }
  const result = new Map<
    string,
    { flags: number; yieldOffset: number; turn: Cs2TurnClassification }
  >();
  for (const connection of connections) {
    const node = nodes.get(connection.junction)!,
      endpointsForLane = endpoints.get(connection.id)!,
      trafficLights = signalized.has(connection.junction),
      turn = cs2IsTurn(endpointsForLane.source, endpointsForLane.target),
      yieldOffset = cs2CalculateYieldOffset({
        source: endpointsForLane.source,
        incoming: [...node.incoming.values()],
        outgoing: [...node.outgoing.values()],
        trafficLights,
      }),
      owners = new Set(
        [...node.incoming.values(), ...node.outgoing.values()].map(
          (a) => a.owner,
        ),
      );
    result.set(connection.id, {
      yieldOffset,
      turn,
      flags: cs2NodeLaneFlags({
        sourceHighway: endpointsForLane.source.highway,
        targetHighway: endpointsForLane.target.highway,
        yieldOffset,
        turn,
        isIntersection: owners.size >= 3,
        trafficLights,
      }),
    });
  }
  return result;
}

/** Browser graph priority heap; the source path executor also uses a heap. */
export class Cs2PathHeap<T> {
  private heap: { value: T; cost: number; order: number }[] = [];
  private order = 0;
  get size() {
    return this.heap.length;
  }
  push(value: T, cost: number) {
    const row = { value, cost, order: this.order++ };
    let i = this.heap.length;
    this.heap.push(row);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (!this.less(row, this.heap[parent])) break;
      this.heap[i] = this.heap[parent];
      i = parent;
    }
    this.heap[i] = row;
  }
  pop() {
    const first = this.heap[0],
      tail = this.heap.pop();
    if (this.heap.length && tail) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < this.heap.length &&
          this.less(this.heap[child + 1], this.heap[child])
        )
          child++;
        if (!this.less(this.heap[child], tail)) break;
        this.heap[i] = this.heap[child];
        i = child;
      }
      this.heap[i] = tail;
    }
    return first;
  }
  private less(
    a: { cost: number; order: number },
    b: { cost: number; order: number },
  ) {
    return a.cost < b.cost || (a.cost === b.cost && a.order < b.order);
  }
}

/** PathUtils uses the normalized horizontal start/end tangent angle. */
export function cs2RoadCurveAngle(road: Road) {
  let angle = 0;
  const n = road.knots.length - 1;
  for (let i = 0; i < n; i++) {
    const a = tangent(road, i / n + 1e-7),
      b = tangent(road, (i + 1) / n - 1e-7),
      denominator = Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z);
    if (denominator > 1e-6)
      angle += Math.acos(
        Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / denominator)),
      );
  }
  return angle;
}

/** No citizen economy exists in boundary tests: use the source's car fallback. */
export function cs2RoadPathCost(input: {
  length: number;
  speedLimit: number;
  curveAngle?: number;
  laneCrossCount?: number;
  flowOffset?: number;
  turning?: boolean;
}) {
  return calculateCs2PathCost(
    {
      length: input.length,
      maxSpeed: input.speedLimit,
      flowOffset: input.flowOffset ?? 0,
      costs: cs2CarDriveCosts(input),
      methods: CS2_PATH_METHOD.road,
    },
    {
      maxSpeed: [200 / 3.6, 200 / 3.6],
      walkSpeed: [0, 0],
      weights: CS2_FALLBACK_PATH_WEIGHTS,
      methods: CS2_PATH_METHOD.road,
    },
  );
}

/** Source four time-of-day flow buckets and 512-frame/16-group cadence.
 * The browser assigns update groups by stable road order, not Unity entity IDs.
 */
export class Cs2RoadFlow {
  readonly offsets = new Map<string, number>();
  private groups = new Map<string, number>();
  private buckets = new Map<string, Cs2FlowBuckets>();
  private next = new Map<string, [number, number]>();
  private lastTick = 0;
  configure(roads: readonly Road[]) {
    this.offsets.clear();
    this.groups.clear();
    this.buckets.clear();
    this.next.clear();
    this.lastTick = 0;
    roads.forEach((road, index) => {
      for (let lane = 0; lane < laneCount(road); lane++)
        this.groups.set(
          `${road.id}:${laneDirection(road, lane)}:${lane}`,
          index & 15,
        );
    });
  }
  record(
    key: string,
    duration: number,
    distance: number,
    length: number,
    freeSpeed: number,
  ) {
    const sample = cs2LaneFlowSample({
      duration,
      distance,
      laneLength: length,
      maxDriveSpeed: freeSpeed,
    });
    const next = this.next.get(key) ?? [0, 0];
    next[0] = Math.fround(next[0] + sample[0]);
    next[1] = Math.fround(next[1] + sample[1]);
    this.next.set(key, next);
  }
  update(seconds: number) {
    const finalTick = Math.floor((seconds * 60) / 512);
    for (let tick = this.lastTick + 1; tick <= finalTick; tick++) {
      const factors = cs2TrafficTimeFactors(((tick * 512) % 262144) / 262144);
      for (const [key, group] of this.groups) {
        if (group !== (tick & 15)) continue;
        const previous = this.buckets.get(key) ?? {
          duration: [0, 0, 0, 0],
          distance: [0, 0, 0, 0],
        };
        const buckets = cs2UpdateLaneFlow(
          previous,
          this.next.get(key) ?? [0, 0],
          factors,
        );
        this.buckets.set(key, buckets);
        this.offsets.set(key, cs2FlowOffset(buckets, factors));
        this.next.delete(key);
      }
    }
    this.lastTick = finalTick;
  }
}

/**
 * Converts the browser's road representation to source-derived scalar inputs.
 * CS2 has persistent lane/node entities and intervening connection lanes;
 * RoadLab currently retains its road/Step graph. Keep that boundary explicit.
 */
export function roadLaneCs2Curviness(road: Road, lane: number): number {
  let maximum = 0;
  const count = road.knots.length - 1;
  for (let i = 0; i < count; i++) {
    const a = road.knots[i],
      b = road.knots[i + 1],
      from = lanePoint(road, lane, i / count),
      to = lanePoint(road, lane, (i + 1) / count),
      c1 = add(a.outgoing, sub(from, a.p)),
      c2 = add(b.incoming, sub(to, b.p));
    let length = 0,
      previous = from;
    for (let j = 1; j <= 40; j++) {
      const next = bezier(from, c1, c2, to, j / 40);
      length += dist(previous, next);
      previous = next;
    }
    maximum = Math.max(
      maximum,
      cs2CurveCurviness([from, c1, c2, to], length, road.width),
    );
  }
  return maximum;
}

const navigationLinks = new WeakMap<
  readonly Connection[],
  ReadonlyMap<string, readonly number[]>
>();
function connectionGroups(connections: readonly Connection[]) {
  let result = navigationLinks.get(connections);
  if (result) return result;
  const links = new Map<string, number[]>();
  for (const c of connections) {
    if (!c.enabled) continue;
    const key = `${c.from.road}:${c.from.lane}>${c.to.road}`;
    const lanes = links.get(key) ?? [];
    lanes.push(c.to.lane);
    links.set(key, lanes);
  }
  navigationLinks.set(connections, links);
  result = links;
  return result;
}

/** Twelve future browser road groups; original groups also include node lanes. */
export function buildCs2RoadNavigation(input: {
  route: readonly Step[];
  step: number;
  s: number;
  id: number;
  roads: ReadonlyMap<string, Road>;
  lengths: ReadonlyMap<string, number>;
  connections: readonly Connection[];
  traffic: LaneTraffic;
}): Cs2NavigationGroup[] {
  const steps = input.route.slice(input.step, input.step + 13);
  const links = connectionGroups(input.connections);
  return steps.map((step, index) => {
    const road = input.roads.get(step.road)!;
    const next = steps[index + 1];
    const length = input.lengths.get(road.id) ?? 1;
    const start = index === 0 ? Math.min(1, input.s / Math.max(1, length)) : 0;
    const lanes = Array.from({ length: laneCount(road) }, (_, lane) => lane)
      .filter(
        (lane) =>
          laneDirection(road, lane) === step.direction &&
          // End-only validation must not prematurely discard a fading lane.
          Math.max(
            laneWidth(road, lane, step.direction === 1 ? start : 1 - start),
            laneWidth(road, lane, step.direction === 1 ? 1 : 0),
          ) >
            road.width * 0.8,
      )
      .map((lane) => ({
        lane,
        objectCount: input.traffic.count(
          road.id,
          step.direction,
          lane,
          index === 0 ? input.s : -Infinity,
          input.id,
        ),
        next: next
          ? (links.get(`${road.id}:${lane}>${next.road}`) ?? []).filter(
              (lane) =>
                laneDirection(input.roads.get(next.road)!, lane) ===
                next.direction,
            )
          : undefined,
      }));
    return { lanes, curveStart: start, curveEnd: 1, allowChange: true };
  });
}

export function chooseCs2RoadLane(
  groups: readonly Cs2NavigationGroup[],
  current: number,
  turnAhead: boolean,
  priority = 100,
): number {
  if (!groups.length) return current;
  const future = backwardCs2LaneCosts(groups.slice(1), { priority, turnAhead });
  return chooseCs2CurrentLane({
    group: groups[0],
    currentLane: current,
    nextGroup: groups[1],
    nextCosts: future.costs[0],
    priority,
    baseCost: future.switchBaseCost,
    turnAhead,
  });
}
