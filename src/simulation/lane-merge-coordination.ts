import { laneChangeGapClear } from "./early-lane-planning";
export type MergeOccupant = {
  id: number;
  s: number;
  speed: number;
  changing?: boolean;
};
export type MergeRequest = {
  id: number;
  position: number;
  speed: number;
  distance: number;
  target: string;
  corridor: readonly string[];
  /** Ordinary traffic balancing waits for a gap without creating speed caps. */
  mandatory?: boolean;
};
/** Negotiate a longitudinal slot upstream. The requester keeps its road route;
 * lower-priority followers in every intervening lane make room concurrently. */
export function coordinateLaneMerges(
  requests: readonly MergeRequest[],
  occupancy: ReadonlyMap<string, readonly MergeOccupant[]>,
) {
  const speedCaps = new Map<number, number>(),
    allowed = new Set<number>(),
    claims = new Map<string, MergeRequest[]>();
  const protectedIds = new Set(
    [...occupancy.values()].flatMap((rows) =>
      rows.filter((r) => r.changing).map((r) => r.id),
    ),
  );
  const cap = (id: number, speed: number) =>
    speedCaps.set(
      id,
      Math.min(speedCaps.get(id) ?? Infinity, Math.max(0, speed)),
    );
  const ordered = [...requests].sort(
    (a, b) =>
      a.distance / Math.max(3, a.speed) - b.distance / Math.max(3, b.speed) ||
      a.id - b.id,
  );
  for (const request of ordered) {
    protectedIds.add(request.id);
    if (request.mandatory === false) {
      const occupied = claims.get(request.target) ?? [];
      if (
        !occupied.some(
          (other) =>
            Math.abs(other.position - request.position) <
            Math.max(12, request.speed * 1.5, other.speed * 1.5),
        ) &&
        laneChangeGapClear(
          request.id,
          request.position,
          request.speed,
          occupancy.get(request.target) ?? [],
        )
      ) {
        allowed.add(request.id);
        occupied.push(request);
        claims.set(request.target, occupied);
      }
      continue;
    }
    for (const lane of request.corridor) {
      const rows = occupancy.get(lane) ?? [];
      // One closest follower and leader suffice; existing following propagates
      // the follower's speed adjustment to its own queue.
      let follower: MergeOccupant | undefined,
        leader: MergeOccupant | undefined;
      for (const row of rows) {
        if (row.id === request.id) continue;
        const gap = row.s - request.position;
        if (gap <= 3 && (!follower || row.s > follower.s)) follower = row;
        if (gap > 3 && (!leader || row.s < leader.s)) leader = row;
      }
      if (
        follower &&
        request.position - follower.s < Math.max(35, request.speed * 3)
      ) {
        if (!protectedIds.has(follower.id)) cap(follower.id, request.speed - 3);
        else if (follower.s > request.position - 6)
          cap(request.id, Math.max(2, follower.speed - 2.5));
      }
      if (
        leader &&
        leader.s - request.position < Math.max(6, request.speed * 1.1)
      )
        cap(request.id, Math.max(0, leader.speed - 1.8));
    }
    const occupied = claims.get(request.target) ?? [];
    const conflict = occupied.some(
      (other) =>
        Math.abs(other.position - request.position) <
        Math.max(12, request.speed * 1.5, other.speed * 1.5),
    );
    if (
      !conflict &&
      laneChangeGapClear(
        request.id,
        request.position,
        request.speed,
        occupancy.get(request.target) ?? [],
      )
    ) {
      allowed.add(request.id);
      occupied.push(request);
      claims.set(request.target, occupied);
    } else if (conflict) cap(request.id, Math.max(2, request.speed - 2.5));
  }
  return { allowed, speedCaps };
}
