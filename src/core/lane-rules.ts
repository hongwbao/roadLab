import {
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  mul,
  tangent,
  dist,
} from "./math";
import type { LaneAttachment, Road, Turn, V } from "./types";

export const TURNS: Turn[] = ["left", "straight", "right"];
export const turnOf = (from: V, to: V): Turn => {
  if (from.x * to.x + from.z * to.z > 0.85) return "straight";
  return from.x * to.z - from.z * to.x > 0 ? "right" : "left";
};
export function allowedTurns(road: Road, lane: number): Turn[] {
  return road.turns?.[lane] ?? TURNS;
}
export function laneNumber(
  road: Road,
  lane: number,
  at = laneDirection(road, lane) === 1 ? 1 : 0,
) {
  const lanes = Array.from({ length: laneCount(road) }, (_, i) => i)
    .filter(
      (i) =>
        laneDirection(road, i) === laneDirection(road, lane) &&
        laneWidth(road, i, at) > road.width * 0.7,
    )
    .sort((a, b) => (a - b) * laneDirection(road, lane));
  return lanes.indexOf(lane) + 1;
}
export function endpointLaneGroups(
  reference: Road,
  end: number,
  proposed: Road,
  ownEnd: 0 | 1,
) {
  if (proposed.twoWay) return [];
  const ownLanes = Array.from(
    { length: laneCount(proposed) },
    (_, i) => i,
  ).filter((i) => laneWidth(proposed, i, ownEnd) > proposed.width * 0.7);
  const direction = ownEnd === 0 ? (end === 1 ? 1 : -1) : end === 0 ? 1 : -1;
  const lanes = Array.from({ length: laneCount(reference) }, (_, i) => i)
    .filter(
      (i) =>
        laneDirection(reference, i) === direction &&
        laneWidth(reference, i, end) > reference.width * 0.7,
    )
    .sort((a, b) => (a - b) * direction);
  const groups: { lanes: number[]; ownLanes: number[] }[] = [];
  for (let i = 0; ownLanes.length && i + ownLanes.length <= lanes.length; i++)
    groups.push({ lanes: lanes.slice(i, i + ownLanes.length), ownLanes });
  return groups;
}
export function attachmentAt(road: Road, end: number) {
  return road.attachments?.[end === 0 ? "start" : "end"];
}
export function attachmentAllows(
  attachment: LaneAttachment | undefined,
  ownLane: number,
  other: Road,
  otherEnd: number,
  otherLane: number,
) {
  if (!attachment) return true;
  const index = attachment.ownLanes.indexOf(ownLane);
  return (
    attachment.road === other.id &&
    attachment.end === otherEnd &&
    index >= 0 &&
    attachment.lanes[index] === otherLane
  );
}
export function attachLanes(
  road: Road,
  ownEnd: 0 | 1,
  reference: Road,
  end: number,
  lanes: number[],
  ownLanes: number[],
) {
  if (!lanes.length || lanes.length !== ownLanes.length)
    throw new Error("连接车道数量不一致。");
  const direction = mul(
    tangent(reference, end),
    laneDirection(reference, lanes[0]),
  );
  const old = ownEnd === 0 ? road.knots[0] : road.knots.at(-1)!;
  const handle = Math.max(
    3,
    dist(old.p, ownEnd === 0 ? old.outgoing : old.incoming),
  );
  old[ownEnd === 0 ? "outgoing" : "incoming"] = {
    x: old.p.x + direction.x * handle * (ownEnd === 0 ? 1 : -1),
    y: old.p.y + direction.y * handle * (ownEnd === 0 ? 1 : -1),
    z: old.p.z + direction.z * handle * (ownEnd === 0 ? 1 : -1),
  };
  const target = lanePoint(reference, lanes[0], end),
    current = lanePoint(road, ownLanes[0], ownEnd);
  const delta = {
    x: target.x - current.x,
    y: target.y - current.y,
    z: target.z - current.z,
  };
  for (const key of ["p", "incoming", "outgoing"] as const)
    old[key] = {
      x: old[key].x + delta.x,
      y: old[key].y + delta.y,
      z: old[key].z + delta.z,
    };
  if (end === 0 || end === 1) {
    road.attachments ??= {};
    road.attachments[ownEnd === 0 ? "start" : "end"] = {
      road: reference.id,
      end,
      lanes: [...lanes],
      ownLanes: [...ownLanes],
    };
  }
}
