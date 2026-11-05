import {
  add,
  center,
  clamp,
  dist,
  knotAt,
  laneCount,
  laneDirection,
  laneEntryT,
  laneExitT,
  lanePoint,
  laneWidth,
  lerp,
  mul,
  normal,
  point,
  roadLength,
  splitCurve,
  sub,
  tangent,
  totalAt,
  v,
} from "./math";
import {
  copy,
  isSink,
  uid,
  type Connection,
  type Issue,
  type Project,
  type Road,
  type V,
} from "./types";
export function makeRoad(
  p0: V,
  p3: V,
  opts: Partial<Road> = {},
  p1?: V,
  p2?: V,
): Road {
  return {
    id: uid(),
    name: "新建道路",
    knots: [
      {
        p: copy(p0),
        incoming: copy(p0),
        outgoing: p1 || lerp(p0, p3, 1 / 3),
        at: 0,
      },
      {
        p: copy(p3),
        incoming: p2 || lerp(p0, p3, 2 / 3),
        outgoing: copy(p3),
        at: 1,
      },
    ],
    lanesStart: 2,
    lanesEnd: 2,
    twoWay: false,
    width: 3.6,
    speed: 60,
    align: "center",
    kind: "road",
    transitionStart: 0,
    transitionEnd: 1,
    ...opts,
  };
}
export const emptyProject = (): Project => ({
  version: 1,
  name: "未命名路网",
  roads: [],
  connections: [],
  ports: [],
  templates: [],
  trafficMultiplier: 1,
});
export function example(kind = "transition"): Project {
  const p = emptyProject();
  if (kind === "junction") {
    p.name = "城市路口实验";
    const opts = {
      twoWay: true,
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.5,
      speed: 50,
    };
    p.roads = [
      makeRoad(v(-95, 0), v(95, 0), { ...opts, name: "东西路" }),
      makeRoad(v(0, -85), v(0, 85), { ...opts, name: "南北路" }),
    ];
    reconnectIntersections(p);
    autoBoundaries(p);
    return p;
  }
  p.name = kind === "elevated" ? "三层立交实验" : "车道过渡实验";
  const a = makeRoad(v(-145, 0), v(-85, 0), { name: "入口主线 · 2 车道" });
  const b = makeRoad(v(-85, 0), v(-25, 0), {
    name: "渐变拓宽 · 2 → 3",
    lanesStart: 2,
    lanesEnd: 3,
    align: "left",
  });
  const c = makeRoad(v(-25, 1.8), v(25, 1.8), {
    name: "三车道并行段",
    lanesStart: 3,
    lanesEnd: 3,
  });
  const d = makeRoad(v(25, 0), v(145, 0), { name: "连续主线 · 2 车道" });
  const e = makeRoad(
    v(25, 5.4),
    v(145, 65, kind === "elevated" ? 12 : 0),
    {
      name: "平滑驶出匝道",
      lanesStart: 1,
      lanesEnd: 1,
      kind: "ramp",
      speed: 40,
    },
    v(85, 5.4),
    v(70, 65, kind === "elevated" ? 12 : 0),
  );
  p.roads = [a, b, c, d, e];
  p.ports = [
    { road: a.id, end: "start", type: "source", rate: 24 },
    { road: d.id, end: "end", type: "sink", rate: 1 },
    { road: e.id, end: "end", type: "sink", rate: 1 },
  ];
  if (kind === "elevated") {
    const cross = makeRoad(v(102, -85), v(102, 100), {
      name: "地面纵向道路",
      twoWay: true,
      lanesStart: 1,
      lanesEnd: 1,
    });
    const upper = makeRoad(v(-50, -60, 20), v(135, -60, 20), {
      name: "第二层高架",
      lanesStart: 2,
      lanesEnd: 2,
    });
    p.roads.push(cross, upper);
    p.ports.push(
      { road: cross.id, end: "start", type: "source", rate: 12 },
      { road: cross.id, end: "end", type: "sink", rate: 1 },
    );
  }
  return p;
}
export class History {
  private past: Project[] = [];
  private future: Project[] = [];
  commit(p: Project) {
    this.past.push(copy(p));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  undo(p: Project): Project | undefined {
    const q = this.past.pop();
    if (q) this.future.push(copy(p));
    return q;
  }
  redo(p: Project): Project | undefined {
    const q = this.future.pop();
    if (q) this.past.push(copy(p));
    return q;
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
}
export function connections(p: Project): Connection[] {
  const entries: { r: Road; l: number; t: number; p: V }[] = [],
    exits: typeof entries = [];
  for (const r of p.roads)
    for (let l = 0; l < laneCount(r); l++) {
      const t = laneEntryT(r, l),
        e = laneExitT(r, l);
      if (laneWidth(r, l, t) > r.width * 0.7)
        entries.push({ r, l, t, p: lanePoint(r, l, t) });
      if (laneWidth(r, l, e) > r.width * 0.7)
        exits.push({ r, l, t: e, p: lanePoint(r, l, e) });
    }
  const result: Connection[] = [];
  for (const a of exits)
    for (const b of entries) {
      if (a.r.id === b.r.id || Math.abs(a.p.y - b.p.y) > 0.5) continue;
      const ac = center(a.r, a.t),
        bc = center(b.r, b.t),
        shared = dist(ac, bc) < 0.65,
        close = dist(a.p, b.p) < Math.max(a.r.width, b.r.width) * 0.7;
      if (!shared && !close) continue;
      const ad = mul(tangent(a.r, a.t), laneDirection(a.r, a.l)),
        bd = mul(tangent(b.r, b.t), laneDirection(b.r, b.l)),
        dot = ad.x * bd.x + ad.z * bd.z,
        cross = ad.x * bd.z - ad.z * bd.x;
      if (shared && dot < -0.75) continue;
      if (shared && dot < 0.85) {
        const from = exits
            .filter((x) => x.r.id === a.r.id && x.t === a.t)
            .sort((x, y) => (x.l - y.l) * laneDirection(a.r, a.l)),
          to = entries
            .filter((x) => x.r.id === b.r.id && x.t === b.t)
            .sort((x, y) => (x.l - y.l) * laneDirection(b.r, b.l));
        const ai = cross > 0 ? from.at(-1) : from[0],
          bi = cross > 0 ? to.at(-1) : to[0];
        if (a.l !== ai?.l || b.l !== bi?.l) continue;
      } else if (shared) {
        const compatible = entries.filter(
            (x) => x.r.id === b.r.id && x.t === b.t,
          ),
          closest = compatible.reduce(
            (best, x) => (dist(a.p, x.p) < dist(a.p, best.p) ? x : best),
            compatible[0],
          );
        if (b.l !== closest?.l) continue;
      }
      result.push({
        id: `${a.r.id}:${a.l}>${b.r.id}:${b.l}`,
        from: { road: a.r.id, lane: a.l },
        to: { road: b.r.id, lane: b.l },
        enabled: true,
      });
    }
  return result;
}
// Connections are derived from geometry; historical manual overrides are retired.
export function autoJunction(p: Project) {
  p.connections = [];
}
export function normalizePorts(p: Project) {
  const seen = new Set<string>();
  p.ports = p.ports.filter((port) => {
    const r = p.roads.find((r) => r.id === port.road),
      key = port.road + ":" + port.end;
    if (!r || seen.has(key)) return false;
    seen.add(key);
    const wasSink = port.type === "sink";
    port.type = r.twoWay ? "both" : port.end === "start" ? "source" : "sink";
    if (r.twoWay && wasSink) port.rate = 30;
    return true;
  });
}
export function setBoundary(p: Project, id: string, end: "start" | "end") {
  const r = p.roads.find((r) => r.id === id);
  if (!r) return false;
  if (p.ports.some((x) => x.road === id && x.end === end)) return false;
  p.ports.push({
    road: id,
    end,
    type: r.twoWay ? "both" : end === "start" ? "source" : "sink",
    rate: r.twoWay || end === "start" ? 30 : 1,
  });
  return true;
}
export function removeBoundary(p: Project, id: string, end: "start" | "end") {
  const n = p.ports.length;
  p.ports = p.ports.filter((x) => !(x.road === id && x.end === end));
  return p.ports.length !== n;
}
export function autoBoundaries(p: Project) {
  const cs = connections(p);
  let count = 0;
  for (const r of p.roads)
    for (const end of ["start", "end"] as const) {
      const t = end === "start" ? 0 : 1,
        connected = cs.some(
          (c) =>
            (c.from.road === r.id && laneExitT(r, c.from.lane) === t) ||
            (c.to.road === r.id && laneEntryT(r, c.to.lane) === t),
        );
      if (!connected && setBoundary(p, r.id, end)) count++;
    }
  return count;
}
export function splitRoad(
  p: Project,
  id: string,
  t: number,
): string | undefined {
  const i = p.roads.findIndex((r) => r.id === id);
  if (i < 0 || t < 0.025 || t > 0.975) return;
  const r = p.roads[i];
  const [a, b] = splitCurve(r, t);
  b.id = uid();
  b.name = r.name + " · 后段";
  if (r.lanesStart !== r.lanesEnd || r.profile) {
    const profile = r.profile || {
      from: r.lanesStart,
      to: r.lanesEnd,
      start: 0,
      end: 1,
      transitionStart: r.transitionStart,
      transitionEnd: r.transitionEnd,
    };
    const mid = profile.start + (profile.end - profile.start) * t;
    a.profile = { ...profile, end: mid };
    b.profile = { ...profile, start: mid };
    a.widthOrigin = b.widthOrigin = r.widthOrigin ?? totalAt(r, 0);
  }
  p.roads.splice(i, 1, a, b);
  p.connections = p.connections.map((c) => ({
    ...c,
    from:
      c.from.road === id && laneDirection(r, c.from.lane) === 1
        ? { ...c.from, road: b.id }
        : c.from,
    to:
      c.to.road === id && laneDirection(r, c.to.lane) === -1
        ? { ...c.to, road: b.id }
        : c.to,
  }));
  p.ports = p.ports.map((x) =>
    x.road === id && x.end === "end" ? { ...x, road: b.id } : x,
  );
  autoJunction(p);
  return b.id;
}
export function insertKnot(r: Road, t: number) {
  if (r.knots.some((_, i) => Math.abs(knotAt(r, i) - t) < 0.000001)) {
    let span = 0;
    for (let i = 0; i < r.knots.length - 1; i++) {
      const length = knotAt(r, i + 1) - knotAt(r, i);
      if (length > span) {
        span = length;
        t = (knotAt(r, i + 1) + knotAt(r, i)) / 2;
      }
    }
  }
  const [a, b] = splitCurve(r, t);
  for (const k of a.knots) k.at = k.at! * t;
  for (const k of b.knots) k.at = t + k.at! * (1 - t);
  r.knots = [
    ...a.knots.slice(0, -1),
    { ...a.knots.at(-1)!, outgoing: b.knots[0].outgoing },
    ...b.knots.slice(1),
  ];
}
export function removeRoads(p: Project, ids: Set<string>) {
  p.roads = p.roads.filter((r) => !ids.has(r.id));
  p.connections = p.connections.filter(
    (c) => !ids.has(c.from.road) && !ids.has(c.to.road),
  );
  p.ports = p.ports.filter((x) => !ids.has(x.road));
}
export function transformRoads(roads: Road[], fn: (v: V) => V) {
  for (const r of roads)
    for (const k of r.knots) {
      k.p = fn(k.p);
      k.incoming = fn(k.incoming);
      k.outgoing = fn(k.outgoing);
    }
}
export function mirrorRoads(p: Project, ids: Set<string>) {
  const roads = p.roads.filter((r) => ids.has(r.id));
  if (!roads.length) return;
  const points = roads.flatMap((r) => r.knots.map((k) => k.p)),
    cx = points.reduce((sum, v) => sum + v.x, 0) / points.length;
  transformRoads(roads, (point) => v(2 * cx - point.x, point.z, point.y));
  for (const r of roads)
    r.align =
      r.align === "left" ? "right" : r.align === "right" ? "left" : "center";
  for (const c of p.connections)
    for (const ref of [c.from, c.to]) {
      const r = roads.find((r) => r.id === ref.road);
      if (r && !r.twoWay) ref.lane = laneCount(r) - 1 - ref.lane;
    }
}
export function setHeight(r: Road, start: number, end: number) {
  const count = r.knots.length;
  for (let i = 0; i < count; i++) {
    const k = r.knots[i],
      t = knotAt(r, i),
      dy = end - start;
    k.p.y = start + dy * (3 * t * t - 2 * t * t * t);
    const slope = dy * 6 * t * (1 - t);
    k.incoming.y = k.p.y - (slope * (i ? t - knotAt(r, i - 1) : 0)) / 3;
    k.outgoing.y =
      k.p.y + (slope * (i < count - 1 ? knotAt(r, i + 1) - t : 0)) / 3;
  }
}
export function makeBranch(
  p: Project,
  id: string,
  merge = false,
  opts: {
    side?: "left" | "right";
    length?: number;
    offset?: number;
    lanes?: number;
  } = {},
): string {
  const r = p.roads.find((x) => x.id === id)!;
  if (r.twoWay) throw new Error("请先选择单向道路创建分合流。");
  const t = merge ? 0 : 1,
    n = normal(r, t),
    base = center(r, t),
    forward = tangent(r, t),
    side = opts.side === "left" ? -1 : 1,
    len = opts.length ?? 90,
    offset = opts.offset ?? 42,
    rampLanes = opts.lanes ?? 1;
  const count = merge ? r.lanesStart : r.lanesEnd;
  if (count < 2) throw new Error("分合流节点至少需要两条车道。");
  if (rampLanes >= count) throw new Error("需要为主线至少保留一条车道。");
  const mainStart = add(base, mul(n, (-side * rampLanes * r.width) / 2)),
    rampStart = add(base, mul(n, (side * (count - rampLanes) * r.width) / 2));
  const sign = merge ? -1 : 1;
  const far = add(
    add(rampStart, mul(forward, len * sign)),
    mul(n, side * offset),
  );
  const mainOpts = {
    name: merge ? "合流主线" : "分流主线",
    lanesStart: count - rampLanes,
    lanesEnd: count - rampLanes,
    width: r.width,
    speed: r.speed,
  };
  const main = merge
    ? makeRoad(add(mainStart, mul(forward, -len)), mainStart, mainOpts)
    : makeRoad(mainStart, add(mainStart, mul(forward, len)), mainOpts);
  const rampOpts = {
    name: merge ? "平滑汇入匝道" : "平滑驶出匝道",
    kind: "ramp" as const,
    lanesStart: rampLanes,
    lanesEnd: rampLanes,
    width: r.width,
    speed: Math.min(40, r.speed),
  };
  const ramp = merge
    ? makeRoad(
        far,
        rampStart,
        rampOpts,
        add(far, mul(forward, len * 0.4)),
        add(rampStart, mul(forward, -len * 0.45)),
      )
    : makeRoad(
        rampStart,
        far,
        rampOpts,
        add(rampStart, mul(forward, len * 0.45)),
        add(far, mul(forward, -len * 0.4)),
      );
  p.roads.push(main, ramp);
  return ramp.id;
}
export function reverseRoad(r: Road) {
  const origin = r.widthOrigin ?? totalAt(r, 0);
  r.knots = r.knots
    .map((k, i) => ({ ...k, at: knotAt(r, i) }))
    .reverse()
    .map((k) => ({
      p: k.p,
      incoming: k.outgoing,
      outgoing: k.incoming,
      at: 1 - k.at!,
    }));
  [r.lanesStart, r.lanesEnd] = [r.lanesEnd, r.lanesStart];
  [r.transitionStart, r.transitionEnd] = [
    1 - r.transitionEnd,
    1 - r.transitionStart,
  ];
  r.align =
    r.align === "left" ? "right" : r.align === "right" ? "left" : "center";
  r.widthOrigin = origin;
  if (r.profile) {
    const p = r.profile;
    r.profile = {
      from: p.to,
      to: p.from,
      start: 1 - p.end,
      end: 1 - p.start,
      transitionStart: 1 - p.transitionEnd,
      transitionEnd: 1 - p.transitionStart,
    };
  }
}
export function validate(p: Project): Issue[] {
  const issues: Issue[] = [],
    cs = connections(p);
  for (const r of p.roads) {
    const len = roadLength(r);
    if (len < 3)
      issues.push({
        road: r.id,
        message: "道路过短，请拉长端点。",
        severity: "error",
      });
    for (let i = 1; i <= 40; i++) {
      const a = point(r, (i - 1) / 40),
        b = point(r, i / 40);
      const grade =
        Math.abs(b.y - a.y) / Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
      if (grade > 0.15) {
        issues.push({
          road: r.id,
          message: "坡度超过原型建议值 15%，请延长坡道。",
          severity: "warning",
        });
        break;
      }
    }
    if (
      r.lanesStart !== r.lanesEnd &&
      len * (r.transitionEnd - r.transitionStart) < 15
    )
      issues.push({
        road: r.id,
        message: "车道过渡区较短，建议增加到 15 米以上。",
        severity: "warning",
      });
    for (let i = 1; i < 40; i++) {
      const a = tangent(r, (i - 1) / 40),
        b = tangent(r, (i + 1) / 40),
        angle = Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1)),
        radius =
          dist(center(r, (i - 1) / 40), center(r, (i + 1) / 40)) /
          Math.max(0.0001, angle);
      if (radius < totalAt(r, i / 40) * r.width * 0.65) {
        issues.push({
          road: r.id,
          message: "弯道半径过小，路面可能内折，请调整控制柄。",
          severity: "warning",
        });
        break;
      }
    }
    let selfCross = false;
    for (let i = 0; i < 40 && !selfCross; i++)
      for (let j = i + 3; j < 40; j++) {
        const a = point(r, i / 40),
          b = point(r, (i + 1) / 40),
          c = point(r, j / 40),
          d = point(r, (j + 1) / 40),
          ax = b.x - a.x,
          az = b.z - a.z,
          bx = d.x - c.x,
          bz = d.z - c.z,
          det = ax * bz - az * bx;
        if (Math.abs(det) < 0.00001) continue;
        const dx = c.x - a.x,
          dz = c.z - a.z,
          u = (dx * bz - dz * bx) / det,
          w = (dx * az - dz * ax) / det;
        if (
          u > 0 &&
          u < 1 &&
          w > 0 &&
          w < 1 &&
          Math.abs(a.y + (b.y - a.y) * u - (c.y + (d.y - c.y) * w)) < 0.5
        ) {
          selfCross = true;
          break;
        }
      }
    if (selfCross)
      issues.push({
        road: r.id,
        message: "道路在同一高度自相交，请调整曲线或切分为路口。",
        severity: "error",
      });
    const max = laneCount(r);
    for (let l = 0; l < max; l++) {
      const t = laneExitT(r, l);
      if (laneWidth(r, l, t) < r.width * 0.7) continue;
      const end = t === 0 ? "start" : "end";
      if (
        !cs.some(
          (c) => c.enabled && c.from.road === r.id && c.from.lane === l,
        ) &&
        !p.ports.some((x) => isSink(x) && x.road === r.id && x.end === end)
      ) {
        issues.push({
          road: r.id,
          message: "存在未连接的车道出口；可继续接路或设置出口。",
          severity: "warning",
        });
        break;
      }
    }
  }
  for (let a = 0; a < p.roads.length; a++)
    for (let b = a + 1; b < p.roads.length; b++) {
      const r = p.roads[a],
        s = p.roads[b];
      let found = false;
      for (let i = 2; i < 19 && !found; i++)
        for (let j = 2; j < 19; j++) {
          const rp = center(r, i / 20),
            sp = center(s, j / 20);
          if (
            Math.hypot(rp.x - sp.x, rp.z - sp.z) <
            Math.min(totalAt(r, i / 20), totalAt(s, j / 20)) * r.width * 0.35
          ) {
            const gap = Math.abs(rp.y - sp.y);
            if (gap < 5) {
              issues.push({
                road: r.id,
                message:
                  gap < 0.6
                    ? `与「${s.name}」相交：请调整道路以形成自动路口。`
                    : `与「${s.name}」净空不足 5 米，请调整高度。`,
                severity: "warning",
              });
              found = true;
              break;
            }
          }
        }
    }
  return issues;
}
export function parseProject(text: string): Project {
  const p = JSON.parse(text);
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    !Array.isArray(p.roads) ||
    p.roads.length > 1000 ||
    !Array.isArray(p.connections) ||
    !Array.isArray(p.ports)
  )
    throw new Error("地图格式不正确或版本不兼容。");
  const ids = new Set<string>();
  const finite = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100000;
  if (
    p.trafficMultiplier !== undefined &&
    (!finite(p.trafficMultiplier) ||
      p.trafficMultiplier < 0 ||
      p.trafficMultiplier > 4)
  )
    throw new Error("车流强度须在 0–400% 之间。");
  for (const r of p.roads) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,120}$/.test(r.id) ||
      ids.has(r.id) ||
      typeof r.name !== "string" ||
      r.name.length > 200 ||
      !Array.isArray(r.knots) ||
      r.knots.length < 2 ||
      r.knots.length > 100 ||
      ![r.lanesStart, r.lanesEnd].every(
        (n) => Number.isInteger(n) && n >= 1 && n <= 3,
      ) ||
      !finite(r.width) ||
      r.width < 2 ||
      r.width > 6 ||
      !finite(r.speed) ||
      r.speed < 5 ||
      r.speed > 160 ||
      typeof r.twoWay !== "boolean" ||
      !["left", "right", "center"].includes(r.align) ||
      !["road", "ramp"].includes(r.kind) ||
      !finite(r.transitionStart) ||
      !finite(r.transitionEnd) ||
      r.transitionStart < 0 ||
      r.transitionEnd > 1 ||
      r.transitionStart >= r.transitionEnd
    )
      throw new Error("道路属性不合法，未替换当前地图。");
    for (const k of r.knots)
      for (const key of ["p", "incoming", "outgoing"])
        if (!k[key] || !["x", "y", "z"].every((n) => finite(k[key][n])))
          throw new Error("控制点坐标不合法。");
    ids.add(r.id);
    for (let i = 0; i < r.knots.length; i++) {
      const at = knotAt(r, i);
      if (!finite(at) || at < 0 || at > 1 || (i > 0 && at <= knotAt(r, i - 1)))
        throw new Error("曲线控制点顺序不合法。");
    }
    if (knotAt(r, 0) !== 0 || knotAt(r, r.knots.length - 1) !== 1)
      throw new Error("曲线端点参数不合法。");
    if (
      r.widthOrigin !== undefined &&
      (!finite(r.widthOrigin) || r.widthOrigin < 0 || r.widthOrigin > 6)
    )
      throw new Error("道路宽度参考不合法。");
    if (
      r.profile &&
      (![
        "from",
        "to",
        "start",
        "end",
        "transitionStart",
        "transitionEnd",
      ].every((k) => finite(r.profile[k])) ||
        r.profile.start < 0 ||
        r.profile.end > 1 ||
        r.profile.start >= r.profile.end ||
        ![r.profile.from, r.profile.to].every(
          (n) => Number.isInteger(n) && n >= 1 && n <= 3,
        ) ||
        r.profile.transitionStart < 0 ||
        r.profile.transitionEnd > 1 ||
        r.profile.transitionStart >= r.profile.transitionEnd)
    )
      throw new Error("渐变区参数不合法。");
  }
  p.connections = [];
  for (const x of p.ports)
    if (
      !ids.has(x.road) ||
      !["start", "end"].includes(x.end) ||
      !["source", "sink", "both"].includes(x.type) ||
      !finite(x.rate) ||
      x.rate < 0 ||
      x.rate > 240
    )
      throw new Error("出入口属性不合法。");
  if (!Array.isArray(p.templates)) p.templates = [];
  for (const t of p.templates) {
    if (
      typeof t.id !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,120}$/.test(t.id) ||
      typeof t.name !== "string"
    )
      throw new Error("模板格式错误。");
    parseProject(
      JSON.stringify({
        version: 1,
        name: t.name,
        roads: t.roads,
        connections: t.connections,
        ports: [],
        templates: [],
      }),
    );
  }
  normalizePorts(p);
  return p;
}
export function reconnectIntersections(p: Project): number {
  let count = 0;
  for (let restart = 0; restart < 50; restart++) {
    let hit = false;
    outer: for (let a = 0; a < p.roads.length; a++)
      for (let b = a + 1; b < p.roads.length; b++) {
        const r = p.roads[a],
          s = p.roads[b];
        for (let i = 1; i <= 40; i++)
          for (let j = 1; j <= 40; j++) {
            const a0 = center(r, (i - 1) / 40),
              a1 = center(r, i / 40),
              b0 = center(s, (j - 1) / 40),
              b1 = center(s, j / 40);
            const ax = a1.x - a0.x,
              az = a1.z - a0.z,
              bx = b1.x - b0.x,
              bz = b1.z - b0.z,
              det = ax * bz - az * bx;
            if (Math.abs(det) < 0.00001) continue;
            const dx = b0.x - a0.x,
              dz = b0.z - a0.z,
              u = (dx * bz - dz * bx) / det,
              w = (dx * az - dz * ax) / det;
            if (u < 0 || u > 1 || w < 0 || w > 1) continue;
            let ta = (i - 1 + u) / 40,
              tb = (j - 1 + w) / 40;
            // Refine the sampled crossing on the actual curves so all arms share a node.
            for (let k = 0; k < 6; k++) {
              const pa = center(r, ta),
                pb = center(s, tb),
                h = 0.0001;
              const ra = center(r, clamp(ta - h)),
                rb = center(r, clamp(ta + h));
              const sa = center(s, clamp(tb - h)),
                sb = center(s, clamp(tb + h));
              const ad = mul(
                sub(rb, ra),
                1 / Math.max(h, clamp(ta + h) - clamp(ta - h)),
              );
              const bd = mul(
                sub(sb, sa),
                1 / Math.max(h, clamp(tb + h) - clamp(tb - h)),
              );
              const det = ad.x * bd.z - ad.z * bd.x;
              if (Math.abs(det) < 0.00001) break;
              const dx = pb.x - pa.x,
                dz = pb.z - pa.z;
              ta = clamp(ta + (dx * bd.z - dz * bd.x) / det);
              tb = clamp(tb + (dx * ad.z - dz * ad.x) / det);
            }
            const interiorA = ta > 0.025 && ta < 0.975,
              interiorB = tb > 0.025 && tb < 0.975;
            if (
              (!interiorA && !interiorB) ||
              dist(center(r, ta), center(s, tb)) > 0.5
            )
              continue;
            if (interiorA) splitRoad(p, r.id, ta);
            if (interiorB) splitRoad(p, s.id, tb);
            count++;
            hit = true;
            break outer;
          }
      }
    if (!hit) break;
  }
  autoJunction(p);
  return count;
}
