import { bodiesOverlap, type Body } from "./collision";
import {
  samplePredictionPath,
  type PredictionPath,
} from "./predictive-junction";

export type WaitingVehicle = {
  id: number;
  path: PredictionPath;
  s: number;
  blockers: number[];
};
export type Retreat = {
  id: number;
  path: PredictionPath;
  fromS: number;
  toS: number;
  clears: number;
  participants: number[];
};

/** Only directed wait cycles qualify; an ordinary queue behind a blocked exit does not. */
export function waitCycles(cars: WaitingVehicle[]): number[][] {
  const byId = new Map(cars.map((c) => [c.id, c]));
  const indices = new Map<number, number>(),
    low = new Map<number, number>(),
    stack: number[] = [],
    active = new Set<number>(),
    cycles: number[][] = [];
  let serial = 0;
  const visit = (id: number) => {
    indices.set(id, serial);
    low.set(id, serial++);
    stack.push(id);
    active.add(id);
    for (const next of byId.get(id)!.blockers) {
      if (!byId.has(next)) continue;
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (active.has(next))
        low.set(id, Math.min(low.get(id)!, indices.get(next)!));
    }
    if (low.get(id) === indices.get(id)) {
      const members: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        active.delete(member);
        members.push(member);
      } while (member !== id);
      if (members.length > 1) cycles.push(members);
    }
  };
  for (const car of cars) if (!indices.has(car.id)) visit(car.id);
  return cycles;
}

/** Finds a short swept, collision-free reverse motion which frees another car. */
export function chooseRetreat(
  cycle: number[],
  cars: WaitingVehicle[],
  bodies: Body[],
): Retreat | undefined {
  const members = cars
    .filter((c) => cycle.includes(c.id))
    .sort((a, b) => b.id - a.id);
  const bodyAt = (car: WaitingVehicle, s: number): Body => ({
    id: car.id,
    ...samplePredictionPath(car.path, s),
  });
  const blocked = (body: Body, ignore: number) =>
    bodies.some(
      (b) =>
        b.id !== body.id && b.id !== ignore && bodiesOverlap(body, b, 0.18),
    );
  for (const car of members) {
    for (let distance = 0.1; distance <= 1.8 + 1e-6; distance += 0.1) {
      if (car.s - distance < car.path.points[0].s) break;
      const shifted = bodyAt(car, car.s - distance);
      if (blocked(shifted, -1)) break;
      for (const other of members) {
        if (other.id === car.id) continue;
        let free = true;
        for (let forward = 0.1; forward <= 0.4 + 1e-6; forward += 0.1) {
          const probe = bodyAt(other, other.s + forward);
          if (blocked(probe, car.id) || bodiesOverlap(probe, shifted, 0.18)) {
            free = false;
            break;
          }
        }
        if (free)
          return {
            id: car.id,
            path: car.path,
            fromS: car.s,
            toS: car.s - distance,
            clears: other.id,
            participants: cycle,
          };
      }
    }
  }
  return undefined;
}
