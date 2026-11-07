import {
  add,
  arcParameter,
  arcTable,
  backwardLaneCount,
  boundaryPoint,
  center,
  medianWidth,
  mul,
  normal,
  pavementWidth,
  tangent,
} from "./math";
import type { Junction, Arm } from "./junctions";
import type { Road, V } from "./types";

/** Both edge intersections and contained corners count; axes are measured in metres. */
export function convexPolygonsOverlap(
  a: readonly V[],
  b: readonly V[],
  clearance = 0,
) {
  if (a.length < 3 || b.length < 3) return false;
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length],
        length = Math.hypot(q.x - p.x, q.z - p.z);
      if (length < 1e-9) continue;
      const nx = -(q.z - p.z) / length,
        nz = (q.x - p.x) / length;
      const project = (rows: readonly V[]) =>
          rows.map((v) => v.x * nx + v.z * nz),
        ap = project(a),
        bp = project(b);
      if (
        Math.max(...ap) < Math.min(...bp) - clearance ||
        Math.max(...bp) < Math.min(...ap) - clearance
      )
        return false;
    }
  return true;
}
export function crosswalkEnvelope(road: Road, t: number) {
  const c = center(road, t),
    d = tangent(road, t),
    n = normal(road, t),
    half = pavementWidth(road, t) / 2 - 0.2;
  const corners = [-1, 1].flatMap((side) =>
    [-1, 1].map((along) =>
      add(add(c, mul(n, half * side)), mul(d, along * 1.5)),
    ),
  );
  return [corners[0], corners[1], corners[3], corners[2]];
}
export function roadCrosswalkQuads(road: Road, t: number) {
  const c = center(road, t),
    d = tangent(road, t),
    n = normal(road, t),
    half = pavementWidth(road, t) / 2 - 0.2;
  const divider = boundaryPoint(road, backwardLaneCount(road), t),
    medianOffset = (divider.x - c.x) * n.x + (divider.z - c.z) * n.z,
    m = medianWidth(road);
  const quads: V[][] = [];
  for (let x = -half + 0.35; x < half - 0.2; x += 1) {
    if (m && x + 0.24 > medianOffset - m / 2 && x - 0.24 < medianOffset + m / 2)
      continue;
    const mid = add(c, mul(n, x));
    quads.push([
      add(add(mid, mul(d, -1.5)), mul(n, -0.24)),
      add(add(mid, mul(d, 1.5)), mul(n, -0.24)),
      add(add(mid, mul(d, 1.5)), mul(n, 0.24)),
      add(add(mid, mul(d, -1.5)), mul(n, 0.24)),
    ]);
  }
  return quads;
}
/** Search actual surface clearance, rather than assuming trim+2 clears a skew hull. */
export function placeJunctionCrosswalk(
  road: Road,
  arm: Arm,
  junction: Junction,
) {
  const table = arcTable(road),
    length = table.at(-1)!.s,
    first = arm.trim + 2,
    limit = length * 0.48;
  for (let distance = first; distance <= limit + 1e-8; distance += 0.5) {
    const t = arcParameter(table, arm.end === 0 ? distance : length - distance);
    const envelope = crosswalkEnvelope(road, t);
    if (!convexPolygonsOverlap(envelope, junction.polygon, 0.2))
      return { t, distance };
  }
}
