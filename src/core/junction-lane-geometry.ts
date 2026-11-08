import { laneCount, laneWidth } from "./math";
import type { Road } from "./types";

/** Endpoint qualification follows only the road's true authored section. */
export function junctionLaneWidth(road: Road, lane: number, end: 0 | 1) {
  return laneWidth(road, lane, end);
}

export function isJunctionLane(road: Road, lane: number, end: 0 | 1) {
  return (
    Number.isInteger(lane) &&
    lane >= 0 &&
    lane < laneCount(road) &&
    junctionLaneWidth(road, lane, end) > road.width * 0.7
  );
}
