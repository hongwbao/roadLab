import { center, dist, laneCount, nodePoint, tangent, lerp } from "./math";
import { roadSurfaceTriangles } from "./junction-crosswalks";
import type { Road, V } from "./types";

type Piece = ReturnType<typeof roadSurfaceTriangles>[number];
type Plane = (p: V) => number;
export type ForkNeighbours = { pavement: Road[]; edges: Road[] };
/** Physical attachments define forks, independent of the user's turn permissions. */
export function roadForks(roads: readonly Road[]) {
  const result = new Map<string, ForkNeighbours>();
  const entry = (r: Road) => {
    if (!result.has(r.id)) result.set(r.id, { pavement: [], edges: [] });
    return result.get(r.id)!;
  };
  const add = (list: Road[], r: Road) => {
    if (!list.some((v) => v.id === r.id)) list.push(r);
  };
  for (const branch of roads)
    for (const [key, attachment] of Object.entries(branch.attachments ?? {})) {
      if (!attachment) continue;
      const ref = roads.find((r) => r.id === attachment.road);
      if (!ref) continue;
      const end = key === "start" ? 0 : 1,
        anchor = nodePoint(ref, attachment.end),
        direction = tangent(branch, end);
      for (const trunk of roads) {
        if (trunk.id === branch.id || laneCount(trunk) <= laneCount(branch))
          continue;
        const end = ([0, 1] as const).find(
          (at) => dist(nodePoint(trunk, at), anchor) < 0.65,
        );
        if (end === undefined) continue;
        const d = tangent(trunk, end);
        if (
          d.x * direction.x + d.z * direction.z < 0.94 ||
          Math.abs(
            center(trunk, end).y - center(branch, key === "start" ? 0 : 1).y,
          ) > 0.05
        )
          continue;
        add(entry(branch).pavement, trunk);
        add(entry(branch).edges, trunk);
        add(entry(trunk).edges, branch);
      }
    }
  return result;
}
function planes(piece: Piece, heightTolerance: number): Plane[] {
  const p = piece.polygon;
  const area =
    (p[1].x - p[0].x) * (p[2].z - p[0].z) -
    (p[1].z - p[0].z) * (p[2].x - p[0].x);
  const sign = area >= 0 ? 1 : -1;
  const result: Plane[] = p.map((a, i) => {
    const b = p[(i + 1) % 3];
    return (q) =>
      sign * ((b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x));
  });
  const dy = (q: V) => {
    const u =
      ((q.x - p[0].x) * (p[2].z - p[0].z) -
        (q.z - p[0].z) * (p[2].x - p[0].x)) /
      area;
    const v =
      ((p[1].x - p[0].x) * (q.z - p[0].z) -
        (p[1].z - p[0].z) * (q.x - p[0].x)) /
      area;
    return q.y - (p[0].y + u * (p[1].y - p[0].y) + v * (p[2].y - p[0].y));
  };
  result.push(
    (q) => heightTolerance - dy(q),
    (q) => heightTolerance + dy(q),
  );
  return result;
}
const polygonArea = (poly: V[]) =>
  Math.abs(
    poly.reduce((s, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return s + p.x * q.z - q.x * p.z;
    }, 0),
  ) / 2;
function clip(poly: V[], plane: Plane, inside: boolean) {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = plane(a),
      db = plane(b);
    const ia = inside ? da >= 0 : da <= 0,
      ib = inside ? db >= 0 : db <= 0;
    if (ia) out.push(a);
    if (ia !== ib) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}
function overlaps(poly: V[], piece: Piece) {
  return (
    Math.max(...poly.map((p) => p.x)) >= piece.minX &&
    Math.min(...poly.map((p) => p.x)) <= piece.maxX &&
    Math.max(...poly.map((p) => p.z)) >= piece.minZ &&
    Math.min(...poly.map((p) => p.z)) <= piece.maxZ
  );
}
/** Subtract only the shared, coplanar footprint. The through road owns that asphalt. */
export function forkPavement(
  road: Road,
  range: { start: number; end: number },
  obstacles: readonly Piece[],
) {
  const vertices: number[] = [];
  for (const piece of roadSurfaceTriangles(road, range)) {
    let polys = [piece.polygon];
    for (const other of obstacles) {
      const next: V[][] = [];
      for (const poly of polys) {
        if (!overlaps(poly, other)) {
          next.push(poly);
          continue;
        }
        let remaining = poly;
        for (const plane of planes(other, 0.015)) {
          if (remaining.length < 3) break;
          const outside = clip(remaining, plane, false);
          if (outside.length >= 3 && polygonArea(outside) > 1e-8)
            next.push(outside);
          remaining = clip(remaining, plane, true);
        }
      }
      polys = next;
      if (!polys.length) break;
    }
    for (const poly of polys)
      for (let i = 1; i < poly.length - 1; i++)
        for (const p of [poly[0], poly[i], poly[i + 1]])
          vertices.push(p.x, p.y, p.z);
  }
  return vertices;
}
/** Clip interior edge paint/deck sides against the same real pavement triangles. */
export function forkEdgePaths(points: V[], obstacles: readonly Piece[]) {
  const paths: V[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    let intervals: [number, number][] = [[0, 1]];
    for (const piece of obstacles) {
      if (!overlaps([a, b], piece)) continue;
      let lo = 0,
        hi = 1;
      for (const plane of planes(piece, 0.03)) {
        const da = plane(a),
          db = plane(b);
        if (da < 0 && db < 0) {
          lo = 1;
          hi = 0;
          break;
        }
        if (da < 0) lo = Math.max(lo, da / (da - db));
        else if (db < 0) hi = Math.min(hi, da / (da - db));
      }
      if (hi <= lo + 1e-9) continue;
      intervals = intervals.flatMap(([s, e]) =>
        e <= lo || s >= hi
          ? [[s, e] as [number, number]]
          : [
              ...(s < lo ? [[s, lo] as [number, number]] : []),
              ...(e > hi ? [[hi, e] as [number, number]] : []),
            ],
      );
    }
    for (const [s, e] of intervals) {
      const p = lerp(a, b, s),
        q = lerp(a, b, e),
        last = paths.at(-1);
      if (last && dist(last.at(-1)!, p) < 1e-7) last.push(q);
      else paths.push([p, q]);
    }
  }
  return paths;
}
export const forkSurfaces = (roads: readonly Road[]) =>
  roads.flatMap((r) => roadSurfaceTriangles(r, { start: 0, end: 1 }));
