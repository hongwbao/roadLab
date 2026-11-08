import { bezier, dist, sub } from "../core/math";
import type { V } from "../core/types";
import type { CS2NavigationCurve } from "./cs2-navigation-target";
import { cs2SelectCurveDistanceSquared } from "./cs2-lane-select";

export type SignalBody = {
  id: number;
  position: V;
  heading: number;
  pitch?: number;
  halfLength: number;
  halfWidth: number;
};
export type SignalPath = {
  id: string;
  junction: string;
  curve: CS2NavigationCurve;
  /** Travel tangents, including a fallback for a zero-length connector. */
  entryDirection: V;
  exitDirection: V;
};
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: V) => {
  const length = Math.hypot(a.x, a.y, a.z);
  return length > 1e-8
    ? { x: a.x / length, y: a.y / length, z: a.z / length }
    : { x: 0, y: 0, z: 0 };
};

/** Navigation may already point into the next road while the body is still
 * crossing. A nomination is only a candidate; geometric body entry activates
 * occupancy, and only physical clearance (never a timeout) releases it. */
export class SignalMovementOccupancy {
  private candidates = new Map<
    number,
    Map<string, { path: SignalPath; entered: boolean }>
  >();
  nominate(vehicle: number, path: SignalPath) {
    const paths = this.candidates.get(vehicle) ?? new Map();
    if (!paths.has(path.id)) paths.set(path.id, { path, entered: false });
    this.candidates.set(vehicle, paths);
  }
  remove(vehicle: number) {
    this.candidates.delete(vehicle);
  }
  clear() {
    this.candidates.clear();
  }
  update(bodies: ReadonlyMap<number, SignalBody>) {
    const occupied = new Map<string, Set<string>>();
    for (const [id, paths] of this.candidates) {
      const body = bodies.get(id);
      if (!body) {
        this.candidates.delete(id);
        continue;
      }
      const pitch = body.pitch ?? 0,
        forward = {
          x: Math.cos(body.heading) * Math.cos(pitch),
          y: Math.sin(pitch),
          z: Math.sin(body.heading) * Math.cos(pitch),
        },
        right = { x: -Math.sin(body.heading), y: 0, z: Math.cos(body.heading) },
        extent = (direction: V) =>
          Math.abs(dot(forward, direction)) * body.halfLength +
          Math.abs(dot(right, direction)) * body.halfWidth;
      for (const [movement, visit] of paths) {
        const { path } = visit,
          nearest = cs2SelectCurveDistanceSquared(path.curve, body.position),
          point = bezier(...path.curve.points, nearest.t),
          entry = unit(path.entryDirection),
          exit = unit(path.exitDirection),
          front =
            dot(sub(body.position, path.curve.points[0]), entry) +
            extent(entry),
          tail =
            dot(sub(body.position, path.curve.points[3]), exit) - extent(exit),
          atExit = path.curve.length < 0.1 || nearest.t >= 0.98,
          cleared = atExit && tail > 0.15;
        if (cleared) {
          paths.delete(movement);
          continue;
        }
        if (
          !visit.entered &&
          dist(body.position, point) <=
            Math.hypot(body.halfLength, body.halfWidth) + 0.35 &&
          (nearest.t > 1e-4 || front >= 0)
        )
          visit.entered = true;
        if (visit.entered) {
          const movements = occupied.get(path.junction) ?? new Set<string>();
          movements.add(path.id);
          occupied.set(path.junction, movements);
        }
      }
      if (!paths.size) this.candidates.delete(id);
    }
    return occupied;
  }
}
