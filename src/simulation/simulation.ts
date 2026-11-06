import { buildJunctions, type Junction } from "../core/junctions";
import { updateAutomaticTransitions } from "../core/auto-transitions";
import {
  add,
  arcParameter,
  arcTable,
  bezier,
  clamp,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  lerp,
  mul,
  smooth,
  tangent,
} from "../core/math";
import { connections, normalizePorts } from "../core/model";
import { SIGNAL_STOP_OFFSET } from "../core/traffic-signals";
import {
  isSink,
  isSource,
  type Connection,
  type Port,
  type Project,
  type Road,
  type V,
} from "../core/types";
import { bodiesOverlap, TrafficIndex } from "./collision";
import {
  chooseRetreat,
  waitCycles,
  type WaitingVehicle,
  type Retreat,
} from "./deadlock-recovery";
import {
  DEFAULT_DRIVER,
  VEHICLE_LENGTH,
  advanceVehicle,
  driverProfile,
  followingAcceleration,
  laneChangeIncentive,
  type DriverProfile,
  type Leader,
} from "./driving";
import { LaneTraffic, type LaneSample } from "./lane-traffic";
import { TrafficLightController, type SignalMovement } from "./traffic-lights";
import {
  IntersectionController,
  type JunctionRequest,
  type Movement,
} from "./intersections";
import {
  PredictiveJunctionController,
  type PredictionAgent,
  type PredictionPath,
  type YieldDirective,
  samplePredictionPath,
} from "./predictive-junction";
export type Step = {
  road: string;
  direction: 1 | -1;
  outLane: number;
  inLane: number;
};
export type Vehicle = {
  id: number;
  route: Step[];
  step: number;
  s: number;
  lane: number;
  laneChange?: { from: number; to: number; start: number; length: number };
  stalledFor?: number;
  signalEntry?: string;
  waitingAtSignal?: string;
  driver?: DriverProfile;
  preferredLane?: number;
  nextLaneDecision?: number;
  lastLaneChangeAt?: number;
  lastRerouteAt?: number;
  nextRouteDecision?: number;
  acceleration?: number;
  yieldingFor?: number;
  reversing?: boolean;
  lastMovementAt?: number;
  speed: number;
  age: number;
  color: number;
  position: V;
  heading: number;
  pitch: number;
  connector?: {
    id?: string;
    from: V;
    c1: V;
    c2: V;
    to: V;
    progress: number;
    length: number;
    arc: { t: number; s: number }[];
    junction?: string;
    movement?: Movement;
    speedLimit?: number;
  };
};
const key = (road: string, dir: number) => road + ":" + dir;
const laneKey = (road: string, dir: number, lane: number) =>
  `${road}:${dir}:${lane}`;
const laneChangeLength = (speed: number) =>
  Math.max(24, Math.min(50, Math.max(speed, 10) * 2.3));
const CONNECTION_LOOKAHEAD = 80;
type RoutingCache = {
  changes: Map<string, number>;
  links: Map<Connection, number>;
  trims?: ReadonlyMap<string, { start: number; end: number }>;
};
export function findRoute(
  p: Project,
  source: Port,
  sink: Port,
  cs = connections(p),
  preferredLane?: number,
  congestion?: ReadonlyMap<string, number>,
  startDistance = 0,
  cachedLengths?: ReadonlyMap<string, number>,
  cache?: RoutingCache,
): Step[] | undefined {
  const roads = new Map(p.roads.map((r) => [r.id, r]));
  const sourceRoad = roads.get(source.road),
    sinkRoad = roads.get(sink.road);
  if (!sourceRoad || !sinkRoad) return;
  const startDir = source.end === "start" ? 1 : -1,
    endDir = sink.end === "end" ? 1 : -1;
  if (
    (startDir === -1 && !sourceRoad.twoWay) ||
    (endDir === -1 && !sinkRoad.twoWay)
  )
    return;
  type LaneState = { road: string; direction: 1 | -1; lane: number };
  const lengths =
    cachedLengths ?? new Map(p.roads.map((r) => [r.id, arcTable(r).at(-1)!.s]));
  const junctionArms = cache?.trims
    ? []
    : buildJunctions(p).flatMap((j) => j.arms);
  const trims =
    cache?.trims ??
    new Map(
      p.roads.map((r) => [
        r.id,
        {
          start:
            junctionArms.find((a) => a.road === r.id && a.end === 0)?.trim ?? 0,
          end:
            junctionArms.find((a) => a.road === r.id && a.end === 1)?.trim ?? 0,
        },
      ]),
    );
  const links = new Map<string, Connection[]>();
  for (const c of cs) {
    if (!c.enabled) continue;
    const r = roads.get(c.from.road);
    if (!r || !roads.has(c.to.road)) continue;
    const k = key(r.id, laneDirection(r, c.from.lane));
    if (!links.has(k)) links.set(k, []);
    links.get(k)!.push(c);
  }
  const changeCost = (
    r: Road,
    direction: 1 | -1,
    from: number,
    to: number,
    offset: number,
  ) => {
    if (from === to) return 0;
    if (laneDirection(r, to) !== direction) return Infinity;
    const cacheKey = `${r.id}:${direction}:${from}:${to}`;
    if (offset === 0) {
      const saved = cache?.changes.get(cacheKey);
      if (saved !== undefined) return saved;
    }
    const length = lengths.get(r.id)!,
      trim = trims.get(r.id),
      begin = Math.max(
        offset,
        (direction === 1 ? trim?.start : trim?.end) ?? 0,
      ),
      end = length - ((direction === 1 ? trim?.end : trim?.start) ?? 0),
      minimum = 20 * Math.abs(to - from),
      lastStart = end - minimum - 6;
    if (lastStart < begin) return Infinity;
    for (let s = begin; s <= lastStart + 0.001; s += 2) {
      const widthAt = (lane: number, at: number) =>
        laneWidth(r, lane, direction === 1 ? at / length : 1 - at / length);
      // A lane that tapers away only needs to fit the car at the start of a
      // merge; the destination lane must fit it when the merge ends.
      const usable =
        widthAt(from, s) >= r.width * 0.8 &&
        widthAt(to, s + minimum) >= r.width * 0.8 &&
        Array.from(
          { length: Math.abs(to - from) - 1 },
          (_, i) => Math.min(from, to) + i + 1,
        ).every((lane) => widthAt(lane, s + minimum / 2) >= r.width * 0.8);
      if (usable) {
        const cost = Math.abs(to - from) * 2.5 + (s / length) * 2;
        if (offset === 0) cache?.changes.set(cacheKey, cost);
        return cost;
      }
    }
    if (offset === 0) cache?.changes.set(cacheKey, Infinity);
    return Infinity;
  };
  const states = new Map<string, LaneState>(),
    costs = new Map<string, number>(),
    previous = new Map<string, { key: string; outLane: number }>(),
    open = new Set<string>(),
    closed = new Set<string>();
  for (let lane = 0; lane < laneCount(sourceRoad); lane++) {
    if (
      (startDistance > 0 &&
        preferredLane !== undefined &&
        lane !== preferredLane) ||
      laneDirection(sourceRoad, lane) !== startDir ||
      laneWidth(sourceRoad, lane, startDir === 1 ? 0 : 1) <=
        sourceRoad.width * 0.8
    )
      continue;
    const k = laneKey(sourceRoad.id, startDir, lane);
    states.set(k, { road: sourceRoad.id, direction: startDir, lane });
    costs.set(
      k,
      // At an external boundary this is only a tie-breaker. Giving a random
      // entry lane more weight than a necessary change creates avoidable
      // weaving across turn queues. Existing cars are fixed above to their
      // actual lane whenever startDistance > 0.
      preferredLane === undefined ? 0 : Math.abs(lane - preferredLane) * 0.25,
    );
    open.add(k);
  }
  let goal: { key: string; lane: number; cost: number } | undefined;
  while (open.size) {
    let current = "";
    for (const k of open)
      if (!current || costs.get(k)! < costs.get(current)!) current = k;
    open.delete(current);
    if (goal && costs.get(current)! >= goal.cost) break;
    if (closed.has(current)) continue;
    closed.add(current);
    const state = states.get(current)!,
      r = roads.get(state.road)!,
      remaining =
        lengths.get(r.id)! -
        (r.id === sourceRoad.id && state.direction === startDir
          ? startDistance
          : 0),
      travel = remaining / Math.max(3, r.speed / 3.6),
      density =
        congestion?.get(laneKey(r.id, state.direction, state.lane)) ?? 0;
    if (r.id === sinkRoad.id && state.direction === endDir)
      for (let lane = 0; lane < laneCount(r); lane++) {
        if (
          laneDirection(r, lane) !== state.direction ||
          laneWidth(r, lane, state.direction === 1 ? 1 : 0) <= r.width * 0.8
        )
          continue;
        const change = changeCost(
          r,
          state.direction,
          state.lane,
          lane,
          r.id === sourceRoad.id ? startDistance : 0,
        );
        if (!Number.isFinite(change)) continue;
        const cost =
          costs.get(current)! +
          travel +
          change +
          Math.max(
            density,
            congestion?.get(laneKey(r.id, state.direction, lane)) ?? 0,
          ) *
            0.4;
        if (!goal || cost < goal.cost) goal = { key: current, lane, cost };
      }
    for (const c of links.get(key(r.id, state.direction)) ?? []) {
      const nextRoad = roads.get(c.to.road)!,
        nextDir = laneDirection(nextRoad, c.to.lane),
        change = changeCost(
          r,
          state.direction,
          state.lane,
          c.from.lane,
          r.id === sourceRoad.id ? startDistance : 0,
        );
      if (!Number.isFinite(change)) continue;
      const next = laneKey(nextRoad.id, nextDir, c.to.lane);
      let linkCost = cache?.links.get(c);
      if (linkCost === undefined) {
        const ad = mul(
            tangent(r, state.direction === 1 ? 1 : 0),
            state.direction,
          ),
          bd = mul(tangent(nextRoad, nextDir === 1 ? 0 : 1), nextDir),
          dot = ad.x * bd.x + ad.z * bd.z,
          turnCost = dot > 0.9 ? 0 : ad.x * bd.z - ad.z * bd.x > 0 ? 0.6 : 1.4,
          lateral =
            dot > 0.94
              ? (dist(
                  lanePoint(r, c.from.lane, state.direction === 1 ? 1 : 0),
                  lanePoint(nextRoad, c.to.lane, nextDir === 1 ? 0 : 1),
                ) /
                  r.width) *
                5
              : 0;
        linkCost = turnCost + lateral;
        cache?.links.set(c, linkCost);
      }
      const cost =
        costs.get(current)! +
        travel +
        change +
        Math.max(
          density,
          congestion?.get(laneKey(r.id, state.direction, c.from.lane)) ?? 0,
        ) *
          0.4 +
        linkCost;
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      states.set(next, {
        road: nextRoad.id,
        direction: nextDir,
        lane: c.to.lane,
      });
      costs.set(next, cost);
      previous.set(next, { key: current, outLane: c.from.lane });
      open.add(next);
    }
  }
  if (!goal) return;
  const route: Step[] = [];
  let at = goal.key,
    outLane = goal.lane;
  while (true) {
    const state = states.get(at)!;
    route.unshift({
      road: state.road,
      direction: state.direction,
      inLane: state.lane,
      outLane,
    });
    const parent = previous.get(at);
    if (!parent) break;
    at = parent.key;
    outLane = parent.outLane;
  }
  return route;
}
export class Simulation {
  vehicles: Vehicle[] = [];
  running = false;
  speed = 1;
  completed = 0;
  elapsed = 0;
  totalTime = 0;
  unreachable = 0;
  generated = 0;
  junctions: Junction[] = [];
  predictiveYielding = true;
  trafficLights = new TrafficLightController();
  private prediction = new PredictiveJunctionController();
  private predictionPaths = new Map<string, PredictionPath>();
  private yieldDirectives: ReadonlyMap<number, YieldDirective> = new Map();
  private nextPredictionAt = 0;
  private retreat?: Retreat & {
    s: number;
    fromIndex: number;
    connector: NonNullable<Vehicle["connector"]>;
  };
  private nextRecoveryAt = 0;
  private recoveryStatistics = {
    deadlockCycles: 0,
    retreats: 0,
    blockedRetreats: 0,
  };
  private demand = new Map<Port, { credit: number; waiting: number }>();
  private id = 0;
  private randomState = 123456;
  private timer = 0;
  private roads = new Map<string, Road>();
  private lengths = new Map<string, number>();
  private arcs = new Map<string, ReturnType<typeof arcTable>>();
  private routes: { source: Port; sink: Port; route: Step[] }[] = [];
  private project?: Project;
  private cs: Connection[] = [];
  private trims = new Map<string, { start: number; end: number }>();
  private mergeController = new IntersectionController();
  private connectorCache = new Map<string, NonNullable<Vehicle["connector"]>>();
  private mergeTargets = new Set<string>();
  private laneEnds = new Map<string, number>();
  private trafficDelays = new Map<string, number>();
  private sampledAt = 0;
  private routingCache: RoutingCache = { changes: new Map(), links: new Map() };
  statistics = {
    discretionaryChanges: 0,
    mandatoryChanges: 0,
    reroutes: 0,
    safetyStops: 0,
    junctionEntries: 0,
    simultaneousJunctions: 0,
  };
  configure(p: Project) {
    this.reset();
    updateAutomaticTransitions(p);
    normalizePorts(p);
    this.project = p;
    this.roads = new Map(p.roads.map((r) => [r.id, r]));
    this.arcs = new Map(p.roads.map((r) => [r.id, arcTable(r)]));
    this.lengths = new Map(
      p.roads.map((r) => [r.id, this.arcs.get(r.id)!.at(-1)!.s]),
    );
    this.laneEnds.clear();
    for (const r of p.roads) {
      const length = this.lengths.get(r.id)!;
      for (let lane = 0; lane < laneCount(r); lane++) {
        const direction = laneDirection(r, lane);
        let last = 0;
        for (let i = 0; i <= 100; i++) {
          const t = direction === 1 ? i / 100 : 1 - i / 100;
          if (laneWidth(r, lane, t) >= Math.max(2, r.width * 0.55))
            last = (length * i) / 100;
        }
        this.laneEnds.set(laneKey(r.id, direction, lane), last);
      }
    }
    this.junctions = buildJunctions(p);
    this.trims = new Map(
      p.roads.map((r) => {
        const arms = this.junctions
          .flatMap((j) => j.arms)
          .filter((a) => a.road === r.id);
        return [
          r.id,
          {
            start: arms.find((a) => a.end === 0)?.trim ?? 0,
            end: arms.find((a) => a.end === 1)?.trim ?? 0,
          },
        ];
      }),
    );
    this.cs = connections(p);
    this.routingCache.trims = this.trims;
    this.mergeTargets.clear();
    const inputs = new Map<string, Set<string>>();
    for (const c of this.cs) {
      const k = `${c.to.road}:${c.to.lane}`;
      let set = inputs.get(k);
      if (!set) {
        set = new Set();
        inputs.set(k, set);
      }
      set.add(`${c.from.road}:${c.from.lane}`);
    }
    for (const [k, set] of inputs) if (set.size > 1) this.mergeTargets.add(k);
    this.routes = [];
    const signalMovements: SignalMovement[] = [];
    if (p.signals?.length)
      for (const link of this.cs) {
        const fromRoad = this.roads.get(link.from.road)!,
          toRoad = this.roads.get(link.to.road)!;
        const from: Step = {
          road: fromRoad.id,
          direction: laneDirection(fromRoad, link.from.lane),
          inLane: link.from.lane,
          outLane: link.from.lane,
        };
        const to: Step = {
          road: toRoad.id,
          direction: laneDirection(toRoad, link.to.lane),
          inLane: link.to.lane,
          outLane: link.to.lane,
        };
        const connector = this.connector(from, to);
        if (connector.movement)
          signalMovements.push({
            id: connector.movement.id,
            junction: connector.movement.junction,
            road: from.road,
            end: from.direction === 1 ? 1 : 0,
            turn: connector.movement.turn,
          });
      }
    this.trafficLights.configure(this.junctions, p.signals, signalMovements);
    for (const source of p.ports.filter(isSource))
      for (const sink of p.ports.filter(isSink)) {
        if (source.road === sink.road && source.end === sink.end) continue;
        const route = findRoute(
          p,
          source,
          sink,
          this.cs,
          undefined,
          undefined,
          0,
          this.lengths,
          this.routingCache,
        );
        if (route) this.routes.push({ source, sink, route });
        else this.unreachable++;
      }
  }
  reset() {
    this.vehicles = [];
    this.completed = 0;
    this.elapsed = 0;
    this.totalTime = 0;
    this.timer = 0;
    this.id = 0;
    this.randomState = 123456;
    this.unreachable = 0;
    this.generated = 0;
    this.demand.clear();
    this.mergeController.clear();
    this.trafficLights.clear();
    this.prediction.clear();
    this.predictionPaths.clear();
    this.yieldDirectives = new Map();
    this.nextPredictionAt = 0;
    this.retreat = undefined;
    this.nextRecoveryAt = 0;
    this.recoveryStatistics = {
      deadlockCycles: 0,
      retreats: 0,
      blockedRetreats: 0,
    };
    this.connectorCache.clear();
    this.trafficDelays.clear();
    this.sampledAt = 0;
    this.routingCache.changes.clear();
    this.routingCache.links.clear();
    this.statistics = {
      discretionaryChanges: 0,
      mandatoryChanges: 0,
      reroutes: 0,
      safetyStops: 0,
      junctionEntries: 0,
      simultaneousJunctions: 0,
    };
  }
  private rand() {
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }
  private entry(step: Step) {
    const trims = this.trims.get(step.road)!;
    return step.direction === 1 ? trims.start : trims.end;
  }
  private exit(step: Step) {
    const trims = this.trims.get(step.road)!;
    return (
      this.lengths.get(step.road)! -
      (step.direction === 1 ? trims.end : trims.start)
    );
  }
  private pose(car: Vehicle) {
    const step = car.route[car.step],
      r = this.roads.get(step.road)!,
      len = this.lengths.get(r.id)!,
      arc = this.arcs.get(r.id)!;
    const positionAt = (s: number) => {
      const t = arcParameter(arc, step.direction === 1 ? s : len - s),
        change = car.laneChange,
        lane = change
          ? change.from +
            (change.to - change.from) *
              smooth((s - change.start) / change.length)
          : car.lane,
        lo = Math.floor(lane),
        hi = Math.ceil(lane);
      return lerp(lanePoint(r, lo, t), lanePoint(r, hi, t), lane - lo);
    };
    const a = positionAt(Math.max(0, car.s - 0.15)),
      b = positionAt(Math.min(len, car.s + 0.15));
    car.position = positionAt(car.s);
    car.heading = Math.atan2(b.z - a.z, b.x - a.x);
    car.pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
  }
  private advanceConnector(
    car: Vehicle,
    connector: NonNullable<Vehicle["connector"]>,
    distance: number,
  ) {
    const travelled = connector.progress * connector.length + distance;
    if (travelled >= connector.length) {
      car.connector = undefined;
      car.s = Math.min(
        this.exit(car.route[car.step]),
        car.s + travelled - connector.length,
      );
      this.pose(car);
      return;
    }
    connector.progress = travelled / connector.length;
    const t = arcParameter(connector.arc, travelled),
      a = bezier(
        connector.from,
        connector.c1,
        connector.c2,
        connector.to,
        clamp(t - 0.001),
      ),
      b = bezier(
        connector.from,
        connector.c1,
        connector.c2,
        connector.to,
        clamp(t + 0.001),
      );
    car.position = bezier(
      connector.from,
      connector.c1,
      connector.c2,
      connector.to,
      t,
    );
    car.heading = Math.atan2(b.z - a.z, b.x - a.x);
    car.pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
  }
  private occupancy(exclude?: number) {
    const result = new Map<string, number>();
    for (const car of this.vehicles) {
      if (car.id === exclude || car.connector) continue;
      const step = car.route[car.step],
        k = laneKey(step.road, step.direction, Math.round(car.lane));
      result.set(k, (result.get(k) ?? 0) + (car.speed < 1 ? 2 : 1));
    }
    for (const [k, delay] of this.trafficDelays)
      result.set(k, (result.get(k) ?? 0) + delay / 0.4);
    return result;
  }
  private sampleTraffic() {
    if (this.elapsed - this.sampledAt < 1) return;
    this.sampledAt = this.elapsed;
    const sums = new Map<
      string,
      { speed: number; count: number; road: Road }
    >();
    for (const car of this.vehicles) {
      if (car.connector) continue;
      const step = car.route[car.step],
        k = laneKey(step.road, step.direction, Math.round(car.lane)),
        r = this.roads.get(step.road);
      if (!r) continue;
      let row = sums.get(k);
      if (!row) {
        row = { speed: 0, count: 0, road: r };
        sums.set(k, row);
      }
      row.speed += car.speed;
      row.count++;
    }
    for (const k of new Set([...this.trafficDelays.keys(), ...sums.keys()])) {
      const row = sums.get(k),
        v = row ? row.speed / row.count : 0;
      const occupied = row
        ? Math.min(
            this.lengths.get(row.road.id)!,
            row.count * (VEHICLE_LENGTH + v * 1.2),
          )
        : 0;
      const sample = row
        ? Math.min(
            90,
            Math.max(
              0,
              occupied / Math.max(1, v) - occupied / (row.road.speed / 3.6),
            ),
          )
        : 0;
      const delay = (this.trafficDelays.get(k) ?? sample) * 0.8 + sample * 0.2;
      if (delay < 0.05) this.trafficDelays.delete(k);
      else this.trafficDelays.set(k, delay);
    }
  }
  private spawn(index: TrafficIndex<Vehicle>) {
    const congestion = this.occupancy();
    for (const source of [...new Set(this.routes.map((x) => x.source))]) {
      const rate = source.rate * (this.project?.trafficMultiplier ?? 1);
      if (rate <= 0) {
        this.demand.delete(source);
        continue;
      }
      const demand = this.demand.get(source) || { credit: 0, waiting: 0 };
      demand.credit += (rate / 60) * 0.2;
      const arrivals = Math.floor(demand.credit + 1e-9);
      demand.credit = Math.max(0, demand.credit - arrivals);
      demand.waiting += arrivals;
      this.generated += arrivals;
      this.demand.set(source, demand);
      if (this.vehicles.length >= 350 || !demand.waiting) continue;
      const options = this.routes.filter((x) => x.source === source),
        option = options[Math.floor(this.rand() * options.length)],
        r = this.roads.get(source.road)!,
        dir = source.end === "start" ? 1 : -1,
        valid = Array.from({ length: laneCount(r) }, (_, i) => i).filter(
          (i) =>
            laneDirection(r, i) === dir &&
            laneWidth(r, i, dir === 1 ? 0 : 1) > r.width * 0.75,
        );
      const offset = Math.floor(this.rand() * valid.length);
      for (let k = 0; k < valid.length; k++) {
        const route = findRoute(
          this.project!,
          source,
          option.sink,
          this.cs,
          valid[(k + offset) % valid.length],
          congestion,
          0,
          this.lengths,
          this.routingCache,
        );
        if (!route) continue;
        const step = route[0],
          entry = this.entry(step),
          gapAhead = this.vehicles
            .filter(
              (o) =>
                !o.connector &&
                o.route[o.step].road === step.road &&
                o.route[o.step].direction === step.direction &&
                (Math.abs(o.lane - step.inLane) < 0.85 ||
                  (o.laneChange &&
                    Math.abs(o.laneChange.to - step.inLane) < 0.85)) &&
                o.s >= entry,
            )
            .reduce((nearest, o) => Math.min(nearest, o.s - entry), Infinity),
          cruiseSpeed = Math.min((r.speed / 3.6) * 0.5, 10),
          initialSpeed = Math.min(
            cruiseSpeed,
            Math.max(0, (gapAhead - 4.8) / 1.4),
          );
        if (initialSpeed < Math.min(2.5, cruiseSpeed)) continue;
        const car: Vehicle = {
          id: this.id + 1,
          route,
          step: 0,
          s: entry,
          lane: step.inLane,
          speed: initialSpeed,
          driver: driverProfile(this.id + 1),
          age: 0,
          color: Math.floor(this.rand() * 5),
          position: { x: 0, y: 0, z: 0 },
          heading: 0,
          pitch: 0,
        };
        this.pose(car);
        if (index.blocked(car)) continue;
        this.id++;
        this.vehicles.push(car);
        index.add(car);
        demand.waiting--;
        break;
      }
    }
  }
  private connector(step: Step, next: Step): NonNullable<Vehicle["connector"]> {
    const id = `${step.road}:${step.outLane}>${next.road}:${next.inLane}`;
    const cached = this.connectorCache.get(id);
    if (cached) return { ...cached, progress: 0 };
    const r = this.roads.get(step.road)!,
      nr = this.roads.get(next.road)!,
      len = this.lengths.get(r.id)!,
      nlen = this.lengths.get(nr.id)!,
      ft = arcParameter(
        this.arcs.get(r.id)!,
        step.direction === 1 ? this.exit(step) : len - this.exit(step),
      ),
      nt = arcParameter(
        this.arcs.get(nr.id)!,
        next.direction === 1 ? this.entry(next) : nlen - this.entry(next),
      );
    const from = lanePoint(r, step.outLane, ft),
      to = lanePoint(nr, next.inLane, nt),
      d = dist(from, to),
      c1 = add(from, mul(tangent(r, ft), d * 0.45 * step.direction)),
      c2 = add(to, mul(tangent(nr, nt), -d * 0.45 * next.direction));
    const arc = [{ t: 0, s: 0 }];
    let last = from,
      s = 0;
    for (let i = 1; i <= 40; i++) {
      const p = bezier(from, c1, c2, to, i / 40);
      s += dist(last, p);
      arc.push({ t: i / 40, s });
      last = p;
    }
    const junction = this.junctions.find(
      (j) =>
        j.arms.some(
          (a) => a.road === r.id && a.end === (step.direction === 1 ? 1 : 0),
        ) &&
        j.arms.some(
          (a) => a.road === nr.id && a.end === (next.direction === 1 ? 0 : 1),
        ),
    )?.id;
    const controlJunction =
      junction ||
      (this.mergeTargets.has(`${nr.id}:${next.inLane}`)
        ? `merge:${nr.id}:${next.inLane}`
        : undefined);
    const ad = mul(tangent(r, ft), step.direction),
      bd = mul(tangent(nr, nt), next.direction);
    const cross = ad.x * bd.z - ad.z * bd.x,
      dot = ad.x * bd.x + ad.z * bd.z;
    const points = Array.from({ length: 21 }, (_, i) =>
      bezier(from, c1, c2, to, i / 20),
    );
    const movement: Movement | undefined = controlJunction
      ? {
          id,
          junction: controlJunction,
          from: `${r.id}:${step.outLane}`,
          to: `${nr.id}:${next.inLane}`,
          points: [add(from, mul(ad, -2.2)), ...points, add(to, mul(bd, 2.2))],
          priority: r.kind === "ramp" ? 0 : r.speed >= 80 ? 3 : 1,
          merge: this.mergeTargets.has(`${nr.id}:${next.inLane}`),
          turn: dot > 0.9 ? "straight" : cross > 0 ? "right" : "left",
        }
      : undefined;
    let radius = Infinity;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1],
        b = points[i],
        c = points[i + 1],
        ab = dist(a, b),
        bc = dist(b, c),
        ac = dist(a, c),
        area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      if (area > 1e-7) radius = Math.min(radius, (ab * bc * ac) / (2 * area));
    }
    const speedLimit = Math.min(
      r.speed / 3.6,
      nr.speed / 3.6,
      Math.max(3.2, Math.sqrt(radius * 2.3)),
    );
    const result = {
      id,
      from,
      to,
      c1,
      c2,
      arc,
      length: s,
      progress: 0,
      junction: controlJunction,
      movement,
      speedLimit,
    };
    this.connectorCache.set(id, result);
    return { ...result };
  }
  private reroute(car: Vehicle) {
    if (
      !this.project ||
      car.connector ||
      car.laneChange ||
      this.elapsed < (car.nextRouteDecision ?? 0) ||
      this.elapsed - (car.lastRerouteAt ?? -Infinity) < 10
    )
      return;
    car.nextRouteDecision = this.elapsed + 5;
    const current = car.route[car.step],
      destination = car.route.at(-1)!,
      lane = Math.round(car.lane),
      source: Port = {
        road: current.road,
        end: current.direction === 1 ? "start" : "end",
        type: "source",
        rate: 0,
      },
      sink: Port = {
        road: destination.road,
        end: destination.direction === 1 ? "end" : "start",
        type: "sink",
        rate: 0,
      },
      route = findRoute(
        this.project,
        source,
        sink,
        this.cs,
        lane,
        this.occupancy(car.id),
        car.s,
        this.lengths,
        this.routingCache,
      );
    if (!route || route[0].inLane !== lane) return;
    const remaining = car.route.slice(car.step);
    if (
      route.length === remaining.length &&
      route.every(
        (step, i) =>
          step.road === remaining[i].road &&
          step.direction === remaining[i].direction &&
          step.inLane === remaining[i].inLane &&
          step.outLane === remaining[i].outLane,
      )
    )
      return;
    const congestion = this.occupancy(car.id);
    const cost = (steps: Step[]) =>
      steps.reduce((sum, st, i) => {
        const road = this.roads.get(st.road)!;
        return (
          sum +
          Math.max(0, this.lengths.get(st.road)! - (i === 0 ? car.s : 0)) /
            (road.speed / 3.6) +
          Math.abs(st.inLane - st.outLane) * 2.5 +
          Math.max(
            congestion.get(laneKey(st.road, st.direction, st.inLane)) ?? 0,
            congestion.get(laneKey(st.road, st.direction, st.outLane)) ?? 0,
          ) *
            0.4
        );
      }, 0);
    const oldCost = cost(remaining),
      newCost = cost(route);
    const missed =
      20 * Math.abs(current.outLane - car.lane) + 6 >
      this.exit(current) - car.s;
    if (!missed && (oldCost - newCost < 2.5 || newCost > oldCost * 0.85))
      return;
    car.route = route;
    car.step = 0;
    car.preferredLane = undefined;
    car.lastRerouteAt = this.elapsed;
    this.statistics.reroutes++;
  }
  private chooseLane(car: Vehicle, r: Road, end: number, lanes: LaneTraffic) {
    const step = car.route[car.step],
      current = Math.round(car.lane),
      driver = car.driver ?? DEFAULT_DRIVER,
      v0 = (r.speed / 3.6) * driver.speedFactor;
    if (this.entry(step) > 0 && car.s - this.entry(step) < 8) return current;
    const here = lanes.neighbours(r.id, step.direction, current, car.s, car.id);
    const follow = (
      speed: number,
      leader: LaneSample | undefined,
      s: number,
      profile: DriverProfile,
    ) =>
      followingAcceleration(
        speed,
        (r.speed / 3.6) * profile.speedFactor,
        profile,
        leader
          ? { gap: leader.s - s - VEHICLE_LENGTH, speed: leader.speed }
          : undefined,
      );
    const before = followingAcceleration(
      car.speed,
      v0,
      driver,
      here.leader
        ? {
            gap: here.leader.s - car.s - VEHICLE_LENGTH,
            speed: here.leader.speed,
          }
        : undefined,
    );
    let best = current,
      score = 0.25;
    for (const candidate of [current - 1, current + 1]) {
      if (
        candidate < 0 ||
        candidate >= laneCount(r) ||
        laneDirection(r, candidate) !== step.direction
      )
        continue;
      const t = arcParameter(
        this.arcs.get(r.id)!,
        step.direction === 1 ? car.s : this.lengths.get(r.id)! - car.s,
      );
      if (laneWidth(r, candidate, t) < r.width * 0.85) continue;
      const candidateEnd =
        this.laneEnds.get(laneKey(r.id, step.direction, candidate)) ?? end;
      if (
        candidateEnd < end - 1 &&
        candidateEnd - car.s < laneChangeLength(car.speed) * 2 + 12
      )
        continue;
      const required = car.route[car.step + 1] ? step.outLane : current;
      const junctionApproach =
        (step.direction === 1
          ? this.trims.get(r.id)?.end
          : this.trims.get(r.id)?.start) ?? 0;
      if (
        Math.abs(candidate - required) > Math.abs(current - required) &&
        end - car.s <
          Math.max(
            junctionApproach > 0 ? 200 : 0,
            laneChangeLength(car.speed) * (Math.abs(candidate - required) + 1) +
              35,
          )
      )
        continue;
      const neighbours = lanes.neighbours(
          r.id,
          step.direction,
          candidate,
          car.s,
          car.id,
        ),
        front = neighbours.leader,
        back = neighbours.follower;
      if (front && front.s - car.s < VEHICLE_LENGTH + driver.minimumGap)
        continue;
      const backDriver = back
        ? (back.driver ?? driverProfile(back.id))
        : driver;
      if (back && car.s - back.s < VEHICLE_LENGTH + backDriver.minimumGap)
        continue;
      const ownAfter = follow(car.speed, front, car.s, driver);
      const followerBefore = back
        ? follow(back.speed, front, back.s, backDriver)
        : 0;
      const followerAfter = back
        ? followingAcceleration(
            back.speed,
            (r.speed / 3.6) * backDriver.speedFactor,
            backDriver,
            { gap: car.s - back.s - VEHICLE_LENGTH, speed: car.speed },
          )
        : 0;
      const oldBack = here.follower,
        oldDriver = oldBack
          ? (oldBack.driver ?? driverProfile(oldBack.id))
          : driver;
      const oldBefore = oldBack
        ? followingAcceleration(
            oldBack.speed,
            (r.speed / 3.6) * oldDriver.speedFactor,
            oldDriver,
            { gap: car.s - oldBack.s - VEHICLE_LENGTH, speed: car.speed },
          )
        : 0;
      const oldAfter = oldBack
        ? follow(oldBack.speed, here.leader, oldBack.s, oldDriver)
        : 0;
      const routeBias = car.route[car.step + 1]
        ? 0.65 * (Math.abs(current - required) - Math.abs(candidate - required))
        : 0;
      const rightBias =
        r.speed >= 80 ? (candidate - current) * step.direction * 0.3 : 0;
      const incentive = laneChangeIncentive({
        before,
        after: ownAfter,
        followerBefore,
        followerAfter,
        oldFollowerBefore: oldBefore,
        oldFollowerAfter: oldAfter,
        driver,
        bias: routeBias + rightBias,
      });
      if (incentive > score) {
        score = incentive;
        best = candidate;
      }
    }
    return best;
  }
  private junctionPermissions(lanes: LaneTraffic) {
    const cars = new Map(this.vehicles.map((c) => [c.id, c]));
    for (const [id, movement] of this.mergeController.reservations) {
      const car = cars.get(id),
        step = car?.route[car.step];
      if (
        !car ||
        (!car.connector &&
          (!step ||
            !movement.to.startsWith(step.road + ":") ||
            car.s >= this.entry(step) + VEHICLE_LENGTH + 1))
      )
        this.mergeController.leave(id);
    }
    const requests: JunctionRequest[] = [];
    const permitted = new Set<number>();
    for (const car of this.vehicles) {
      car.waitingAtSignal = undefined;
      if (car.connector || car.laneChange) continue;
      const step = car.route[car.step],
        next = car.route[car.step + 1];
      if (!step || !next) continue;
      const distance = this.exit(step) - car.s;
      const signalConnector = this.trafficLights.enabled
        ? this.connector(step, next)
        : undefined;
      if (
        distance >
        Math.max(
          this.connectionLookahead(car, signalConnector),
          car.speed * 3.5,
        )
      )
        continue;
      if (Math.abs(car.lane - step.outLane) > 0.15) continue;
      const connector = signalConnector ?? this.connector(step, next);
      if (!connector.movement) continue;
      const signalAllows = this.signalAllows(car, connector, distance);
      if (!signalAllows) {
        car.waitingAtSignal = connector.junction;
        continue;
      }
      if (this.controlsMerge(connector.movement)) {
        if (distance > Math.max(15, car.speed * 3.5)) continue;
        // Only the queue head can reserve a merge. Ordinary unsignalized
        // junctions use continuous following and destination capacity instead.
        if (
          lanes.neighbours(
            step.road,
            step.direction,
            step.outLane,
            car.s,
            car.id,
          ).leader
        )
          continue;
      }
      const first = lanes.neighbours(
        next.road,
        next.direction,
        next.inLane,
        this.entry(next) - 0.001,
        car.id,
      ).leader;
      const space =
        !first ||
        first.s - this.entry(next) >
          VEHICLE_LENGTH + (car.driver?.minimumGap ?? 1.7) + 1;
      // Capacity applies to both signalized and unsignalized intersections.
      if (!this.controlsMerge(connector.movement)) {
        if (space) permitted.add(car.id);
        continue;
      }
      requests.push({
        id: car.id,
        movement: connector.movement,
        eta: distance < 7 ? 0 : distance / Math.max(1, car.speed),
        queued: car.speed < 5 && distance < 15,
        space,
      });
    }
    for (const id of this.mergeController.plan(requests, this.elapsed))
      permitted.add(id);
    return permitted;
  }
  private connectionLookahead(
    car: Vehicle,
    connector?: NonNullable<Vehicle["connector"]>,
  ) {
    return this.trafficLights.has(connector?.junction)
      ? Math.max(
          CONNECTION_LOOKAHEAD,
          (car.speed * car.speed) /
            (2 * (car.driver?.comfortableBrake ?? 2.5)) +
            car.speed * 1.5 +
            SIGNAL_STOP_OFFSET +
            VEHICLE_LENGTH,
        )
      : CONNECTION_LOOKAHEAD;
  }
  private signalAllows(
    car: Vehicle,
    connector: NonNullable<Vehicle["connector"]>,
    distance: number,
  ) {
    if (
      !connector.movement ||
      !this.trafficLights.has(connector.junction) ||
      car.signalEntry === connector.junction
    )
      return true;
    return this.trafficLights.allows(
      connector.movement.id,
      car.id,
      distance - SIGNAL_STOP_OFFSET - VEHICLE_LENGTH / 2,
      car.speed,
      car.driver?.comfortableBrake,
    );
  }
  private occupiedSignals() {
    const occupied = new Set<string>();
    for (const car of this.vehicles) {
      const junction = car.connector?.junction ?? car.signalEntry;
      if (!junction || !this.trafficLights.has(junction)) continue;
      const step = car.route[car.step];
      if (
        car.connector ||
        (car.signalEntry &&
          (car.s < this.entry(step) + VEHICLE_LENGTH + 1 ||
            (car.route[car.step + 1] &&
              this.connector(step, car.route[car.step + 1]).junction ===
                junction)))
      )
        occupied.add(junction);
      else car.signalEntry = undefined;
    }
    return occupied;
  }
  private controlsMerge(movement: Movement) {
    return movement.junction.startsWith("merge:");
  }
  private predictionPath(
    from: Step,
    to: Step,
    c: NonNullable<Vehicle["connector"]>,
  ): PredictionPath {
    const cached = this.predictionPaths.get(c.id!);
    if (cached) return cached;
    const road = this.roads.get(from.road)!,
      next = this.roads.get(to.road)!;
    const start = -Math.min(100, this.exit(from) - this.entry(from));
    const end = c.length + Math.min(16, this.exit(to) - this.entry(to));
    const positionAt = (s: number) => {
      if (s < 0) {
        const distance = this.exit(from) + s;
        return lanePoint(
          road,
          from.outLane,
          arcParameter(
            this.arcs.get(road.id)!,
            from.direction === 1
              ? distance
              : this.lengths.get(road.id)! - distance,
          ),
        );
      }
      if (s > c.length) {
        const distance = this.entry(to) + s - c.length;
        return lanePoint(
          next,
          to.inLane,
          arcParameter(
            this.arcs.get(next.id)!,
            to.direction === 1
              ? distance
              : this.lengths.get(next.id)! - distance,
          ),
        );
      }
      return bezier(c.from, c.c1, c.c2, c.to, arcParameter(c.arc, s));
    };
    const points = [];
    const count = Math.max(1, Math.ceil((end - start) / 0.5));
    for (let i = 0; i <= count; i++) {
      const s = start + ((end - start) * i) / count;
      const a = positionAt(s - 0.05),
        b = positionAt(s + 0.05);
      points.push({
        s,
        position: positionAt(s),
        heading: Math.atan2(b.z - a.z, b.x - a.x),
      });
    }
    const movement = c.movement!;
    const path = {
      id: c.id!,
      junction: movement.junction,
      from: movement.from,
      to: movement.to,
      length: c.length,
      points,
    };
    this.predictionPaths.set(path.id, path);
    return path;
  }
  private predictionAgents(lanes: LaneTraffic): PredictionAgent[] {
    const agents: PredictionAgent[] = [];
    for (const car of this.vehicles) {
      if (car.laneChange) continue;
      const current = car.route[car.step],
        previous = car.route[car.step - 1],
        next = car.route[car.step + 1];
      let from: Step,
        to: Step,
        connector: NonNullable<Vehicle["connector"]>,
        s: number;
      if (car.connector && previous) {
        from = previous;
        to = current;
        connector = car.connector;
        s = connector.progress * connector.length;
      } else if (
        next &&
        this.exit(current) - car.s < 100 &&
        Math.abs(car.lane - current.outLane) < 0.1
      ) {
        from = current;
        to = next;
        connector = this.connector(from, to);
        s = car.s - this.exit(from);
        const first = lanes.neighbours(
          current.road,
          current.direction,
          car.lane,
          car.s,
          car.id,
        ).leader;
        if (
          first &&
          lanes.neighbours(
            current.road,
            current.direction,
            car.lane,
            first.s + 0.001,
            first.id,
          ).leader
        )
          continue;
        if (
          car.speed < 0.25 &&
          s < -8 &&
          lanes.neighbours(
            current.road,
            current.direction,
            car.lane,
            car.s,
            car.id,
          ).leader
        )
          continue;
      } else if (previous && car.s - this.entry(current) < 8) {
        from = previous;
        to = current;
        connector = this.connector(from, to);
        s = connector.length + car.s - this.entry(current);
      } else continue;
      if (!connector.movement || this.controlsMerge(connector.movement))
        continue;
      const driver = car.driver ?? driverProfile(car.id);
      const path = this.predictionPath(from, to, connector);
      let leader: Leader | undefined;
      let leaderId: number | undefined;
      const takeLeader = (gap: number, speed: number, id: number) => {
        if (!leader || gap < leader.gap) {
          leader = { gap, speed };
          leaderId = id;
        }
      };
      if (s < 0) {
        const front = lanes.neighbours(
          from.road,
          from.direction,
          from.outLane,
          car.s,
          car.id,
        ).leader;
        if (front)
          takeLeader(front.s - car.s - VEHICLE_LENGTH, front.speed, front.id);
      }
      const inside = lanes.onConnector(path.id, Math.max(0, s), car.id).leader;
      if (inside)
        takeLeader(inside.s - s - VEHICLE_LENGTH, inside.speed, inside.id);
      const entry = this.entry(to);
      const first = lanes.neighbours(
        to.road,
        to.direction,
        to.inLane,
        s >= connector.length ? car.s - 0.001 : entry - 0.001,
        car.id,
      ).leader;
      if (first)
        takeLeader(
          connector.length - s + first.s - entry - VEHICLE_LENGTH,
          first.speed,
          first.id,
        );
      agents.push({
        id: car.id,
        path,
        s,
        speed: car.speed,
        driver,
        leader,
        leaderId,
        freeSpeed:
          (this.roads.get(from.road)!.speed / 3.6) * driver.speedFactor,
        turnSpeed: connector.speedLimit ?? 8,
        exitSpeed: (this.roads.get(to.road)!.speed / 3.6) * driver.speedFactor,
        canExit:
          s >= connector.length ||
          !first ||
          first.s - entry > VEHICLE_LENGTH + driver.minimumGap + 1,
        stopS:
          s < 0 && !this.signalAllows(car, connector, -s)
            ? -SIGNAL_STOP_OFFSET
            : undefined,
      });
    }
    return agents;
  }
  private predictionProgress(car: Vehicle, path: string): number | undefined {
    const current = car.route[car.step],
      next = car.route[car.step + 1],
      previous = car.route[car.step - 1];
    if (car.connector?.id === path)
      return car.connector.progress * car.connector.length;
    if (
      !car.connector &&
      next &&
      `${current.road}:${current.outLane}>${next.road}:${next.inLane}` === path
    )
      return car.s - this.exit(current);
    if (
      !car.connector &&
      previous &&
      `${previous.road}:${previous.outLane}>${current.road}:${current.inLane}` ===
        path
    )
      return (
        (this.predictionPaths.get(path)?.length ?? 0) +
        car.s -
        this.entry(current)
      );
    return undefined;
  }
  private yielding(car: Vehicle): {
    leader?: Leader;
    acceleration: number;
    distance: number;
  } {
    const directives = this.predictiveYielding
      ? this.prediction.constraintsFor(car.id)
      : [];
    let leader: Leader | undefined,
      acceleration = Infinity,
      distance = Infinity;
    car.yieldingFor = undefined;
    for (const directive of directives) {
      const s = this.predictionProgress(car, directive.path);
      if (s === undefined) continue;
      if (directive.follow) {
        const follow = {
          gap: directive.leaderS - s - VEHICLE_LENGTH,
          speed: directive.leaderSpeed,
        };
        if (!leader || follow.gap < leader.gap) {
          leader = follow;
          car.yieldingFor = directive.winner;
        }
        continue;
      }
      const available = Math.max(0, directive.stopS - s);
      const time = Math.max(0.1, directive.releaseAt - this.elapsed);
      const required = (2 * (available - car.speed * time)) / (time * time);
      if (available < distance) {
        distance = available;
        car.yieldingFor = directive.winner;
      }
      if (required < 0) acceleration = Math.min(acceleration, required);
      if (
        time < 0.4 ||
        available < Math.max(1, (car.speed * car.speed) / 16 + car.speed * 0.1)
      ) {
        const stop = {
          gap: available + (car.driver?.minimumGap ?? 1.7),
          speed: 0,
        };
        if (!leader || stop.gap < leader.gap) leader = stop;
      }
    }
    return { leader, acceleration, distance };
  }
  get predictionStatistics() {
    return { ...this.prediction.statistics, ...this.recoveryStatistics };
  }
  get predictionDebug() {
    return this.prediction.debug;
  }
  private tryRecovery(lanes: LaneTraffic, index: TrafficIndex<Vehicle>) {
    if (this.retreat || this.elapsed < this.nextRecoveryAt) return;
    this.nextRecoveryAt = this.elapsed + 0.5;
    const agents = this.predictionAgents(lanes),
      waiting: WaitingVehicle[] = [];
    for (const a of agents) {
      const car = this.vehicles.find((c) => c.id === a.id)!;
      if (
        car.waitingAtSignal ||
        car.speed > 0.25 ||
        this.elapsed - (car.lastMovementAt ?? this.elapsed) < 2
      )
        continue;
      const pose = samplePredictionPath(a.path, a.s + 0.25);
      const blockers = index
        .near(pose.position)
        .filter((c) => c.id !== a.id && bodiesOverlap({ id: a.id, ...pose }, c))
        .map((c) => c.id);
      for (const c of this.prediction.constraintsFor(a.id))
        if (!blockers.includes(c.winner)) blockers.push(c.winner);
      waiting.push({ id: a.id, path: a.path, s: a.s, blockers });
    }
    for (const cycle of waitCycles(waiting)) {
      this.recoveryStatistics.deadlockCycles++;
      const retreat = chooseRetreat(cycle, waiting, this.vehicles);
      if (!retreat) {
        this.recoveryStatistics.blockedRetreats++;
        continue;
      }
      const car = this.vehicles.find((c) => c.id === retreat.id)!;
      const fromIndex = car.connector
        ? car.step - 1
        : car.route[car.step + 1] &&
            `${car.route[car.step].road}:${car.route[car.step].outLane}>${car.route[car.step + 1].road}:${car.route[car.step + 1].inLane}` ===
              retreat.path.id
          ? car.step
          : car.step - 1;
      if (fromIndex < 0) continue;
      this.retreat = {
        ...retreat,
        s: retreat.fromS,
        fromIndex,
        connector: this.connector(
          car.route[fromIndex],
          car.route[fromIndex + 1],
        ),
      };
      car.reversing = true;
      this.recoveryStatistics.retreats++;
      return;
    }
  }
  private setRetreatPosition(car: Vehicle, s: number) {
    const retreat = this.retreat!,
      from = car.route[retreat.fromIndex],
      to = car.route[retreat.fromIndex + 1],
      c = { ...retreat.connector };
    car.laneChange = undefined;
    if (s < 0) {
      car.step = retreat.fromIndex;
      car.s = this.exit(from) + s;
      car.lane = from.outLane;
      car.connector = undefined;
      this.pose(car);
    } else {
      car.step = retreat.fromIndex + 1;
      car.s = this.entry(to);
      car.lane = to.inLane;
      c.progress = 0;
      car.connector = c;
      this.advanceConnector(car, c, s);
    }
  }
  private recoveryHolds(car: Vehicle) {
    const retreat = this.retreat;
    if (!retreat || car.id === retreat.id) return false;
    if (car.connector?.junction === retreat.path.junction) return true;
    const current = car.route[car.step],
      next = car.route[car.step + 1];
    return (
      !!next &&
      this.exit(current) - car.s < 14 &&
      this.connector(current, next).junction === retreat.path.junction
    );
  }
  update(delta: number) {
    if (!this.running) return;
    const total = Math.min(Math.max(delta, 0), 0.05) * this.speed,
      n = Math.max(1, Math.ceil(total / 0.025)),
      dt = total / n;
    for (let i = 0; i < n; i++) this.integrate(dt);
  }
  private integrate(dt: number) {
    this.elapsed += dt;
    if (this.trafficLights.enabled)
      this.trafficLights.update(dt, this.occupiedSignals());
    const index = new TrafficIndex<Vehicle>();
    this.vehicles.forEach((c) => index.add(c));
    this.timer += dt;
    while (this.timer >= 0.2 - 1e-9) {
      this.timer = Math.max(0, this.timer - 0.2);
      this.spawn(index);
    }
    this.sampleTraffic();
    const lanes = new LaneTraffic(this.vehicles);
    const permissions = this.junctionPermissions(lanes);
    if (
      this.predictiveYielding &&
      !this.retreat &&
      this.elapsed >= this.nextPredictionAt
    ) {
      this.yieldDirectives = this.prediction.plan(
        this.predictionAgents(lanes),
        this.elapsed,
      );
      this.nextPredictionAt = this.elapsed + 0.1;
    } else if (!this.predictiveYielding && this.yieldDirectives.size) {
      this.prediction.clear();
      this.yieldDirectives = new Map();
    }
    if (this.predictiveYielding) this.tryRecovery(lanes, index);
    const finished = new Set<number>();
    for (const car of this.vehicles) {
      car.driver ??= driverProfile(car.id);
      car.lastMovementAt ??= this.elapsed;
      const original = {
        ...car,
        signalEntry: car.signalEntry,
        connector: car.connector ? { ...car.connector } : undefined,
        laneChange: car.laneChange ? { ...car.laneChange } : undefined,
      };
      car.age += dt;
      if (this.retreat?.id === car.id) {
        const retreat = this.retreat;
        const nextS = Math.max(retreat.toS, retreat.s - 0.8 * dt);
        this.setRetreatPosition(car, nextS);
        car.speed = 0;
        car.reversing = true;
        if (index.blocked(car)) {
          Object.assign(car, original);
          car.reversing = false;
          this.retreat = undefined;
          this.recoveryStatistics.blockedRetreats++;
          this.nextRecoveryAt = this.elapsed + 2;
        } else {
          retreat.s = nextS;
          car.lastMovementAt = this.elapsed;
          index.update(car);
          if (nextS <= retreat.toS + 1e-6) {
            car.reversing = false;
            this.prediction.forget(new Set(retreat.participants));
            this.prediction.prefer(retreat.clears, this.elapsed + 3);
            this.retreat = undefined;
            this.nextPredictionAt = 0;
            this.nextRecoveryAt = this.elapsed + 2;
          }
        }
        continue;
      }
      if (this.recoveryHolds(car)) {
        car.speed = 0;
        continue;
      }
      const step = car.route[car.step],
        r = this.roads.get(step.road);
      if (!r) {
        finished.add(car.id);
        index.remove(car);
        continue;
      }
      let acquired: Movement | undefined;
      const yielding = this.yielding(car);
      if (car.connector) {
        const c = car.connector;
        const downstream = lanes.neighbours(
          step.road,
          step.direction,
          car.lane,
          car.s - 0.001,
          car.id,
        ).leader;
        const driver = car.driver;
        let leader: Leader | undefined = downstream
          ? {
              gap:
                (1 - c.progress) * c.length +
                downstream.s -
                car.s -
                VEHICLE_LENGTH,
              speed: downstream.speed,
            }
          : undefined;
        const ahead = c.id
          ? lanes.onConnector(c.id, c.progress * c.length, car.id).leader
          : undefined;
        if (ahead) {
          const gap = ahead.s - c.progress * c.length - VEHICLE_LENGTH;
          if (!leader || gap < leader.gap) leader = { gap, speed: ahead.speed };
        }
        if (yielding.leader && (!leader || yielding.leader.gap < leader.gap))
          leader = yielding.leader;
        const acceleration = Math.max(
          -driver.emergencyBrake,
          Math.min(
            yielding.acceleration,
            followingAcceleration(
              car.speed,
              Math.min(c.speedLimit ?? 8, (r.speed / 3.6) * driver.speedFactor),
              driver,
              leader,
            ),
          ),
        );
        const advance = advanceVehicle(car.speed, acceleration, dt);
        if (advance.distance > yielding.distance) {
          advance.distance = yielding.distance;
          advance.speed = 0;
        }
        car.acceleration = acceleration;
        car.speed = advance.speed;
        this.advanceConnector(car, c, advance.distance);
      } else {
        const len = this.lengths.get(r.id)!,
          end = this.exit(step),
          t = arcParameter(
            this.arcs.get(r.id)!,
            step.direction === 1 ? car.s : len - car.s,
          ),
          next = car.route[car.step + 1];
        // If a late lane change cannot finish safely, keep the current lane
        // through an equivalent link to the same road and change there.
        if (
          next &&
          !car.laneChange &&
          Math.abs(car.lane - step.outLane) > 0.15
        ) {
          const current = Math.round(car.lane),
            needed = laneChangeLength(car.speed) + 8,
            nextRoad = this.roads.get(next.road);
          if (
            end - car.s < needed &&
            laneWidth(r, current, step.direction === 1 ? 1 : 0) >
              r.width * 0.8 &&
            nextRoad
          ) {
            const alternate = this.cs
              .filter(
                (c) =>
                  c.enabled &&
                  c.from.road === r.id &&
                  c.from.lane === current &&
                  c.to.road === next.road &&
                  laneDirection(nextRoad, c.to.lane) === next.direction,
              )
              .sort(
                (a, b) =>
                  Math.abs(a.to.lane - next.inLane) -
                  Math.abs(b.to.lane - next.inLane),
              )[0];
            if (alternate) {
              step.outLane = current;
              next.inLane = alternate.to.lane;
            }
          }
        }
        const routeTarget =
          !next &&
          laneWidth(r, Math.round(car.lane), step.direction === 1 ? 1 : 0) >
            r.width * 0.8
            ? Math.round(car.lane)
            : step.outLane;
        const currentLane = Math.round(car.lane);
        const changeEnd = Math.min(
          end,
          this.laneEnds.get(laneKey(r.id, step.direction, currentLane)) ?? end,
        );
        const preparation = Math.max(
          90,
          car.speed * 7 +
            laneChangeLength(car.speed) * Math.abs(routeTarget - currentLane),
        );
        const mustChange =
          Math.abs(routeTarget - currentLane) > 0.1 &&
          changeEnd - car.s < preparation;
        let target = car.laneChange?.to ?? car.preferredLane ?? currentLane;
        if (mustChange) target = routeTarget;
        if (
          !car.laneChange &&
          this.elapsed >= (car.nextLaneDecision ?? 0) &&
          this.elapsed - (car.lastLaneChangeAt ?? -Infinity) > 2.5
        ) {
          car.nextLaneDecision = this.elapsed + 0.45 + (car.id % 5) * 0.03;
          if (!mustChange) target = this.chooseLane(car, r, end, lanes);
          car.preferredLane = target;
        }
        let desired =
          laneWidth(r, target, t) > r.width * 0.8 ? target : car.lane;
        if (laneWidth(r, Math.round(car.lane), t) < r.width * 0.85) {
          const valid = Array.from(
            { length: laneCount(r) },
            (_, i) => i,
          ).filter(
            (i) =>
              laneDirection(r, i) === step.direction &&
              laneWidth(r, i, t) > r.width * 0.9,
          );
          desired = valid.reduce(
            (a, b) => (Math.abs(b - car.lane) < Math.abs(a - car.lane) ? b : a),
            valid[0] ?? car.lane,
          );
        }
        if (!car.laneChange && Math.abs(desired - car.lane) > 1)
          desired = currentLane + Math.sign(desired - currentLane);
        if (car.laneChange) desired = car.laneChange.to;
        const minimumChange = Math.min(
          20,
          Math.max(8, car.speed * 1.3),
          Math.max(8, end - this.entry(step) - 6),
        );
        const changeLength = Math.max(
          0,
          Math.min(
            laneChangeLength(car.speed),
            (changeEnd - car.s - 6) /
              Math.max(1, Math.abs(routeTarget - currentLane)),
          ),
        );
        const changeTime = Math.min(3, changeLength / Math.max(car.speed, 5));
        const startingChange =
          !car.laneChange && Math.abs(desired - car.lane) > 0.08;
        const targetBack = startingChange
          ? lanes.neighbours(
              r.id,
              step.direction,
              Math.round(desired),
              car.s,
              car.id,
            ).follower
          : undefined;
        const unsafeRear =
          targetBack &&
          Math.abs(desired - car.lane) > 0.1 &&
          followingAcceleration(
            targetBack.speed,
            r.speed / 3.6,
            targetBack.driver ?? driverProfile(targetBack.id),
            { gap: car.s - targetBack.s - VEHICLE_LENGTH, speed: car.speed },
          ) < -car.driver.safeBrake;
        const blockedChange =
          startingChange &&
          (!!unsafeRear ||
            this.vehicles.some(
              (o) =>
                o.id !== car.id &&
                !o.connector &&
                o.route[o.step].road === r.id &&
                o.route[o.step].direction === step.direction &&
                (Math.abs(o.lane - car.lane) > 0.55 || !!o.laneChange) &&
                ((o.lane >= Math.min(car.lane, desired) - 0.7 &&
                  o.lane <= Math.max(car.lane, desired) + 0.7) ||
                  (o.laneChange &&
                    o.laneChange.to >= Math.min(car.lane, desired) - 0.7 &&
                    o.laneChange.to <= Math.max(car.lane, desired) + 0.7)) &&
                ((o.s >= car.s &&
                  o.s - car.s <
                    4.8 + Math.max(0, car.speed - o.speed) * changeTime) ||
                  (o.s < car.s &&
                    car.s - o.s <
                      (o.laneChange ? 0 : 3.5) +
                        Math.max(0, o.speed - car.speed) * changeTime)),
            ));
        if (car.laneChange && Math.abs(car.laneChange.to - desired) > 0.1)
          car.laneChange = undefined;
        if (
          !car.laneChange &&
          !blockedChange &&
          changeLength >= minimumChange &&
          Math.abs(desired - car.lane) > 0.08
        ) {
          car.laneChange = {
            from: car.lane,
            to: desired,
            start: car.s,
            length: changeLength,
          };
          if (
            Math.abs(desired - routeTarget) < Math.abs(car.lane - routeTarget)
          )
            this.statistics.mandatoryChanges++;
          else this.statistics.discretionaryChanges++;
        }
        // Opposing lane changes at the same longitudinal position cannot both
        // proceed. Let the leading car go first; break ties by stable vehicle id.
        const swap =
          Math.abs(target - car.lane) > 0.1
            ? this.vehicles.find((o) => {
                if (o.id === car.id || o.connector) return false;
                const os = o.route[o.step];
                return (
                  os.road === r.id &&
                  os.direction === step.direction &&
                  Math.abs(target - car.lane) > 0.1 &&
                  Math.abs(o.lane - car.lane) > 0.55 &&
                  Math.abs(o.s - car.s) < 12 &&
                  Math.abs(o.lane - target) < 0.8 &&
                  Math.abs(os.outLane - car.lane) < 0.8
                );
              })
            : undefined;
        const yieldSwap =
          swap &&
          (car.s < swap.s - 0.5 ||
            (Math.abs(car.s - swap.s) <= 0.5 && car.id > swap.id));
        let limit = (r.speed / 3.6) * car.driver.speedFactor;
        if (yieldSwap) limit = 0;
        const fronts = [
          Math.floor(car.lane),
          Math.ceil(car.lane),
          ...(car.laneChange ? [car.laneChange.to] : []),
        ]
          .map(
            (lane) =>
              lanes.neighbours(r.id, step.direction, lane, car.s, car.id)
                .leader,
          )
          .filter((v): v is LaneSample => !!v);
        const front = fronts.sort((a, b) => a.s - b.s)[0];
        let leader: Leader | undefined = front
          ? { gap: front.s - car.s - VEHICLE_LENGTH, speed: front.speed }
          : undefined;
        if (
          !car.laneChange &&
          Math.abs(car.lane - routeTarget) > 0.08 &&
          mustChange
        ) {
          // Preserve room for every remaining adjacent change while waiting
          // for a safe gap, including on short collector/distributor segments.
          const stop = {
            gap:
              changeEnd -
              car.s -
              minimumChange * Math.abs(routeTarget - currentLane) -
              6,
            speed: 0,
          };
          if (!leader || stop.gap < leader.gap) leader = stop;
        }
        const signalConnector =
          next && this.trafficLights.enabled
            ? this.connector(step, next)
            : undefined;
        const lookahead = this.connectionLookahead(car, signalConnector);
        const connector =
          next && end - car.s < lookahead
            ? (signalConnector ?? this.connector(step, next))
            : undefined;
        const nextEntry = next ? this.entry(next) : 0;
        const nextTraffic =
          next && end - car.s < lookahead
            ? lanes.neighbours(
                next.road,
                next.direction,
                next.inLane,
                nextEntry - 0.001,
                car.id,
              ).leader
            : undefined;
        const nextGap = nextTraffic
          ? end -
            car.s +
            (connector?.length ?? 0) +
            nextTraffic.s -
            nextEntry -
            VEHICLE_LENGTH
          : Infinity;
        if (nextTraffic && (!leader || nextGap < leader.gap))
          leader = { gap: nextGap, speed: nextTraffic.speed };
        const inJunction = connector?.id
          ? lanes.onConnector(connector.id, 0, car.id).leader
          : undefined;
        if (inJunction) {
          const gap = end - car.s + inJunction.s - VEHICLE_LENGTH;
          if (!leader || gap < leader.gap)
            leader = { gap, speed: inJunction.speed };
        }
        const permitted =
          !connector?.movement ||
          (permissions.has(car.id) &&
            (!this.controlsMerge(connector.movement) ||
              this.mergeController.canEnter(car.id, connector.movement)));
        const signalStopOffset =
          this.trafficLights.has(connector?.junction) &&
          car.signalEntry !== connector?.junction
            ? SIGNAL_STOP_OFFSET
            : 0;
        if (connector) {
          const turnSpeed = connector.speedLimit ?? limit;
          limit = Math.min(
            limit,
            Math.sqrt(
              turnSpeed * turnSpeed +
                2 * car.driver.comfortableBrake * Math.max(0, end - car.s),
            ),
          );
          if (!permitted) {
            const stop = {
              gap: end - car.s - VEHICLE_LENGTH / 2 - signalStopOffset,
              speed: 0,
            };
            if (!leader || stop.gap < leader.gap) leader = stop;
          }
        }
        if (yielding.leader && (!leader || yielding.leader.gap < leader.gap))
          leader = yielding.leader;
        const acceleration = Math.max(
          -car.driver.emergencyBrake,
          Math.min(
            yielding.acceleration,
            followingAcceleration(
              car.speed,
              Math.max(0.1, limit),
              car.driver,
              leader,
            ),
          ),
        );
        const advance = advanceVehicle(car.speed, acceleration, dt);
        if (advance.distance > yielding.distance) {
          advance.distance = yielding.distance;
          advance.speed = 0;
        }
        car.acceleration = acceleration;
        car.speed = advance.speed;
        const travelled = car.s + advance.distance;
        car.s = Math.min(end, travelled);
        if (
          !permitted &&
          car.s > end - VEHICLE_LENGTH / 2 - 0.15 - signalStopOffset
        ) {
          car.s = Math.max(
            original.s,
            end - VEHICLE_LENGTH / 2 - 0.15 - signalStopOffset,
          );
          car.speed = 0;
        }
        if (
          permitted &&
          signalStopOffset &&
          car.s >= end - SIGNAL_STOP_OFFSET - VEHICLE_LENGTH / 2
        )
          car.signalEntry = connector!.junction;
        if (car.laneChange) {
          const change = car.laneChange,
            progress = (car.s - change.start) / change.length;
          car.lane = change.from + (change.to - change.from) * smooth(progress);
          if (progress >= 1) {
            car.lane = change.to;
            car.laneChange = undefined;
            car.lastLaneChangeAt = this.elapsed;
            car.nextLaneDecision = this.elapsed + 2.5;
          }
        }
        if (car.s >= end - 0.00001 && Math.abs(car.lane - target) < 0.12) {
          if (!next) {
            finished.add(car.id);
            this.completed++;
            this.totalTime += car.age;
            index.remove(car);
            this.mergeController.leave(car.id);
            continue;
          }
          const c = connector || this.connector(step, next);
          if (
            (c.movement &&
              (!permissions.has(car.id) ||
                (this.controlsMerge(c.movement) &&
                  !this.mergeController.canEnter(car.id, c.movement)))) ||
            (nextTraffic && nextTraffic.s - nextEntry < VEHICLE_LENGTH + 2)
          ) {
            car.s = Math.min(car.s, end - 0.05);
            car.speed = 0;
            this.pose(car);
          } else {
            car.step++;
            car.s = this.entry(next);
            car.lane = next.inLane;
            car.laneChange = undefined;
            car.preferredLane = undefined;
            car.connector = c;
            this.advanceConnector(car, c, Math.max(0, travelled - end));
            acquired = c.movement;
          }
        } else this.pose(car);
      }
      if (index.blocked(car)) {
        const age = car.age;
        Object.assign(car, original);
        car.age = age;
        car.speed = 0;
        this.statistics.safetyStops++;
      } else {
        index.update(car);
        if (dist(car.position, original.position) > 0.002)
          car.lastMovementAt = this.elapsed;
        if (acquired) {
          if (this.controlsMerge(acquired))
            this.mergeController.enter(car.id, acquired);
          this.statistics.junctionEntries++;
          this.statistics.simultaneousJunctions = Math.max(
            this.statistics.simultaneousJunctions,
            this.vehicles.filter(
              (other) => other.connector?.junction === acquired.junction,
            ).length,
          );
        }
      }
      if (
        !car.connector &&
        !car.laneChange &&
        car.speed < 0.5 &&
        !car.waitingAtSignal
      ) {
        car.stalledFor = (car.stalledFor ?? 0) + dt;
        if (car.stalledFor >= 8) {
          car.stalledFor = 0;
          this.reroute(car);
        }
      } else car.stalledFor = 0;
      if (
        !car.connector &&
        !car.laneChange &&
        this.elapsed - (car.lastRerouteAt ?? 0) > 10 &&
        !car.waitingAtSignal &&
        (car.speed <
          ((this.roads.get(car.route[car.step].road)?.speed ?? 50) / 3.6) *
            0.6 ||
          car.route
            .slice(car.step)
            .some(
              (st) =>
                (this.trafficDelays.get(
                  laneKey(st.road, st.direction, st.inLane),
                ) ?? 0) > 5,
            )) &&
        (Math.floor(this.elapsed * 2) + car.id) % 17 === 0
      )
        this.reroute(car);
    }
    this.vehicles = this.vehicles.filter((c) => !finished.has(c.id));
  }
  get queued() {
    return this.vehicles.filter((c) => c.speed < 1).length;
  }
  get entered() {
    return this.id;
  }
  get waiting() {
    return [...this.demand].reduce(
      (sum, [s, d]) =>
        sum +
        (s.rate * (this.project?.trafficMultiplier ?? 1) > 0 ? d.waiting : 0),
      0,
    );
  }
  get average() {
    return this.completed ? this.totalTime / this.completed : 0;
  }
  get routeCount() {
    return this.routes.length;
  }
}
