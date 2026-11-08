import type { Cs2CompiledNetwork, Cs2NetworkPathGroup } from "./cs2-network";

export const DEFAULT_LANE_LOOKAHEAD = 500;
export const MIN_LANE_LOOKAHEAD = 100;
export const MAX_LANE_LOOKAHEAD = 2000;
export type EarlyLanePlan = {
  allowed: readonly string[];
  distanceAfterCurrent: number;
  /** Fixed-route lane-change costs after leaving the current physical piece. */
  costs?: ReadonlyMap<string, number>;
};
const length = (network: Cs2CompiledNetwork, group: Cs2NetworkPathGroup) =>
  network.lanes.get(group.laneIds[0])!.curve.length *
  Math.abs(group.interval[1] - group.interval[0]);

/** The frontier advances as the car drives; cached topology is valid only for
 * this frontier, not for the whole time spent on a long road. */
export function laneLookaheadEnd(
  network: Cs2CompiledNetwork,
  groups: readonly Cs2NetworkPathGroup[],
  index: number,
  remaining: number,
  lookahead = DEFAULT_LANE_LOOKAHEAD,
) {
  let distance = Math.max(0, remaining),
    end = index;
  for (
    let i = index + 1;
    i < groups.length && distance <= lookahead + 1e-6;
    i++
  ) {
    end = i;
    distance += length(network, groups[i]);
  }
  return end;
}

/** Backward dynamic programming over the immutable road route. Successors are
 * the actual rule-filtered physical connections, including custom lane links.
 * Future road pieces permit adjacent moves; connectors never permit them. */
export function buildEarlyLanePlan(
  network: Cs2CompiledNetwork,
  groups: readonly Cs2NetworkPathGroup[],
  index: number,
  end = laneLookaheadEnd(network, groups, index, 0),
): EarlyLanePlan | null {
  if (end <= index || !groups[index]) return null;
  let costs = new Map(groups[end].laneIds.map((id) => [id, 0]));
  let restrictionDistance = Infinity,
    distance = 0;
  for (let i = index; i < end; i++) {
    if (i > index) distance += length(network, groups[i]);
    const next = new Set(groups[i + 1].laneIds);
    if (
      groups[i].laneIds.some(
        (id) => !(network.successors.get(id) ?? []).some((to) => next.has(to)),
      )
    )
      restrictionDistance = Math.min(restrictionDistance, distance);
  }
  for (let i = end - 1; i >= index; i--) {
    const exit = new Map(
      groups[i].laneIds.map((id) => [
        id,
        Math.min(
          Infinity,
          ...(network.successors.get(id) ?? []).map(
            (to) => costs.get(to) ?? Infinity,
          ),
        ),
      ]),
    );
    if (i === index) {
      costs = exit;
      break;
    }
    const group = network.groups.get(groups[i].group)!;
    costs = group.allowChange
      ? new Map(
          groups[i].laneIds.map((id, a) => [
            id,
            Math.min(
              ...groups[i].laneIds.map(
                (to, b) => (exit.get(to) ?? Infinity) + Math.abs(a - b),
              ),
            ),
          ]),
        )
      : exit;
  }
  const best = Math.min(...costs.values());
  const allowed = [...costs]
    .filter(([, cost]) => cost === best && Number.isFinite(cost))
    .map(([id]) => id);
  if (allowed.length === groups[index].laneIds.length) return null;
  return {
    allowed,
    costs,
    distanceAfterCurrent: Number.isFinite(restrictionDistance)
      ? restrictionDistance
      : 0,
  };
}

/** Start when a route constraint enters the configured window, independent of
 * current speed. An individual request is always one physical neighbour. */
export function chooseEarlyLane(
  plan: EarlyLanePlan | null,
  members: readonly string[],
  current: string,
  remaining: number,
  _speed: number,
  lookahead = DEFAULT_LANE_LOOKAHEAD,
): string | null {
  if (!plan || remaining + plan.distanceAfterCurrent > lookahead + 1e-6)
    return null;
  const from = members.indexOf(current);
  if (from < 0) return null;
  const targets = plan.allowed
    .map((id) => members.indexOf(id))
    .filter((i) => i >= 0)
    .sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b);
  if (!targets.length) return current;
  return members[from + Math.sign(targets[0] - from)];
}

export function laneChangeGapClear(
  self: number,
  position: number,
  speed: number,
  occupants: readonly { id: number; s: number; speed: number }[],
) {
  return occupants.every((other) => {
    if (other.id === self) return true;
    const gap = other.s - position;
    return gap >= 0
      ? gap >= Math.max(6, speed * 1.1)
      : -gap >= Math.max(6, other.speed * 1.3);
  });
}

/** A last safety boundary is upstream of the connector, not a planned stop at
 * its stop line. Normal free-flow changes have no preparation speed penalty. */
export function earlyLaneSpeedLimit(
  plan: EarlyLanePlan | null,
  members: readonly string[],
  current: string,
  remaining: number,
  changing: boolean,
) {
  if (!plan || (plan.allowed.includes(current) && !changing)) return Infinity;
  const from = members.indexOf(current),
    targets = plan.allowed
      .map((id) => members.indexOf(id))
      .filter((i) => i >= 0);
  const steps = targets.length
    ? Math.max(1, Math.min(...targets.map((i) => Math.abs(i - from))))
    : 1;
  const distance = Math.max(0, remaining + plan.distanceAfterCurrent),
    hold = Math.min(60, Math.max(25, steps * 12));
  if (distance > hold + 30) return Infinity;
  const cap = Math.sqrt(4 * Math.max(0, distance - hold));
  // Let an already started move finish even inside the last eight metres.
  // The connected queue separately prevents an unaligned connector entry.
  return changing ? Math.max(2, cap) : cap;
}
