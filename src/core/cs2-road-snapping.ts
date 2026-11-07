/** Source road/control-point snapping. Method evidence: CS2_ROAD_SNAPPING.md. */
import type { V } from "./types";
import {
  cs2OffsetRoadCurveLeftSmooth,
  cs2RoadCurvePosition,
  cs2RoadCurveTangent,
  cs2StraightRoadCurve,
  type CS2RoadCurve,
} from "./cs2-net-geometry";

export type CS2RoadDirection = { x: number; y: number };
type Q = V & { w: number };
export type CS2RoadControlPoint = {
  position: V;
  hitPosition: V;
  direction: CS2RoadDirection;
  hitDirection: V;
  rotation: Q;
  originalEntity: string | null;
  snapPriority: CS2RoadDirection;
  elementIndex: CS2RoadDirection;
  curvePosition: number;
  elevation: number;
};
export type CS2RoadSnapLine = {
  controlPoint: CS2RoadControlPoint;
  curve: CS2RoadCurve;
  flags: number;
  heightWeight: number;
};
export const CS2_ROAD_SNAP = {
  existingGeometry: 1,
  cellLength: 2,
  straightDirection: 4,
  netSide: 8,
  netArea: 0x10,
  ownerSide: 0x20,
  objectSide: 0x40,
  netMiddle: 0x80,
  shoreline: 0x100,
  nearbyGeometry: 0x200,
  guideLines: 0x400,
  zoneGrid: 0x800,
  netNode: 0x1000,
  objectSurface: 0x2000,
  upright: 0x4000,
  lotGrid: 0x8000,
  autoParent: 0x10000,
  prefabType: 0x20000,
  contourLines: 0x40000,
  distance: 0x80000,
} as const;
export const CS2_ROAD_SNAP_MODE = {
  straight: 0,
  simpleCurve: 1,
  complexCurve: 2,
  continuous: 3,
  grid: 4,
  replace: 5,
  point: 6,
} as const;
const S = CS2_ROAD_SNAP;
const G = {
  strictNodes: 2,
  snapCellSize: 4,
  noEdgeConnection: 0x40,
  snapToNetAreas: 0x80,
  marker: 0x80000,
  standingNodes: 0x200000,
};
const L = { extended: 1, hidden: 2, guide: 4 };
const f = Math.fround,
  tiny = f(1.1754944e-38),
  maxFloat = f(3.4028234663852886e38);
const add = (a: number, b: number) => f(f(a) + f(b));
const sub = (a: number, b: number) => f(f(a) - f(b));
const mul = (a: number, b: number) => f(f(a) * f(b));
const div = (a: number, b: number) => f(f(a) / f(b));
const clamp = (a: number, min: number, max: number) =>
  Math.max(min, Math.min(max, a));
const v2 = (x = 0, y = 0): CS2RoadDirection => ({ x: f(x), y: f(y) });
const v3 = (x = 0, y = 0, z = 0): V => ({ x: f(x), y: f(y), z: f(z) });
const xz = (a: V) => v2(a.x, a.z);
const copy3 = (a: V) => v3(a.x, a.y, a.z);
const plus2 = (a: CS2RoadDirection, b: CS2RoadDirection) =>
  v2(add(a.x, b.x), add(a.y, b.y));
const minus2 = (a: CS2RoadDirection, b: CS2RoadDirection) =>
  v2(sub(a.x, b.x), sub(a.y, b.y));
const scale2 = (a: CS2RoadDirection, t: number) => v2(mul(a.x, t), mul(a.y, t));
const dot2 = (a: CS2RoadDirection, b: CS2RoadDirection) =>
  add(mul(a.x, b.x), mul(a.y, b.y));
const plus3 = (a: V, b: V) => v3(add(a.x, b.x), add(a.y, b.y), add(a.z, b.z));
const minus3 = (a: V, b: V) => v3(sub(a.x, b.x), sub(a.y, b.y), sub(a.z, b.z));
const scale3 = (a: V, t: number) => v3(mul(a.x, t), mul(a.y, t), mul(a.z, t));
const left = (a: CS2RoadDirection) => v2(-a.y, a.x);
const right = (a: CS2RoadDirection) => v2(a.y, -a.x);
const length2 = (a: CS2RoadDirection) => f(Math.sqrt(dot2(a, a)));
const distance2 = (a: CS2RoadDirection, b: CS2RoadDirection) =>
  length2(minus2(a, b));
const distance3 = (a: V, b: V) => {
  const d = minus3(a, b);
  return f(Math.sqrt(add(add(mul(d.x, d.x), mul(d.y, d.y)), mul(d.z, d.z))));
};
const normalize2 = (a: CS2RoadDirection) => {
  const n = dot2(a, a);
  return n > tiny ? scale2(a, f(1 / f(Math.sqrt(n)))) : v2();
};
const normalizeHorizontal = (a: V) => {
  const n = dot2(xz(a), xz(a));
  return n > tiny ? scale3(a, f(1 / f(Math.sqrt(n)))) : v3();
};
const zero2 = (a: CS2RoadDirection) => a.x === 0 && a.y === 0;
const setXZ = (a: V, b: CS2RoadDirection): V => v3(b.x, a.y, b.y);
const lerp = (a: number, b: number, t: number) => add(a, mul(sub(b, a), t));
const lerp2 = (a: CS2RoadDirection, b: CS2RoadDirection, t: number) =>
  v2(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
const lerp3 = (a: V, b: V, t: number) =>
  v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
const cloneCurve = (c: CS2RoadCurve): [V, V, V, V] =>
  c.map(copy3) as [V, V, V, V];
const clonePoint = (p: CS2RoadControlPoint): CS2RoadControlPoint => ({
  ...p,
  position: copy3(p.position),
  hitPosition: copy3(p.hitPosition),
  direction: v2(p.direction.x, p.direction.y),
  hitDirection: copy3(p.hitDirection),
  rotation: { ...copy3(p.rotation), w: f(p.rotation.w) },
  snapPriority: v2(p.snapPriority.x, p.snapPriority.y),
  elementIndex: { ...p.elementIndex },
  curvePosition: f(p.curvePosition),
  elevation: f(p.elevation),
});
export function cs2RoadControlPoint(
  hitPosition: V,
  originalEntity: string | null = null,
): CS2RoadControlPoint {
  return {
    position: copy3(hitPosition),
    hitPosition: copy3(hitPosition),
    direction: v2(),
    hitDirection: v3(),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    originalEntity,
    snapPriority: v2(),
    elementIndex: { x: -1, y: -1 },
    curvePosition: 0,
    elevation: 0,
  };
}
function roundEven(x: number) {
  const a = Math.floor(x),
    d = x - a;
  return d < 0.5 ? a : d > 0.5 ? a + 1 : a % 2 === 0 ? a : a + 1;
}
const snapValue = (value: number, interval: number, offset = 0) =>
  add(mul(roundEven(div(sub(value, offset), interval)), interval), offset);
function lineDistance(
  a: CS2RoadDirection,
  b: CS2RoadDirection,
  position: CS2RoadDirection,
  segment = false,
) {
  const delta = minus2(b, a),
    offset = minus2(position, a),
    square = dot2(delta, delta);
  let t = square !== 0 ? div(dot2(delta, offset), square) : 0;
  if (segment) t = clamp(t, 0, 1);
  return { t, distance: length2(minus2(scale2(delta, t), offset)) };
}
/** The original Bezier4x2 expression groups a/c and b/d additions, unlike its
 * Bezier4x3 overload; preserve that grouping for source XZ distance/length. */
function curvePosition2(c: CS2RoadCurve, t: number) {
  t = f(t);
  const y = sub(1, t),
    z = mul(3, t),
    weights = [
      mul(mul(y, y), y),
      mul(mul(z, y), y),
      mul(mul(z, t), y),
      mul(mul(t, t), t),
    ];
  return plus2(
    plus2(scale2(xz(c[0]), weights[0]), scale2(xz(c[2]), weights[2])),
    plus2(scale2(xz(c[1]), weights[1]), scale2(xz(c[3]), weights[3])),
  );
}
function curveLength2(c: CS2RoadCurve, begin = 0, end = 1) {
  let length = 0,
    before = curvePosition2(c, begin);
  const step = div(sub(end, begin), 16);
  for (let i = 1; i <= 16; i++) {
    const point = curvePosition2(c, add(begin, mul(i, step)));
    length = add(length, distance2(before, point));
    before = point;
  }
  return length;
}
export function cs2RoadCurveDistanceXZ(
  curve: CS2RoadCurve,
  position: CS2RoadDirection,
) {
  let distance = maxFloat,
    t = 0,
    begin = 0,
    a = xz(curve[0]);
  for (let i = 1; i <= 16; i++) {
    const next = f(i / 16),
      b = curvePosition2(curve, next),
      d = lineDistance(a, b, position, true);
    if (d.distance < distance) {
      distance = d.distance;
      t = lerp(begin, next, d.t);
    }
    begin = next;
    a = b;
  }
  let step = f(1 / 32);
  for (let i = 0; i < 4; i++) {
    const centre = curvePosition2(curve, t),
      before = curvePosition2(curve, Math.max(0, sub(t, step))),
      after = curvePosition2(curve, Math.min(1, add(t, step))),
      a = lineDistance(centre, before, position, true),
      b = lineDistance(centre, after, position, true);
    if (a.distance < b.distance) {
      t = Math.max(0, sub(t, mul(step, a.t)));
      distance = a.distance;
    } else {
      t = Math.min(1, add(t, mul(step, b.t)));
      distance = b.distance;
    }
    step = mul(step, 0.5);
  }
  return { distance, t };
}
export function cs2ExtendedRoadCurveDistanceXZ(
  curve: CS2RoadCurve,
  position: CS2RoadDirection,
) {
  const a = lineDistance(
      xz(curve[0]),
      minus2(scale2(xz(curve[0]), 2), xz(curve[1])),
      position,
    ),
    b = cs2RoadCurveDistanceXZ(curve, position),
    c = lineDistance(
      xz(curve[3]),
      minus2(scale2(xz(curve[3]), 2), xz(curve[2])),
      position,
    );
  if (
    a.t >= 0 &&
    a.distance < b.distance &&
    (a.distance < c.distance || c.t < 0)
  )
    return { t: f(-a.t), distance: a.distance };
  if (c.t >= 0 && c.distance < b.distance)
    return { t: add(1, c.t), distance: c.distance };
  return b;
}
export function cs2ExtendedRoadCurveLengthXZ(curve: CS2RoadCurve, t: number) {
  t = f(t);
  if (t <= 0) return mul(distance2(xz(curve[0]), xz(curve[1])), t);
  if (t <= 1) return curveLength2(curve, 0, t);
  return add(
    curveLength2(curve),
    mul(distance2(xz(curve[2]), xz(curve[3])), sub(t, 1)),
  );
}
export function cs2ClampExtendedRoadCurveLengthXZ(
  curve: CS2RoadCurve,
  distance: number,
) {
  distance = f(distance);
  if (distance <= 0) {
    const length = distance2(xz(curve[0]), xz(curve[1]));
    return length === 0 ? 0 : div(distance, length);
  }
  let begin = 0,
    accumulated = 0,
    a = curvePosition2(curve, 0);
  for (let i = 1; i <= 16; i++) {
    const end = add(begin, f(1 / 16)),
      b = curvePosition2(curve, end),
      next = add(accumulated, distance2(a, b));
    if (next >= distance)
      return clamp(
        lerp(
          begin,
          end,
          div(sub(distance, accumulated), sub(next, accumulated)),
        ),
        0,
        1,
      );
    begin = end;
    a = b;
    accumulated = next;
  }
  distance = sub(distance, curveLength2(curve));
  const endLength = distance2(xz(curve[2]), xz(curve[3]));
  return endLength === 0 ? 1 : add(1, div(distance, endLength));
}
export function cs2ExtendedRoadCurvePositionAndTangent(
  curve: CS2RoadCurve,
  t: number,
) {
  t = f(t);
  if (t <= 0)
    return {
      position: lerp3(curve[0], minus3(scale3(curve[0], 2), curve[1]), -t),
      tangent: minus3(curve[1], curve[0]),
    };
  if (t <= 1)
    return {
      position: cs2RoadCurvePosition(curve, t),
      tangent: cs2RoadCurveTangent(curve, t),
    };
  return {
    position: lerp3(curve[3], minus3(scale3(curve[3], 2), curve[2]), sub(t, 1)),
    tangent: minus3(curve[3], curve[2]),
  };
}

export function cs2CalculateRoadSnapPriority(
  level: number,
  priority: number,
  heightWeight: number,
  original: V,
  position: V,
  direction: CS2RoadDirection,
) {
  const offset = minus3(position, original),
    longitudinal = div(dot2(xz(offset), direction), 8),
    vertical = div(offset.y, 8),
    transverse = div(dot2(xz(offset), right(direction)), 8),
    x = mul(longitudinal, longitudinal),
    y = mul(vertical, vertical),
    z = mul(transverse, transverse),
    a = Math.min(1, add(x, z)),
    b = add(Math.max(x, z), mul(Math.min(x, z), 0.001));
  return v2(
    level,
    div(mul(priority, sub(sub(2, a), b)), add(1, mul(y, heightWeight))),
  );
}
const higherPriority = (a: CS2RoadDirection, b: CS2RoadDirection) =>
  a.x > b.x || (a.y > b.y && a.x === b.x);
function directionSnap(
  bestDistance: number,
  position: V,
  direction: V,
  reference: V,
  origin: V,
  snapDirection: V,
  snapDistance: number,
) {
  const forward = v3(snapDirection.x, 0, snapDirection.z),
    side = v3(snapDirection.z, 0, -snapDirection.x),
    a = lineDistance(xz(origin), xz(plus3(origin, forward)), xz(reference)),
    b = lineDistance(xz(origin), xz(plus3(origin, side)), xz(reference));
  if (a.distance < bestDistance) {
    bestDistance = a.distance;
    if (a.distance < snapDistance) {
      direction = a.t < 0 ? scale3(forward, -1) : forward;
      position = setXZ(
        position,
        lerp2(xz(origin), xz(plus3(origin, forward)), a.t),
      );
    }
  }
  if (b.distance < bestDistance) {
    bestDistance = b.distance;
    if (b.distance < snapDistance) {
      direction = b.t < 0 ? scale3(side, -1) : side;
      position = setXZ(
        position,
        lerp2(xz(origin), xz(plus3(origin, side)), b.t),
      );
    }
  }
  return { bestDistance, position, direction };
}
function rotation(direction: CS2RoadDirection): Q {
  if (zero2(direction)) return { x: 0, y: 0, z: 0, w: 1 };
  const forward = direction,
    r = normalize2(v2(forward.y, -forward.x)),
    up = sub(mul(forward.y, r.x), mul(forward.x, r.y));
  // quaternion(float3x3) for the source horizontal LookRotation basis.
  if (forward.y >= 0) {
    const scale = f(0.5 / f(Math.sqrt(add(add(1, r.x), add(up, forward.y)))));
    return {
      x: 0,
      y: mul(sub(forward.x, r.y), scale),
      z: 0,
      w: mul(add(add(1, r.x), add(up, forward.y)), scale),
    };
  }
  const value = add(sub(1, r.x), sub(up, forward.y)),
    scale = f(0.5 / f(Math.sqrt(value)));
  return {
    x: 0,
    y: mul(value, scale),
    z: 0,
    w: mul(sub(forward.x, r.y), scale),
  };
}

export type CS2RoadSnapBounds = { min: V; max: V };
export type CS2RoadSnapNetData = {
  requiredLayers: number;
  connectLayers: number;
};
export type CS2RoadSnapGeometry = {
  flags: number;
  defaultWidth: number;
  defaultHeightRange: { min: number; max: number };
  mergeLayers: number;
};
export type CS2RoadSnapPlaceable = {
  snapDistance: number;
  placementFlags: number;
  minWaterElevation: number;
  elevationRange: { min: number; max: number };
};
export type CS2RoadSnapArea = {
  flags: number;
  position: V;
  width: number;
  snapPosition: V;
  snapWidth: number;
};
export type CS2RoadSnapSegment = { left: CS2RoadCurve; right: CS2RoadCurve };
export type CS2RoadSnapWorld = {
  candidates: readonly { entity: string; bounds: CS2RoadSnapBounds }[];
  nodes: ReadonlyMap<string, { position: V; rotation: Q }>;
  edges: ReadonlyMap<string, { start: string; end: string }>;
  curves: ReadonlyMap<string, { bezier: CS2RoadCurve; length?: number }>;
  connectedEdges: ReadonlyMap<string, readonly string[]>;
  owners: ReadonlyMap<string, string | null>;
  prefabRefs: ReadonlyMap<string, string | null>;
  netData: ReadonlyMap<string, CS2RoadSnapNetData>;
  geometryData: ReadonlyMap<string, CS2RoadSnapGeometry>;
  roadData: ReadonlyMap<string, { flags: number }>;
  placeableData: ReadonlyMap<string, CS2RoadSnapPlaceable>;
  localConnectData: ReadonlyMap<
    string,
    { heightRange: { min: number; max: number } }
  >;
  compositions: ReadonlyMap<string, { edge: string }>;
  compositionData: ReadonlyMap<string, { width: number }>;
  roadCompositions: ReadonlyMap<string, { flags: number }>;
  roads: ReadonlyMap<string, { flags: number }>;
  edgeGeometry: ReadonlyMap<
    string,
    { start: CS2RoadSnapSegment; end: CS2RoadSnapSegment }
  >;
  compositionAreas: ReadonlyMap<string, readonly CS2RoadSnapArea[]>;
  transforms: ReadonlyMap<string, { rotation: Q }>;
  subObjects: ReadonlyMap<string, readonly { prefab: string }[]>;
  objectGeometry: ReadonlyMap<
    string,
    { flags: number; legSizeX: number; legOffsetX: number }
  >;
  sampleTerrain?: (position: V) => number;
  sampleSurface?: (position: V) => { height: number; depth: number };
};
export function createCS2RoadSnapWorld(
  world: Pick<CS2RoadSnapWorld, "netData"> & Partial<CS2RoadSnapWorld>,
): CS2RoadSnapWorld {
  return {
    candidates: [],
    nodes: new Map(),
    edges: new Map(),
    curves: new Map(),
    connectedEdges: new Map(),
    owners: new Map(),
    prefabRefs: new Map(),
    geometryData: new Map(),
    roadData: new Map(),
    placeableData: new Map(),
    localConnectData: new Map(),
    compositions: new Map(),
    compositionData: new Map(),
    roadCompositions: new Map(),
    roads: new Map(),
    edgeGeometry: new Map(),
    compositionAreas: new Map(),
    transforms: new Map(),
    subObjects: new Map(),
    objectGeometry: new Map(),
    ...world,
  };
}
export type CS2RoadSnapInput = {
  prefab: string;
  controlPoints: readonly CS2RoadControlPoint[];
  mode: number;
  snap: number;
  elevation: number;
  startEntity?: string | null;
  serviceUpgradeOwner?: string | null;
  editorMode?: boolean;
  lanePrefab?: string | null;
  /** Height is a separate original stage; disable only for raw stage oracles. */
  adjustHeight?: boolean;
  waterSurfaceHeight?: number;
};
export type CS2RoadSnapOutput = {
  best: CS2RoadControlPoint;
  controlPoints: CS2RoadControlPoint[];
  snapLines: CS2RoadSnapLine[];
  queries: { kind: "terrain" | "surface"; position: V }[];
};

function required<T>(
  map: ReadonlyMap<string, T>,
  entity: string | null,
  component: string,
): T {
  const value = entity === null ? undefined : map.get(entity);
  if (value === undefined)
    throw new Error(`Missing source ${component}: ${entity}`);
  return value;
}
const intersects = (a: CS2RoadSnapBounds, b: CS2RoadSnapBounds) =>
  a.min.x <= b.max.x &&
  a.max.x >= b.min.x &&
  a.min.y <= b.max.y &&
  a.max.y >= b.min.y &&
  a.min.z <= b.max.z &&
  a.max.z >= b.min.z;
const intersectsRange = (
  a: { min: number; max: number },
  b: { min: number; max: number },
) => a.min <= b.max && a.max >= b.min;
const translatedRange = (a: { min: number; max: number }, b: number) => ({
  min: add(a.min, b),
  max: add(a.max, b),
});
const canConnect = (a: CS2RoadSnapNetData, b: CS2RoadSnapNetData) =>
  (a.requiredLayers & b.connectLayers) >>> 0 === a.requiredLayers >>> 0 ||
  (b.requiredLayers & a.connectLayers) >>> 0 === b.requiredLayers >>> 0;
const cellWidth = (width: number) => Math.ceil(sub(div(width, 8), 0.01));
const snapLineFlags = (geometry: CS2RoadSnapGeometry) =>
  geometry.flags & G.strictNodes ? 0 : L.extended;
const curveLerp = (a: CS2RoadCurve, b: CS2RoadCurve, t: number): CS2RoadCurve =>
  a.map((p, i) => lerp3(p, b[i], t)) as [V, V, V, V];

class RoadSnap {
  readonly points: CS2RoadControlPoint[];
  readonly point: CS2RoadControlPoint;
  readonly geometry: CS2RoadSnapGeometry;
  readonly net: CS2RoadSnapNetData;
  readonly placeable: CS2RoadSnapPlaceable;
  readonly localHeight: { min: number; max: number };
  readonly roadFlags: number;
  readonly lines: CS2RoadSnapLine[] = [];
  readonly queries: CS2RoadSnapOutput["queries"] = [];
  readonly startEntity: string | null;
  best: CS2RoadControlPoint;
  private bounds: CS2RoadSnapBounds = { min: v3(), max: v3() };
  private totalBounds: CS2RoadSnapBounds = { min: v3(), max: v3() };
  private heightRange = { min: 0, max: 0 };
  private snapOffset = 0;
  private guideLength = 0;
  private legSnapWidth = 0;
  constructor(
    readonly world: CS2RoadSnapWorld,
    readonly input: CS2RoadSnapInput,
  ) {
    if (!input.controlPoints.length)
      throw new Error("Source road snapping requires a current control point");
    if (input.mode === CS2_ROAD_SNAP_MODE.replace)
      throw new Error(
        "Replace mode uses the source upgrade-path workflow, outside road geometry snapping",
      );
    this.points = input.controlPoints.map(clonePoint);
    this.point = this.points[this.points.length - 1];
    this.best = clonePoint(this.point);
    this.best.position = copy3(this.best.hitPosition);
    this.best.originalEntity = null;
    this.net = required(world.netData, input.prefab, "Prefab.NetData");
    this.geometry = {
      ...(world.geometryData.get(input.prefab) ?? {
        flags: 0,
        defaultWidth: 0,
        defaultHeightRange: { min: 0, max: 0 },
        mergeLayers: 0,
      }),
    };
    if (input.lanePrefab) this.geometry.flags |= G.strictNodes;
    this.placeable = {
      ...(world.placeableData.get(input.prefab) ?? {
        snapDistance: 0,
        placementFlags: 0,
        minWaterElevation: 0,
        elevationRange: { min: 0, max: 0 },
      }),
    };
    this.placeable.snapDistance = Math.max(f(this.placeable.snapDistance), 1);
    this.roadFlags = world.roadData.get(input.prefab)?.flags ?? 0;
    this.localHeight = world.localConnectData.get(input.prefab)
      ?.heightRange ?? { min: 0, max: 0 };
    this.startEntity =
      this.points.length <= 1 ? null : (input.startEntity ?? null);
  }
  private terrain(position: V) {
    this.queries.push({ kind: "terrain", position: copy3(position) });
    if (!this.world.sampleTerrain)
      throw new Error("Source terrain-height sample required");
    return f(this.world.sampleTerrain(copy3(position)));
  }
  private surface(position: V) {
    this.queries.push({ kind: "surface", position: copy3(position) });
    if (!this.world.sampleSurface)
      throw new Error("Source water/terrain surface sample required");
    const sample = this.world.sampleSurface(copy3(position));
    return { height: f(sample.height), depth: f(sample.depth) };
  }
  private addPosition(point: CS2RoadControlPoint) {
    if (higherPriority(point.snapPriority, this.best.snapPriority))
      this.best = clonePoint(point);
  }
  private priority(
    point: CS2RoadControlPoint,
    level: number,
    priority = 1,
    heightWeight = 1,
  ) {
    point.snapPriority = cs2CalculateRoadSnapPriority(
      level,
      priority,
      heightWeight,
      point.hitPosition,
      point.position,
      point.direction,
    );
  }
  private addLine(line: CS2RoadSnapLine) {
    for (const old of this.lines) {
      if (
        Math.abs(
          dot2(line.controlPoint.direction, old.controlPoint.direction),
        ) > f(0.999999)
      )
        continue;
      const p = line.controlPoint,
        q = old.controlPoint,
        a = minus2(plus2(xz(p.position), p.direction), xz(p.position)),
        b = minus2(plus2(xz(q.position), q.direction), xz(q.position)),
        c = minus2(xz(p.position), xz(q.position)),
        determinant = sub(mul(a.x, b.y), mul(a.y, b.x));
      if (determinant === 0) continue;
      const t = v2(
          div(sub(mul(c.y, b.x), mul(c.x, b.y)), determinant),
          div(sub(mul(c.y, a.x), mul(c.x, a.y)), determinant),
        ),
        chosen = p.snapPriority.x >= q.snapPriority.x ? line : old,
        point = clonePoint(chosen.controlPoint);
      point.position = setXZ(
        point.position,
        plus2(
          xz(point.position),
          scale2(chosen.controlPoint.direction, chosen === line ? t.x : t.y),
        ),
      );
      if (line.heightWeight !== old.heightWeight)
        point.position.y =
          old.heightWeight > line.heightWeight ? q.position.y : p.position.y;
      if (chosen.flags & L.extended) {
        const projected = cs2ExtendedRoadCurveDistanceXZ(
          chosen.curve,
          xz(point.position),
        );
        point.curvePosition = cs2ClampExtendedRoadCurveLengthXZ(
          chosen.curve,
          snapValue(cs2ExtendedRoadCurveLengthXZ(chosen.curve, projected.t), 4),
        );
      }
      this.priority(
        point,
        Math.max(p.snapPriority.x, q.snapPriority.x),
        2,
        Math.max(line.heightWeight, old.heightWeight),
      );
      this.addPosition(point);
    }
    this.lines.push({
      ...line,
      controlPoint: clonePoint(line.controlPoint),
      curve: cloneCurve(line.curve),
    });
  }
  private snapDirection(
    entity: string,
    previous: CS2RoadControlPoint,
    point: CS2RoadControlPoint,
    current: { bestDistance: number; position: V; direction: V },
  ) {
    const attempt = (direction: V) => {
      direction = normalizeHorizontal(direction);
      direction.y = clamp(direction.y, -1, 1);
      current = directionSnap(
        current.bestDistance,
        current.position,
        current.direction,
        point.hitPosition,
        previous.position,
        direction,
        this.placeable.snapDistance,
      );
    };
    const edges = this.world.connectedEdges.get(entity);
    if (edges !== undefined) {
      for (const id of edges) {
        const edge = required(this.world.edges, id, "Edge");
        if (edge.start === entity || edge.end === entity) {
          const c = required(this.world.curves, id, "Curve").bezier;
          attempt(
            edge.start === entity ? minus3(c[1], c[0]) : minus3(c[3], c[2]),
          );
        }
      }
    } else {
      const curve = this.world.curves.get(entity),
        transform = this.world.transforms.get(entity);
      if (curve)
        attempt(cs2RoadCurveTangent(curve.bezier, previous.curvePosition));
      else if (transform) {
        const q = transform.rotation;
        attempt(
          v3(
            mul(2, add(mul(q.x, q.z), mul(q.w, q.y))),
            mul(2, sub(mul(q.y, q.z), mul(q.w, q.x))),
            sub(1, mul(2, add(mul(q.x, q.x), mul(q.y, q.y)))),
          ),
        );
      }
    }
    return current;
  }
  private controls() {
    const point = this.point,
      result = clonePoint(point);
    result.originalEntity = null;
    result.position = copy3(point.hitPosition);
    let interval = this.placeable.snapDistance;
    if (this.input.mode === 4 && this.points.length === 3) {
      if (this.input.snap & S.cellLength) {
        const origin = xz(this.points[0].position),
          direction = this.points[1].direction,
          side = right(direction),
          offset = minus2(xz(point.hitPosition), origin),
          snapped = v2(
            snapValue(dot2(offset, direction), interval),
            snapValue(dot2(offset, side), interval),
          );
        result.direction = { ...direction };
        result.position = setXZ(
          result.position,
          plus2(
            origin,
            plus2(scale2(direction, snapped.x), scale2(side, snapped.y)),
          ),
        );
        this.priority(result, 0, 1, 0);
        const p = result.position,
          a = setXZ(p, minus2(xz(p), scale2(direction, 8))),
          b = setXZ(p, plus2(xz(p), scale2(direction, 8))),
          c = setXZ(p, minus2(xz(p), scale2(side, 8))),
          d = setXZ(p, plus2(xz(p), scale2(side, 8)));
        this.addPosition(result);
        this.addLine({
          controlPoint: result,
          curve: cs2StraightRoadCurve(a, b),
          flags: L.hidden,
          heightWeight: 0,
        });
        result.direction = side;
        this.addLine({
          controlPoint: result,
          curve: cs2StraightRoadCurve(c, d),
          flags: L.hidden,
          heightWeight: 0,
        });
      }
      return;
    }
    let previous: CS2RoadControlPoint;
    if (this.input.mode === 3 && this.points.length === 3) {
      previous = clonePoint(this.points[0]);
      previous.originalEntity = null;
      previous.direction = { ...this.points[1].direction };
    } else {
      previous = clonePoint(this.points[this.points.length - 2]);
      if (zero2(previous.direction) && this.points.length >= 3)
        previous.direction = normalize2(
          minus2(
            xz(previous.position),
            xz(this.points[this.points.length - 3].position),
          ),
        );
    }
    let direction = normalizeHorizontal(
      minus3(point.hitPosition, previous.position),
    );
    direction.y = clamp(direction.y, -1, 1);
    let added = false,
      directionAdded = false;
    if (this.input.snap & S.straightDirection) {
      let state = {
        bestDistance: maxFloat,
        position: result.position,
        direction,
      };
      if (previous.originalEntity)
        state = this.snapDirection(
          previous.originalEntity,
          previous,
          point,
          state,
        );
      if (
        this.startEntity &&
        this.startEntity !== previous.originalEntity &&
        this.points.length === 2
      )
        state = this.snapDirection(this.startEntity, previous, point, state);
      if (!zero2(previous.direction) && state.bestDistance === maxFloat) {
        state = directionSnap(
          state.bestDistance,
          state.position,
          state.direction,
          point.hitPosition,
          previous.position,
          v3(previous.direction.x, 0, previous.direction.y),
          this.placeable.snapDistance,
        );
        if (
          state.bestDistance >= this.placeable.snapDistance &&
          this.input.mode === 3 &&
          this.points.length === 3
        ) {
          const angle = f(Math.PI / 4),
            sin = f(Math.sin(angle)),
            cos = f(Math.cos(angle)),
            rotatedLeft = v2(
              sub(
                mul(cos, previous.direction.x),
                mul(sin, previous.direction.y),
              ),
              add(
                mul(sin, previous.direction.x),
                mul(cos, previous.direction.y),
              ),
            ),
            rotatedRight = v2(
              add(
                mul(cos, previous.direction.x),
                mul(sin, previous.direction.y),
              ),
              sub(
                mul(cos, previous.direction.y),
                mul(sin, previous.direction.x),
              ),
            );
          state = directionSnap(
            state.bestDistance,
            state.position,
            state.direction,
            point.hitPosition,
            previous.position,
            v3(rotatedLeft.x, 0, rotatedLeft.y),
            this.placeable.snapDistance,
          );
          state = directionSnap(
            state.bestDistance,
            state.position,
            state.direction,
            point.hitPosition,
            previous.position,
            v3(rotatedRight.x, 0, rotatedRight.y),
            this.placeable.snapDistance,
          );
          interval = mul(interval, 1.4142135);
        }
      }
      added = state.bestDistance < this.placeable.snapDistance;
      directionAdded = added;
      result.position = state.position;
      direction = state.direction;
    }
    if (
      this.input.snap & S.cellLength &&
      (this.input.mode !== 3 || (this.points.length === 3 && directionAdded))
    ) {
      const length = distance3(previous.position, result.position);
      result.position = plus3(
        previous.position,
        scale3(direction, snapValue(length, interval)),
      );
      added = true;
    }
    result.direction = xz(direction);
    this.priority(result, 0, 1, 0);
    if (added) this.addPosition(result);
    if (directionAdded) {
      const end = setXZ(
        result.position,
        plus2(xz(result.position), result.direction),
      );
      this.addLine({
        controlPoint: result,
        curve: cs2StraightRoadCurve(result.position, end),
        flags: snapLineFlags(this.geometry) | L.hidden,
        heightWeight: 0,
      });
    }
  }
  private compositionWidths(entity: string) {
    let existingCell = false,
      width = f(this.geometry.defaultWidth),
      radius = mul(this.geometry.defaultWidth, 0.5),
      halfStart = false,
      halfEnd = false;
    const prefab = required(this.world.prefabRefs, entity, "PrefabRef"),
      geometry =
        prefab === null ? undefined : this.world.geometryData.get(prefab),
      composition = this.world.compositions.get(entity);
    if (composition) {
      radius = add(
        radius,
        mul(
          required(
            this.world.compositionData,
            composition.edge,
            "NetCompositionData",
          ).width,
          0.5,
        ),
      );
      if (!(this.geometry.flags & G.strictNodes)) {
        width = f(geometry?.defaultWidth ?? 0);
        const road = this.world.roadCompositions.get(composition.edge);
        if (road) {
          existingCell = !!(road.flags & 1 && this.input.snap & S.cellLength);
          const flags = this.world.roads.get(entity)?.flags;
          if (existingCell && flags !== undefined) {
            halfStart = !!(flags & 1);
            halfEnd = !!(flags & 2);
          }
        }
      }
    }
    const zoning =
      !(this.geometry.flags & G.strictNodes) &&
      !!(this.roadFlags & 1) &&
      !!(this.input.snap & S.cellLength);
    let count: number, offset: number, step: number;
    if (zoning) {
      count =
        1 + Math.abs(cellWidth(width) - cellWidth(this.geometry.defaultWidth));
      offset = mul(count - 1, -4);
      step = 8;
    } else {
      const difference = Math.abs(sub(width, this.geometry.defaultWidth));
      count = difference > f(1.6) ? 3 : 1;
      offset = difference > f(1.6) ? mul(difference, -0.5) : 0;
      step = difference > f(1.6) ? mul(difference, 0.5) : 0;
    }
    return {
      prefab,
      geometry,
      composition,
      existingCell,
      width,
      radius,
      halfStart,
      halfEnd,
      count,
      offset,
      step,
    };
  }
  private guideLines(entity: string) {
    const record = this.world.curves.get(entity);
    if (!record) return;
    const prefab = required(this.world.prefabRefs, entity, "PrefabRef"),
      net = required(this.world.netData, prefab, "Prefab.NetData"),
      geo = prefab === null ? undefined : this.world.geometryData.get(prefab);
    if (
      !canConnect(this.net, net) ||
      (!this.input.editorMode && !!(geo && geo.flags & G.marker))
    )
      return;
    const data = this.compositionWidths(entity),
      ownCellWidth = cellWidth(this.geometry.defaultWidth),
      existingCellWidth = cellWidth(data.width);
    let alignStart = 0,
      alignEnd = 0,
      terminalStart = 0,
      terminalEnd = 0;
    if (data.existingCell) {
      alignStart =
        (((ownCellWidth ^ existingCellWidth) & 1) !== 0) !== data.halfStart
          ? 4
          : 0;
      alignEnd =
        (((ownCellWidth ^ existingCellWidth) & 1) !== 0) !== data.halfEnd
          ? 4
          : 0;
      terminalStart =
        ownCellWidth > existingCellWidth ? -alignStart : alignStart;
      terminalEnd = ownCellWidth > existingCellWidth ? -alignEnd : alignEnd;
      const delta = mul(
        8,
        Math.trunc(
          (Math.max(2, existingCellWidth) - Math.max(2, ownCellWidth)) / 2,
        ),
      );
      terminalStart = add(terminalStart, delta);
      terminalEnd = add(terminalEnd, delta);
    }
    const curve = record.bezier,
      edge = required(this.world.edges, entity, "Edge"),
      startDirection = normalize2(scale2(xz(minus3(curve[1], curve[0])), -1)),
      endDirection = normalize2(xz(minus3(curve[3], curve[2]))),
      startValid =
        dot2(xz(minus3(curve[1], curve[0])), xz(minus3(curve[1], curve[0]))) >
        tiny,
      endValid =
        dot2(xz(minus3(curve[3], curve[2])), xz(minus3(curve[3], curve[2]))) >
        tiny;
    const terminal = (node: string) =>
      !required(this.world.connectedEdges, node, "ConnectedEdge buffer").some(
        (id) => {
          if (id === entity) return false;
          const e = required(this.world.edges, id, "Edge");
          return e.start === node || e.end === node;
        },
      );
    const startTerminal = startValid && terminal(edge.start),
      endTerminal = endValid && terminal(edge.end);
    if (!startValid && !endValid) return;
    const attempt = (
      origin: V,
      direction: CS2RoadDirection,
      offset: number,
    ) => {
      const end = setXZ(
          origin,
          plus2(xz(origin), scale2(direction, this.guideLength)),
        ),
        d = lineDistance(xz(origin), xz(end), xz(this.point.hitPosition), true);
      if (d.distance >= this.placeable.snapDistance) return;
      let t = d.t;
      if (this.input.snap & S.cellLength)
        t = div(
          snapValue(
            mul(this.guideLength, t),
            this.placeable.snapDistance,
            offset,
          ),
          this.guideLength,
        );
      const point = clonePoint(this.point);
      point.originalEntity = null;
      point.position = lerp3(origin, end, t);
      point.direction = { ...direction };
      this.priority(point, 0, 1, 0.1);
      this.addPosition(point);
      this.addLine({
        controlPoint: point,
        curve: cs2StraightRoadCurve(origin, end),
        flags: L.guide,
        heightWeight: 0.1,
      });
    };
    let offset = data.offset;
    for (let i = 0; i < data.count; i++) {
      if (startValid) {
        const a = setXZ(
            curve[0],
            plus2(xz(curve[0]), scale2(left(startDirection), offset)),
          ),
          b = setXZ(a, plus2(xz(a), scale2(startDirection, terminalStart)));
        attempt(a, startDirection, alignStart);
        if (i === 0 && startTerminal) attempt(b, right(startDirection), 0);
        if (i === data.count - 1 && startTerminal)
          attempt(b, left(startDirection), 0);
      }
      if (endValid) {
        const a = setXZ(
            curve[3],
            plus2(xz(curve[3]), scale2(left(endDirection), offset)),
          ),
          b = setXZ(a, plus2(xz(a), scale2(endDirection, terminalEnd)));
        attempt(a, endDirection, alignEnd);
        if (i === 0 && endTerminal) attempt(b, right(endDirection), 0);
        if (i === data.count - 1 && endTerminal)
          attempt(b, left(endDirection), 0);
      }
      offset = add(offset, data.step);
    }
  }
  private segmentAreas(
    point: CS2RoadControlPoint,
    width: number,
    areas: readonly CS2RoadSnapArea[],
    segment: CS2RoadSnapSegment,
  ) {
    let handled = false;
    for (const area of areas) {
      if (
        !(area.flags & 1) ||
        mul(this.legSnapWidth, 0.5) >= mul(area.width, 0.51)
      )
        continue;
      handled = true;
      const curve = curveLerp(
          segment.left,
          segment.right,
          add(div(area.position.x, width), 0.5),
        ),
        d = cs2RoadCurveDistanceXZ(curve, xz(point.hitPosition)),
        result = clonePoint(point);
      result.position = cs2RoadCurvePosition(curve, d.t);
      result.direction = normalize2(xz(cs2RoadCurveTangent(curve, d.t)));
      if (area.flags & 2) result.direction = scale2(result.direction, -1);
      const target = cs2RoadCurvePosition(
          curveLerp(
            segment.left,
            segment.right,
            add(div(area.snapPosition.x, width), 0.5),
          ),
          d.t,
        ),
        max = Math.max(
          0,
          sub(
            Math.min(
              mul(area.width, 0.5),
              add(
                Math.abs(sub(area.snapPosition.x, area.position.x)),
                mul(area.snapWidth, 0.5),
              ),
            ),
            mul(this.legSnapWidth, 0.5),
          ),
        ),
        difference = minus2(xz(target), xz(result.position)),
        length = length2(difference);
      result.position = setXZ(
        result.position,
        plus2(
          xz(result.position),
          length > max && length !== 0
            ? scale2(difference, div(max, length))
            : difference,
        ),
      );
      result.position.y = add(result.position.y, area.position.y);
      const level =
        d.distance <=
        add(
          sub(mul(width, 0.5), Math.abs(area.position.x)),
          mul(this.legSnapWidth, 0.5),
        )
          ? 2
          : 1;
      result.rotation = rotation(result.direction);
      this.priority(result, level);
      this.addPosition(result);
      this.addLine({
        controlPoint: result,
        curve,
        flags: snapLineFlags(this.geometry),
        heightWeight: 1,
      });
    }
    return handled;
  }
  private curve(
    point: CS2RoadControlPoint,
    entity: string,
    initiallyAllowEdge: boolean,
  ) {
    const data = this.compositionWidths(entity);
    if (data.composition && this.geometry.flags & G.snapToNetAreas) {
      const areas = required(
          this.world.compositionAreas,
          data.composition.edge,
          "NetCompositionArea buffer",
        ),
        geometry = required(this.world.edgeGeometry, entity, "EdgeGeometry"),
        width = required(
          this.world.compositionData,
          data.composition.edge,
          "NetCompositionData",
        ).width;
      const start = this.segmentAreas(point, width, areas, geometry.start),
        end = this.segmentAreas(point, width, areas, geometry.end);
      if (start || end) return;
    }
    let allowEdge = initiallyAllowEdge;
    const owner = this.world.owners.get(entity),
      service = this.input.serviceUpgradeOwner ?? null;
    if (
      !this.input.editorMode &&
      this.world.owners.has(entity) &&
      owner !== service &&
      (!owner ||
        !this.world.edges.has(owner) ||
        (this.world.owners.has(owner) &&
          this.world.owners.get(owner) !== service))
    )
      allowEdge = false;
    const curve = required(this.world.curves, entity, "Curve").bezier,
      a = normalize2(left(xz(minus3(curve[1], curve[0])))),
      b = normalize2(left(xz(minus3(curve[2], curve[1])))),
      c = normalize2(left(xz(minus3(curve[3], curve[2])))),
      nearlyStraight = dot2(a, b) > f(0.9998477) && dot2(b, c) > f(0.9998477);
    const ownCells = cellWidth(this.geometry.defaultWidth),
      existingCells = cellWidth(data.width),
      phase =
        data.existingCell &&
        (((ownCells ^ existingCells) & 1) !== 0) !== data.halfStart
          ? 4
          : 0;
    let offset = data.offset;
    for (let i = 0; i < data.count; i++) {
      let shifted: CS2RoadCurve;
      if (Math.abs(offset) < f(0.08)) shifted = curve;
      else if (nearlyStraight)
        shifted = [
          setXZ(curve[0], plus2(xz(curve[0]), scale2(a, offset))),
          setXZ(
            curve[1],
            plus2(xz(curve[1]), scale2(lerp2(a, c, f(1 / 3)), offset)),
          ),
          setXZ(
            curve[2],
            plus2(xz(curve[2]), scale2(lerp2(a, c, f(2 / 3)), offset)),
          ),
          setXZ(curve[3], plus2(xz(curve[3]), scale2(c, offset))),
        ];
      else shifted = cs2OffsetRoadCurveLeftSmooth(curve, [offset, offset]);
      const distance =
          this.geometry.flags & G.strictNodes
            ? cs2RoadCurveDistanceXZ(shifted, xz(point.hitPosition))
            : cs2ExtendedRoadCurveDistanceXZ(shifted, xz(point.hitPosition)),
        result = clonePoint(point);
      let t = distance.t;
      if (this.input.snap & S.cellLength) {
        const length = add(
            curveLength2(shifted),
            data.halfStart !== data.halfEnd ? 4 : 0,
          ),
          halfRemainder = mul(f(add(length, 0.1) % 8), 0.5),
          value = snapValue(
            cs2ExtendedRoadCurveLengthXZ(shifted, t),
            this.placeable.snapDistance,
            add(phase, halfRemainder),
          );
        t = cs2ClampExtendedRoadCurveLengthXZ(shifted, value);
        if (this.geometry.flags & G.strictNodes) t = clamp(t, 0, 1);
        result.curvePosition = t;
      } else {
        t = clamp(t, 0, 1);
        if (data.geometry && data.geometry.flags & G.snapCellSize)
          result.curvePosition = cs2ClampExtendedRoadCurveLengthXZ(
            shifted,
            snapValue(cs2ExtendedRoadCurveLengthXZ(shifted, t), 4),
          );
        else {
          if (t >= 0.5) {
            if (
              distance2(xz(shifted[3]), xz(point.hitPosition)) < this.snapOffset
            )
              t = 1;
          } else if (
            distance2(xz(shifted[0]), xz(point.hitPosition)) < this.snapOffset
          )
            t = 0;
          result.curvePosition = t;
        }
      }
      if (!allowEdge && t > 0 && t < 1) {
        if (t >= 0.5) {
          if (
            distance2(xz(shifted[3]), xz(point.hitPosition)) >=
            add(data.radius, this.snapOffset)
          )
            continue;
          t = 1;
          result.curvePosition = 1;
        } else {
          if (
            distance2(xz(shifted[0]), xz(point.hitPosition)) >=
            add(data.radius, this.snapOffset)
          )
            continue;
          t = 0;
          result.curvePosition = 0;
        }
      }
      const extended = cs2ExtendedRoadCurvePositionAndTangent(shifted, t);
      result.position = extended.position;
      result.direction = normalize2(xz(extended.tangent));
      this.priority(
        result,
        this.geometry.flags & G.strictNodes && distance.distance <= data.radius
          ? 2
          : 1,
      );
      this.addPosition(result);
      this.addLine({
        controlPoint: result,
        curve: shifted,
        flags: snapLineFlags(this.geometry),
        heightWeight: 1,
      });
      offset = add(offset, data.step);
    }
  }
  private geometryPoint(
    point: CS2RoadControlPoint,
    snapHeight: number,
    prefab: string | null,
    ignoreHeight: boolean,
  ) {
    const net = prefab === null ? undefined : this.world.netData.get(prefab);
    if (!net) return false;
    const geometry =
        prefab === null ? undefined : this.world.geometryData.get(prefab),
      height = add(
        this.input.elevation < 0
          ? this.terrain(point.hitPosition)
          : this.surface(point.hitPosition).height,
        this.input.elevation,
      );
    let overlap = true,
      allowEdge = true;
    if (
      geometry &&
      !intersectsRange(
        translatedRange(this.geometry.defaultHeightRange, height),
        translatedRange(geometry.defaultHeightRange, snapHeight),
      )
    ) {
      overlap = false;
      allowEdge = !(geometry.flags & G.noEdgeConnection);
    }
    if (overlap && !canConnect(net, this.net)) return false;
    if ((this.net.connectLayers & ~net.requiredLayers & 0x10000) !== 0)
      return false;
    const elevation = sub(snapHeight, height);
    if (
      !ignoreHeight &&
      !(this.heightRange.min <= elevation && elevation <= this.heightRange.max)
    )
      return false;
    const entity = point.originalEntity,
      node = entity === null ? undefined : this.world.nodes.get(entity);
    if (node) {
      const edges = this.world.connectedEdges.get(entity!);
      if (edges?.length) {
        const before = this.lines.length;
        for (const id of edges) {
          const edge = required(this.world.edges, id, "Edge");
          if (edge.start === entity || edge.end === entity)
            this.curve(point, id, allowEdge);
        }
        // The original returns true only if a HandleCurve actually adds a snap.
        // Compare line count; every ordinary/area snap adds a line.
        return this.lines.length !== before;
      }
      const result = clonePoint(point),
        q = node.rotation;
      result.position = copy3(node.position);
      result.direction = normalize2(
        v2(
          mul(2, add(mul(q.x, q.z), mul(q.w, q.y))),
          sub(1, mul(2, add(mul(q.x, q.x), mul(q.y, q.y)))),
        ),
      );
      let level = 1;
      if (this.geometry.flags & G.strictNodes) {
        const width = add(
          mul(this.geometry.defaultWidth, 0.5),
          mul(geometry?.defaultWidth ?? 0, 0.5),
        );
        if (distance2(xz(node.position), xz(point.hitPosition)) <= width)
          level = 2;
      }
      this.priority(result, level);
      this.addPosition(result);
      return true;
    }
    if (entity && this.world.curves.has(entity)) {
      const before = this.lines.length;
      this.curve(point, entity, allowEdge);
      return this.lines.length !== before;
    }
    return false;
  }
  private entityGeometry(entity: string) {
    const prefab = required(this.world.prefabRefs, entity, "PrefabRef"),
      point = clonePoint(this.point);
    point.originalEntity = entity;
    const geometry =
      prefab === null ? undefined : this.world.geometryData.get(prefab);
    let radius = add(mul(this.geometry.defaultWidth, 0.5), this.snapOffset);
    if ((this.geometry.flags & ~(geometry?.flags ?? 0) & G.standingNodes) !== 0)
      radius = add(mul(this.legSnapWidth, 0.5), this.snapOffset);
    const edges = this.world.connectedEdges.get(entity);
    if (edges !== undefined) {
      const node = required(this.world.nodes, entity, "Node");
      for (const id of edges) {
        const edge = required(this.world.edges, id, "Edge");
        if (edge.start === entity || edge.end === entity) return false;
      }
      radius = add(radius, mul(geometry?.defaultWidth ?? 0, 0.5));
      if (distance2(xz(node.position), xz(this.point.hitPosition)) >= radius)
        return false;
      return this.geometryPoint(point, node.position.y, prefab, false);
    }
    const curve = this.world.curves.get(entity);
    if (curve) {
      const composition = this.world.compositions.get(entity);
      if (composition)
        radius = add(
          radius,
          mul(
            required(
              this.world.compositionData,
              composition.edge,
              "NetCompositionData",
            ).width,
            0.5,
          ),
        );
      const distance = cs2RoadCurveDistanceXZ(
        curve.bezier,
        xz(this.point.hitPosition),
      );
      point.curvePosition = distance.t;
      if (distance.distance >= radius) return false;
      return this.geometryPoint(
        point,
        cs2RoadCurvePosition(curve.bezier, distance.t).y,
        prefab,
        false,
      );
    }
    return false;
  }
  private existing() {
    this.snapOffset =
      this.input.snap & S.nearbyGeometry ? this.placeable.snapDistance : 0;
    const radius = add(this.geometry.defaultWidth, this.snapOffset);
    this.guideLength = mul(this.placeable.snapDistance, 64);
    this.heightRange = {
      min: Math.min(-50, this.localHeight.min),
      max: Math.max(50, this.localHeight.max),
    };
    const p = this.point.hitPosition;
    this.bounds = {
      min: v3(
        sub(p.x, radius),
        add(p.y, this.heightRange.min),
        sub(p.z, radius),
      ),
      max: v3(
        add(p.x, radius),
        add(p.y, this.heightRange.max),
        add(p.z, radius),
      ),
    };
    this.totalBounds =
      this.input.snap & S.guideLines
        ? {
            min: v3(
              sub(this.bounds.min.x, this.guideLength),
              sub(this.bounds.min.y, this.guideLength),
              sub(this.bounds.min.z, this.guideLength),
            ),
            max: v3(
              add(this.bounds.max.x, this.guideLength),
              add(this.bounds.max.y, this.guideLength),
              add(this.bounds.max.z, this.guideLength),
            ),
          }
        : this.bounds;
    let leg = -1;
    if (this.geometry.flags & (G.snapToNetAreas | G.standingNodes)) {
      for (const subObject of this.world.subObjects.get(this.input.prefab) ??
        []) {
        const geometry = this.world.objectGeometry.get(subObject.prefab);
        if (geometry && geometry.flags & 0x80)
          leg = Math.max(
            leg,
            add(geometry.legSizeX, mul(geometry.legOffsetX, 2)),
          );
      }
    }
    this.legSnapWidth = leg <= 0 ? this.geometry.defaultWidth : leg;
    if (
      this.input.snap & S.existingGeometry &&
      this.point.originalEntity !== null &&
      this.world.prefabRefs.has(this.point.originalEntity)
    ) {
      const added = this.geometryPoint(
        this.point,
        this.point.hitPosition.y,
        this.world.prefabRefs.get(this.point.originalEntity)!,
        true,
      );
      if (!added && this.input.snap & S.guideLines)
        this.guideLines(this.point.originalEntity);
    }
    for (const candidate of this.world.candidates) {
      if (!intersects(candidate.bounds, this.totalBounds)) continue;
      if (
        (candidate.entity !== this.point.originalEntity ||
          !(this.input.snap & S.existingGeometry)) &&
        (!intersects(candidate.bounds, this.bounds) ||
          !(this.input.snap & (S.existingGeometry | S.nearbyGeometry)) ||
          !this.entityGeometry(candidate.entity)) &&
        this.input.snap & S.guideLines
      )
        this.guideLines(candidate.entity);
    }
  }
  private height() {
    const originalHeight = this.best.position.y;
    if (
      !(this.input.snap & S.objectSurface) ||
      this.point.originalEntity === null ||
      !this.world.transforms.has(this.point.originalEntity)
    ) {
      if (this.input.elevation < 0)
        this.best.position.y = add(
          this.terrain(this.best.position),
          this.input.elevation,
        );
      else {
        const surface = this.surface(this.best.position);
        this.best.position.y = surface.height;
        let elevation = f(this.input.elevation);
        if (
          surface.depth >= f(0.2) &&
          (this.placeable.placementFlags & 3) === 1
        ) {
          elevation = Math.max(elevation, this.placeable.minWaterElevation);
          this.best.elevation = Math.max(
            this.best.elevation,
            this.placeable.minWaterElevation,
          );
        } else if (this.input.snap & S.shoreline) {
          const offset = Math.max(elevation, this.placeable.minWaterElevation),
            surfaceHeight = this.input.waterSurfaceHeight ?? -maxFloat;
          if (add(surfaceHeight, offset) > this.best.position.y) {
            elevation = offset;
            this.best.elevation = Math.max(
              this.best.elevation,
              this.placeable.minWaterElevation,
            );
            this.best.position.y = surfaceHeight;
          }
        }
        this.best.position.y = add(this.best.position.y, elevation);
      }
    } else this.best.position.y = this.point.hitPosition.y;
    const bounds = translatedRange(
        this.geometry.defaultHeightRange,
        this.best.position.y,
      ),
      originalPrefab =
        this.point.originalEntity === null
          ? undefined
          : this.world.prefabRefs.get(this.point.originalEntity),
      originalGeometry = originalPrefab
        ? this.world.geometryData.get(originalPrefab)
        : undefined;
    if (originalGeometry) {
      const original = translatedRange(
        originalGeometry.defaultHeightRange,
        this.point.position.y,
      );
      if (original.max > bounds.min) {
        bounds.max = Math.max(bounds.max, original.max);
        if (this.best.originalEntity === null)
          this.best.originalEntity = this.point.originalEntity;
      }
    }
    const prefab =
        this.best.originalEntity === null
          ? undefined
          : this.world.prefabRefs.get(this.best.originalEntity),
      geometry = prefab ? this.world.geometryData.get(prefab) : undefined;
    if (!geometry) return;
    if (
      intersectsRange(
        bounds,
        translatedRange(geometry.defaultHeightRange, originalHeight),
      )
    ) {
      if (((this.geometry.mergeLayers ^ geometry.mergeLayers) & 0x100) === 0) {
        this.best.elevation = add(
          this.best.elevation,
          sub(originalHeight, this.best.position.y),
        );
        this.best.position.y = originalHeight;
        this.best.elevation = clamp(
          this.best.elevation,
          this.placeable.elevationRange.min,
          this.placeable.elevationRange.max,
        );
      }
    } else this.best.originalEntity = null;
  }
  run(): CS2RoadSnapOutput {
    if (
      this.input.snap & (S.cellLength | S.straightDirection) &&
      this.points.length >= 2
    )
      this.controls();
    if (
      this.input.snap &
      (S.existingGeometry | S.nearbyGeometry | S.guideLines)
    )
      this.existing();
    if (this.input.adjustHeight !== false) this.height();
    this.points[this.points.length - 1] = clonePoint(this.best);
    return {
      best: clonePoint(this.best),
      controlPoints: this.points,
      snapLines: this.lines,
      queries: this.queries,
    };
  }
}

export function cs2SnapRoad(
  world: CS2RoadSnapWorld,
  input: CS2RoadSnapInput,
): CS2RoadSnapOutput {
  return new RoadSnap(world, input).run();
}
