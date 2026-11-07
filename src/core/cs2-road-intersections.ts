/** Complete source CourseSplit filtering, geometry, height and deferred Results transaction. */
import type { V } from "./types";
import { cs2NativeSort } from "./cs2-native-sort";
import {
  cs2FitRoadCurve,
  cs2RoadCurvePosition,
  cs2RoadCurveTangent,
  cs2RoadCurveLength,
  cs2OffsetRoadCurveLeftSmooth,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
import {
  cs2CutRoadCourseCurve,
  type CS2RoadCourse,
  type CS2RoadCoursePos,
  type CS2RoadCourseOwner,
  type CS2RoadCreationDefinition,
} from "./cs2-road-courses";
import { cs2LookRotationSafe } from "../simulation/cs2-motion";
export type CS2RoadRange = [number, number];
export type CS2RoadBounds = { min: V; max: V };
export type CS2RoadIntersectionFlags = {
  general: number;
  left: number;
  right: number;
};
export type CS2RoadIntersectionCourse = {
  creation: CS2RoadCreationDefinition;
  owner: CS2RoadCourseOwner;
  course: CS2RoadCourse;
  upgraded: CS2RoadIntersectionFlags;
  entity: string | null;
};
export type CS2RoadGeometrySegment = {
  left: CS2RoadCurve;
  right: CS2RoadCurve;
  length: readonly [number, number];
};
export type CS2RoadEdgeGeometry = {
  start: CS2RoadGeometrySegment;
  end: CS2RoadGeometrySegment;
  bounds: CS2RoadBounds;
};
export type CS2RoadNodeGeometry = {
  left: CS2RoadGeometrySegment;
  right: CS2RoadGeometrySegment;
  middle: CS2RoadCurve;
  bounds: CS2RoadBounds;
  middleRadius: number;
};
export type CS2RoadIntersectionNetData = {
  requiredLayers: number;
  connectLayers: number;
};
export type CS2RoadIntersectionGeometry = {
  defaultWidth: number;
  edgeLengthRange: readonly [number, number];
  defaultHeightRange: readonly [number, number];
  mergeLayers: number;
  flags: number;
};
export type CS2RoadIntersectionComposition = {
  width: number;
  heightRange: readonly [number, number];
  nodeOffset: number;
  flags: CS2RoadIntersectionFlags;
};
export type CS2RoadAuxiliaryNet = {
  prefab: string | null;
  position: V;
  invertMode?: number;
};
export type CS2RoadIntersectionWorld = {
  edges: ReadonlyMap<string, { start: string | null; end: string | null }>;
  curves: ReadonlyMap<string, CS2RoadCurve>;
  compositions: ReadonlyMap<
    string,
    { edge: string; startNode: string; endNode: string }
  >;
  edgeGeometry: ReadonlyMap<string, CS2RoadEdgeGeometry>;
  startNodeGeometry: ReadonlyMap<string, CS2RoadNodeGeometry>;
  endNodeGeometry: ReadonlyMap<string, CS2RoadNodeGeometry>;
  owners: ReadonlyMap<string, string | null>;
  buildings: ReadonlySet<string>;
  localTransforms: ReadonlyMap<string, { parentMesh: number }>;
  prefabRefs: ReadonlyMap<string, string | null>;
  prefabNet: ReadonlyMap<string, CS2RoadIntersectionNetData>;
  prefabGeometry: ReadonlyMap<string, CS2RoadIntersectionGeometry>;
  prefabComposition: ReadonlyMap<string, CS2RoadIntersectionComposition>;
  prefabObjectGeometry: ReadonlyMap<string, { flags: number }>;
  connectedEdges: ReadonlyMap<string, readonly string[]>;
  auxiliaryNets: ReadonlyMap<string, readonly CS2RoadAuxiliaryNet[]>;
  deleted: ReadonlySet<string>;
};
export function createCS2RoadIntersectionWorld(
  input: Partial<CS2RoadIntersectionWorld> = {},
): CS2RoadIntersectionWorld {
  return {
    edges: new Map(),
    curves: new Map(),
    compositions: new Map(),
    edgeGeometry: new Map(),
    startNodeGeometry: new Map(),
    endNodeGeometry: new Map(),
    owners: new Map(),
    buildings: new Set(),
    localTransforms: new Map(),
    prefabRefs: new Map(),
    prefabNet: new Map(),
    prefabGeometry: new Map(),
    prefabComposition: new Map(),
    prefabObjectGeometry: new Map(),
    connectedEdges: new Map(),
    auxiliaryNets: new Map(),
    deleted: new Set(),
    ...input,
  };
}
export type CS2RoadOverlap = { entity: string | null; courseIndex: number };
export type CS2RoadOverlapTreeNode = {
  bounds: CS2RoadBounds;
  entity?: string | null;
  children?: readonly CS2RoadOverlapTreeNode[];
};
export type CS2RoadCourseChunk = {
  entities: readonly string[];
  creation: readonly CS2RoadCreationDefinition[];
  courses: readonly CS2RoadCourse[];
  owners?: readonly CS2RoadCourseOwner[];
  upgraded?: readonly CS2RoadIntersectionFlags[];
};
export type CS2RoadIntersectPos = {
  coursePos: CS2RoadCoursePos;
  courseIntersection: CS2RoadRange;
  intersectionHeightMin: CS2RoadRange;
  intersectionHeightMax: CS2RoadRange;
  edgeIntersection: CS2RoadRange;
  edgeHeightRangeMin: CS2RoadRange;
  edgeHeightRangeMax: CS2RoadRange;
  canMove: CS2RoadRange;
  priority: number;
  courseIndex: number;
  auxIndex: number;
  isNode: boolean;
  isOptional: boolean;
  isStartEnd: boolean;
  isTunnel: boolean;
  isWaterway: boolean;
};
const f = Math.fround,
  MAX = f(3.4028234663852886e38),
  MIN_NORMAL = f(1.1754944e-38);
const add = (a: number, b: number) => f(f(a) + f(b)),
  sub = (a: number, b: number) => f(f(a) - f(b)),
  mul = (a: number, b: number) => f(f(a) * f(b)),
  div = (a: number, b: number) => f(f(a) / f(b));
// Original Unity scalar min/max ignore a NaN when the other operand is a number.
const min = (a: number, b: number) => (Number.isNaN(b) || a < b ? a : b),
  max = (a: number, b: number) => (Number.isNaN(b) || a > b ? a : b);
const int32 = (n: number) =>
  Number.isFinite(n) && n >= -2147483648 && n <= 2147483647
    ? Math.trunc(n)
    : -2147483648;
const roundEven = (n: number) => {
  const lower = Math.floor(n),
    fraction = n - lower;
  return fraction === 0.5
    ? lower % 2 === 0
      ? lower
      : lower + 1
    : Math.round(n);
};
const clamp = (n: number, a: number, b: number) => max(a, min(b, n)),
  sat = (n: number) => clamp(n, 0, 1),
  lerp = (a: number, b: number, t: number) => add(a, mul(sub(b, a), t));
const v = (a: V): V => ({ x: f(a.x), y: f(a.y), z: f(a.z) }),
  vadd = (a: V, b: V): V => ({
    x: add(a.x, b.x),
    y: add(a.y, b.y),
    z: add(a.z, b.z),
  }),
  vsub = (a: V, b: V): V => ({
    x: sub(a.x, b.x),
    y: sub(a.y, b.y),
    z: sub(a.z, b.z),
  }),
  vmul = (a: V, b: number): V => ({
    x: mul(a.x, b),
    y: mul(a.y, b),
    z: mul(a.z, b),
  }),
  vlerp = (a: V, b: V, t: number) => vadd(a, vmul(vsub(b, a), t));
const dot = (a: V, b: V) =>
    add(add(mul(a.x, b.x), mul(a.y, b.y)), mul(a.z, b.z)),
  dot2 = (a: V, b: V) => add(mul(a.x, b.x), mul(a.z, b.z));
const length = (a: V, d2 = false) => f(Math.sqrt(d2 ? dot2(a, a) : dot(a, a))),
  distance = (a: V, b: V, d2 = false) => length(vsub(a, b), d2);
const normalize = (a: V, d2 = false) => {
  const square = d2 ? dot2(a, a) : dot(a, a);
  return square > MIN_NORMAL
    ? vmul(a, f(1 / f(Math.sqrt(square))))
    : { x: 0, y: 0, z: 0 };
};
const flat = (a: V): V => ({ x: f(a.x), y: 0, z: f(a.z) });
const emptyRange = (): CS2RoadRange => [0, 0],
  invalidRange = (): CS2RoadRange => [1, 0];
const union = (
  target: CS2RoadRange,
  other: number | readonly [number, number],
) => {
  const range = typeof other === "number" ? [other, other] : other;
  target[0] = min(target[0], range[0]);
  target[1] = max(target[1], range[1]);
  return target;
};
const intersectRange = (
  a: readonly [number, number],
  b: readonly [number, number],
) => a[0] <= b[1] && b[0] <= a[1];
const bounds = (curve: CS2RoadCurve, expand = 0): CS2RoadBounds => ({
  min: {
    x: sub(
      min(min(curve[0].x, curve[1].x), min(curve[2].x, curve[3].x)),
      expand,
    ),
    y: min(min(curve[0].y, curve[1].y), min(curve[2].y, curve[3].y)),
    z: sub(
      min(min(curve[0].z, curve[1].z), min(curve[2].z, curve[3].z)),
      expand,
    ),
  },
  max: {
    x: add(
      max(max(curve[0].x, curve[1].x), max(curve[2].x, curve[3].x)),
      expand,
    ),
    y: max(max(curve[0].y, curve[1].y), max(curve[2].y, curve[3].y)),
    z: add(
      max(max(curve[0].z, curve[1].z), max(curve[2].z, curve[3].z)),
      expand,
    ),
  },
});
const intersectBounds = (a: CS2RoadBounds, b: CS2RoadBounds) =>
  f(a.min.x) <= f(b.max.x) &&
  f(a.min.z) <= f(b.max.z) &&
  f(b.min.x) <= f(a.max.x) &&
  f(b.min.z) <= f(a.max.z);
const need = <T>(
  map: ReadonlyMap<string, T>,
  id: string | null,
  name: string,
): T => {
  if (id === null || !map.has(id))
    throw new Error(`Missing source ${name}: ${id}`);
  return map.get(id)!;
};
const emptyPos = (): CS2RoadCoursePos => ({
  entity: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 0 },
  elevation: [0, 0],
  courseDelta: 0,
  splitPosition: 0,
  flags: 0,
  parentMesh: 0,
});
const emptyOwner = (): CS2RoadCourseOwner => ({
  prefab: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 0 },
});
const emptyFlags = (): CS2RoadIntersectionFlags => ({
  general: 0,
  left: 0,
  right: 0,
});
const emptyIntersect = (): CS2RoadIntersectPos => ({
  coursePos: emptyPos(),
  courseIntersection: emptyRange(),
  intersectionHeightMin: emptyRange(),
  intersectionHeightMax: emptyRange(),
  edgeIntersection: emptyRange(),
  edgeHeightRangeMin: emptyRange(),
  edgeHeightRangeMax: emptyRange(),
  canMove: emptyRange(),
  priority: 0,
  courseIndex: 0,
  auxIndex: 0,
  isNode: false,
  isOptional: false,
  isStartEnd: false,
  isTunnel: false,
  isWaterway: false,
});
const unsetIntersect = () => ({ ...emptyIntersect(), priority: -1 });
const rotation = (tangent: V) => {
  const n = normalize(flat(tangent), true);
  return dot2(n, n) > 0
    ? cs2LookRotationSafe(n, { x: 0, y: 1, z: 0 })
    : { x: 0, y: 0, z: 0, w: 1 };
};
const segmentDistance = (a: V, b: V, p: V) => {
  const line = vsub(b, a),
    offset = vsub(p, a),
    square = dot2(line, line),
    t = square !== 0 ? sat(div(dot2(line, offset), square)) : 0;
  return { t, distance: distance(vmul(line, t), offset, true) };
};
const lineIntersection = (a: V, b: V, c: V, d: V) => {
  const u = vsub(b, a),
    w = vsub(d, c),
    delta = vsub(a, c),
    denom = sub(mul(u.x, w.z), mul(u.z, w.x)),
    x = div(sub(mul(delta.z, w.x), mul(delta.x, w.z)), denom),
    y = div(sub(mul(delta.z, u.x), mul(delta.x, u.z)), denom);
  return {
    hit:
      x >= 0 &&
      x <= 1 &&
      y >= 0 &&
      y <= 1 &&
      max(min(a.x, b.x), min(c.x, d.x)) <= min(max(a.x, b.x), max(c.x, d.x)) &&
      max(min(a.z, b.z), min(c.z, d.z)) <= min(max(a.z, b.z), max(c.z, d.z)),
    x,
    y,
  };
};
const triangle = (a: V, b: V, c: V, p: V) => {
  const u = vsub(b, a),
    w = vsub(c, a),
    d = vsub(p, a),
    denom = sub(mul(u.x, w.z), mul(u.z, w.x)),
    x = div(sub(mul(d.x, w.z), mul(d.z, w.x)), denom),
    y = div(sub(mul(d.z, u.x), mul(d.x, u.z)), denom),
    sum = add(x, y);
  return {
    hit: x >= 0 && x <= 1 && y >= 0 && y <= 1 && sum >= 0 && sum <= 1,
    x,
    y,
  };
};
const lineDistance = (a: V, b: V, c: V, d: V) => {
  const u = vsub(b, a),
    w = vsub(d, c),
    delta = vsub(a, c),
    denom = sub(mul(u.x, w.z), mul(u.z, w.x));
  if (denom === 0) {
    let first = segmentDistance(c, d, a),
      result = { x: 0, y: first.t, distance: first.distance };
    const other = segmentDistance(c, d, b);
    if (other.distance < result.distance)
      result = { x: 1, y: other.t, distance: other.distance };
    for (const [point, end] of [
      [c, 0],
      [d, 1],
    ] as const) {
      first = segmentDistance(a, b, point);
      if (first.distance < result.distance)
        result = { x: first.t, y: end, distance: first.distance };
    }
    return result;
  }
  let x = sat(div(sub(mul(delta.z, w.x), mul(delta.x, w.z)), denom)),
    y = sat(div(sub(mul(delta.z, u.x), mul(delta.x, u.z)), denom)),
    result = 0;
  if (x === 0) {
    const r = segmentDistance(c, d, a);
    y = r.t;
    result = r.distance;
  } else if (x === 1) {
    const r = segmentDistance(c, d, b);
    y = r.t;
    result = r.distance;
  } else if (y === 0) {
    const r = segmentDistance(a, b, c);
    x = r.t;
    result = r.distance;
  } else if (y === 1) {
    const r = segmentDistance(a, b, d);
    x = r.t;
    result = r.distance;
  }
  return { x, y, distance: result };
};
// Bezier4x2 packs ab/cd and has a different float32 addition order from Bezier4x3.
function curveXZPosition(curve: CS2RoadCurve, t: number, tangent = false): V {
  t = f(t);
  const u = sub(1, t),
    three = mul(3, t),
    w = tangent
      ? [
          mul(mul(u, sub(-1, -t)), 3),
          mul(mul(u, sub(1, three)), 3),
          mul(mul(t, sub(2, three)), 3),
          mul(mul(t, t), 3),
        ]
      : [
          mul(mul(u, u), u),
          mul(mul(three, u), u),
          mul(mul(three, t), u),
          mul(mul(t, t), t),
        ];
  return flat(
    vadd(
      vadd(vmul(curve[0], w[0]), vmul(curve[2], w[2])),
      vadd(vmul(curve[1], w[1]), vmul(curve[3], w[3])),
    ),
  );
}
function cutXZ(
  curve: CS2RoadCurve,
  range: readonly [number, number],
): CS2RoadCurve {
  const [a, b] = range.map(f),
    s = [a, a, a, b],
    t = [a, a, b, b],
    u = [a, b, b, b],
    inv = (n: number) => sub(1, n);
  return [0, 1, 2, 3].map((i) => {
    const w0 = mul(mul(inv(s[i]), inv(t[i])), inv(u[i])),
      w1 = add(
        add(
          mul(mul(s[i], inv(t[i])), inv(u[i])),
          mul(mul(inv(s[i]), t[i]), inv(u[i])),
        ),
        mul(mul(inv(s[i]), inv(t[i])), u[i]),
      ),
      w2 = add(
        add(mul(mul(s[i], t[i]), inv(u[i])), mul(mul(inv(s[i]), t[i]), u[i])),
        mul(mul(s[i], inv(t[i])), u[i]),
      ),
      w3 = mul(mul(s[i], t[i]), u[i]);
    const p =
      i % 2 === 0
        ? vadd(
            vadd(
              vadd(vmul(curve[0], w0), vmul(curve[2], w2)),
              vmul(curve[1], w1),
            ),
            vmul(curve[3], w3),
          )
        : vadd(
            vadd(
              vadd(vmul(curve[1], w1), vmul(curve[3], w3)),
              vmul(curve[0], w0),
            ),
            vmul(curve[2], w2),
          );
    return flat(p);
  }) as unknown as CS2RoadCurve;
}
function curveDistance(curve: CS2RoadCurve, point: V) {
  let result = MAX,
    t = 0,
    start = 0,
    a = curve[0];
  for (let i = 1; i <= 16; i++) {
    const next = f(i / 16),
      b = curveXZPosition(curve, next),
      r = segmentDistance(a, b, point);
    if (r.distance < result) {
      result = r.distance;
      t = lerp(start, next, r.t);
    }
    start = next;
    a = b;
  }
  let step = f(1 / 32);
  for (let i = 0; i < 4; i++) {
    const centre = curveXZPosition(curve, t),
      before = curveXZPosition(curve, max(0, sub(t, step))),
      after = curveXZPosition(curve, min(1, add(t, step))),
      left = segmentDistance(centre, before, point),
      right = segmentDistance(centre, after, point);
    if (left.distance < right.distance) {
      t = max(0, sub(t, mul(step, left.t)));
      result = left.distance;
    } else {
      t = min(1, add(t, mul(step, right.t)));
      result = right.distance;
    }
    step = mul(step, 0.5);
  }
  return { t, distance: result };
}
function clampLength(
  curve: CS2RoadCurve,
  range: CS2RoadRange,
  wanted: number,
  d2: boolean,
  inverse = false,
): boolean {
  if (inverse) {
    const reversed: CS2RoadRange = [range[1], range[0]],
      r = clampLength(curve, reversed, wanted, d2);
    range[0] = reversed[1];
    range[1] = reversed[0];
    return r;
  }
  if (wanted === 0) {
    range[1] = range[0];
    return true;
  }
  let from = range[0],
    step = div(sub(range[1], range[0]), 16),
    accum = 0,
    previous = (d2 ? curveXZPosition : cs2RoadCurvePosition)(curve, range[0]);
  for (let i = 1; i <= 16; i++) {
    let to = add(from, step);
    const current = (d2 ? curveXZPosition : cs2RoadCurvePosition)(curve, to),
      total = add(accum, distance(previous, current, d2));
    if (total >= wanted) {
      to = lerp(from, to, div(sub(wanted, accum), sub(total, accum)));
      range[1] = clamp(to, min(range[0], range[1]), max(range[0], range[1]));
      return true;
    }
    from = to;
    previous = current;
    accum = total;
  }
  return false;
}
function curveLengthRange(
  curve: CS2RoadCurve,
  range: CS2RoadRange,
  d2: boolean,
) {
  let total = 0,
    previous = (d2 ? curveXZPosition : cs2RoadCurvePosition)(curve, range[0]);
  const step = div(sub(range[1], range[0]), 16);
  for (let i = 1; i <= 16; i++) {
    const current = (d2 ? curveXZPosition : cs2RoadCurvePosition)(
      curve,
      add(range[0], mul(i, step)),
    );
    total = add(total, distance(previous, current, d2));
    previous = current;
  }
  return total;
}
const canConnect = (
  a: CS2RoadIntersectionNetData,
  b: CS2RoadIntersectionNetData,
) =>
  (a.requiredLayers & b.connectLayers) >>> 0 === a.requiredLayers >>> 0 ||
  (b.requiredLayers & a.connectLayers) >>> 0 === b.requiredLayers >>> 0;

export function cs2QuadRoadIntersection(
  first: readonly [V, V, V, V],
  second: readonly [V, V, V, V],
) {
  const a = invalidRange(),
    b = invalidRange(),
    shape = (q: readonly [V, V, V, V]): CS2RoadBounds => ({
      min: {
        x: min(min(q[0].x, q[1].x), min(q[2].x, q[3].x)),
        y: 0,
        z: min(min(q[0].z, q[1].z), min(q[2].z, q[3].z)),
      },
      max: {
        x: max(max(q[0].x, q[1].x), max(q[2].x, q[3].x)),
        y: 0,
        z: max(max(q[0].z, q[1].z), max(q[2].z, q[3].z)),
      },
    });
  if (!intersectBounds(shape(first), shape(second)))
    return { hit: false, first: a, second: b };
  const triangles = (
    q: readonly [V, V, V, V],
  ): readonly [readonly [V, V, V], readonly [V, V, V]] => [
    [q[0], q[2], q[3]],
    [q[3], q[1], q[0]],
  ];
  for (const [index, tri] of triangles(first).entries())
    for (const [point, p] of second.entries()) {
      const t = triangle(...tri, p);
      if (t.hit) {
        union(a, index === 0 ? add(t.x, t.y) : sub(sub(1, t.x), t.y));
        union(b, point < 2 ? 0 : 1);
      }
    }
  for (const [index, tri] of triangles(second).entries())
    for (const [point, p] of first.entries()) {
      const t = triangle(...tri, p);
      if (t.hit) {
        union(a, point < 2 ? 0 : 1);
        union(b, index === 0 ? add(t.x, t.y) : sub(sub(1, t.x), t.y));
      }
    }
  const lines = (q: readonly [V, V, V, V]): readonly (readonly [V, V])[] => [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[0], q[2]],
    [q[1], q[3]],
  ];
  for (const [i, line] of lines(first).entries())
    for (const [j, other] of lines(second).entries()) {
      const t = lineIntersection(...line, ...other);
      if (t.hit) {
        union(a, i < 2 ? i : t.x);
        union(b, j < 2 ? j : t.y);
      }
    }
  return { hit: a[0] <= a[1], first: a, second: b };
}
function circleLine(position: V, radius: number, a: V, b: V) {
  const line = vsub(b, a),
    offset = vsub(a, position);
  let x = dot2(line, line),
    z = sub(dot2(offset, offset), mul(radius, radius));
  if (x === 0) return { hit: z <= 0, range: [0, 1] as CS2RoadRange };
  let y = dot2(offset, line);
  x = mul(x, 2);
  y = mul(y, 2);
  z = mul(z, 2);
  const discriminant = f(Math.sqrt(sub(mul(y, y), mul(x, z))));
  let lo = div(sub(-discriminant, y), x),
    hi = div(sub(discriminant, y), x);
  if (lo < 0) lo = 0;
  if (hi > 1) hi = 1;
  return { hit: lo <= hi, range: [lo, hi] as CS2RoadRange };
}
export function cs2CircleRoadIntersection(
  position: V,
  radius: number,
  quad: readonly [V, V, V, V],
) {
  position = flat(position);
  radius = f(radius);
  const range = invalidRange(),
    cb: CS2RoadBounds = {
      min: { x: sub(position.x, radius), y: 0, z: sub(position.z, radius) },
      max: { x: add(position.x, radius), y: 0, z: add(position.z, radius) },
    },
    qb = bounds([quad[0], quad[1], quad[2], quad[3]]);
  if (!intersectBounds(cb, qb)) return { hit: false, range };
  const triangles: readonly (readonly [V, V, V])[] = [
    [quad[0], quad[2], quad[3]],
    [quad[3], quad[1], quad[0]],
  ];
  for (const [i, tri] of triangles.entries()) {
    const t = triangle(...tri, position);
    if (t.hit) {
      const sum = add(t.x, t.y),
        dx = div(mul(radius, t.x), mul(distance(tri[0], tri[1], true), sum)),
        dy = div(mul(radius, t.y), mul(distance(tri[0], tri[2], true), sum)),
        loX = max(0, sub(t.x, dx)),
        hiX = min(1, add(t.x, dx)),
        hiY = min(1, add(t.y, dy));
      if (i === 0) {
        union(range, add(loX, hiY));
        union(range, add(hiX, hiY));
      } else {
        union(range, sub(sub(1, loX), hiY));
        union(range, sub(sub(1, hiX), hiY));
      }
    }
  }
  const lines: readonly (readonly [V, V])[] = [
    [quad[0], quad[1]],
    [quad[2], quad[3]],
    [quad[0], quad[2]],
    [quad[1], quad[3]],
  ];
  for (const [i, line] of lines.entries()) {
    const r = circleLine(position, radius, ...line);
    if (r.hit) union(range, i < 2 ? i : r.range);
  }
  return { hit: range[0] <= range[1], range };
}
function divideCurve(
  curve: CS2RoadCurve,
  t: number,
): [CS2RoadCurve, CS2RoadCurve] {
  const middle = vlerp(curve[1], curve[2], t),
    left = vlerp(curve[0], curve[1], t),
    right = vlerp(curve[2], curve[3], t),
    a = vlerp(left, middle, t),
    b = vlerp(middle, right, t),
    end = vlerp(a, b, t);
  return [
    [v(curve[0]), left, a, end],
    [{ ...end }, b, right, v(curve[3])],
  ];
}
export function cs2CollectRoadCourses(
  world: CS2RoadIntersectionWorld,
  chunks: readonly CS2RoadCourseChunk[],
) {
  const courses: CS2RoadIntersectionCourse[] = [],
    deletedEntities = new Map<string, boolean>();
  for (const chunk of chunks)
    for (let i = 0; i < chunk.entities.length; i++) {
      const creation = chunk.creation[i],
        course = chunk.courses[i];
      if (!creation || !course)
        throw new Error(
          "Missing required source CreationDefinition/NetCourse chunk element",
        );
      if (creation.original !== null) {
        if (deletedEntities.has(creation.original))
          throw new Error(
            `Duplicate source original definition: ${creation.original}`,
          );
        deletedEntities.set(creation.original, !!(creation.flags & 4));
      } else if (
        creation.prefab !== null &&
        world.prefabGeometry.has(creation.prefab)
      ) {
        courses.push({
          entity: chunk.entities[i],
          creation: structuredClone(creation),
          course: structuredClone(course),
          owner: structuredClone(chunk.owners?.[i] ?? emptyOwner()),
          upgraded: structuredClone(chunk.upgraded?.[i] ?? emptyFlags()),
        });
      }
    }
  return { courses, deletedEntities };
}
export function cs2FindRoadCourseOverlaps(
  world: CS2RoadIntersectionWorld,
  courses: readonly CS2RoadIntersectionCourse[],
  tree: readonly CS2RoadOverlapTreeNode[],
) {
  const overlaps: CS2RoadOverlap[] = [];
  for (const [courseIndex, entry] of courses.entries()) {
    const course = entry.course;
    if (course.start.flags & course.end.flags & 0x1000) continue;
    let range = mul(
      need(world.prefabGeometry, entry.creation.prefab, "NetGeometryData")
        .defaultWidth,
      0.5,
    );
    for (const aux of entry.creation.prefab === null
      ? []
      : (world.auxiliaryNets.get(entry.creation.prefab) ?? [])) {
      const data =
        aux.prefab === null ? undefined : world.prefabGeometry.get(aux.prefab);
      range = max(
        range,
        add(Math.abs(f(aux.position.x)), mul(data?.defaultWidth ?? 0, 0.5)),
      );
    }
    const sizeLimit = mul(range, 4),
      initial = divideCurve(course.curve, 0.5);
    type Data = {
      curves: [CS2RoadCurve, CS2RoadCurve];
      bounds: [CS2RoadBounds, CS2RoadBounds];
    };
    const visit = (node: CS2RoadOverlapTreeNode, input: Data) => {
      let data: Data = { curves: input.curves, bounds: input.bounds };
      let hit = [
        intersectBounds(node.bounds, data.bounds[0]),
        intersectBounds(node.bounds, data.bounds[1]),
      ];
      if (!hit.some(Boolean)) return;
      if (!hit.every(Boolean))
        while (
          sub(data.bounds[0].max.x, data.bounds[0].min.x) > sizeLimit ||
          sub(data.bounds[0].max.z, data.bounds[0].min.z) > sizeLimit
        ) {
          const curves = divideCurve(data.curves[hit[0] ? 0 : 1], 0.5);
          data = {
            curves,
            bounds: [bounds(curves[0], range), bounds(curves[1], range)],
          };
          hit = [
            intersectBounds(node.bounds, data.bounds[0]),
            intersectBounds(node.bounds, data.bounds[1]),
          ];
          if (!hit.some(Boolean)) return;
          if (hit.every(Boolean)) break;
        }
      if (node.children !== undefined) {
        for (const child of node.children) visit(child, data);
      } else if (
        (intersectBounds(node.bounds, data.bounds[0]) ||
          intersectBounds(node.bounds, data.bounds[1])) &&
        (node.entity == null || !world.deleted.has(node.entity))
      )
        overlaps.push({ entity: node.entity ?? null, courseIndex });
    };
    const data: Data = {
      curves: initial,
      bounds: [bounds(initial[0], range), bounds(initial[1], range)],
    };
    for (const root of tree) visit(root, data);
  }
  return overlaps;
}
export function cs2GetRoadAuxiliaryDefinition(
  creation: CS2RoadCreationDefinition,
  aux: CS2RoadAuxiliaryNet,
): CS2RoadCreationDefinition {
  return {
    prefab: aux.prefab,
    subPrefab: null,
    original: null,
    owner: null,
    attached: null,
    flags: creation.flags,
    randomSeed: creation.randomSeed,
  };
}
export function cs2GetRoadAuxiliaryCourse(
  input: CS2RoadCourse,
  aux: CS2RoadAuxiliaryNet,
  invert = false,
) {
  const course = structuredClone(input);
  course.start.flags |= 8;
  course.end.flags |= 8;
  course.fixedIndex = -1;
  if (f(aux.position.x) !== 0) {
    if ((course.start.flags & 3) === 3) return { success: false, course };
    course.curve = cs2CutRoadCourseCurve(course.curve, [
      course.start.courseDelta,
      course.end.courseDelta,
    ]);
    course.curve = cs2OffsetRoadCurveLeftSmooth(course.curve, [
      -f(aux.position.x),
      -f(aux.position.x),
    ]);
    course.length = cs2RoadCurveLength(course.curve);
    course.start.courseDelta = 0;
    course.end.courseDelta = 1;
    course.start.position.x = add(
      course.start.position.x,
      mul(aux.position.x, 0.01),
    );
    course.end.position.x = add(
      course.end.position.x,
      mul(aux.position.x, 0.01),
    );
  }
  if (f(aux.position.z) !== 0) {
    const t: CS2RoadRange = [course.start.courseDelta, course.end.courseDelta],
      amount = Math.abs(f(aux.position.z)),
      nextLength = sub(course.length, mul(amount, 2));
    if (
      !(nextLength > max(0.9, sub(amount, 0.5))) ||
      !clampLength(course.curve, t, sub(course.length, amount), true) ||
      !clampLength(course.curve, t, nextLength, true, true)
    )
      return { success: false, course };
    course.curve = cs2CutRoadCourseCurve(course.curve, t);
    course.length = nextLength;
    course.start.courseDelta = 0;
    course.end.courseDelta = 1;
  }
  if (f(aux.position.y) !== 0) {
    course.curve = course.curve.map((p) => ({
      ...p,
      y: add(p.y, aux.position.y),
    })) as unknown as CS2RoadCurve;
    course.start.position.y = add(course.start.position.y, aux.position.y);
    course.end.position.y = add(course.end.position.y, aux.position.y);
  }
  if (invert) {
    course.curve = [...course.curve].reverse() as unknown as CS2RoadCurve;
    [course.start, course.end] = [course.end, course.start];
    const angle = mul(f(Math.PI), 0.5),
      qy = f(Math.sin(angle)),
      qw = f(Math.cos(angle));
    for (const p of [course.start, course.end]) {
      const q = p.rotation;
      p.rotation = {
        x: add(mul(qw, q.x), mul(qy, q.z)),
        y: add(mul(qw, q.y), mul(qy, q.w)),
        z: sub(mul(qw, q.z), mul(qy, q.x)),
        w: sub(mul(qw, q.w), mul(qy, q.y)),
      };
      p.courseDelta = sub(1, p.courseDelta);
    }
  }
  return { success: true, course };
}
type Slot = { value: CS2RoadIntersectPos };
const slot = (): Slot => ({ value: unsetIntersect() });
const overlapPositions = (a: CS2RoadIntersectPos, b: CS2RoadIntersectPos) =>
  intersectRange(a.courseIntersection, b.courseIntersection) ||
  intersectRange(a.edgeIntersection, b.edgeIntersection);
const curveLerp = (a: CS2RoadCurve, b: CS2RoadCurve, t: number) =>
  a.map((p, i) => vlerp(p, b[i], t)) as unknown as CS2RoadCurve;
const heightRange = (
  curve: CS2RoadCurve,
  t: number,
  height: readonly [number, number],
): CS2RoadRange => {
  const y = cs2RoadCurvePosition(curve, t).y;
  return [add(y, height[0]), add(y, height[1])];
};
const segmentHeight = (
  segment: CS2RoadGeometrySegment,
  t: number,
  height: readonly [number, number],
) =>
  union(
    heightRange(segment.left, t, height),
    heightRange(segment.right, t, height),
  );
function merge(target: CS2RoadIntersectPos, input: CS2RoadIntersectPos) {
  const other = structuredClone(input);
  if (
    target.isNode &&
    other.isNode &&
    target.coursePos.entity !== other.coursePos.entity
  )
    return false;
  if (target.isNode && !other.isNode) {
    other.coursePos.entity = target.coursePos.entity;
    other.isNode = true;
  } else if (!target.isNode && other.isNode) {
    target.coursePos.entity = other.coursePos.entity;
    target.isNode = true;
  }
  for (const [side, height, edgeHeight] of [
    [0, "intersectionHeightMin", "edgeHeightRangeMin"],
    [1, "intersectionHeightMax", "edgeHeightRangeMax"],
  ] as const) {
    if (
      side === 0
        ? other.courseIntersection[side] < target.courseIntersection[side]
        : other.courseIntersection[side] > target.courseIntersection[side]
    ) {
      target.courseIntersection[side] = other.courseIntersection[side];
      target[height] = other[height];
      target[edgeHeight] = other[edgeHeight];
    } else if (
      other.courseIntersection[side] === target.courseIntersection[side]
    ) {
      union(target[height], other[height]);
      union(target[edgeHeight], other[edgeHeight]);
    }
  }
  union(target.edgeIntersection, other.edgeIntersection);
  target.isTunnel &&= other.isTunnel;
  target.isWaterway ||= other.isWaterway;
  if (other.priority < target.priority) {
    target.coursePos = other.coursePos;
    target.priority = other.priority;
  }
  return true;
}
class IntersectionKernel {
  readonly intersections: CS2RoadIntersectPos[] = [];
  readonly missingGeometry: {
    entity: string | null;
    courseIndex: number;
    component: "EdgeGeometry";
  }[] = [];
  constructor(
    readonly world: CS2RoadIntersectionWorld,
    readonly courses: readonly CS2RoadIntersectionCourse[],
    readonly deleted: ReadonlyMap<string, boolean>,
  ) {}
  enqueue(value: CS2RoadIntersectPos) {
    this.intersections.push(structuredClone(value));
  }
  add(current: Slot, other: CS2RoadIntersectPos) {
    if (current.value.priority !== -1) {
      if (
        !overlapPositions(current.value, other) ||
        !merge(current.value, other)
      ) {
        this.enqueue(current.value);
        current.value = structuredClone(other);
      }
    } else current.value = structuredClone(other);
  }
  execute(overlap: CS2RoadOverlap) {
    const w = this.world,
      id = overlap.entity;
    if (id === null || !w.edgeGeometry.has(id)) {
      this.missingGeometry.push({
        entity: id,
        courseIndex: overlap.courseIndex,
        component: "EdgeGeometry",
      });
      return;
    }
    let entity: string | null = id;
    const seen = new Set<string>();
    while (
      entity !== null &&
      w.owners.has(entity) &&
      !w.buildings.has(entity)
    ) {
      if (seen.has(entity))
        throw new Error(`Cyclic source Owner chain: ${entity}`);
      seen.add(entity);
      entity = w.owners.get(entity)!;
      if (entity !== null && w.deleted.has(entity)) return;
    }
    const prefab = need(w.prefabRefs, entity, "PrefabRef"),
      object = prefab === null ? undefined : w.prefabObjectGeometry.get(prefab);
    if (object && (object.flags & 18) === 18) return;
    const course = this.courses[overlap.courseIndex];
    if (!course)
      throw new Error(`Missing source Course index: ${overlap.courseIndex}`);
    this.checkCourse(overlap, course, course, -1);
    for (const [i, aux] of (course.creation.prefab === null
      ? []
      : (w.auxiliaryNets.get(course.creation.prefab) ?? [])
    ).entries()) {
      const next = cs2GetRoadAuxiliaryCourse(course.course, aux);
      if (next.success)
        this.checkCourse(
          overlap,
          course,
          {
            ...course,
            creation: cs2GetRoadAuxiliaryDefinition(course.creation, aux),
            course: next.course,
          },
          i,
        );
    }
  }
  orphan(node: string | null) {
    for (const id of need(this.world.connectedEdges, node, "ConnectedEdge")) {
      const edge = need(this.world.edges, id, "Edge");
      if ((edge.start === node || edge.end === node) && !this.deleted.get(id))
        return false;
    }
    return true;
  }
  checkCourse(
    overlap: CS2RoadOverlap,
    main: CS2RoadIntersectionCourse,
    entry: CS2RoadIntersectionCourse,
    auxIndex: number,
  ) {
    const w = this.world,
      id = overlap.entity!,
      edge = need(w.edges, id, "Edge"),
      active = [true, true, true];
    if (this.deleted.get(id)) {
      active[0] = !this.orphan(edge.start);
      active[1] = false;
      active[2] = !this.orphan(edge.end);
      if (!active[0] && !active[2]) return;
    }
    const curve = need(w.curves, id, "Curve"),
      composition = need(w.compositions, id, "Composition"),
      geometry = need(w.edgeGeometry, id, "EdgeGeometry"),
      startGeometry = need(w.startNodeGeometry, id, "StartNodeGeometry"),
      endGeometry = need(w.endNodeGeometry, id, "EndNodeGeometry"),
      data = need(w.prefabGeometry, entry.creation.prefab, "NetGeometryData");
    const raw = f(
        Math.ceil(
          mul(
            f(
              Math.log(
                div(mul(entry.course.length, 16), data.edgeLengthRange[1]),
              ),
            ),
            1.442695,
          ),
        ),
      ),
      integer =
        Number.isFinite(raw) && raw >= -2147483648 && raw <= 2147483647
          ? raw
          : -2147483648;
    const iterations =
        f(entry.course.length) < mul(data.defaultWidth, 0.01)
          ? 0
          : max(4, integer),
      offset: CS2RoadRange = [
        f(entry.course.start.courseDelta),
        f(entry.course.end.courseDelta),
      ],
      start = slot(),
      end = slot(),
      current = slot();
    const prefab = need(w.prefabRefs, id, "PrefabRef"),
      otherData = need(w.prefabGeometry, prefab, "NetGeometryData"),
      edgeComp = structuredClone(
        need(w.prefabComposition, composition.edge, "NetCompositionData"),
      ),
      startComp = structuredClone(
        need(w.prefabComposition, composition.startNode, "NetCompositionData"),
      ),
      endComp = structuredClone(
        need(w.prefabComposition, composition.endNode, "NetCompositionData"),
      );
    if (prefab !== null && w.auxiliaryNets.has(prefab)) {
      const net = need(w.prefabNet, entry.creation.prefab, "NetData");
      if (
        !(need(w.prefabNet, prefab, "NetData").connectLayers & 0x100) ||
        !(net.requiredLayers & 0x100)
      )
        for (const c of [edgeComp, startComp, endComp])
          c.heightRange = otherData.defaultHeightRange;
    }
    let isWaterway = false;
    if (!(data.mergeLayers & otherData.mergeLayers)) {
      const a = need(w.prefabNet, entry.creation.prefab, "NetData"),
        b = need(w.prefabNet, prefab, "NetData");
      const owner = w.owners.get(id),
        ownerPrefab =
          owner === null || owner === undefined
            ? undefined
            : w.prefabRefs.get(owner),
        ownerNet =
          ownerPrefab === null || ownerPrefab === undefined
            ? undefined
            : w.prefabNet.get(ownerPrefab);
      if (
        !canConnect(a, b) &&
        (((data.flags | otherData.flags) & 0x80000) !== 0 ||
          ((b.requiredLayers & 0x100) !== 0 &&
            auxIndex !== -1 &&
            (need(w.prefabNet, main.creation.prefab, "NetData").connectLayers &
              0x100) !==
              0) ||
          ((a.requiredLayers & 0x100) !== 0 &&
            !!ownerNet &&
            (ownerNet.connectLayers & 0x100) !== 0))
      )
        return;
      isWaterway = !(a.requiredLayers & 0x100) && !!(b.requiredLayers & 0x100);
    }
    if (otherData.mergeLayers === 0 || !active[1]) {
      if (active[0])
        this.nodeCircle(
          entry.course,
          overlap.courseIndex,
          auxIndex,
          start,
          data,
          startComp,
          edge.start,
          curve[0],
          offset,
          0,
        );
      if (active[2])
        this.nodeCircle(
          entry.course,
          overlap.courseIndex,
          auxIndex,
          end,
          data,
          endComp,
          edge.end,
          curve[3],
          offset,
          1,
        );
    } else {
      if (active[0])
        this.nodeGeometry(
          entry.course,
          overlap.courseIndex,
          auxIndex,
          start,
          data,
          startComp,
          edge.start,
          startGeometry,
          offset,
          0,
          iterations,
          isWaterway,
        );
      if (active[2])
        this.nodeGeometry(
          entry.course,
          overlap.courseIndex,
          auxIndex,
          end,
          data,
          endComp,
          edge.end,
          endGeometry,
          offset,
          1,
          iterations,
          isWaterway,
        );
    }
    if (active[1])
      this.edgeGeometry(
        entry.course,
        overlap.courseIndex,
        auxIndex,
        start,
        end,
        current,
        data,
        otherData,
        edgeComp,
        id,
        edge,
        geometry,
        curve,
        offset,
        iterations,
      );
    for (const value of [start.value, end.value, current.value])
      if (value.priority !== -1) this.enqueue(value);
  }
  edgeGeometry(
    course: CS2RoadCourse,
    index: number,
    aux: number,
    start: Slot,
    end: Slot,
    current: Slot,
    data: CS2RoadIntersectionGeometry,
    otherData: CS2RoadIntersectionGeometry,
    comp: CS2RoadIntersectionComposition,
    id: string,
    edge: { start: string | null; end: string | null },
    geometry: CS2RoadEdgeGeometry,
    curve: CS2RoadCurve,
    offset: CS2RoadRange,
    iterations: number,
  ) {
    if (
      !intersectBounds(
        bounds(
          cs2CutRoadCourseCurve(course.curve, offset),
          mul(data.defaultWidth, 0.5),
        ),
        geometry.bounds,
      )
    )
      return;
    if (iterations <= 0) {
      const last = slot();
      this.edgeSegment(
        course,
        index,
        aux,
        start,
        end,
        current,
        last,
        data,
        otherData,
        comp,
        id,
        edge,
        geometry.start,
        curve,
        offset,
        [0, 0.5],
      );
      this.edgeSegment(
        course,
        index,
        aux,
        start,
        end,
        current,
        last,
        data,
        otherData,
        comp,
        id,
        edge,
        geometry.end,
        curve,
        offset,
        [0.5, 1],
      );
      if (last.value.priority !== -1) this.add(current, last.value);
    } else {
      const middle = lerp(offset[0], offset[1], 0.5);
      this.edgeGeometry(
        course,
        index,
        aux,
        start,
        end,
        current,
        data,
        otherData,
        comp,
        id,
        edge,
        geometry,
        curve,
        [offset[0], middle],
        iterations - 1,
      );
      this.edgeGeometry(
        course,
        index,
        aux,
        start,
        end,
        current,
        data,
        otherData,
        comp,
        id,
        edge,
        geometry,
        curve,
        [middle, offset[1]],
        iterations - 1,
      );
    }
  }
  nodeGeometry(
    course: CS2RoadCourse,
    index: number,
    aux: number,
    result: Slot,
    data: CS2RoadIntersectionGeometry,
    comp: CS2RoadIntersectionComposition,
    node: string | null,
    geometry: CS2RoadNodeGeometry,
    offset: CS2RoadRange,
    edgeOffset: number,
    iterations: number,
    water: boolean,
  ) {
    if (
      !intersectBounds(
        bounds(
          cs2CutRoadCourseCurve(course.curve, offset),
          mul(data.defaultWidth, 0.5),
        ),
        geometry.bounds,
      )
    )
      return;
    if (iterations <= 0) {
      if (f(geometry.middleRadius) > 0) {
        const right = structuredClone(geometry.right),
          right2 = structuredClone(geometry.right);
        right.right = curveLerp(geometry.right.left, geometry.right.right, 0.5);
        right.right = [
          right.right[0],
          right.right[1],
          right.right[2],
          geometry.middle[3],
        ];
        right2.left = right.right;
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          geometry.left,
          offset,
          edgeOffset,
          0.5,
          water,
        );
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          right,
          offset,
          edgeOffset,
          1,
          water,
        );
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          right2,
          offset,
          edgeOffset,
          0,
          water,
        );
      } else {
        const left = structuredClone(geometry.left),
          right = structuredClone(geometry.right);
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          left,
          offset,
          edgeOffset,
          1,
          water,
        );
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          right,
          offset,
          edgeOffset,
          0,
          water,
        );
        left.right = geometry.middle;
        right.left = geometry.middle;
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          left,
          offset,
          edgeOffset,
          1,
          water,
        );
        this.nodeSegment(
          course,
          index,
          aux,
          result,
          data,
          comp,
          node,
          right,
          offset,
          edgeOffset,
          0,
          water,
        );
      }
    } else {
      const middle = lerp(offset[0], offset[1], 0.5);
      this.nodeGeometry(
        course,
        index,
        aux,
        result,
        data,
        comp,
        node,
        geometry,
        [offset[0], middle],
        edgeOffset,
        iterations - 1,
        water,
      );
      this.nodeGeometry(
        course,
        index,
        aux,
        result,
        data,
        comp,
        node,
        geometry,
        [middle, offset[1]],
        edgeOffset,
        iterations - 1,
        water,
      );
    }
  }
  nodeCircle(
    course: CS2RoadCourse,
    index: number,
    aux: number,
    result: Slot,
    data: CS2RoadIntersectionGeometry,
    comp: CS2RoadIntersectionComposition,
    node: string | null,
    nodePos: V,
    offset: CS2RoadRange,
    edgeOffset: number,
  ) {
    const curve = cutXZ(course.curve, offset),
      half = mul(data.defaultWidth, 0.5),
      radius = mul(comp.width, 0.5),
      nodeBounds: CS2RoadBounds = {
        min: { x: sub(nodePos.x, radius), y: 0, z: sub(nodePos.z, radius) },
        max: { x: add(nodePos.x, radius), y: 0, z: add(nodePos.z, radius) },
      };
    if (!intersectBounds(bounds(curve, half), nodeBounds)) return;
    const closest = curveDistance(curve, nodePos);
    if (closest.distance > add(half, radius)) return;
    const t = lerp(offset[0], offset[1], closest.t),
      position = cs2RoadCurvePosition(course.curve, t),
      intersection: CS2RoadRange = [
        lerp(offset[0], offset[1], sub(closest.t, 0.01)),
        lerp(offset[0], offset[1], add(closest.t, 0.01)),
      ];
    let extent = max(0, div(sub(closest.distance, half), radius));
    extent = mul(f(Math.sqrt(sub(1, mul(extent, extent)))), radius);
    if (intersection[1] < 1) {
      const r: CS2RoadRange = [intersection[1], 1];
      clampLength(course.curve, r, extent, false);
      intersection[1] = r[1];
    }
    if (intersection[0] > 0) {
      const r: CS2RoadRange = [0, intersection[0]];
      clampLength(course.curve, r, extent, false, true);
      intersection[0] = r[0];
    }
    const value = emptyIntersect();
    value.coursePos = {
      ...emptyPos(),
      entity: node,
      position,
      rotation: rotation(cs2RoadCurveTangent(course.curve, t)),
      courseDelta: t,
      splitPosition: edgeOffset,
      flags: (course.start.flags & 8248) | 128,
      parentMesh:
        node === null
          ? -1
          : (this.world.localTransforms.get(node)?.parentMesh ?? -1),
    };
    value.courseIntersection = intersection;
    value.intersectionHeightMin = [position.y, position.y];
    value.intersectionHeightMax = [position.y, position.y];
    value.edgeIntersection = [edgeOffset, edgeOffset];
    value.edgeHeightRangeMin = [
      add(nodePos.y, comp.heightRange[0]),
      add(nodePos.y, comp.heightRange[1]),
    ];
    value.edgeHeightRangeMax = [...value.edgeHeightRangeMin];
    value.priority = closest.distance;
    value.auxIndex = aux;
    value.courseIndex = index;
    value.isNode = true;
    value.isTunnel =
      !!(comp.flags.general & 0x20000) &&
      !((comp.flags.left | comp.flags.right) & 12);
    result.value = value;
  }
  *segmentHits(
    course: CS2RoadCourse,
    data: CS2RoadIntersectionGeometry,
    comp: CS2RoadIntersectionComposition,
    segment: CS2RoadGeometrySegment,
    offset: CS2RoadRange,
    center: number,
    nodeMode: boolean,
  ) {
    const half = mul(data.defaultWidth, 0.5),
      a = cs2RoadCurvePosition(course.curve, offset[0]),
      b = cs2RoadCurvePosition(course.curve, offset[1]),
      ta = normalize(cs2RoadCurveTangent(course.curve, offset[0])),
      tb = normalize(cs2RoadCurveTangent(course.curve, offset[1]));
    const side = (p: V, t: V, s: number): V => ({
        x: add(p.x, mul(mul(t.z, half), s)),
        y: 0,
        z: sub(p.z, mul(mul(t.x, half), s)),
      }),
      quad = [
        side(a, ta, -1),
        side(a, ta, 1),
        side(b, tb, -1),
        side(b, tb, 1),
      ] as const;
    let start = 0,
      left = segment.left[0],
      right = segment.right[0];
    for (let i = 1; i <= 8; i++) {
      const end = f(i / 8),
        nextLeft = cs2RoadCurvePosition(segment.left, end),
        nextRight = cs2RoadCurvePosition(segment.right, end),
        other = [left, right, nextLeft, nextRight] as const,
        hit = cs2QuadRoadIntersection(quad, other),
        courseRange = hit.first,
        segmentRange = hit.second;
      let found = hit.hit;
      if (nodeMode && found) {
        if ((comp.flags.general & 80) === 16) {
          const first = curveDistance(course.curve, segment.left[0]).t,
            last = curveDistance(course.curve, segment.right[0]).t;
          courseRange[0] = min(first, last);
          courseRange[1] = max(first, last);
          if (offset[0] === 0 && courseRange[0] <= f(0.01)) courseRange[0] = 0;
          if (offset[1] === 1 && courseRange[1] >= f(0.99)) courseRange[1] = 1;
        } else {
          courseRange[0] = lerp(
            offset[0],
            offset[1],
            sub(courseRange[0], 0.01),
          );
          courseRange[1] = lerp(
            offset[0],
            offset[1],
            add(courseRange[1], 0.01),
          );
        }
      }
      const centreStart = vlerp(left, right, center),
        centreEnd = vlerp(nextLeft, nextRight, center),
        da = segmentDistance(centreStart, centreEnd, a).distance,
        db = segmentDistance(centreStart, centreEnd, b).distance;
      if (offset[0] === 0 && da <= db) {
        const circle = cs2CircleRoadIntersection(a, half, other);
        if (circle.hit) {
          union(courseRange, 0);
          union(segmentRange, circle.range);
          found = true;
        }
      }
      if (offset[1] === 1 && da >= db) {
        const circle = cs2CircleRoadIntersection(b, half, other);
        if (circle.hit) {
          union(courseRange, 1);
          union(segmentRange, circle.range);
          found = true;
        }
      }
      if (found) {
        const nearest = lineDistance(a, b, centreStart, centreEnd),
          t = lerp(offset[0], offset[1], nearest.x),
          position = cs2RoadCurvePosition(course.curve, t);
        if (!nodeMode) {
          courseRange[0] = lerp(
            offset[0],
            offset[1],
            sub(courseRange[0], 0.01),
          );
          courseRange[1] = lerp(
            offset[0],
            offset[1],
            add(courseRange[1], 0.01),
          );
        }
        const sampleRange: CS2RoadRange = [
          lerp(start, end, sub(segmentRange[0], 0.01)),
          lerp(start, end, add(segmentRange[1], 0.01)),
        ];
        yield {
          courseRange,
          sampleRange,
          t,
          position,
          priority: nearest.distance,
        };
      }
      start = end;
      left = nextLeft;
      right = nextRight;
    }
  }
  edgeSegment(
    course: CS2RoadCourse,
    index: number,
    aux: number,
    start: Slot,
    end: Slot,
    current: Slot,
    last: Slot,
    data: CS2RoadIntersectionGeometry,
    otherData: CS2RoadIntersectionGeometry,
    comp: CS2RoadIntersectionComposition,
    id: string,
    edge: { start: string | null; end: string | null },
    segment: CS2RoadGeometrySegment,
    curve: CS2RoadCurve,
    offset: CS2RoadRange,
    edgeOffset: CS2RoadRange,
  ) {
    for (const hit of this.segmentHits(
      course,
      data,
      comp,
      segment,
      offset,
      0.5,
      false,
    )) {
      let split = curveDistance(curve, hit.position).t;
      if (otherData.flags & 4) {
        const dist = curveLengthRange(curve, [0, split], true),
          quotient = div(dist, 4),
          rounded = f(roundEven(quotient));
        const r: CS2RoadRange = [0, 1];
        if (clampLength(curve, r, mul(rounded, 4), true)) split = r[1];
      }
      const edgeRange: CS2RoadRange = [
        lerp(edgeOffset[0], edgeOffset[1], hit.sampleRange[0]),
        lerp(edgeOffset[0], edgeOffset[1], hit.sampleRange[1]),
      ];
      if (f(comp.nodeOffset) > 0) {
        if (edgeRange[0] > 0) {
          const r: CS2RoadRange = [0, edgeRange[0]];
          clampLength(curve, r, comp.nodeOffset, true, true);
          edgeRange[0] = r[0];
        }
        if (edgeRange[1] > 0) {
          const r: CS2RoadRange = [edgeRange[1], 1];
          clampLength(curve, r, comp.nodeOffset, true);
          edgeRange[1] = r[1];
        }
      }
      let parent = -1;
      const st =
          edge.start === null
            ? undefined
            : this.world.localTransforms.get(edge.start),
        en =
          edge.end === null
            ? undefined
            : this.world.localTransforms.get(edge.end);
      if (st && en && st.parentMesh === en.parentMesh) parent = st.parentMesh;
      const t0 = curveDistance(
          curve,
          cs2RoadCurvePosition(course.curve, hit.courseRange[0]),
        ).t,
        t1 = curveDistance(
          curve,
          cs2RoadCurvePosition(course.curve, hit.courseRange[1]),
        ).t;
      if (t1 < t0) hit.sampleRange.reverse();
      const value = emptyIntersect();
      value.coursePos = {
        ...emptyPos(),
        entity: id,
        position: hit.position,
        rotation: rotation(cs2RoadCurveTangent(course.curve, hit.t)),
        courseDelta: hit.t,
        splitPosition: split,
        flags: (course.start.flags & 8248) | 128,
        parentMesh: parent,
      };
      value.courseIntersection = hit.courseRange;
      const h0 = cs2RoadCurvePosition(curve, t0).y,
        h1 = cs2RoadCurvePosition(curve, t1).y;
      value.intersectionHeightMin = [h0, h0];
      value.intersectionHeightMax = [h1, h1];
      value.edgeIntersection = edgeRange;
      value.edgeHeightRangeMin = segmentHeight(
        segment,
        hit.sampleRange[0],
        comp.heightRange,
      );
      value.edgeHeightRangeMax = segmentHeight(
        segment,
        hit.sampleRange[1],
        comp.heightRange,
      );
      value.priority = hit.priority;
      value.courseIndex = index;
      value.auxIndex = aux;
      value.isTunnel = !!(comp.flags.general & 0x20000);
      if (edgeRange[0] <= 0) {
        value.coursePos.entity = edge.start;
        value.isNode = true;
      } else if (edgeRange[1] >= 1) {
        value.coursePos.entity = edge.end;
        value.isNode = true;
      }
      for (const endpoint of [start, end])
        if (
          endpoint.value.priority !== -1 &&
          overlapPositions(endpoint.value, value) &&
          merge(value, endpoint.value)
        )
          endpoint.value.priority = -1;
      if (last.value.priority !== -1) {
        if (!overlapPositions(last.value, value) || !merge(last.value, value)) {
          this.add(current, last.value);
          last.value = value;
        }
      } else last.value = value;
    }
  }
  nodeSegment(
    course: CS2RoadCourse,
    index: number,
    aux: number,
    current: Slot,
    data: CS2RoadIntersectionGeometry,
    comp: CS2RoadIntersectionComposition,
    node: string | null,
    segment: CS2RoadGeometrySegment,
    offset: CS2RoadRange,
    edgeOffset: number,
    center: number,
    water: boolean,
  ) {
    const target = slot();
    for (const hit of this.segmentHits(
      course,
      data,
      comp,
      segment,
      offset,
      center,
      true,
    )) {
      const curve = curveLerp(segment.left, segment.right, 0.5),
        t0 = curveDistance(
          curve,
          cs2RoadCurvePosition(course.curve, hit.courseRange[0]),
        ).t,
        t1 = curveDistance(
          curve,
          cs2RoadCurvePosition(course.curve, hit.courseRange[1]),
        ).t;
      if (t1 < t0) hit.sampleRange.reverse();
      const value = emptyIntersect();
      value.coursePos = {
        ...emptyPos(),
        entity: node,
        position: hit.position,
        rotation: rotation(cs2RoadCurveTangent(course.curve, hit.t)),
        courseDelta: hit.t,
        splitPosition: edgeOffset,
        flags: (course.start.flags & 8248) | 128,
        parentMesh:
          node === null
            ? -1
            : (this.world.localTransforms.get(node)?.parentMesh ?? -1),
      };
      value.courseIntersection = hit.courseRange;
      const h0 = cs2RoadCurvePosition(curve, t0).y,
        h1 = cs2RoadCurvePosition(curve, t1).y;
      value.intersectionHeightMin = [h0, h0];
      value.intersectionHeightMax = [h1, h1];
      value.edgeIntersection = [edgeOffset, edgeOffset];
      value.edgeHeightRangeMin = segmentHeight(
        segment,
        hit.sampleRange[0],
        comp.heightRange,
      );
      value.edgeHeightRangeMax = segmentHeight(
        segment,
        hit.sampleRange[1],
        comp.heightRange,
      );
      value.priority = hit.priority;
      value.courseIndex = index;
      value.auxIndex = aux;
      value.isNode = true;
      value.isTunnel =
        !!(comp.flags.general & 0x20000) &&
        !((comp.flags.left | comp.flags.right) & 12);
      value.isWaterway = water;
      if (target.value.priority !== -1) {
        if (
          !overlapPositions(target.value, value) ||
          !merge(target.value, value)
        ) {
          this.add(current, target.value);
          target.value = value;
        }
      } else target.value = value;
    }
    if (target.value.priority !== -1) this.add(current, target.value);
  }
}
/** Complete source CheckCourseIntersectionsJob. Height compatibility and commands belong to its downstream ResultsJob. */
export function cs2CheckRoadCourseIntersections(
  world: CS2RoadIntersectionWorld,
  courses: readonly CS2RoadIntersectionCourse[],
  overlaps: readonly CS2RoadOverlap[],
  deletedEntities: ReadonlyMap<string, boolean> = new Map(),
) {
  const job = new IntersectionKernel(world, courses, deletedEntities);
  for (const overlap of overlaps) job.execute(overlap);
  return {
    intersections: job.intersections,
    missingGeometry: job.missingGeometry,
  };
}

/** Additional prefab fields consumed by CourseHeightData and ResultsJob. */
export type CS2RoadHeightGeometry = CS2RoadIntersectionGeometry & {
  elevationLimit: number;
  maxSlopeSteepness: number;
  elevatedHeightRange: readonly [number, number];
  elevatedLength: number;
  hanging: number;
};
export type CS2RoadTerrainSample = {
  terrainHeight: number;
  waterHeight: number;
  waterDepth: number;
};
export type CS2RoadTerrainReader = {
  sampleHeight: (position: V) => CS2RoadTerrainSample;
  terrainHeight: (position: V) => number;
  waterDepth: (position: V) => number;
};
export type CS2RoadCourseHeightItem = {
  terrainHeight: number;
  terrainBuildHeight: number;
  waterHeight: number;
  courseHeight: number;
  distanceOffset: number;
  limitRange: CS2RoadRange;
  limitDistance: CS2RoadRange;
  forceElevated: boolean;
};
const rangeLerp = (
  a: readonly [number, number],
  b: readonly [number, number],
  t: number,
): CS2RoadRange => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const rangeExpand = (r: readonly [number, number], n: number): CS2RoadRange => [
  sub(r[0], n),
  add(r[1], n),
];
const straightHanging = (a: V, b: V, hanging: number): CS2RoadCurve => {
  const curve: CS2RoadCurve = [
      v(a),
      vlerp(a, b, f(1 / 3)),
      vlerp(a, b, f(2 / 3)),
      v(b),
    ],
    offset = mul(mul(distance(a, b, true), hanging), 1.3333334);
  return [
    curve[0],
    { ...curve[1], y: sub(curve[1].y, offset) },
    { ...curve[2], y: sub(curve[2].y, offset) },
    curve[3],
  ];
};
/** Entire original CourseHeightData state machine, with an explicit terrain/water reader. */
export class CS2RoadCourseHeightData {
  readonly samples: CS2RoadCourseHeightItem[] = [];
  readonly sampleRange: CS2RoadRange;
  readonly sampleFactor: number;
  constructor(
    input: CS2RoadCourse,
    readonly geometry: CS2RoadHeightGeometry,
    sampleTerrain: boolean,
    terrain?: CS2RoadTerrainReader,
  ) {
    const course = structuredClone(input);
    this.sampleRange = [f(course.start.courseDelta), f(course.end.courseDelta)];
    const curve = cs2CutRoadCourseCurve(course.curve, this.sampleRange),
      count = 1 + Math.ceil(div(curveLengthRange(curve, [0, 1], true), 4));
    this.sampleFactor =
      this.sampleRange[1] > this.sampleRange[0]
        ? div(count - 1, sub(this.sampleRange[1], this.sampleRange[0]))
        : 0;
    let previous = course.start.position,
      total = 0;
    const step = div(1, max(1, count - 1)),
      maxElevation = max(
        f(course.start.elevation[0]),
        f(course.end.elevation[0]),
      );
    if (sampleTerrain && !terrain)
      throw new Error(
        "Missing source TerrainHeightData/WaterSurfaceData reader",
      );
    for (let i = 0; i < count; i++) {
      const position =
          i === 0
            ? course.start.position
            : i === count - 1
              ? course.end.position
              : cs2RoadCurvePosition(curve, mul(i, step)),
        elevation =
          i === 0
            ? course.start.elevation[0]
            : i === count - 1
              ? course.end.elevation[0]
              : lerp(
                  course.start.elevation[0],
                  course.end.elevation[0],
                  mul(i, step),
                );
      const item: CS2RoadCourseHeightItem = {
        terrainHeight: 0,
        terrainBuildHeight: 0,
        waterHeight: 0,
        courseHeight: 0,
        distanceOffset: distance(previous, position, true),
        limitRange: [-1000000, 1000000],
        limitDistance: [1000000, 1000000],
        forceElevated: false,
      };
      if (sampleTerrain) {
        const sample = terrain!.sampleHeight(v(position));
        item.terrainHeight = f(sample.terrainHeight);
        item.terrainBuildHeight =
          maxElevation < f(-1)
            ? add(item.terrainHeight, maxElevation)
            : item.terrainHeight;
        item.waterHeight =
          f(sample.waterDepth) < f(0.2)
            ? item.terrainHeight
            : add(sample.waterHeight, mul(geometry.elevationLimit, 2));
      } else {
        item.terrainHeight = sub(position.y, elevation);
        item.terrainBuildHeight =
          maxElevation < f(-1)
            ? add(item.terrainHeight, maxElevation)
            : item.terrainHeight;
        item.waterHeight = -1000000;
        item.courseHeight = f(position.y);
      }
      this.samples.push(item);
      previous = position;
      total = add(total, item.distanceOffset);
    }
    if (!sampleTerrain) return;
    this.initializeCoursePos(course.start);
    this.initializeCoursePos(course.end);
    const start: CS2RoadRange = [-1000000, 1000000],
      end: CS2RoadRange = [-1000000, 1000000],
      limit = f(geometry.elevationLimit),
      slope = f(geometry.maxSlopeSteepness);
    if (
      f(course.start.elevation[0]) >= limit ||
      f(course.end.elevation[0]) >= limit ||
      geometry.flags & 0x200
    ) {
      start[0] = course.start.position.y;
      end[0] = course.end.position.y;
    } else {
      if (f(course.start.elevation[0]) > 1) {
        start[0] = course.start.position.y;
        end[0] = max(
          end[0],
          sub(course.end.position.y, mul(mul(total, slope), 0.5)),
        );
      }
      if (f(course.end.elevation[0]) > 1) {
        start[0] = max(
          start[0],
          sub(course.start.position.y, mul(mul(total, slope), 0.5)),
        );
        end[0] = course.end.position.y;
      }
    }
    if (
      f(course.start.elevation[0]) <= -limit ||
      f(course.end.elevation[0]) <= -limit
    ) {
      start[1] = course.start.position.y;
      end[1] = course.end.position.y;
    } else {
      if (f(course.start.elevation[0]) < -1) {
        start[1] = course.start.position.y;
        end[1] = min(
          end[1],
          add(course.end.position.y, mul(mul(total, slope), 0.5)),
        );
      }
      if (f(course.end.elevation[0]) < -1) {
        start[1] = min(
          start[1],
          add(course.start.position.y, mul(mul(total, slope), 0.5)),
        );
        end[1] = course.end.position.y;
      }
    }
    let height = -1000000,
      offset = 0;
    for (let i = 0; i < count; i++) {
      const item = this.samples[i];
      let range: CS2RoadRange;
      if (i === 0) range = start;
      else if (i === count - 1) range = end;
      else {
        offset = add(offset, item.distanceOffset);
        range = rangeLerp(start, end, div(offset, total));
      }
      height = sub(height, mul(item.distanceOffset, slope));
      item.courseHeight =
        maxElevation < -1
          ? item.terrainBuildHeight
          : max(item.terrainHeight, item.waterHeight);
      item.courseHeight = max(clamp(item.courseHeight, ...range), height);
      height = item.courseHeight;
    }
    height = -1000000;
    for (let i = count - 1; i >= 0; i--) {
      const item = this.samples[i];
      item.courseHeight = max(item.courseHeight, height);
      height = sub(item.courseHeight, mul(item.distanceOffset, slope));
    }
  }
  initializeCoursePos(pos: CS2RoadCoursePos) {
    if (!(pos.flags & 128)) return;
    let height: number;
    if (f(pos.courseDelta) === this.sampleRange[0]) {
      const item = this.samples[0];
      height =
        f(pos.elevation[0]) < -1
          ? item.terrainHeight
          : max(item.terrainHeight, item.waterHeight);
    } else if (f(pos.courseDelta) === this.sampleRange[1]) {
      const item = this.samples[this.samples.length - 1];
      height =
        f(pos.elevation[0]) < -1
          ? item.terrainHeight
          : max(item.terrainHeight, item.waterHeight);
    } else {
      const offset = mul(
          sub(pos.courseDelta, this.sampleRange[0]),
          this.sampleFactor,
        ),
        index = clamp(Math.floor(offset), 0, this.samples.length - 1),
        a = this.samples[index],
        b = this.samples[min(index + 1, this.samples.length - 1)],
        t = sat(sub(offset, index)),
        ground = lerp(a.terrainHeight, b.terrainHeight, t),
        water = lerp(a.waterHeight, b.waterHeight, t);
      height = f(pos.elevation[0]) < -1 ? ground : max(ground, water);
    }
    pos.position.y = add(height, pos.elevation[0]);
  }
  private addLimit(
    item: CS2RoadCourseHeightItem,
    input: readonly [number, number],
    distance: number,
  ) {
    let range: CS2RoadRange = [f(input[0]), f(input[1])];
    if (range[0] > item.limitRange[0]) {
      item.limitDistance[0] = distance;
      if (range[0] > item.limitRange[1]) {
        const t = item.limitDistance.every((x) => x === 0)
            ? f(0.5)
            : div(distance, add(item.limitDistance[0], item.limitDistance[1])),
          height = lerp(range[0], item.limitRange[1], t);
        range = [height, height];
      }
    } else range[0] = item.limitRange[0];
    if (range[1] < item.limitRange[1]) {
      item.limitDistance[1] = distance;
      if (range[1] < item.limitRange[0]) {
        const t = item.limitDistance.every((x) => x === 0)
            ? f(0.5)
            : div(distance, add(item.limitDistance[0], item.limitDistance[1])),
          height = lerp(range[1], item.limitRange[0], t);
        range = [height, height];
      }
    } else range[1] = item.limitRange[1];
    const changed = range.some((x, i) => x !== item.limitRange[i]);
    item.limitRange = range;
    return changed;
  }
  applyLimitRange(
    pos: CS2RoadIntersectPos,
    minRange: readonly [number, number],
    maxRange: readonly [number, number],
    shrink = false,
    forceElevated = false,
    geometry = this.geometry,
  ) {
    const offset = pos.courseIntersection.map((t) =>
      mul(sub(t, this.sampleRange[0]), this.sampleFactor),
    );
    let start = max(shrink ? roundEven(offset[0]) : Math.floor(offset[0]), 0),
      end = min(
        shrink ? roundEven(offset[1]) : Math.ceil(offset[1]),
        this.samples.length - 1,
      );
    start = min(start, this.samples.length);
    end = max(end, -1);
    const step = div(1, max(1, end - start));
    for (let i = start; i <= end; i++) {
      const item = this.samples[i],
        range = rangeLerp(minRange, maxRange, mul(i - start, step)),
        changed = this.addLimit(item, range, 0);
      if (changed || (forceElevated && !item.forceElevated)) {
        item.courseHeight = clamp(item.courseHeight, ...item.limitRange);
        item.forceElevated ||= forceElevated;
      }
    }
    if (start > 0) {
      let dist =
        start < this.samples.length ? this.samples[start].distanceOffset : 0;
      for (let i = start - 1; i >= 0; i--) {
        const item = this.samples[i],
          range = rangeExpand(minRange, mul(dist, geometry.maxSlopeSteepness));
        if (!this.addLimit(item, range, dist)) break;
        item.courseHeight = clamp(item.courseHeight, ...item.limitRange);
        dist = add(dist, item.distanceOffset);
      }
    }
    if (end >= this.samples.length - 1) return;
    let dist = 0;
    for (let i = end + 1; i < this.samples.length; i++) {
      const item = this.samples[i];
      dist = add(dist, item.distanceOffset);
      if (
        !this.addLimit(
          item,
          rangeExpand(maxRange, mul(dist, geometry.maxSlopeSteepness)),
          dist,
        )
      )
        break;
      item.courseHeight = clamp(item.courseHeight, ...item.limitRange);
    }
  }
  straightenElevation(first: CS2RoadIntersectPos, last: CS2RoadIntersectPos) {
    const x = mul(
        sub(first.courseIntersection[1], this.sampleRange[0]),
        this.sampleFactor,
      ),
      y = mul(
        sub(last.courseIntersection[0], this.sampleRange[0]),
        this.sampleFactor,
      ),
      end = min(Math.ceil(y), this.samples.length - 1);
    let index = max(Math.floor(x), 0) + 1;
    while (index < end) {
      const item = this.samples[index];
      if (
        item.courseHeight !== item.terrainBuildHeight &&
        item.limitRange[0] < item.limitRange[1]
      ) {
        let dist = item.distanceOffset,
          i = index,
          lastItem = this.samples[i];
        for (; i < end; i++) {
          lastItem = this.samples[i + 1];
          dist = add(dist, lastItem.distanceOffset);
          if (
            lastItem.courseHeight === lastItem.terrainBuildHeight ||
            lastItem.limitRange[0] >= lastItem.limitRange[1]
          )
            break;
        }
        const firstItem = this.samples[index - 1];
        let offset = 0;
        for (let j = index; j <= i; j++) {
          const value = this.samples[j];
          offset = add(offset, value.distanceOffset);
          value.courseHeight = clamp(
            lerp(
              firstItem.courseHeight,
              lastItem.courseHeight,
              div(offset, dist),
            ),
            ...value.limitRange,
          );
        }
        index = i + 1;
      } else index++;
    }
  }
  sampleHeight(delta: number) {
    if (f(delta) === this.sampleRange[0])
      return {
        height: this.samples[0].courseHeight,
        forceElevated: this.samples[0].forceElevated,
      };
    if (f(delta) === this.sampleRange[1]) {
      const sample = this.samples[this.samples.length - 1];
      return {
        height: sample.courseHeight,
        forceElevated: sample.forceElevated,
      };
    }
    const offset = mul(sub(delta, this.sampleRange[0]), this.sampleFactor),
      index = clamp(Math.floor(offset), 0, this.samples.length - 1),
      a = this.samples[index],
      b = this.samples[min(index + 1, this.samples.length - 1)];
    return {
      height: lerp(a.courseHeight, b.courseHeight, sat(sub(offset, index))),
      forceElevated: a.forceElevated || b.forceElevated,
    };
  }
  sampleCourseHeight(input: CS2RoadCourse) {
    const course = structuredClone(input),
      g = this.geometry;
    for (const pos of [course.start, course.end]) {
      const sample = this.sampleHeight(pos.courseDelta);
      if (pos.flags & 128) pos.position.y = sample.height;
      if (sample.forceElevated) pos.flags |= 0x400;
    }
    const same =
      course.start.position.x === course.end.position.x &&
      course.start.position.y === course.end.position.y &&
      course.start.position.z === course.end.position.z;
    if (same) {
      const start =
        g.flags & 2
          ? v(course.start.position)
          : { ...course.curve[0], y: course.start.position.y };
      course.curve = [start, { ...start }, { ...start }, { ...start }];
    } else if (g.flags & 1) {
      const t0 = lerp(
          course.start.courseDelta,
          course.end.courseDelta,
          f(1 / 3),
        ),
        t1 = lerp(course.start.courseDelta, course.end.courseDelta, f(2 / 3));
      if (
        this.sampleHeight(t0).forceElevated ||
        this.sampleHeight(t1).forceElevated
      ) {
        course.start.flags |= 0x800;
        course.end.flags |= 0x800;
      }
      if (g.flags & 2)
        course.curve = straightHanging(
          course.start.position,
          course.end.position,
          g.hanging,
        );
      else {
        const a = cs2RoadCurvePosition(course.curve, course.start.courseDelta),
          b = cs2RoadCurvePosition(course.curve, course.end.courseDelta);
        a.y = course.start.position.y;
        b.y = course.end.position.y;
        course.curve = straightHanging(a, b, g.hanging);
      }
    } else {
      const t: CS2RoadRange = [
          course.start.courseDelta,
          course.end.courseDelta,
        ],
        t0 = lerp(t[0], t[1], f(1 / 3)),
        t1 = lerp(t[0], t[1], f(2 / 3)),
        cut = cs2CutRoadCourseCurve(course.curve, t),
        a =
          g.flags & 2
            ? v(course.start.position)
            : { ...cut[0], y: course.start.position.y },
        d =
          g.flags & 2
            ? v(course.end.position)
            : { ...cut[3], y: course.end.position.y },
        s0 = this.sampleHeight(t0),
        s1 = this.sampleHeight(t1),
        b = { ...cut[1], y: s0.height },
        c = { ...cut[2], y: s1.height };
      if (s0.forceElevated || s1.forceElevated) {
        course.start.flags |= 0x800;
        course.end.flags |= 0x800;
      }
      const curve: CS2RoadCurve = [a, b, c, d],
        h0 = sub(b.y, cs2RoadCurvePosition(curve, f(1 / 3)).y),
        h1 = sub(c.y, cs2RoadCurvePosition(curve, f(2 / 3)).y);
      b.y = add(b.y, sub(mul(h0, 3), mul(h1, 1.5)));
      c.y = add(c.y, sub(mul(h1, 3), mul(h0, 1.5)));
      course.curve = curve;
    }
    course.start.courseDelta = 0;
    course.end.courseDelta = 1;
    course.length = cs2RoadCurveLength(course.curve);
    return course;
  }
  getHeightRange(
    pos: CS2RoadIntersectPos,
    geometry: CS2RoadHeightGeometry,
    canUseElevated: boolean,
  ) {
    const x = mul(
        sub(pos.courseIntersection[0], this.sampleRange[0]),
        this.sampleFactor,
      ),
      y = mul(
        sub(pos.courseIntersection[1], this.sampleRange[0]),
        this.sampleFactor,
      ),
      start = max(Math.floor(x), 0),
      end = min(Math.ceil(y), this.samples.length - 1);
    let minimum: CS2RoadRange = [1000000, -1000000],
      maximum: CS2RoadRange = [1000000, -1000000],
      elevated = false;
    if (start < this.samples.length) {
      const a = this.samples[start],
        b = this.samples[min(start + 1, this.samples.length - 1)],
        height = lerp(a.courseHeight, b.courseHeight, sat(sub(x, start)));
      minimum = [height, height];
      elevated ||=
        a.courseHeight > a.terrainHeight || b.courseHeight > b.terrainHeight;
    }
    if (end >= 0) {
      const a = this.samples[max(end - 1, 0)],
        b = this.samples[end],
        height = lerp(a.courseHeight, b.courseHeight, sat(sub(y, end - 1)));
      maximum = [height, height];
      elevated ||=
        a.courseHeight > a.terrainHeight || b.courseHeight > b.terrainHeight;
    }
    const range = union([...minimum], maximum);
    for (let i = start + 1; i < end; i++) {
      const item = this.samples[i];
      if (item.courseHeight < range[0] || item.courseHeight > range[1]) {
        union(range, item.courseHeight);
        const t = div(sub(i, x), max(1, sub(y, x))),
          left = sat(sub(2, mul(2, t))),
          right = sat(mul(2, t));
        minimum[0] = sub(
          minimum[0],
          mul(max(0, sub(minimum[0], item.courseHeight)), left),
        );
        minimum[1] = add(
          minimum[1],
          mul(max(0, sub(item.courseHeight, minimum[1])), left),
        );
        maximum[0] = sub(
          maximum[0],
          mul(max(0, sub(maximum[0], item.courseHeight)), right),
        );
        maximum[1] = add(
          maximum[1],
          mul(max(0, sub(item.courseHeight, maximum[1])), right),
        );
      }
      elevated ||= item.courseHeight > item.terrainHeight;
    }
    const height =
      elevated && canUseElevated
        ? geometry.elevatedHeightRange
        : geometry.defaultHeightRange;
    minimum[0] = add(minimum[0], height[0]);
    minimum[1] = add(minimum[1], height[1]);
    maximum[0] = add(maximum[0], height[0]);
    maximum[1] = add(maximum[1], height[1]);
    return { minimum, maximum, elevated };
  }
}
export type CS2RoadFixedNetElement = {
  lengthRange: readonly [number, number];
  countRange: readonly [number, number];
  flags: number;
};
export type CS2RoadResultWorld = Omit<
  CS2RoadIntersectionWorld,
  "prefabGeometry"
> & {
  prefabGeometry: ReadonlyMap<string, CS2RoadHeightGeometry>;
  nodes: ReadonlyMap<string, V>;
  fixed: ReadonlySet<string>;
  elevations: ReadonlyMap<string, readonly [number, number]>;
  localCurves: ReadonlyMap<string, CS2RoadCurve>;
  transforms: ReadonlyMap<
    string,
    { position: V; rotation: CS2RoadCoursePos["rotation"] }
  >;
  serviceUpgrades: ReadonlySet<string>;
  prefabEnabled: ReadonlyMap<string, boolean>;
  prefabBuildingExtensions: ReadonlySet<string>;
  prefabServiceUpgrades: ReadonlySet<string>;
  prefabPlaceable: ReadonlyMap<
    string,
    { elevationRange: readonly [number, number]; placementFlags: number }
  >;
  fixedNetElements: ReadonlyMap<string, readonly CS2RoadFixedNetElement[]>;
  terrain?: CS2RoadTerrainReader;
};
export function createCS2RoadResultWorld(
  input: Partial<CS2RoadResultWorld> = {},
): CS2RoadResultWorld {
  return {
    ...createCS2RoadIntersectionWorld(),
    prefabGeometry: new Map(),
    nodes: new Map(),
    fixed: new Set(),
    elevations: new Map(),
    localCurves: new Map(),
    transforms: new Map(),
    serviceUpgrades: new Set(),
    prefabEnabled: new Map(),
    prefabBuildingExtensions: new Set(),
    prefabServiceUpgrades: new Set(),
    prefabPlaceable: new Map(),
    fixedNetElements: new Map(),
    ...input,
  };
}
export type CS2RoadSplitCommand = {
  jobIndex: number;
  entity: string | null;
  kind:
    | "create-entity"
    | "destroy-entity"
    | "set-component"
    | "add-component"
    | "remove-component";
  component?:
    | "CreationDefinition"
    | "NetCourse"
    | "LocalCurveCache"
    | "OwnerDefinition"
    | "Upgraded"
    | "Updated";
  value?: unknown;
};
type AuxEntity = { entity: string | null; splitPosition: number };
type ElevationSegment = {
  courseRange: CS2RoadRange;
  distanceOffset: CS2RoadRange;
  elevationType: CS2RoadRange;
  canRemove: boolean;
};
const equalsV = (a: V, b: V) =>
  f(a.x) === f(b.x) && f(a.y) === f(b.y) && f(a.z) === f(b.z);
const equalsQ = (
  a: CS2RoadCoursePos["rotation"],
  b: CS2RoadCoursePos["rotation"],
) => equalsV(a, b) && f(a.w) === f(b.w);
const shiftRange = (a: readonly [number, number], n: number): CS2RoadRange => [
  add(a[0], n),
  add(a[1], n),
];
class RoadResultsKernel {
  readonly commands: CS2RoadSplitCommand[] = [];
  private nextEntity = 0;
  constructor(
    readonly world: CS2RoadResultWorld,
    readonly deleted: ReadonlyMap<string, boolean>,
    readonly editorMode: boolean,
    readonly leftHandTraffic: boolean,
  ) {}
  terrain() {
    if (!this.world.terrain)
      throw new Error(
        "Missing source TerrainHeightData/WaterSurfaceData reader",
      );
    return this.world.terrain;
  }
  cmd(
    jobIndex: number,
    entity: string | null,
    kind: CS2RoadSplitCommand["kind"],
    component?: CS2RoadSplitCommand["component"],
    value?: unknown,
  ) {
    this.commands.push({
      jobIndex,
      entity,
      kind,
      ...(component === undefined ? {} : { component }),
      ...(value === undefined ? {} : { value: structuredClone(value) }),
    });
  }
  canConnect(
    creation: CS2RoadCreationDefinition,
    owner: CS2RoadCourseOwner,
    net: CS2RoadIntersectionNetData,
    isNode: boolean,
    canSplitOwned: boolean,
    entity: string | null,
  ) {
    const w = this.world;
    if (entity === null) return { canConnect: true, ignoreHeight: false };
    const prefab = need(w.prefabRefs, entity, "PrefabRef"),
      other = need(w.prefabNet, prefab, "NetData"),
      upgrade =
        !this.editorMode &&
        creation.prefab !== null &&
        w.prefabServiceUpgrades.has(creation.prefab),
      otherUpgrade =
        !this.editorMode &&
        prefab !== null &&
        w.prefabServiceUpgrades.has(prefab);
    const match = (target: string | null) => {
      if (creation.owner === target) return true;
      const t = target === null ? undefined : w.transforms.get(target),
        p = target === null ? undefined : w.prefabRefs.get(target);
      return (
        !!t &&
        p !== undefined &&
        equalsV(owner.position, t.position) &&
        equalsQ(owner.rotation, t.rotation) &&
        owner.prefab === p
      );
    };
    if (
      ((!canSplitOwned && !isNode) ||
        (!(net.requiredLayers & 0x6000) &&
          !!(other.requiredLayers & 0x6000) &&
          !!(creation.flags & 0x10000))) &&
      w.owners.has(entity)
    ) {
      if (!match(w.owners.get(entity)!))
        return { canConnect: false, ignoreHeight: false };
      if (
        !canSplitOwned &&
        !isNode &&
        upgrade &&
        !w.serviceUpgrades.has(entity)
      )
        return { canConnect: false, ignoreHeight: false };
    }
    if (!isNode && !need(w.prefabEnabled, prefab, "PrefabData enabled"))
      return { canConnect: false, ignoreHeight: false };
    if (!canConnect(net, other))
      return { canConnect: false, ignoreHeight: false };
    if (upgrade || otherUpgrade) {
      let root: string | null = entity;
      const visited = new Set<string>();
      while (root !== null && w.owners.has(root)) {
        if (visited.has(root))
          throw new Error(`Cyclic source Owner chain: ${root}`);
        visited.add(root);
        root = w.owners.get(root)!;
      }
      if (!match(root)) return { canConnect: false, ignoreHeight: false };
    }
    if ((net.requiredLayers ^ other.requiredLayers) & 0x100)
      return { canConnect: true, ignoreHeight: true };
    const elevation = w.elevations.get(entity),
      g = prefab === null ? undefined : w.prefabGeometry.get(prefab);
    if (
      (net.requiredLayers ^ other.requiredLayers) & 64 &&
      elevation &&
      g &&
      elevation.some((e) => Math.abs(f(e)) >= f(g.elevationLimit))
    )
      return { canConnect: false, ignoreHeight: false };
    return { canConnect: true, ignoreHeight: false };
  }
  isUnderOver(
    course: CS2RoadCourse,
    minimum: CS2RoadRange,
    maximum: CS2RoadRange,
    pos: CS2RoadIntersectPos,
    offset: number,
    adjust: boolean,
    under: boolean,
  ) {
    if (pos.isStartEnd) return false;
    const distance = under
      ? max(
          sub(minimum[1], pos.edgeHeightRangeMin[0]),
          sub(maximum[1], pos.edgeHeightRangeMax[0]),
        )
      : max(
          sub(pos.edgeHeightRangeMin[1], minimum[0]),
          sub(pos.edgeHeightRangeMax[1], maximum[0]),
        );
    if (distance <= 0) return true;
    if (!adjust) return false;
    const a = add(
        cs2RoadCurvePosition(course.curve, pos.courseIntersection[0]).y,
        offset,
      ),
      b = add(
        cs2RoadCurvePosition(course.curve, pos.courseIntersection[1]).y,
        offset,
      ),
      lo =
        pos.intersectionHeightMin[1] < pos.intersectionHeightMin[0]
          ? [pos.coursePos.position.y, pos.coursePos.position.y]
          : pos.intersectionHeightMin,
      hi =
        pos.intersectionHeightMax[1] < pos.intersectionHeightMax[0]
          ? [pos.coursePos.position.y, pos.coursePos.position.y]
          : pos.intersectionHeightMax;
    return under
      ? distance < sub(lo[0], a) && distance < sub(hi[0], b)
      : distance < sub(a, lo[1]) && distance < sub(b, hi[1]);
  }
  mergePositions(
    course: CS2RoadCourse,
    creation: CS2RoadCreationDefinition,
    owner: CS2RoadCourseOwner,
    net: CS2RoadIntersectionNetData,
    g: CS2RoadHeightGeometry,
    height: CS2RoadCourseHeightData,
    source: CS2RoadIntersectPos[],
    target: CS2RoadIntersectPos[],
    offset: number,
    adjust: boolean,
    connectWater: boolean,
    canSplit: boolean,
    splitOwned: boolean,
    hasSubNets: boolean,
  ) {
    let index = 0,
      endpointCount = 0;
    const limits = (value: CS2RoadIntersectPos) => {
      let canAdjust = adjust,
        useHeight = !hasSubNets;
      const prefab =
          value.coursePos.entity === null
            ? undefined
            : this.world.prefabRefs.get(value.coursePos.entity),
        other =
          prefab === null || prefab === undefined
            ? undefined
            : this.world.prefabNet.get(prefab);
      if (connectWater && other) {
        canAdjust &&= !(other.requiredLayers & 0x100);
        useHeight = !!(other.requiredLayers & 0x100);
      }
      const bounds = height.getHeightRange(value, g, useHeight);
      return {
        ...bounds,
        minimum: shiftRange(bounds.minimum, offset),
        maximum: shiftRange(bounds.maximum, offset),
        canAdjust,
        useHeight,
      };
    };
    const applyUnder = (
      value: CS2RoadIntersectPos,
      b: ReturnType<typeof limits>,
    ) => {
      if (b.canAdjust) {
        const n = add(
          add(
            offset,
            (b.useHeight && b.elevated
              ? g.elevatedHeightRange
              : g.defaultHeightRange)[1],
          ),
          0.5,
        );
        height.applyLimitRange(
          value,
          [-1000000, sub(value.edgeHeightRangeMin[0], n)],
          [-1000000, sub(value.edgeHeightRangeMax[0], n)],
          false,
          false,
          g,
        );
      }
    };
    while (index < source.length) {
      let value = structuredClone(source[index++]),
        b = limits(value);
      if (
        this.isUnderOver(
          course,
          b.minimum,
          b.maximum,
          value,
          offset,
          b.canAdjust,
          true,
        )
      ) {
        applyUnder(value, b);
        continue;
      }
      const notOver = !this.isUnderOver(
        course,
        b.minimum,
        b.maximum,
        value,
        offset,
        b.canAdjust,
        false,
      );
      let connection = notOver
          ? this.canConnect(
              creation,
              owner,
              net,
              value.isNode,
              splitOwned,
              value.coursePos.entity,
            )
          : { canConnect: false, ignoreHeight: false },
        can = connection.canConnect;
      let nextIndex = index;
      endpointCount += value.isStartEnd ? 1 : 0;
      while (index < source.length) {
        const next = structuredClone(source[index]),
          other = limits(next);
        b.elevated = other.elevated;
        let nextCan = can;
        if (
          this.isUnderOver(
            course,
            other.minimum,
            other.maximum,
            next,
            offset,
            other.canAdjust,
            true,
          )
        ) {
          applyUnder(next, other);
          if (index > nextIndex) {
            source.splice(index, 1);
            continue;
          }
          index++;
          nextIndex++;
          continue;
        }
        const intersection: CS2RoadRange = [
          max(next.courseIntersection[0], value.courseIntersection[0]),
          min(next.courseIntersection[1], value.courseIntersection[1]),
        ];
        if (
          (value.isStartEnd &&
            next.isStartEnd &&
            !(creation.flags & 0x10000) &&
            (value.coursePos.flags & next.coursePos.flags & 3) !== 3) ||
          intersection[0] > intersection[1]
        )
          break;
        if (next.coursePos.entity !== value.coursePos.entity) {
          const nextNotOver = !this.isUnderOver(
            course,
            other.minimum,
            other.maximum,
            next,
            offset,
            other.canAdjust,
            false,
          );
          if (notOver || nextNotOver) {
            const conn = nextNotOver
              ? this.canConnect(
                  creation,
                  owner,
                  net,
                  value.isNode || next.isNode,
                  splitOwned,
                  next.coursePos.entity,
                )
              : { canConnect: false, ignoreHeight: false };
            if (!can && conn.canConnect && next.isNode && !value.isNode)
              nextCan =
                notOver &&
                this.canConnect(
                  creation,
                  owner,
                  net,
                  true,
                  splitOwned,
                  value.coursePos.entity,
                ).canConnect;
            if (nextCan !== conn.canConnect) {
              index++;
              continue;
            }
            if (nextCan && intersection[0] > 0 && intersection[1] < 1) {
              index++;
              continue;
            }
          }
        }
        can = nextCan;
        if (value.isNode && !next.isNode) {
          next.coursePos.entity = value.coursePos.entity;
          next.isNode = true;
        } else if (!value.isNode && next.isNode) {
          value.coursePos.entity = next.coursePos.entity;
          value.isNode = true;
        }
        if (next.coursePos.entity === null) {
          next.coursePos.entity = value.coursePos.entity;
          next.coursePos.splitPosition = value.coursePos.splitPosition;
        } else if (value.coursePos.entity === null) {
          value.coursePos.entity = next.coursePos.entity;
          value.coursePos.splitPosition = next.coursePos.splitPosition;
        }
        for (const [side, h, e] of [
          [0, "intersectionHeightMin", "edgeHeightRangeMin"],
          [1, "intersectionHeightMax", "edgeHeightRangeMax"],
        ] as const) {
          if (
            side === 0
              ? next.courseIntersection[side] < value.courseIntersection[side]
              : next.courseIntersection[side] > value.courseIntersection[side]
          ) {
            value.courseIntersection[side] = next.courseIntersection[side];
            value[h] = next[h];
            value[e] = next[e];
          } else if (
            next.courseIntersection[side] === value.courseIntersection[side]
          ) {
            union(value[h], next[h]);
            union(value[e], next[e]);
          }
        }
        endpointCount += next.isStartEnd ? 1 : 0;
        value.isStartEnd ||= next.isStartEnd;
        union(value.edgeIntersection, next.edgeIntersection);
        value.isTunnel &&= next.isTunnel;
        value.isWaterway ||= next.isWaterway;
        const flags = value.coursePos.flags,
          otherFlags = next.coursePos.flags;
        value.coursePos.flags =
          ((flags | (otherFlags & 3)) & (otherFlags | 0xffffff7f)) >>> 0;
        next.coursePos.flags =
          ((otherFlags | (flags & 3)) & (flags | 0xffffff7f)) >>> 0;
        if (next.priority < value.priority) {
          value.coursePos = next.coursePos;
          value.priority = next.priority;
        }
        if (index > nextIndex) {
          source.splice(index, 1);
          continue;
        }
        index++;
        nextIndex++;
      }
      if (can) {
        if (!connection.ignoreHeight) {
          let lo = value.intersectionHeightMin,
            hi = value.intersectionHeightMax;
          if (lo[1] < lo[0])
            lo = [value.coursePos.position.y, value.coursePos.position.y];
          if (hi[1] < hi[0])
            hi = [value.coursePos.position.y, value.coursePos.position.y];
          if (
            value.isWaterway &&
            value.coursePos.entity !== null &&
            value.isNode
          ) {
            value.coursePos.position.y = need(
              this.world.nodes,
              value.coursePos.entity,
              "Node",
            ).y;
            lo = [value.coursePos.position.y, value.coursePos.position.y];
            hi = [...lo];
          }
          height.applyLimitRange(
            value,
            shiftRange(lo, -offset),
            shiftRange(hi, -offset),
            true,
            false,
            g,
          );
        }
      } else {
        value.coursePos.entity = null;
        b.elevated ||= !value.isTunnel;
        if (b.canAdjust) {
          const n = sub(
            add(
              offset,
              (b.useHeight && b.elevated
                ? g.elevatedHeightRange
                : g.defaultHeightRange)[0],
            ),
            0.5,
          );
          height.applyLimitRange(
            value,
            [sub(value.edgeHeightRangeMin[1], n), 1000000],
            [sub(value.edgeHeightRangeMax[1], n), 1000000],
            false,
            !value.isTunnel && !!(g.flags & 0x400000),
            g,
          );
        }
        if ((value.isTunnel || value.auxIndex !== -1) && !value.isStartEnd) {
          index = nextIndex;
          continue;
        }
        value.isOptional = !value.isStartEnd;
      }
      if (value.isStartEnd) target.push(value);
      else if (canSplit) {
        if (endpointCount >= 2) {
          if (target.length >= 2) target.splice(target.length - 1, 0, value);
        } else target.push(value);
      }
      index = nextIndex;
    }
  }
  mergeAux(
    course: CS2RoadCourse,
    source: CS2RoadIntersectPos[],
    target: CS2RoadIntersectPos[],
    nets: readonly CS2RoadAuxiliaryNet[],
    entities: AuxEntity[],
    auxCounter: { value: number },
  ) {
    if (target.length === 0) return;
    let index = 1,
      reference = target[0];
    for (let i = 0; i < source.length; i++) {
      const value = structuredClone(source[i]);
      if (value.coursePos.entity === null) continue;
      let use = false,
        insert = false;
      if (i === 0) use = true;
      else if (i === source.length - 1) {
        reference = target[target.length - 1];
        use = true;
      } else {
        while (
          reference.courseIntersection[1] < value.courseIntersection[0] &&
          index < target.length
        )
          reference = target[index++];
        if (
          intersectRange(value.courseIntersection, reference.courseIntersection)
        ) {
          use =
            index < target.length
              ? !intersectRange(
                  value.courseIntersection,
                  target[index].courseIntersection,
                )
              : true;
        } else if (index > 1) insert = true;
      }
      if (use) {
        if (reference.auxIndex === -1) reference.auxIndex = auxCounter.value++;
        const key = reference.auxIndex * nets.length + value.auxIndex;
        while (entities.length <= key)
          entities.push({ entity: null, splitPosition: 0 });
        if (entities[key].entity === null) {
          union(reference.courseIntersection, value.courseIntersection);
          reference.canMove = [0, 0];
          reference.isOptional = false;
          entities[key] = {
            entity: value.coursePos.entity,
            splitPosition: value.coursePos.splitPosition,
          };
        }
      } else if (insert) {
        const key = auxCounter.value * nets.length + value.auxIndex;
        while (entities.length <= key)
          entities.push({ entity: null, splitPosition: 0 });
        entities[key] = {
          entity: value.coursePos.entity,
          splitPosition: value.coursePos.splitPosition,
        };
        value.coursePos.position = cs2RoadCurvePosition(
          course.curve,
          value.coursePos.courseDelta,
        );
        value.coursePos.entity = null;
        value.coursePos.splitPosition = 0;
        value.auxIndex = auxCounter.value++;
        target.splice(index, 0, value);
        reference = target[index++];
      }
    }
  }
  elevationType(g: CS2RoadHeightGeometry, p: V) {
    const elevation = sub(p.y, this.terrain().terrainHeight(v(p))),
      limit = f(g.elevationLimit),
      half = mul(limit, 0.5),
      triple = mul(limit, 3);
    return (
      (elevation >= half ? 1 : 0) +
      (elevation >= limit ? 1 : 0) +
      (elevation <= -half ? -1 : 0) +
      (elevation <= -limit ? -1 : 0) +
      (elevation <= -triple ? -1 : 0)
    );
  }
  elevationRanges(
    course: CS2RoadCourse,
    g: CS2RoadHeightGeometry,
    height: CS2RoadCourseHeightData,
    range: CS2RoadRange,
    left: ElevationSegment[],
    right: ElevationSegment[],
  ) {
    const total = curveLengthRange(course.curve, range, true),
      half = mul(g.defaultWidth, 0.5),
      count = roundEven(div(total, 4));
    left.length = 0;
    right.length = 0;
    if (count < 1) return;
    let previous = cs2RoadCurvePosition(course.curve, range[0]),
      starts: CS2RoadRange = [range[0], range[0]],
      distances: CS2RoadRange = [0, 0],
      types: CS2RoadRange = [0, 0],
      removable = [true, true],
      lastT = range[0],
      offset = 0;
    const step = div(1, count);
    for (let i = 1; i <= count; i++) {
      const t = lerp(range[0], range[1], mul(i, step)),
        middleT = lerp(range[0], range[1], mul(sub(i, 0.5), step)),
        p = cs2RoadCurvePosition(course.curve, t),
        middle = cs2RoadCurvePosition(course.curve, middleT),
        sample = height.sampleHeight(middleT);
      middle.y = sample.height;
      const tangent = normalize(
          curveXZPosition(course.curve, middleT, true),
          true,
        ),
        side = { x: mul(tangent.z, half), y: 0, z: mul(-tangent.x, half) },
        next: CS2RoadRange = sample.forceElevated
          ? [2, 2]
          : [
              this.elevationType(g, vsub(middle, side)),
              this.elevationType(g, vadd(middle, side)),
            ],
        canRemove = !sample.forceElevated;
      if (i !== 1)
        for (const [sideIndex, list] of [
          [0, left],
          [1, right],
        ] as const)
          if (next[sideIndex] !== types[sideIndex]) {
            list.push({
              courseRange: [starts[sideIndex], lastT],
              distanceOffset: [distances[sideIndex], offset],
              elevationType: [types[sideIndex], types[sideIndex]],
              canRemove: removable[sideIndex],
            });
            removable[sideIndex] = true;
            starts[sideIndex] = lastT;
            distances[sideIndex] = offset;
          }
      lastT = t;
      offset = add(offset, distance(previous, p, true));
      types = next;
      removable = removable.map((r) => r && canRemove);
      previous = p;
    }
    for (const [i, list] of [
      [0, left],
      [1, right],
    ] as const)
      list.push({
        courseRange: [starts[i], lastT],
        distanceOffset: [distances[i], offset],
        elevationType: [types[i], types[i]],
        canRemove: removable[i],
      });
  }
  expandMajor(course: CS2RoadCourse, segments: ElevationSegment[]) {
    for (let i = 0; i < segments.length; i++) {
      const value = segments[i];
      if (
        !value.elevationType.every((x) => x === 1) &&
        !value.elevationType.every((x) => x === -1)
      )
        continue;
      const amount = min(
          8,
          mul(sub(value.distanceOffset[1], value.distanceOffset[0]), 0.5),
        ),
        type = value.elevationType[0] === -1 ? -2 : 2;
      if (i > 0) {
        const previous = segments[i - 1];
        if (previous.elevationType.every((x) => x === type)) {
          const t = [...value.courseRange] as CS2RoadRange;
          clampLength(course.curve, t, amount, true);
          value.courseRange[0] = t[1];
          value.distanceOffset[0] = add(value.distanceOffset[0], amount);
          previous.courseRange[1] = t[1];
          previous.distanceOffset[1] = add(previous.distanceOffset[1], amount);
        }
      }
      if (i < segments.length - 1) {
        const next = segments[i + 1];
        if (next.elevationType.every((x) => x === type)) {
          const t = [...value.courseRange] as CS2RoadRange;
          clampLength(course.curve, t, amount, true, true);
          value.courseRange[1] = t[0];
          value.distanceOffset[1] = sub(value.distanceOffset[1], amount);
          next.courseRange[0] = t[0];
          next.distanceOffset[0] = sub(next.distanceOffset[0], amount);
        }
      }
      value.elevationType = [0, 0];
    }
  }
  mergeSimilar(segments: ElevationSegment[]) {
    let i = 0,
      to = 0;
    while (i < segments.length) {
      const value = structuredClone(segments[i++]);
      for (; i < segments.length; i++) {
        const next = segments[i];
        if (next.elevationType.some((x, j) => x !== value.elevationType[j]))
          break;
        value.courseRange[1] = next.courseRange[1];
        value.distanceOffset[1] = next.distanceOffset[1];
        value.canRemove &&= next.canRemove;
      }
      segments[to++] = value;
    }
    if (to < i) segments.splice(to, i - to);
  }
  removeShort(g: CS2RoadHeightGeometry, segments: ElevationSegment[]) {
    for (let i = 0; i < segments.length; i++) {
      let value = segments[i],
        length = sub(value.distanceOffset[1], value.distanceOffset[0]);
      if (!(length < f(g.defaultWidth)) || !value.canRemove) continue;
      let index = i--;
      for (let j = index + 1; j < segments.length; j++) {
        const next = segments[j],
          n = sub(next.distanceOffset[1], next.distanceOffset[0]);
        if (n >= length || !next.canRemove) break;
        length = n;
        index = j;
      }
      value = segments[index];
      let previous: ElevationSegment = {
        courseRange: [0, 0],
        distanceOffset: [0, 0],
        elevationType: [-1000000, -1000000],
        canRemove: false,
      };
      if (index > 0) {
        previous = segments[index - 1];
        previous.courseRange[1] = mul(
          add(value.courseRange[0], value.courseRange[1]),
          0.5,
        );
        previous.distanceOffset[1] = mul(
          add(value.distanceOffset[0], value.distanceOffset[1]),
          0.5,
        );
      }
      if (index < segments.length - 1) {
        const next = segments[index + 1];
        if (
          next.elevationType.every((x, j) => x === previous.elevationType[j])
        ) {
          previous.courseRange[1] = next.courseRange[1];
          previous.distanceOffset[1] = next.distanceOffset[1];
          segments[index - 1] = previous;
          segments.splice(index + 1, 1);
        } else {
          next.courseRange[0] = mul(
            add(value.courseRange[0], value.courseRange[1]),
            0.5,
          );
          next.distanceOffset[0] = mul(
            add(value.distanceOffset[0], value.distanceOffset[1]),
            0.5,
          );
        }
      }
      segments.splice(index, 1);
    }
  }
  mergeSides(left: ElevationSegment[], right: ElevationSegment[]) {
    const length = right.length;
    right.push(...structuredClone(left));
    const all = right.length;
    let a = length,
      b = 0;
    left.length = 0;
    let value: ElevationSegment = {
      courseRange: [0, 0],
      distanceOffset: [0, 0],
      elevationType: [-1000000, -1000000],
      canRemove: false,
    };
    let removable = [true, true];
    while (true) {
      let first: ElevationSegment = {
          courseRange: [0, 0],
          distanceOffset: [0, 0],
          elevationType: [-1000000, -1000000],
          canRemove: false,
        },
        second = structuredClone(first);
      if (a < all && b < length) {
        const firstSource = right[a],
          secondSource = right[b];
        /* The recovered source compares the two default local ranges here. */ if (
          first.courseRange[0] <= second.courseRange[0]
        ) {
          first = firstSource;
          a++;
        } else {
          second = secondSource;
          b++;
        }
      } else if (a < all) first = right[a++];
      else {
        if (b >= length) break;
        second = right[b++];
      }
      if (first.elevationType[0] !== -1000000) {
        if (value.elevationType.every((x) => x !== -1000000)) {
          value.courseRange[1] = first.courseRange[0];
          value.distanceOffset[1] = first.distanceOffset[0];
          left.push(structuredClone(value));
          removable[0] = true;
        }
        value.courseRange = [...first.courseRange];
        value.distanceOffset = [...first.distanceOffset];
        value.elevationType[0] = first.elevationType[0];
        removable = removable.map((x) => x && first.canRemove);
      }
      if (second.elevationType[1] !== -1000000) {
        if (value.elevationType.every((x) => x !== -1000000)) {
          value.courseRange[1] = second.courseRange[0];
          value.distanceOffset[1] = second.distanceOffset[0];
          left.push(structuredClone(value));
          removable[1] = true;
        }
        value.courseRange = [...second.courseRange];
        value.distanceOffset = [...second.distanceOffset];
        value.elevationType[1] = second.elevationType[1];
        removable = removable.map((x) => x && second.canRemove);
      }
    }
    if (value.elevationType.every((x) => x !== -1000000))
      left.push(structuredClone(value));
  }
  checkHeight(
    course: CS2RoadCourse,
    g: CS2RoadHeightGeometry,
    place: { placementFlags: number },
    height: CS2RoadCourseHeightData,
    sampleTerrain: boolean,
    source: CS2RoadIntersectPos[],
    target: CS2RoadIntersectPos[],
  ) {
    let hasOptional = false;
    const left: ElevationSegment[] = [],
      right: ElevationSegment[] = [],
      maxSpan = mul(g.elevatedLength, 0.95);
    const position = (value: CS2RoadIntersectPos, t: number) => {
      value.coursePos.courseDelta = t;
      value.coursePos.position = cs2RoadCurvePosition(course.curve, t);
      value.coursePos.rotation = rotation(cs2RoadCurveTangent(course.curve, t));
    };
    const insertRequired = (value: CS2RoadIntersectPos) => {
      let index = target.length;
      for (let i = target.length - 1; i >= 0; i--) {
        const next = target[i];
        if (
          !next.isOptional ||
          next.coursePos.courseDelta <= value.coursePos.courseDelta
        )
          break;
        const d = curveLengthRange(
          course.curve,
          [value.coursePos.courseDelta, next.coursePos.courseDelta],
          true,
        );
        next.canMove[1] = max(next.canMove[1], sub(maxSpan, d));
        index = i;
      }
      target.splice(index, 0, structuredClone(value));
    };
    const insertOptional = (value: CS2RoadIntersectPos) => {
      let index = target.length;
      for (let i = target.length - 1; i >= 0; i--) {
        const next = target[i];
        if (
          next.isOptional ||
          next.isStartEnd ||
          next.coursePos.courseDelta <= value.coursePos.courseDelta
        )
          break;
        index = i;
      }
      if (index < target.length) {
        const d = curveLengthRange(
          course.curve,
          [value.coursePos.courseDelta, target[index].coursePos.courseDelta],
          true,
        );
        value.canMove[0] = min(value.canMove[0], sub(d, maxSpan));
      }
      target.splice(index, 0, structuredClone(value));
      hasOptional = true;
    };
    for (let i = 0; i < source.length; i++) {
      const value = structuredClone(source[i]);
      if (
        sampleTerrain &&
        i !== 0 &&
        !(g.flags & 0x200) &&
        !(place.placementFlags & 0x400)
      ) {
        const previous = source[i - 1];
        this.elevationRanges(
          course,
          g,
          height,
          [previous.courseIntersection[1], value.courseIntersection[0]],
          left,
          right,
        );
        this.expandMajor(course, left);
        this.expandMajor(course, right);
        this.mergeSimilar(left);
        this.mergeSimilar(right);
        this.removeShort(g, left);
        this.removeShort(g, right);
        this.mergeSides(left, right);
        this.removeShort(g, left);
        for (let j = 1; j < left.length; j++) {
          const a = left[j - 1],
            b = left[j],
            next = emptyIntersect();
          next.coursePos.courseDelta = b.courseRange[0];
          next.coursePos.flags = (value.coursePos.flags & 8248) | 128;
          next.coursePos.parentMesh =
            value.coursePos.parentMesh !== previous.coursePos.parentMesh
              ? -1
              : value.coursePos.parentMesh;
          position(next, next.coursePos.courseDelta);
          next.auxIndex = -1;
          if (b.elevationType[0] !== a.elevationType[0])
            next.coursePos.flags |= 256;
          if (b.elevationType[1] !== a.elevationType[1])
            next.coursePos.flags |= 512;
          if (hasOptional) insertRequired(next);
          else target.push(next);
        }
      }
      if (
        !value.isOptional &&
        (value.coursePos.entity === null ||
          !this.world.fixed.has(value.coursePos.entity))
      ) {
        if (hasOptional && !value.isStartEnd) insertRequired(value);
        else target.push(value);
        continue;
      }
      let half = mul(g.defaultWidth, 0.5);
      if (g.flags & 0x100000) {
        let distance = curveLengthRange(
          course.curve,
          value.courseIntersection,
          true,
        );
        const t = [...value.courseIntersection] as CS2RoadRange;
        clampLength(course.curve, t, mul(distance, 0.5), true);
        distance = add(distance, mul(half, 2));
        const move = max(0, mul(sub(maxSpan, distance), 0.5));
        value.coursePos.entity = null;
        position(value, min(1, t[1]));
        value.canMove = [-move, move];
        value.isOptional = true;
        value.auxIndex = -1;
        const before = curveLengthRange(
            course.curve,
            [0, value.coursePos.courseDelta],
            true,
          ),
          after = curveLengthRange(
            course.curve,
            [value.coursePos.courseDelta, 1],
            true,
          );
        if (min(before, after) > move) insertOptional(value);
        continue;
      }
      const before: CS2RoadRange = [0, value.courseIntersection[0]],
        after: CS2RoadRange = [value.courseIntersection[1], 1],
        distance = add(
          curveLengthRange(course.curve, value.courseIntersection, true),
          mul(half, 2),
        );
      let move = mul(sub(maxSpan, distance), 0.5);
      half = max(0, add(half, min(0, move)));
      move = max(0, move);
      clampLength(course.curve, before, half, true, true);
      clampLength(course.curve, after, half, true);
      value.coursePos.entity = null;
      position(value, max(0, before[0]));
      value.canMove = [-move, 0];
      value.isOptional = true;
      value.auxIndex = -1;
      if (
        curveLengthRange(course.curve, [value.coursePos.courseDelta, 1], true) >
        move
      )
        insertOptional(value);
      value.coursePos.entity = null;
      position(value, min(1, after[1]));
      value.canMove = [0, move];
      value.isOptional = true;
      value.auxIndex = -1;
      if (
        curveLengthRange(course.curve, [0, value.coursePos.courseDelta], true) >
        move
      ) {
        target.push(structuredClone(value));
        hasOptional = true;
      }
    }
    if (!hasOptional) return;
    source.length = 0;
    for (let i = 0; i < target.length; i++) {
      const value = structuredClone(target[i]);
      if (value.isOptional)
        for (; i + 1 < target.length; i++) {
          const next = target[i + 1];
          if (!next.isOptional) break;
          if (next.coursePos.courseDelta <= value.coursePos.courseDelta) {
            position(
              value,
              lerp(
                value.coursePos.courseDelta,
                next.coursePos.courseDelta,
                0.5,
              ),
            );
            value.canMove = [0, 0];
            continue;
          }
          const t: CS2RoadRange = [
              value.coursePos.courseDelta,
              next.coursePos.courseDelta,
            ],
            distance = curveLengthRange(course.curve, t, true);
          if (!(sub(value.canMove[1], next.canMove[0]) >= distance)) break;
          const move = min(
            value.canMove[1],
            max(mul(distance, 0.5), add(distance, next.canMove[0])),
          );
          clampLength(course.curve, t, move, true);
          position(value, t[1]);
          value.canMove[0] = min(
            0,
            max(
              sub(value.canMove[0], move),
              sub(add(next.canMove[0], distance), move),
            ),
          );
          value.canMove[1] = max(
            0,
            min(
              sub(add(next.canMove[1], distance), move),
              sub(value.canMove[1], move),
            ),
          );
        }
      source.push(value);
    }
    target.length = 0;
    for (let i = 1; i < source.length; i++)
      source[i - 1].priority = curveLengthRange(
        course.curve,
        [source[i - 1].coursePos.courseDelta, source[i].coursePos.courseDelta],
        true,
      );
    const optionalRange = (index: number) => {
      let end = index - 1;
      if (index !== 0)
        for (let i = index; i + 1 < source.length; i++) {
          if (source[i].isOptional) end = i;
          else break;
        }
      return end;
    };
    for (let i = 0; i < source.length; i++) {
      let end = optionalRange(i);
      if (end >= i) {
        const minIndex = i;
        i = end;
        while (true) {
          let best = minIndex,
            distance = f(g.elevatedLength);
          for (let j = minIndex; j <= end; j++) {
            const sum = add(source[j - 1].priority, source[j].priority);
            if (sum < distance) {
              best = j;
              distance = sum;
            }
          }
          if (distance > maxSpan) break;
          source[best - 1].priority = add(
            source[best - 1].priority,
            source[best].priority,
          );
          if (best === minIndex)
            target[target.length - 1].priority = add(
              target[target.length - 1].priority,
              source[best].priority,
            );
          for (let j = best; j < end; j++)
            source[j] = structuredClone(source[j + 1]);
          end--;
          if (end < minIndex) break;
        }
        for (let j = minIndex; j <= end; j++)
          target.push(structuredClone(source[j]));
      } else target.push(structuredClone(source[i]));
    }
    for (let i = 1; i + 1 < target.length; i++) {
      const value = target[i];
      if (!value.isOptional) continue;
      const previous = target[i - 1];
      value.canMove[0] = min(
        0,
        max(value.canMove[0], sub(value.priority, maxSpan)),
      );
      value.canMove[1] = max(
        0,
        min(value.canMove[1], sub(maxSpan, previous.priority)),
      );
      const move = clamp(
        mul(sub(value.priority, previous.priority), 0.5),
        ...value.canMove,
      );
      if (move === 0) continue;
      let t: CS2RoadRange;
      if (move > 0) {
        t = [value.coursePos.courseDelta, 1];
        clampLength(course.curve, t, move, true);
        value.coursePos.courseDelta = t[1];
        value.canMove[1] = max(0, sub(value.canMove[1], move));
      } else {
        t = [0, value.coursePos.courseDelta];
        clampLength(course.curve, t, -move, true, true);
        value.coursePos.courseDelta = t[0];
        value.canMove[0] = min(0, sub(value.canMove[0], move));
      }
      value.priority = sub(value.priority, move);
      position(value, value.coursePos.courseDelta);
      previous.priority = add(previous.priority, move);
    }
  }
  execute(
    entry: CS2RoadIntersectionCourse,
    index: number,
    intersections: readonly CS2RoadIntersectPos[],
  ) {
    const w = this.world,
      course = entry.course,
      creation = entry.creation,
      g = need(w.prefabGeometry, creation.prefab, "NetGeometryData"),
      net = need(w.prefabNet, creation.prefab, "NetData");
    const anchor = (pos: CS2RoadCoursePos) => {
      const value = emptyIntersect();
      value.coursePos = structuredClone(pos);
      value.courseIntersection = [f(pos.courseDelta), f(pos.courseDelta)];
      value.intersectionHeightMin = [MAX, -MAX];
      value.intersectionHeightMax = [MAX, -MAX];
      value.edgeIntersection = [f(pos.splitPosition), f(pos.splitPosition)];
      value.edgeHeightRangeMin = [1000000, -1000000];
      value.edgeHeightRangeMax = [1000000, -1000000];
      value.priority = -1;
      value.auxIndex = -1;
      value.isNode = pos.entity !== null && w.nodes.has(pos.entity);
      value.isStartEnd = true;
      return value;
    };
    const start = anchor(course.start),
      end = anchor(course.end),
      service =
        !this.editorMode &&
        !!(creation.flags & 0x10000) &&
        creation.prefab !== null &&
        w.prefabServiceUpgrades.has(creation.prefab),
      sampleTerrain =
        (creation.owner === null && entry.owner.prefab === null) || service,
      height = new CS2RoadCourseHeightData(course, g, sampleTerrain, w.terrain);
    if (sampleTerrain) {
      height.initializeCoursePos(start.coursePos);
      height.initializeCoursePos(end.coursePos);
    }
    height.applyLimitRange(
      start,
      [start.coursePos.position.y, start.coursePos.position.y],
      [start.coursePos.position.y, start.coursePos.position.y],
    );
    height.applyLimitRange(
      end,
      [end.coursePos.position.y, end.coursePos.position.y],
      [end.coursePos.position.y, end.coursePos.position.y],
    );
    height.straightenElevation(start, end);
    const extension =
        entry.owner.prefab !== null &&
        w.prefabBuildingExtensions.has(entry.owner.prefab),
      canSplit =
        extension ||
        (creation.owner === null && entry.owner.prefab === null) ||
        !!(creation.flags & 0x10000),
      aux =
        creation.prefab === null
          ? undefined
          : w.auxiliaryNets.get(creation.prefab),
      source = [
        structuredClone(start),
        ...intersections
          .filter((p) => p.courseIndex === index && p.auxIndex === -1)
          .map((p) => structuredClone(p)),
        structuredClone(end),
      ],
      target: CS2RoadIntersectPos[] = [],
      auxSource = intersections.filter(
        (p) => p.courseIndex === index && p.auxIndex !== -1,
      ),
      auxEntities: AuxEntity[] = [],
      auxCounter = { value: 0 };
    const sort = (list: CS2RoadIntersectPos[]) => {
      if (list.length >= 4) {
        const middle = list.splice(1, list.length - 2);
        cs2NativeSort(middle, (a, b) => {
          const delta = sub(a.courseIntersection[0], b.courseIntersection[0]);
          return (delta > 0 ? 1 : 0) - (delta < 0 ? 1 : 0);
        });
        list.splice(1, 0, ...middle);
      }
    };
    sort(source);
    let connectWater = !!(net.connectLayers & 0x100);
    if (!connectWater && aux)
      for (const a of aux)
        if (need(w.prefabNet, a.prefab, "NetData").requiredLayers & 0x100) {
          connectWater = true;
          break;
        }
    this.mergePositions(
      course,
      creation,
      entry.owner,
      net,
      g,
      height,
      source,
      target,
      0,
      sampleTerrain && !(net.requiredLayers & 0x100),
      connectWater,
      canSplit,
      extension,
      !!aux?.length,
    );
    if (aux) {
      start.coursePos.entity = null;
      start.isNode = false;
      end.coursePos.entity = null;
      end.isNode = false;
      for (const [i, a] of aux.entries()) {
        const aNet = need(w.prefabNet, a.prefab, "NetData"),
          aGeometry = need(w.prefabGeometry, a.prefab, "NetGeometryData");
        source.length = 0;
        start.coursePos.position.y = add(course.start.position.y, a.position.y);
        start.auxIndex = i;
        end.coursePos.position.y = add(course.end.position.y, a.position.y);
        end.auxIndex = i;
        source.push(
          structuredClone(start),
          ...auxSource
            .filter((p) => p.auxIndex === i)
            .map((p) => structuredClone(p)),
          structuredClone(end),
        );
        sort(source);
        const auxTarget: CS2RoadIntersectPos[] = [];
        this.mergePositions(
          course,
          { ...creation, prefab: a.prefab },
          entry.owner,
          aNet,
          aGeometry,
          height,
          source,
          auxTarget,
          a.position.y,
          sampleTerrain && !(aNet.requiredLayers & 0x100),
          connectWater,
          canSplit,
          extension,
          false,
        );
        this.mergeAux(course, auxTarget, target, aux, auxEntities, auxCounter);
      }
    }
    height.straightenElevation(start, end);
    source.length = 0;
    if (creation.prefab !== null && w.fixedNetElements.has(creation.prefab)) {
      source.push(structuredClone(target[0]));
      if (target.length >= 2)
        source.push(structuredClone(target[target.length - 1]));
    } else {
      const place =
        creation.prefab === null
          ? undefined
          : w.prefabPlaceable.get(creation.prefab);
      this.checkHeight(
        course,
        g,
        place ?? { placementFlags: 0 },
        height,
        sampleTerrain,
        target,
        source,
      );
      if (g.flags & 4) this.snapPositions(course, source);
    }
    const minDistance = g.flags & 4 ? 36 : 1;
    if (
      source.length >= 3 &&
      source[1].isOptional &&
      dot2(
        vsub(source[0].coursePos.position, source[1].coursePos.position),
        vsub(source[0].coursePos.position, source[1].coursePos.position),
      ) < minDistance
    )
      source.splice(1, 1);
    if (source.length >= 3) {
      const a = source[source.length - 1],
        b = source[source.length - 2],
        delta = vsub(a.coursePos.position, b.coursePos.position);
      if (b.isOptional && dot2(delta, delta) < minDistance)
        source.splice(source.length - 2, 1);
    }
    this.updateCourses(entry, index, source, auxEntities, height);
  }
  snapPositions(course: CS2RoadCourse, list: CS2RoadIntersectPos[]) {
    for (let i = 1; i < list.length - 1; i++) {
      const previous = list[i - 1],
        value = list[i],
        next = list[i + 1],
        distance = mul(
          roundEven(
            div(
              curveLengthRange(
                course.curve,
                [previous.coursePos.courseDelta, value.coursePos.courseDelta],
                true,
              ),
              4,
            ),
          ),
          4,
        ),
        t: CS2RoadRange = [
          previous.coursePos.courseDelta,
          next.coursePos.courseDelta,
        ];
      clampLength(course.curve, t, distance, true);
      value.coursePos.courseDelta = t[1];
      if (
        !!(roundEven(div(distance, 4)) & 1) !== !!(previous.coursePos.flags & 4)
      )
        value.coursePos.flags |= 4;
      else value.coursePos.flags &= ~4;
    }
  }
  updateCourses(
    entry: CS2RoadIntersectionCourse,
    index: number,
    list: CS2RoadIntersectPos[],
    auxEntities: AuxEntity[],
    height: CS2RoadCourseHeightData,
  ) {
    let course = structuredClone(entry.course);
    const count = { value: 0 };
    if (list.length) {
      course.start = structuredClone(list[0].coursePos);
      let aux: CS2RoadRange = [list[0].auxIndex, -1],
        added = 0;
      for (let i = 1; i < list.length; i++) {
        course.end = structuredClone(list[i].coursePos);
        aux[1] = list[i].auxIndex;
        if (
          course.end.entity === null ||
          course.end.entity !== course.start.entity
        ) {
          this.tryAdd(course, entry, index, auxEntities, aux, height, count);
          added++;
        }
        course.start = structuredClone(course.end);
        aux[0] = aux[1];
      }
      if (added === 0) {
        course.start = structuredClone(list[0].coursePos);
        course.end = structuredClone(list[list.length - 1].coursePos);
        this.tryAdd(
          course,
          entry,
          index,
          auxEntities,
          [list[0].auxIndex, list[list.length - 1].auxIndex],
          height,
          count,
        );
      }
    }
    if (count.value === 0) this.cmd(index, entry.entity, "destroy-entity");
  }
  cutCourse(
    course: CS2RoadCourse,
    g: CS2RoadHeightGeometry,
    cutLength: number,
  ) {
    const result = emptyPos();
    if (g.flags & 4) {
      cutLength = mul(roundEven(div(add(cutLength, 0.16), 4)), 4);
      if (!!(roundEven(div(cutLength, 4)) & 1) !== !!(course.start.flags & 4))
        result.flags |= 4;
    }
    const t: CS2RoadRange = [course.start.courseDelta, 1];
    clampLength(course.curve, t, cutLength, true);
    result.courseDelta = t[1];
    result.position = cs2RoadCurvePosition(course.curve, t[1]);
    result.rotation = rotation(cs2RoadCurveTangent(course.curve, t[1]));
    result.flags |= (course.start.flags & 10296) | 128;
    result.parentMesh =
      course.start.parentMesh !== course.end.parentMesh
        ? -1
        : course.start.parentMesh;
    if (course.start.flags & 0x800) result.flags |= 0x400;
    return result;
  }
  middleTangent(curve: CS2RoadCurve, range: CS2RoadRange) {
    const mid = lerp(...range, 0.5);
    let position = mid;
    const a = normalize(curveXZPosition(curve, range[0], true), true),
      b = normalize(curveXZPosition(curve, range[1], true), true);
    if (dot2(a, a) === 0 || dot2(b, b) === 0) return mid;
    const t = [...range] as CS2RoadRange;
    for (let i = 0; i < 24; i++) {
      const n = normalize(curveXZPosition(curve, position, true), true);
      if (dot2(n, n) === 0) break;
      const da = vsub(a, n),
        db = vsub(b, n),
        first = dot2(da, da),
        last = dot2(db, db);
      if (first < last) t[0] = position;
      else if (first > last) t[1] = position;
      else break;
      position = lerp(...t, 0.5);
    }
    return lerp(position, mid, sat(add(0.5, mul(dot2(a, b), 0.5))));
  }
  tryAdd(
    input: CS2RoadCourse,
    entry: CS2RoadIntersectionCourse,
    index: number,
    auxEntities: AuxEntity[],
    aux: CS2RoadRange,
    height: CS2RoadCourseHeightData,
    count: { value: number },
  ) {
    const course = structuredClone(input),
      g = need(
        this.world.prefabGeometry,
        entry.creation.prefab,
        "NetGeometryData",
      ),
      a = normalize(
        flat(cs2RoadCurveTangent(course.curve, course.start.courseDelta)),
        true,
      ),
      b = normalize(
        flat(cs2RoadCurveTangent(course.curve, course.end.courseDelta)),
        true,
      );
    if (
      entry.creation.original !== null ||
      entry.creation.prefab === null ||
      dot2(a, a) === 0 ||
      dot2(b, b) === 0
    ) {
      this.addWithElevation(
        height.sampleCourseHeight(course),
        entry,
        index,
        auxEntities,
        aux,
        count,
      );
      return;
    }
    if (dot2(a, b) < f(-0.001) && !(g.flags & 0x800000)) {
      const delta = this.middleTangent(course.curve, [
          course.start.courseDelta,
          course.end.courseDelta,
        ]),
        pos = {
          ...emptyPos(),
          courseDelta: delta,
          position: cs2RoadCurvePosition(course.curve, delta),
          rotation: rotation(cs2RoadCurveTangent(course.curve, delta)),
          flags: (course.start.flags & 8248) | 128,
          parentMesh:
            course.start.parentMesh !== course.end.parentMesh
              ? -1
              : course.start.parentMesh,
        },
        first = structuredClone(course),
        last = structuredClone(course);
      first.end = structuredClone(pos);
      last.start = pos;
      first.length = curveLengthRange(
        first.curve,
        [first.start.courseDelta, first.end.courseDelta],
        false,
      );
      last.length = curveLengthRange(
        last.curve,
        [last.start.courseDelta, last.end.courseDelta],
        false,
      );
      this.tryAddPhase2(
        first,
        entry,
        index,
        auxEntities,
        [aux[0], -1],
        height,
        count,
      );
      this.tryAddPhase2(
        last,
        entry,
        index,
        auxEntities,
        [-1, aux[1]],
        height,
        count,
      );
    } else
      this.tryAddPhase2(course, entry, index, auxEntities, aux, height, count);
  }
  tryAddPhase2(
    input: CS2RoadCourse,
    entry: CS2RoadIntersectionCourse,
    index: number,
    auxEntities: AuxEntity[],
    aux: CS2RoadRange,
    height: CS2RoadCourseHeightData,
    count: { value: number },
  ) {
    const course = structuredClone(input),
      w = this.world,
      g = need(w.prefabGeometry, entry.creation.prefab, "NetGeometryData"),
      total = curveLengthRange(
        course.curve,
        [course.start.courseDelta, course.end.courseDelta],
        true,
      ),
      fixed =
        entry.creation.prefab === null
          ? undefined
          : w.fixedNetElements.get(entry.creation.prefab);
    if (fixed) {
      let minLength = 0,
        maxLength = 0,
        stretch = 0;
      const metrics = fixed.map((element) => {
        const minimum = mul(
            element.lengthRange[0],
            element.countRange[0] === 0 ? 0 : element.countRange[0],
          ),
          maximum = mul(
            element.lengthRange[1],
            element.countRange[1] === 0 ? 10000 : element.countRange[1],
          ),
          flex =
            element.lengthRange[1] !== element.lengthRange[0]
              ? sub(maximum, minimum)
              : 0;
        minLength = add(minLength, minimum);
        maxLength = add(maxLength, maximum);
        stretch = add(stretch, flex);
        return { minimum, maximum, flex };
      });
      const ratios = [
        div(sub(total, 0.16), max(1, minLength)),
        div(sub(total, 0.16), max(1, maxLength)),
      ];
      let segments: number;
      if (g.flags & 0x800000) segments = int32(Math.ceil(ratios[1]));
      else {
        const a = normalize(
            flat(cs2RoadCurveTangent(course.curve, course.start.courseDelta)),
            true,
          ),
          b = normalize(
            flat(cs2RoadCurveTangent(course.curve, course.end.courseDelta)),
            true,
          ),
          angle = f(Math.acos(clamp(dot2(a, b), -1, 1))),
          minimum = f(Math.ceil(ratios[1])),
          maximum = max(minimum, f(Math.floor(ratios[0])));
        segments = int32(
          roundEven(lerp(minimum, maximum, sat(mul(angle, f(2 / Math.PI))))),
        );
      }
      let current = structuredClone(course),
        currentAux = [...aux] as CS2RoadRange;
      for (let j = 1; j <= segments; j++) {
        if (j === segments) {
          current.end = structuredClone(course.end);
          currentAux[1] = aux[1];
        } else {
          current.end = this.cutCourse(course, g, div(mul(total, j), segments));
          currentAux[1] = -1;
        }
        let part = structuredClone(current);
        if (g.flags & 1) part = height.sampleCourseHeight(part);
        else
          part.length = curveLengthRange(
            part.curve,
            [part.start.courseDelta, part.end.courseDelta],
            true,
          );
        let remaining = sub(part.length, minLength),
          positive = max(0, remaining),
          offset = 0;
        remaining = sub(remaining, positive);
        const parts: CS2RoadCourse[] = [];
        let value = structuredClone(part);
        for (const k of fixed.keys()) {
          const metric = metrics[k];
          value.length = add(
            metric.minimum,
            div(mul(metric.flex, positive), max(1, stretch)),
          );
          value.length = add(
            value.length,
            div(mul(metric.minimum, remaining), max(1, minLength)),
          );
          value.fixedIndex = k;
          if (k === fixed.length - 1) value.end = structuredClone(part.end);
          else {
            value.end = this.cutCourse(part, g, add(offset, value.length));
            value.end.flags |= 64;
            offset = add(offset, value.length);
          }
          parts.push(structuredClone(value));
          value.start = structuredClone(value.end);
        }
        if (!(g.flags & 1)) {
          let first = 0,
            last = fixed.length - 1,
            a = v(part.start.position),
            d = v(part.end.position),
            ta = cs2RoadCurveTangent(part.curve, part.start.courseDelta),
            td = cs2RoadCurveTangent(part.curve, part.end.courseDelta);
          const normalizeXZ = (p: V) => {
            const square = dot2(p, p);
            return square > MIN_NORMAL
              ? vmul(p, div(1, f(Math.sqrt(square))))
              : { x: 0, y: 0, z: 0 };
          };
          ta = normalizeXZ(ta);
          td = normalizeXZ(td);
          const setXZ = (
            value: CS2RoadCourse,
            curve: CS2RoadCurve,
            startTangent: V,
            endTangent: V,
          ) => {
            value.curve = value.curve.map((p, i) => ({
              ...p,
              x: curve[i].x,
              z: curve[i].z,
            })) as unknown as CS2RoadCurve;
            value.start.courseDelta = 0;
            value.start.position = v(value.curve[0]);
            value.start.rotation = rotation(startTangent);
            value.end.courseDelta = 1;
            value.end.position = v(value.curve[3]);
            value.end.rotation = rotation(endTangent);
          };
          for (let k = 0; k < fixed.length && fixed[k].flags & 1; k++) {
            value = parts[k];
            setXZ(
              value,
              straightHanging(a, vadd(a, vmul(ta, value.length)), 0),
              ta,
              ta,
            );
            a = v(value.end.position);
            first++;
          }
          let k = fixed.length - 1;
          while (k >= 0 && fixed[k].flags & 1) {
            value = parts[k];
            setXZ(
              value,
              straightHanging(vsub(d, vmul(td, value.length)), vadd(d, ta), 0),
              vmul(td, -1),
              vmul(td, -1),
            );
            d = v(value.start.position);
            last--;
            k--;
          }
          if (last >= first) {
            const curve = cs2FitRoadCurve(a, ta, td, d),
              from = parts[first].start.courseDelta,
              to = parts[last].end.courseDelta;
            for (let k = first; k <= last; k++) {
              value = parts[k];
              const range: CS2RoadRange = [
                  div(
                    sub(value.start.courseDelta, from),
                    max(0.001, sub(to, from)),
                  ),
                  div(
                    sub(value.end.courseDelta, from),
                    max(0.001, sub(to, from)),
                  ),
                ],
                cut = cs2CutRoadCourseCurve(curve, range);
              setXZ(value, cut, vsub(cut[1], cut[0]), vsub(cut[3], cut[2]));
            }
          }
        }
        for (const [k, element] of fixed.entries()) {
          value = parts[k];
          const amount = clamp(
            int32(
              Math.ceil(div(sub(value.length, 0.16), element.lengthRange[1])),
            ),
            element.countRange[0] === 0 ? 0 : element.countRange[0],
            element.countRange[1] === 0 ? 10000 : element.countRange[1],
          );
          let section = structuredClone(value);
          for (let n = 1; n <= amount; n++) {
            if (n === amount) section.end = structuredClone(value.end);
            else {
              section.end = this.cutCourse(
                value,
                g,
                div(mul(value.length, n), amount),
              );
              section.end.flags |= 64;
            }
            const selectedAux: CS2RoadRange = [
              k === 0 && n === 1 ? currentAux[0] : -1,
              k === fixed.length - 1 && n === amount ? currentAux[1] : -1,
            ];
            if (!(g.flags & 1))
              this.addWithElevation(
                height.sampleCourseHeight(section),
                entry,
                index,
                auxEntities,
                selectedAux,
                count,
              );
            else {
              section.length = curveLengthRange(
                section.curve,
                [section.start.courseDelta, section.end.courseDelta],
                true,
              );
              this.addWithElevation(
                section,
                entry,
                index,
                auxEntities,
                selectedAux,
                count,
              );
            }
            section.start = structuredClone(section.end);
          }
        }
        current.start = structuredClone(current.end);
        currentAux[0] = currentAux[1];
      }
      return;
    }
    let sampled = height.sampleCourseHeight(course),
      calculated = this.calculateElevation(
        entry.creation,
        entry.owner,
        sampled,
        entry.upgraded,
        g,
      );
    sampled = calculated.course;
    let maximum = f(g.edgeLengthRange[1]);
    if (entry.creation.flags & 0x10000) {
      const s = sampled.start.elevation,
        e = sampled.end.elevation,
        m = sampled.elevation,
        minEnd = max(min(...s), min(...e)),
        high = [max(minEnd, m[0]), max(minEnd, m[1])],
        lowEnds = [min(...s), min(...e), min(...m)],
        highEnds = [max(...s), max(...e), max(...m)];
      let elevated: boolean;
      if (high.every((x) => x >= mul(g.elevationLimit, 2)) || g.flags & 0x200)
        elevated = !(g.flags & 0x20000000);
      else if (
        max(max(lowEnds[0], lowEnds[1]), lowEnds[2]) <=
          mul(g.elevationLimit, -2) &&
        min(min(highEnds[0], highEnds[1]), highEnds[2]) <=
          mul(g.elevationLimit, -3)
      )
        elevated = false;
      else
        elevated =
          !!(g.flags & 32) && high.some((x) => x >= f(g.elevationLimit));
      if (elevated) maximum = f(g.elevatedLength);
    }
    const amount = int32(Math.ceil(div(sub(total, 0.16), maximum)));
    if (amount > 1) {
      let current = structuredClone(course),
        currentAux = [...aux] as CS2RoadRange;
      for (let i = 1; i <= amount; i++) {
        if (i === amount) {
          current.end = structuredClone(course.end);
          currentAux[1] = aux[1];
        } else {
          current.end = this.cutCourse(course, g, div(mul(total, i), amount));
          currentAux[1] = -1;
        }
        this.addWithElevation(
          height.sampleCourseHeight(current),
          { ...entry, upgraded: calculated.upgraded },
          index,
          auxEntities,
          currentAux,
          count,
        );
        current.start = structuredClone(current.end);
        currentAux[0] = currentAux[1];
      }
    } else
      this.addAuxCourses(
        sampled,
        { ...entry, upgraded: calculated.upgraded },
        index,
        auxEntities,
        aux,
        count,
      );
  }
  calculateElevationAt(
    creation: CS2RoadCreationDefinition,
    owner: CS2RoadCourseOwner,
    g: CS2RoadHeightGeometry,
    place: { placementFlags: number },
    curve: CS2RoadCurve,
    t: number,
    offset: number,
    service: boolean,
  ): CS2RoadRange {
    const p = cs2RoadCurvePosition(curve, t),
      owned = !(g.flags & 0x1000000) && !service;
    if (g.flags & 0x2000000) return [0, 0];
    if (owned && owner.prefab !== null) {
      const n = sub(p.y, owner.position.y);
      return [n, n];
    }
    const transform =
      creation.owner === null
        ? undefined
        : this.world.transforms.get(creation.owner);
    if (owned && transform) {
      const n = sub(p.y, transform.position.y);
      return [n, n];
    }
    const tangent = normalize(flat(cs2RoadCurveTangent(curve, t)), true),
      side = { x: mul(tangent.z, offset), y: 0, z: mul(-tangent.x, offset) },
      a = vsub(p, side),
      b = vadd(p, side),
      terrain = this.terrain(),
      elevation: CS2RoadRange = [
        sub(p.y, terrain.terrainHeight(a)),
        sub(p.y, terrain.terrainHeight(b)),
      ];
    if (place.placementFlags & 0x400) {
      const wetA = f(terrain.waterDepth(a)) >= f(g.elevationLimit),
        wetB = f(terrain.waterDepth(b)) >= f(g.elevationLimit),
        triple = mul(g.elevationLimit, 3),
        tenth = mul(g.elevationLimit, 0.1);
      if (wetA && wetB) {
        elevation[0] = max(g.elevationLimit, elevation[0]);
        elevation[1] = max(g.elevationLimit, elevation[1]);
      } else if (wetA || (sub(elevation[0], elevation[1]) >= tenth && !wetB)) {
        elevation[0] = max(g.elevationLimit, elevation[0]);
        if (elevation[1] < triple) elevation[1] = 0;
      } else if (wetB || (sub(elevation[1], elevation[0]) >= tenth && !wetA)) {
        if (elevation[0] < triple) elevation[0] = 0;
        elevation[1] = max(g.elevationLimit, elevation[1]);
      }
    }
    return elevation;
  }
  calculateElevation(
    creation: CS2RoadCreationDefinition,
    owner: CS2RoadCourseOwner,
    input: CS2RoadCourse,
    inputFlags: CS2RoadIntersectionFlags,
    g: CS2RoadHeightGeometry,
  ) {
    const course = structuredClone(input),
      upgraded = structuredClone(inputFlags),
      place =
        creation.prefab === null
          ? undefined
          : this.world.prefabPlaceable.get(creation.prefab),
      p = place ?? {
        placementFlags: 0,
        elevationRange: [0, 0] as CS2RoadRange,
      },
      middle = lerp(course.start.courseDelta, course.end.courseDelta, 0.5),
      offset = mul(g.defaultWidth, 0.5),
      service =
        !this.editorMode &&
        !!(creation.flags & 0x10000) &&
        creation.prefab !== null &&
        this.world.prefabServiceUpgrades.has(creation.prefab),
      start = this.calculateElevationAt(
        creation,
        owner,
        g,
        p,
        course.curve,
        course.start.courseDelta,
        offset,
        service,
      ),
      mid = this.calculateElevationAt(
        creation,
        owner,
        g,
        p,
        course.curve,
        middle,
        offset,
        service,
      ),
      end = this.calculateElevationAt(
        creation,
        owner,
        g,
        p,
        course.curve,
        course.end.courseDelta,
        offset,
        service,
      ),
      wasElevated = !!(upgraded.general & 0x10000);
    if (wasElevated) {
      course.start.flags |= 0x800;
      course.end.flags |= 0x800;
      upgraded.general = (upgraded.general & ~0x10000) >>> 0;
      const maximum = max(
        max(course.curve[0].y, course.curve[1].y),
        max(course.curve[2].y, course.curve[3].y),
      );
      if (course.curve[0].y > sub(maximum, 0.1)) course.start.flags |= 0x400;
      if (course.curve[3].y > sub(maximum, 0.1)) course.end.flags |= 0x400;
    }
    const double = mul(g.elevationLimit, 2);
    for (const [values, force] of [
      [start, !!(course.start.flags & 0x400)],
      [mid, !!(course.start.flags & course.end.flags & 0x800)],
      [end, !!(course.end.flags & 0x400)],
    ] as const)
      if (force)
        for (let i = 0; i < 2; i++) if (values[i] < double) values[i] = double;
    if (course.start.flags & 256) start[0] = 0;
    if (course.start.flags & 512) start[1] = 0;
    if (course.end.flags & 256) end[0] = 0;
    if (course.end.flags & 512) end[1] = 0;
    const limit = f(g.elevationLimit),
      threshold = (n: number) => (n >= limit || n <= -limit ? n : 0);
    course.start.elevation = start.map(threshold) as CS2RoadRange;
    course.elevation = mid.map(threshold) as CS2RoadRange;
    course.end.elevation = end.map(threshold) as CS2RoadRange;
    if (
      (creation.owner !== null || owner.prefab !== null) &&
      !wasElevated &&
      !(creation.flags & 0x10000)
    ) {
      if (course.start.parentMesh < 0) course.start.elevation = [0, 0];
      if (course.start.parentMesh < 0 && course.end.parentMesh < 0)
        course.elevation = [0, 0];
      if (course.end.parentMesh < 0) course.end.elevation = [0, 0];
    }
    for (const elevation of [
      course.start.elevation,
      course.elevation,
      course.end.elevation,
    ])
      for (let i = 0; i < 2; i++) {
        if (elevation[i] < p.elevationRange[0] && p.elevationRange[0] >= 0)
          elevation[i] = p.elevationRange[0];
        if (elevation[i] > p.elevationRange[1] && p.elevationRange[1] < 0)
          elevation[i] = p.elevationRange[1];
      }
    return { course, upgraded };
  }
  addWithElevation(
    course: CS2RoadCourse,
    entry: CS2RoadIntersectionCourse,
    index: number,
    auxEntities: AuxEntity[],
    aux: CS2RoadRange,
    count: { value: number },
  ) {
    const g = need(
        this.world.prefabGeometry,
        entry.creation.prefab,
        "NetGeometryData",
      ),
      calculated = this.calculateElevation(
        entry.creation,
        entry.owner,
        course,
        entry.upgraded,
        g,
      );
    this.addAuxCourses(
      calculated.course,
      { ...entry, upgraded: calculated.upgraded },
      index,
      auxEntities,
      aux,
      count,
    );
  }
  addAuxCourses(
    course: CS2RoadCourse,
    entry: CS2RoadIntersectionCourse,
    index: number,
    auxEntities: AuxEntity[],
    aux: CS2RoadRange,
    count: { value: number },
  ) {
    this.addCourse(course, entry, index, count);
    const nets =
      entry.creation.prefab === null
        ? undefined
        : this.world.auxiliaryNets.get(entry.creation.prefab);
    if (!nets) return;
    const a = cs2RoadCurvePosition(course.curve, course.start.courseDelta),
      d = cs2RoadCurvePosition(course.curve, course.end.courseDelta),
      owner = {
        prefab: entry.creation.prefab,
        position: a,
        rotation: { ...d, w: 0 },
      };
    for (const [i, net] of nets.entries()) {
      const mode = net.invertMode ?? 0,
        invert =
          mode === 3 ||
          (mode === 1 && this.leftHandTraffic) ||
          (mode === 2 && !this.leftHandTraffic),
        creation = cs2GetRoadAuxiliaryDefinition(entry.creation, net),
        next = cs2GetRoadAuxiliaryCourse(course, net, invert);
      if (!next.success) continue;
      const selected = invert ? [aux[1], aux[0]] : aux;
      for (const [side, pos] of [
        next.course.start,
        next.course.end,
      ].entries()) {
        const key = selected[side] * nets.length + i;
        if (selected[side] !== -1 && key < auxEntities.length) {
          const entity = auxEntities[key];
          if (!entity)
            throw new Error(`Invalid source auxiliary index: ${key}`);
          pos.entity = entity.entity;
          pos.splitPosition = entity.splitPosition;
          pos.flags &= ~0x400;
        } else {
          pos.entity = null;
          pos.splitPosition = 0;
        }
      }
      const upgraded = invert
          ? {
              general: entry.upgraded.general,
              left: entry.upgraded.right,
              right: entry.upgraded.left,
            }
          : structuredClone(entry.upgraded),
        g = need(this.world.prefabGeometry, net.prefab, "NetGeometryData"),
        calculated = this.calculateElevation(
          entry.creation,
          entry.owner,
          next.course,
          upgraded,
          g,
        );
      this.addCourse(
        calculated.course,
        { ...entry, creation, owner, upgraded: calculated.upgraded },
        index,
        count,
      );
    }
  }
  matchingOwner(
    creation: CS2RoadCreationDefinition,
    owner: CS2RoadCourseOwner,
    entity: string,
  ) {
    if (this.world.owners.has(entity)) {
      const parent = this.world.owners.get(entity)!,
        transform =
          parent === null ? undefined : this.world.transforms.get(parent),
        prefab =
          parent === null ? undefined : this.world.prefabRefs.get(parent);
      return (
        creation.owner === parent ||
        (!!transform &&
          prefab !== undefined &&
          equalsV(owner.position, transform.position) &&
          equalsQ(owner.rotation, transform.rotation) &&
          owner.prefab === prefab)
      );
    }
    return owner.prefab === null;
  }
  findOriginal(
    creation: CS2RoadCreationDefinition,
    owner: CS2RoadCourseOwner,
    net: CS2RoadIntersectionNetData,
    course: CS2RoadCourse,
  ) {
    const w = this.world,
      a = course.start.entity,
      b = course.end.entity;
    if (
      creation.original !== null ||
      creation.flags & 1 ||
      a === null ||
      b === null ||
      !w.connectedEdges.has(a) ||
      !w.connectedEdges.has(b)
    )
      return;
    for (const id of w.connectedEdges.get(a)!) {
      if (this.deleted.has(id)) continue;
      const edge = need(w.edges, id, "Edge");
      if (
        (edge.start === a && edge.end === b) ||
        (edge.start === b && edge.end === a)
      ) {
        const prefab = need(w.prefabRefs, id, "PrefabRef"),
          other = need(w.prefabNet, prefab, "NetData");
        if (net.requiredLayers & other.requiredLayers) {
          creation.original = id;
          if (edge.start === b && edge.end === a) creation.flags |= 64;
        }
        break;
      }
    }
    if (
      creation.original !== null &&
      !this.matchingOwner(creation, owner, creation.original)
    ) {
      creation.original = null;
      creation.flags &= ~64;
    }
  }
  ignoreOverlap(creation: CS2RoadCreationDefinition, course: CS2RoadCourse) {
    const a = course.start,
      b = course.end;
    if (creation.original !== null || a.entity === null || b.entity === null)
      return false;
    if (
      ((a.flags & 8193) === 1 && (b.flags & 8194) === 2) ||
      ((a.flags & 8194) === 2 && (b.flags & 8193) === 1)
    )
      return false;
    if (a.entity === b.entity) return true;
    const ae = this.world.edges.get(a.entity),
      be = this.world.edges.get(b.entity);
    return (
      (!!ae && (b.entity === ae.start || b.entity === ae.end)) ||
      (!!be && (a.entity === be.start || a.entity === be.end))
    );
  }
  localCurve(owner: CS2RoadCourseOwner, curve: CS2RoadCurve) {
    const q = owner.rotation,
      square = add(
        add(mul(q.x, q.x), mul(q.y, q.y)),
        add(mul(q.z, q.z), mul(q.w, q.w)),
      ),
      inverse = div(1, square),
      rotation = {
        x: mul(-q.x, inverse),
        y: mul(-q.y, inverse),
        z: mul(-q.z, inverse),
        w: mul(q.w, inverse),
      },
      cross = (a: V, b: V): V => ({
        x: sub(mul(a.y, b.z), mul(a.z, b.y)),
        y: sub(mul(a.z, b.x), mul(a.x, b.z)),
        z: sub(mul(a.x, b.y), mul(a.y, b.x)),
      });
    return curve.map((p) => {
      const offset = vsub(p, owner.position),
        t = vmul(cross(rotation, offset), 2);
      return vadd(vadd(offset, vmul(t, rotation.w)), cross(rotation, t));
    }) as unknown as CS2RoadCurve;
  }
  addCourse(
    input: CS2RoadCourse,
    entry: CS2RoadIntersectionCourse,
    index: number,
    count: { value: number },
  ) {
    const creation = structuredClone(entry.creation),
      course = structuredClone(input);
    creation.randomSeed = (creation.randomSeed + count.value) | 0;
    this.findOriginal(
      creation,
      entry.owner,
      need(this.world.prefabNet, creation.prefab, "NetData"),
      course,
    );
    if (this.ignoreOverlap(creation, course)) {
      course.start.flags |= 0x4000;
      course.end.flags |= 0x4000;
    }
    const local =
        entry.entity !== null && this.world.localCurves.has(entry.entity),
      localCurve = local
        ? this.localCurve(entry.owner, course.curve)
        : undefined,
      hasUpgrade = !!(
        entry.upgraded.general |
        entry.upgraded.left |
        entry.upgraded.right
      );
    if (count.value++ === 0) {
      this.cmd(
        index,
        entry.entity,
        "set-component",
        "CreationDefinition",
        creation,
      );
      this.cmd(index, entry.entity, "set-component", "NetCourse", course);
      if (local)
        this.cmd(index, entry.entity, "set-component", "LocalCurveCache", {
          curve: localCurve,
        });
      if (hasUpgrade)
        this.cmd(index, entry.entity, "set-component", "Upgraded", {
          flags: entry.upgraded,
        });
      else this.cmd(index, entry.entity, "remove-component", "Upgraded");
      return;
    }
    const entity = `$split:${index}:${this.nextEntity++}`;
    this.cmd(index, entity, "create-entity");
    this.cmd(index, entity, "add-component", "CreationDefinition", creation);
    this.cmd(index, entity, "add-component", "NetCourse", course);
    this.cmd(index, entity, "add-component", "Updated", {});
    if (entry.owner.prefab !== null)
      this.cmd(index, entity, "add-component", "OwnerDefinition", entry.owner);
    if (local)
      this.cmd(index, entity, "add-component", "LocalCurveCache", {
        curve: localCurve,
      });
    if (hasUpgrade)
      this.cmd(index, entity, "add-component", "Upgraded", {
        flags: entry.upgraded,
      });
  }
}
/** Entire ResultsJob transaction. Commands remain deferred until the host ToolReadyBarrier boundary. */
export function cs2ProcessRoadIntersectionResults(
  world: CS2RoadResultWorld,
  courses: readonly CS2RoadIntersectionCourse[],
  intersections: readonly CS2RoadIntersectPos[],
  options: {
    deletedEntities?: ReadonlyMap<string, boolean>;
    editorMode?: boolean;
    leftHandTraffic?: boolean;
  } = {},
) {
  const job = new RoadResultsKernel(
    world,
    options.deletedEntities ?? new Map(),
    options.editorMode ?? false,
    options.leftHandTraffic ?? false,
  );
  for (const [index, entry] of courses.entries())
    job.execute(entry, index, intersections);
  return { commands: job.commands, barrier: "ToolReadyBarrier" as const };
}

/** Shared original packed-XZ math for the subsequent GenerateNodes/Edges jobs.
 * These are the same verified helpers used by CourseSplit, with no second
 * implementation or conversion to the differently grouped 3D arithmetic. */
export {
  curveXZPosition as cs2RoadXZPosition,
  cutXZ as cs2CutRoadXZCurve,
  curveDistance as cs2RoadXZDistance,
  clampLength as cs2ClampRoadCurveLengthRange,
  curveLengthRange as cs2RoadCurveRangeLength,
};
