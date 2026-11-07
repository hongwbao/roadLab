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
type SurfacePiece = {
  polygon: V[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
const surfaceCache = new WeakMap<
  Road,
  { signature: string; pieces: SurfacePiece[] }
>();
/** The same70-sample triangle strip used by the rendered road pavement. */
export function roadSurfaceTriangles(
  road: Road,
  range: { start: number; end: number },
): SurfacePiece[] {
  const signature = JSON.stringify([road, range]),
    cached = surfaceCache.get(road);
  if (cached?.signature === signature) return cached.pieces;
  const n = Math.max(60, road.knots.length * 35),
    edges: V[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = range.start + ((range.end - range.start) * i) / n,
      c = center(road, t),
      normalAt = normal(road, t),
      half = pavementWidth(road, t) / 2 + 0.35;
    edges.push([add(c, mul(normalAt, -half)), add(c, mul(normalAt, half))]);
  }
  const pieces: SurfacePiece[] = [];
  for (let i = 0; i < n; i++)
    for (const polygon of [
      [edges[i][0], edges[i + 1][0], edges[i][1]],
      [edges[i][1], edges[i + 1][0], edges[i + 1][1]],
    ])
      pieces.push({
        polygon,
        minX: Math.min(...polygon.map((p) => p.x)),
        maxX: Math.max(...polygon.map((p) => p.x)),
        minZ: Math.min(...polygon.map((p) => p.z)),
        maxZ: Math.max(...polygon.map((p) => p.z)),
      });
  surfaceCache.set(road, { signature, pieces });
  return pieces;
}
/** Search actual surface clearance, rather than assuming trim+2 clears a skew hull. */
export function placeJunctionCrosswalk(
  road: Road,
  arm: Arm,
  junction: Junction,
  obstacles: readonly SurfacePiece[] = [],
) {
  const table = arcTable(road),
    length = table.at(-1)!.s,
    first = arm.trim + 2,
    limit = length * 0.48;
  for (let distance = first; distance <= limit + 1e-8; distance += 0.5) {
    const t = arcParameter(table, arm.end === 0 ? distance : length - distance);
    const envelope = crosswalkEnvelope(road, t);
    if (convexPolygonsOverlap(envelope, junction.polygon, 0.2)) continue;
    const minX = Math.min(...envelope.map((p) => p.x)),
      maxX = Math.max(...envelope.map((p) => p.x)),
      minZ = Math.min(...envelope.map((p) => p.z)),
      maxZ = Math.max(...envelope.map((p) => p.z));
    if (
      obstacles.some(
        (piece) =>
          piece.maxX >= minX - 0.2 &&
          piece.minX <= maxX + 0.2 &&
          piece.maxZ >= minZ - 0.2 &&
          piece.minZ <= maxZ + 0.2 &&
          convexPolygonsOverlap(envelope, piece.polygon, 0.2),
      )
    )
      continue;
    return { t, distance };
  }
}
