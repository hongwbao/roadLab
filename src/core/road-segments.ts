import { arcParameter, arcTable, center } from "./math";
import { splitRoad } from "./model";
import type { Project, Road } from "./types";

export const MAX_ROAD_SEGMENT_LENGTH = 120;

export function roadSegmentCuts(
  road: Road,
  maxLength = MAX_ROAD_SEGMENT_LENGTH,
) {
  if (!Number.isFinite(maxLength) || maxLength <= 0)
    throw new Error("自动分段长度必须是正数。");
  const arc = arcTable(road),
    length = arc.at(-1)!.s;
  const count = Math.max(1, Math.ceil((length - 1e-6) / maxLength));
  if (!Number.isFinite(count) || count > 1000)
    throw new Error("道路过长或路段过多，请缩短本次建造距离。");
  return Array.from({ length: count - 1 }, (_, i) =>
    arcParameter(arc, (length * (i + 1)) / count),
  );
}

export function segmentRoads(
  project: Project,
  ids: ReadonlySet<string>,
  maxLength = MAX_ROAD_SEGMENT_LENGTH,
) {
  const result = new Map<string, string[]>();
  const plans = project.roads
    .filter((road) => ids.has(road.id))
    .map((road) => ({ road, cuts: roadSegmentCuts(road, maxLength) }));
  if (
    project.roads.length +
      plans.reduce((total, p) => total + p.cuts.length, 0) >
    1000
  )
    throw new Error("道路过长或路段过多，请缩短本次建造距离。");
  for (const { road, cuts } of plans) {
    const boundaries = [0, ...cuts, 1];
    // Split near the middle first: repeated cuts from the beginning can fall
    // below splitRoad's 2.5% endpoint guard on very long roads.
    const divide = (id: string, first: number, last: number): string[] => {
      if (last - first <= 1) return [id];
      const middle = Math.floor((first + last) / 2);
      const t =
        (boundaries[middle] - boundaries[first]) /
        (boundaries[last] - boundaries[first]);
      const next = splitRoad(project, id, t);
      if (!next) throw new Error("道路自动分段失败，请调整建造长度。");
      return [...divide(id, first, middle), ...divide(next, middle, last)];
    };
    result.set(road.id, divide(road.id, 0, boundaries.length - 1));
  }
  return result;
}

export function roadSegmentNodes(road: Road) {
  // Reject an over-budget road at commit time, without throwing through the
  // render loop or allocating thousands of preview markers.
  try {
    return roadSegmentCuts(road).map((t) => center(road, t));
  } catch {
    return [];
  }
}
