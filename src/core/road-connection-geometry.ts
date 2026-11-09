import { buildJunctions, convexHull } from "./junctions";
import { buildLaneJunctions, type LaneJunction } from "./lane-junctions";
import {
  add,
  arcParameter,
  arcTable,
  bezier,
  center,
  dist,
  laneDirection,
  laneEntryT,
  laneExitT,
  lanePoint,
  mul,
  normal,
  pavementWidth,
  sub,
  tangent,
} from "./math";
import { signalForJunction, signalStopOffset } from "./traffic-signals";
import type { Connection, Project, V } from "./types";

type GeometryProject = Pick<Project, "roads"> &
  Partial<Pick<Project, "signals" | "junctionLaneConnections">>;
export type RoadConnectionCurve = {
  points: readonly [V, V, V, V];
  length: number;
};
export type RoadConnectionPlan = {
  nodes: LaneJunction[];
  trims: Map<string, { start: number; end: number }>;
  stations: Map<string, { t: number; distance: number }>;
  curves: Map<string, RoadConnectionCurve>;
};
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;

/** The same cubic and arc-length sampling is used by UI, pavement and traffic. */
export function roadConnectionCurve(
  from: V,
  to: V,
  fromDirection: V,
  toDirection: V,
  continuation = false,
): RoadConnectionCurve {
  const delta = sub(to, from),
    chord = dist(from, to);
  // A lateral chord is not usable forward space. Clamping the handles by
  // forward projection keeps the middle tangent from doubling back.
  const handle = (direction: V) =>
    continuation
      ? Math.max(0, Math.min(chord * 0.45, dot(delta, direction) / 3))
      : chord * 0.45;
  const points = [
    { ...from },
    add(from, mul(fromDirection, handle(fromDirection))),
    add(to, mul(toDirection, -handle(toDirection))),
    { ...to },
  ] as const;
  let length = 0,
    last = from;
  for (let i = 1; i <= 64; i++) {
    const p = bezier(...points, i / 64);
    length += dist(last, p);
    last = p;
  }
  return { points, length };
}

/** Pure functional geometry. `links` must contain enabled movements, not candidates. */
export function buildRoadConnectionPlan(
  project: GeometryProject,
  links: readonly Connection[],
  baseTrims?: ReadonlyMap<string, { start: number; end: number }>,
): RoadConnectionPlan {
  const roads = new Map(project.roads.map((r) => [r.id, r])),
    tables = new Map(project.roads.map((r) => [r.id, arcTable(r)])),
    nodes = structuredClone(buildLaneJunctions(project)),
    trims = new Map(project.roads.map((r) => [r.id, { start: 0, end: 0 }]));
  if (baseTrims) {
    for (const [id, value] of baseTrims)
      if (trims.has(id)) trims.set(id, { ...value });
  } else {
    // buildJunctions reads roads only; signals extend its true stop-line trims.
    for (const node of buildJunctions(project as Project))
      for (const arm of node.arms) {
        const value = trims.get(arm.road)!;
        value[arm.end === 0 ? "start" : "end"] =
          arm.trim +
          (signalForJunction(project.signals, node)
            ? signalStopOffset(arm)
            : 0);
      }
  }
  const active = links.filter((link) => link.enabled),
    nodeByEnd = new Map<string, LaneJunction>(
      nodes.flatMap((n) =>
        n.arms.map((a) => [`${a.road}:${a.end}`, n] as const),
      ),
    );
  // Preserve existing functional offset-attachment behaviour. Continuation
  // editing insets (formerly14/22m) are deliberately not physical geometry.
  for (const node of nodes) {
    if (
      node.kind !== "attachment" ||
      !project.junctionLaneConnections?.some((r) =>
        node.arms.some((a) => a.road === r.from.road && a.end === r.from.end),
      )
    )
      continue;
    for (const a of node.arms) {
      const value = trims.get(a.road)!;
      const key = a.end === 0 ? "start" : "end";
      value[key] = Math.max(
        value[key],
        a.trim +
          (signalForJunction(project.signals, node) ? signalStopOffset(a) : 0),
      );
    }
  }
  const demand = new Map<LaneJunction, number>();
  for (const link of active) {
    const a = roads.get(link.from.road),
      b = roads.get(link.to.road);
    if (!a || !b) continue;
    const ae = laneExitT(a, link.from.lane) as 0 | 1,
      be = laneEntryT(b, link.to.lane),
      node = nodeByEnd.get(`${a.id}:${ae}`);
    if (
      node?.kind !== "continuation" ||
      node.arms.length !== 2 ||
      nodeByEnd.get(`${b.id}:${be}`) !== node
    )
      continue;
    const ad = mul(tangent(a, ae), laneDirection(a, link.from.lane)),
      bd = mul(tangent(b, be), laneDirection(b, link.to.lane));
    if (dot(ad, bd) < 0.94) continue;
    const delta = sub(
        lanePoint(b, link.to.lane, be),
        lanePoint(a, link.from.lane, ae),
      ),
      along = dot(delta, ad),
      lateral = Math.sqrt(Math.max(0, dot(delta, delta) - along * along));
    if (lateral < 0.05) continue;
    const speed = Math.min(a.speed, b.speed) / 3.6,
      desired = Math.max(
        12,
        lateral * 6,
        speed * Math.sqrt((6 * lateral) / 1.8),
      );
    demand.set(node, Math.max(demand.get(node) ?? 0, desired));
  }
  for (const [node, wanted] of demand) {
    const capacities = node.arms.map((a) => {
      const length = tables.get(a.road)!.at(-1)!.s,
        opposite = trims.get(a.road)![a.end === 0 ? "end" : "start"];
      return Math.max(
        0,
        Math.min(length * 0.4, length - opposite - Math.min(4, length * 0.2)),
      );
    });
    const [aa, bb] = node.arms,
      total = Math.min(wanted, capacities[0] + capacities[1]),
      a = Math.min(capacities[0], Math.max(total / 2, total - capacities[1])),
      b = Math.min(capacities[1], total - a);
    for (const [arm, distance] of [
      [aa, a],
      [bb, b],
    ] as const) {
      const value = trims.get(arm.road)!,
        key = arm.end === 0 ? "start" : "end";
      value[key] = Math.max(value[key], distance);
    }
  }
  const stations: RoadConnectionPlan["stations"] = new Map();
  for (const road of project.roads)
    for (const end of [0, 1] as const) {
      const table = tables.get(road.id)!,
        distance = trims.get(road.id)![end === 0 ? "start" : "end"];
      stations.set(`${road.id}:${end}`, {
        distance,
        t: arcParameter(
          table,
          end === 0 ? distance : table.at(-1)!.s - distance,
        ),
      });
    }
  for (const node of nodes)
    for (const arm of node.arms) {
      const station = stations.get(`${arm.road}:${arm.end}`)!;
      arm.trim = station.distance;
      arm.t = station.t;
    }
  for (const node of nodes)
    if (node.kind) {
      node.polygon = convexHull(
        node.arms.flatMap((arm) => {
          const road = roads.get(arm.road)!,
            c = center(road, arm.t),
            n = normal(road, arm.t);
          arm.halfWidth = pavementWidth(road, arm.t) / 2 + 0.35;
          return [-1, 1].map((side) => add(c, mul(n, arm.halfWidth * side)));
        }),
      );
      node.radius = Math.max(
        6,
        ...node.polygon.map((p) => dist(p, node.position)),
      );
    }
  const curves: RoadConnectionPlan["curves"] = new Map();
  for (const link of active) {
    const a = roads.get(link.from.road),
      b = roads.get(link.to.road);
    if (!a || !b) continue;
    const ae = laneExitT(a, link.from.lane),
      be = laneEntryT(b, link.to.lane),
      at = stations.get(`${a.id}:${ae}`)!.t,
      bt = stations.get(`${b.id}:${be}`)!.t,
      node = nodeByEnd.get(`${a.id}:${ae}`);
    curves.set(
      link.id,
      roadConnectionCurve(
        lanePoint(a, link.from.lane, at),
        lanePoint(b, link.to.lane, bt),
        mul(tangent(a, at), laneDirection(a, link.from.lane)),
        mul(tangent(b, bt), laneDirection(b, link.to.lane)),
        node?.kind === "continuation" &&
          nodeByEnd.get(`${b.id}:${be}`) === node,
      ),
    );
  }
  return { nodes, trims, stations, curves };
}
