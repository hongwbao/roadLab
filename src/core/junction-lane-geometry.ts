import { laneCount, laneWidth } from "./math";
import type { Road } from "./types";

/** Derived collars change pavement geometry, not the endpoint's lane identity. */
export function junctionLaneWidth(road: Road, lane: number, end: 0 | 1) {
  return laneWidth(
    road.autoTaper ? { ...road, autoTaper: undefined } : road,
    lane,
    end,
  );
}

export function isJunctionLane(road: Road, lane: number, end: 0 | 1) {
  return (
    Number.isInteger(lane) &&
    lane >= 0 &&
    lane < laneCount(road) &&
    junctionLaneWidth(road, lane, end) > road.width * 0.7
  );
}

/**
 * Find the real usable start/end of a nominal lane which an automatic collar
 * pinches at the seam. The result is on the existing lane curve, never on an
 * invented full-width cross section. Consumers pass their actual width policy.
 */
export function physicalLaneEndpointT(
  road: Road,
  lane: number,
  end: 0 | 1,
  minimumWidthRatio = 0.8,
): number | undefined {
  if (!isJunctionLane(road, lane, end)) return;
  const usable = (t: number) =>
    laneWidth(road, lane, t) + 1e-7 >= road.width * minimumWidthRatio;
  if (usable(end)) return end;
  const collar = road.autoTaper?.[end === 0 ? "start" : "end"];
  if (!collar || !(collar.span > 0)) return;
  let outside: number = end,
    inside =
      end === 0 ? Math.min(1, collar.span) : Math.max(0, 1 - collar.span);
  if (!usable(inside)) return;
  for (let i = 0; i < 48; i++) {
    const mid = (outside + inside) / 2;
    if (usable(mid)) inside = mid;
    else outside = mid;
  }
  return inside;
}
