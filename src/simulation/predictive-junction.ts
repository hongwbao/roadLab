import { lerp } from "../core/math";
import type { V } from "../core/types";
import {
  advanceVehicle,
  followingAcceleration,
  type DriverProfile,
  type Leader,
} from "./driving";

export type PathPose = { s: number; position: V; heading: number };
export type PredictionPath = {
  id: string;
  junction: string;
  from: string;
  to: string;
  length: number;
  points: PathPose[];
};
export type PredictionAgent = {
  id: number;
  path: PredictionPath;
  s: number;
  speed: number;
  driver: DriverProfile;
  freeSpeed: number;
  turnSpeed: number;
  exitSpeed: number;
  canExit: boolean;
  stopS?: number;
  leader?: Leader;
  leaderId?: number;
};
export type YieldDirective = {
  path: string;
  winner: number;
  stopS: number;
  follow: boolean;
  leaderS: number;
  leaderSpeed: number;
  releaseAt: number;
};
type Forecast = {
  agent: PredictionAgent;
  poses: (PathPose & { speed: number })[];
};
type ForecastControl = {
  winner: Forecast;
  stopS: number;
  exitS: number;
  follow: boolean;
  releaseTick: number;
};
type Contact = { a: string; points: [number, number][] };
type Commitment = {
  winner: number;
  loser: number;
  winnerPath: string;
  loserPath: string;
  exitS: number;
};
const SAMPLE_TIME = 0.2;
const HORIZON = 5;
const MARGIN = 0.25;

export function samplePredictionPath(
  path: PredictionPath,
  s: number,
): PathPose {
  const points = path.points;
  let lo = 0,
    hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo],
    b = points[hi];
  const t = Math.max(0, Math.min(1, (s - a.s) / Math.max(1e-6, b.s - a.s)));
  const turn = Math.atan2(
    Math.sin(b.heading - a.heading),
    Math.cos(b.heading - a.heading),
  );
  return {
    s,
    position: lerp(a.position, b.position, t),
    heading: a.heading + turn * t,
  };
}

function overlap(a: PathPose, b: PathPose, sweepA = 0, sweepB = 0) {
  if (Math.abs(a.position.y - b.position.y) > 1.8) return false;
  const dx = b.position.x - a.position.x,
    dz = b.position.z - a.position.z;
  if (dx * dx + dz * dz > (6 + sweepA + sweepB) ** 2) return false;
  const ac = Math.cos(a.heading),
    as = Math.sin(a.heading),
    bc = Math.cos(b.heading),
    bs = Math.sin(b.heading);
  const al = 1.9 + MARGIN + sweepA,
    bl = 1.9 + MARGIN + sweepB,
    width = 0.825 + MARGIN;
  for (const [x, z] of [
    [ac, as],
    [-as, ac],
    [bc, bs],
    [-bs, bc],
  ]) {
    const distance = Math.abs(dx * x + dz * z);
    const ra =
      al * Math.abs(ac * x + as * z) + width * Math.abs(-as * x + ac * z);
    const rb =
      bl * Math.abs(bc * x + bs * z) + width * Math.abs(-bs * x + bc * z);
    if (distance >= ra + rb) return false;
  }
  return true;
}

function cells(pose: PathPose, sweep = 0) {
  const c = Math.abs(Math.cos(pose.heading)),
    s = Math.abs(Math.sin(pose.heading));
  const l = 1.9 + MARGIN + sweep,
    w = 0.825 + MARGIN;
  const x = c * l + s * w,
    z = s * l + c * w,
    keys: string[] = [];
  for (
    let ix = Math.floor((pose.position.x - x) / 6);
    ix <= Math.floor((pose.position.x + x) / 6);
    ix++
  )
    for (
      let iz = Math.floor((pose.position.z - z) / 6);
      iz <= Math.floor((pose.position.z + z) / 6);
      iz++
    )
      keys.push(`${ix}:${iz}`);
  return keys;
}

/** Local, time-sliced occupancy prediction; commitments order only conflicting cars. */
export class PredictiveJunctionController {
  private contacts = new Map<string, Contact>();
  private commitments = new Map<string, Commitment>();
  private arrived = new Map<number, number>();
  private directives = new Map<number, YieldDirective[]>();
  private preferredUntil = new Map<number, number>();
  readonly statistics = {
    plans: 0,
    conflicts: 0,
    yielding: 0,
    maxCandidates: 0,
  };
  debug: {
    horizon: number;
    step: number;
    trajectories: { id: number; junction: string; poses: PathPose[] }[];
  } = { horizon: HORIZON, step: SAMPLE_TIME, trajectories: [] };
  clear() {
    this.contacts.clear();
    this.commitments.clear();
    this.arrived.clear();
    this.directives.clear();
    this.preferredUntil.clear();
    this.statistics.plans = 0;
    this.statistics.conflicts = 0;
    this.statistics.yielding = 0;
    this.statistics.maxCandidates = 0;
    this.debug = { horizon: HORIZON, step: SAMPLE_TIME, trajectories: [] };
  }
  private forecast(
    agent: PredictionAgent,
    controls: ForecastControl[] = [],
    leading?: Forecast,
  ): Forecast {
    let s = agent.s,
      speed = agent.speed;
    const poses: Forecast["poses"] = [];
    for (let i = 0; i <= HORIZON / SAMPLE_TIME; i++) {
      poses.push({ ...samplePredictionPath(agent.path, s), speed });
      let leader = agent.leader
        ? {
            gap:
              agent.leader.gap +
              (leading
                ? leading.poses[i].s - leading.agent.s
                : agent.leader.speed * i * SAMPLE_TIME) -
              (s - agent.s),
            speed: leading?.poses[i].speed ?? agent.leader.speed,
          }
        : undefined;
      if (!agent.canExit && s < 0) {
        const stop = { gap: -s - 1.9, speed: 0 };
        if (!leader || stop.gap < leader.gap) leader = stop;
      }
      if (agent.stopS !== undefined && s < agent.stopS) {
        const stop = { gap: agent.stopS - s - 1.9, speed: 0 };
        if (!leader || stop.gap < leader.gap) leader = stop;
      }
      const desired =
        s < 0
          ? Math.min(
              agent.freeSpeed,
              Math.sqrt(
                agent.turnSpeed ** 2 + 2 * agent.driver.comfortableBrake * -s,
              ),
            )
          : s < agent.path.length
            ? Math.min(agent.freeSpeed, agent.turnSpeed)
            : agent.exitSpeed;
      let accelerationCap = Infinity,
        distanceCap = Infinity;
      for (const control of controls) {
        const winner = control.winner.poses[i];
        if (winner.s > control.exitS) continue;
        if (control.follow) {
          const follow = { gap: winner.s - s - 3.8, speed: winner.speed };
          if (!leader || follow.gap < leader.gap) leader = follow;
          continue;
        }
        const distance = Math.max(0, control.stopS - s);
        const time = Math.max(
          0.1,
          (control.releaseTick - i) * SAMPLE_TIME + 0.35,
        );
        distanceCap = Math.min(distanceCap, distance);
        const required = (2 * (distance - speed * time)) / (time * time);
        if (required < 0) accelerationCap = Math.min(accelerationCap, required);
        if (
          time < 0.4 ||
          distance < Math.max(1, (speed * speed) / 16 + speed * 0.1)
        ) {
          const stop = { gap: distance + agent.driver.minimumGap, speed: 0 };
          if (!leader || stop.gap < leader.gap) leader = stop;
        }
      }
      const advance = advanceVehicle(
        speed,
        Math.max(
          -agent.driver.emergencyBrake,
          Math.min(
            accelerationCap,
            followingAcceleration(speed, desired, agent.driver, leader),
          ),
        ),
        SAMPLE_TIME,
      );
      if (advance.distance > distanceCap) {
        advance.distance = distanceCap;
        advance.speed = 0;
      }
      speed = advance.speed;
      s += advance.distance;
    }
    return { agent, poses };
  }
  private contact(a: PredictionPath, b: PredictionPath) {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let value = this.contacts.get(key);
    if (value) return value;
    const grid = new Map<string, number[]>();
    b.points.forEach((point, i) => {
      for (const key of cells(point, 0.25)) {
        const list = grid.get(key) ?? [];
        list.push(i);
        grid.set(key, list);
      }
    });
    const points: [number, number][] = [];
    for (const ap of a.points) {
      const checked = new Set<number>();
      for (const key of cells(ap, 0.25))
        for (const i of grid.get(key) ?? []) {
          if (checked.has(i)) continue;
          checked.add(i);
          if (overlap(ap, b.points[i], 0.25, 0.25))
            points.push([ap.s, b.points[i].s]);
        }
    }
    value = { a: a.id, points };
    this.contacts.set(key, value);
    return value;
  }
  private limits(loser: PredictionAgent, winner: PredictionAgent) {
    const contact = this.contact(loser.path, winner.path);
    const li = contact.a === loser.path.id ? 0 : 1,
      wi = 1 - li;
    let entry = Infinity,
      exit = -Infinity;
    for (const pair of contact.points) {
      exit = Math.max(exit, pair[wi]);
      if (pair[wi] >= winner.s - 0.5) entry = Math.min(entry, pair[li]);
    }
    return { stopS: entry - 0.5, exitS: exit + 0.5 };
  }
  plan(
    agents: PredictionAgent[],
    now: number,
  ): ReadonlyMap<number, YieldDirective> {
    this.statistics.plans++;
    this.statistics.maxCandidates = Math.max(
      this.statistics.maxCandidates,
      agents.length,
    );
    const cars = new Map(agents.map((a) => [a.id, a]));
    for (const id of this.arrived.keys())
      if (!cars.has(id)) this.arrived.delete(id);
    for (const a of agents)
      if (!this.arrived.has(a.id)) this.arrived.set(a.id, now);
    for (const [key, c] of this.commitments) {
      const winner = cars.get(c.winner),
        loser = cars.get(c.loser);
      if (
        !winner ||
        !loser ||
        winner.path.id !== c.winnerPath ||
        loser.path.id !== c.loserPath ||
        winner.s > c.exitS ||
        (!winner.canExit && winner.s < 0) ||
        (winner.stopS !== undefined && winner.s < 0)
      )
        this.commitments.delete(key);
    }
    // Current bodies are hard constraints: a newly arriving winner cannot
    // assume a lower-priority car already in its way can disappear.
    const edges = new Map<number, Set<number>>(
      agents.map((a) => [a.id, new Set()]),
    );
    const add = (before: number, after: number) =>
      edges.get(before)!.add(after);
    for (let i = 0; i < agents.length; i++)
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i],
          b = agents[j];
        if (a.path.junction !== b.path.junction) continue;
        if (a.path.from === b.path.from) {
          if (a.s > b.s + 0.1) add(a.id, b.id);
          else if (b.s > a.s + 0.1) add(b.id, a.id);
          continue;
        }
        const contact = this.contact(a.path, b.path),
          ai = contact.a === a.path.id ? 0 : 1,
          bi = 1 - ai;
        let aBlocks = false,
          bBlocks = false;
        for (const pair of contact.points) {
          if (Math.abs(pair[ai] - a.s) < 0.4 && pair[bi] >= b.s - 0.2)
            aBlocks = true;
          if (Math.abs(pair[bi] - b.s) < 0.4 && pair[ai] >= a.s - 0.2)
            bBlocks = true;
          if (aBlocks && bBlocks) break;
        }
        if (aBlocks) add(a.id, b.id);
        if (bBlocks) add(b.id, a.id);
      }
    const reaches = (from: number, target: number) => {
      const pending = [from],
        seen = new Set<number>();
      while (pending.length) {
        const id = pending.pop()!;
        if (id === target) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        pending.push(...(edges.get(id) ?? []));
      }
      return false;
    };
    // Keep prior decisions unless an actual occupied corridor now requires
    // the reverse order. This prevents an old reservation from creating a
    // three-car circular wait around an already stopped vehicle.
    for (const [key, c] of this.commitments) {
      if (reaches(c.loser, c.winner)) this.commitments.delete(key);
      else add(c.winner, c.loser);
    }
    const pending = new Set(agents.map((a) => a.id)),
      order: number[] = [];
    while (pending.size) {
      let ready = agents.filter(
        (a) =>
          pending.has(a.id) &&
          ![...pending].some((id) => id !== a.id && edges.get(id)!.has(a.id)),
      );
      // A physical cycle may already exist in an imported/live state. The
      // motion guard still holds; bounded retreat handles such cases.
      if (!ready.length) ready = agents.filter((a) => pending.has(a.id));
      ready.sort(
        (a, b) =>
          Number((this.preferredUntil.get(b.id) ?? 0) > now) -
            Number((this.preferredUntil.get(a.id) ?? 0) > now) ||
          this.arrived.get(a.id)! - this.arrived.get(b.id)! ||
          a.id - b.id,
      );
      pending.delete(ready[0].id);
      order.push(ready[0].id);
    }
    const forecasts = new Map<number, Forecast>();
    const occupancy = Array.from(
      { length: HORIZON / SAMPLE_TIME + 1 },
      () => new Map<string, number[]>(),
    );
    const controlsFor = (loser: PredictionAgent): ForecastControl[] => {
      const result: ForecastControl[] = [];
      for (const c of this.commitments.values()) {
        if (c.loser !== loser.id) continue;
        const forecast = forecasts.get(c.winner);
        if (!forecast) continue;
        const limits = this.limits(loser, forecast.agent);
        const release = forecast.poses.findIndex((p) => p.s >= limits.exitS);
        result.push({
          winner: forecast,
          stopS: limits.stopS,
          exitS: limits.exitS,
          follow: loser.path.from === forecast.agent.path.from,
          releaseTick: release < 0 ? HORIZON / SAMPLE_TIME : release,
        });
      }
      return result;
    };
    const collisions = (forecast: Forecast) => {
      const hits = new Set<number>();
      for (let tick = 0; tick < forecast.poses.length; tick++) {
        const pose = forecast.poses[tick];
        if (pose.s > forecast.agent.path.points.at(-1)!.s + 3) continue;
        const sweep = pose.speed * SAMPLE_TIME * 0.5,
          checked = new Set<number>();
        for (const cell of cells(pose, sweep))
          for (const id of occupancy[tick].get(
            `${forecast.agent.path.junction}:${cell}`,
          ) ?? []) {
            if (checked.has(id) || hits.has(id)) continue;
            checked.add(id);
            const other = forecasts.get(id)!;
            if (other.agent.path.id === forecast.agent.path.id) continue;
            const op = other.poses[tick];
            if (overlap(pose, op, sweep, op.speed * SAMPLE_TIME * 0.5))
              hits.add(id);
          }
      }
      return hits;
    };
    // Each lower-priority vehicle sees the higher-priority vehicles' planned
    // motion, including their braking. Assuming everyone freely accelerates
    // would miss a third car stopped by a different conflict.
    for (const id of order) {
      const agent = cars.get(id)!;
      const leading =
        agent.leaderId === undefined
          ? undefined
          : forecasts.get(agent.leaderId);
      let forecast = this.forecast(agent, controlsFor(agent), leading);
      for (let attempt = 0; attempt < agents.length; attempt++) {
        let added = false;
        for (const winnerId of collisions(forecast)) {
          const key = id < winnerId ? `${id}:${winnerId}` : `${winnerId}:${id}`;
          if (this.commitments.has(key)) continue;
          const winner = cars.get(winnerId)!;
          const limits = this.limits(agent, winner);
          if (!Number.isFinite(limits.stopS)) continue;
          this.commitments.set(key, {
            winner: winnerId,
            loser: id,
            winnerPath: winner.path.id,
            loserPath: agent.path.id,
            exitS: limits.exitS,
          });
          this.statistics.conflicts++;
          added = true;
        }
        if (!added) break;
        forecast = this.forecast(agent, controlsFor(agent), leading);
      }
      forecasts.set(id, forecast);
      for (let tick = 0; tick < forecast.poses.length; tick++) {
        const pose = forecast.poses[tick];
        if (pose.s > agent.path.points.at(-1)!.s + 3) continue;
        for (const cell of cells(pose, pose.speed * SAMPLE_TIME * 0.5)) {
          const key = `${agent.path.junction}:${cell}`,
            list = occupancy[tick].get(key) ?? [];
          list.push(id);
          occupancy[tick].set(key, list);
        }
      }
    }
    this.debug = {
      horizon: HORIZON,
      step: SAMPLE_TIME,
      trajectories: [...forecasts.values()].map((f) => ({
        id: f.agent.id,
        junction: f.agent.path.junction,
        poses: f.poses,
      })),
    };
    const directives = new Map<number, YieldDirective>();
    this.directives.clear();
    for (const c of this.commitments.values()) {
      const winner = cars.get(c.winner)!,
        loser = cars.get(c.loser)!;
      const limits = this.limits(loser, winner),
        forecast = forecasts.get(winner.id)!;
      const release = forecast.poses.findIndex((p) => p.s >= limits.exitS);
      const directive: YieldDirective = {
        path: loser.path.id,
        winner: winner.id,
        stopS: limits.stopS,
        follow: loser.path.from === winner.path.from,
        leaderS: winner.s,
        leaderSpeed: winner.speed,
        releaseAt: now + (release < 0 ? HORIZON : release * SAMPLE_TIME) + 0.35,
      };
      const previous = directives.get(loser.id);
      const all = this.directives.get(loser.id) ?? [];
      all.push(directive);
      this.directives.set(loser.id, all);
      if (!previous || directive.stopS < previous.stopS)
        directives.set(loser.id, directive);
    }
    this.statistics.yielding = directives.size;
    return directives;
  }
  constraintsFor(id: number): readonly YieldDirective[] {
    return this.directives.get(id) ?? [];
  }
  forget(ids: ReadonlySet<number>) {
    for (const [key, c] of this.commitments)
      if (ids.has(c.winner) || ids.has(c.loser)) this.commitments.delete(key);
    for (const id of ids) this.directives.delete(id);
  }
  prefer(id: number, until: number) {
    this.preferredUntil.set(id, until);
  }
}
