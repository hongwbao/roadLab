import {
  add,
  arcParameter,
  arcTable,
  center,
  nodePoint,
  logicalRoadSignature,
  dist,
  mul,
  normal,
  tangent,
  pavementWidth,
} from "./math";
import {
  placeJunctionCrosswalk,
  roadSurfaceTriangles,
} from "./junction-crosswalks";
import type { Project, Road, V } from "./types";
export type Arm = {
  road: string;
  end: 0 | 1;
  direction: V;
  halfWidth: number;
  trim: number;
  t: number;
  crosswalkT?: number;
  crosswalkDistance?: number;
};
export type Junction = {
  id: string;
  position: V;
  arms: Arm[];
  radius: number;
  crosswalks: boolean;
  polygon: V[];
};
export function convexHull(points: V[]): V[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: V, b: V, c: V) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const low: V[] = [],
    high: V[] = [];
  for (const p of sorted) {
    while (low.length > 1 && cross(low.at(-2)!, low.at(-1)!, p) <= 0) low.pop();
    low.push(p);
  }
  for (const p of [...sorted].reverse()) {
    while (high.length > 1 && cross(high.at(-2)!, high.at(-1)!, p) <= 0)
      high.pop();
    high.push(p);
  }
  return [...low.slice(0, -1), ...high.slice(0, -1)];
}
const junctionCache = new WeakMap<
  object,
  { signature: string; junctions: Junction[] }
>();
export function buildJunctions(p: Project): Junction[] {
  const signature = logicalRoadSignature(p.roads),
    cached = junctionCache.get(p);
  if (cached?.signature === signature) return structuredClone(cached.junctions);
  const groups: { position: V; ends: { r: Road; end: 0 | 1 }[] }[] = [];
  for (const r of p.roads)
    for (const end of [0, 1] as const) {
      const pos = nodePoint(r, end);
      let g = groups.find((g) => dist(g.position, pos) < 0.65);
      if (!g) {
        g = { position: pos, ends: [] };
        groups.push(g);
      }
      g.ends.push({ r, end });
    }
  const result: Junction[] = [];
  for (const g of groups) {
    if (g.ends.length < 2) continue;
    const dirs = g.ends.map(({ r, end }) =>
      mul(tangent(r, end), end === 0 ? 1 : -1),
    );
    const corner =
      g.ends.length === 2 &&
      dirs[0].x * dirs[1].x + dirs[0].z * dirs[1].z > -0.94;
    if (g.ends.length < 3 && !corner) continue;
    const radius =
      Math.max(
        ...g.ends.flatMap(({ r, end }) => {
          const c = center(r, end),
            n = normal(r, end),
            half = pavementWidth(r, end) / 2;
          return [-1, 1].map((side) =>
            dist(g.position, add(c, mul(n, half * side))),
          );
        }),
      ) + 2.5;
    // Acute approaches need enough length for their whole carriageways to
    // separate, including asymmetric lateral offsets and shoulders.
    const desired = g.ends.map(() => radius + 1);
    for (let i = 0; i < g.ends.length; i++)
      for (let k = 0; k < g.ends.length; k++) {
        if (i === k) continue;
        const a = g.ends[i],
          b = g.ends[k],
          ad = dirs[i],
          bd = dirs[k];
        const al = Math.hypot(ad.x, ad.z),
          bl = Math.hypot(bd.x, bd.z);
        if (al < 1e-6 || bl < 1e-6) continue;
        const ax = ad.x / al,
          az = ad.z / al,
          bx = bd.x / bl,
          bz = bd.z / bl,
          cos = ax * bx + az * bz,
          sin = ax * -bz + az * bx;
        if (cos <= 0 || Math.abs(sin) < 1e-4) continue;
        const ac = center(a.r, a.end),
          bc = center(b.r, b.end),
          offset = (ac.x - bc.x) * -bz + (ac.z - bc.z) * bx;
        const halfA = pavementWidth(a.r, a.end) / 2 + 0.35,
          halfB = pavementWidth(b.r, b.end) / 2 + 0.35;
        desired[i] = Math.max(
          desired[i],
          (halfB + halfA * cos + 0.5 - Math.sign(sin) * offset) / Math.abs(sin),
        );
      }
    const arms: Arm[] = g.ends.map(({ r, end }, i) => {
      const table = arcTable(r),
        length = table.at(-1)!.s,
        trim = Math.min(desired[i], length * 0.38),
        t = arcParameter(table, end === 0 ? trim : length - trim);
      return {
        road: r.id,
        end,
        direction: dirs[i],
        halfWidth: pavementWidth(r, t) / 2 + 0.35,
        trim,
        t,
      };
    });
    const points: V[] = [];
    for (const a of arms) {
      const r = p.roads.find((r) => r.id === a.road)!,
        c = center(r, a.t),
        n = normal(r, a.t);
      points.push(add(c, mul(n, a.halfWidth)), add(c, mul(n, -a.halfWidth)));
    }
    result.push({
      id: `j:${g.position.x.toFixed(2)},${g.position.y.toFixed(2)},${g.position.z.toFixed(2)}`,
      position: g.position,
      arms,
      radius: Math.max(radius, ...arms.map((a) => a.trim - 1)),
      crosswalks:
        arms.length >= 3 &&
        g.ends.some(({ r }) => r.kind === "road" && r.speed <= 80),
      polygon: convexHull(points),
    });
  }
  const ranges = new Map(p.roads.map((r) => [r.id, roadRange(r, result)]));
  for (const junction of result)
    if (junction.crosswalks) {
      const surfaces = junction.arms.flatMap((arm) => {
        const road = p.roads.find((r) => r.id === arm.road)!,
          range = ranges.get(road.id)!;
        return roadSurfaceTriangles(road, range).map((piece) => ({
          ...piece,
          road: road.id,
        }));
      });
      for (const arm of junction.arms) {
        const road = p.roads.find((r) => r.id === arm.road)!,
          walk = placeJunctionCrosswalk(
            road,
            arm,
            junction,
            surfaces.filter((piece) => piece.road !== road.id),
          );
        if (walk) {
          arm.crosswalkT = walk.t;
          arm.crosswalkDistance = walk.distance;
        }
      }
    }
  junctionCache.set(p, { signature, junctions: structuredClone(result) });
  return result;
}
export function roadRange(road: Road, junctions: Junction[]) {
  const arms = junctions
    .flatMap((j) => j.arms)
    .filter((a) => a.road === road.id);
  return {
    start: arms.find((a) => a.end === 0)?.t ?? 0,
    end: arms.find((a) => a.end === 1)?.t ?? 1,
  };
}
