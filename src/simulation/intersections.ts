import type { V } from "../core/types";
export type Movement = {
  id: string;
  junction: string;
  from: string;
  to: string;
  points: V[];
  priority: number;
  merge?: boolean;
  turn: "straight" | "left" | "right";
};
export type JunctionRequest = {
  id: number;
  movement: Movement;
  eta: number;
  space: boolean;
  queued?: boolean;
};
function segmentDistance(a: V, b: V, c: V, d: V): number {
  const ux = b.x - a.x,
    uz = b.z - a.z,
    vx = d.x - c.x,
    vz = d.z - c.z;
  const det = ux * vz - uz * vx;
  if (Math.abs(det) > 1e-8) {
    const dx = c.x - a.x,
      dz = c.z - a.z,
      s = (dx * vz - dz * vx) / det,
      t = (dx * uz - dz * ux) / det;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return 0;
  }
  const pointDistance = (p: V, q: V, r: V) => {
    const dx = r.x - q.x,
      dz = r.z - q.z,
      t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - q.x) * dx + (p.z - q.z) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
    return Math.hypot(p.x - q.x - t * dx, p.z - q.z - t * dz);
  };
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
export function movementsConflict(a: Movement, b: Movement) {
  if (a.junction !== b.junction) return false;
  if (a.from === b.from || a.to === b.to) return true;
  for (let i = 1; i < a.points.length; i++)
    for (let j = 1; j < b.points.length; j++) {
      const ap = a.points[i],
        bp = b.points[j];
      if (Math.abs(ap.y - bp.y) > 1.8) continue;
      if (segmentDistance(a.points[i - 1], ap, b.points[j - 1], bp) < 2.5)
        return true;
    }
  return false;
}
/** Per-movement reservations: compatible streams proceed together; queues age fairly. */
export class IntersectionController {
  private active = new Map<number, Movement>();
  private waiting = new Map<number, number>();
  private conflicts = new Map<string, boolean>();
  private lastApproach = new Map<string, string>();
  clear() {
    this.active.clear();
    this.waiting.clear();
    this.conflicts.clear();
    this.lastApproach.clear();
  }
  private conflict(a: Movement, b: Movement) {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    let value = this.conflicts.get(key);
    if (value === undefined) {
      value = movementsConflict(a, b);
      this.conflicts.set(key, value);
    }
    return value;
  }
  plan(requests: JunctionRequest[], now: number) {
    const present = new Set(requests.map((r) => r.id));
    for (const id of this.waiting.keys())
      if (!present.has(id)) this.waiting.delete(id);
    for (const r of requests)
      if (!this.waiting.has(r.id)) this.waiting.set(r.id, now);
    const ready = requests.filter((r) => r.space && r.eta <= 2.5);
    const mergeQueues = new Map<string, Set<string>>();
    for (const r of ready) {
      if (!r.queued || !r.movement.merge) continue;
      const approaches = mergeQueues.get(r.movement.to) ?? new Set<string>();
      approaches.add(r.movement.from);
      mergeQueues.set(r.movement.to, approaches);
    }
    const score = (r: JunctionRequest) => {
      const age = now - this.waiting.get(r.id)!;
      return (
        (age > 8 ? 20 + age : 0) +
        r.movement.priority +
        (r.movement.merge &&
        (mergeQueues.get(r.movement.to)?.size ?? 0) > 1 &&
        this.lastApproach.get(r.movement.to) !== r.movement.from
          ? 10
          : 0) -
        (r.movement.turn === "left" ? 0.6 : 0)
      );
    };
    ready.sort(
      (a, b) =>
        score(b) - score(a) ||
        a.eta - b.eta ||
        this.waiting.get(a.id)! - this.waiting.get(b.id)! ||
        a.id - b.id,
    );
    const permitted = new Set<number>(),
      selected: Movement[] = [];
    for (const request of ready) {
      if (
        [...this.active].some(
          ([id, m]) => id !== request.id && this.conflict(request.movement, m),
        )
      )
        continue;
      if (selected.some((m) => this.conflict(request.movement, m))) continue;
      permitted.add(request.id);
      selected.push(request.movement);
    }
    return permitted;
  }
  canEnter(id: number, movement: Movement) {
    return ![...this.active].some(
      ([other, m]) => other !== id && this.conflict(movement, m),
    );
  }
  enter(id: number, movement: Movement) {
    this.active.set(id, movement);
    if (movement.merge) this.lastApproach.set(movement.to, movement.from);
    this.waiting.delete(id);
  }
  leave(id: number) {
    this.active.delete(id);
  }
  get reservations() {
    return this.active as ReadonlyMap<number, Movement>;
  }
}
