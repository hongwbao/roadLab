import {
  add,
  arcParameter,
  arcTable,
  backwardLaneCount,
  boundaryPoint,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  medianExtent,
  medianWidth,
  mul,
  normal,
  tangent,
} from "../core/math";
import {
  separatorPaths,
  type MarkingRange,
  type TransitionMarkings,
} from "../core/transition-markings";
import type { Road, V } from "../core/types";
import { visualRoadEdges, type RoadVisualCollar } from "./road-visual-geometry";

/** Preview geometry follows the same pavement and divider as the committed road. */
export function previewRoadMarkings(
  road: Road,
  range: MarkingRange = { start: 0, end: 1 },
  markings?: TransitionMarkings,
  collars?: readonly RoadVisualCollar[],
) {
  const table = arcTable(road),
    length = table.at(-1)!.s,
    samples = Math.max(50, Math.min(1024, Math.ceil(length / 2))),
    ts = Array.from(
      { length: samples + 1 },
      (_, i) => range.start + ((range.end - range.start) * i) / samples,
    ),
    edges = [-1, 1].map((side) =>
      ts.map((t) => visualRoadEdges(road, t, collars)[side === -1 ? 0 : 1]),
    ),
    lanes: V[][] = [],
    median: V[][] = [],
    arrows: { lane: number; t: number; path: V[] }[] = [];
  for (let index = 1; index < laneCount(road); index++) {
    if (road.twoWay && index === backwardLaneCount(road)) {
      if (medianExtent(road))
        for (const side of [-1, 1])
          median.push(
            ts.map((t) => {
              const p = add(
                boundaryPoint(road, index, t),
                mul(normal(road, t), (side * medianWidth(road, t)) / 2),
              );
              return {
                ...p,
                y: p.y + 0.31 * Math.min(1, medianWidth(road, t) / 0.5),
              };
            }),
          );
      else median.push(ts.map((t) => boundaryPoint(road, index, t)));
    } else lanes.push(...separatorPaths(road, index, range, markings));
  }
  const startDistance = table.find((a) => a.t >= range.start)?.s ?? 0,
    endDistance = table.find((a) => a.t >= range.end)?.s ?? length,
    span = endDistance - startDistance,
    count = Math.max(1, Math.round(span / 42)),
    half = Math.max(0.65, Math.min(1.9, span / 5));
  for (let i = 0; i < count; i++) {
    const t = arcParameter(table, startDistance + ((i + 0.5) * span) / count);
    for (let lane = 0; lane < laneCount(road); lane++) {
      if (laneWidth(road, lane, t) < road.width * 0.7) continue;
      const c = lanePoint(road, lane, t),
        d = mul(tangent(road, t), laneDirection(road, lane)),
        n = normal(road, t),
        tip = add(c, mul(d, half)),
        wing = Math.min(0.75, half * 0.5);
      arrows.push({
        lane,
        t,
        path: [
          add(c, mul(d, -half)),
          tip,
          add(add(tip, mul(d, -half * 0.8)), mul(n, wing)),
          tip,
          add(add(tip, mul(d, -half * 0.8)), mul(n, -wing)),
        ],
      });
    }
  }
  return { edges, lanes, median, arrows };
}
