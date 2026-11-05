import type { Road, V } from "./types";
export const v = (x = 0, z = 0, y = 0): V => ({ x, y, z });
export const add = (a: V, b: V): V => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub = (a: V, b: V): V => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const mul = (a: V, b: number): V => ({
  x: a.x * b,
  y: a.y * b,
  z: a.z * b,
});
export const lerp = (a: V, b: V, t: number) => add(mul(a, 1 - t), mul(b, t));
export const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const length = (a: V) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V) => mul(a, 1 / (length(a) || 1));
export const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const smooth = (t: number) => {
  t = clamp(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function bezier(p0: V, p1: V, p2: V, p3: V, t: number): V {
  const u = 1 - t;
  return add(
    add(mul(p0, u * u * u), mul(p1, 3 * u * u * t)),
    add(mul(p2, 3 * u * t * t), mul(p3, t * t * t)),
  );
}
export const knotAt = (r: Road, i: number) =>
  r.knots[i].at ?? i / (r.knots.length - 1);
function locate(r: Road, t: number) {
  t = clamp(t);
  let i = 0;
  while (i < r.knots.length - 2 && knotAt(r, i + 1) < t) i++;
  return {
    i,
    u: (t - knotAt(r, i)) / Math.max(0.000001, knotAt(r, i + 1) - knotAt(r, i)),
  };
}
export function point(r: Road, t: number): V {
  const { i, u } = locate(r, t);
  const a = r.knots[i],
    b = r.knots[i + 1];
  return bezier(a.p, a.outgoing, b.incoming, b.p, u);
}
export function tangent(r: Road, t: number): V {
  const { i, u } = locate(r, t);
  const a = r.knots[i],
    b = r.knots[i + 1];
  const d = add(
    add(
      mul(sub(a.outgoing, a.p), 3 * (1 - u) ** 2),
      mul(sub(b.incoming, a.outgoing), 6 * (1 - u) * u),
    ),
    mul(sub(b.p, b.incoming), 3 * u * u),
  );
  return length(d) > 0.00001
    ? norm(d)
    : norm(sub(point(r, clamp(t + 0.001)), point(r, clamp(t - 0.001))));
}
export function normal(r: Road, t: number): V {
  const d = tangent(r, t);
  return norm(v(-d.z, d.x));
}
export const countAt = (r: Road, t: number) => {
  const p = r.profile,
    u = p ? p.start + (p.end - p.start) * t : t;
  return (
    (p?.from ?? r.lanesStart) +
    ((p?.to ?? r.lanesEnd) - (p?.from ?? r.lanesStart)) *
      smooth(
        (u - (p?.transitionStart ?? r.transitionStart)) /
          Math.max(
            0.001,
            (p?.transitionEnd ?? r.transitionEnd) -
              (p?.transitionStart ?? r.transitionStart),
          ),
      )
  );
};
export const totalAt = (r: Road, t: number) =>
  countAt(r, t) * (r.twoWay ? 2 : 1);
export function center(r: Road, t: number): V {
  const delta =
    ((totalAt(r, t) - (r.widthOrigin ?? totalAt(r, 0))) * r.width) / 2;
  return add(
    point(r, t),
    mul(
      normal(r, t),
      r.align === "left" ? delta : r.align === "right" ? -delta : 0,
    ),
  );
}
export function laneCount(r: Road): number {
  return Math.max(r.lanesStart, r.lanesEnd) * (r.twoWay ? 2 : 1);
}
export function laneDirection(r: Road, lane: number): 1 | -1 {
  return r.twoWay && lane < Math.max(r.lanesStart, r.lanesEnd) ? -1 : 1;
}
export function laneWidth(r: Road, lane: number, t: number): number {
  const max = Math.max(r.lanesStart, r.lanesEnd),
    index = r.twoWay
      ? lane < max
        ? max - 1 - lane
        : lane - max
      : r.align === "right"
        ? max - 1 - lane
        : lane;
  return clamp(countAt(r, t) - index) * r.width;
}
export function lanePoint(r: Road, lane: number, t: number): V {
  let offset = 0;
  if (r.twoWay) {
    const m = Math.max(r.lanesStart, r.lanesEnd),
      back = lane < m,
      index = back ? m - 1 - lane : lane - m;
    offset =
      (back ? -1 : 1) *
      (Math.min(countAt(r, t), index) * r.width + laneWidth(r, lane, t) / 2);
  } else {
    let preceding = 0;
    for (let i = 0; i < lane; i++) preceding += laneWidth(r, i, t);
    offset =
      (-totalAt(r, t) * r.width) / 2 + preceding + laneWidth(r, lane, t) / 2;
  }
  return add(center(r, t), mul(normal(r, t), offset));
}
export function boundaryPoint(r: Road, index: number, t: number): V {
  const count = countAt(r, t),
    max = Math.max(r.lanesStart, r.lanesEnd);
  let offset = 0;
  if (r.twoWay)
    offset =
      index <= max
        ? -Math.min(count, max - index) * r.width
        : Math.min(count, index - max) * r.width;
  else {
    offset = (-count * r.width) / 2;
    for (let i = 0; i < index; i++) offset += laneWidth(r, i, t);
  }
  return add(center(r, t), mul(normal(r, t), offset));
}
export const laneEntryT = (r: Road, lane: number) =>
  laneDirection(r, lane) === 1 ? 0 : 1;
export const laneExitT = (r: Road, lane: number) => 1 - laneEntryT(r, lane);
export const roadLength = (r: Road): number => {
  let n = 0,
    p = point(r, 0);
  for (let i = 1; i <= 100; i++) {
    const q = point(r, i / 100);
    n += dist(p, q);
    p = q;
  }
  return n;
};
export function maxGrade(r: Road): number {
  let grade = 0,
    previous = point(r, 0);
  for (let i = 1; i <= 80; i++) {
    const next = point(r, i / 80);
    grade = Math.max(
      grade,
      (Math.abs(next.y - previous.y) /
        Math.max(0.001, Math.hypot(next.x - previous.x, next.z - previous.z))) *
        100,
    );
    previous = next;
  }
  return grade;
}
export function nearest(
  r: Road,
  p: V,
): { t: number; distance: number; point: V } {
  let t = 0,
    best = Infinity;
  for (let i = 0; i <= 100; i++) {
    const q = center(r, i / 100),
      d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best) {
      best = d;
      t = i / 100;
    }
  }
  let lo = Math.max(0, t - 0.012),
    hi = Math.min(1, t + 0.012);
  for (let i = 0; i < 20; i++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3,
      pa = center(r, a),
      pb = center(r, b);
    if (Math.hypot(pa.x - p.x, pa.z - p.z) < Math.hypot(pb.x - p.x, pb.z - p.z))
      hi = b;
    else lo = a;
  }
  t = (lo + hi) / 2;
  for (const endpoint of [0, 1])
    if (dist(center(r, endpoint), p) < dist(center(r, t), p)) t = endpoint;
  const q = center(r, t);
  return { t, distance: Math.hypot(q.x - p.x, q.z - p.z), point: q };
}
export function splitCurve(r: Road, t: number): [Road, Road] {
  t = clamp(t, 0.001, 0.999);
  const existing = r.knots.findIndex(
    (_, i) =>
      i > 0 && i < r.knots.length - 1 && Math.abs(knotAt(r, i) - t) < 0.000001,
  );
  if (existing >= 0) {
    const left = structuredClone(r),
      right = structuredClone(r);
    left.knots = left.knots
      .slice(0, existing + 1)
      .map((k, i) => ({ ...k, at: knotAt(r, i) / t }));
    right.knots = right.knots
      .slice(existing)
      .map((k, i) => ({ ...k, at: (knotAt(r, i + existing) - t) / (1 - t) }));
    return [left, right];
  }
  const { i, u } = locate(r, t);
  const a = r.knots[i],
    b = r.knots[i + 1],
    q0 = lerp(a.p, a.outgoing, u),
    q1 = lerp(a.outgoing, b.incoming, u),
    q2 = lerp(b.incoming, b.p, u),
    s0 = lerp(q0, q1, u),
    s1 = lerp(q1, q2, u),
    mid = lerp(s0, s1, u);
  const left = structuredClone(r),
    right = structuredClone(r);
  left.knots = left.knots.slice(0, i + 1);
  left.knots[i].outgoing = q0;
  left.knots.forEach((k, j) => (k.at = knotAt(r, j) / t));
  left.knots.push({ p: mid, incoming: s0, outgoing: s1, at: 1 });
  right.knots = right.knots.slice(i + 1);
  right.knots[0].incoming = q2;
  right.knots.forEach((k, j) => (k.at = (knotAt(r, i + 1 + j) - t) / (1 - t)));
  right.knots.unshift({ p: mid, incoming: s0, outgoing: s1, at: 0 });
  return [left, right];
}
export function arcTable(r: Road) {
  const samples = [{ t: 0, s: 0 }];
  let s = 0,
    p = point(r, 0);
  for (let i = 1; i <= 200; i++) {
    const q = point(r, i / 200);
    s += dist(p, q);
    samples.push({ t: i / 200, s });
    p = q;
  }
  return samples;
}
export function arcParameter(
  table: { t: number; s: number }[],
  distance: number,
) {
  const s = clamp(distance, 0, table.at(-1)!.s);
  let low = 0,
    high = table.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (table[mid].s < s) low = mid;
    else high = mid;
  }
  const a = table[low],
    b = table[high];
  return a.t + ((b.t - a.t) * (s - a.s)) / Math.max(0.00001, b.s - a.s);
}
