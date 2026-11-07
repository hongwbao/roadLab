import {
  arcTable,
  arcParameter,
  backwardLaneCount,
  boundaryPoint,
  dist,
  medianWidth,
  mul,
  nodePoint,
  tangent,
} from "./math";
import type { Junction } from "./junctions";
import type { Project, Road } from "./types";

export function withRoadMedian(road: Road, width: number | null): Road {
  const next = structuredClone(road);
  if (width === null) {
    delete next.median;
    return next;
  }
  if (!road.twoWay)
    throw new Error("中央隔离带适用于双向道路，请选择双向路段。");
  if (!Number.isFinite(width) || width < 0.5 || width > 6)
    throw new Error("隔离带宽度须为0.5–6米。");
  next.median = { kind: "concrete", width };
  return next;
}
export function setRoadMedian(
  project: Project,
  id: string,
  width: number | null,
) {
  const index = project.roads.findIndex((r) => r.id === id);
  if (index < 0) throw new Error("道路已不存在。");
  project.roads[index] = withRoadMedian(project.roads[index], width);
}
export function roadMedianRange(
  project: Pick<Project, "roads">,
  road: Road,
  junctions: readonly Junction[],
) {
  const table = arcTable(road),
    length = table.at(-1)!.s;
  const ends = ([0, 1] as const).map((end) => {
    const arm = junctions
      .flatMap((j) => j.arms)
      .find((a) => a.road === road.id && a.end === end);
    if (arm)
      return {
        distance: Math.max(
          arm.trim + 1,
          (arm.crosswalkDistance ?? arm.trim) + 2.3,
        ),
        nose: true,
      };
    const position = nodePoint(road, end),
      out = mul(tangent(road, end), end === 0 ? 1 : -1);
    const continuous = project.roads.some(
      (other) =>
        other.id !== road.id &&
        ([0, 1] as const).some((at) => {
          const d = mul(tangent(other, at), at === 0 ? 1 : -1);
          return (
            dist(nodePoint(other, at), position) < 0.65 &&
            Math.abs(medianWidth(other, at) - medianWidth(road, end)) < 0.01 &&
            out.x * d.x + out.z * d.z < -0.94 &&
            dist(
              boundaryPoint(road, backwardLaneCount(road), end),
              boundaryPoint(other, backwardLaneCount(other), at),
            ) < 0.1
          );
        }),
    );
    return { distance: continuous ? 0 : 1.5, nose: !continuous };
  });
  const start = arcParameter(table, ends[0].distance),
    end = arcParameter(table, length - ends[1].distance);
  return start < end
    ? {
        start,
        end,
        startDistance: ends[0].distance,
        endDistance: length - ends[1].distance,
        noseStart: ends[0].nose,
        noseEnd: ends[1].nose,
      }
    : undefined;
}
