import { buildJunctions, type Junction } from "../core/junctions";
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
  tangent,
} from "../core/math";
import { connections, normalizePorts } from "../core/model";
import {
  isSink,
  isSource,
  type Connection,
  type Port,
  type Project,
  type Road,
  type V,
} from "../core/types";
import { TrafficIndex } from "./collision";
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
  speed: number;
  age: number;
  color: number;
  position: V;
  heading: number;
  pitch: number;
  connector?: {
    from: V;
    c1: V;
    c2: V;
    to: V;
    progress: number;
    length: number;
    arc: { t: number; s: number }[];
    junction?: string;
  };
};
const key = (road: string, dir: number) => road + ":" + dir;
export function findRoute(
  p: Project,
  source: Port,
  sink: Port,
  cs = connections(p),
  preferredLane?: number,
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
  const goal = key(sink.road, endDir),
    start = key(source.road, startDir),
    queue = [start],
    visited = new Set([start]),
    parent = new Map<string, { prev: string; c: Connection }>();
  while (queue.length) {
    const at = queue.shift()!;
    if (at === goal) break;
    for (const c of cs) {
      if (!c.enabled) continue;
      const a = roads.get(c.from.road),
        b = roads.get(c.to.road);
      if (!a || !b || key(a.id, laneDirection(a, c.from.lane)) !== at) continue;
      const dest = key(b.id, laneDirection(b, c.to.lane));
      if (visited.has(dest)) continue;
      visited.add(dest);
      parent.set(dest, { prev: at, c });
      queue.push(dest);
    }
  }
  if (!visited.has(goal)) return;
  const chain: Connection[] = [];
  let at = goal;
  while (at !== start) {
    const n = parent.get(at);
    if (!n) return;
    chain.unshift(n.c);
    at = n.prev;
  }
  const steps: Step[] = [];
  let road = sourceRoad,
    dir = startDir as 1 | -1;
  let inLane =
    Array.from({ length: laneCount(road) }, (_, i) => i).find(
      (i) =>
        laneDirection(road, i) === dir &&
        laneWidth(road, i, dir === 1 ? 0 : 1) > road.width * 0.75,
    ) ?? 0;
  for (const c of chain) {
    steps.push({ road: road.id, direction: dir, inLane, outLane: c.from.lane });
    road = roads.get(c.to.road)!;
    dir = laneDirection(road, c.to.lane);
    inLane = c.to.lane;
  }
  const exits = Array.from({ length: laneCount(road) }, (_, i) => i).filter(
    (i) =>
      laneDirection(road, i) === dir &&
      laneWidth(road, i, dir === 1 ? 1 : 0) > road.width * 0.8,
  );
  steps.push({
    road: road.id,
    direction: dir,
    inLane,
    outLane: exits.reduce(
      (a, b) => (Math.abs(b - inLane) < Math.abs(a - inLane) ? b : a),
      exits[0] ?? inLane,
    ),
  });
  // Choose lane links over the whole route, minimizing changes, rather than
  // always funnelling traffic into lane zero at each road segment.
  const initial = steps[0],
    initialRoad = roads.get(initial.road)!;
  let states = new Map<number, { cost: number; steps: Step[] }>();
  for (let l = 0; l < laneCount(initialRoad); l++)
    if (
      laneDirection(initialRoad, l) === initial.direction &&
      laneWidth(initialRoad, l, initial.direction === 1 ? 0 : 1) >
        initialRoad.width * 0.8
    )
      states.set(l, {
        cost:
          preferredLane === undefined ? 0 : Math.abs(l - preferredLane) * 10,
        steps: [],
      });
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i],
      b = steps[i + 1],
      next = new Map<number, { cost: number; steps: Step[] }>();
    for (const c of cs) {
      if (
        !c.enabled ||
        c.from.road !== a.road ||
        c.to.road !== b.road ||
        laneDirection(roads.get(a.road)!, c.from.lane) !== a.direction ||
        laneDirection(roads.get(b.road)!, c.to.lane) !== b.direction
      )
        continue;
      for (const [entry, state] of states) {
        const cost = state.cost + Math.abs(entry - c.from.lane);
        if (!next.has(c.to.lane) || next.get(c.to.lane)!.cost > cost)
          next.set(c.to.lane, {
            cost,
            steps: [
              ...state.steps,
              { ...a, inLane: entry, outLane: c.from.lane },
            ],
          });
      }
    }
    states = next;
  }
  const final = steps.at(-1)!;
  let best: { cost: number; steps: Step[] } | undefined;
  for (const [entry, state] of states)
    for (const exit of exits) {
      const cost = state.cost + Math.abs(entry - exit);
      if (!best || cost < best.cost)
        best = {
          cost,
          steps: [...state.steps, { ...final, inLane: entry, outLane: exit }],
        };
    }
  return best?.steps || steps;
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
  private reservations = new Map<string, number>();
  configure(p: Project) {
    this.reset();
    normalizePorts(p);
    this.project = p;
    this.roads = new Map(p.roads.map((r) => [r.id, r]));
    this.arcs = new Map(p.roads.map((r) => [r.id, arcTable(r)]));
    this.lengths = new Map(
      p.roads.map((r) => [r.id, this.arcs.get(r.id)!.at(-1)!.s]),
    );
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
    this.routes = [];
    for (const source of p.ports.filter(isSource))
      for (const sink of p.ports.filter(isSink)) {
        if (source.road === sink.road && source.end === sink.end) continue;
        const route = findRoute(p, source, sink, this.cs);
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
    this.reservations.clear();
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
      t = arcParameter(
        this.arcs.get(r.id)!,
        step.direction === 1 ? car.s : len - car.s,
      ),
      lo = Math.floor(car.lane),
      hi = Math.ceil(car.lane),
      blend = car.lane - lo;
    const pos = (t: number) =>
        lerp(lanePoint(r, lo, t), lanePoint(r, hi, t), blend),
      a = pos(clamp(t - step.direction * 0.001)),
      b = pos(clamp(t + step.direction * 0.001));
    car.position = pos(t);
    car.heading = Math.atan2(b.z - a.z, b.x - a.x);
    car.pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
  }
  private spawn(index: TrafficIndex<Vehicle>) {
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
        );
        if (!route) continue;
        const step = route[0],
          car: Vehicle = {
            id: this.id + 1,
            route,
            step: 0,
            s: this.entry(step),
            lane: step.inLane,
            speed: 0,
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
  private connector(step: Step, next: Step) {
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
    return { from, to, c1, c2, arc, length: s, progress: 0, junction };
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
    const index = new TrafficIndex<Vehicle>();
    this.vehicles.forEach((c) => index.add(c));
    this.timer += dt;
    while (this.timer >= 0.2 - 1e-9) {
      this.timer = Math.max(0, this.timer - 0.2);
      this.spawn(index);
    }
    const finished = new Set<number>();
    for (const car of this.vehicles) {
      const original = {
        ...car,
        connector: car.connector ? { ...car.connector } : undefined,
      };
      car.age += dt;
      const step = car.route[car.step],
        r = this.roads.get(step.road);
      if (!r) {
        finished.add(car.id);
        index.remove(car);
        continue;
      }
      let acquired: string | undefined, released: string | undefined;
      if (car.connector) {
        const c = car.connector;
        c.progress = Math.min(
          1,
          c.progress +
            (dt * Math.min(8, Math.max(4, car.speed))) /
              Math.max(0.01, c.length),
        );
        const t = arcParameter(c.arc, c.progress * c.length),
          pos = bezier(c.from, c.c1, c.c2, c.to, t),
          a = bezier(c.from, c.c1, c.c2, c.to, clamp(t - 0.001)),
          b = bezier(c.from, c.c1, c.c2, c.to, clamp(t + 0.001));
        car.position = pos;
        car.heading = Math.atan2(b.z - a.z, b.x - a.x);
        car.pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
        if (c.progress >= 1) {
          released = c.junction;
          car.connector = undefined;
        }
      } else {
        const len = this.lengths.get(r.id)!,
          end = this.exit(step),
          t = arcParameter(
            this.arcs.get(r.id)!,
            step.direction === 1 ? car.s : len - car.s,
          ),
          target = step.outLane;
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
        const blockedChange = this.vehicles.some(
          (o) =>
            o.id !== car.id &&
            o.route[o.step].road === r.id &&
            o.route[o.step].direction === step.direction &&
            Math.abs(o.lane - desired) < 0.8 &&
            Math.abs(o.s - car.s) < 8,
        );
        if (!blockedChange)
          car.lane +=
            Math.sign(desired - car.lane) *
            Math.min(Math.abs(desired - car.lane), dt * 0.65);
        let limit = r.speed / 3.6;
        for (const other of this.vehicles) {
          if (other.id === car.id || finished.has(other.id)) continue;
          const os = other.route[other.step];
          if (
            os.road === r.id &&
            os.direction === step.direction &&
            Math.abs(other.lane - car.lane) < 0.85 &&
            other.s > car.s
          )
            limit = Math.min(limit, Math.max(0, (other.s - car.s - 4.8) / 1.4));
        }
        if (end - car.s < 14 && Math.abs(car.lane - target) > 0.08)
          limit = Math.min(limit, Math.max(0, (end - car.s - 0.4) / 2));
        const next = car.route[car.step + 1],
          connector =
            next && end - car.s < 18 ? this.connector(step, next) : undefined;
        if (next && connector) {
          const owner =
            connector.junction && this.reservations.get(connector.junction);
          if (owner && owner !== car.id)
            limit = Math.min(limit, Math.max(0, (end - car.s - 0.4) / 1.3));
          for (const o of this.vehicles)
            if (
              o.id !== car.id &&
              o.route[o.step].road === next.road &&
              Math.abs(o.lane - next.inLane) < 0.8 &&
              o.s < this.entry(next) + 7
            )
              limit = Math.min(limit, Math.max(0, (end - car.s - 0.4) / 1.4));
        }
        car.speed += clamp(limit - car.speed, -6 * dt, 2.4 * dt);
        car.s = Math.min(end, car.s + Math.max(0, car.speed) * dt);
        if (car.s >= end - 0.00001 && Math.abs(car.lane - target) < 0.12) {
          if (!next) {
            finished.add(car.id);
            this.completed++;
            this.totalTime += car.age;
            index.remove(car);
            continue;
          }
          const c = connector || this.connector(step, next);
          const owner = c.junction && this.reservations.get(c.junction);
          if (owner && owner !== car.id) {
            car.s = Math.min(car.s, end - 0.05);
            car.speed = 0;
            this.pose(car);
          } else {
            car.step++;
            car.s = this.entry(next);
            car.lane = next.inLane;
            if (c.length > 0.15) {
              car.connector = c;
              car.position = c.from;
              acquired = c.junction;
            } else this.pose(car);
          }
        } else this.pose(car);
      }
      if (index.blocked(car)) {
        const age = car.age;
        Object.assign(car, original);
        car.age = age;
        car.speed = 0;
      } else {
        index.update(car);
        if (acquired) this.reservations.set(acquired, car.id);
        if (released && this.reservations.get(released) === car.id)
          this.reservations.delete(released);
      }
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
