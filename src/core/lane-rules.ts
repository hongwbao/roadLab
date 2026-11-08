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
  const groups: { lanes: number[]; ownLanes: number[] }[] = [];
  const flowEnd = end === 0 || end === 1 ? end : ownEnd === 0 ? 1 : 0;
  for (const ownDirection of [1, -1] as const) {
    const direction = ownDirection * (ownEnd === flowEnd ? -1 : 1),
      ownLanes = Array.from({ length: laneCount(proposed) }, (_, i) => i)
        .filter(
          (i) =>
            laneDirection(proposed, i) === ownDirection &&
            laneWidth(proposed, i, ownEnd) > proposed.width * 0.7,
        )
        .sort((a, b) => (a - b) * ownDirection),
      lanes = Array.from({ length: laneCount(reference) }, (_, i) => i)
        .filter(
          (i) =>
            laneDirection(reference, i) === direction &&
            laneWidth(reference, i, end) > reference.width * 0.7,
        )
        .sort((a, b) => (a - b) * direction),
      count = Math.min(ownLanes.length, lanes.length);
    // Both a narrower branch and a wider continuation can select the actual
    // overlapping lane group. Sorting each group in traffic order also pairs
    // opposite-index sections correctly when both roads meet at their start.
    for (let i = 0; count && i + count <= lanes.length; i++)
      for (let j = 0; j + count <= ownLanes.length; j++)
        groups.push({
          lanes: lanes.slice(i, i + count),
          ownLanes: ownLanes.slice(j, j + count),
        });
  }
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
  if (attachment.road !== other.id || attachment.end !== otherEnd) return false;
  const index = attachment.ownLanes.indexOf(ownLane);
  if (index >= 0) return attachment.lanes[index] === otherLane;
  // A saved group constrains its traffic direction, not the unselected return
  // carriageway. Callers already require one entry and one exit at these ends;
  // an unmapped lane of a one-way ramp therefore gets no same-direction escape.
  return !attachment.lanes.some(
    (lane) => laneDirection(other, lane) === laneDirection(other, otherLane),
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
  const flowEnd = end === 0 || end === 1 ? end : ownEnd === 0 ? 1 : 0;
  if (
    new Set(lanes).size !== lanes.length ||
    new Set(ownLanes).size !== ownLanes.length ||
    lanes.some(
      (lane, i) =>
        !Number.isInteger(lane) ||
        lane < 0 ||
        lane >= laneCount(reference) ||
        !Number.isInteger(ownLanes[i]) ||
        ownLanes[i] < 0 ||
        ownLanes[i] >= laneCount(road) ||
        laneWidth(reference, lane, end) <= reference.width * 0.7 ||
        laneWidth(road, ownLanes[i], ownEnd) <= road.width * 0.7 ||
        laneDirection(reference, lane) !==
          laneDirection(road, ownLanes[i]) * (ownEnd === flowEnd ? -1 : 1),
    )
  )
    throw new Error("吸附车道必须在相接端点具有一致的合法行驶方向。");
  const direction = mul(
    tangent(reference, end),
    laneDirection(reference, lanes[0]) * laneDirection(road, ownLanes[0]),
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
    const mappedLanes = [...lanes],
      mappedOwnLanes = [...ownLanes];
    // Preserve every exactly aligned return lane as well. If an asymmetric
    // section or divider leaves that direction offset, leave it unrepresented
    // so normal legal geometric connections can still be discovered there.
    for (const ownDirection of [1, -1] as const) {
      if (ownLanes.some((lane) => laneDirection(road, lane) === ownDirection))
        continue;
      const own = Array.from({ length: laneCount(road) }, (_, i) => i).filter(
          (lane) =>
            laneDirection(road, lane) === ownDirection &&
            laneWidth(road, lane, ownEnd) > road.width * 0.7,
        ),
        available = Array.from(
          { length: laneCount(reference) },
          (_, i) => i,
        ).filter(
          (lane) =>
            laneDirection(reference, lane) ===
              ownDirection * (ownEnd === end ? -1 : 1) &&
            laneWidth(reference, lane, end) > reference.width * 0.7,
        ),
        paired = own.map((lane) =>
          available.find(
            (other) =>
              dist(
                lanePoint(road, lane, ownEnd),
                lanePoint(reference, other, end),
              ) < 1e-6,
          ),
        );
      if (
        paired.every((lane) => lane !== undefined) &&
        new Set(paired).size === paired.length
      ) {
        mappedOwnLanes.push(...own);
        mappedLanes.push(...(paired as number[]));
      }
    }
    road.attachments ??= {};
    road.attachments[ownEnd === 0 ? "start" : "end"] = {
      road: reference.id,
      end,
      lanes: mappedLanes,
      ownLanes: mappedOwnLanes,
    };
  }
}
