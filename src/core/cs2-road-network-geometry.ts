/** Original Game.Net.GeometrySystem stages; see CS2_ROAD_NETWORK_GEOMETRY.md. */
import { cs2RoadCurveDistanceXZ } from "./cs2-road-snapping";
import type { V } from "./types";
import {
  cs2RoadCurveLength,
  cs2RoadCurvePosition,
  cs2RoadCurveTangent,
  cs2FitRoadCurve,
  cs2OffsetRoadCurveLeftSmooth,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
import type {
  CS2RoadBounds,
  CS2RoadGeometrySegment,
  CS2RoadEdgeGeometry,
  CS2RoadNodeGeometry,
} from "./cs2-road-intersections";

export type CS2NetworkNodeGeometry = {
  bounds: CS2RoadBounds;
  position: number;
  flatness: number;
  offset: number;
};
export type CS2NetworkComposition = {
  width: number;
  middleOffset: number;
  widthOffset: number;
  nodeOffset: number;
  heightRange: readonly [number, number];
  surfaceHeight: readonly [number, number];
  edgeHeights: readonly [number, number, number, number];
  syncVertexOffsetsLeft: readonly [number, number, number, number];
  syncVertexOffsetsRight: readonly [number, number, number, number];
  sideConnectionOffset: readonly [number, number];
  flags: { general: number; left: number; right: number };
  state: number;
};
export type CS2NetworkPrefabGeometry = {
  defaultWidth: number;
  defaultHeightRange: readonly [number, number];
  edgeLengthRange: readonly [number, number];
  mergeLayers: number;
  intersectLayers: number;
  flags: number;
  maxSlopeSteepness: number;
  minNodeOffset: number;
};
export type CS2NetworkEdgeNodeGeometry = CS2RoadNodeGeometry & {
  syncVertexTargetsLeft: readonly [number, number, number, number];
  syncVertexTargetsRight: readonly [number, number, number, number];
};
export type CS2NetworkCompositionLane = {
  lane: string | null;
  position: V;
  flags: number;
  carriageway: number;
};
export type CS2NetworkGeometryWorld = {
  nodes: Map<string, V>;
  edges: Map<string, { start: string; end: string }>;
  curves: Map<string, { bezier: CS2RoadCurve; length: number }>;
  prefabRefs: Map<string, string>;
  prefabGeometry: Map<string, CS2NetworkPrefabGeometry>;
  compositions: Map<
    string,
    { edge: string; startNode: string; endNode: string }
  >;
  prefabComposition: Map<string, CS2NetworkComposition>;
  prefabCompositionLanes: Map<string, CS2NetworkCompositionLane[]>;
  prefabCompositionCrosswalks: Map<string, { start: V; end: V }[]>;
  prefabLaneWidths: Map<string, number>;
  prefabPlacementFlags: Map<string, number>;
  outsideConnections: Set<string>;
  connectedEdges: Map<string, string[]>;
  temps: Map<string, { original: string | null; flags: number }>;
  hidden: Set<string>;
  updated: Set<string>;
  owners: Map<string, string>;
  orphans: Map<string, string>;
  nodeGeometry: Map<string, CS2NetworkNodeGeometry>;
  edgeGeometry: Map<string, CS2RoadEdgeGeometry>;
  startNodeGeometry: Map<string, CS2NetworkEdgeNodeGeometry>;
  endNodeGeometry: Map<string, CS2NetworkEdgeNodeGeometry>;
  heightMap: Map<string, readonly [number, number, number, number]>;
  sampleTerrain: (position: V) => number;
};
export function createCS2NetworkGeometryWorld(
  input: Partial<CS2NetworkGeometryWorld> = {},
): CS2NetworkGeometryWorld {
  return {
    nodes: new Map(),
    edges: new Map(),
    curves: new Map(),
    prefabRefs: new Map(),
    prefabGeometry: new Map(),
    compositions: new Map(),
    prefabComposition: new Map(),
    prefabCompositionLanes: new Map(),
    prefabCompositionCrosswalks: new Map(),
    prefabLaneWidths: new Map(),
    prefabPlacementFlags: new Map(),
    outsideConnections: new Set(),
    connectedEdges: new Map(),
    temps: new Map(),
    hidden: new Set(),
    updated: new Set(),
    owners: new Map(),
    orphans: new Map(),
    nodeGeometry: new Map(),
    edgeGeometry: new Map(),
    startNodeGeometry: new Map(),
    endNodeGeometry: new Map(),
    heightMap: new Map(),
    sampleTerrain: () => {
      throw new Error("GeometrySystem requires an explicit terrain reader");
    },
    ...input,
  };
}
const f = Math.fround,
  plus = (a: number, b: number) => f(f(a) + f(b)),
  minus = (a: number, b: number) => f(f(a) - f(b)),
  times = (a: number, b: number) => f(f(a) * f(b)),
  divide = (a: number, b: number) => f(f(a) / f(b));
const min = (a: number, b: number) => (Number.isNaN(b) || a < b ? a : b),
  max = (a: number, b: number) => (Number.isNaN(b) || a > b ? a : b),
  clamp = (a: number, lo: number, hi: number) => max(lo, min(hi, a)),
  lerp = (a: number, b: number, t: number) => plus(a, times(minus(b, a), t));
const dist2 = (a: V, b: V) =>
  f(
    Math.sqrt(
      plus(
        times(minus(a.x, b.x), minus(a.x, b.x)),
        times(minus(a.z, b.z), minus(a.z, b.z)),
      ),
    ),
  );
const clone = <T>(x: T): T => structuredClone(x);
function required<T>(
  map: ReadonlyMap<string, T>,
  entity: string,
  component: string,
): T {
  if (!map.has(entity))
    throw new Error(`Missing GeometrySystem ${component} on ${entity}`);
  return map.get(entity)!;
}
const geom = (w: CS2NetworkGeometryWorld, e: string) =>
  required(
    w.prefabGeometry,
    required(w.prefabRefs, e, "PrefabRef"),
    "NetGeometryData",
  );
const comp = (w: CS2NetworkGeometryWorld, e: string) =>
  required(w.prefabComposition, e, "NetCompositionData");
const RaisedLowered = 3,
  ElevatedTunnel = 0x30000,
  SmoothElevation = 0x4000,
  SmoothSlopes = 0x2000,
  LowerToTerrain = 0x2000,
  RaiseToTerrain = 0x4000;
export function cs2NetworkGeometryHeightKey(edge: string, end: 0 | 1) {
  return JSON.stringify([edge, end]);
}
/** Full EdgeIterator.GetNext/GetDelete semantics. Native traversal order is supplied by connectedEdges. */
export function cs2NetworkGeometryEdges(
  w: CS2NetworkGeometryWorld,
  edge: string | null,
  node: string,
  includeMiddleConnections = false,
): { edge: string; end: boolean; middle: boolean }[] {
  let current = node,
    index = 0,
    buffer = required(w.connectedEdges, current, "ConnectedEdge");
  const permanent = !w.temps.has(node),
    original = edge ? (w.temps.get(edge)?.original ?? null) : null,
    deleted = ((w.temps.get(edge ?? node)?.flags ?? 0) & 2) !== 0,
    result: { edge: string; end: boolean; middle: boolean }[] = [];
  const seen = new Set<string>();
  while (true) {
    if (seen.has(current)) throw new Error("Cyclic original-node Temp chain");
    seen.add(current);
    while (index < buffer.length) {
      const e = buffer[index++];
      if (
        !permanent &&
        (deleted
          ? !(e === edge || (w.hidden.has(e) && e !== original))
          : w.hidden.has(e) || ((w.temps.get(e)?.flags ?? 0) & 2) !== 0)
      )
        continue;
      const data = required(w.edges, e, "Edge"),
        end = data.end === current;
      if (end || data.start === current)
        result.push({ edge: e, end, middle: false });
      else if (includeMiddleConnections)
        result.push({ edge: e, end, middle: true });
    }
    const temp = w.temps.get(current);
    if (!temp || temp.original === null) break;
    current = temp.original;
    const next = w.connectedEdges.get(current);
    if (!next) break;
    buffer = next;
    index = 0;
  }
  return result;
}
/** Original InitializeNodeGeometryJob.Execute for every supplied node/chunk, all branches. */
export function cs2InitializeNetworkNodeGeometry(
  w: CS2NetworkGeometryWorld,
  nodes: readonly string[],
  loaded = false,
) {
  for (const node of nodes) {
    const p = required(w.nodes, node, "Node"),
      value = clone(required(w.nodeGeometry, node, "NodeGeometry")),
      g = geom(w, node),
      isTemp = w.temps.has(node);
    let smooth = [0, 0],
      ordinary = [0, 0],
      smoothCount = 0,
      ordinaryCount = 0,
      roundabout = false,
      levelCrossing = false,
      fixed = false,
      preserve = false;
    for (const item of cs2NetworkGeometryEdges(w, null, node)) {
      const ng = geom(w, item.edge);
      if (!loaded && (!isTemp || w.temps.has(item.edge)))
        preserve ||= !w.updated.has(item.edge);
      if ((g.mergeLayers & ng.mergeLayers) === 0) continue;
      const c = required(w.compositions, item.edge, "Composition"),
        n = comp(w, item.end ? c.endNode : c.startNode);
      roundabout ||= (n.flags.general & 0x40) !== 0;
      levelCrossing ||= (n.flags.general & 0x80) !== 0;
      fixed ||= (n.flags.general & 0x400000) !== 0;
      let ordinaryEdge = false;
      if ((ng.flags & SmoothElevation) === 0) {
        const e = comp(w, c.edge);
        ordinaryEdge =
          (e.flags.general & ElevatedTunnel) === 0 &&
          ((e.flags.left & RaisedLowered) === 0 ||
            (e.flags.right & RaisedLowered) === 0) &&
          !w.owners.has(item.edge);
        if (!ordinaryEdge) continue;
      }
      const source = required(w.curves, item.edge, "Curve").bezier,
        cubic = item.end ? [...source].reverse() : source,
        d = dist2(cubic[1], cubic[0]);
      if (d >= f(0.1)) {
        const a = ordinaryEdge ? ordinary : smooth;
        a[0] = plus(a[0], divide(cubic[1].y, d));
        a[1] = plus(a[1], divide(1, d));
        if (ordinaryEdge) ordinaryCount++;
        else smoothCount++;
      }
    }
    if (roundabout || levelCrossing || fixed) {
      value.position = f(p.y);
      value.flatness = 1;
      value.offset = 0;
    } else if (smoothCount >= 2) {
      value.position = lerp(p.y, divide(smooth[0], smooth[1]), 0.5);
      value.flatness = 0;
      value.offset = 0;
    } else if (ordinaryCount >= 2) {
      value.position = f(p.y);
      value.flatness = 0;
      value.offset = minus(
        p.y,
        lerp(p.y, divide(ordinary[0], ordinary[1]), 0.5),
      );
    } else {
      value.position = f(p.y);
      value.flatness = 0;
      value.offset = 0;
    }
    value.bounds.min.x = preserve ? 1 : 0;
    w.nodeGeometry.set(node, value);
  }
}
function union(a: CS2RoadBounds, b: CS2RoadBounds): CS2RoadBounds {
  return {
    min: {
      x: min(a.min.x, b.min.x),
      y: min(a.min.y, b.min.y),
      z: min(a.min.z, b.min.z),
    },
    max: {
      x: max(a.max.x, b.max.x),
      y: max(a.max.y, b.max.y),
      z: max(a.max.z, b.max.z),
    },
  };
}
/** MathUtils.TightBounds, including Unity min/max NaN handling for flat/linear axes. */
export function cs2NetworkCurveTightBounds(curve: CS2RoadCurve): CS2RoadBounds {
  const result: CS2RoadBounds = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  };
  for (const axis of ["x", "y", "z"] as const) {
    const a = f(curve[0][axis]),
      b = f(curve[1][axis]),
      c = f(curve[2][axis]),
      d = f(curve[3][axis]),
      x = times(-6, a),
      q = plus(minus(plus(x, times(18, b)), times(18, c)), times(6, d)),
      r = minus(plus(x, times(12, b)), times(6, c)),
      s = plus(x, times(6, b)),
      disc = f(Math.sqrt(minus(times(r, r), times(q, s)))),
      t1 = clamp(divide(plus(r, disc), q), 0, 1),
      t2 = clamp(divide(minus(r, disc), q), 0, 1),
      p1 = cs2RoadCurvePosition(curve, t1)[axis],
      p2 = cs2RoadCurvePosition(curve, t2)[axis];
    result.min[axis] = min(min(a, d), min(p1, p2));
    result.max[axis] = max(max(a, d), max(p1, p2));
  }
  return result;
}
function lengthXZ(curve: CS2RoadCurve) {
  return rangeLength(curve);
}
function straighten(start: V[], end: V[]) {
  const a = dist2(start[1], start[2]),
    b = plus(a, dist2(start[2], start[3])),
    c = plus(b, dist2(end[0], end[1])),
    d = plus(c, dist2(end[1], end[2])),
    t = [a, b, c].map((x) => (d === 0 ? 0 : divide(x, d))),
    ys = t.map((x) => lerp(start[1].y, end[2].y, x));
  start[2].y = ys[0];
  start[3].y = ys[1];
  end[0].y = ys[1];
  end[1].y = ys[2];
}
function limit(start: V[], end: V[], slope: number, width: number) {
  const a = lengthXZ(start as unknown as CS2RoadCurve),
    b = lengthXZ(end as unknown as CS2RoadCurve),
    left = times(a, slope),
    right = times(b, slope);
  let low = max(minus(start[0].y, left), minus(end[3].y, right)),
    high = min(plus(start[0].y, left), plus(end[3].y, right));
  const middle = times(plus(low, high), 0.5);
  if (high < low) low = high = middle;
  else {
    const t = divide(
      1,
      plus(divide(times(0.5, plus(a, b)), max(f(0.01), width)), 1),
    );
    low = lerp(low, middle, t);
    high = lerp(high, middle, t);
  }
  const shift = minus(clamp(start[3].y, low, high), start[3].y);
  start[2].y = plus(start[2].y, shift);
  start[3].y = plus(start[3].y, shift);
  end[0].y = plus(end[0].y, shift);
  end[1].y = plus(end[1].y, shift);
}
function sampleCurve(
  w: CS2NetworkGeometryWorld,
  c: CS2RoadCurve,
): [number, number] {
  let lo = f(3.4028234663852886e38),
    hi = -lo;
  for (let i = 0; i <= 8; i++) {
    const value = f(w.sampleTerrain(cs2RoadCurvePosition(c, times(i, 0.125))));
    lo = min(lo, value);
    hi = max(hi, value);
  }
  return [lo, hi];
}
/** Full FinishEdgeGeometryJob: height map, both slope modes, lengths, tight bounds and terrain. */
export function cs2FinishNetworkEdgeGeometry(
  w: CS2NetworkGeometryWorld,
  edges: readonly string[],
) {
  for (const edge of edges) {
    const c = comp(w, required(w.compositions, edge, "Composition").edge),
      g = geom(w, edge),
      value = clone(required(w.edgeGeometry, edge, "EdgeGeometry")),
      start = w.heightMap.get(cs2NetworkGeometryHeightKey(edge, 0)),
      end = w.heightMap.get(cs2NetworkGeometryHeightKey(edge, 1));
    if (start) {
      value.start.right[1].y = f(start[0]);
      value.start.right[0].y = f(start[1]);
      value.start.left[1].y = f(start[2]);
      value.start.left[0].y = f(start[3]);
    }
    if (end) {
      value.end.left[2].y = f(end[0]);
      value.end.left[3].y = f(end[1]);
      value.end.right[2].y = f(end[2]);
      value.end.right[3].y = f(end[3]);
    }
    const straight =
      (g.flags & SmoothSlopes) === 0 &&
      !(
        (c.flags.general & ElevatedTunnel) === 0 &&
        ((c.flags.left & RaisedLowered) === 0 ||
          (c.flags.right & RaisedLowered) === 0) &&
        !w.owners.has(edge)
      );
    for (const side of ["left", "right"] as const) {
      const a = value.start[side] as unknown as V[],
        b = value.end[side] as unknown as V[];
      if (straight) straighten(a, b);
      else limit(a, b, g.maxSlopeSteepness, c.width);
    }
    const curves = [
      value.start.left,
      value.start.right,
      value.end.left,
      value.end.right,
    ];
    value.start.length = [
      cs2RoadCurveLength(curves[0]),
      cs2RoadCurveLength(curves[1]),
    ];
    value.end.length = [
      cs2RoadCurveLength(curves[2]),
      cs2RoadCurveLength(curves[3]),
    ];
    value.bounds = curves.map(cs2NetworkCurveTightBounds).reduce(union);
    value.bounds.min.y = plus(value.bounds.min.y, c.heightRange[0]);
    value.bounds.max.y = plus(value.bounds.max.y, c.heightRange[1]);
    if ((c.state & (LowerToTerrain | RaiseToTerrain)) !== 0) {
      const terrain = curves.map((x) => sampleCurve(w, x));
      if (c.state & LowerToTerrain)
        value.bounds.min.y = min(
          value.bounds.min.y,
          terrain.reduce((a, b) => min(a, b[0]), Infinity),
        );
      if (c.state & RaiseToTerrain)
        value.bounds.max.y = max(
          value.bounds.max.y,
          terrain.reduce((a, b) => max(a, b[1]), -Infinity),
        );
    }
    w.edgeGeometry.set(edge, value);
  }
}
/** Full final UpdateNodeGeometryJob; requires actual completed EdgeNodeGeometry. */
export function cs2UpdateNetworkNodeGeometry(
  w: CS2NetworkGeometryWorld,
  nodes: readonly string[],
) {
  for (const node of nodes) {
    const p = required(w.nodes, node, "Node"),
      orphan = w.orphans.get(node),
      c = orphan === undefined ? undefined : comp(w, orphan),
      g = c ? undefined : geom(w, node),
      width = times(c ? c.width : g!.defaultWidth, 0.5),
      range = c ? c.heightRange : g!.defaultHeightRange;
    let bounds: CS2RoadBounds = {
      min: {
        x: minus(p.x, width),
        y: plus(p.y, range[0]),
        z: minus(p.z, width),
      },
      max: { x: plus(p.x, width), y: plus(p.y, range[1]), z: plus(p.z, width) },
    };
    if (c && c.state & (LowerToTerrain | RaiseToTerrain)) {
      const heights = [
        { x: p.x, y: p.y, z: bounds.min.z },
        { x: bounds.min.x, y: p.y, z: p.z },
        { x: bounds.max.x, y: p.y, z: p.z },
        { x: p.x, y: p.y, z: bounds.max.z },
      ].map((x) => f(w.sampleTerrain(x)));
      if (c.state & LowerToTerrain)
        bounds.min.y = min(bounds.min.y, heights.reduce(min, Infinity));
      if (c.state & RaiseToTerrain)
        bounds.max.y = max(bounds.max.y, heights.reduce(max, -Infinity));
    }
    for (const item of cs2NetworkGeometryEdges(w, null, node)) {
      bounds = union(
        bounds,
        required(
          item.end ? w.endNodeGeometry : w.startNodeGeometry,
          item.edge,
          item.end ? "EndNodeGeometry" : "StartNodeGeometry",
        ).bounds,
      );
    }
    const value = clone(required(w.nodeGeometry, node, "NodeGeometry"));
    value.bounds = bounds;
    w.nodeGeometry.set(node, value);
  }
}
/** Full FlattenNodeGeometryJob, including Temp-original preservation and the source 100 passes. */
export function cs2FlattenNetworkNodeGeometry(
  w: CS2NetworkGeometryWorld,
  nodes: readonly string[],
) {
  type Item = {
    left: V;
    right: V;
    layers: number;
    entity: string;
    maxSlope: number;
    end: boolean;
    temp: boolean;
    changes: [number, number];
  };
  // Original job declares this outside the per-node loop. Each used branch overwrites both components.
  let float7: [number, number] = [0, 0];
  for (const node of nodes) {
    const ng = required(w.nodeGeometry, node, "NodeGeometry");
    if (ng.bounds.min.x !== 0) continue;
    const isTemp = w.temps.has(node),
      list: Item[] = [];
    let allTemp = true;
    for (const item of cs2NetworkGeometryEdges(w, null, node)) {
      const g = geom(w, item.edge);
      if (g.mergeLayers !== 0) {
        const e = required(w.edgeGeometry, item.edge, "EdgeGeometry"),
          temp = w.temps.has(item.edge);
        allTemp &&= temp;
        list.push({
          left: clone(item.end ? e.end.left[3] : e.start.right[0]),
          right: clone(item.end ? e.end.right[3] : e.start.left[0]),
          layers: g.mergeLayers,
          entity: item.edge,
          maxSlope: g.maxSlopeSteepness,
          end: item.end,
          temp,
          changes: [0, 0],
        });
      }
    }
    const add = (
      item: Item,
      source: CS2RoadEdgeGeometry,
      current: CS2RoadEdgeGeometry,
    ) => {
      const a = item.end ? source.end.left[3].y : source.start.right[0].y,
        b = item.end ? source.end.right[3].y : source.start.left[0].y,
        value: [number, number, number, number] = [a, a, b, b];
      value[0] = plus(
        value[0],
        item.end
          ? minus(current.end.left[2].y, current.end.left[3].y)
          : minus(current.start.right[1].y, current.start.right[0].y),
      );
      value[2] = plus(
        value[2],
        item.end
          ? minus(current.end.right[2].y, current.end.right[3].y)
          : minus(current.start.left[1].y, current.start.left[0].y),
      );
      const key = cs2NetworkGeometryHeightKey(item.entity, item.end ? 1 : 0);
      if (!w.heightMap.has(key)) w.heightMap.set(key, value);
    };
    if (isTemp && !allTemp) {
      for (const item of list) {
        if (!item.temp) continue;
        const original = w.temps.get(item.entity)!.original,
          source = original === null ? undefined : w.edgeGeometry.get(original);
        if (source)
          add(
            item,
            source,
            required(w.edgeGeometry, item.entity, "EdgeGeometry"),
          );
      }
    } else {
      let changed = false;
      for (let k = 0; k < 100; k++) {
        let step = false;
        for (let l = 1; l < list.length; l++) {
          const a = list[l];
          for (let m = 0; m < l; m++) {
            const b = list[m];
            if ((a.layers & b.layers) === 0) continue;
            const p = {
                x: minus(b.right.x, a.left.x),
                y: minus(b.right.y, a.left.y),
                z: minus(b.right.z, a.left.z),
              },
              q = {
                x: minus(b.left.x, a.right.x),
                y: minus(b.left.y, a.right.y),
                z: minus(b.left.z, a.right.z),
              },
              d = [
                plus(times(p.x, p.x), times(p.z, p.z)),
                plus(times(q.x, q.x), times(q.z, q.z)),
              ],
              delta = [p.y, q.y],
              slope = plus(a.maxSlope, b.maxSlope),
              slope2 = times(times(slope, slope), f(1.0001));
            if (delta.some((x, i) => times(x, x) > times(d[i], slope2))) {
              const correction = d.map((x, i) =>
                  max(
                    0,
                    minus(Math.abs(delta[i]), times(f(Math.sqrt(x)), slope)),
                  ),
                ),
                sign = delta.map((x) => x >= 0);
              let amount: number;
              if (sign[0] !== sign[1])
                amount = times(
                  plus(
                    sign[0] ? correction[0] : -correction[0],
                    sign[1] ? correction[1] : -correction[1],
                  ),
                  0.5,
                );
              else {
                amount = max(correction[0], correction[1]);
                if (!sign[0]) amount = -amount;
              }
              if (amount >= 0)
                float7 = [
                  max(0, minus(ng.position, max(a.left.y, a.right.y))),
                  min(0, minus(ng.position, min(b.left.y, b.right.y))),
                ];
              else
                float7 = [
                  min(0, minus(ng.position, min(a.left.y, a.right.y))),
                  max(0, minus(ng.position, max(b.left.y, b.right.y))),
                ];
              if (isTemp !== a.temp) float7[0] = 0;
              if (isTemp !== b.temp) float7[1] = 0;
              const scale = min(
                  1,
                  divide(
                    Math.abs(amount),
                    max(
                      f(0.001),
                      plus(Math.abs(float7[0]), Math.abs(float7[1])),
                    ),
                  ),
                ),
                first = times(float7[0], scale),
                second = times(float7[1], scale);
              a.changes = [min(a.changes[0], first), max(a.changes[1], first)];
              b.changes = [
                min(b.changes[0], second),
                max(b.changes[1], second),
              ];
              step = true;
            }
          }
        }
        if (!step) break;
        for (const item of list) {
          const change = plus(item.changes[0], item.changes[1]);
          item.left.y = plus(item.left.y, change);
          item.right.y = plus(item.right.y, change);
          item.changes = [0, 0];
        }
        changed = true;
      }
      if (changed)
        for (const item of list)
          if (isTemp === item.temp) {
            const current = required(
                w.edgeGeometry,
                item.entity,
                "EdgeGeometry",
              ),
              source = clone(current);
            if (item.end) {
              source.end.left[3].y = item.left.y;
              source.end.right[3].y = item.right.y;
            } else {
              source.start.right[0].y = item.left.y;
              source.start.left[0].y = item.right.y;
            }
            add(item, source, current);
          }
    }
  }
}
const add = (a: V, b: V): V => ({
    x: plus(a.x, b.x),
    y: plus(a.y, b.y),
    z: plus(a.z, b.z),
  }),
  sub = (a: V, b: V): V => ({
    x: minus(a.x, b.x),
    y: minus(a.y, b.y),
    z: minus(a.z, b.z),
  }),
  mul = (a: V, t: number): V => ({
    x: times(a.x, t),
    y: times(a.y, t),
    z: times(a.z, t),
  }),
  mix = (a: V, b: V, t: number) => add(a, mul(sub(b, a), t)),
  dot2 = (a: V, b: V) => plus(times(a.x, b.x), times(a.z, b.z)),
  len2 = (a: V) => f(Math.sqrt(dot2(a, a))),
  vzero = (): V => ({ x: 0, y: 0, z: 0 });
const normalize = (v: V): V => {
    const squared = dot2(v, v);
    return squared > f(1.1754943508222875e-38)
      ? mul(v, divide(1, f(Math.sqrt(squared))))
      : vzero();
  },
  direction = (v: V) => {
    const n = normalize(v);
    n.y = clamp(n.y, -1, 1);
    return n;
  };
const invert = (c: CS2RoadCurve): CS2RoadCurve => [
    clone(c[3]),
    clone(c[2]),
    clone(c[1]),
    clone(c[0]),
  ],
  curveMix = (a: CS2RoadCurve, b: CS2RoadCurve, t: number): CS2RoadCurve =>
    a.map((p, i) => mix(p, b[i], t)) as unknown as CS2RoadCurve;
const startTangent = (c: CS2RoadCurve) => sub(c[1], c[0]),
  endTangent = (c: CS2RoadCurve) => sub(c[3], c[2]),
  zeroCurve = (): CS2RoadCurve => [vzero(), vzero(), vzero(), vzero()],
  zeroSegment = (): CS2RoadGeometrySegment => ({
    left: zeroCurve(),
    right: zeroCurve(),
    length: [0, 0],
  });
function middleTangent(c: CS2RoadCurve) {
  let lo = 0,
    hi = 1,
    t = f(0.5);
  const a = normalize({ ...tangent2(c, 0), y: 0 }),
    b = normalize({ ...tangent2(c, 1), y: 0 });
  if (len2(a) === 0 || len2(b) === 0) return t;
  for (let i = 0; i < 24; i++) {
    const m = normalize({ ...tangent2(c, t), y: 0 });
    if (len2(m) === 0) break;
    const x = dot2(sub(a, m), sub(a, m)),
      y = dot2(sub(b, m), sub(b, m));
    if (x < y) lo = t;
    else if (x > y) hi = t;
    else break;
    t = lerp(lo, hi, 0.5);
  }
  return lerp(t, 0.5, clamp(plus(0.5, times(dot2(a, b), 0.5)), 0, 1));
}
function invertedSegment(s: CS2RoadGeometrySegment): CS2RoadGeometrySegment {
  return {
    left: invert(s.right),
    right: invert(s.left),
    length: [s.length[1], s.length[0]],
  };
}
function adjustWidth(
  s: CS2RoadGeometrySegment,
  e: CS2NetworkComposition,
  n: CS2NetworkComposition,
  invertEdge: boolean,
) {
  const original = clone(s),
    offset = invertEdge ? -e.middleOffset : e.middleOffset,
    a = divide(
      plus(
        minus(plus(times(e.width, 0.5), offset), n.middleOffset),
        times(n.width, -0.5),
      ),
      max(f(0.01), e.width),
    ),
    b = minus(
      divide(
        plus(
          minus(plus(times(e.width, 0.5), offset), n.middleOffset),
          times(n.width, 0.5),
        ),
        max(f(0.01), e.width),
      ),
      1,
    );
  if (Math.abs(a) > f(0.001))
    s.left = curveMix(original.left, original.right, a);
  if (Math.abs(b) > f(0.001))
    s.right = curveMix(original.right, original.left, -b);
}
function nodeOffset(s: CS2RoadGeometrySegment, node: V, end = false): V {
  const p = end ? 3 : 0,
    a = end ? endTangent(s.left) : startTangent(s.left),
    b = end ? endTangent(s.right) : startTangent(s.right),
    t = normalize({ ...add(a, b), y: 0 }),
    offset = sub(mix(s.left[p], s.right[p], 0.5), node),
    d = normalize({ ...add(offset, mul(t, end ? -1 : 1)), y: 0 });
  return len2(d) === 0 ? { x: 0, y: 0, z: 1 } : d;
}
function middleNode(w: CS2NetworkGeometryWorld, edge: string, node: string): V {
  let lo: V = { x: 1e9, y: 1e9, z: 1e9 },
    hi: V = { x: -1e9, y: -1e9, z: -1e9 };
  for (const item of cs2NetworkGeometryEdges(w, edge, node)) {
    const g = required(w.edgeGeometry, item.edge, "EdgeGeometry"),
      c = comp(w, required(w.compositions, item.edge, "Composition").edge),
      t = plus(0.5, divide(c.middleOffset, max(f(0.01), c.width))),
      p = item.end
        ? mix(g.end.left[3], g.end.right[3], t)
        : mix(g.start.left[0], g.start.right[0], t);
    for (const axis of ["x", "y", "z"] as const) {
      lo[axis] = min(lo[axis], p[axis]);
      hi[axis] = max(hi[axis], p[axis]);
    }
  }
  return mix(lo, hi, 0.5);
}
function middleCurve(
  a: CS2RoadCurve,
  b: CS2RoadCurve,
): { curve: CS2RoadCurve; t: number } {
  const start = direction(endTangent(a));
  let end = direction(startTangent(b));
  const curve = cs2FitRoadCurve(a[3], start, end, b[0]),
    t = middleTangent(curve),
    p = cs2RoadCurvePosition(curve, t);
  end = direction(cs2RoadCurveTangent(curve, t));
  return { curve: cs2FitRoadCurve(a[3], start, end, p), t };
}
function middleSegment(a: CS2RoadGeometrySegment, b: CS2RoadGeometrySegment) {
  const left = middleCurve(a.left, b.left),
    right = middleCurve(a.right, b.right);
  return {
    segment: {
      left: left.curve,
      right: right.curve,
      length: [cs2RoadCurveLength(left.curve), cs2RoadCurveLength(right.curve)],
    } as CS2RoadGeometrySegment,
    div: [left.t, right.t] as [number, number],
  };
}
function vertexSync(
  segment: CS2RoadGeometrySegment,
  startDistance: number,
  endDistance: number,
  inputA: readonly number[],
  inputB: readonly number[],
  t: number,
  isRight: boolean,
): [number, number, number, number] {
  let distance = times(plus(startDistance, endDistance), 0.5),
    a = [...inputA],
    b = [...inputB];
  const start = isRight ? minus(1, a[3]) : a[0],
    end = isRight ? minus(1, b[3]) : b[0],
    change = times(
      minus(times(end, endDistance), times(start, startDistance)),
      0.5,
    );
  distance = minus(distance, change);
  const curve = isRight ? segment.right : segment.left,
    other = isRight ? segment.left : segment.right,
    offset = mul(
      sub(other[3], curve[3]),
      divide(change, max(f(0.01), startDistance)),
    );
  curve[2].x = plus(curve[2].x, times(offset.x, 0.5));
  curve[2].y = plus(curve[2].y, times(offset.y, 0.5));
  curve[2].z = plus(curve[2].z, times(offset.z, 0.5));
  curve[3].x = plus(curve[3].x, offset.x);
  curve[3].y = plus(curve[3].y, offset.y);
  curve[3].z = plus(curve[3].z, offset.z);
  a = a.map((x) =>
    isRight
      ? clamp(
          minus(1, divide(minus(minus(1, x), start), minus(1, start))),
          0,
          1,
        )
      : clamp(divide(minus(x, start), minus(1, start)), 0, 1),
  );
  b = b.map((x) =>
    isRight
      ? clamp(minus(1, divide(minus(minus(1, x), end), minus(1, end))), 0, 1)
      : clamp(divide(minus(x, end), minus(1, end)), 0, 1),
  );
  const base = divide(times(start, startDistance), max(f(0.01), distance));
  startDistance = minus(startDistance, times(start, startDistance));
  endDistance = minus(endDistance, times(end, endDistance));
  const p = [a[0], a[3], b[0], b[3]],
    q = [a[1], a[2], b[1], b[2]],
    same = p.map((x, i) => x === q[i]),
    r = p.map((x, i) => (same[(i + 2) % 4] ? q[i] : x));
  a[0] = r[0];
  a[3] = r[1];
  b[0] = r[2];
  b[3] = r[3];
  const d = lerp(startDistance, endDistance, t),
    target = a.map((x, i) =>
      d >= f(1.401298464324817e-45)
        ? divide(lerp(times(x, startDistance), times(b[i], endDistance), t), d)
        : x,
    );
  return target.map((x) =>
    isRight
      ? clamp(minus(minus(1, base), times(minus(1, x), minus(1, base))), 0, 1)
      : clamp(plus(base, times(x, minus(1, base))), 0, 1),
  ) as [number, number, number, number];
}
/** A source branch requiring an unported/special asset stage is explicit, never a fabricated geometry result. */
export class CS2NetworkGeometryPending extends Error {
  constructor(
    public readonly dependency: string,
    public readonly entity: string,
  ) {
    super(`Pending GeometrySystem ${dependency} on ${entity}`);
    this.name = "CS2NetworkGeometryPending";
  }
}
function targetSegments(
  w: CS2NetworkGeometryWorld,
  edge: string,
  node: string,
  offset: V,
  middle: V,
  g: CS2NetworkPrefabGeometry,
) {
  const lateral = { x: offset.z, y: 0, z: -offset.x };
  let leftRank = -2,
    rightRank = 2,
    left = zeroSegment(),
    right = zeroSegment(),
    leftItem: { edge: string; end: boolean } | undefined,
    rightItem: { edge: string; end: boolean } | undefined,
    distances: [number, number] = [0, 0];
  for (const item of cs2NetworkGeometryEdges(w, edge, node, true)) {
    if (item.middle) {
      if (g.mergeLayers & (0x80 | 0x2000))
        throw new CS2NetworkGeometryPending(
          "pathway middle connection",
          item.edge,
        );
      continue;
    }
    const composition = required(w.compositions, item.edge, "Composition"),
      data = required(w.edgeGeometry, item.edge, "EdgeGeometry"),
      ec = comp(w, composition.edge),
      nc = clone(
        comp(w, item.end ? composition.endNode : composition.startNode),
      );
    let segment = item.end ? invertedSegment(data.end) : clone(data.start);
    nc.middleOffset = -nc.middleOffset;
    adjustWidth(segment, ec, nc, item.end);
    let t = plus(0.5, divide(nc.middleOffset, max(f(0.01), nc.width)));
    const direction = nodeOffset(segment, middle);
    const setLeft = () => {
        left = clone(segment);
        left.right = curveMix(left.left, left.right, t);
        leftItem = item;
        distances[0] = plus(times(nc.width, 0.5), nc.middleOffset);
      },
      setRight = () => {
        right = clone(segment);
        right.left = curveMix(right.left, right.right, t);
        rightItem = item;
        distances[1] = minus(times(nc.width, 0.5), nc.middleOffset);
      };
    if (item.edge === edge) {
      if (g.mergeLayers === 0)
        throw new CS2NetworkGeometryPending(
          "non-merging/outside reflected node",
          node,
        );
      if (leftRank < -1) setLeft();
      if (rightRank > 1) setRight();
    } else {
      const other = geom(w, item.edge);
      if ((other.mergeLayers & g.mergeLayers) === 0) {
        if (g.mergeLayers & (0x80 | 0x2000))
          throw new CS2NetworkGeometryPending(
            "pathway side connection",
            item.edge,
          );
        continue;
      }
      const dot = dot2(lateral, direction),
        rank =
          dot2(offset, direction) < 0
            ? times(dot, 0.5)
            : minus(dot >= 0 ? 1 : -1, times(dot, 0.5));
      if (rank > leftRank) {
        leftRank = rank;
        setLeft();
      }
      if (rank < rightRank) {
        rightRank = rank;
        setRight();
      }
    }
  }
  const sync = (
    item: { edge: string; end: boolean } | undefined,
    isLeft: boolean,
  ) => {
    if (!item)
      return [0, f(1 / 3), f(2 / 3), 1] as [number, number, number, number];
    const c = required(w.compositions, item.edge, "Composition"),
      n = comp(w, item.end ? c.endNode : c.startNode),
      array = isLeft ? n.syncVertexOffsetsRight : n.syncVertexOffsetsLeft;
    return [...array].reverse().map((x) => minus(1, x)) as [
      number,
      number,
      number,
      number,
    ];
  };
  return {
    left,
    right,
    distances,
    syncLeft: sync(leftItem, true),
    syncRight: sync(rightItem, false),
  };
}
/** CalculateNodeGeometryJob ordinary merging road branches. Special branches suspend explicitly. */
export function cs2CalculateNetworkNodeGeometry(
  w: CS2NetworkGeometryWorld,
  edges: readonly string[],
  iteration: 0 | 1,
) {
  for (const edge of edges) {
    const a = clone(required(w.startNodeGeometry, edge, "StartNodeGeometry")),
      b = clone(required(w.endNodeGeometry, edge, "EndNodeGeometry"));
    if (
      iteration === 1 &&
      [
        ...a.left.length,
        ...a.right.length,
        ...b.left.length,
        ...b.right.length,
      ].every((x) => x >= 0)
    )
      continue;
    const endpoints = required(w.edges, edge, "Edge"),
      composition = required(w.compositions, edge, "Composition"),
      data = required(w.edgeGeometry, edge, "EdgeGeometry"),
      g = geom(w, edge),
      ec = comp(w, composition.edge),
      nc = [comp(w, composition.startNode), comp(w, composition.endNode)];
    for (const [index, node] of [endpoints.start, endpoints.end].entries()) {
      const c = nc[index],
        value = index === 0 ? a : b;
      if (c.flags.general & (0x40 | 0x800000))
        throw new CS2NetworkGeometryPending(
          "roundabout/straight-node geometry",
          node,
        );
      if (value.middleRadius > 0)
        throw new CS2NetworkGeometryPending(
          "roundabout segment geometry",
          node,
        );
      const middle = middleNode(w, edge, node);
      middle.y = required(w.nodeGeometry, node, "NodeGeometry").position;
      const source = index === 0 ? data.start : data.end,
        offset = nodeOffset(source, middle, index === 1),
        targets = targetSegments(w, edge, node, offset, middle, g);
      let segment = index === 0 ? invertedSegment(data.start) : clone(data.end);
      adjustWidth(segment, ec, c, index === 0);
      const second = clone(segment),
        t = plus(divide(c.middleOffset, max(f(0.01), c.width)), 0.5);
      segment.right = curveMix(segment.left, segment.right, t);
      second.left = curveMix(second.left, second.right, t);
      const left = middleSegment(segment, targets.left),
        right = middleSegment(second, targets.right);
      value.left = left.segment;
      value.right = right.segment;
      value.middle = zeroCurve();
      const startDistances = [
        plus(times(c.width, 0.5), c.middleOffset),
        minus(times(c.width, 0.5), c.middleOffset),
      ];
      value.syncVertexTargetsLeft = vertexSync(
        value.left,
        startDistances[0],
        targets.distances[0],
        c.syncVertexOffsetsLeft,
        targets.syncLeft,
        left.div[1],
        false,
      );
      value.syncVertexTargetsRight = vertexSync(
        value.right,
        startDistances[1],
        targets.distances[1],
        c.syncVertexOffsetsRight,
        targets.syncRight,
        right.div[0],
        true,
      );
    }
    w.startNodeGeometry.set(edge, a);
    w.endNodeGeometry.set(edge, b);
  }
}
/** Full CalculateIntersectionGeometryJob + CopyNodeGeometryJob. Local flattening deliberately only affects buffered middle/bounds. */
export function cs2CalculateNetworkIntersectionGeometry(
  w: CS2NetworkGeometryWorld,
  edges: readonly string[],
) {
  const buffered: {
    edge: string;
    startMiddle: CS2RoadCurve;
    endMiddle: CS2RoadCurve;
    startBounds: CS2RoadBounds;
    endBounds: CS2RoadBounds;
  }[] = [];
  const flattenCurve = (curve: CS2RoadCurve, height: number) => {
    curve[2].y = plus(curve[2].y, minus(height, curve[3].y));
    curve[3].y = height;
  };
  const flatten = (
    geometry: CS2NetworkEdgeNodeGeometry,
    middle: V,
    all: boolean,
  ) => {
    if (all) {
      for (const side of [geometry.left, geometry.right])
        for (const c of [side.left, side.right]) flattenCurve(c, middle.y);
      return;
    }
    const a = dist2(geometry.left.left[3], middle),
      b = dist2(geometry.left.right[3], middle),
      c = dist2(geometry.right.left[3], middle),
      d = dist2(geometry.right.right[3], middle);
    flattenCurve(
      geometry.left.right,
      lerp(middle.y, geometry.left.left[3].y, clamp(divide(b, a), 0, 1)),
    );
    flattenCurve(
      geometry.right.left,
      lerp(middle.y, geometry.right.right[3].y, clamp(divide(c, d), 0, 1)),
    );
  };
  const intersection = (
    edge: string,
    node: string,
    g: CS2NetworkPrefabGeometry,
  ) => {
    let result = vzero(),
      count = 0;
    for (const item of cs2NetworkGeometryEdges(w, edge, node)) {
      const ng = required(
        item.end ? w.endNodeGeometry : w.startNodeGeometry,
        item.edge,
        item.end ? "EndNodeGeometry" : "StartNodeGeometry",
      );
      if (
        item.edge !== edge &&
        (geom(w, item.edge).mergeLayers & g.mergeLayers) === 0
      )
        continue;
      result = add(result, mix(ng.left.right[3], ng.right.left[3], 0.5));
      count = plus(count, 1);
    }
    return count === 0 ? result : mul(result, divide(1, count));
  };
  const move = (curve: CS2RoadCurve, p: V) => {
    const d = sub(curve[3], p),
      distance = f(
        Math.sqrt(
          plus(plus(times(d.x, d.x), times(d.y, d.y)), times(d.z, d.z)),
        ),
      ),
      normalize3 = (v: V) => {
        const length = f(
          Math.sqrt(
            plus(plus(times(v.x, v.x), times(v.y, v.y)), times(v.z, v.z)),
          ),
        );
        return length > f(1.0842021724855044e-19)
          ? mul(v, divide(1, length))
          : vzero();
      },
      third = times(distance, f(1 / 3)),
      b = add(curve[1], mul(normalize3(sub(curve[1], curve[0])), third)),
      c = add(
        add(p, sub(curve[2], curve[3])),
        mul(normalize3(sub(curve[2], curve[3])), third),
      );
    Object.assign(curve[1], b);
    Object.assign(curve[2], c);
    Object.assign(curve[3], p);
  };
  for (const edge of edges) {
    const endpoints = required(w.edges, edge, "Edge"),
      composition = required(w.compositions, edge, "Composition"),
      g = geom(w, edge),
      a = clone(required(w.startNodeGeometry, edge, "StartNodeGeometry")),
      b = clone(required(w.endNodeGeometry, edge, "EndNodeGeometry")),
      nc = [comp(w, composition.startNode), comp(w, composition.endNode)];
    const values = [a, b],
      middles: CS2RoadCurve[] = [],
      bounds: CS2RoadBounds[] = [];
    for (let index = 0; index < 2; index++) {
      const node = index === 0 ? endpoints.start : endpoints.end,
        c = nc[index],
        value = values[index],
        ng = required(w.nodeGeometry, node, "NodeGeometry"),
        flat = (c.flags.general & 0x4000c0) !== 0;
      let middle: V;
      if (value.middleRadius > 0) {
        middle = clone(required(w.nodes, node, "Node"));
        middle.y = ng.position;
      } else {
        middle = intersection(edge, node, g);
        if (flat) middle.y = ng.position;
        flatten(value, middle, flat);
      }
      let center: CS2RoadCurve;
      if (value.middleRadius > 0) {
        center = curveMix(
          value.left.left,
          value.left.right,
          plus(divide(c.middleOffset, max(f(0.01), c.width)), 0.5),
        );
        move(center, middle);
      } else {
        const marked = value.middle[3].x !== 0 && value.middle[3].y !== 0;
        center = curveMix(value.left.right, value.right.left, 0.5);
        if (!marked) Object.assign(center[3], middle);
      }
      middles.push(center);
      let box: CS2RoadBounds;
      if (g.mergeLayers === 0) {
        const p = mix(value.left.left[0], value.right.right[0], 0.5),
          half = times(c.width, 0.5);
        box = {
          min: { x: minus(p.x, half), y: p.y, z: minus(p.z, half) },
          max: { x: plus(p.x, half), y: p.y, z: plus(p.z, half) },
        };
      } else
        box = [
          value.left.left,
          value.left.right,
          value.right.left,
          value.right.right,
          center,
        ]
          .map(cs2NetworkCurveTightBounds)
          .reduce(union);
      box.min.y = plus(box.min.y, c.heightRange[0]);
      box.max.y = plus(box.max.y, c.heightRange[1]);
      if (c.state & (LowerToTerrain | RaiseToTerrain)) {
        const curves = [value.left.left, value.right.right];
        if (value.middleRadius > 0)
          curves.push(value.left.right, value.right.left);
        const terrain = curves.map((c) => sampleCurve(w, c));
        if (c.state & LowerToTerrain)
          box.min.y = min(
            box.min.y,
            terrain.reduce((a, b) => min(a, b[0]), Infinity),
          );
        if (c.state & RaiseToTerrain)
          box.max.y = max(
            box.max.y,
            terrain.reduce((a, b) => max(a, b[1]), -Infinity),
          );
      }
      bounds.push(box);
    }
    buffered.push({
      edge,
      startMiddle: middles[0],
      endMiddle: middles[1],
      startBounds: bounds[0],
      endBounds: bounds[1],
    });
  }
  for (const value of buffered) {
    const a = clone(
        required(w.startNodeGeometry, value.edge, "StartNodeGeometry"),
      ),
      b = clone(required(w.endNodeGeometry, value.edge, "EndNodeGeometry"));
    a.middle = value.startMiddle;
    a.bounds = value.startBounds;
    b.middle = value.endMiddle;
    b.bounds = value.endBounds;
    w.startNodeGeometry.set(value.edge, a);
    w.endNodeGeometry.set(value.edge, b);
  }
}
function divideCurve(c: CS2RoadCurve, t: number): [CS2RoadCurve, CS2RoadCurve] {
  const m = mix(c[1], c[2], t),
    a = mix(c[0], c[1], t),
    d = mix(c[2], c[3], t),
    b = mix(a, m, t),
    e = mix(m, d, t),
    p = mix(b, e, t);
  return [
    [clone(c[0]), a, b, p],
    [clone(p), e, d, clone(c[3])],
  ];
}
function cutCurve(c: CS2RoadCurve, lo: number, hi: number): CS2RoadCurve {
  return [
    [lo, lo, lo],
    [lo, lo, hi],
    [lo, hi, hi],
    [hi, hi, hi],
  ].map(([x, y, z]) => {
    const a = minus(1, x),
      b = minus(1, y),
      d = minus(1, z),
      w0 = times(times(a, b), d),
      w1 = plus(
        plus(times(times(x, b), d), times(times(a, y), d)),
        times(times(a, b), z),
      ),
      w2 = plus(
        plus(times(times(x, y), d), times(times(a, y), z)),
        times(times(x, b), z),
      ),
      w3 = times(times(x, y), z);
    return add(
      add(add(mul(c[0], w0), mul(c[1], w1)), mul(c[2], w2)),
      mul(c[3], w3),
    );
  }) as unknown as CS2RoadCurve;
}
function position2(c: CS2RoadCurve, t: number): V {
  const u = minus(1, t),
    three = times(3, t),
    w = [
      times(times(u, u), u),
      times(times(three, u), u),
      times(times(three, t), u),
      times(times(t, t), t),
    ];
  return {
    x: plus(
      plus(times(c[0].x, w[0]), times(c[2].x, w[2])),
      plus(times(c[1].x, w[1]), times(c[3].x, w[3])),
    ),
    y: 0,
    z: plus(
      plus(times(c[0].z, w[0]), times(c[2].z, w[2])),
      plus(times(c[1].z, w[1]), times(c[3].z, w[3])),
    ),
  };
}
function tangent2(c: CS2RoadCurve, t: number): V {
  const u = minus(1, t),
    three = times(3, t),
    w = [
      times(times(u, minus(-1, -t)), 3),
      times(times(u, minus(1, three)), 3),
      times(times(t, minus(2, three)), 3),
      times(times(t, t), 3),
    ];
  return {
    x: plus(
      plus(times(c[0].x, w[0]), times(c[2].x, w[2])),
      plus(times(c[1].x, w[1]), times(c[3].x, w[3])),
    ),
    y: 0,
    z: plus(
      plus(times(c[0].z, w[0]), times(c[2].z, w[2])),
      plus(times(c[1].z, w[1]), times(c[3].z, w[3])),
    ),
  };
}
function rangeLength(c: CS2RoadCurve, lo = 0, hi = 1, d2 = true) {
  const step = divide(minus(hi, lo), 16);
  let previous = d2 ? position2(c, lo) : cs2RoadCurvePosition(c, lo),
    length = 0;
  for (let i = 1; i <= 16; i++) {
    const p = d2
        ? position2(c, plus(lo, times(i, step)))
        : cs2RoadCurvePosition(c, plus(lo, times(i, step))),
      v = sub(p, previous),
      distance = d2
        ? len2(v)
        : f(
            Math.sqrt(
              plus(plus(times(v.x, v.x), times(v.y, v.y)), times(v.z, v.z)),
            ),
          );
    length = plus(length, distance);
    previous = p;
  }
  return length;
}
function clampLength(
  c: CS2RoadCurve,
  lo: number,
  hi: number,
  length: number,
  d2 = false,
): { end: number; complete: boolean } {
  if (length === 0) return { end: lo, complete: true };
  const step = divide(minus(hi, lo), 16);
  let a = lo,
    total = 0,
    previous = d2 ? position2(c, lo) : cs2RoadCurvePosition(c, lo);
  for (let i = 1; i <= 16; i++) {
    const b = plus(a, step),
      p = d2 ? position2(c, b) : cs2RoadCurvePosition(c, b),
      v = sub(p, previous),
      dist = d2
        ? len2(v)
        : f(
            Math.sqrt(
              plus(plus(times(v.x, v.x), times(v.y, v.y)), times(v.z, v.z)),
            ),
          ),
      next = plus(total, dist);
    if (next >= length)
      return {
        end: clamp(
          lerp(a, b, divide(minus(length, total), minus(next, total))),
          min(lo, hi),
          max(lo, hi),
        ),
        complete: true,
      };
    a = b;
    previous = p;
    total = next;
  }
  return { end: hi, complete: false };
}
function controlBounds(c: CS2RoadCurve) {
  return {
    min: {
      x: min(min(c[0].x, c[1].x), min(c[2].x, c[3].x)),
      z: min(min(c[0].z, c[1].z), min(c[2].z, c[3].z)),
    },
    max: {
      x: max(max(c[0].x, c[1].x), max(c[2].x, c[3].x)),
      z: max(max(c[0].z, c[1].z), max(c[2].z, c[3].z)),
    },
  };
}
function lineParams(a: V, b: V, c: V, d: V): [number, number] | undefined {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c),
    det = minus(times(u.x, v.z), times(u.z, v.x));
  if (det === 0) return;
  return [
    divide(minus(times(w.z, v.x), times(w.x, v.z)), det),
    divide(minus(times(w.z, u.x), times(w.x, u.z)), det),
  ];
}
function intersectCurves(
  a: CS2RoadCurve,
  b: CS2RoadCurve,
  iterations = 4,
): [number, number] | undefined {
  const x = controlBounds(a),
    y = controlBounds(b);
  if (
    x.min.x > y.max.x ||
    y.min.x > x.max.x ||
    x.min.z > y.max.z ||
    y.min.z > x.max.z
  )
    return;
  if (iterations <= 0) {
    const t = lineParams(a[0], a[3], b[0], b[3]);
    if (!t) return;
    const p = mix(a[0], a[3], t[0]);
    if (
      p.x >= x.min.x &&
      p.x >= y.min.x &&
      p.x <= x.max.x &&
      p.x <= y.max.x &&
      p.z >= x.min.z &&
      p.z >= y.min.z &&
      p.z <= x.max.z &&
      p.z <= y.max.z
    )
      return [clamp(t[0], 0, 1), clamp(t[1], 0, 1)];
    return;
  }
  const aa = divideCurve(a, 0.5),
    bb = divideCurve(b, 0.5);
  for (const [i, j] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]) {
    const t = intersectCurves(aa[i], bb[j], iterations - 1);
    if (t)
      return [
        plus(times(t[0], 0.5), times(i, 0.5)),
        plus(times(t[1], 0.5), times(j, 0.5)),
      ];
  }
}
function intersectLine(
  curve: CS2RoadCurve,
  a: V,
  b: V,
  iterations = 4,
): [number, number] | undefined {
  const x = controlBounds(curve),
    lo = { x: min(a.x, b.x), z: min(a.z, b.z) },
    hi = { x: max(a.x, b.x), z: max(a.z, b.z) };
  if (x.min.x > hi.x || lo.x > x.max.x || x.min.z > hi.z || lo.z > x.max.z)
    return;
  if (iterations <= 0) {
    const t = lineParams(a, b, curve[0], curve[3]);
    if (!t) return;
    const u = sub(b, a),
      v = sub(curve[3], curve[0]),
      product = [times(u.x, v.z), times(u.z, v.x)],
      det = minus(product[0], product[1]);
    if (
      t[0] < 0 ||
      t[0] > 1 ||
      Math.abs(det) <
        times(plus(Math.abs(product[0]), Math.abs(product[1])), f(1.1920929e-7))
    )
      return;
    const p = mix(curve[0], curve[3], t[1]);
    if (
      p.x >= x.min.x &&
      p.x >= lo.x &&
      p.x <= x.max.x &&
      p.x <= hi.x &&
      p.z >= x.min.z &&
      p.z >= lo.z &&
      p.z <= x.max.z &&
      p.z <= hi.z
    )
      return [clamp(t[1], 0, 1), clamp(t[0], 0, 1)];
    return;
  }
  const [left, right] = divideCurve(curve, 0.5),
    first = intersectLine(left, a, b, iterations - 1);
  if (first) return [times(first[0], 0.5), first[1]];
  const second = intersectLine(right, a, b, iterations - 1);
  if (second) return [plus(0.5, times(second[0], 0.5)), second[1]];
}
function combinedPosition(start: CS2RoadCurve, end: CS2RoadCurve, t: number) {
  return t < 1
    ? position2(start, max(0, t))
    : position2(end, min(1, minus(t, 1)));
}
function combinedTangent(start: CS2RoadCurve, end: CS2RoadCurve, t: number) {
  return t < 1
    ? tangent2(start, max(0, t))
    : tangent2(end, min(1, minus(t, 1)));
}
function intersectCombined(
  start: CS2RoadCurve,
  end: CS2RoadCurve,
  node: CS2RoadCurve,
  otherStart: CS2RoadCurve,
  otherEnd: CS2RoadCurve,
): [number, number] {
  let result: [number, number] = [0, 0];
  for (const [a, b, x, y] of [
    [start, node, 0, -1],
    [start, otherStart, 0, 0],
    [start, otherEnd, 0, 1],
    [end, node, 1, -1],
    [end, otherStart, 1, 0],
    [end, otherEnd, 1, 1],
  ] as const) {
    const t = intersectCurves(a, b);
    if (t) {
      const value: [number, number] = [plus(t[0], x), plus(t[1], y)];
      if (value[0] > result[0]) result = value;
    }
  }
  return result;
}
function oppositeSide(
  start: CS2RoadCurve,
  end: CS2RoadCurve,
  otherStart: CS2RoadCurve,
  otherEnd: CS2RoadCurve,
  intersect: V,
  opposite: V,
  t: number,
  otherT: number,
) {
  const p = combinedPosition(start, end, t),
    tangent = normalize(combinedTangent(start, end, t)),
    q = combinedPosition(otherStart, otherEnd, t),
    across = normalize(sub(p, q)),
    r = combinedPosition(otherStart, otherEnd, otherT),
    otherTangent = normalize(combinedTangent(otherStart, otherEnd, otherT)),
    toOther = normalize(sub(r, p));
  intersect = normalize(intersect);
  opposite = normalize(opposite);
  const toward = dot2(intersect, tangent);
  let cross = dot2(intersect, across),
    minimum = t;
  const lineEnd = sub(r, mul(opposite, times(dist2(p, q), 3))),
    first = intersectLine(start, r, lineEnd),
    second = intersectLine(end, r, lineEnd);
  if (first) minimum = max(minimum, first[0]);
  if (second) minimum = max(minimum, plus(second[0], 1));
  if (toward > 0 && cross > 0) cross = 1;
  let x = 0;
  const a = f(Math.acos(clamp(dot2(otherTangent, toOther), 0, 1))),
    b = f(Math.acos(clamp(dot2(tangent, toOther), 0, 1)));
  let angle = divide(f(Math.PI), 2);
  if (b > f(0.0001))
    angle = min(angle, times(divide(f(Math.sin(a)), f(Math.tan(b))), a));
  if (angle > b && a > b)
    x = lerp(
      t,
      otherT,
      divide(minus(angle, b), minus(divide(f(Math.PI), 2), b)),
    );
  t = lerp(minimum, t, clamp(cross, 0, 1));
  t = lerp(t, otherT, clamp(dot2(intersect, opposite), 0, 1));
  return min(otherT, max(x, t));
}
function laneLimits(
  w: CS2NetworkGeometryWorld,
  lanes: readonly CS2NetworkCompositionLane[],
  isEnd: boolean,
  invert: boolean,
) {
  const unset = [1e6, -1e6, 1e6, -1e6],
    low = [1e6, 1e6, 1e6, 1e6],
    high = [-1e6, -1e6, -1e6, -1e6],
    track = [...unset],
    master = [0, 0];
  let current = [...unset],
    carriageway = -1;
  const merge = () => {
    for (let i = 0; i < 4; i++) {
      if (current[i] < low[i] && current[i] !== unset[i]) low[i] = current[i];
      if (current[i] > high[i] && current[i] !== unset[i]) high[i] = current[i];
    }
  };
  for (const lane of lanes) {
    const disconnected = ((lane.flags & 1) !== 0) !== isEnd ? 0x200 : 0x100;
    if (lane.flags & disconnected) continue;
    const p = invert ? -lane.position.x : lane.position.x;
    if (lane.flags & 8) {
      if (lane.flags & 4) {
        const width =
          lane.lane === null ? undefined : w.prefabLaneWidths.get(lane.lane);
        if (width !== undefined) {
          if (lane.flags & 0x80) {
            master[0] = max(master[0], width);
            master[1] = max(master[1], width);
          } else if (((lane.flags & 1) !== 0) === invert)
            master[0] = max(master[0], width);
          else master[1] = max(master[1], width);
        }
        continue;
      }
      if (lane.carriageway !== carriageway) {
        merge();
        current = [...unset];
        carriageway = lane.carriageway;
      }
      const indices =
        lane.flags & 0x80
          ? [0, 1, 2, 3]
          : ((lane.flags & 1) !== 0) === invert
            ? [0, 1]
            : [2, 3];
      for (const i of indices)
        current[i] = i % 2 === 0 ? min(current[i], p) : max(current[i], p);
    } else if (lane.flags & 0x40) {
      const indices =
        lane.flags & 0x80
          ? [0, 1, 2, 3]
          : ((lane.flags & 1) !== 0) === invert
            ? [0, 1]
            : [2, 3];
      for (const i of indices)
        track[i] = i % 2 === 0 ? min(track[i], p) : max(track[i], p);
    }
  }
  merge();
  return { low, high, track, master };
}
function compareLanes(
  w: CS2NetworkGeometryWorld,
  a: readonly CS2NetworkCompositionLane[],
  b: readonly CS2NetworkCompositionLane[],
  offset: number,
  endA: boolean,
  endB: boolean,
  dontCrossTracks: boolean,
) {
  const x = laneLimits(w, a, endA, !endA),
    y = laneLimits(w, b, endB, endB);
  let road = 0,
    track = 0;
  for (let i = 0; i < 4; i++) {
    const differences = [
      Math.abs(plus(minus(x.low[i], y.low[i]), offset)),
      Math.abs(plus(minus(x.low[i], y.high[i]), offset)),
      Math.abs(plus(minus(x.high[i], y.low[i]), offset)),
      Math.abs(plus(minus(x.high[i], y.high[i]), offset)),
    ];
    if (Math.abs(x.low[i]) <= 1e5 && Math.abs(y.low[i]) <= 1e5)
      road = max(
        road,
        max(
          max(differences[0], differences[1]),
          max(differences[2], differences[3]),
        ),
      );
    const j = i % 2 === 0 ? i + 1 : i - 1,
      first =
        Math.abs(x.track[i]) > 1e5 || Math.abs(y.track[i]) > 1e5
          ? 0
          : Math.abs(plus(minus(x.track[i], y.track[i]), offset)),
      second = dontCrossTracks
        ? first
        : Math.abs(x.track[i]) > 1e5 || Math.abs(y.track[j]) > 1e5
          ? 0
          : Math.abs(plus(minus(x.track[i], y.track[j]), offset));
    track = max(track, max(first, second));
  }
  let master = times(
    max(max(x.master[0], y.master[0]), max(x.master[1], y.master[1])),
    0.5,
  );
  if (x.master.every((v, i) => (v === 0) === (y.master[i] === 0))) master = 0;
  road = max(road, master);
  return max(times(f(Math.sqrt(road)), 3), times(f(Math.sqrt(track)), 4));
}
function transition(
  a: CS2NetworkComposition,
  b: CS2NetworkComposition,
  ea: CS2NetworkComposition,
  eb: CS2NetworkComposition,
) {
  if (
    Math.abs(minus(a.heightRange[0], b.heightRange[0])) > f(0.1) ||
    Math.abs(minus(a.heightRange[1], b.heightRange[1])) > f(0.1)
  )
    return true;
  if (
    (a.flags.general | b.flags.general) & 0x40000000 ||
    (a.flags.left | b.flags.left | a.flags.right | b.flags.right) & 12
  )
    return true;
  return (ea.flags.general & 0xe000000) !== (eb.flags.general & 0xe000000);
}
function topOwner(w: CS2NetworkGeometryWorld, entity: string) {
  let current = entity,
    result: string | null = null;
  const seen = new Set<string>();
  while (w.owners.has(current)) {
    if (seen.has(current)) throw new Error("Cyclic Owner chain");
    seen.add(current);
    current = w.owners.get(current)!;
    result = current;
    const original = w.temps.get(current)?.original;
    if (original) {
      current = original;
      result = current;
    }
  }
  return result;
}
function cutForNodes(
  w: CS2NetworkGeometryWorld,
  edge: { start: string; end: string },
  curve: CS2RoadCurve,
): CS2RoadCurve {
  const a = required(w.nodes, edge.start, "Node"),
    b = required(w.nodes, edge.end, "Node");
  let lo = cs2RoadCurveDistanceXZ(curve, { x: a.x, y: a.z }).t,
    hi = cs2RoadCurveDistanceXZ(curve, { x: b.x, y: b.z }).t;
  if (lo < f(0.001)) lo = 0;
  if (hi > f(0.999)) hi = 1;
  if (lo !== 0 || hi !== 1) {
    if (hi < plus(lo, 0.02)) {
      lo = hi = times(plus(lo, hi), 0.5);
      lo = max(0, minus(lo, 0.01));
      hi = min(1, plus(hi, 0.01));
    }
    const output = cutCurve(curve, lo, hi);
    output[0].y = a.y;
    output[3].y = b.y;
    return output;
  }
  return clone(curve);
}
function cornerOffset(
  w: CS2NetworkGeometryWorld,
  entity: string,
  node: string,
  slope: number,
  useWidth: readonly boolean[],
  original: CS2RoadCurve,
  leftStart: CS2RoadCurve,
  rightStart: CS2RoadCurve,
  leftEnd: CS2RoadCurve,
  rightEnd: CS2RoadCurve,
  ecInput: CS2NetworkComposition,
  nc: CS2NetworkComposition,
  bOffset: number,
  isEnd: boolean,
) {
  let result: [number, number] = [0, 0],
    leftTarget = vzero(),
    rightTarget = vzero(),
    ec = clone(ecInput);
  const current = clone(isEnd ? invert(original) : original);
  if (isEnd) ec.middleOffset = -ec.middleOffset;
  const tangentLeft = normalize({ ...startTangent(leftStart), y: 0 }),
    tangentRight = normalize({ ...startTangent(rightStart), y: 0 }),
    side = normalize({ ...sub(leftStart[0], rightStart[0]), y: 0 });
  let bestLeft = vzero(),
    bestRight = vzero(),
    distance = [-f(3.4028234663852886e38), -f(3.4028234663852886e38)],
    extra = [0, 0],
    minimum = geom(w, entity).minNodeOffset,
    needsNode = false,
    first = true;
  const nodeOffset = max(ec.nodeOffset, nc.nodeOffset),
    slopeOffset = plus(
      nodeOffset,
      times(times(Math.abs(slope), nc.width), 0.25),
    ),
    g = geom(w, entity),
    prefab = required(w.prefabRefs, entity, "PrefabRef");
  for (const item of cs2NetworkGeometryEdges(w, entity, node)) {
    if (item.edge === entity) continue;
    const otherG = geom(w, item.edge);
    if ((otherG.intersectLayers & g.intersectLayers) === 0) continue;
    const endpoints = required(w.edges, item.edge, "Edge"),
      composition = required(w.compositions, item.edge, "Composition"),
      otherEC = clone(comp(w, composition.edge)),
      otherNC = clone(
        comp(w, item.end ? composition.endNode : composition.startNode),
      ),
      lanes = required(
        w.prefabCompositionLanes,
        composition.edge,
        "NetCompositionLane",
      ),
      crosswalks = required(
        w.prefabCompositionCrosswalks,
        item.end ? composition.endNode : composition.startNode,
        "NetCompositionCrosswalk",
      );
    if (item.end) otherEC.middleOffset = -otherEC.middleOffset;
    const owner = w.owners.get(item.edge),
      ownerC = owner ? w.compositions.get(owner) : undefined;
    if (ownerC) {
      const c = comp(w, ownerC.edge);
      otherEC.widthOffset = max(otherEC.widthOffset, c.widthOffset);
      otherNC.widthOffset = max(otherNC.widthOffset, c.widthOffset);
    }
    let other = cutForNodes(
        w,
        endpoints,
        required(w.curves, item.edge, "Curve").bezier,
      ),
      halves = divideCurve(other, middleTangent(other));
    if (item.end) {
      other = invert(other);
      halves = [invert(halves[1]), invert(halves[0])];
    }
    other[0].y = current[0].y;
    halves[0][0].y = current[0].y;
    halves[0][1].y = plus(halves[0][1].y, bOffset);
    let transitionNode = false;
    if ((otherG.mergeLayers & g.mergeLayers) !== 0) {
      minimum = max(minimum, otherG.minNodeOffset);
      const otherTangent = direction(startTangent(halves[0])),
        otherSlope = -otherTangent.y,
        projected = [
          dot2(sub(other[0], leftStart[0]), tangentLeft),
          dot2(sub(other[0], rightStart[0]), tangentRight),
        ];
      distance = distance.map((x, i) => max(x, times(projected[i], 0.5)));
      const slopeDifference = times(
          Math.abs(minus(slope, otherSlope)),
          nc.width,
        ),
        dontCross =
          ((ec.state | otherEC.state) & 0x180) !== 0 &&
          ((ec.state | otherEC.state) & 0x48) === 0 &&
          (nc.flags.general & 0x20) === 0 &&
          topOwner(w, entity) === topOwner(w, item.edge),
        a = nc.syncVertexOffsetsLeft.map((x) =>
          times(minus(1, x), plus(times(nc.width, 0.5), nc.middleOffset)),
        ),
        b = nc.syncVertexOffsetsRight.map((x) =>
          times(x, minus(times(nc.width, 0.5), nc.middleOffset)),
        ),
        c = [...otherNC.syncVertexOffsetsLeft]
          .reverse()
          .map((x) =>
            times(
              minus(1, x),
              plus(times(otherNC.width, 0.5), otherNC.middleOffset),
            ),
          ),
        d = [...otherNC.syncVertexOffsetsRight]
          .reverse()
          .map((x) =>
            times(x, minus(times(otherNC.width, 0.5), otherNC.middleOffset)),
          ),
        widthA = [
          plus(times(ec.width, 0.5), ec.middleOffset),
          minus(times(ec.width, 0.5), ec.middleOffset),
        ],
        widthB = [
          minus(times(otherEC.width, 0.5), otherEC.middleOffset),
          plus(times(otherEC.width, 0.5), otherEC.middleOffset),
        ],
        lateral = dot2(sub(current[0], other[0]), side);
      let differences = [
        a
          .map((x, i) => Math.abs(plus(minus(x, d[i]), lateral)))
          .reduce(max, -Infinity),
        b
          .map((x, i) => Math.abs(minus(minus(x, c[i]), lateral)))
          .reduce(max, -Infinity),
      ];
      differences = differences.map((x, i) =>
        max(
          x,
          Math.abs(
            plus(minus(widthA[i], widthB[i]), i === 0 ? lateral : -lateral),
          ),
        ),
      );
      const width = max(f(0.1), min(ec.width, otherEC.width)),
        laneOffset = compareLanes(
          w,
          required(
            w.prefabCompositionLanes,
            required(w.compositions, entity, "Composition").edge,
            "NetCompositionLane",
          ),
          lanes,
          lateral,
          isEnd,
          item.end,
          dontCross,
        );
      differences = differences.map((x) =>
        max(times(x, divide(width, plus(width, times(x, 0.75)))), laneOffset),
      );
      const check = (walks: readonly { start: V; end: V }[]) =>
        walks.reduce((x, c) => max(x, max(c.start.z, c.end.z)), 0);
      if (nc.flags.general & 0x100)
        differences = differences.map((x) =>
          max(
            x,
            check(
              required(
                w.prefabCompositionCrosswalks,
                required(w.compositions, entity, "Composition")[
                  isEnd ? "endNode" : "startNode"
                ],
                "NetCompositionCrosswalk",
              ),
            ),
          ),
        );
      if (otherNC.flags.general & 0x100)
        differences = differences.map((x) => max(x, check(crosswalks)));
      const opposite = dot2(otherTangent, mul(tangentLeft, -1));
      differences = differences.map((x) => times(x, max(0, opposite)));
      if (slopeDifference > f(0.2))
        extra = extra.map((x) => max(x, slopeDifference));
      if (required(w.prefabRefs, item.edge, "PrefabRef") !== prefab)
        extra = extra.map((x) => max(x, nodeOffset));
      if (differences.some((x) => x > f(0.1))) {
        extra = extra.map((x, i) => max(x, differences[i]));
        transitionNode = true;
      }
      const delta = sub(other[0], current[0]);
      if (dot2(delta, delta) > f(0.01) || opposite < f(0.9995)) {
        transitionNode = true;
        needsNode = true;
      } else if (transition(nc, otherNC, ec, otherEC)) transitionNode = true;
      if (transitionNode) {
        otherNC.width = plus(otherNC.width, times(slopeOffset, 2));
        otherNC.width = plus(otherNC.width, otherNC.widthOffset);
      }
      if (!first) needsNode = true;
    } else {
      transitionNode = true;
      needsNode = true;
      otherNC.width = plus(otherNC.width, times(nodeOffset, 2));
      otherNC.width = plus(otherNC.width, otherNC.widthOffset);
    }
    let offsets = [
      minus(times(otherNC.width, 0.5), otherNC.middleOffset),
      minus(times(otherNC.width, -0.5), otherNC.middleOffset),
    ];
    if (useWidth.some(Boolean)) {
      if (transitionNode) {
        otherEC.width = plus(
          otherEC.width,
          times(
            (otherG.mergeLayers & g.mergeLayers) !== 0
              ? slopeOffset
              : nodeOffset,
            2,
          ),
        );
        otherEC.width = plus(otherEC.width, otherEC.widthOffset);
      }
      const widths = [
        minus(times(otherEC.width, 0.5), otherEC.middleOffset),
        minus(times(otherEC.width, -0.5), otherEC.middleOffset),
      ];
      if (useWidth[1]) offsets[0] = max(offsets[0], widths[0]);
      if (useWidth[0]) offsets[1] = min(offsets[1], widths[1]);
    }
    const otherLeft = cs2OffsetRoadCurveLeftSmooth(halves[0], [
        offsets[0],
        offsets[0],
      ]),
      otherLeftEnd = cs2OffsetRoadCurveLeftSmooth(halves[1], [
        offsets[0],
        offsets[0],
      ]),
      otherRight = cs2OffsetRoadCurveLeftSmooth(halves[0], [
        offsets[1],
        offsets[1],
      ]),
      otherRightEnd = cs2OffsetRoadCurveLeftSmooth(halves[1], [
        offsets[1],
        offsets[1],
      ]);
    let leftDirection = normalize({ ...startTangent(otherLeft), y: 0 }),
      rightDirection = normalize({ ...startTangent(otherRight), y: 0 });
    if (transitionNode) {
      const base = max(nc.width, times(otherNC.width, 0.5)),
        lengths = [
          max(
            slopeOffset,
            times(
              base,
              clamp(plus(dot2(tangentRight, leftDirection), 1), 0, 1),
            ),
          ),
          max(
            slopeOffset,
            times(
              base,
              clamp(plus(dot2(tangentLeft, rightDirection), 1), 0, 1),
            ),
          ),
        ],
        nodeCurve: CS2RoadCurve = [
          clone(otherLeft[0]),
          sub(
            otherLeft[0],
            mul(leftDirection, times(lengths[0], f(1.3333334))),
          ),
          sub(
            otherRight[0],
            mul(rightDirection, times(lengths[1], f(1.3333334))),
          ),
          clone(otherRight[0]),
        ],
        left = intersectCombined(
          leftStart,
          leftEnd,
          nodeCurve,
          otherRight,
          otherRightEnd,
        ),
        right = intersectCombined(
          rightStart,
          rightEnd,
          nodeCurve,
          otherLeft,
          otherLeftEnd,
        );
      if (left[0] > 0) {
        result[0] = max(result[0], left[0]);
        rightDirection = normalize(
          combinedTangent(otherRight, otherRightEnd, left[1]),
        );
      }
      if (right[0] > 0) {
        result[1] = max(result[1], right[0]);
        leftDirection = normalize(
          combinedTangent(otherLeft, otherLeftEnd, right[1]),
        );
      }
    } else {
      leftTarget = clone(otherRight[0]);
      rightTarget = clone(otherLeft[0]);
    }
    if (first) bestLeft = rightDirection;
    else if (dot2(rightDirection, side) > 0) {
      if (
        dot2(bestLeft, side) <= 0 ||
        dot2(rightDirection, tangentLeft) >= dot2(bestLeft, tangentLeft)
      )
        bestLeft = rightDirection;
    } else if (
      dot2(bestLeft, side) <= 0 &&
      dot2(rightDirection, tangentLeft) <= dot2(bestLeft, tangentLeft)
    )
      bestLeft = rightDirection;
    if (first) bestRight = leftDirection;
    else if (dot2(leftDirection, side) < 0) {
      if (
        dot2(bestRight, side) >= 0 ||
        dot2(leftDirection, tangentRight) >= dot2(bestRight, tangentRight)
      )
        bestRight = leftDirection;
    } else if (
      dot2(bestRight, side) >= 0 &&
      dot2(leftDirection, tangentRight) <= dot2(bestRight, tangentRight)
    )
      bestRight = leftDirection;
    first = false;
  }
  if (distance.some((x, i) => x > f(0.1) || extra[i] > f(0.1)) || needsNode) {
    if (needsNode) extra = extra.map((x) => max(x, minimum));
    distance = distance.map((x, i) => plus(x, extra[i]));
    for (let side = 0; side < 2; side++)
      if (distance[side] > 0) {
        const start = side === 0 ? leftStart : rightStart,
          end = side === 0 ? leftEnd : rightEnd,
          first = clampLength(start, 0, 1, distance[side]);
        if (first.complete) result[side] = max(result[side], first.end);
        else {
          const remaining = max(
              0,
              minus(distance[side], cs2RoadCurveLength(start)),
            ),
            second = clampLength(end, 0, 1, remaining);
          result[side] = max(result[side], plus(1, second.end));
        }
      }
    if (g.flags & 0x100)
      result = [max(result[0], result[1]), max(result[0], result[1])];
    else if (result[1] > result[0])
      result[0] = oppositeSide(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
        bestLeft,
        bestRight,
        result[0],
        result[1],
      );
    else if (result[1] < result[0])
      result[1] = oppositeSide(
        rightStart,
        rightEnd,
        leftStart,
        leftEnd,
        bestRight,
        bestLeft,
        result[1],
        result[0],
      );
    leftTarget = vzero();
    rightTarget = vzero();
  }
  if (w.outsideConnections.has(node))
    throw new CS2NetworkGeometryPending("outside terrain bounds", node);
  return { offsets: result, leftTarget, rightTarget };
}
function calculateOffsets(w: CS2NetworkGeometryWorld, entity: string) {
  const edge = required(w.edges, entity, "Edge"),
    source = required(w.curves, entity, "Curve"),
    composition = required(w.compositions, entity, "Composition"),
    g = geom(w, entity),
    ec = clone(comp(w, composition.edge)),
    nc = [comp(w, composition.startNode), comp(w, composition.endNode)],
    ng = [
      required(w.nodeGeometry, edge.start, "NodeGeometry"),
      required(w.nodeGeometry, edge.end, "NodeGeometry"),
    ];
  required(w.prefabCompositionLanes, composition.edge, "NetCompositionLane");
  required(
    w.prefabCompositionCrosswalks,
    composition.startNode,
    "NetCompositionCrosswalk",
  );
  required(
    w.prefabCompositionCrosswalks,
    composition.endNode,
    "NetCompositionCrosswalk",
  );
  const owner = w.owners.get(entity),
    owned = owner ? w.compositions.get(owner) : undefined;
  if (owned) ec.nodeOffset = max(ec.nodeOffset, comp(w, owned.edge).nodeOffset);
  for (const [i, node] of [edge.start, edge.end].entries()) {
    if (nc[i].flags.general & (0x40 | 0x400000))
      throw new CS2NetworkGeometryPending(
        "roundabout/fixed-node asset geometry",
        node,
      );
    if (((geom(w, node).mergeLayers ^ g.mergeLayers) & 0x100) !== 0)
      throw new CS2NetworkGeometryPending("waterway height transition", node);
  }
  if (ec.state & 0x10000)
    throw new CS2NetworkGeometryPending("airspace elevation geometry", entity);
  const curve = cutForNodes(w, edge, source.bezier),
    halves = divideCurve(curve, middleTangent(curve)),
    a = halves[0],
    b = halves[1];
  if ((nc[0].flags.general & 0x400080) === 0) {
    curve[0].y = ng[0].position;
    a[0].y = curve[0].y;
    a[1].y = plus(a[1].y, ng[0].offset);
    a[2].y = minus(a[2].y, times(ng[0].offset, 0.375));
    a[3].y = minus(a[3].y, times(ng[0].offset, 0.1875));
    b[0].y = minus(b[0].y, times(ng[0].offset, 0.1875));
    b[1].y = plus(b[1].y, times(ng[0].offset, 0.125));
  }
  if ((nc[1].flags.general & 0x400080) === 0) {
    curve[3].y = ng[1].position;
    b[3].y = curve[3].y;
    b[2].y = plus(b[2].y, ng[1].offset);
    b[1].y = minus(b[1].y, times(ng[1].offset, 0.375));
    b[0].y = minus(b[0].y, times(ng[1].offset, 0.1875));
    a[3].y = minus(a[3].y, times(ng[1].offset, 0.1875));
    a[2].y = plus(a[2].y, times(ng[1].offset, 0.125));
  }
  const leftLength = dist2(a[2], a[3]),
    rightLength = dist2(b[1], b[0]),
    delta = minus(
      lerp(
        a[2].y,
        b[1].y,
        divide(leftLength, max(f(0.1), plus(leftLength, rightLength))),
      ),
      a[3].y,
    );
  a[2].y = minus(a[2].y, times(delta, 0.4));
  a[3].y = plus(a[3].y, times(delta, 0.6));
  b[0].y = plus(b[0].y, times(delta, 0.6));
  b[1].y = minus(b[1].y, times(delta, 0.4));
  const offsets = [
      plus(times(ec.width, 0.5), ec.middleOffset),
      plus(times(ec.width, -0.5), ec.middleOffset),
    ],
    widths = nc.map((c) => [
      plus(times(c.width, 0.5), c.middleOffset),
      plus(times(c.width, -0.5), c.middleOffset),
    ]),
    leftStart = cs2OffsetRoadCurveLeftSmooth(a, [offsets[0], offsets[0]]),
    rightStart = cs2OffsetRoadCurveLeftSmooth(a, [offsets[1], offsets[1]]),
    leftEnd = cs2OffsetRoadCurveLeftSmooth(b, [offsets[0], offsets[0]]),
    rightEnd = cs2OffsetRoadCurveLeftSmooth(b, [offsets[1], offsets[1]]),
    startTangentValue = direction(startTangent(a)),
    endTangentValue = direction(endTangent(b)),
    use = widths.map((x) => [
      minus(offsets[0], x[0]) > f(0.001),
      minus(x[1], offsets[1]) > f(0.001),
    ]);
  const start = cornerOffset(
      w,
      entity,
      edge.start,
      startTangentValue.y,
      use[0],
      curve,
      leftStart,
      rightStart,
      leftEnd,
      rightEnd,
      ec,
      nc[0],
      ng[0].offset,
      false,
    ),
    end = cornerOffset(
      w,
      entity,
      edge.end,
      -endTangentValue.y,
      use[1],
      curve,
      invert(rightEnd),
      invert(leftEnd),
      invert(rightStart),
      invert(leftStart),
      ec,
      nc[1],
      ng[1].offset,
      true,
    );
  let startOffsets = start.offsets,
    endOffsets: [number, number] = [end.offsets[1], end.offsets[0]];
  if (
    widths.some((x) =>
      x.some((v, i) => Math.abs(minus(v, offsets[i])) > f(0.001)),
    )
  ) {
    const aa = cs2OffsetRoadCurveLeftSmooth(a, [widths[0][0], widths[0][0]]),
      bb = cs2OffsetRoadCurveLeftSmooth(a, [widths[0][1], widths[0][1]]),
      cc = cs2OffsetRoadCurveLeftSmooth(b, [widths[1][0], widths[1][0]]),
      dd = cs2OffsetRoadCurveLeftSmooth(b, [widths[1][1], widths[1][1]]),
      s = cornerOffset(
        w,
        entity,
        edge.start,
        startTangentValue.y,
        use[0],
        curve,
        aa,
        bb,
        cc,
        dd,
        ec,
        nc[0],
        ng[0].offset,
        false,
      ),
      e = cornerOffset(
        w,
        entity,
        edge.end,
        -endTangentValue.y,
        use[1],
        curve,
        invert(dd),
        invert(cc),
        invert(bb),
        invert(aa),
        ec,
        nc[1],
        ng[1].offset,
        true,
      );
    startOffsets = [
      max(startOffsets[0], s.offsets[0]),
      max(startOffsets[1], s.offsets[1]),
    ];
    endOffsets = [
      max(endOffsets[0], e.offsets[1]),
      max(endOffsets[1], e.offsets[0]),
    ];
  }
  return {
    edge,
    curve: { bezier: curve, length: source.length },
    g,
    ec,
    nc,
    ng,
    leftStart,
    rightStart,
    leftEnd,
    rightEnd,
    startTangent: startTangentValue,
    endTangent: endTangentValue,
    startOffsets,
    endOffsets,
    startLeftTarget: start.leftTarget,
    startRightTarget: start.rightTarget,
    endLeftTarget: end.rightTarget,
    endRightTarget: end.leftTarget,
  };
}
function cutOffset(
  start: CS2RoadCurve,
  end: CS2RoadCurve,
  a: number,
  b: number,
  width: number,
) {
  const length =
    a >= 1
      ? rangeLength(end, minus(a, 1), minus(1, b))
      : b >= 1
        ? rangeLength(start, a, minus(2, b))
        : plus(rangeLength(start, a, 1), rangeLength(end, 0, minus(1, b)));
  return minus(
    1,
    divide(
      times(minus(minus(2, a), b), 0.5),
      plus(divide(length, max(f(0.01), width)), 1),
    ),
  );
}
function cutEdge(
  start: CS2RoadCurve,
  end: CS2RoadCurve,
  a: number,
  b: number,
  cut: number,
) {
  if (a >= 1) return cutCurve(end, minus(a, 1), minus(a, cut));
  if (a > cut) {
    const p = cs2RoadCurvePosition(start, a),
      q = cs2RoadCurvePosition(end, minus(a, cut)),
      ta = direction(cs2RoadCurveTangent(start, a)),
      tb = direction(cs2RoadCurveTangent(end, minus(a, cut)));
    return cs2FitRoadCurve(p, ta, tb, q);
  }
  return cutCurve(start, a, min(1, minus(plus(1, cut), b)));
}
function conform(
  start: CS2RoadCurve,
  end: CS2RoadCurve,
  a: number,
  b: number,
): [CS2RoadCurve, CS2RoadCurve] {
  if (a >= 1) {
    const lo = minus(a, 1),
      hi = minus(1, b),
      length = rangeLength(end, lo, hi),
      split = clampLength(end, lo, hi, times(length, 0.5), true).end;
    return [cutCurve(end, lo, split), cutCurve(end, split, hi)];
  }
  if (b >= 1) {
    const hi = minus(2, b),
      length = rangeLength(start, a, hi),
      split = clampLength(start, hi, a, times(length, 0.5), true).end;
    return [cutCurve(start, a, split), cutCurve(start, split, hi)];
  }
  const left = rangeLength(start, a, 1),
    right = rangeLength(end, 0, minus(1, b));
  let p: V, t: V;
  if (left > right) {
    const split = clampLength(start, a, 1, lerp(left, right, 0.5), true).end;
    p = cs2RoadCurvePosition(start, split);
    t = cs2RoadCurveTangent(start, split);
  } else {
    const split = clampLength(
      end,
      minus(1, b),
      0,
      lerp(left, right, 0.5),
      true,
    ).end;
    p = cs2RoadCurvePosition(end, split);
    t = cs2RoadCurveTangent(end, split);
  }
  const first = cs2RoadCurvePosition(start, a),
    ta = normalize(cs2RoadCurveTangent(start, a)),
    last = cs2RoadCurvePosition(end, minus(1, b)),
    tb = normalize(cs2RoadCurveTangent(end, minus(1, b)));
  t = normalize(t);
  return [cs2FitRoadCurve(first, ta, t, p), cs2FitRoadCurve(p, t, tb, last)];
}
function heightDelta(
  left: CS2RoadCurve,
  right: CS2RoadCurve,
  slope: number,
  originalLeft: CS2RoadCurve,
  originalRight: CS2RoadCurve,
  g: CS2NetworkPrefabGeometry,
  ec: CS2NetworkComposition,
  nc: CS2NetworkComposition,
  flatness: number,
) {
  if (nc.flags.general & 0x400080) {
    left[0].y = left[1].y = originalLeft[0].y;
    right[0].y = right[1].y = originalRight[0].y;
    return;
  }
  const offset = plus(
      max(ec.nodeOffset, nc.nodeOffset),
      times(times(Math.abs(slope), ec.width), 0.25),
    ),
    limit = times(times(g.maxSlopeSteepness, offset), 1.5);
  for (const [curve, original] of [
    [left, originalLeft],
    [right, originalRight],
  ]) {
    const shift = max(
      min(0, minus(plus(original[0].y, limit), curve[0].y)),
      minus(minus(original[0].y, limit), curve[0].y),
    );
    curve[0].y = plus(curve[0].y, times(shift, flatness));
    curve[1].y = plus(curve[1].y, times(shift, flatness));
  }
}
export function cs2EmptyNetworkNodeGeometry(): CS2NetworkNodeGeometry {
  return {
    position: 0,
    flatness: 0,
    offset: 0,
    bounds: { min: vzero(), max: vzero() },
  };
}
export function cs2EmptyNetworkEdgeGeometry(): CS2RoadEdgeGeometry {
  return {
    start: zeroSegment(),
    end: zeroSegment(),
    bounds: { min: vzero(), max: vzero() },
  };
}
export function cs2EmptyNetworkEdgeNodeGeometry(): CS2NetworkEdgeNodeGeometry {
  return {
    left: zeroSegment(),
    right: zeroSegment(),
    middle: zeroCurve(),
    middleRadius: 0,
    bounds: { min: vzero(), max: vzero() },
    syncVertexTargetsLeft: [0, 0, 0, 0],
    syncVertexTargetsRight: [0, 0, 0, 0],
  };
}
/** Complete ordinary-road CalculateEdgeGeometryJob path. Unsupported asset branches suspend before output. */
export function cs2CalculateNetworkEdgeGeometry(
  w: CS2NetworkGeometryWorld,
  edges: readonly string[],
) {
  for (const entity of edges) {
    const input = calculateOffsets(w, entity),
      { g, ec, nc, ng } = input;
    let { leftStart, rightStart, leftEnd, rightEnd } = input;
    const owner = w.owners.get(entity),
      placementEntity = owner && w.edges.has(owner) ? owner : entity;
    const placementPrefab = required(
      w.prefabRefs,
      placementEntity,
      "PrefabRef",
    );
    if ((w.prefabPlacementFlags.get(placementPrefab) ?? 0) & 0x200)
      throw new CS2NetworkGeometryPending(
        "LinkAuxOffsets sub-network geometry",
        entity,
      );
    const start = [...input.startOffsets],
      end = [...input.endOffsets];
    if (
      start.every((x) => x === 0) &&
      [input.startLeftTarget, input.startRightTarget].some(
        (p) => p.x !== 0 || p.y !== 0 || p.z !== 0,
      )
    ) {
      leftStart = [
        mix(leftStart[0], input.startLeftTarget, 0.5),
        leftStart[1],
        leftStart[2],
        leftStart[3],
      ];
      rightStart = [
        mix(rightStart[0], input.startRightTarget, 0.5),
        rightStart[1],
        rightStart[2],
        rightStart[3],
      ];
    }
    if (
      end.every((x) => x === 0) &&
      [input.endLeftTarget, input.endRightTarget].some(
        (p) => p.x !== 0 || p.y !== 0 || p.z !== 0,
      )
    ) {
      leftEnd = [
        leftEnd[0],
        leftEnd[1],
        leftEnd[2],
        mix(leftEnd[3], input.endLeftTarget, 0.5),
      ];
      rightEnd = [
        rightEnd[0],
        rightEnd[1],
        rightEnd[2],
        mix(rightEnd[3], input.endRightTarget, 0.5),
      ];
    }
    const maxOffset = min(
      f(1.98),
      minus(2, divide(0.4, max(1, input.curve.length))),
    );
    for (let i = 0; i < 2; i++) {
      start[i] = min(start[i], maxOffset);
      end[i] = min(end[i], maxOffset);
      const sum = plus(start[i], end[i]);
      if (sum > maxOffset) {
        const factor = divide(maxOffset, sum);
        start[i] = times(start[i], factor);
        end[i] = times(end[i], factor);
      }
    }
    const result = cs2EmptyNetworkEdgeGeometry();
    if (g.flags & 0x400) {
      const left = conform(leftStart, leftEnd, start[0], end[0]),
        right = conform(rightStart, rightEnd, start[1], end[1]);
      result.start.left = left[0];
      result.end.left = left[1];
      result.start.right = right[0];
      result.end.right = right[1];
      heightDelta(
        result.start.left,
        result.start.right,
        input.startTangent.y,
        leftStart,
        rightStart,
        g,
        ec,
        nc[0],
        ng[0].flatness,
      );
      leftEnd = invert(leftEnd);
      rightEnd = invert(rightEnd);
      result.end.left = invert(result.end.left);
      result.end.right = invert(result.end.right);
      heightDelta(
        result.end.left,
        result.end.right,
        -input.endTangent.y,
        leftEnd,
        rightEnd,
        g,
        ec,
        nc[1],
        ng[1].flatness,
      );
      result.end.left = invert(result.end.left);
      result.end.right = invert(result.end.right);
    } else {
      const left = cutOffset(leftStart, leftEnd, start[0], end[0], ec.width),
        right = cutOffset(rightStart, rightEnd, start[1], end[1], ec.width);
      result.start.left = cutEdge(leftStart, leftEnd, start[0], end[0], left);
      result.start.right = cutEdge(
        rightStart,
        rightEnd,
        start[1],
        end[1],
        right,
      );
      heightDelta(
        result.start.left,
        result.start.right,
        input.startTangent.y,
        leftStart,
        rightStart,
        g,
        ec,
        nc[0],
        ng[0].flatness,
      );
      leftStart = invert(leftStart);
      rightStart = invert(rightStart);
      leftEnd = invert(leftEnd);
      rightEnd = invert(rightEnd);
      result.end.left = cutEdge(leftEnd, leftStart, end[0], start[0], left);
      result.end.right = cutEdge(rightEnd, rightStart, end[1], start[1], right);
      heightDelta(
        result.end.left,
        result.end.right,
        -input.endTangent.y,
        leftEnd,
        rightEnd,
        g,
        ec,
        nc[1],
        ng[1].flatness,
      );
      result.end.left = invert(result.end.left);
      result.end.right = invert(result.end.right);
    }
    if (ng.some((x) => x.bounds.min.x !== 0)) {
      const old = required(w.edgeGeometry, entity, "EdgeGeometry");
      if (ng[0].bounds.min.x !== 0) {
        result.start.left[1].y = plus(
          result.start.left[1].y,
          minus(old.start.left[0].y, result.start.left[0].y),
        );
        result.start.right[1].y = plus(
          result.start.right[1].y,
          minus(old.start.right[0].y, result.start.right[0].y),
        );
        result.start.left[0].y = old.start.left[0].y;
        result.start.right[0].y = old.start.right[0].y;
      }
      if (ng[1].bounds.min.x !== 0) {
        result.end.left[2].y = plus(
          result.end.left[2].y,
          minus(old.end.left[3].y, result.end.left[3].y),
        );
        result.end.right[2].y = plus(
          result.end.right[2].y,
          minus(old.end.right[3].y, result.end.right[3].y),
        );
        result.end.left[3].y = old.end.left[3].y;
        result.end.right[3].y = old.end.right[3].y;
      }
    }
    w.edgeGeometry.set(entity, result);
    w.startNodeGeometry.set(entity, cs2EmptyNetworkEdgeNodeGeometry());
    w.endNodeGeometry.set(entity, cs2EmptyNetworkEdgeNodeGeometry());
  }
}
export type CS2NetworkGeometryResult =
  | { status: "complete"; world: CS2NetworkGeometryWorld }
  | { status: "pending"; dependency: string; entity: string };
/** Transactional source scheduling order. A pending result never publishes partially generated geometry. */
export function cs2GenerateRoadNetworkGeometry(
  world: CS2NetworkGeometryWorld,
  input: {
    nodes: readonly string[];
    edges: readonly string[];
    loaded?: boolean;
  },
): CS2NetworkGeometryResult {
  const staged = {
    ...world,
    nodeGeometry: clone(world.nodeGeometry),
    edgeGeometry: clone(world.edgeGeometry),
    startNodeGeometry: clone(world.startNodeGeometry),
    endNodeGeometry: clone(world.endNodeGeometry),
    heightMap: new Map<string, readonly [number, number, number, number]>(),
  };
  try {
    cs2InitializeNetworkNodeGeometry(staged, input.nodes, input.loaded);
    cs2CalculateNetworkEdgeGeometry(staged, input.edges);
    cs2FlattenNetworkNodeGeometry(staged, input.nodes);
    cs2FinishNetworkEdgeGeometry(staged, input.edges);
    cs2CalculateNetworkNodeGeometry(staged, input.edges, 0);
    cs2CalculateNetworkNodeGeometry(staged, input.edges, 1);
    cs2CalculateNetworkIntersectionGeometry(staged, input.edges);
    cs2UpdateNetworkNodeGeometry(staged, input.nodes);
    return { status: "complete", world: staged };
  } catch (error) {
    if (error instanceof CS2NetworkGeometryPending)
      return {
        status: "pending",
        dependency: error.dependency,
        entity: error.entity,
      };
    throw error;
  }
}
