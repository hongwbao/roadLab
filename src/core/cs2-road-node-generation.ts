/** Original GenerateNodesSystem jobs, with explicit ECS storage and ModificationBarrier1. */
import type { V } from "./types";
import type { CS2RoadCurve } from "./cs2-net-geometry";
import { cs2RoadCurvePosition, cs2RoadCurveTangent } from "./cs2-net-geometry";
import {
  cs2CutRoadCourseCurve,
  type CS2RoadCoursePos,
  type CS2RoadCourseOwner,
  type CS2RoadCreationDefinition,
} from "./cs2-road-courses";
import {
  cs2RoadXZDistance,
  cs2ClampRoadCurveLengthRange,
  type CS2RoadBounds,
} from "./cs2-road-intersections";
import {
  cs2LookRotation,
  cs2RotateMotionVector,
} from "../simulation/cs2-motion";
import { SourceRandom32 } from "../simulation/cs2-path-search";
import {
  CS2RoadApplyECS,
  CS2RoadApplyCommandWriter,
  type CS2RoadApplyWorld,
  type CS2RoadApplyRecord,
  type CS2RoadApplyNode as Node,
  type CS2RoadApplyEdge as Edge,
  type CS2RoadApplyCurve as Curve,
  type CS2RoadApplyTemp as Temp,
  type CS2RoadApplyTreeNode,
} from "./cs2-road-ecs";

type Entity = string | null;
type Flags = { general: number; left: number; right: number };
type Owner = CS2RoadCourseOwner;
type Definition = CS2RoadCreationDefinition;
type Course = {
  startPosition: CS2RoadCoursePos;
  endPosition: CS2RoadCoursePos;
  curve: CS2RoadCurve;
  fixedIndex: number;
};
type Net = {
  nodeArchetype: string;
  requiredLayers: number;
  connectLayers: number;
  localConnectLayers: number;
  nodePriority: number;
};
type Geometry = { flags: number; defaultWidth: number; elevationLimit: number };
type Local = {
  flags: number;
  layers: number;
  searchDistance: number;
  heightRange: [number, number];
};
type Update = {
  onCourse: boolean;
  regenerate: boolean;
  hasCachedPosition: boolean;
  addEdge: boolean;
  updateOnly: boolean;
  valid: boolean;
  position: V;
  cachedPosition: V;
  rotation: Node["rotation"];
  prefab: Entity;
  original: Entity;
  owner: Entity;
  lane: Entity;
  ownerData: Owner;
  curvePosition: number;
  curveBounds: [number, number];
  elevation: [number, number];
  flags: number;
  creationFlags: number;
  upgradeFlags: Flags;
  fixedIndex: number;
  randomSeed: number;
  parentMesh: number;
};
const f = Math.fround;
const plus = (a: number, b: number) => f(f(a) + f(b)),
  minus = (a: number, b: number) => f(f(a) - f(b)),
  times = (a: number, b: number) => f(f(a) * f(b));
const zero = (): V => ({ x: 0, y: 0, z: 0 });
const emptyOwner = (): Owner => ({
  prefab: null,
  position: zero(),
  rotation: { x: 0, y: 0, z: 0, w: 0 },
});
const emptyFlags = (): Flags => ({ general: 0, left: 0, right: 0 });
const orFlags = (a: Flags, b: Flags): Flags => ({
  general: (a.general | b.general) >>> 0,
  left: (a.left | b.left) >>> 0,
  right: (a.right | b.right) >>> 0,
});
const eq = (a: V, b: V) => a.x === b.x && a.y === b.y && a.z === b.z;
const sub = (a: V, b: V): V => ({
  x: minus(a.x, b.x),
  y: minus(a.y, b.y),
  z: minus(a.z, b.z),
});
const dot = (a: V, b: V) =>
  plus(plus(times(a.x, b.x), times(a.y, b.y)), times(a.z, b.z));
const dotXZ = (a: V, b: V) => plus(times(a.x, b.x), times(a.z, b.z));
const distXZ = (a: V, b: V) => f(Math.sqrt(dotXZ(sub(a, b), sub(a, b))));
const overlap = (a: CS2RoadBounds, b: CS2RoadBounds) =>
  ["x", "y", "z"].every(
    (k) =>
      a.min[k as keyof V] <= b.max[k as keyof V] &&
      a.max[k as keyof V] >= b.min[k as keyof V],
  );
const bounds = (curve: CS2RoadCurve, expand: V): CS2RoadBounds => ({
  min: {
    x: minus(Math.min(...curve.map((v) => v.x)), expand.x),
    y: minus(Math.min(...curve.map((v) => v.y)), expand.y),
    z: minus(Math.min(...curve.map((v) => v.z)), expand.z),
  },
  max: {
    x: plus(Math.max(...curve.map((v) => v.x)), expand.x),
    y: plus(Math.max(...curve.map((v) => v.y)), expand.y),
    z: plus(Math.max(...curve.map((v) => v.z)), expand.z),
  },
});
function localPosition(transform: Node, position: V): V {
  const q = transform.rotation;
  const square = plus(
    plus(plus(times(q.x, q.x), times(q.y, q.y)), times(q.z, q.z)),
    times(q.w, q.w),
  );
  const inv = f(1 / square);
  return cs2RotateMotionVector(
    {
      x: times(-q.x, inv),
      y: times(-q.y, inv),
      z: times(-q.z, inv),
      w: times(q.w, inv),
    },
    sub(position, transform.position),
  );
}
function existing(
  node: Node,
  original: Entity,
  regenerate: boolean,
  updateOnly: boolean,
): Update {
  return {
    onCourse: false,
    regenerate,
    hasCachedPosition: false,
    addEdge: false,
    updateOnly,
    valid: true,
    position: node.position,
    cachedPosition: zero(),
    rotation: node.rotation,
    prefab: null,
    original,
    owner: null,
    lane: null,
    ownerData: emptyOwner(),
    curvePosition: 0,
    curveBounds: [0, 1],
    elevation: [0, 0],
    flags: 0,
    creationFlags: 0,
    upgradeFlags: emptyFlags(),
    fixedIndex: 0,
    randomSeed: 0,
    parentMesh: -1,
  };
}
/** Source MultiHashMap per-key chains: prepend on Add, reverse old chains on capacity growth. */
class MultiMap<T> {
  readonly rows = new Map<string, T[]>();
  count = 0;
  constructor(private capacity: number) {}
  add(key: string, value: T) {
    if (this.count >= this.capacity) {
      for (const values of this.rows.values()) values.reverse();
      this.capacity = Math.max(1, this.capacity * 2);
    }
    this.count++;
    const list = this.rows.get(key) ?? [];
    list.unshift(value);
    this.rows.set(key, list);
  }
  get(key: string) {
    return this.rows.get(key) ?? [];
  }
}
class NodeGeneration {
  readonly ecs: CS2RoadApplyECS;
  readonly commands: CS2RoadApplyCommandWriter;
  readonly queue: Update[] = [];
  readonly definitions = new Map<
    string,
    { prefab: Entity; lane: Entity; flags: number }
  >();
  readonly old = new MultiMap<{ entity: string; position: V }>(32);
  constructor(
    readonly input: CS2RoadApplyWorld,
    readonly editorMode: boolean,
  ) {
    this.ecs = new CS2RoadApplyECS(input);
    this.commands = new CS2RoadApplyCommandWriter(
      "ModificationBarrier1",
      this.ecs,
    );
  }
  get<T = CS2RoadApplyRecord>(type: string, id: Entity): T {
    return this.ecs.get<T>(type, id);
  }
  has(type: string, id: Entity) {
    return this.ecs.has(type, id);
  }
  prefab(id: Entity): Entity {
    return this.get<{ prefab: Entity }>("PrefabRef", id).prefab;
  }
  lane(id: Entity): Entity {
    return (
      this.ecs.tryGet<{ prefab: Entity }>("EditorContainer", id)?.prefab ?? null
    );
  }
  edges(id: Entity) {
    return this.ecs.buffer("ConnectedEdge", id) as { edge: string }[];
  }
  enqueue(id: Entity, regenerate: boolean, permanent: boolean) {
    const n = this.get<Node>("Node", id);
    this.queue.push(existing(n, id, regenerate && !permanent, permanent));
  }
  updateOnly(id: Entity) {
    this.queue.push(
      existing(
        { position: zero(), rotation: { x: 0, y: 0, z: 0, w: 0 } },
        id,
        false,
        true,
      ),
    );
  }
  tryingToDelete(id: Entity) {
    return id !== null && !!((this.definitions.get(id)?.flags ?? 0) & (4 | 32));
  }
  addConnectedEdges(
    node: Entity,
    other: Entity | undefined,
    permanent: boolean,
  ) {
    for (const { edge: id } of this.edges(node)) {
      if (this.has("Deleted", id)) continue;
      if (permanent) this.updateOnly(id);
      const edge = this.get<Edge>("Edge", id);
      if (other !== undefined) {
        if (edge.start !== node && edge.start !== other)
          this.enqueue(edge.start, false, permanent);
        if (edge.end !== node && edge.end !== other)
          this.enqueue(edge.end, false, permanent);
      } else {
        if (edge.end === node) this.enqueue(edge.start, false, permanent);
        if (edge.start === node) this.enqueue(edge.end, false, permanent);
      }
    }
  }
  addConnectedNodes(original: Entity, deleteEdge: Entity, permanent: boolean) {
    if (this.has("Edge", original)) {
      const edge = this.get<Edge>("Edge", original);
      this.enqueue(edge.start, true, permanent);
      this.enqueue(edge.end, true, permanent);
      this.addConnectedEdges(edge.start, edge.end, permanent);
      this.addConnectedEdges(edge.end, edge.start, permanent);
      for (const { node } of this.ecs.buffer("ConnectedNode", original)) {
        this.enqueue(node, true, permanent);
        this.addConnectedEdges(node, undefined, permanent);
      }
      return;
    }
    if (!this.has("Node", original)) return;
    const connections = this.edges(original);
    if (deleteEdge !== null && connections.length !== 3) deleteEdge = null;
    for (const { edge: id } of connections) {
      if (this.has("Deleted", id)) continue;
      if (permanent) this.updateOnly(id);
      let edge = this.get<Edge>("Edge", id);
      const a = edge.start !== original,
        b = edge.end !== original;
      if (a && b) {
        this.enqueue(edge.start, true, permanent);
        this.enqueue(edge.end, true, permanent);
        this.addConnectedEdges(edge.start, edge.end, permanent);
        this.addConnectedEdges(edge.end, edge.start, permanent);
      } else {
        if (a) {
          this.enqueue(edge.start, deleteEdge !== null, permanent);
          if (deleteEdge !== null)
            this.addConnectedEdges(edge.start, original, permanent);
        }
        if (b) {
          this.enqueue(edge.end, deleteEdge !== null, permanent);
          if (deleteEdge !== null)
            this.addConnectedEdges(edge.end, original, permanent);
        }
      }
      for (const { node } of this.ecs.buffer("ConnectedNode", id)) {
        this.enqueue(node, true, permanent);
        this.addConnectedEdges(node, undefined, permanent);
      }
      if (a === b) continue;
      const curve = this.get<Curve>("Curve", id);
      let entity = id;
      const owner =
        this.ecs.tryGet<{ owner: Entity }>("Owner", id)?.owner ?? null;
      const parent = this.ecs.tryGet<Edge>("Edge", owner);
      const addPeer = (target: Entity, edge: Edge) => {
        const peer = this.get<Curve>("Curve", target),
          inverse =
            dotXZ(
              sub(curve.bezier[3], curve.bezier[0]),
              sub(peer.bezier[3], peer.bezier[0]),
            ) < 0;
        this.enqueue(edge.start, inverse ? a : b, permanent);
        this.enqueue(edge.end, inverse ? b : a, permanent);
        if (inverse ? a : b)
          this.addConnectedEdges(edge.start, edge.end, permanent);
        if (inverse ? b : a)
          this.addConnectedEdges(edge.end, edge.start, permanent);
      };
      if (parent) {
        entity = owner!;
        edge = parent;
        if (permanent) this.updateOnly(entity);
        addPeer(entity, edge);
      }
      if (this.ecs.hasBuffer("SubNet", entity))
        for (const { subNet } of this.ecs.buffer("SubNet", entity)) {
          const peer = this.ecs.tryGet<Edge>("Edge", subNet);
          if (subNet !== id && peer) {
            if (permanent) this.updateOnly(subNet);
            addPeer(subNet, peer);
          }
        }
    }
  }
  visit(search: CS2RoadBounds, callback: (entity: string) => void) {
    const walk = (nodes: readonly CS2RoadApplyTreeNode[]) => {
      for (const node of nodes) {
        if (!overlap(node.bounds, search)) continue;
        if (node.children !== undefined) walk(node.children);
        else if (node.entity !== undefined && node.entity !== null)
          callback(node.entity);
      }
    };
    if (this.input.searchTree === undefined)
      throw new Error("Missing source NetSearchTree");
    walk(this.input.searchTree);
  }
  addEdgesForLocalConnect(
    flags: number,
    ignore: Entity,
    p: V,
    elevation: [number, number],
    prefab: Entity,
    permanent: boolean,
    standalone: boolean,
  ) {
    let y: [number, number] = [f(3.4028235e38), f(-3.4028235e38)],
      r: [number, number] = [0, 0],
      attach = 0,
      connect = 0,
      local = 0;
    const net = this.get<Net>("NetData", prefab),
      g = this.ecs.tryGet<Geometry>("NetGeometryData", prefab) ?? {
        flags: 0,
        defaultWidth: 0,
        elevationLimit: 0,
      };
    if (
      elevation.every((v) => v >= times(g.elevationLimit, 2)) ||
      (!elevation.every((v) => v < 0) && !!(net.requiredLayers & 6))
    ) {
      const half = times(g.defaultWidth, 0.5),
        ground = minus(p.y, Math.min(...elevation));
      y = [
        Math.min(y[0], minus(ground, half)),
        Math.max(y[1], plus(ground, half)),
      ];
      r = [Math.max(r[0], half), Math.max(r[1], half)];
      attach |= 1;
    }
    const l = this.ecs.tryGet<Local>("LocalConnectData", prefab);
    if (l && (!(l.flags & 1) || !!(flags & 3))) {
      const x = plus(times(g.defaultWidth, 0.5), l.searchDistance),
        z = plus(
          x,
          !standalone && l.searchDistance !== 0 && !(g.flags & 0x1000000)
            ? 8
            : 0,
        );
      y = [
        Math.min(y[0], plus(p.y, l.heightRange[0])),
        Math.max(y[1], plus(p.y, l.heightRange[1])),
      ];
      r = [Math.max(r[0], x), Math.max(r[1], z)];
      connect |= l.layers;
      local |= net.connectLayers;
    }
    if (!(attach | connect | local)) return;
    const max = Math.max(...r),
      search = {
        min: { x: minus(p.x, max), y: y[0], z: minus(p.z, max) },
        max: { x: plus(p.x, max), y: y[1], z: plus(p.z, max) },
      };
    this.visit(search, (id) => {
      if (id === ignore || !this.has("Curve", id)) return;
      const asset = this.prefab(id),
        peer = this.get<Net>("NetData", asset);
      if (
        !(attach & peer.connectLayers) &&
        (!(connect & peer.connectLayers) || !(local & peer.localConnectLayers))
      )
        return;
      const edge = this.get<Edge>("Edge", id);
      if (edge.start === ignore || edge.end === ignore) return;
      const curve = this.get<Curve>("Curve", id),
        geometry = this.get<Geometry>("NetGeometryData", asset),
        road = this.ecs.tryGet<{ flags: number }>("RoadData", asset);
      const radius =
        !this.has("Owner", id) && !!(road?.flags! & 1) ? r[1] : r[0];
      let hit =
        cs2RoadXZDistance(curve.bezier, p).distance <=
        plus(times(geometry.defaultWidth, 0.5), radius);
      if (!hit)
        for (const n of [edge.start, edge.end]) {
          const circle = this.ecs.tryGet<{ radius: number }>("Roundabout", n),
            node = this.ecs.tryGet<Node>("Node", n);
          if (
            circle &&
            node &&
            distXZ(node.position, p) <= plus(circle.radius, radius)
          )
            hit = true;
        }
      if (!hit) return;
      if (permanent) {
        this.updateOnly(id);
        this.updateOnly(edge.start);
        this.updateOnly(edge.end);
        return;
      }
      this.enqueue(edge.start, true, false);
      this.enqueue(edge.end, true, false);
      this.addConnectedEdges(edge.start, edge.end, false);
      this.addConnectedEdges(edge.end, edge.start, false);
    });
  }
  addNodesForLocalConnect(
    curve: CS2RoadCurve,
    prefab: Entity,
    permanent: boolean,
    standalone: boolean,
  ) {
    const net = this.get<Net>("NetData", prefab),
      g = this.ecs.tryGet<Geometry>("NetGeometryData", prefab),
      half = times(g?.defaultWidth ?? 0, 0.5),
      road = this.ecs.tryGet<{ flags: number }>("RoadData", prefab);
    const r: [number, number] = [
        half,
        plus(half, standalone && !!(road?.flags! & 1) ? 8 : 0),
      ],
      max = plus(Math.max(...r), 4),
      search = bounds(curve, { x: max, y: 1000, z: max });
    this.visit(search, (id) => {
      if (!this.has("Node", id) || !this.has("LocalConnect", id)) return;
      const asset = this.prefab(id),
        l = this.ecs.tryGet<Local>("LocalConnectData", asset);
      if (!l || !(net.connectLayers & l.layers)) return;
      const geometry = this.get<Geometry>("NetGeometryData", asset),
        radius = Math.max(
          0,
          plus(times(geometry.defaultWidth, 0.5), l.searchDistance),
        ),
        node = this.get<Node>("Node", id),
        p = node.position;
      if (
        !overlap(search, {
          min: {
            x: minus(p.x, radius),
            y: plus(p.y, l.heightRange[0]),
            z: minus(p.z, radius),
          },
          max: {
            x: plus(p.x, radius),
            y: plus(p.y, l.heightRange[1]),
            z: plus(p.z, radius),
          },
        })
      )
        return;
      const extra =
        this.has("Owner", id) &&
        l.searchDistance !== 0 &&
        !(geometry.flags & 0x1000000)
          ? r[1]
          : r[0];
      if (!(cs2RoadXZDistance(curve, p).distance <= plus(radius, extra)))
        return;
      if (permanent) {
        this.updateOnly(id);
        return;
      }
      this.enqueue(id, true, false);
      for (const { edge: connection } of this.edges(id)) {
        const e = this.get<Edge>("Edge", connection);
        if (e.start === id) this.enqueue(e.end, false, false);
        else if (e.end === id) this.enqueue(e.start, false, false);
      }
    });
  }
  addCourseNode(
    d: Definition,
    owner: Owner,
    p: CS2RoadCoursePos,
    upgraded: Flags,
    fixedIndex: number,
    cached: V,
    hasCache: boolean,
    addEdge: boolean,
  ) {
    if (d.prefab === null && p.entity === null) return;
    p = structuredClone(p);
    let range: [number, number] = [0, 1];
    const curve = this.ecs.tryGet<Curve>("Curve", p.entity);
    if (curve) {
      range = [p.splitPosition, p.splitPosition];
      const geometry = this.ecs.tryGet<Geometry>("NetGeometryData", d.prefab);
      if (geometry) {
        const half = times(geometry.defaultWidth, 0.5),
          t = cs2RoadXZDistance(curve.bezier, p.position).t,
          a: [number, number] = [0, t],
          b: [number, number] = [t, 1];
        cs2ClampRoadCurveLengthRange(curve.bezier, a, half, true, true);
        cs2ClampRoadCurveLengthRange(curve.bezier, b, half, true);
        range = [Math.min(range[0], a[0]), Math.max(range[1], b[1])];
      }
    } else {
      p.splitPosition = 0;
      if (d.flags & 1 && this.has("Node", p.entity)) {
        this.queue.push(
          existing(this.get<Node>("Node", p.entity), p.entity, false, true),
        );
        return;
      }
    }
    this.queue.push({
      onCourse: true,
      regenerate: true,
      hasCachedPosition: hasCache,
      addEdge,
      updateOnly: false,
      valid: true,
      position: p.position,
      cachedPosition: cached,
      rotation: p.rotation,
      prefab: d.prefab,
      original: p.entity,
      owner: d.owner,
      lane: d.subPrefab,
      ownerData: structuredClone(owner),
      curvePosition: p.splitPosition,
      curveBounds: range,
      elevation: p.elevation,
      flags: p.flags,
      creationFlags: d.flags,
      upgradeFlags: structuredClone(upgraded),
      fixedIndex,
      randomSeed: d.randomSeed,
      parentMesh: p.parentMesh,
    });
  }
  fill() {
    const chunks = this.ecs.chunks({
      all: ["CreationDefinition", "Updated"],
      any: ["NetCourse", "ObjectDefinition"],
    });
    for (const chunk of chunks) {
      for (const id of chunk.entities) {
        const d = this.get<Definition>("CreationDefinition", id);
        if (d.original !== null && !this.definitions.has(d.original))
          this.definitions.set(d.original, {
            prefab: d.prefab,
            lane: d.subPrefab,
            flags: d.flags,
          });
      }
      if (!chunk.components.has("NetCourse")) continue;
      for (const id of chunk.entities) {
        const d = this.get<Definition>("CreationDefinition", id);
        if (this.has("Deleted", d.owner)) continue;
        const course = this.get<Course>("NetCourse", id),
          owner = this.ecs.tryGet<Owner>("OwnerDefinition", id) ?? emptyOwner(),
          cache = this.ecs.tryGet<{ curve: CS2RoadCurve }>(
            "LocalCurveCache",
            id,
          );
        let upgraded =
          this.ecs.tryGet<{ flags: Flags }>("Upgraded", id)?.flags ??
          emptyFlags();
        const random = new SourceRandom32(
          Math.max(1, (d.randomSeed & 65535) ^ 43059),
        );
        random.nextUInt();
        random.nextUInt();
        const seeds = [0, 0].map(
          () => (((random.nextUInt() + 1) >>> 0) ^ 0x80000000) | 0,
        );
        const a = course.startPosition,
          b = course.endPosition,
          same = eq(a.position, b.position);
        if (!((a.flags | b.flags) & 0x4000)) {
          if (same) {
            const useStart = a.entity !== null && b.entity === null;
            d.randomSeed = seeds[useStart ? 0 : 1];
            this.addCourseNode(
              d,
              owner,
              useStart ? a : b,
              upgraded,
              course.fixedIndex,
              cache?.curve[useStart ? 0 : 3] ?? zero(),
              !!cache,
              false,
            );
          } else {
            d.flags &= ~(2 | 16);
            upgraded = emptyFlags();
            d.randomSeed = seeds[0];
            this.addCourseNode(
              d,
              owner,
              a,
              upgraded,
              course.fixedIndex,
              cache?.curve[0] ?? zero(),
              !!cache,
              !(d.flags & 4),
            );
            d.randomSeed = seeds[1];
            this.addCourseNode(
              d,
              owner,
              b,
              upgraded,
              course.fixedIndex,
              cache?.curve[3] ?? zero(),
              !!cache,
              !(d.flags & 4),
            );
          }
        }
        const permanent = !!(d.flags & 1),
          deleteEdge = !permanent && !!(d.flags & 4) ? d.original : null;
        if (a.entity !== null)
          this.addConnectedNodes(a.entity, deleteEdge, permanent);
        if (b.entity !== null)
          this.addConnectedNodes(b.entity, deleteEdge, permanent);
        const prefab =
          d.prefab !== null
            ? d.prefab
            : (this.ecs.tryGet<{ prefab: Entity }>("PrefabRef", d.original)
                ?.prefab ?? null);
        if (prefab !== null) {
          const standalone = !chunk.components.has("OwnerDefinition");
          this.addEdgesForLocalConnect(
            a.flags,
            a.entity,
            a.position,
            a.elevation,
            prefab,
            permanent,
            standalone,
          );
          if (!same) {
            this.addEdgesForLocalConnect(
              b.flags,
              b.entity,
              b.position,
              b.elevation,
              prefab,
              permanent,
              standalone,
            );
            if (d.prefab !== null)
              this.addNodesForLocalConnect(
                cs2CutRoadCourseCurve(course.curve, [
                  a.courseDelta,
                  b.courseDelta,
                ]),
                d.prefab,
                permanent,
                standalone,
              );
          }
        }
      }
    }
  }
  collect() {
    const result: Update[] = [],
      map = new MultiMap<number>(this.queue.length);
    for (let value of this.queue) {
      value = structuredClone(value);
      const key =
        value.original !== null
          ? JSON.stringify([value.original])
          : JSON.stringify([
              value.position.x,
              value.position.y,
              value.position.z,
              value.lane !== null,
            ]);
      let index = -1;
      for (const item of map.get(key)) {
        let data = structuredClone(result[item]);
        if (
          !data.valid ||
          value.curveBounds[0] > data.curveBounds[1] ||
          value.curveBounds[1] < data.curveBounds[0]
        )
          continue;
        if (value.onCourse) {
          if (data.onCourse) {
            value.addEdge ||= data.addEdge;
            value.fixedIndex = Math.min(value.fixedIndex, data.fixedIndex);
            value.creationFlags =
              (value.creationFlags | data.creationFlags) >>> 0;
            value.upgradeFlags = orFlags(value.upgradeFlags, data.upgradeFlags);
            value.randomSeed ^= data.randomSeed;
          }
          value.curveBounds = [
            Math.min(value.curveBounds[0], data.curveBounds[0]),
            Math.max(value.curveBounds[1], data.curveBounds[1]),
          ];
        } else if (!value.regenerate || data.onCourse) {
          data.curveBounds = [
            Math.min(value.curveBounds[0], data.curveBounds[0]),
            Math.max(value.curveBounds[1], data.curveBounds[1]),
          ];
          value = data;
        }
        if (index === -1) index = item;
        else result[item] = { ...result[item], valid: false };
      }
      if (index === -1) {
        map.add(key, result.length);
        result.push(value);
      } else result[index] = value;
    }
    return result;
  }
  oldKey(
    prefab: Entity,
    lane: Entity,
    original: Entity,
    owner: Entity,
    outside: boolean,
  ) {
    return JSON.stringify([prefab, lane, original, owner, outside]);
  }
  fillOld() {
    for (const chunk of this.ecs.chunks({
      all: ["Node", "Deleted", "Temp", "PrefabRef"],
    }))
      for (const id of chunk.entities) {
        const owner =
            this.ecs.tryGet<{ owner: Entity }>("Owner", id)?.owner ?? null,
          transform = this.ecs.tryGet<Node>("Transform", owner),
          p = this.get<Node>("Node", id).position;
        this.old.add(
          this.oldKey(
            this.prefab(id),
            this.lane(id),
            this.get<Temp>("Temp", id).original,
            owner,
            chunk.components.has("OutsideConnection"),
          ),
          { entity: id, position: transform ? localPosition(transform, p) : p },
        );
      }
  }
  findPrefab(original: Entity, newPrefab: Entity, newLane: Entity) {
    let prefab: Entity = null,
      lane: Entity = null,
      priority = f(-3.4028235e38),
      native = false;
    const candidate = (asset: Entity, sub: Entity) => {
      const data = this.get<Net>("NetData", asset);
      if (data.nodePriority > priority) {
        prefab = asset;
        lane = sub;
        priority = data.nodePriority;
      }
    };
    if (this.has("Edge", original)) {
      native = this.has("Native", original);
      candidate(this.prefab(original), this.lane(original));
    } else if (this.ecs.hasBuffer("ConnectedEdge", original))
      for (const { edge: id } of this.edges(original)) {
        const edge = this.get<Edge>("Edge", id);
        if (edge.start !== original && edge.end !== original) continue;
        const definition = this.definitions.get(id);
        if (definition) {
          if (definition.flags & 4) continue;
          if (definition.prefab !== null) {
            native ||= this.has("Native", id);
            candidate(definition.prefab, definition.lane);
            continue;
          }
        }
        native ||= this.has("Native", id);
        candidate(this.prefab(id), this.lane(id));
      }
    if (newPrefab !== null) candidate(newPrefab, newLane);
    if (prefab === null && this.has("PrefabRef", original)) {
      prefab = this.prefab(original);
      lane = this.lane(original);
    }
    return { prefab, lane, native };
  }
  orphan(node: Entity) {
    let already = true;
    for (const { edge: id } of this.edges(node)) {
      const e = this.get<Edge>("Edge", id);
      if (e.start === node || e.end === node) {
        already = false;
        if (!((this.definitions.get(id)?.flags ?? 0) & 4))
          return { orphan: false, already };
      }
    }
    return { orphan: true, already };
  }
  canDelete(node: Entity) {
    if (this.tryingToDelete(node)) return true;
    const owner =
      this.ecs.tryGet<{ owner: Entity }>("Owner", node)?.owner ?? null;
    if (owner !== null && !this.editorMode && !this.tryingToDelete(owner)) {
      for (const { edge: id } of this.edges(node))
        if (this.tryingToDelete(id) && this.has("Owner", id)) {
          const e = this.get<Edge>("Edge", id);
          if (
            (e.start === node || e.end === node) &&
            this.get<{ owner: Entity }>("Owner", id).owner === owner
          )
            return true;
        }
      return false;
    }
    return true;
  }
  hasLocalConnections(node: Entity) {
    return (
      this.ecs.hasBuffer("ConnectedEdge", node) &&
      this.edges(node).some(({ edge: id }) => {
        const e = this.get<Edge>("Edge", id);
        return e.start !== node && e.end !== node;
      })
    );
  }
  reuse(node: Node, prefab: Entity, outside: boolean, u: Update): Entity {
    let transform: Node | undefined;
    if (u.ownerData.prefab !== null) {
      const reused = this.input.reusedOwners.find(
        (x) =>
          x.definition.prefab === u.ownerData.prefab &&
          eq(x.definition.position, u.ownerData.position) &&
          eq(x.definition.rotation, u.ownerData.rotation) &&
          x.definition.rotation.w === u.ownerData.rotation.w,
      );
      if (reused) {
        transform = {
          position: u.ownerData.position,
          rotation: u.ownerData.rotation,
        };
        u.owner = reused.entity;
        u.ownerData = emptyOwner();
      }
    }
    if (!transform) transform = this.ecs.tryGet<Node>("Transform", u.owner);
    const rows = this.old.get(
      this.oldKey(prefab, u.lane, u.original, u.owner, outside),
    );
    if (!rows.length) return null;
    const p = transform
      ? localPosition(transform, node.position)
      : node.position;
    let best = f(3.4028235e38),
      index = 0;
    rows.forEach((row, i) => {
      const delta = sub(p, row.position),
        dist = dot(delta, delta);
      if (dist < best) {
        best = dist;
        index = i;
      }
    });
    return rows.splice(index, 1)[0].entity;
  }
  create(u: Update) {
    if (!u.valid) return;
    if (u.updateOnly) {
      this.commands.add(u.original!, "Updated");
      return;
    }
    let node: Node = {
      position: structuredClone(u.position),
      rotation: structuredClone(u.rotation),
    };
    const temp: Temp = {
      original: u.original,
      curvePosition: 0,
      value: 0,
      cost: 0,
      flags: 0,
    };
    let upgrade = structuredClone(u.upgradeFlags),
      orphan = false;
    if (u.creationFlags & 65536 && u.onCourse) temp.flags |= 8;
    if ((u.flags & (2 | 8)) === 2) temp.flags |= 4;
    const wasNode = this.has("Node", u.original),
      wasEdge = !wasNode && this.has("Edge", u.original);
    if (wasNode) {
      if (
        u.onCourse &&
        ((u.owner === null && u.ownerData.prefab === null) ||
          (this.has("Owner", u.original) &&
            !this.tryingToDelete(
              this.get<{ owner: Entity }>("Owner", u.original).owner,
            )))
      )
        node = this.get<Node>("Node", u.original);
      const o = u.addEdge
        ? { orphan: false, already: false }
        : this.orphan(u.original);
      orphan = o.orphan;
      if (
        orphan &&
        this.canDelete(u.original) &&
        (!o.already || !!(u.creationFlags & 4))
      ) {
        orphan = o.already;
        temp.flags |= 2;
      } else if (u.onCourse) {
        temp.flags |=
          u.creationFlags & 16 ? 512 : u.creationFlags & 2 ? 32 : 128;
        if (u.creationFlags & 512) temp.flags |= 2048;
      } else if (u.regenerate) temp.flags |= 128;
      if (!(u.creationFlags & 16))
        upgrade =
          this.ecs.tryGet<{ flags: Flags }>("Upgraded", u.original)?.flags ??
          upgrade;
    } else if (wasEdge) {
      temp.flags |= 256;
      temp.curvePosition = u.curvePosition;
    } else {
      orphan = !u.addEdge;
      temp.flags |= 1;
    }
    if (u.creationFlags & 256 && (!(u.creationFlags & 4) || !!(temp.flags & 2)))
      temp.flags |= 1024;
    let prefab = u.prefab,
      standalone = false,
      native = false;
    if (u.original !== null) {
      this.commands.add(u.original, "Hidden");
      this.commands.add(u.original, "BatchesUpdated");
      if (this.has("Standalone", u.original)) {
        standalone = true;
        const owner = this.ecs.tryGet<{ owner: Entity }>("Owner", u.original);
        if (
          !orphan &&
          !(temp.flags & 2) &&
          owner &&
          (owner.owner === null || this.tryingToDelete(owner.owner))
        )
          standalone = false;
      }
      if (
        !standalone &&
        u.prefab !== null &&
        (u.owner !== null || u.ownerData.prefab !== null) &&
        (u.flags & 3) === 3
      ) {
        standalone = true;
        prefab = u.prefab;
      } else if (standalone) {
        prefab = this.prefab(u.original);
        u.lane = this.lane(u.original);
      } else {
        const found = this.findPrefab(u.original, u.prefab, u.lane);
        prefab = found.prefab;
        u.lane = found.lane;
        native = found.native;
      }
    } else if (orphan) standalone = true;
    const net = this.get<Net>("NetData", prefab),
      geometry = this.ecs.tryGet<Geometry>("NetGeometryData", prefab);
    if (
      (!geometry || !!(geometry.flags & 2)) &&
      u.prefab !== null &&
      u.original !== null &&
      (!standalone || this.has("Standalone", u.original))
    ) {
      if (wasNode) node = this.get<Node>("Node", u.original);
      else if (this.has("Curve", u.original)) {
        const c = this.get<Curve>("Curve", u.original);
        node.position = cs2RoadCurvePosition(c.bezier, u.curvePosition);
        const t = cs2RoadCurveTangent(c.bezier, u.curvePosition),
          square = dotXZ(t, t);
        if (square > f(1.1754944e-38)) {
          const scale = f(1 / f(Math.sqrt(square)));
          node.rotation = cs2LookRotation({
            x: times(t.x, scale),
            y: 0,
            z: times(t.z, scale),
          });
        }
      }
    }
    if (
      this.has("PrefabRef", u.original) &&
      !!(
        (this.get<Net>("NetData", this.prefab(u.original)).requiredLayers ^
          net.requiredLayers) &
        256
      )
    )
      node.position.y = u.position.y;
    let ownerCurve = false;
    if (u.ownerData.prefab !== null) {
      if (!(temp.flags & 2)) {
        const owner =
          this.ecs.tryGet<{ owner: Entity }>("Owner", u.original)?.owner ??
          null;
        if (owner !== null && this.tryingToDelete(owner)) {
          u.ownerData = emptyOwner();
          u.owner = null;
        }
      }
    } else if (u.owner === null) {
      const owner =
        this.ecs.tryGet<{ owner: Entity }>("Owner", u.original)?.owner ?? null;
      if (
        owner !== null &&
        !this.tryingToDelete(owner) &&
        !this.tryingToDelete(u.original)
      ) {
        u.owner = owner;
        const curve = this.ecs.tryGet<Curve>("Curve", owner),
          ref = this.ecs.tryGet<{ prefab: Entity }>("PrefabRef", owner);
        if (curve && ref) {
          ownerCurve = true;
          u.ownerData = {
            prefab: ref.prefab,
            position: curve.bezier[0],
            rotation: { ...curve.bezier[3], w: 0 },
          };
        }
      }
    }
    const terrain = this.input.terrainBounds;
    if (!terrain) throw new Error("Missing source TerrainBounds");
    const outside =
      f(node.position.x) < plus(terrain.min.x, 0.1) ||
      f(node.position.z) < plus(terrain.min.z, 0.1) ||
      f(node.position.x) > minus(terrain.max.x, 0.1) ||
      f(node.position.z) > minus(terrain.max.z, 0.1);
    const old = !(u.creationFlags & 1)
        ? this.reuse(node, prefab, outside, u)
        : null,
      reused = old !== null;
    const entity = old ?? this.commands.create(net.nodeArchetype);
    if (reused) {
      this.commands.remove(entity, "Deleted");
      this.commands.add(entity, "Updated");
      this.commands.buffer(entity, "ConnectedEdge", true);
    } else {
      this.commands.set(entity, "PrefabRef", { prefab });
      if (
        u.original !== null
          ? !this.has("ServiceUpgrade", u.original)
          : this.editorMode || !(u.creationFlags & 65536)
      )
        this.commands.remove(entity, "ServiceUpgrade");
    }
    this.commands.set(entity, "Node", node);
    if (orphan && geometry)
      this.commands.add(entity, "Orphan", { composition: null });
    else if (reused) this.commands.remove(entity, "Orphan");
    if (geometry)
      this.commands.set(
        entity,
        "PseudoRandomSeed",
        this.ecs.tryGet("PseudoRandomSeed", u.original) ?? {
          seed: u.randomSeed & 65535,
        },
      );
    if (standalone) this.commands.add(entity, "Standalone");
    else if (reused && this.has("Standalone", entity))
      this.commands.remove(entity, "Standalone");
    if (u.lane !== null)
      this.commands.set(entity, "EditorContainer", {
        prefab: u.lane,
        scale: zero(),
        intensity: 0,
        groupIndex: 0,
      });
    upgrade = {
      general: (upgrade.general & 0x1c086f1) >>> 0,
      left: upgrade.left & 12,
      right: upgrade.right & 12,
    };
    if (upgrade.general || upgrade.left || upgrade.right)
      this.commands.add(entity, "Upgraded", { flags: upgrade });
    else if (reused && this.has("Upgraded", entity))
      this.commands.remove(entity, "Upgraded");
    let removeElevation = true,
      removeFixed = true,
      removeLocal = true;
    if (wasNode || wasEdge) {
      const elevation = this.ecs.tryGet<{ elevation: [number, number] }>(
        "Elevation",
        u.original,
      );
      if (elevation) {
        if (
          elevation.elevation.some((v) => v !== 0) ||
          u.parentMesh >= 0 ||
          this.has("Owner", u.original)
        ) {
          this.commands.add(entity, "Elevation", elevation);
          removeElevation = false;
        }
      } else if (u.parentMesh >= 0) {
        this.commands.add(entity, "Elevation", { elevation: [0, 0] });
        removeElevation = false;
      }
    } else if (u.elevation.some((v) => v !== 0) || u.parentMesh >= 0) {
      this.commands.add(entity, "Elevation", { elevation: u.elevation });
      removeElevation = false;
    }
    if (wasNode) {
      if (this.has("Native", u.original) && (standalone || native))
        this.commands.add(entity, "Native");
      else if (reused && this.has("Native", entity))
        this.commands.remove(entity, "Native");
      if (this.has("Fixed", u.original)) {
        this.commands.add(entity, "Fixed", this.get("Fixed", u.original));
        removeFixed = false;
      }
      if (
        this.has("RoadData", prefab) &&
        this.ecs.isEnabled("PrefabData", prefab)
      ) {
        for (const type of ["NetCondition", "Road"]) {
          const v = this.ecs.tryGet(type, u.original);
          if (v) this.commands.set(entity, type, v);
        }
      }
      const l = this.ecs.tryGet<Local>("LocalConnectData", prefab);
      if (
        l &&
        (!(l.flags & 1) ||
          orphan ||
          (this.has("LocalConnect", u.original) &&
            (!!(l.flags & 2) || this.hasLocalConnections(u.original))))
      ) {
        this.commands.add(entity, "LocalConnect");
        removeLocal = false;
      }
    } else {
      if (u.flags & 64) {
        this.commands.add(entity, "Fixed", { index: u.fixedIndex });
        removeFixed = false;
      }
      if (
        this.has("RoadData", prefab) &&
        this.ecs.isEnabled("PrefabData", prefab)
      ) {
        const condition = this.ecs.tryGet("NetCondition", u.original);
        if (condition) {
          const wear = plus(
            condition.wear[0],
            times(minus(condition.wear[1], condition.wear[0]), u.curvePosition),
          );
          condition.wear = [wear, wear];
          this.commands.set(entity, "NetCondition", condition);
        }
        const road = this.ecs.tryGet("Road", u.original);
        if (road) {
          for (const field of ["trafficFlowDistance", "trafficFlowDuration"]) {
            const a = road[field + "0"],
              b = road[field + "1"];
            road[field + "0"] = Object.fromEntries(
              ["x", "y", "z", "w"].map((axis) => [
                axis,
                times(plus(a[axis], b[axis]), 0.5),
              ]),
            );
            road[field + "1"] = structuredClone(road[field + "0"]);
          }
          this.commands.set(entity, "Road", road);
        }
      }
      const l = this.ecs.tryGet<Local>("LocalConnectData", prefab);
      if (l && (!(l.flags & 1) || !!(u.flags & 3))) {
        this.commands.add(entity, "LocalConnect");
        removeLocal = false;
      }
    }
    if (reused) {
      if (removeElevation && this.has("Elevation", entity))
        this.commands.remove(entity, "Elevation");
      if (removeFixed && this.has("Fixed", entity))
        this.commands.remove(entity, "Fixed");
      if (removeLocal && this.has("LocalConnect", entity))
        this.commands.remove(entity, "LocalConnect");
    }
    if (u.ownerData.prefab !== null) {
      this.commands.add(entity, "Owner", {
        owner: ownerCurve ? u.owner : null,
      });
      this.commands.add(entity, "OwnerDefinition", u.ownerData);
    } else if (u.owner !== null)
      this.commands.add(entity, "Owner", { owner: u.owner });
    if (outside) this.commands.add(entity, "OutsideConnection", { delay: 0 });
    if (!(u.creationFlags & 1)) this.commands.add(entity, "Temp", temp);
    if (u.hasCachedPosition)
      this.commands.add(entity, "LocalTransformCache", {
        position: u.cachedPosition,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        parentMesh: u.parentMesh,
        groupIndex: 0,
        probability: 100,
        prefabSubIndex: -1,
      });
  }
  run() {
    this.fill();
    this.fillOld();
    const updates = this.collect();
    for (const update of updates) this.create(update);
    this.ecs.publish(this.commands.commands);
    return {
      status: "complete" as const,
      world: this.ecs.snapshot(),
      commands: this.commands.commands,
      barrier: "ModificationBarrier1" as const,
    };
  }
}
/** Complete GenerateNodes chain. Inputs are actual ECS component names (NetCourse.startPosition/endPosition). */
export function cs2GenerateRoadNodes(
  world: CS2RoadApplyWorld,
  options: { editorMode?: boolean } = {},
) {
  return new NodeGeneration(world, options.editorMode ?? false).run();
}
