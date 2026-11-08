import {
  add,
  arcParameter,
  arcTable,
  center,
  bezier,
  laneDirection,
  lanePoint,
  laneEntryT,
  laneExitT,
  length,
  dist,
  logicalRoadSignature,
  mul,
  normal,
  pavementWidth,
  smooth,
  sub,
  tangent,
} from "../core/math";
import { buildLaneJunctions, type LaneJunction } from "../core/lane-junctions";
import {
  buildJunctions,
  convexHull,
  roadRange,
  type Junction,
} from "../core/junctions";
import { roadSurfaceTriangles } from "../core/junction-crosswalks";
import { forkPavement, forkSurfaces, roadForks } from "../core/road-forks";
import { isNodeSmooth, nodeVisualKey } from "../core/road-visual-settings";
import { connections } from "../core/model";
import type { Connection, Project, Road, V } from "../core/types";

export type RoadSurfaceTriangle = readonly [V, V, V];
export type RoadVisualCollar = {
  node: string;
  end: 0 | 1;
  length: number;
  span: number;
  left: number;
  right: number;
};
export type RoadVisualPlan = Map<string, RoadVisualCollar[]>;
export const NODE_SURFACE_HALF_LENGTH = 2.5;
type Range = { start: number; end: number };
const dot = (a: V, b: V) => a.x * b.x + a.z * b.z;
const flatten = (triangles: readonly RoadSurfaceTriangle[]) =>
  triangles.flatMap((t) => t.flatMap((p) => [p.x, p.y, p.z]));
export { flatten as surfacePositions };

function distanceAt(road: Road, t: number) {
  const table = arcTable(road),
    index = Math.min(table.length - 2, Math.floor(t * (table.length - 1))),
    a = table[index],
    b = table[index + 1];
  return a.s + ((b.s - a.s) * (t - a.t)) / Math.max(1e-8, b.t - a.t);
}
export function visualCollarSpan(road: Road, end: 0 | 1, length = 24) {
  const table = arcTable(road),
    total = table.at(-1)!.s,
    extent = Math.min(length, total * 0.42);
  return {
    length: extent,
    span:
      end === 0
        ? arcParameter(table, extent)
        : 1 - arcParameter(table, total - extent),
  };
}
function section(road: Road, t: number) {
  const c = center(road, t),
    n = normal(road, t),
    half = pavementWidth(road, t) / 2 + 0.35;
  return [add(c, mul(n, -half)), add(c, mul(n, half))] as const;
}
function simpleSeam(
  node: LaneJunction,
  roads: ReadonlyMap<string, Road>,
  physical: ReadonlySet<string>,
) {
  if (node.arms.length !== 2 || physical.has(node.id)) return;
  const [aa, bb] = node.arms,
    a = roads.get(aa.road),
    b = roads.get(bb.road);
  if (!a || !b || a.id === b.id) return;
  const ac = center(a, aa.end),
    bc = center(b, bb.end),
    ad = tangent(a, aa.end),
    bd = tangent(b, bb.end),
    delta = sub(ac, bc);
  if (
    Math.abs(ac.y - bc.y) > 0.5 ||
    Math.abs(dot(ad, bd)) < 0.94 ||
    Math.abs(dot(delta, ad)) > 0.65 ||
    Math.abs(dot(delta, bd)) > 0.65 ||
    dist(ac, bc) >
      (pavementWidth(a, aa.end) + pavementWidth(b, bb.end)) / 2 + 0.65
  )
    return;
  return [
    { road: a, end: aa.end },
    { road: b, end: bb.end },
  ] as const;
}

/** Read-only decoration: outward additions only. No rendering Road is created. */
export function roadVisualPlan(
  project: Project,
  nodes: readonly LaneJunction[] = buildLaneJunctions(project),
  junctions: readonly Junction[] = buildJunctions(project),
): RoadVisualPlan {
  const roads = new Map(project.roads.map((r) => [r.id, r])),
    physical = new Set(junctions.map((j) => j.id)),
    result: RoadVisualPlan = new Map();
  for (const node of nodes) {
    if (!isNodeSmooth(project, node)) continue;
    const pair = simpleSeam(node, roads, physical);
    if (!pair) continue;
    for (const [own, other] of [
      [pair[0], pair[1]],
      [pair[1], pair[0]],
    ]) {
      const c = center(own.road, own.end),
        n = normal(own.road, own.end),
        half = pavementWidth(own.road, own.end) / 2 + 0.35,
        offsets = section(other.road, other.end).map((p) => dot(sub(p, c), n)),
        left = Math.max(0, -Math.min(...offsets) - half),
        right = Math.max(0, Math.max(...offsets) - half);
      if (left < 0.001 && right < 0.001) continue;
      const span = visualCollarSpan(
        own.road,
        own.end,
        Math.max(24, Math.max(left, right) * 6),
      );
      const collars = result.get(own.road.id) ?? [];
      collars.push({
        node: nodeVisualKey(node),
        end: own.end,
        ...span,
        left,
        right,
      });
      result.set(own.road.id, collars);
    }
  }
  return result;
}

/** Every visual cross-section contains the entire logical cross-section. */
export function visualRoadEdges(
  road: Road,
  t: number,
  collars: readonly RoadVisualCollar[] = [],
  inset = 0,
) {
  let left = 0,
    right = 0;
  for (const collar of collars) {
    const s = distanceAt(road, t),
      distance = collar.end === 0 ? s : arcTable(road).at(-1)!.s - s,
      pad = Math.min(NODE_SURFACE_HALF_LENGTH, collar.length * 0.25),
      weight =
        1 - smooth((distance - pad) / Math.max(0.001, collar.length - pad));
    left = Math.max(left, collar.left * weight);
    right = Math.max(right, collar.right * weight);
  }
  const c = center(road, t),
    n = normal(road, t),
    half = pavementWidth(road, t) / 2 + 0.35 - inset;
  return [add(c, mul(n, -half - left)), add(c, mul(n, half + right))] as const;
}

function fan(poly: readonly V[]): RoadSurfaceTriangle[] {
  return poly.slice(1, -1).map((p, i) => [poly[0], p, poly[i + 2]]);
}
function planeClip(poly: V[], plane: (p: V) => number, inside: boolean) {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = plane(a),
      db = plane(b),
      ia = inside ? da >= 0 : da <= 0,
      ib = inside ? db >= 0 : db <= 0;
    if (ia) out.push(a);
    if (ia !== ib) out.push(add(a, mul(sub(b, a), da / (da - db))));
  }
  return out;
}
function trianglePlanes([a, b, c]: RoadSurfaceTriangle) {
  const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x),
    sign = Math.sign(area);
  if (Math.abs(area) < 1e-9) return [];
  const points = [a, b, c],
    planes = points.map((p, i) => {
      const q = points[(i + 1) % 3];
      return (v: V) =>
        sign * ((q.x - p.x) * (v.z - p.z) - (q.z - p.z) * (v.x - p.x));
    });
  const height = (p: V) => {
    const u = ((p.x - a.x) * (c.z - a.z) - (p.z - a.z) * (c.x - a.x)) / area,
      v = ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / area;
    return p.y - (a.y + u * (b.y - a.y) + v * (c.y - a.y));
  };
  return [...planes, (p: V) => 0.015 - height(p), (p: V) => 0.015 + height(p)];
}
function bounds(t: readonly V[]) {
  return [
    Math.min(...t.map((p) => p.x)),
    Math.max(...t.map((p) => p.x)),
    Math.min(...t.map((p) => p.z)),
    Math.max(...t.map((p) => p.z)),
  ];
}
/** Subtract existing coplanar surfaces so additions cannot cause duplicate paint/decks. */
function uncovered(
  triangles: readonly RoadSurfaceTriangle[],
  obstacles: readonly RoadSurfaceTriangle[],
) {
  const blockers = obstacles.map((t) => ({
      box: bounds(t),
      planes: trianglePlanes(t),
    })),
    output: RoadSurfaceTriangle[] = [];
  for (const triangle of triangles) {
    let polys: V[][] = [[...triangle]];
    const box = bounds(triangle);
    for (const other of blockers) {
      if (
        !other.planes.length ||
        box[0] > other.box[1] ||
        box[1] < other.box[0] ||
        box[2] > other.box[3] ||
        box[3] < other.box[2]
      )
        continue;
      const next: V[][] = [];
      for (const poly of polys) {
        let rest = poly;
        for (const plane of other.planes) {
          if (rest.length < 3) break;
          const outside = planeClip(rest, plane, false);
          if (outside.length >= 3) next.push(outside);
          rest = planeClip(rest, plane, true);
        }
      }
      polys = next;
      if (!polys.length) break;
    }
    for (const poly of polys)
      for (const t of fan(poly))
        if (
          Math.abs(
            (t[1].x - t[0].x) * (t[2].z - t[0].z) -
              (t[1].z - t[0].z) * (t[2].x - t[0].x),
          ) > 1e-8
        )
          output.push(t);
  }
  return output;
}

export function logicalRoadSurface(
  road: Road,
  range: Range,
  blockers: readonly Road[] = [],
): RoadSurfaceTriangle[] {
  if (!blockers.length)
    return roadSurfaceTriangles(road, range).map((p) => p.polygon as [V, V, V]);
  const positions = forkPavement(road, range, forkSurfaces(blockers)),
    result: RoadSurfaceTriangle[] = [];
  for (let i = 0; i < positions.length; i += 9)
    result.push(
      [0, 3, 6].map((j) => ({
        x: positions[i + j],
        y: positions[i + j + 1],
        z: positions[i + j + 2],
      })) as [V, V, V],
    );
  return result;
}
/** Covers the current rendered3.8m×1.76m body in every orientation. */
export const VISUAL_BODY_RADIUS = Math.hypot(1.9, 0.88);
function movementEnvelope(
  node: LaneJunction,
  roads: ReadonlyMap<string, Road>,
  links: readonly Connection[],
) {
  const ends = new Set(node.arms.map((a) => `${a.road}:${a.end}`)),
    points: V[] = [],
    samples = 48,
    sides = 16;
  for (const link of links) {
    if (!link.enabled) continue;
    const a = roads.get(link.from.road),
      b = roads.get(link.to.road);
    if (!a || !b) continue;
    const at = laneExitT(a, link.from.lane),
      bt = laneEntryT(b, link.to.lane);
    if (!ends.has(`${a.id}:${at}`) || !ends.has(`${b.id}:${bt}`)) continue;
    const from = lanePoint(a, link.from.lane, at),
      to = lanePoint(b, link.to.lane, bt),
      handle = dist(from, to) * 0.45,
      controls = [
        from,
        add(
          from,
          mul(tangent(a, at), handle * laneDirection(a, link.from.lane)),
        ),
        add(to, mul(tangent(b, bt), -handle * laneDirection(b, link.to.lane))),
        to,
      ] as const,
      second =
        Math.max(
          length(add(sub(controls[2], mul(controls[1], 2)), controls[0])),
          length(add(sub(controls[3], mul(controls[2], 2)), controls[1])),
        ) * 6,
      chordError = second / (8 * samples * samples),
      radius =
        (VISUAL_BODY_RADIUS + chordError + 0.01) / Math.cos(Math.PI / sides);
    for (let i = 0; i <= samples; i++) {
      const c = bezier(...controls, i / samples);
      for (let j = 0; j < sides; j++)
        points.push({
          x: c.x + Math.cos((j * Math.PI * 2) / sides) * radius,
          y: c.y,
          z: c.z + Math.sin((j * Math.PI * 2) / sides) * radius,
        });
    }
  }
  return points;
}

export type RoadSurfacePlan = {
  roads: Map<string, readonly RoadSurfaceTriangle[]>;
  junctions: Map<string, readonly RoadSurfaceTriangle[]>;
  seams: Map<string, readonly RoadSurfaceTriangle[]>;
  unsupportedNodes: string[];
};
const logicalCache = new WeakMap<
  Project,
  { signature: string; plan: RoadSurfacePlan }
>();
export function logicalSurfacePlan(project: Project): RoadSurfacePlan {
  const signature = JSON.stringify([
      logicalRoadSignature(project.roads),
      project.junctionLaneConnections,
    ]),
    cached = logicalCache.get(project);
  if (cached?.signature === signature) return cached.plan;
  const junctions = buildJunctions(project),
    nodes = buildLaneJunctions(project),
    forks = roadForks(project.roads),
    roads = new Map(
      project.roads.map((road) => [
        road.id,
        logicalRoadSurface(
          road,
          roadRange(road, junctions),
          forks.get(road.id)?.pavement,
        ),
      ]),
    ),
    junctionSurfaces = new Map(
      junctions.map((j) => [
        j.id,
        fan(j.polygon.map((p) => ({ ...p, y: j.position.y + 0.018 }))),
      ]),
    ),
    all = [...roads.values(), ...junctionSurfaces.values()].flat(),
    byId = new Map(project.roads.map((road) => [road.id, road])),
    physical = new Set(junctions.map((j) => j.id)),
    links = connections(project),
    seams = new Map<string, readonly RoadSurfaceTriangle[]>(),
    unsupportedNodes: string[] = [];
  for (const node of [...nodes].sort((a, b) =>
    nodeVisualKey(a).localeCompare(nodeVisualKey(b)),
  )) {
    const pair = simpleSeam(node, byId, physical);
    if (!pair) {
      if (!physical.has(node.id)) unsupportedNodes.push(nodeVisualKey(node));
      continue;
    }
    // A short vehicle-sized pad supplies the existing route's body envelope at
    // a discontinuous section. It never changes an endpoint or lane trajectory.
    const points = pair.flatMap(({ road, end }) =>
        section(road, end).flatMap((p) =>
          [-1, 1].map((sign) =>
            add(p, mul(tangent(road, end), sign * NODE_SURFACE_HALF_LENGTH)),
          ),
        ),
      ),
      patch = uncovered(
        fan(convexHull([...points, ...movementEnvelope(node, byId, links)])),
        all,
      );
    if (patch.length) {
      seams.set(nodeVisualKey(node), patch);
      all.push(...patch);
    }
  }
  const plan = { roads, junctions: junctionSurfaces, seams, unsupportedNodes };
  logicalCache.set(project, { signature, plan });
  return plan;
}

export function visualExtensionSurfaces(
  project: Project,
  plan: RoadVisualPlan,
  logical = logicalSurfacePlan(project),
) {
  const result = new Map<string, readonly RoadSurfaceTriangle[]>(),
    obstacles = [
      ...logical.roads.values(),
      ...logical.junctions.values(),
      ...logical.seams.values(),
    ].flat();
  for (const road of [...project.roads].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const collars = plan.get(road.id);
    if (!collars?.length) continue;
    const triangles: RoadSurfaceTriangle[] = [],
      samples = Math.max(60, road.knots.length * 35),
      range = roadRange(road, buildJunctions(project));
    for (let i = 0; i < samples; i++) {
      const a = range.start + ((range.end - range.start) * i) / samples,
        b = range.start + ((range.end - range.start) * (i + 1)) / samples,
        aa = section(road, a),
        bb = section(road, b),
        ae = visualRoadEdges(road, a, collars),
        be = visualRoadEdges(road, b, collars);
      for (const side of [0, 1])
        triangles.push(
          [aa[side], bb[side], ae[side]],
          [ae[side], bb[side], be[side]],
        );
    }
    const patches = uncovered(triangles, obstacles);
    result.set(road.id, patches);
    obstacles.push(...patches);
  }
  return result;
}

/** The exact pavement triangles consumed by Scene, including logical junctions. */
export function visibleRoadSurfaceTriangles(
  project: Project,
): readonly RoadSurfaceTriangle[] {
  const logical = logicalSurfacePlan(project),
    extra = visualExtensionSurfaces(project, roadVisualPlan(project), logical);
  return [
    ...logical.roads.values(),
    ...logical.junctions.values(),
    ...logical.seams.values(),
    ...extra.values(),
  ].flat();
}
