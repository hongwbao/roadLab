/** Recovered GenerateEdgesSystem jobs. Structural publication is ModificationBarrier2. */
import type { V } from "./types";
import {
  cs2RoadCurvePosition,
  cs2RoadCurveLength,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
import {
  cs2CutRoadCourseCurve,
  cs2DivideRoadCourseCurve,
  type CS2RoadCourse,
  type CS2RoadCoursePos,
  type CS2RoadCourseOwner,
  type CS2RoadCreationDefinition,
} from "./cs2-road-courses";
import {
  cs2RoadXZDistance,
  cs2StraightHangingRoadCurve,
  type CS2RoadBounds,
} from "./cs2-road-intersections";
import { SourceRandom32 } from "../simulation/cs2-path-search";
import {
  CS2RoadApplyECS,
  CS2RoadApplyCommandWriter,
  type CS2RoadApplyWorld,
  type CS2RoadApplyChunk,
  type CS2RoadApplyRecord as Record,
  type CS2RoadApplyTemp as Temp,
  type CS2RoadApplyEdge as Edge,
  type CS2RoadApplyCurve as Curve,
  type CS2RoadApplyNode as Node,
} from "./cs2-road-ecs";
type Entity = string | null;
type Owner = CS2RoadCourseOwner;
type Definition = CS2RoadCreationDefinition;
type Flags = { general: number; left: number; right: number };
type Course = Omit<CS2RoadCourse, "start" | "end"> & {
  startPosition: CS2RoadCoursePos;
  endPosition: CS2RoadCoursePos;
};
type Net = {
  edgeArchetype: string;
  connectLayers: number;
  localConnectLayers: number;
  requiredLayers: number;
};
type Geometry = {
  flags: number;
  defaultWidth: number;
  hanging: number;
  aggregateType: Entity;
};
type Local = {
  flags: number;
  layers: number;
  searchDistance: number;
  heightRange: [number, number];
};
type LocalItem = {
  connectLayers: number;
  localConnectLayers: number;
  position: V;
  radius: number;
  heightRange: [number, number];
  node: string;
  tempFlags: number;
  permanent: boolean;
  standalone: boolean;
};
type Editor = {
  prefab: Entity;
  scale: V;
  intensity: number;
  groupIndex: number;
};
const f = Math.fround,
  add = (a: number, b: number) => f(f(a) + f(b)),
  sub = (a: number, b: number) => f(f(a) - f(b)),
  mul = (a: number, b: number) => f(f(a) * f(b)),
  div = (a: number, b: number) => f(f(a) / f(b)),
  lerp = (a: number, b: number, t: number) => add(a, mul(t, sub(b, a)));
const zero = (): V => ({ x: 0, y: 0, z: 0 }),
  emptyOwner = (): Owner => ({
    prefab: null,
    position: zero(),
    rotation: { x: 0, y: 0, z: 0, w: 0 },
  }),
  emptyFlags = (): Flags => ({ general: 0, left: 0, right: 0 }),
  emptyEditor = (): Editor => ({
    prefab: null,
    scale: zero(),
    intensity: 0,
    groupIndex: 0,
  }),
  emptyTemp = (): Temp => ({
    original: null,
    curvePosition: 0,
    value: 0,
    cost: 0,
    flags: 0,
  });
const emptyGeometry = (): Geometry => ({
  flags: 0,
  defaultWidth: 0,
  hanging: 0,
  aggregateType: null,
});
const v4zero = () => ({ x: 0, y: 0, z: 0, w: 0 });
const emptyRoad = (): Record => ({
  trafficFlowDuration0: v4zero(),
  trafficFlowDuration1: v4zero(),
  trafficFlowDistance0: v4zero(),
  trafficFlowDistance1: v4zero(),
  flags: 0,
});
const vecLerp = (a: Record, b: Record, t: number) =>
  Object.fromEntries(
    ["x", "y", "z", "w"].map((axis) => [axis, lerp(a[axis], b[axis], t)]),
  );
const equal = (a: V, b: V) =>
  f(a.x) === f(b.x) && f(a.y) === f(b.y) && f(a.z) === f(b.z);
const ownerEqual = (a: Owner, b: Owner) =>
  a.prefab === b.prefab &&
  equal(a.position, b.position) &&
  equal(a.rotation, b.rotation) &&
  f(a.rotation.w) === f(b.rotation.w);
const flagsAny = (a: Flags) => !!(a.general | a.left | a.right);
const round = (x: number) => {
  const floor = Math.floor(x),
    part = x - floor;
  return part < 0.5
    ? floor
    : part > 0.5
      ? floor + 1
      : floor % 2 === 0
        ? floor
        : floor + 1;
};
const distance = (a: V, b: V) => {
  const x = sub(a.x, b.x),
    z = sub(a.z, b.z);
  return f(Math.sqrt(add(mul(x, x), mul(z, z))));
};
const overlap = (a: CS2RoadBounds, b: CS2RoadBounds) =>
  ["x", "y", "z"].every(
    (axis) =>
      a.min[axis as keyof V] <= b.max[axis as keyof V] &&
      b.min[axis as keyof V] <= a.max[axis as keyof V],
  );
const curveBounds = (curve: CS2RoadCurve, expand: number): CS2RoadBounds => ({
  min: {
    x: sub(Math.min(...curve.map((v) => v.x)), expand),
    y: sub(Math.min(...curve.map((v) => v.y)), expand),
    z: sub(Math.min(...curve.map((v) => v.z)), expand),
  },
  max: {
    x: add(Math.max(...curve.map((v) => v.x)), expand),
    y: add(Math.max(...curve.map((v) => v.y)), expand),
    z: add(Math.max(...curve.map((v) => v.z)), expand),
  },
});
class EdgeGeneration {
  readonly ecs: CS2RoadApplyECS;
  readonly commands: CS2RoadApplyCommandWriter;
  readonly nodeMap = new Map<string, Entity[]>();
  readonly old = new Map<string, string>();
  readonly local: LocalItem[] = [];
  constructor(
    readonly input: CS2RoadApplyWorld,
    readonly editorMode: boolean,
    readonly buildOrder: number,
  ) {
    this.ecs = new CS2RoadApplyECS(input);
    this.commands = new CS2RoadApplyCommandWriter(
      "ModificationBarrier2",
      this.ecs,
    );
  }
  get<T = Record>(type: string, id: Entity): T {
    return this.ecs.get<T>(type, id);
  }
  has(type: string, id: Entity) {
    return this.ecs.has(type, id);
  }
  prefab(id: Entity) {
    return this.get<{ prefab: Entity }>("PrefabRef", id).prefab;
  }
  geometry(prefab: Entity) {
    return (
      this.ecs.tryGet<Geometry>("NetGeometryData", prefab) ?? emptyGeometry()
    );
  }
  editor(id: Entity) {
    return this.ecs.tryGet<Editor>("EditorContainer", id) ?? emptyEditor();
  }
  key(original: Entity, p: V = zero(), permanent = false, editor = false) {
    return original !== null
      ? JSON.stringify([original])
      : JSON.stringify([f(p.x), f(p.y), f(p.z), permanent, editor]);
  }
  addNode(key: string, entity: Entity) {
    const rows = this.nodeMap.get(key) ?? [];
    rows.unshift(entity);
    this.nodeMap.set(key, rows);
  }
  nodes(original: Entity, p: V = zero(), permanent = false, editor = false) {
    return this.nodeMap.get(this.key(original, p, permanent, editor)) ?? [];
  }
  oldKey(
    e: Edge,
    prefab: Entity,
    lane: Entity,
    original: Entity,
    owner: Entity,
  ) {
    return JSON.stringify([prefab, lane, original, owner, e.start, e.end]);
  }
  reuse(
    e: Edge,
    prefab: Entity,
    lane: Entity,
    original: Entity,
    owner: Entity,
    definition: Owner,
  ) {
    if (definition.prefab !== null) {
      const row = this.input.reusedOwners.find((r) =>
        ownerEqual(r.definition, definition),
      );
      if (row) {
        owner = row.entity;
        definition = emptyOwner();
      }
    }
    return {
      entity:
        this.old.get(this.oldKey(e, prefab, lane, original, owner)) ?? null,
      owner,
      definition,
    };
  }
  checkNodes(chunk: CS2RoadApplyChunk) {
    const editor = chunk.components.has("EditorContainer"),
      standalone = !chunk.components.has("Owner");
    if (chunk.components.has("Node"))
      for (const id of chunk.entities) {
        const node = this.get<Node>("Node", id),
          temp = this.ecs.tryGet<Temp>("Temp", id);
        this.get("PrefabRef", id);
        this.addNode(
          this.key(temp?.original ?? null, node.position, !temp, editor),
          id,
        );
      }
    if (!chunk.components.has("LocalConnect")) return;
    for (const id of chunk.entities) {
      const node = this.get<Node>("Node", id),
        asset = this.prefab(id),
        l = this.get<Local>("LocalConnectData", asset),
        g = this.get<Geometry>("NetGeometryData", asset),
        net = this.get<Net>("NetData", asset),
        temp = this.ecs.tryGet<Temp>("Temp", id);
      this.local.push({
        connectLayers: l.layers,
        localConnectLayers: net.connectLayers,
        position: node.position,
        radius: Math.max(0, add(mul(g.defaultWidth, 0.5), l.searchDistance)),
        heightRange: l.heightRange,
        node: id,
        tempFlags: temp?.flags ?? 0,
        permanent: !temp,
        standalone:
          standalone || l.searchDistance === 0 || !!(g.flags & 0x1000000),
      });
    }
  }
  fillOld() {
    for (const chunk of this.ecs.chunks({
      all: ["Edge", "Deleted", "Temp", "PrefabRef"],
    }))
      for (const id of chunk.entities) {
        const e = this.get<Edge>("Edge", id),
          owner =
            this.ecs.tryGet<{ owner: Entity }>("Owner", id)?.owner ?? null,
          key = this.oldKey(
            e,
            this.prefab(id),
            this.editor(id).prefab,
            this.get<Temp>("Temp", id).original,
            owner,
          );
        if (!this.old.has(key)) this.old.set(key, id);
      }
  }
  tryNode(pos: CS2RoadCoursePos, permanent: boolean, editor: boolean): Entity {
    if (permanent && this.has("Node", pos.entity)) return pos.entity;
    let node: Entity = null,
      best = f(3.4028235e38);
    for (const item of this.nodes(
      pos.entity,
      pos.position,
      permanent,
      editor,
    )) {
      const temp = this.ecs.tryGet<Temp>("Temp", item);
      if (temp) {
        const difference = Math.abs(sub(temp.curvePosition, pos.splitPosition));
        if (difference < best) {
          best = difference;
          node = item;
        }
      } else if (item !== null) return item;
    }
    return node;
  }
  findConnections(
    nodes: Record[],
    edge: Edge,
    curve: Curve,
    temp: Temp,
    net: Net,
    g: Geometry,
    permanent: boolean,
    standalone: boolean,
    zoneable: boolean,
  ) {
    const half = mul(g.defaultWidth, 0.5),
      search = curveBounds(
        curve.bezier,
        add(half, standalone && zoneable ? 8 : 0),
      );
    const circles = [edge.start, edge.end].map((id) => {
      const circle = this.ecs.tryGet<{ radius: number }>("Roundabout", id),
        p = circle ? this.get<Node>("Node", id).position : zero(),
        radius = circle?.radius ?? 0;
      if (circle)
        for (const axis of ["x", "y", "z"] as const) {
          search.min[axis] = Math.min(search.min[axis], sub(p[axis], radius));
          search.max[axis] = Math.max(search.max[axis], add(p[axis], radius));
        }
      return { p, radius };
    });
    for (const item of this.local) {
      const p = item.position,
        r = item.radius;
      if (
        !(item.connectLayers & net.connectLayers) ||
        !(item.localConnectLayers & net.localConnectLayers) ||
        item.node === edge.start ||
        item.node === edge.end ||
        !!((temp.flags ^ item.tempFlags) & 2) ||
        item.permanent !== permanent ||
        !overlap(search, {
          min: {
            x: sub(p.x, r),
            y: add(p.y, item.heightRange[0]),
            z: sub(p.z, r),
          },
          max: {
            x: add(p.x, r),
            y: add(p.y, item.heightRange[1]),
            z: add(p.z, r),
          },
        })
      )
        continue;
      let t = 0,
        dist = 0;
      if (g.flags & 64) {
        const a = distance(curve.bezier[0], p),
          b = distance(curve.bezier[3], p);
        dist = b < a ? b : a;
        t = b < a ? 1 : 0;
      } else {
        const value = cs2RoadXZDistance(curve.bezier, p);
        t = value.t;
        dist = value.distance;
      }
      dist = sub(dist, half);
      circles.forEach((c, i) => {
        if (c.radius !== 0) {
          const candidate = sub(distance(c.p, p), c.radius);
          if (candidate < dist) {
            dist = candidate;
            t = i;
          }
        }
      });
      if (!item.standalone && standalone && zoneable) dist = sub(dist, 8);
      if (dist <= r) {
        const y = sub(cs2RoadCurvePosition(curve.bezier, t).y, p.y);
        if (item.heightRange[0] <= y && y <= item.heightRange[1])
          nodes.push({ node: item.node, curvePosition: t });
      }
    }
  }
  connectionExists(a: Entity, b: Entity) {
    if (!this.ecs.hasBuffer("ConnectedEdge", a)) return false;
    return this.ecs.buffer("ConnectedEdge", a).some(({ edge: id }) => {
      if (this.has("Deleted", id)) return false;
      const edge = this.get<Edge>("Edge", id);
      return (
        (edge.start === b && edge.end === a) ||
        (edge.end === b && edge.start === a)
      );
    });
  }
  adjustPosition(
    curve: Curve,
    fixedStart: boolean,
    linear: boolean,
    fixedEnd: boolean,
    water: boolean,
  ): Curve {
    const terrain = this.input.terrain;
    if (!terrain) throw new Error("Missing source terrain/water reader");
    const result = structuredClone(curve),
      c = result.bezier;
    const sample = (p: V) => {
      if (water) {
        const s = terrain.sampleHeight(p);
        return s.waterDepth >= f(0.2) ? f(s.waterHeight) : p.y;
      }
      return f(terrain.terrainHeight(p));
    };
    if (!fixedStart) c[0].y = sample(curve.bezier[0]);
    if (!fixedEnd) c[3].y = sample(curve.bezier[3]);
    if (linear) {
      c[1].y = lerp(c[0].y, c[3].y, f(1 / 3));
      c[2].y = lerp(c[0].y, c[3].y, f(2 / 3));
    } else {
      c[1].y = sample(curve.bezier[1]);
      c[2].y = sample(curve.bezier[2]);
      const a = sub(c[1].y, cs2RoadCurvePosition(c, f(1 / 3)).y),
        b = sub(c[2].y, cs2RoadCurvePosition(c, f(2 / 3)).y);
      c[1].y = add(c[1].y, sub(mul(a, 3), mul(b, 1.5)));
      c[2].y = add(c[2].y, sub(mul(b, 3), mul(a, 1.5)));
    }
    return result;
  }
  generated(
    job: number,
    index: number,
    d: Definition,
    owner: Owner,
    course: Course,
    upgrade: Flags,
    cache: { curve: CS2RoadCurve } | undefined,
    replacements: Record[] | undefined,
  ) {
    const permanent = !!(d.flags & 1),
      editor = d.subPrefab !== null;
    if ((course.startPosition.flags | course.endPosition.flags) & 0x4000)
      return;
    const start = this.tryNode(course.startPosition, permanent, editor),
      end = this.tryNode(course.endPosition, permanent, editor);
    if (start === null || end === null || start === end) return;
    const edge: Edge = { start, end };
    if (d.original !== null && this.nodes(d.original).some((n) => n !== null))
      d.original = null;
    if (
      course.startPosition.entity !== null &&
      course.endPosition.entity !== null &&
      d.original === null &&
      this.connectionExists(
        course.startPosition.entity,
        course.endPosition.entity,
      )
    )
      return;
    const oldPrefab = d.original !== null ? this.prefab(d.original) : null,
      prefab = d.prefab === null ? oldPrefab : d.prefab;
    if (prefab === null) return;
    const enabled = this.ecs.isEnabled("PrefabData", prefab),
      net = this.get<Net>("NetData", prefab),
      hasGeometry = this.has("NetGeometryData", prefab),
      g = this.geometry(prefab);
    let a: V, b: V;
    if (g.flags & 2 || !hasGeometry) {
      a = this.get<Node>("Node", start).position;
      b = this.get<Node>("Node", end).position;
    } else {
      a = cs2RoadCurvePosition(course.curve, course.startPosition.courseDelta);
      b = cs2RoadCurvePosition(course.curve, course.endPosition.courseDelta);
      if (
        !(
          (net.requiredLayers ^
            this.get<Net>("NetData", this.prefab(start)).requiredLayers) &
          256
        )
      )
        a.y = this.get<Node>("Node", start).position.y;
      if (
        !(
          (net.requiredLayers ^
            this.get<Net>("NetData", this.prefab(end)).requiredLayers) &
          256
        )
      )
        b.y = this.get<Node>("Node", end).position.y;
    }
    let bezier = structuredClone(
      g.flags & 1 && course.fixedIndex < 0
        ? cs2StraightHangingRoadCurve(a, b, g.hanging)
        : cs2CutRoadCourseCurve(course.curve, [
            course.startPosition.courseDelta,
            course.endPosition.courseDelta,
          ]),
    );
    if (!(g.flags & 1 && course.fixedIndex < 0)) {
      bezier = [a, bezier[1], bezier[2], b];
    }
    let curve: Curve = { bezier, length: cs2RoadCurveLength(bezier) },
      temp = emptyTemp(),
      invertReplacements = false;
    if (d.original !== null) {
      temp.original = d.original;
      temp.flags |=
        d.flags & 4
          ? 2
          : d.flags & 2
            ? 32
            : d.flags & 16
              ? 512
              : prefab !== oldPrefab || !!(d.flags & 64)
                ? 64
                : 0;
      if (d.flags & 512) temp.flags |= 2048;
      if (!(d.flags & 16)) {
        const oldUpgrade = this.ecs.tryGet<{ flags: Flags }>(
          "Upgraded",
          d.original,
        );
        if (oldUpgrade) {
          upgrade = oldUpgrade.flags;
          if (d.flags & 64)
            upgrade = {
              general: upgrade.general,
              left: upgrade.right,
              right: upgrade.left,
            };
        }
        if (this.ecs.hasBuffer("SubReplacement", d.original)) {
          replacements = this.ecs.buffer("SubReplacement", d.original);
          invertReplacements = !!(d.flags & 64);
        }
      }
    } else temp.flags |= 1;
    if (d.flags & 256) temp.flags |= 1024;
    if (d.original !== null) {
      course.elevation = this.ecs.tryGet<{ elevation: [number, number] }>(
        "Elevation",
        d.original,
      )?.elevation ?? [0, 0];
      course.fixedIndex =
        this.ecs.tryGet<{ index: number }>("Fixed", d.original)?.index ?? -1;
      if (d.flags & 64)
        course.elevation = [course.elevation[1], course.elevation[0]];
    }
    let addElevation =
      course.elevation.some((x) => x !== 0) ||
      (course.startPosition.parentMesh >= 0 &&
        course.endPosition.parentMesh >= 0);
    if (
      !addElevation &&
      (!(g.flags & 0x20000) ||
        owner.prefab !== null ||
        (d.owner !== null && (!this.editorMode || !permanent)))
    ) {
      const fixedA = this.has("Elevation", start),
        fixedB = this.has("Elevation", end),
        adjusted = this.adjustPosition(
          curve,
          fixedA,
          fixedA || fixedB,
          fixedB,
          !!(g.flags & 0x2000000),
        );
      if (
        curve.bezier.some(
          (p, i) => Math.abs(sub(adjusted.bezier[i].y, p.y)) >= f(0.01),
        )
      )
        curve = adjusted;
    }
    const reuse = permanent
      ? { entity: null, owner: d.owner, definition: owner }
      : this.reuse(edge, prefab, d.subPrefab, d.original, d.owner, owner);
    d.owner = reuse.owner;
    owner = reuse.definition;
    const reused = reuse.entity !== null,
      entity = reuse.entity ?? this.commands.create(net.edgeArchetype, job);
    if (reused) {
      this.commands.remove(entity, "Deleted", job);
      this.commands.add(entity, "Updated", {}, job);
    } else {
      this.commands.set(entity, "PrefabRef", { prefab }, job);
      this.commands.set(entity, "Edge", edge, job);
      if (
        d.original !== null
          ? !this.has("ServiceUpgrade", d.original)
          : this.editorMode || !(d.flags & 65536)
      )
        this.commands.remove(entity, "ServiceUpgrade", job);
    }
    this.commands.set(entity, "Curve", curve, job);
    if (hasGeometry) {
      this.commands.set(
        entity,
        "Composition",
        { edge: prefab, startNode: prefab, endNode: prefab },
        job,
      );
      this.commands.set(
        entity,
        "PseudoRandomSeed",
        this.ecs.tryGet("PseudoRandomSeed", d.original) ?? {
          seed: d.randomSeed & 65535,
        },
        job,
      );
    }
    if (addElevation)
      this.commands.add(
        entity,
        "Elevation",
        { elevation: course.elevation },
        job,
      );
    else if (reused && this.has("Elevation", entity))
      this.commands.remove(entity, "Elevation", job);
    if (flagsAny(upgrade)) {
      this.commands.add(entity, "Upgraded", { flags: upgrade }, job);
      if ((upgrade.left | upgrade.right) & 0x40000000)
        this.commands.add(entity, "ZoneGridHighlighted", {}, job);
    } else if (reused && this.has("Upgraded", entity))
      this.commands.remove(entity, "Upgraded", job);
    if (replacements?.length) {
      const target = this.commands.buffer(entity, "SubReplacement", false, job);
      for (const replacement of replacements) {
        const value = structuredClone(replacement);
        if (invertReplacements) value.side = -value.side;
        target.push(value);
      }
    } else if (reused && this.ecs.hasBuffer("SubReplacement", entity))
      this.commands.remove(entity, "SubReplacement", job);
    if (this.has("RoadData", prefab)) {
      if ((upgrade.left | upgrade.right) & 16)
        this.commands.add(entity, "TramTrack", {}, job);
      else if (reused && this.has("TramTrack", entity))
        this.commands.remove(entity, "TramTrack", job);
    }
    if (this.has("Native", d.original) && !(temp.flags & (64 | 512)))
      this.commands.add(entity, "Native", {}, job);
    else if (reused && this.has("Native", entity))
      this.commands.remove(entity, "Native", job);
    let standalone = true;
    if (owner.prefab !== null) {
      this.commands.add(entity, "Owner", { owner: null }, job);
      this.commands.add(entity, "OwnerDefinition", owner, job);
      standalone = false;
    } else if (d.owner !== null) {
      this.commands.add(entity, "Owner", { owner: d.owner }, job);
      standalone = false;
    }
    standalone ||= !!(g.flags & 0x1000000);
    if (d.flags & (65536 | 0x80000)) temp.flags |= 8;
    if (course.fixedIndex >= 0)
      this.commands.add(entity, "Fixed", { index: course.fixedIndex }, job);
    else if (reused && this.has("Fixed", entity))
      this.commands.remove(entity, "Fixed", job);
    if (d.original !== null) {
      this.commands.add(d.original, "Hidden", {}, job);
      this.commands.add(d.original, "BatchesUpdated", {}, job);
      if (hasGeometry)
        this.commands.set(
          entity,
          "BuildOrder",
          this.get("BuildOrder", d.original),
          job,
        );
    } else if (hasGeometry) {
      const order = (this.buildOrder + index * 16) >>> 0;
      this.commands.set(
        entity,
        "BuildOrder",
        { start: order, end: (order + 15) >>> 0 },
        job,
      );
    }
    const zoneable = this.zoneable(prefab);
    if (this.has("RoadData", prefab) && enabled) {
      let road = this.ecs.tryGet("Road", d.original) ?? emptyRoad();
      if (this.has("Road", d.original))
        this.roadAlignment(d, prefab, oldPrefab, g, road);
      if (course.startPosition.flags & 4) road.flags ^= 1;
      if (course.endPosition.flags & 4) road.flags ^= 2;
      this.commands.set(entity, "Road", road, job);
    }
    this.findConnections(
      this.commands.buffer(entity, "ConnectedNode", true, job),
      edge,
      curve,
      temp,
      net,
      g,
      false,
      standalone,
      zoneable,
    );
    const electricity = this.ecs.tryGet("ElectricityConnectionData", prefab);
    if (electricity) {
      const axes = ["general", "left", "right"] as const,
        all = electricity.compositionAll as Flags,
        any = electricity.compositionAny as Flags,
        none = electricity.compositionNone as Flags,
        hit =
          axes.every(
            (axis) =>
              ((all[axis] | none[axis]) & upgrade[axis]) >>> 0 ===
              all[axis] >>> 0,
          ) &&
          (!flagsAny(any) ||
            axes.some((axis) => !!(any[axis] & upgrade[axis])));
      if (hit)
        this.commands.add(
          entity,
          "ElectricityConnection",
          this.electricityDefault(),
          job,
        );
      else if (reused && this.has("ElectricityConnection", entity))
        this.commands.remove(entity, "ElectricityConnection", job);
      if (
        d.original !== null &&
        hit !== this.has("ElectricityConnection", d.original)
      ) {
        temp.flags &= ~512;
        temp.flags |= 256;
      }
    }
    if (
      d.original !== null &&
      oldPrefab !== prefab &&
      zoneable !== this.zoneable(oldPrefab)
    ) {
      temp.flags &= ~64;
      temp.flags |= 256;
    }
    if (g.aggregateType !== null && this.has("Aggregated", d.original))
      this.commands.set(
        entity,
        "Aggregated",
        this.get("Aggregated", d.original),
        job,
      );
    if (enabled && this.has("NetCondition", d.original))
      this.commands.set(
        entity,
        "NetCondition",
        this.get("NetCondition", d.original),
        job,
      );
    if (cache) this.commands.add(entity, "LocalCurveCache", cache, job);
    if (d.subPrefab !== null) {
      this.commands.set(
        entity,
        "EditorContainer",
        { ...emptyEditor(), prefab: d.subPrefab },
        job,
      );
      if (!hasGeometry)
        this.commands.set(
          entity,
          "PseudoRandomSeed",
          this.ecs.tryGet("PseudoRandomSeed", d.original) ?? {
            seed: d.randomSeed & 65535,
          },
          job,
        );
    }
    if (!permanent) this.commands.add(entity, "Temp", temp, job);
  }
  zoneable(prefab: Entity) {
    return !!(
      this.ecs.tryGet<{ flags: number }>("RoadData", prefab)?.flags! & 1
    );
  }
  roadAlignment(
    d: Definition,
    prefab: Entity,
    original: Entity,
    g: Geometry,
    road: Record,
  ) {
    let a = !!(road.flags & 1),
      b = !!(road.flags & 2);
    road.flags &= ~3;
    if (d.flags & 128) {
      if (d.flags & 64) [a, b] = [b, a];
      if (prefab !== original) {
        const old = this.get<Geometry>("NetGeometryData", original),
          width = (n: number) => Math.ceil(sub(div(n, 8), 0.01));
        if ((width(g.defaultWidth) ^ width(old.defaultWidth)) & 1) {
          a = !a;
          b = !b;
        }
      }
      if (a) road.flags |= 1;
      if (b) road.flags |= 2;
    }
  }
  electricityDefault(): Record {
    return {};
  }
  updateConnections(id: string, edge: Edge, job: number) {
    const old = this.ecs.buffer("ConnectedNode", id),
      nodes = this.commands.buffer(id, "ConnectedNode", true, job),
      curve = this.get<Curve>("Curve", id),
      asset = this.prefab(id),
      net = this.get<Net>("NetData", asset),
      g = this.geometry(asset);
    this.findConnections(
      nodes,
      edge,
      curve,
      emptyTemp(),
      net,
      g,
      true,
      !this.has("Owner", id),
      this.zoneable(asset),
    );
    for (const row of old) {
      const p = this.get<Node>("Node", row.node).position;
      if (
        !this.nodeMap.has(
          this.key(null, p, true, this.has("EditorContainer", row.node)),
        )
      )
        nodes.push(structuredClone(row));
    }
  }
  shouldDuplicate(id: string, from: Entity, flags: number) {
    if (this.has("Deleted", id) || this.nodeMap.has(this.key(id))) return false;
    const edge = this.get<Edge>("Edge", id);
    if (edge.start !== from) return false;
    const ends = this.nodes(edge.end);
    if (!ends.length) return false;
    if (flags & (32 | 64 | 128 | 512)) return true;
    if (
      (this.ecs.tryGet<Temp>("Temp", ends[0])?.flags ?? 0) &
      (32 | 64 | 128 | 512)
    )
      return true;
    return this.ecs.buffer("ConnectedNode", id).some((row) => {
      const nodes = this.nodes(row.node);
      return (
        nodes.length &&
        !!(
          (this.ecs.tryGet<Temp>("Temp", nodes[0])?.flags ?? 0) &
          (32 | 64 | 128 | 512)
        )
      );
    });
  }
  duplicate(id: string, job: number) {
    const edge = this.get<Edge>("Edge", id),
      curve = this.get<Curve>("Curve", id),
      starts = this.nodes(edge.start),
      ends = this.nodes(edge.end);
    if (!starts.length || !ends.length || starts[0] === ends[0]) return;
    edge.start = starts[0];
    edge.end = ends[0];
    const prefab = this.prefab(id),
      g = this.geometry(prefab),
      hasGeometry = this.has("NetGeometryData", prefab),
      enabled = this.ecs.isEnabled("PrefabData", prefab),
      temp = emptyTemp();
    temp.original = id;
    for (const node of [edge.start, edge.end]) {
      const t = this.ecs.tryGet<Temp>("Temp", node);
      if (t && ((t.flags & (512 | 2048)) === (512 | 2048) || !!(t.flags & 32)))
        temp.flags |= 65536;
    }
    const net = this.get<Net>("NetData", prefab),
      editor = this.editor(id),
      oldOwner = this.ecs.tryGet<{ owner: Entity }>("Owner", id)?.owner ?? null,
      reuse = this.reuse(
        edge,
        prefab,
        editor.prefab,
        id,
        oldOwner,
        emptyOwner(),
      ),
      owner = reuse.owner,
      reused = reuse.entity !== null,
      entity = reuse.entity ?? this.commands.create(net.edgeArchetype, job);
    if (reused) {
      this.commands.remove(entity, "Deleted", job);
      this.commands.add(entity, "Updated", {}, job);
    } else {
      this.commands.set(entity, "PrefabRef", { prefab }, job);
      this.commands.set(entity, "Edge", edge, job);
      if (!this.has("ServiceUpgrade", id))
        this.commands.remove(entity, "ServiceUpgrade", job);
    }
    this.commands.set(entity, "Curve", curve, job);
    if (hasGeometry) {
      this.commands.set(
        entity,
        "Composition",
        { edge: prefab, startNode: prefab, endNode: prefab },
        job,
      );
      this.commands.set(entity, "BuildOrder", this.get("BuildOrder", id), job);
      this.commands.set(
        entity,
        "PseudoRandomSeed",
        this.get("PseudoRandomSeed", id),
        job,
      );
    }
    if (this.has("Elevation", id))
      this.commands.add(entity, "Elevation", this.get("Elevation", id), job);
    if (this.has("Upgraded", id))
      this.commands.add(entity, "Upgraded", this.get("Upgraded", id), job);
    else if (reused && this.has("Upgraded", entity)) {
      const old = this.get<{ flags: Flags }>("Upgraded", entity);
      if ((old.flags.left | old.flags.right) & 0x40000000)
        this.commands.add(entity, "ZoneGridHighlighted", {}, job);
      this.commands.remove(entity, "Upgraded", job);
    }
    if (this.ecs.hasBuffer("SubReplacement", id))
      this.commands
        .buffer(entity, "SubReplacement", false, job)
        .push(...structuredClone(this.ecs.buffer("SubReplacement", id)));
    else if (reused && this.ecs.hasBuffer("SubReplacement", entity))
      this.commands.remove(entity, "SubReplacement", job);
    if (owner !== null) {
      this.commands.add(entity, "Owner", { owner }, job);
      const c = this.ecs.tryGet<Curve>("Curve", owner),
        ref = this.ecs.tryGet<{ prefab: Entity }>("PrefabRef", owner);
      if (c && ref)
        this.commands.add(
          entity,
          "OwnerDefinition",
          {
            prefab: ref.prefab,
            position: c.bezier[0],
            rotation: { ...c.bezier[3], w: 0 },
          },
          job,
        );
    }
    if (this.has("Fixed", id))
      this.commands.add(entity, "Fixed", this.get("Fixed", id), job);
    if (g.aggregateType !== null && this.has("Aggregated", id))
      this.commands.set(entity, "Aggregated", this.get("Aggregated", id), job);
    if (enabled && this.has("NetCondition", id))
      this.commands.set(
        entity,
        "NetCondition",
        this.get("NetCondition", id),
        job,
      );
    if (!this.has("TrackData", prefab)) {
      if (this.has("TramTrack", id))
        this.commands.add(entity, "TramTrack", {}, job);
      else if (reused && this.has("TramTrack", entity))
        this.commands.remove(entity, "TramTrack", job);
    }
    if (this.has("RoadData", prefab) && enabled && this.has("Road", id))
      this.commands.set(entity, "Road", this.get("Road", id), job);
    if (editor.prefab !== null) {
      this.commands.set(entity, "EditorContainer", editor, job);
      if (!hasGeometry && this.has("PseudoRandomSeed", id))
        this.commands.set(
          entity,
          "PseudoRandomSeed",
          this.get("PseudoRandomSeed", id),
          job,
        );
    }
    if (this.has("Native", id)) this.commands.add(entity, "Native", {}, job);
    if (this.has("ElectricityConnection", id))
      this.commands.add(entity, "ElectricityConnection", {}, job);
    const nodes = this.commands.buffer(entity, "ConnectedNode", true, job);
    this.findConnections(
      nodes,
      edge,
      curve,
      temp,
      net,
      g,
      false,
      owner === null,
      this.zoneable(prefab),
    );
    for (const row of this.ecs.buffer("ConnectedNode", id))
      if (!this.nodes(row.node).length) nodes.push(structuredClone(row));
    this.commands.add(entity, "Temp", temp, job);
    this.commands.add(id, "Hidden", {}, job);
    this.commands.add(id, "BatchesUpdated", {}, job);
  }
  splitNodes(id: string, middle: string, edge: Edge, job: number) {
    let start: Entity = null,
      end: Entity = null,
      lower = f(-3.4028235e38),
      upper = f(3.4028235e38);
    const temp = this.get<Temp>("Temp", middle),
      range = [0, temp.curvePosition, 1];
    for (const item of this.nodes(id)) {
      if (item === middle) continue;
      const t = this.ecs.tryGet<Temp>("Temp", item);
      if (!t) continue;
      const delta = sub(t.curvePosition, temp.curvePosition);
      if (delta < 0 && delta > lower) {
        start = item;
        range[0] = t.curvePosition;
        lower = delta;
      } else if (delta > 0 && delta < upper) {
        end = item;
        range[2] = t.curvePosition;
        upper = delta;
      }
    }
    if (start === null) {
      const rows = this.nodes(edge.start);
      if (!rows.length) return null;
      start = rows[0];
    } else {
      start = null;
      temp.original = null;
      this.commands.set(middle, "Temp", temp, job);
    }
    if (end === null) {
      const rows = this.nodes(edge.end);
      if (!rows.length) return null;
      end = rows[0];
    }
    return { start, end, range };
  }
  split(id: string, middle: string, job: number) {
    const original = this.get<Edge>("Edge", id),
      source = this.get<Curve>("Curve", id),
      positions = this.splitNodes(id, middle, original, job);
    if (!positions || positions.start === middle || positions.end === middle)
      return;
    const { start, end, range } = positions,
      prefab = this.prefab(id),
      net = this.get<Net>("NetData", prefab),
      g = this.geometry(prefab),
      hasGeometry = this.has("NetGeometryData", prefab),
      orders = [
        { start: 0, end: 0 },
        { start: 0, end: 0 },
      ];
    if (hasGeometry) {
      const order = this.get<{ start: number; end: number }>("BuildOrder", id),
        offset = (t: number) =>
          Math.trunc(mul(f((order.end - order.start) >>> 0), t)) >>> 0;
      orders[0].start =
        range[0] > 0 ? (order.start + offset(range[0]) + 1) >>> 0 : order.start;
      orders[0].end = (order.start + offset(range[1])) >>> 0;
      orders[1].start = (orders[0].end + 1) >>> 0;
      orders[1].end =
        range[2] < 1 ? (order.start + offset(range[2])) >>> 0 : order.end;
      for (const o of orders) if (o.start > o.end) o.start = o.end;
    }
    const ys = [0, 0, 0],
      fixed = [false, false, false];
    for (const [index, node] of [
      [1, middle],
      [0, start],
      [2, end],
    ] as const) {
      if (
        node === null ||
        (index === 0 && range[0] <= 0) ||
        (index === 2 && range[2] >= 1)
      )
        continue;
      fixed[index] = !(
        (net.requiredLayers ^
          this.get<Net>("NetData", this.prefab(node)).requiredLayers) &
        256
      );
      if (fixed[index]) ys[index] = this.get<Node>("Node", node).position.y;
    }
    const fixedData = this.ecs.tryGet<{ index: number }>("Fixed", id) ?? {
      index: -1,
    };
    let curves: [CS2RoadCurve, CS2RoadCurve];
    if (g.flags & 1 && fixedData.index < 0) {
      const p = cs2RoadCurvePosition(source.bezier, range[1]);
      if (fixed[1]) p.y = ys[1];
      const a =
          range[0] > 0
            ? cs2RoadCurvePosition(source.bezier, range[0])
            : structuredClone(source.bezier[0]),
        b =
          range[2] < 1
            ? cs2RoadCurvePosition(source.bezier, range[2])
            : structuredClone(source.bezier[3]);
      if (range[0] > 0 && fixed[0]) a.y = ys[0];
      if (range[2] < 1 && fixed[2]) b.y = ys[2];
      curves = [
        start !== null
          ? cs2StraightHangingRoadCurve(a, p, g.hanging)
          : [zero(), zero(), zero(), zero()],
        end !== null
          ? cs2StraightHangingRoadCurve(p, b, g.hanging)
          : [zero(), zero(), zero(), zero()],
      ];
    } else {
      curves = cs2DivideRoadCourseCurve(source.bezier, range[1]);
      if (start !== null && range[0] > 0) {
        curves[0] = cs2CutRoadCourseCurve(source.bezier, [range[0], range[1]]);
        if (fixed[0]) curves[0][0].y = ys[0];
      }
      if (end !== null && range[2] < 1) {
        curves[1] = cs2CutRoadCourseCurve(source.bezier, [range[1], range[2]]);
        if (fixed[2]) curves[1][3].y = ys[2];
      }
      if (fixed[1]) {
        curves[0][3].y = ys[1];
        curves[1][0].y = ys[1];
      }
    }
    const lengths = curves.map(cs2RoadCurveLength),
      oldNodes = this.ecs.buffer("ConnectedNode", id),
      conditions: [Record, Record] = [{ wear: [0, 0] }, { wear: [0, 0] }],
      condition = this.ecs.tryGet<{ wear: [number, number] }>(
        "NetCondition",
        id,
      );
    if (condition) {
      conditions[0].wear[0] =
        range[0] > 0
          ? lerp(condition.wear[0], condition.wear[1], range[0])
          : condition.wear[0];
      conditions[0].wear[1] = lerp(
        conditions[0].wear[0],
        conditions[0].wear[1],
        range[1],
      );
      conditions[1].wear[0] = conditions[0].wear[1];
      conditions[1].wear[1] =
        range[2] < 1
          ? lerp(condition.wear[0], condition.wear[1], range[2])
          : condition.wear[1];
    }
    const road = this.ecs.tryGet("Road", id),
      roads = [
        road ? structuredClone(road) : emptyRoad(),
        road ? structuredClone(road) : emptyRoad(),
      ];
    if (road)
      for (const field of ["trafficFlowDistance", "trafficFlowDuration"]) {
        if (range[0] > 0)
          roads[0][field + "0"] = vecLerp(
            road[field + "0"],
            road[field + "1"],
            range[0],
          );
        roads[0][field + "1"] = vecLerp(
          road[field + "0"],
          road[field + "1"],
          range[1],
        );
        roads[1][field + "0"] = structuredClone(roads[0][field + "1"]);
        if (range[2] < 1)
          roads[1][field + "1"] = vecLerp(
            road[field + "0"],
            road[field + "1"],
            range[2],
          );
      }
    const seeds = [0, 0],
      seed = this.ecs.tryGet<{ seed: number }>("PseudoRandomSeed", id);
    if (seed) {
      const random = new SourceRandom32(
        Math.max(1, (seed.seed & 65535) ^ 22175),
      );
      random.nextUInt();
      random.nextUInt();
      for (let i = 0; i < 2; i++)
        seeds[i] = ((random.nextUInt() + 1) >>> 0) >>> 16;
    }
    if (g.flags & 4) {
      if (range[0] > 0) {
        const [part] = cs2DivideRoadCourseCurve(source.bezier, range[0]),
          align =
            !!(round(div(cs2RoadCurveLength(part), 4)) & 1) !==
            !!((road?.flags ?? 0) & 1);
        roads[0].flags = align ? roads[0].flags | 1 : roads[0].flags & ~1;
      }
      const align =
        !!(round(div(lengths[0], 4)) & 1) !== !!(roads[0].flags & 1);
      roads[0].flags = align ? roads[0].flags | 2 : roads[0].flags & ~2;
      roads[1].flags = align ? roads[1].flags | 1 : roads[1].flags & ~1;
      if (range[2] < 1) {
        const align =
          !!(round(div(lengths[1], 4)) & 1) !== !!(roads[1].flags & 1);
        roads[1].flags = align ? roads[1].flags | 2 : roads[1].flags & ~2;
      }
    }
    const edges: Edge[] = [
      { start, end: middle },
      { start: middle, end },
    ];
    for (let i = 0; i < 2; i++)
      if ((i === 0 ? start : end) !== null)
        this.createTemp(
          job,
          edges[i],
          { bezier: curves[i], length: lengths[i] },
          this.ecs.tryGet("Elevation", id) ?? { elevation: [0, 0] },
          this.ecs.tryGet<{ flags: Flags }>("Upgraded", id)?.flags ??
            emptyFlags(),
          this.ecs.hasBuffer("SubReplacement", id)
            ? this.ecs.buffer("SubReplacement", id)
            : undefined,
          this.ecs.tryGet<{ owner: Entity }>("Owner", id)?.owner ?? null,
          fixedData,
          g.aggregateType !== null
            ? (this.ecs.tryGet("Aggregated", id) ?? { aggregate: null })
            : { aggregate: null },
          conditions[i],
          this.has("TramTrack", id) && !this.has("TrackData", prefab),
          this.has("Native", id),
          this.has("ElectricityConnection", id),
          hasGeometry,
          this.has("ServiceUpgrade", id),
          roads[i],
          seeds[i],
          prefab,
          g,
          orders[i],
          this.editor(id),
          oldNodes,
        );
  }
  createTemp(
    job: number,
    edge: Edge,
    curve: Curve,
    elevation: Record,
    upgrade: Flags,
    replacements: Record[] | undefined,
    owner: Entity,
    fixed: Record,
    aggregate: Record,
    condition: Record,
    tram: boolean,
    native: boolean,
    electricity: boolean,
    hasGeometry: boolean,
    service: boolean,
    road: Record,
    seed: number,
    prefab: Entity,
    g: Geometry,
    order: Record,
    editor: Editor,
    oldNodes: Record[],
  ) {
    const enabled = this.ecs.isEnabled("PrefabData", prefab),
      temp = emptyTemp();
    temp.flags |= 8;
    const net = this.get<Net>("NetData", prefab),
      reuse = this.reuse(
        edge,
        prefab,
        editor.prefab,
        null,
        owner,
        emptyOwner(),
      );
    owner = reuse.owner;
    const entity = reuse.entity ?? this.commands.create(net.edgeArchetype, job);
    if (reuse.entity !== null) {
      this.commands.remove(entity, "Deleted", job);
      this.commands.add(entity, "Updated", {}, job);
    } else {
      this.commands.set(entity, "PrefabRef", { prefab }, job);
      this.commands.set(entity, "Edge", edge, job);
      if (!service) this.commands.remove(entity, "ServiceUpgrade", job);
    }
    this.commands.set(entity, "Curve", curve, job);
    if (hasGeometry) {
      this.commands.set(
        entity,
        "Composition",
        { edge: prefab, startNode: prefab, endNode: prefab },
        job,
      );
      this.commands.set(entity, "BuildOrder", order, job);
      this.commands.set(entity, "PseudoRandomSeed", { seed }, job);
    }
    if (elevation.elevation.some((n: number) => n !== 0))
      this.commands.add(entity, "Elevation", elevation, job);
    if (flagsAny(upgrade))
      this.commands.add(entity, "Upgraded", { flags: upgrade }, job);
    if (replacements !== undefined)
      this.commands
        .buffer(entity, "SubReplacement", false, job)
        .push(...structuredClone(replacements));
    if (owner !== null) this.commands.add(entity, "Owner", { owner }, job);
    if (fixed.index >= 0) this.commands.add(entity, "Fixed", fixed, job);
    if (aggregate.aggregate !== null)
      this.commands.set(entity, "Aggregated", aggregate, job);
    if (enabled && condition.wear.some((n: number) => n !== 0))
      this.commands.set(entity, "NetCondition", condition, job);
    if (tram) this.commands.add(entity, "TramTrack", {}, job);
    if (native) this.commands.add(entity, "Native", {}, job);
    if (electricity)
      this.commands.add(entity, "ElectricityConnection", {}, job);
    if (editor.prefab !== null) {
      this.commands.set(entity, "EditorContainer", editor, job);
      if (!hasGeometry)
        this.commands.set(entity, "PseudoRandomSeed", { seed }, job);
    }
    if (this.has("RoadData", prefab) && enabled)
      this.commands.set(entity, "Road", road, job);
    const nodes = this.commands.buffer(entity, "ConnectedNode", true, job);
    this.findConnections(
      nodes,
      edge,
      curve,
      temp,
      net,
      g,
      false,
      owner === null,
      this.zoneable(prefab),
    );
    for (const row of oldNodes) {
      // Preserve the recovered branch: a successful mapping skips this legacy item.
      // With no mapping the original reads Entity.Null and fails; do not invent a repair.
      if (this.nodes(row.node).length) continue;
      const item: Entity = null,
        node = this.get<Node>("Node", item),
        asset = this.prefab(item),
        l = this.get<Local>("LocalConnectData", asset),
        geometry = this.get<Geometry>("NetGeometryData", asset),
        radius = Math.max(
          0,
          add(mul(geometry.defaultWidth, 0.5), l.searchDistance),
        );
      let value = cs2RoadXZDistance(curve.bezier, node.position);
      if (
        this.has("Owner", item) &&
        l.searchDistance !== 0 &&
        !(geometry.flags & 0x1000000) &&
        owner === null &&
        this.zoneable(prefab)
      )
        value = { ...value, distance: sub(value.distance, 8) };
      if (value.distance <= add(mul(g.defaultWidth, 0.5), radius)) {
        const y = sub(
          cs2RoadCurvePosition(curve.bezier, value.t).y,
          node.position.y,
        );
        if (l.heightRange[0] <= y && y <= l.heightRange[1])
          nodes.push({ node: item, curvePosition: value.t });
      }
    }
    this.commands.add(entity, "Temp", temp, job);
  }
  run() {
    const chunks = this.ecs
      .chunks({})
      .filter(
        (c) =>
          (c.components.has("CreationDefinition") &&
            c.components.has("NetCourse") &&
            c.components.has("Updated")) ||
          (c.components.has("Updated") &&
            (c.components.has("Node") || c.components.has("Edge")) &&
            !c.components.has("Deleted")),
      );
    for (const chunk of chunks) this.checkNodes(chunk);
    for (const chunk of chunks)
      if (chunk.components.has("CreationDefinition"))
        for (const id of chunk.entities) {
          const d = this.get<Definition>("CreationDefinition", id);
          if (!this.has("Deleted", d.owner) && this.has("Edge", d.original))
            this.addNode(this.key(d.original), null);
        }
    this.fillOld();
    let offset = 0;
    for (let job = 0; job < chunks.length; job++) {
      const chunk = chunks[job],
        base = offset;
      offset += chunk.entities.length;
      if (chunk.components.has("CreationDefinition")) {
        chunk.entities.forEach((id, i) => {
          const d = this.get<Definition>("CreationDefinition", id);
          if (this.has("Deleted", d.owner)) return;
          this.generated(
            job,
            base + i,
            d,
            this.ecs.tryGet<Owner>("OwnerDefinition", id) ?? emptyOwner(),
            this.get<Course>("NetCourse", id),
            this.ecs.tryGet<{ flags: Flags }>("Upgraded", id)?.flags ??
              emptyFlags(),
            this.ecs.tryGet<{ curve: CS2RoadCurve }>("LocalCurveCache", id),
            this.ecs.hasBuffer("SubReplacement", id)
              ? this.ecs.buffer("SubReplacement", id)
              : undefined,
          );
        });
        continue;
      }
      if (chunk.components.has("Edge")) {
        if (!chunk.components.has("Temp"))
          for (const id of chunk.entities)
            this.updateConnections(id, this.get<Edge>("Edge", id), job);
        continue;
      }
      if (chunk.components.has("Temp"))
        for (const id of chunk.entities) {
          const temp = this.get<Temp>("Temp", id);
          if (this.ecs.hasBuffer("ConnectedEdge", temp.original)) {
            for (const { edge } of this.ecs.buffer(
              "ConnectedEdge",
              temp.original,
            ))
              if (this.shouldDuplicate(edge, temp.original, temp.flags))
                this.duplicate(edge, job);
          } else if (this.has("Edge", temp.original))
            this.split(temp.original!, id, job);
        }
    }
    let buildOrder = this.buildOrder;
    for (const chunk of this.ecs.chunks({
      all: ["Created", "Edge", "BuildOrder"],
      none: ["Temp"],
    }))
      for (const id of chunk.entities) {
        const o = this.get<{ start: number; end: number }>("BuildOrder", id);
        buildOrder = Math.max(buildOrder, (Math.max(o.start, o.end) + 1) >>> 0);
      }
    this.ecs.publish(this.commands.commands);
    return {
      status: "complete" as const,
      world: this.ecs.snapshot(),
      commands: this.commands.commands,
      barrier: "ModificationBarrier2" as const,
      buildOrder,
    };
  }
}
export function cs2GenerateRoadEdges(
  world: CS2RoadApplyWorld,
  options: { editorMode?: boolean; buildOrder?: number } = {},
) {
  return new EdgeGeneration(
    world,
    options.editorMode ?? false,
    (options.buildOrder ?? 0) >>> 0,
  ).run();
}
