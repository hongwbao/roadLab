import {
  add,
  arcParameter,
  arcTable,
  center,
  nodePoint,
  dist,
  mul,
  normal,
  tangent,
  totalAt,
} from "./math";
import type { Project, Road, V } from "./types";
export type Arm = {
  road: string;
  end: 0 | 1;
  direction: V;
  halfWidth: number;
  trim: number;
  t: number;
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
export function buildJunctions(p: Project): Junction[] {
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
      Math.max(...g.ends.map(({ r, end }) => (totalAt(r, end) * r.width) / 2)) +
      2.5;
    const arms: Arm[] = g.ends.map(({ r, end }, i) => {
      const table = arcTable(r),
        length = table.at(-1)!.s,
        trim = Math.min(radius + 1, length * 0.38),
        t = arcParameter(table, end === 0 ? trim : length - trim);
      return {
        road: r.id,
        end,
        direction: dirs[i],
        halfWidth: (totalAt(r, t) * r.width) / 2 + 0.35,
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
      radius,
      crosswalks:
        arms.length >= 3 &&
        g.ends.some(({ r }) => r.kind === "road" && r.speed <= 80),
      polygon: convexHull(points),
    });
  }
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
