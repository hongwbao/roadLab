/** Source Net.ReferencesSystem and Tools.NodeReductionSystem, operating on the Apply dictionary ECS. */
import {
  CS2RoadApplyECS,
  type CS2RoadApplyWorld,
  type CS2RoadApplyChunk,
  type CS2RoadApplyRecord,
} from "./cs2-road-ecs";
import { cs2NativeSort } from "./cs2-native-sort";
import {
  cs2RoadCurveLength,
  cs2RoadCurvePosition,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
import { cs2RoadCurveDistanceXZ } from "./cs2-road-snapping";
import type { V } from "./types";
type Entity = string | null;
type Q = { x: number; y: number; z: number; w: number };
type Edge = { start: Entity; end: Entity };
type Node = { position: V; rotation: Q };
type Curve = { bezier: CS2RoadCurve; length: number };
type Temp = {
  original: Entity;
  curvePosition: number;
  value: number;
  cost: number;
  flags: number;
};
type Connection = { node: Entity; curvePosition: number };
type Flags = { general: number; left: number; right: number };
type Geometry = {
  flags: number;
  defaultWidth: number;
  elevationLimit: number;
  elevatedLength: number;
  edgeLengthRange: { min: number; max: number } | readonly [number, number];
};
type LocalConnect = { flags: number };
type Line = readonly [V, V];
const f = Math.fround,
  addN = (a: number, b: number) => f(f(a) + f(b)),
  subN = (a: number, b: number) => f(f(a) - f(b)),
  mulN = (a: number, b: number) => f(f(a) * f(b)),
  divN = (a: number, b: number) => f(f(a) / f(b)),
  min = (a: number, b: number) => (Number.isNaN(b) || a < b ? a : b),
  max = (a: number, b: number) => (Number.isNaN(b) || a > b ? a : b),
  clamp = (a: number, lo: number, hi: number) => max(lo, min(hi, a)),
  mixN = (a: number, b: number, t: number) => addN(a, mulN(subN(b, a), t));
const zero = (): V => ({ x: 0, y: 0, z: 0 }),
  add = (a: V, b: V): V => ({
    x: addN(a.x, b.x),
    y: addN(a.y, b.y),
    z: addN(a.z, b.z),
  }),
  sub = (a: V, b: V): V => ({
    x: subN(a.x, b.x),
    y: subN(a.y, b.y),
    z: subN(a.z, b.z),
  }),
  mul = (a: V, t: number): V => ({
    x: mulN(a.x, t),
    y: mulN(a.y, t),
    z: mulN(a.z, t),
  }),
  mix = (a: V, b: V, t: number) => add(a, mul(sub(b, a), t)),
  dot = (a: V, b: V) =>
    addN(addN(mulN(a.x, b.x), mulN(a.y, b.y)), mulN(a.z, b.z)),
  dot2 = (a: V, b: V) => addN(mulN(a.x, b.x), mulN(a.z, b.z)),
  length = (a: V, d2 = false) => f(Math.sqrt(d2 ? dot2(a, a) : dot(a, a))),
  distance = (a: V, b: V, d2 = false) => length(sub(a, b), d2),
  normalize = (a: V, d2 = false): V => {
    const squared = d2 ? dot2(a, a) : dot(a, a);
    return squared > f(1.1754943508222875e-38)
      ? mul(a, divN(1, f(Math.sqrt(squared))))
      : zero();
  },
  xz = (v: V): V => ({ x: v.x, y: 0, z: v.z }),
  left = (v: V): V => ({ x: -v.z, y: 0, z: v.x }),
  cross = (a: V, b: V): V => ({
    x: subN(mulN(a.y, b.z), mulN(a.z, b.y)),
    y: subN(mulN(a.z, b.x), mulN(a.x, b.z)),
    z: subN(mulN(a.x, b.y), mulN(a.y, b.x)),
  });
const divVector = (a: V, t: number): V => ({
  x: divN(a.x, t),
  y: divN(a.y, t),
  z: divN(a.z, t),
});
const inverse = (c: CS2RoadCurve): CS2RoadCurve => [
    structuredClone(c[3]),
    structuredClone(c[2]),
    structuredClone(c[1]),
    structuredClone(c[0]),
  ],
  startTangent = (c: CS2RoadCurve) => sub(c[1], c[0]),
  endTangent = (c: CS2RoadCurve) => sub(c[3], c[2]);
function linePoint(line: Line, p: V, d2 = false) {
  const v = sub(line[1], line[0]),
    denominator = d2 ? dot2(v, v) : dot(v, v),
    t =
      denominator === 0
        ? 0
        : clamp(
            divN(
              d2 ? dot2(sub(p, line[0]), v) : dot(sub(p, line[0]), v),
              denominator,
            ),
            0,
            1,
          );
  return { distance: distance(mix(line[0], line[1], t), p, d2), t };
}
function curveDistance(c: CS2RoadCurve, p: V, d2 = true) {
  if (d2) return cs2RoadCurveDistanceXZ(c, { x: p.x, y: p.z });
  let best = f(3.4028234663852886e38),
    t = 0,
    begin = 0,
    a = c[0];
  for (let i = 1; i <= 16; i++) {
    const next = f(i / 16),
      b = cs2RoadCurvePosition(c, next),
      d = linePoint([a, b], p);
    if (d.distance < best) {
      best = d.distance;
      t = mixN(begin, next, d.t);
    }
    begin = next;
    a = b;
  }
  let step = f(1 / 32);
  for (let i = 0; i < 4; i++) {
    const a = cs2RoadCurvePosition(c, t),
      b = cs2RoadCurvePosition(c, max(0, subN(t, step))),
      d = cs2RoadCurvePosition(c, min(1, addN(t, step))),
      x = linePoint([a, b], p),
      y = linePoint([a, d], p);
    if (x.distance < y.distance) {
      t = max(0, subN(t, mulN(step, x.t)));
      best = x.distance;
    } else {
      t = min(1, addN(t, mulN(step, y.t)));
      best = y.distance;
    }
    step = mulN(step, 0.5);
  }
  return { distance: best, t };
}
function lineDistance(a: Line, b: Line): [number, number] {
  const u = sub(a[1], a[0]),
    v = sub(b[1], b[0]),
    w = sub(a[0], b[0]),
    det = subN(mulN(u.x, v.z), mulN(u.z, v.x));
  if (det === 0) {
    let d = linePoint(b, a[0], true),
      best = d.distance,
      result: [number, number] = [0, d.t];
    d = linePoint(b, a[1], true);
    if (d.distance < best) {
      best = d.distance;
      result = [1, d.t];
    }
    d = linePoint(a, b[0], true);
    if (d.distance < best) {
      best = d.distance;
      result = [d.t, 0];
    }
    d = linePoint(a, b[1], true);
    if (d.distance < best) result = [d.t, 1];
    return result;
  }
  const t: [number, number] = [
    clamp(divN(subN(mulN(w.z, v.x), mulN(w.x, v.z)), det), 0, 1),
    clamp(divN(subN(mulN(w.z, u.x), mulN(w.x, u.z)), det), 0, 1),
  ];
  if (t[0] === 0) t[1] = linePoint(b, a[0], true).t;
  else if (t[0] === 1) t[1] = linePoint(b, a[1], true).t;
  else if (t[1] === 0) t[0] = linePoint(a, b[0], true).t;
  else if (t[1] === 1) t[0] = linePoint(a, b[1], true).t;
  return t;
}
function lineIntersect(a: Line, b: Line) {
  const u = sub(a[1], a[0]),
    v = sub(b[1], b[0]),
    w = sub(a[0], b[0]),
    det = subN(mulN(u.x, v.z), mulN(u.z, v.x)),
    x = divN(subN(mulN(w.z, v.x), mulN(w.x, v.z)), det),
    y = divN(subN(mulN(w.z, u.x), mulN(w.x, u.z)), det);
  return (
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1 &&
    min(a[0].x, a[1].x) <= max(b[0].x, b[1].x) &&
    min(b[0].x, b[1].x) <= max(a[0].x, a[1].x) &&
    min(a[0].z, a[1].z) <= max(b[0].z, b[1].z) &&
    min(b[0].z, b[1].z) <= max(a[0].z, a[1].z)
  );
}
const range = (x: Geometry["edgeLengthRange"]): [number, number] =>
  Array.isArray(x)
    ? [x[0], x[1]]
    : [
        (x as { min: number; max: number }).min,
        (x as { min: number; max: number }).max,
      ];
const emptyGeometry = (): Geometry => ({
  flags: 0,
  defaultWidth: 0,
  elevationLimit: 0,
  elevatedLength: 0,
  edgeLengthRange: [0, 0],
});
export class CS2RoadReferenceAssetDependency extends Error {
  constructor(
    public readonly component: string,
    public readonly entity: Entity,
    public readonly fields: readonly string[],
  ) {
    super(
      `Unmapped source asset ${component} fields ${fields.join(", ")}: ${entity}`,
    );
    this.name = "CS2RoadReferenceAssetDependency";
  }
}
export type CS2RoadReferenceOptions = {
  editorMode?: boolean;
  candidateOrder?: readonly string[];
};
export type CS2RoadReferenceResult =
  | {
      status: "complete";
      world: CS2RoadApplyWorld;
      candidates?: readonly Reduction[];
    }
  | {
      status: "pending";
      dependency: "asset-fields";
      component: string;
      entity: Entity;
      fields: readonly string[];
    };
class ReferencesKernel {
  readonly ecs: CS2RoadApplyECS;
  readonly connections = new Map<
    string,
    { edge: string; curvePosition: number }[]
  >();
  private connectionCount = 0;
  private connectionCapacity = 32;
  constructor(world: CS2RoadApplyWorld) {
    this.ecs = new CS2RoadApplyECS(world);
  }
  get<T>(name: string, e: Entity): T {
    return this.ecs.get<T>(name, e);
  }
  optional<T>(name: string, e: Entity): T | undefined {
    return this.ecs.tryGet<T>(name, e);
  }
  buffer<T = CS2RoadApplyRecord>(name: string, e: Entity): T[] {
    return this.ecs.buffer(name, e) as T[];
  }
  set(name: string, e: Entity, value: object) {
    if (e === null) throw new Error(`Null source ${name} write`);
    this.ecs.set(name, e, value as CS2RoadApplyRecord);
  }
  prefab(e: Entity) {
    return this.get<{ prefab: Entity }>("PrefabRef", e).prefab;
  }
  asset<T>(
    component: string,
    entity: Entity,
    fields: readonly string[],
    required = false,
  ): T | undefined {
    const value = this.optional<CS2RoadApplyRecord>(component, entity);
    if (value === undefined) {
      if (required)
        throw new CS2RoadReferenceAssetDependency(component, entity, fields);
      return undefined;
    }
    const missing = fields.filter((field) => !(field in value));
    if (missing.length)
      throw new CS2RoadReferenceAssetDependency(component, entity, missing);
    return value as T;
  }
  assetGeometry(prefab: Entity, required = false) {
    return this.asset<Geometry>(
      "NetGeometryData",
      prefab,
      [
        "flags",
        "defaultWidth",
        "elevationLimit",
        "elevatedLength",
        "edgeLengthRange",
      ],
      required,
    );
  }
  geometry(e: Entity) {
    return this.assetGeometry(this.prefab(e)) ?? emptyGeometry();
  }
  *edges(
    edge: Entity,
    node: Entity,
    middles = false,
  ): Generator<{ edge: string; end: boolean; middle: boolean }> {
    if (node === null) throw new Error("Missing source ConnectedEdge: null");
    let current: Entity = node,
      buffer = this.buffer<{ edge: string }>("ConnectedEdge", current),
      index = 0;
    const permanent = !this.ecs.has("Temp", node),
      original =
        edge === null
          ? null
          : (this.optional<Temp>("Temp", edge)?.original ?? null),
      deleted =
        ((this.optional<Temp>("Temp", edge ?? node)?.flags ?? 0) & 2) !== 0,
      seen = new Set<string>();
    while (current !== null) {
      if (seen.has(current)) throw new Error("Cyclic source Temp originals");
      seen.add(current);
      while (index < buffer.length) {
        const id = buffer[index++].edge;
        if (
          !permanent &&
          (deleted
            ? !(id === edge || (this.ecs.has("Hidden", id) && id !== original))
            : this.ecs.has("Hidden", id) ||
              ((this.optional<Temp>("Temp", id)?.flags ?? 0) & 2) !== 0)
        )
          continue;
        const e = this.get<Edge>("Edge", id),
          end = e.end === current;
        if (end || e.start === current) yield { edge: id, end, middle: false };
        else if (middles) yield { edge: id, end, middle: true };
      }
      const t: Temp | undefined = this.optional<Temp>("Temp", current);
      if (!t || !this.ecs.hasBuffer("ConnectedEdge", t.original)) break;
      current = t.original;
      buffer = this.buffer("ConnectedEdge", current);
      index = 0;
    }
  }
  elevation(edge: Entity, endpoints: Edge, g: Geometry): Flags {
    const a = this.optional<{ elevation: readonly [number, number] }>(
        "Elevation",
        endpoints.start,
      )?.elevation ?? [0, 0],
      b = this.optional<{ elevation: readonly [number, number] }>(
        "Elevation",
        edge,
      )?.elevation ?? [0, 0],
      c = this.optional<{ elevation: readonly [number, number] }>(
        "Elevation",
        endpoints.end,
      )?.elevation ?? [0, 0],
      high = b.map((v) => max(max(min(a[0], a[1]), min(c[0], c[1])), v)),
      low = b.map((v) => min(min(max(a[0], a[1]), max(c[0], c[1])), v)),
      minima = [min(a[0], a[1]), min(c[0], c[1]), min(b[0], b[1])],
      maxima = [max(a[0], a[1]), max(c[0], c[1]), max(b[0], b[1])],
      result: Flags = { general: 0, left: 0, right: 0 };
    if (high.every((x) => x >= mulN(g.elevationLimit, 2)) || g.flags & 0x200) {
      if (g.flags & 0x20000000) result.left = result.right = 1;
      else result.general = 0x10000;
    } else if (
      maxima.reduce(min, Infinity) <= mulN(g.elevationLimit, -3) &&
      minima.reduce(max, -Infinity) <= mulN(g.elevationLimit, -2)
    )
      result.general = 0x20000;
    else {
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? "left" : "right";
        if (high[i] >= g.elevationLimit) {
          if (g.flags & 0x20) result.general |= 0x10000;
          else result[side] |= 1;
        } else if (low[i] <= -g.elevationLimit) {
          if (g.flags & 0x10) result.general |= 0x20000;
          else result[side] |= 2;
        }
      }
    }
    return result;
  }
  updateNodeReferences(chunks: readonly CS2RoadApplyChunk[]) {
    for (const chunk of chunks) {
      if (chunk.components.has("Deleted")) {
        for (const entity of chunk.entities)
          for (const { edge } of this.buffer<{ edge: string }>(
            "ConnectedEdge",
            entity,
          )) {
            const b = this.buffer<Connection>("ConnectedNode", edge),
              i = b.findIndex((x) => x.node === entity);
            if (i >= 0) b.splice(i, 1);
          }
        continue;
      }
      for (const entity of chunk.entities) {
        const b = this.buffer<{ edge: string }>("ConnectedEdge", entity);
        for (let i = 0; i < b.length; i++)
          if (this.ecs.has("Updated", b[i].edge)) b.splice(i--, 1);
      }
    }
  }
  validateConnectedNodes(chunks: readonly CS2RoadApplyChunk[]) {
    for (const chunk of chunks)
      for (const entity of chunk.entities) {
        const b = this.buffer<Connection>("ConnectedNode", entity);
        for (let i = 0; i < b.length; i++)
          if (this.ecs.has("Deleted", b[i].node)) b.splice(i--, 1);
      }
  }
  updateEdgeReferences(chunks: readonly CS2RoadApplyChunk[]) {
    const remove = (node: Entity, edge: string) => {
        const b = this.buffer<{ edge: string }>("ConnectedEdge", node),
          i = b.findIndex((x) => x.edge === edge);
        if (i >= 0) b.splice(i, 1);
      },
      add = (node: Entity, edge: string) => {
        const b = this.buffer<{ edge: string }>("ConnectedEdge", node);
        if (!b.some((x) => x.edge === edge)) b.push({ edge });
      };
    for (const chunk of chunks) {
      for (const entity of chunk.entities) {
        const e = this.get<Edge>("Edge", entity),
          b = this.buffer<Connection>("ConnectedNode", entity);
        if (chunk.components.has("Deleted")) {
          remove(e.start, entity);
          remove(e.end, entity);
          for (const n of b) remove(n.node, entity);
        } else {
          add(e.start, entity);
          add(e.end, entity);
          for (const n of b) {
            remove(n.node, entity);
            if (!this.ecs.has("Deleted", n.node)) {
              if (n.node === null) throw new Error("Null ConnectedNode");
              // Native sequential Add prepends; ReallocateHashMap reverses each old key chain.
              if (this.connectionCount >= this.connectionCapacity) {
                for (const values of this.connections.values())
                  values.reverse();
                this.connectionCapacity *= 2;
              }
              this.connectionCount++;
              const list = this.connections.get(n.node) ?? [];
              list.unshift({ edge: entity, curvePosition: n.curvePosition });
              this.connections.set(n.node, list);
            }
          }
        }
      }
    }
  }
  addConnectedNodeReferences(chunks: readonly CS2RoadApplyChunk[]) {
    for (const chunk of chunks) {
      if (chunk.components.has("Deleted")) continue;
      const temp = chunk.components.has("Temp");
      for (const entity of chunk.entities)
        for (const n of this.buffer<Connection>("ConnectedNode", entity))
          if (!temp || this.ecs.has("Temp", n.node)) {
            const b = this.buffer<{ edge: string }>("ConnectedEdge", n.node);
            if (!b.some((x) => x.edge === entity)) b.push({ edge: entity });
          }
    }
  }
}
class FullReferencesKernel extends ReferencesKernel {
  readonly curveBounds = new Map<string, [number, number]>();
  readonly nodePositions = new Map<string, V>();
  readonly lines: Line[] = [];
  nodePosition(entity: Entity) {
    if (entity === null) throw new Error("Null source Node");
    const cached = this.nodePositions.get(entity);
    if (cached) return cached;
    const node = this.get<Node>("Node", entity);
    if (!this.ecs.has("Standalone", entity)) {
      const net = this.asset<{ requiredLayers: number }>(
          "NetData",
          this.prefab(entity),
          ["requiredLayers"],
        ) ?? { requiredLayers: 0 },
        position = node.position;
      let accumulated = zero(),
        count = 0;
      this.lines.length = 0;
      for (const value of this.edges(null, entity)) {
        const curve = this.get<Curve>("Curve", value.edge),
          other = this.asset<{ requiredLayers: number }>(
            "NetData",
            this.prefab(value.edge),
            ["requiredLayers"],
          ) ?? { requiredLayers: 0 };
        if ((net.requiredLayers & other.requiredLayers) === 0) continue;
        const delta = sub(
            value.end ? curve.bezier[3] : curve.bezier[0],
            position,
          ),
          tangent = xz(
            value.end
              ? mul(endTangent(curve.bezier), -1)
              : startTangent(curve.bezier),
          );
        accumulated = add(accumulated, delta);
        count++;
        const normalized = normalize(tangent, true);
        if (dot2(tangent, tangent) > f(1.1754943508222875e-38))
          this.lines.push([xz(delta), normalized]);
      }
      if (count > 0) {
        node.position = add(position, divVector(accumulated, count));
        accumulated = zero();
        count = 0;
      }
      if (this.lines.length >= 2) {
        cs2NativeSort(this.lines, (a, b) => {
          const x = [a[0].x, a[0].z, a[1].x, a[1].z],
            y = [b[0].x, b[0].z, b[1].x, b[1].z];
          return x.reduce(
            (sum, v, i) =>
              sum +
              (v === y[i]
                ? 0
                : v > y[i]
                  ? [8, 4, 2, 1][i]
                  : [-8, -4, -2, -1][i]),
            0,
          );
        });
        for (let i = 1; i < this.lines.length; i++)
          for (let j = 0; j < i; j++) {
            const a = this.lines[i],
              b = this.lines[j],
              angle = dot2(a[1], b[1]);
            let p: V;
            if (Math.abs(angle) > f(0.999)) {
              const sum = add(a[0], b[0]);
              p = { x: sum.x, y: sum.z, z: 2 };
            } else {
              const d = distance(a[0], b[0], true),
                range = [
                  mulN(d, subN(Math.abs(angle), 1)),
                  mulN(d, subN(1, Math.abs(angle))),
                ],
                first: Line = [
                  sub(a[0], mul(a[1], range[0])),
                  sub(a[0], mul(a[1], range[1])),
                ],
                second: Line = [
                  sub(b[0], mul(b[1], range[0])),
                  sub(b[0], mul(b[1], range[1])),
                ],
                t = lineDistance(first, second),
                sum = add(
                  mix(first[0], first[1], t[0]),
                  mix(second[0], second[1], t[1]),
                );
              p = { x: sum.x, y: sum.z, z: 2 };
            }
            accumulated = add(accumulated, mul(p, subN(1.01, Math.abs(angle))));
            count++;
          }
        if (count > 0) {
          node.position.x = addN(
            position.x,
            divN(accumulated.x, accumulated.z),
          );
          node.position.z = addN(
            position.z,
            divN(accumulated.y, accumulated.z),
          );
        }
      }
    }
    const result = xz(node.position);
    this.nodePositions.set(entity, result);
    return result;
  }
  clampPosition(entity: string, edge: Edge, curve: Curve, position: number) {
    let bounds = this.curveBounds.get(entity);
    if (!bounds) {
      if (curve.length >= f(0.2)) {
        let lo = curveDistance(curve.bezier, this.nodePosition(edge.start)).t,
          hi = curveDistance(curve.bezier, this.nodePosition(edge.end)).t;
        const offset = divN(0.1, curve.length);
        lo = addN(lo, offset);
        hi = subN(hi, offset);
        if (hi < lo) lo = hi = mulN(addN(lo, hi), 0.5);
        bounds = [lo, hi];
      } else bounds = [0.5, 0.5];
      this.curveBounds.set(entity, bounds);
    }
    return clamp(position, bounds[0], bounds[1]);
  }
  neighbors(a: Edge, b: Edge) {
    return (
      a.start === b.start ||
      a.end === b.start ||
      a.start === b.end ||
      a.end === b.end
    );
  }
  originals(edge: Edge): Edge | undefined {
    const a = this.optional<Temp>("Temp", edge.start),
      b = this.optional<Temp>("Temp", edge.end);
    return a && b ? { start: a.original, end: b.original } : undefined;
  }
  topOwner(entity: Entity): Entity {
    const seen = new Set<string>();
    while (entity !== null) {
      if (seen.has(entity)) throw new Error("Cyclic source Owner/Temp");
      seen.add(entity);
      const temp = this.optional<Temp>("Temp", entity);
      if (temp?.original !== null && temp?.original !== undefined)
        entity = temp.original;
      const owner = this.optional<{ owner: Entity }>("Owner", entity);
      if (!owner) break;
      entity = owner.owner;
    }
    return entity;
  }
  allow(
    owner: Entity,
    line: Line,
  ): { allowed: boolean; directions: number; forward: V } {
    while (this.ecs.has("Owner", owner) && !this.ecs.has("Building", owner))
      owner = this.get<{ owner: Entity }>("Owner", owner).owner;
    const reference = this.optional<{ prefab: Entity }>("PrefabRef", owner),
      transform = this.optional<{ position: V; rotation: Q }>(
        "Transform",
        owner,
      );
    if (!reference || !transform)
      return { allowed: true, directions: 0, forward: zero() };
    const building = this.optional<{
      lotSize: readonly [number, number] | { x: number; y: number };
      flags: number;
    }>("BuildingData", reference.prefab);
    if (!building) return { allowed: true, directions: 0, forward: zero() };
    const lot = Array.isArray(building.lotSize)
        ? building.lotSize
        : [
            (building.lotSize as { x: number; y: number }).x,
            (building.lotSize as { x: number; y: number }).y,
          ],
      rotate = (v: V) => {
        const vector = {
            x: transform.rotation.x,
            y: transform.rotation.y,
            z: transform.rotation.z,
          },
          t = mul(cross(vector, v), 2);
        return add(add(v, mul(t, transform.rotation.w)), cross(vector, t));
      },
      forward = rotate({ x: 0, y: 0, z: 1 }),
      right = rotate({ x: 1, y: 0, z: 0 }),
      a = mul(forward, mulN(mulN(lot[1], 8), 0.5)),
      b = mul(right, mulN(mulN(lot[0], 8), 0.5)),
      front = add(transform.position, a),
      back = sub(transform.position, a),
      corners = [sub(front, b), add(front, b), add(back, b), sub(back, b)];
    if (
      ((building.flags & 4) === 0 &&
        lineIntersect(line, [corners[1], corners[2]])) ||
      ((building.flags & 0x10) === 0 &&
        lineIntersect(line, [corners[2], corners[3]])) ||
      ((building.flags & 8) === 0 &&
        lineIntersect(line, [corners[3], corners[0]]))
    )
      return { allowed: false, directions: 0, forward: zero() };
    return { allowed: true, directions: building.flags, forward };
  }
  validate(
    entity: string,
    node: Entity,
    original: Entity,
    edge: Edge,
    local: LocalConnect,
    edgePosition: V,
    nodeDistance: number,
    size: number,
    directions: number,
    forward: V,
  ) {
    let count = 0;
    for (const value of this.edges(null, node, (local.flags & 8) !== 0)) {
      if (value.middle) {
        if (value.edge !== entity && value.edge !== original) {
          if ((local.flags & 0x10) === 0) return false;
          const other = this.get<Edge>("Edge", value.edge),
            old = this.originals(edge);
          if (
            !this.neighbors(edge, other) &&
            (!old || !this.neighbors(old, other))
          )
            return false;
        }
        continue;
      }
      const other = this.get<Edge>("Edge", value.edge),
        neighbor = value.end ? other.start : other.end;
      if (neighbor === edge.start || neighbor === edge.end) return false;
      if (++count >= 2 && local.flags & 4) return false;
      const position = this.get<Node>("Node", neighbor).position;
      if (distance(edgePosition, position) < nodeDistance) return false;
      const curve = this.get<Curve>("Curve", value.edge),
        tangent = normalize(
          xz(
            value.end
              ? endTangent(curve.bezier)
              : mul(startTangent(curve.bezier), -1),
          ),
          true,
        ),
        p = sub(
          xz(value.end ? curve.bezier[3] : curve.bezier[0]),
          mul(tangent, size),
        ),
        toward = normalize(sub(xz(edgePosition), p), true);
      if (dot2(tangent, toward) < f(0.70710677)) return false;
      if (forward.x !== 0 || forward.y !== 0 || forward.z !== 0) {
        const direction = normalize(xz(forward), true),
          dot = [dot2(tangent, direction), dot2(tangent, left(direction))],
          allowed = [
            true,
            (directions & 8) !== 0,
            (directions & 0x10) !== 0,
            (directions & 4) !== 0,
          ],
          values = [dot[0], dot[1], -dot[0], -dot[1]];
        if (!values.some((x, i) => x >= f(0.70710677) && allowed[i]))
          return false;
      }
    }
    const a = this.prefab(entity),
      b = this.prefab(node);
    if (
      (this.ecs.has("ServiceUpgradeData", a) ||
        this.ecs.has("ServiceUpgradeData", b)) &&
      this.topOwner(entity) !== this.topOwner(node)
    )
      return false;
    return true;
  }
  accept(
    entity: string,
    edge: Edge,
    curve: Curve,
    owner: Entity,
    original: Entity,
    node: Connection,
    size: number,
  ) {
    if (this.ecs.has("Deleted", node.node)) return false;
    const reference = this.prefab(node.node),
      local = this.asset<LocalConnect>("LocalConnectData", reference, [
        "flags",
      ]);
    if (!local) return false;
    const sideSize =
        local.flags & 0x10
          ? addN(
              mulN(this.assetGeometry(reference, true)!.defaultWidth, 0.5),
              0.1,
            )
          : 0,
      t = this.clampPosition(entity, edge, curve, node.curvePosition),
      point = cs2RoadCurvePosition(curve.bezier, t),
      position = this.get<Node>("Node", node.node).position,
      dist = distance(point, position),
      nodeOwner =
        this.optional<{ owner: Entity }>("Owner", node.node)?.owner ?? null;
    let directions = 0,
      forward = zero();
    if (nodeOwner !== null) {
      if (
        owner !== nodeOwner &&
        (this.elevation(entity, edge, this.geometry(entity)).general &
          0x20000) ===
          0
      ) {
        const first = this.allow(nodeOwner, [position, point]);
        directions = first.directions;
        forward = first.forward;
        if (
          !first.allowed ||
          (owner !== null && !this.allow(owner, [point, position]).allowed)
        )
          return false;
      }
    }
    if (local.flags & 8) {
      let found = false;
      for (const candidate of this.connections.get(node.node!) ?? []) {
        const candidateOriginal =
          this.optional<Temp>("Temp", candidate.edge)?.original ?? null;
        if (
          candidate.edge === entity ||
          candidate.edge === original ||
          candidateOriginal === entity
        ) {
          found = true;
          continue;
        }
        const other = this.get<Edge>("Edge", candidate.edge),
          otherCurve = this.get<Curve>("Curve", candidate.edge),
          g = this.geometry(candidate.edge),
          otherSize = mulN(g.defaultWidth, 0.5),
          u = this.clampPosition(
            candidate.edge,
            other,
            otherCurve,
            candidate.curvePosition,
          ),
          p = cs2RoadCurvePosition(otherCurve.bezier, u),
          d = distance(p, position);
        let delta = subN(subN(dist, size), subN(d, otherSize));
        const oldA = this.originals(edge),
          oldB = this.originals(other);
        if (
          local.flags & 0x10 &&
          delta >= 0 &&
          subN(delta, sideSize) <= 0 &&
          (this.neighbors(edge, other) ||
            (oldA && this.neighbors(oldA, other)) ||
            (oldB && this.neighbors(edge, oldB)))
        )
          delta = subN(
            delta,
            subN(
              f(Math.sqrt(addN(mulN(size, size), mulN(sideSize, sideSize)))),
              size,
            ),
          );
        if (
          (delta > 0 || (delta === 0 && !found)) &&
          (nodeOwner === null ||
            owner === nodeOwner ||
            (this.elevation(candidate.edge, other, g).general & 0x20000) !==
              0 ||
            (this.allow(nodeOwner, [position, p]).allowed &&
              (owner === null || this.allow(owner, [p, position]).allowed))) &&
          this.validate(
            candidate.edge,
            node.node,
            candidateOriginal,
            other,
            local,
            p,
            d,
            otherSize,
            directions,
            forward,
          )
        )
          return false;
      }
    }
    return this.validate(
      entity,
      node.node,
      original,
      edge,
      local,
      point,
      dist,
      size,
      directions,
      forward,
    );
  }
  rationalize(chunks: readonly CS2RoadApplyChunk[]) {
    for (const chunk of chunks) {
      if (chunk.components.has("Deleted")) continue;
      this.curveBounds.clear();
      this.nodePositions.clear();
      this.lines.length = 0;
      for (const entity of chunk.entities) {
        const edge = this.get<Edge>("Edge", entity),
          curve = this.get<Curve>("Curve", entity),
          owner =
            this.optional<{ owner: Entity }>("Owner", entity)?.owner ?? null,
          original = this.optional<Temp>("Temp", entity)?.original ?? null,
          size = mulN(this.geometry(entity).defaultWidth, 0.5),
          buffer = this.buffer<Connection>("ConnectedNode", entity);
        for (let i = buffer.length - 1; i >= 0; i--)
          if (
            !this.accept(entity, edge, curve, owner, original, buffer[i], size)
          )
            buffer.splice(i, 1);
      }
    }
  }
  references() {
    const nodes = this.ecs.chunks({
      all: ["Node"],
      any: ["Updated", "Deleted"],
    });
    if (nodes.length) {
      this.updateNodeReferences(nodes);
      this.validateConnectedNodes(
        this.ecs.chunks({
          all: ["Temp", "Edge"],
          none: ["Updated", "Deleted"],
        }),
      );
    }
    const edges = this.ecs.chunks({
      all: ["Edge"],
      any: ["Updated", "Deleted"],
    });
    if (edges.length) {
      this.updateEdgeReferences(edges);
      this.rationalize(edges);
      this.addConnectedNodeReferences(edges);
    }
  }
}
function sourceTransaction(
  run: () => { world: CS2RoadApplyWorld; candidates?: readonly Reduction[] },
): CS2RoadReferenceResult {
  try {
    return { status: "complete", ...run() };
  } catch (error) {
    if (error instanceof CS2RoadReferenceAssetDependency)
      return {
        status: "pending",
        dependency: "asset-fields",
        component: error.component,
        entity: error.entity,
        fields: error.fields,
      };
    throw error;
  }
}
export function cs2UpdateRoadReferences(
  world: CS2RoadApplyWorld,
): CS2RoadReferenceResult {
  return sourceTransaction(() => {
    const kernel = new FullReferencesKernel(world);
    kernel.references();
    return { world: kernel.ecs.snapshot() };
  });
}
type Reduction = {
  node: string;
  edgeLengthRange: [number, number];
  snapCellSize: boolean;
  forbidMove: boolean;
  checkHeight: boolean;
  noEdgeConnection: boolean;
};
function position2(c: CS2RoadCurve, t: number): V {
  const u = subN(1, t),
    a = mulN(mulN(u, u), u),
    b = mulN(mulN(mulN(3, t), u), u),
    d = mulN(mulN(t, t), t),
    cc = mulN(mulN(mulN(3, t), t), u);
  return {
    x: addN(
      addN(mulN(c[0].x, a), mulN(c[2].x, cc)),
      addN(mulN(c[1].x, b), mulN(c[3].x, d)),
    ),
    y: 0,
    z: addN(
      addN(mulN(c[0].z, a), mulN(c[2].z, cc)),
      addN(mulN(c[1].z, b), mulN(c[3].z, d)),
    ),
  };
}
function curveLength2(c: CS2RoadCurve) {
  let a = xz(c[0]),
    sum = 0;
  for (let i = 1; i <= 16; i++) {
    const b = position2(c, f(i / 16));
    sum = addN(sum, distance(a, b, true));
    a = b;
  }
  return sum;
}
function clampLength2(c: CS2RoadCurve, lo: number, hi: number, length: number) {
  if (length === 0) return lo;
  const step = divN(subN(hi, lo), 16);
  let a = lo,
    previous = position2(c, a),
    sum = 0;
  for (let i = 1; i <= 16; i++) {
    const b = addN(a, step),
      p = position2(c, b),
      next = addN(sum, distance(previous, p, true));
    if (next >= length)
      return clamp(
        mixN(a, b, divN(subN(length, sum), subN(next, sum))),
        min(lo, hi),
        max(lo, hi),
      );
    a = b;
    previous = p;
    sum = next;
  }
  return hi;
}
function divideCurve(c: CS2RoadCurve, t: number): [CS2RoadCurve, CS2RoadCurve] {
  const middle = mix(c[1], c[2], t),
    a = mix(c[0], c[1], t),
    d = mix(c[2], c[3], t),
    b = mix(a, middle, t),
    cc = mix(middle, d, t),
    p = mix(b, cc, t);
  return [
    [structuredClone(c[0]), a, b, p],
    [structuredClone(p), cc, d, structuredClone(c[3])],
  ];
}
function evenRound(x: number) {
  const low = Math.floor(x),
    fraction = x - low,
    result = fraction === 0.5 ? (low % 2 === 0 ? low : low + 1) : Math.round(x);
  return result === 0 && x < 0 ? -0 : result;
}
class ReductionKernel extends FullReferencesKernel {
  canMove(node: string, editor: boolean): Reduction | undefined {
    const data: Reduction = {
        node,
        edgeLengthRange: [0, 0],
        snapCellSize: false,
        forbidMove: false,
        checkHeight: false,
        noEdgeConnection: false,
      },
      temp = this.get<Temp>("Temp", node);
    if (temp.original === null || temp.flags & 0x302) return;
    let a: string | undefined, b: string | undefined;
    for (const value of this.edges(null, node, true)) {
      if (
        value.middle ||
        !this.ecs.has("Temp", value.edge) ||
        this.ecs.has("Fixed", value.edge)
      )
        return;
      if (a === undefined) a = value.edge;
      else if (b === undefined) b = value.edge;
      else return;
    }
    if (a === undefined || b === undefined) return;
    const ea = this.get<Edge>("Edge", a),
      eb = this.get<Edge>("Edge", b),
      starts = [ea.start === node, eb.start === node],
      ends = [ea.end === node, eb.end === node];
    if (starts.some((x, i) => x === ends[i])) return;
    const prefab = this.prefab(a);
    if (prefab !== this.prefab(b)) return;
    const source = this.assetGeometry(prefab),
      g = source ?? emptyGeometry();
    if (source) {
      if (starts[0] === starts[1] && g.flags & 0x10000) return;
      data.edgeLengthRange = range(g.edgeLengthRange);
      data.snapCellSize = (g.flags & 4) !== 0;
      data.forbidMove = (g.flags & 1) !== 0;
      data.noEdgeConnection = (g.flags & 0x40) !== 0;
    }
    let fa = this.elevation(a, ea, g),
      fb = this.elevation(b, eb, g);
    const invert = (x: Flags): Flags => ({
      general: x.general,
      left: x.right,
      right: x.left,
    });
    if (starts[0]) fa = invert(fa);
    if (ends[1]) fb = invert(fb);
    if (
      (fa.general ^ fb.general) & 0x30000 ||
      (fa.left ^ fb.left) & 3 ||
      (fa.right ^ fb.right) & 3
    )
      return;
    if (fa.general & 0x10000) data.edgeLengthRange[1] = g.elevatedLength;
    data.forbidMove ||= (fa.general & 0x10000) !== 0;
    data.checkHeight ||= (fa.general & 0x30000) !== 0;
    data.checkHeight ||= (fa.left & 3) !== 0 && (fa.right & 3) !== 0;
    let ua = this.optional<{ flags: Flags }>("Upgraded", a)?.flags ?? {
        general: 0,
        left: 0,
        right: 0,
      },
      ub = this.optional<{ flags: Flags }>("Upgraded", b)?.flags ?? {
        general: 0,
        left: 0,
        right: 0,
      };
    if (starts[0]) ua = invert(ua);
    if (ends[1]) ub = invert(ub);
    if (
      ua.general !== ub.general ||
      ua.left !== ub.left ||
      ua.right !== ub.right
    )
      return;
    const owners = [node, a, b].map(
      (e) => this.optional<{ owner: Entity }>("Owner", e)?.owner ?? null,
    );
    if (
      editor
        ? owners[1] !== owners[0] || owners[2] !== owners[0]
        : owners.some((x) => x !== null)
    )
      return;
    const definitions = [node, a, b].map(
      (e) =>
        this.optional<{ prefab: Entity; position: V; rotation: Q }>(
          "OwnerDefinition",
          e,
        ) ?? {
          prefab: null,
          position: zero(),
          rotation: { x: 0, y: 0, z: 0, w: 0 },
        },
    );
    if (editor) {
      const same = (
        a: (typeof definitions)[number],
        b: (typeof definitions)[number],
      ) =>
        a.prefab === b.prefab &&
        (["x", "y", "z"] as const).every(
          (k) => a.position[k] === b.position[k],
        ) &&
        (["x", "y", "z", "w"] as const).every(
          (k) => a.rotation[k] === b.rotation[k],
        );
      if (
        !same(definitions[1], definitions[0]) ||
        !same(definitions[2], definitions[0])
      )
        return;
    } else if (definitions.some((x) => x.prefab !== null)) return;
    let ca = this.get<Curve>("Curve", a).bezier,
      cb = this.get<Curve>("Curve", b).bezier;
    if (starts[0]) ca = inverse(ca);
    if (ends[1]) cb = inverse(cb);
    const tangentA = normalize(
        data.checkHeight ? endTangent(ca) : xz(endTangent(ca)),
        !data.checkHeight,
      ),
      tangentB = normalize(
        data.checkHeight ? startTangent(cb) : xz(startTangent(cb)),
        !data.checkHeight,
      );
    return (data.checkHeight
      ? dot(tangentA, tangentB)
      : dot2(tangentA, tangentB)) >= f(0.9995)
      ? data
      : undefined;
  }
  join(
    a: CS2RoadCurve,
    b: CS2RoadCurve,
    checkHeight: boolean,
  ): CS2RoadCurve | undefined {
    const scale = divN(distance(b[0], b[1]), distance(a[2], a[3])),
      curve: CS2RoadCurve = [
        structuredClone(a[0]),
        sub(mul(a[1], addN(1, scale)), mul(a[0], scale)),
        divVector(sub(mul(b[2], addN(1, scale)), b[3]), scale),
        structuredClone(b[3]),
      ],
      samples = [
        cs2RoadCurvePosition(a, 0.5),
        a[3],
        b[0],
        cs2RoadCurvePosition(b, 0.5),
      ],
      distances = samples.map(
        (p) => curveDistance(curve, p, !checkHeight).distance,
      );
    if (!checkHeight) {
      const offset = (p: V) => {
          const first = curveDistance(a, p),
            second = curveDistance(b, p);
          return subN(
            cs2RoadCurvePosition(
              first.distance < second.distance ? a : b,
              first.distance < second.distance ? first.t : second.t,
            ).y,
            p.y,
          );
        },
        first = offset(cs2RoadCurvePosition(curve, f(1 / 3))),
        second = offset(cs2RoadCurvePosition(curve, f(2 / 3)));
      curve[1].y = addN(curve[1].y, subN(mulN(first, 3), mulN(second, 1.5)));
      curve[2].y = addN(curve[2].y, subN(mulN(second, 3), mulN(first, 1.5)));
    }
    return distances.every((x) => x < f(0.1)) ? curve : undefined;
  }
  replaceConnection(node: Entity, edge: string, next: Entity) {
    if (this.ecs.has("Temp", node)) {
      const b = this.buffer<{ edge: string }>("ConnectedEdge", node),
        i = b.findIndex((x) => x.edge === edge);
      if (i >= 0) b.splice(i, 1);
    }
    if (this.ecs.has("Temp", next)) {
      const b = this.buffer<{ edge: string }>("ConnectedEdge", next);
      if (!b.some((x) => x.edge === edge)) b.push({ edge });
    }
    return next;
  }
  replaceData(
    source: string,
    target: string,
    sourceStart: boolean,
    targetStart: boolean,
  ) {
    if (this.ecs.has("Road", source) && this.ecs.has("Road", target)) {
      const a = this.get<CS2RoadApplyRecord>("Road", source),
        b = this.get<CS2RoadApplyRecord>("Road", target),
        sourceBit = sourceStart ? 1 : 2,
        targetBit = targetStart ? 1 : 2;
      b.flags =
        a.flags & sourceBit
          ? b.flags | targetBit
          : b.flags & (~targetBit & 255);
      this.set("Road", target, b);
    }
    if (
      this.ecs.has("BuildOrder", source) &&
      this.ecs.has("BuildOrder", target)
    ) {
      const a = this.get<{ start: number; end: number }>("BuildOrder", source),
        b = this.get<{ start: number; end: number }>("BuildOrder", target);
      b[targetStart ? "start" : "end"] = a[sourceStart ? "start" : "end"];
      this.set("BuildOrder", target, b);
    }
  }
  removeConnected(node: Entity, source: string) {
    if (!this.ecs.has("Temp", node)) return;
    const b = this.buffer<{ edge: string }>("ConnectedEdge", node),
      i = b.findIndex((x) => x.edge === source);
    if (i >= 0) b.splice(i, 1);
  }
  addConnected(node: Entity, target: string) {
    if (this.ecs.has("Temp", node))
      this.buffer<{ edge: string }>("ConnectedEdge", node).push({
        edge: target,
      });
  }
  switchConnected(node: Entity, source: string, target: string) {
    if (!this.ecs.has("Temp", node)) return;
    const b = this.buffer<{ edge: string }>("ConnectedEdge", node);
    for (let i = 0; i < b.length; i++)
      if (b[i].edge === source) b[i] = { edge: target };
  }
  getDistance(curve: Curve, node: Node, noConnection: boolean) {
    if (noConnection) {
      const a = distance(curve.bezier[0], node.position, true),
        b = distance(curve.bezier[3], node.position, true);
      return b < a ? { distance: b, t: 1 } : { distance: a, t: 0 };
    }
    return curveDistance(curve.bezier, node.position);
  }
  clampedDistance(curve: Curve, node: Node) {
    const { t } = curveDistance(curve.bezier, node.position),
      offset = curve.length >= f(0.2) ? divN(0.1, curve.length) : 0,
      clamped =
        curve.length >= f(0.2) ? clamp(t, offset, subN(1, offset)) : 0.5;
    return {
      t,
      distance: distance(
        cs2RoadCurvePosition(curve.bezier, clamped),
        node.position,
      ),
    };
  }
  moveMerged(
    source: string,
    target: string,
    curve: Curve,
    noConnection: boolean,
  ) {
    const a = this.buffer<Connection>("ConnectedNode", source),
      b = this.buffer<Connection>("ConnectedNode", target);
    for (let i = 0; i < b.length; i++) {
      const value = structuredClone(b[i]);
      value.curvePosition = this.getDistance(
        curve,
        this.get<Node>("Node", value.node),
        noConnection,
      ).t;
      b[i] = value;
    }
    for (const old of a) {
      const value = structuredClone(old);
      if (b.some((x) => x.node === value.node)) {
        this.removeConnected(value.node, source);
        continue;
      }
      value.curvePosition = this.getDistance(
        curve,
        this.get<Node>("Node", value.node),
        noConnection,
      ).t;
      b.push(value);
      this.switchConnected(value.node, source, target);
    }
    a.length = 0;
  }
  movePair(
    edgeA: string,
    edgeB: string,
    curveA: Curve,
    curveB: Curve,
    noConnection: boolean,
  ) {
    const a = this.buffer<Connection>("ConnectedNode", edgeA),
      b = this.buffer<Connection>("ConnectedNode", edgeB);
    let countA = a.length,
      countB = b.length;
    const pass = (
      from: Connection[],
      to: Connection[],
      source: string,
      target: string,
      firstCurve: Curve,
      secondCurve: Curve,
      first: boolean,
    ) => {
      let count = first ? countA : countB;
      for (let i = 0; i < count; i++) {
        const value = structuredClone(from[i]),
          node = this.get<Node>("Node", value.node),
          prefab = this.prefab(value.node),
          local = this.asset<LocalConnect>("LocalConnectData", prefab, [
            "flags",
          ]);
        if (local && local.flags & 0x10) {
          const size = addN(
              mulN(this.assetGeometry(prefab, true)!.defaultWidth, 0.5),
              0.1,
            ),
            road = mulN(
              this.assetGeometry(this.prefab(edgeA), true)!.defaultWidth,
              0.5,
            ),
            d = this.clampedDistance(firstCurve, node),
            other = this.clampedDistance(secondCurve, node),
            adjustment = subN(
              f(Math.sqrt(addN(mulN(road, road), mulN(size, size)))),
              road,
            );
          if (d.distance <= other.distance) {
            value.curvePosition = d.t;
            from[i] = structuredClone(value);
            other.distance = subN(other.distance, adjustment);
            if (
              other.distance <= d.distance &&
              !to.some((x) => x.node === value.node)
            ) {
              value.curvePosition = other.t;
              to.push(structuredClone(value));
              this.addConnected(value.node, target);
            }
            continue;
          }
          d.distance = subN(d.distance, adjustment);
          if (d.distance <= other.distance) {
            value.curvePosition = d.t;
            from[i] = structuredClone(value);
            continue;
          }
          from.splice(i--, 1);
          count--;
          if (to.some((x) => x.node === value.node)) {
            this.removeConnected(value.node, source);
            continue;
          }
          value.curvePosition = other.t;
          to.push(value);
          this.switchConnected(value.node, source, target);
        } else {
          const d = this.getDistance(firstCurve, node, noConnection),
            other = this.getDistance(secondCurve, node, noConnection);
          if (
            d.distance <= other.distance ||
            to.some((x) => x.node === value.node)
          ) {
            value.curvePosition = d.t;
            from[i] = structuredClone(value);
            continue;
          }
          value.curvePosition = other.t;
          to.push(value);
          from.splice(i--, 1);
          this.switchConnected(value.node, source, target);
          count--;
        }
      }
      if (first) countA = count;
      else countB = count;
    };
    pass(a, b, edgeA, edgeB, curveA, curveB, true);
    pass(b, a, edgeB, edgeA, curveB, curveA, false);
  }
  reduce(data: Reduction) {
    let a: string | undefined, b: string | undefined;
    for (const { edge } of this.buffer<{ edge: string }>(
      "ConnectedEdge",
      data.node,
    )) {
      if (this.get<Temp>("Temp", edge).flags & 2) continue;
      if (a === undefined) a = edge;
      else if (b === undefined) b = edge;
      else return;
    }
    if (a === undefined || b === undefined) return;
    const temp = this.get<Temp>("Temp", data.node),
      ta = this.get<Temp>("Temp", a),
      tb = this.get<Temp>("Temp", b),
      ea = this.get<Edge>("Edge", a),
      eb = this.get<Edge>("Edge", b),
      starts = [ea.start === data.node, eb.start === data.node],
      ends = [ea.end === data.node, eb.end === data.node],
      ca = this.get<Curve>("Curve", a),
      cb = this.get<Curve>("Curve", b);
    if (starts[0]) ca.bezier = inverse(ca.bezier);
    if (ends[1]) cb.bezier = inverse(cb.bezier);
    const lengthA = curveLength2(ca.bezier),
      lengthB = curveLength2(cb.bezier),
      maximum = data.edgeLengthRange[1];
    if (maximum === 0 || addN(lengthA, lengthB) <= maximum) {
      const keepB =
          (ta.original !== null) === (tb.original !== null)
            ? lengthA < lengthB
            : ta.original !== null,
        joined = this.join(ca.bezier, cb.bezier, data.checkHeight);
      if (!joined) return;
      if (ta.original !== null) joined[1].y = ca.bezier[1].y;
      if (tb.original !== null) joined[2].y = cb.bezier[2].y;
      temp.flags = 2 | 0x400;
      this.set("Temp", data.node, temp);
      const discarded = keepB ? ta : tb,
        kept = keepB ? tb : ta;
      if (discarded.flags & (1 | 0x40 | 0x100)) kept.flags |= 0x40;
      kept.flags |= discarded.flags & (8 | 0x200 | 0x800);
      if (kept.original !== null) kept.flags |= 0x1000;
      discarded.flags = (kept.flags & 8) | (2 | 0x400);
      if (kept.flags & 8 && kept.flags & (1 | 0x40 | 0x100 | 0x200))
        discarded.flags |= 0x2000;
      const source = keepB ? a : b,
        target = keepB ? b : a,
        curve = keepB ? cb : ca,
        edge = keepB ? eb : ea;
      curve.bezier = joined;
      curve.length = cs2RoadCurveLength(joined);
      if (keepB) {
        if (ends[1]) {
          curve.bezier = inverse(curve.bezier);
          edge.end = this.replaceConnection(
            edge.end,
            target,
            starts[0] ? ea.end : ea.start,
          );
        } else
          edge.start = this.replaceConnection(
            edge.start,
            target,
            starts[0] ? ea.end : ea.start,
          );
        this.replaceData(source, target, ends[0], starts[1]);
      } else {
        if (starts[0]) {
          curve.bezier = inverse(curve.bezier);
          edge.start = this.replaceConnection(
            edge.start,
            target,
            ends[1] ? eb.start : eb.end,
          );
        } else
          edge.end = this.replaceConnection(
            edge.end,
            target,
            ends[1] ? eb.start : eb.end,
          );
        this.replaceData(source, target, ends[1], starts[0]);
      }
      this.moveMerged(source, target, curve, data.noEdgeConnection);
      this.set("Curve", target, curve);
      this.set("Edge", target, edge);
      this.set("Temp", a, ta);
      this.set("Temp", b, tb);
    } else {
      if (
        data.forbidMove ||
        (!(lengthA < mulN(maximum, 0.5)) && !(lengthB < mulN(maximum, 0.5)))
      )
        return;
      let offset = mulN(Math.abs(subN(lengthA, lengthB)), 0.5);
      if (data.snapCellSize)
        offset = mulN(evenRound(divN(subN(offset, 1), 8)), 8);
      if (offset < 1) return;
      if (lengthA >= lengthB) {
        const t = clampLength2(ca.bezier, 1, 0, offset),
          [first, last] = divideCurve(ca.bezier, t),
          joined = this.join(last, cb.bezier, data.checkHeight);
        if (!joined) return;
        if (tb.original !== null) joined[2].y = cb.bezier[2].y;
        ca.bezier = first;
        cb.bezier = joined;
        if (
          (tb.flags & (1 | 0x40 | 0x100 | 0x800)) === 0 &&
          ta.flags & (1 | 0x40 | 0x100 | 0x800)
        )
          tb.flags |= ta.flags & 0x800 ? 0x800 : 0x40;
      } else {
        const t = clampLength2(cb.bezier, 0, 1, offset),
          [first, last] = divideCurve(cb.bezier, t),
          joined = this.join(ca.bezier, first, data.checkHeight);
        if (!joined) return;
        if (ta.original !== null) joined[1].y = ca.bezier[1].y;
        cb.bezier = last;
        ca.bezier = joined;
        if (
          (ta.flags & (1 | 0x40 | 0x100 | 0x800)) === 0 &&
          tb.flags & (1 | 0x40 | 0x100 | 0x800)
        )
          ta.flags |= tb.flags & 0x800 ? 0x800 : 0x40;
      }
      const changedA = (ta.flags & (1 | 0x40 | 0x100 | 0x200)) !== 0,
        changedB = (tb.flags & (1 | 0x40 | 0x100 | 0x200)) !== 0;
      if (ta.flags & 8 && changedA && !changedB) tb.flags |= 0x2000;
      if (tb.flags & 8 && changedB && !changedA) ta.flags |= 0x2000;
      if (starts[0]) ca.bezier = inverse(ca.bezier);
      if (ends[1]) cb.bezier = inverse(cb.bezier);
      ca.length = cs2RoadCurveLength(ca.bezier);
      cb.length = cs2RoadCurveLength(cb.bezier);
      this.movePair(a, b, ca, cb, data.noEdgeConnection);
      this.set("Curve", a, ca);
      this.set("Curve", b, cb);
      ta.flags |= tb.flags & 8;
      tb.flags |= ta.flags & 8;
      this.set("Temp", a, ta);
      this.set("Temp", b, tb);
    }
  }
  reductions(editor: boolean, candidateOrder?: readonly string[]) {
    const queue: Reduction[] = [];
    for (const chunk of this.ecs.chunks({
      all: ["Temp", "Node", "Updated"],
      none: ["Deleted", "Fixed"],
    }))
      for (const entity of chunk.entities) {
        const candidate = this.canMove(entity, editor);
        if (candidate) queue.push(candidate);
      }
    if (candidateOrder) {
      const nodes = new Set(queue.map((x) => x.node));
      if (
        candidateOrder.length !== queue.length ||
        new Set(candidateOrder).size !== queue.length ||
        candidateOrder.some((x) => !nodes.has(x))
      )
        throw new Error(
          "Source reduction candidateOrder must be a permutation of the full source candidate queue",
        );
      const priorities = new Map(candidateOrder.map((x, i) => [x, i]));
      queue.sort((a, b) => priorities.get(a.node)! - priorities.get(b.node)!);
    }
    const count = queue.length;
    for (let i = 0; i < count; i++) this.reduce(queue[i]);
    return queue;
  }
}
export function cs2ReduceRoadNodes(
  world: CS2RoadApplyWorld,
  options: CS2RoadReferenceOptions = {},
): CS2RoadReferenceResult {
  return sourceTransaction(() => {
    const kernel = new ReductionKernel(world),
      candidates = kernel.reductions(
        options.editorMode ?? false,
        options.candidateOrder,
      );
    return { world: kernel.ecs.snapshot(), candidates };
  });
}
export function cs2UpdateRoadReferencesAndReduce(
  world: CS2RoadApplyWorld,
  options: CS2RoadReferenceOptions = {},
): CS2RoadReferenceResult {
  return sourceTransaction(() => {
    const kernel = new ReductionKernel(world);
    kernel.references();
    const candidates = kernel.reductions(
      options.editorMode ?? false,
      options.candidateOrder,
    );
    return { world: kernel.ecs.snapshot(), candidates };
  });
}
