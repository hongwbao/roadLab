import {
  add,
  arcParameter,
  arcTable,
  backwardLaneCount,
  bezier,
  boundaryPoint,
  laneDirection,
  laneEntryT,
  laneExitT,
  medianWidth,
  medianExtent,
  mul,
  normal,
  smooth,
  sub,
  tangent,
} from "../core/math";
import { connections } from "../core/model";
import { roadMedianRange } from "../core/road-median";
import { buildJunctions } from "../core/junctions";
import { roadConnectionCurve } from "../core/road-connection-geometry";
import type { Connection, Project, V } from "../core/types";
import type { TransitionMarkings } from "../core/transition-markings";
import {
  connectionVisualSections,
  logicalSurfacePlan,
  type RoadSurfacePlan,
  type RoadSurfaceTriangle,
  type RoadVisualPlan,
} from "./road-visual-geometry";

type Curve = readonly [V, V, V, V];
export type ConnectionVisuals = {
  roads: string[];
  ends: string[];
  edges: V[][];
  lanes: V[][];
  median: V[][];
  medianFill: RoadSurfaceTriangle[];
};
const dot = (a: V, b: V) => a.x * b.x + a.z * b.z;
const lateral = (a: V, b: V) => {
  const delta = sub(b, a),
    length = Math.hypot(delta.x, delta.z) || 1;
  return { x: delta.x / length, y: 0, z: delta.z / length };
};
const reverse = (curve: Curve): Curve => [
  curve[3],
  curve[2],
  curve[1],
  curve[0],
];
const sample = (curve: Curve) =>
  Array.from({ length: 65 }, (_, i) => bezier(...curve, i / 64));

/** Surface paint, never a routing input. Degree-two continuations only. */
export function connectionVisuals(
  project: Project,
  plan: RoadVisualPlan,
  logical: RoadSurfacePlan = logicalSurfacePlan(project),
): Map<string, ConnectionVisuals> {
  const links = connections(project).filter((link) => link.enabled),
    result = new Map<string, ConnectionVisuals>();
  for (const section of connectionVisualSections(project, plan, logical)) {
    const [a, b] = section.arms,
      active = links.filter((link) => {
        const from =
            link.from.road === a.road.id
              ? a
              : link.from.road === b.road.id
                ? b
                : undefined,
          to =
            link.to.road === a.road.id
              ? a
              : link.to.road === b.road.id
                ? b
                : undefined;
        return (
          from &&
          to &&
          from !== to &&
          laneExitT(from.road, link.from.lane) === from.end &&
          laneEntryT(to.road, link.to.lane) === to.end
        );
      }),
      canonical = new Map(
        active.map((link) => {
          const curve = logical.functional.curves.get(link.id)!.points;
          return [
            link.id,
            link.from.road === a.road.id ? curve : reverse(curve),
          ] as const;
        }),
      ),
      row: ConnectionVisuals = {
        roads: [a.road.id, b.road.id],
        ends: [a, b].map((arm) => `${arm.road.id}:${arm.end}`),
        edges: [[], []],
        lanes: [],
        median: [],
        medianFill: [],
      };
    for (let i = 0; i <= 64; i++) {
      const left = bezier(...section.edges[0], i / 64),
        right = bezier(...section.edges[1], i / 64),
        normal = lateral(left, right);
      row.edges[0].push(add(left, mul(normal, 0.47)));
      row.edges[1].push(add(right, mul(normal, -0.47)));
    }
    const fromDegree = (link: Connection) =>
        active.filter(
          (x) =>
            x.from.road === link.from.road && x.from.lane === link.from.lane,
        ).length,
      toDegree = (link: Connection) =>
        active.filter(
          (x) => x.to.road === link.to.road && x.to.lane === link.to.lane,
        ).length;
    for (let i = 0; i < active.length; i++)
      for (let j = i + 1; j < active.length; j++) {
        const x = active[i],
          y = active[j];
        if (
          x.from.road !== y.from.road ||
          x.to.road !== y.to.road ||
          Math.abs(x.from.lane - y.from.lane) !== 1 ||
          Math.abs(x.to.lane - y.to.lane) !== 1 ||
          fromDegree(x) !== 1 ||
          fromDegree(y) !== 1 ||
          toDegree(x) !== 1 ||
          toDegree(y) !== 1
        )
          continue;
        const road = x.from.road === a.road.id ? a.road : b.road;
        if (
          laneDirection(road, x.from.lane) !== laneDirection(road, y.from.lane)
        )
          continue;
        const xc = canonical.get(x.id)!,
          yc = canonical.get(y.id)!,
          normal = lateral(section.edges[0][0], section.edges[1][0]),
          endNormal = lateral(section.edges[0][3], section.edges[1][3]);
        if (
          dot(sub(yc[0], xc[0]), normal) * dot(sub(yc[3], xc[3]), endNormal) <=
          0
        )
          continue;
        const boundary = xc.map((p, k) =>
          mul(add(p, yc[k]), 0.5),
        ) as unknown as Curve;
        // A separator is an ordered exclusive partition, never a route guide.
        // Refuse it if any other active movement changes sides of the boundary.
        const safe = active
          .filter((link) => link !== x && link !== y)
          .every((link) => {
            const curve = canonical.get(link.id)!,
              side = dot(sub(curve[0], boundary[0]), normal);
            if (side * dot(sub(curve[3], boundary[3]), endNormal) <= 0.01)
              return false;
            return Array.from({ length: 49 }, (_, k) => k / 48).every((t) => {
              const n = lateral(
                bezier(...section.edges[0], t),
                bezier(...section.edges[1], t),
              );
              return (
                side *
                  dot(sub(bezier(...curve, t), bezier(...boundary, t)), n) >
                0.01
              );
            });
          });
        if (safe) row.lanes.push(sample(boundary));
      }
    if (a.road.twoWay && b.road.twoWay) {
      const from = boundaryPoint(a.road, backwardLaneCount(a.road), a.t),
        to = boundaryPoint(b.road, backwardLaneCount(b.road), b.t),
        directionA = mul(tangent(a.road, a.t), a.end === 1 ? 1 : -1),
        directionB = mul(tangent(b.road, b.t), b.end === 0 ? 1 : -1),
        center = roadConnectionCurve(
          from,
          to,
          directionA,
          directionB,
          true,
        ).points,
        widthA = medianWidth(a.road, a.t),
        widthB = medianWidth(b.road, b.t),
        strips: [V[], V[]] = [[], []];
      let safe = true;
      for (let i = 0; i <= 64; i++) {
        const t = i / 64,
          p = bezier(...center, t),
          n = lateral(
            bezier(...section.edges[0], t),
            bezier(...section.edges[1], t),
          ),
          half = (widthA + (widthB - widthA) * smooth(t)) / 2;
        for (const curve of canonical.values())
          if (Math.abs(dot(sub(bezier(...curve, t), p), n)) < half + 0.9)
            safe = false;
        strips[0].push(add(p, mul(n, -half)));
        strips[1].push(add(p, mul(n, half)));
      }
      if (safe) {
        row.median.push(strips[0]);
        if (widthA + widthB > 0.01) {
          row.median.push(strips[1]);
          for (let i = 0; i < 64; i++)
            row.medianFill.push(
              [strips[0][i], strips[0][i + 1], strips[1][i]],
              [strips[1][i], strips[0][i + 1], strips[1][i + 1]],
            );
          // The existing road curb has a tapered cap at its functional cut.
          // Continue the same grey floor underneath that cap, so its triangular
          // side gaps do not expose black asphalt against the new divider strip.
          for (const arm of section.arms) {
            if (medianWidth(arm.road, arm.t) < 0.01) continue;
            const range = roadMedianRange(
              project,
              arm.road,
              buildJunctions(project),
            );
            if (!range) continue;
            const table = arcTable(arm.road),
              length = table.at(-1)!.s,
              cut =
                arm.end === 0
                  ? logical.functional.stations.get(`${arm.road.id}:0`)!
                      .distance
                  : length -
                    logical.functional.stations.get(`${arm.road.id}:1`)!
                      .distance,
              clip = logical.ranges.get(arm.road.id)!,
              distanceAt = (t: number) => {
                const i = Math.min(
                    table.length - 2,
                    Math.floor(t * (table.length - 1)),
                  ),
                  x = table[i],
                  y = table[i + 1];
                return (
                  x.s + ((y.s - x.s) * (t - x.t)) / Math.max(1e-8, y.t - x.t)
                );
              },
              start = Math.max(range.startDistance, distanceAt(clip.start)),
              end = Math.min(range.endDistance, distanceAt(clip.end)),
              tip = Math.min(
                medianExtent(arm.road) * 1.5 + 1,
                (end - start) / 4,
              ),
              full = arm.end === 0 ? start + tip : end - tip;
            if (tip <= 0) continue;
            const rails: [V[], V[]] = [[], []];
            for (let i = 0; i <= 16; i++) {
              const t = arcParameter(table, cut + ((full - cut) * i) / 16),
                c = boundaryPoint(arm.road, backwardLaneCount(arm.road), t),
                n = normal(arm.road, t),
                half = medianWidth(arm.road, t) / 2;
              rails[0].push(add(c, mul(n, -half)));
              rails[1].push(add(c, mul(n, half)));
            }
            for (let i = 0; i < 16; i++)
              row.medianFill.push(
                [rails[0][i], rails[0][i + 1], rails[1][i]],
                [rails[1][i], rails[0][i + 1], rails[1][i + 1]],
              );
          }
        }
      }
    }
    result.set(section.key, row);
  }
  return result;
}

/** Existing road paint now ends at the true station, not the obsolete24m collar. */
export function connectionRoadPaint(
  paint: Map<string, TransitionMarkings>,
  visuals: Map<string, ConnectionVisuals>,
) {
  const ends = new Set([...visuals.values()].flatMap((node) => node.ends));
  return new Map(
    [...paint].map(([road, markings]) => [
      road,
      Object.fromEntries(
        Object.entries(markings).map(([index, collars]) => [
          index,
          collars.filter((collar) => !ends.has(`${road}:${collar.end}`)),
        ]),
      ),
    ]),
  );
}
