import type { Cs2CompiledNetwork, Cs2NetworkPathGroup } from "./cs2-network";

export type EarlyLanePlan = {
  allowed: readonly string[];
  distanceAfterCurrent: number;
};

/** Follow the chosen route to its first restricted exit, then propagate the
 * legal physical lanes back through continuous pieces and straight links. */
export function buildEarlyLanePlan(
  network: Cs2CompiledNetwork,
  groups: readonly Cs2NetworkPathGroup[],
  index: number,
): EarlyLanePlan | null {
  let distance = 0;
  for (let end = index + 1; end < groups.length && distance <= 600; end++) {
    const group = groups[end],
      lane = network.lanes.get(group.laneIds[0]);
    if (!lane) return null;
    if (lane.kind === "connection") {
      const next = new Set(group.laneIds),
        previous = groups[end - 1];
      const usable = previous.laneIds.filter((id) =>
        (network.successors.get(id) ?? []).some((to) => next.has(to)),
      );
      if (usable.length && usable.length < previous.laneIds.length) {
        let allowed = new Set(group.laneIds);
        for (let step = end - 1; step >= index; step--) {
          allowed = new Set(
            groups[step].laneIds.filter((id) =>
              (network.successors.get(id) ?? []).some((to) => allowed.has(to)),
            ),
          );
          if (!allowed.size) return null;
        }
        return { allowed: [...allowed], distanceAfterCurrent: distance };
      }
    }
    distance +=
      lane.curve.length * Math.abs(group.interval[1] - group.interval[0]);
  }
  return null;
}

/** An active plan either keeps the legal lane or requests one adjacent step.
 * Each additional lane earns five seconds and at least45m of preparation. */
export function chooseEarlyLane(
  plan: EarlyLanePlan | null,
  members: readonly string[],
  current: string,
  remaining: number,
  speed: number,
): string | null {
  if (!plan) return null;
  const from = members.indexOf(current);
  if (from < 0) return null;
  const targets = plan.allowed
    .map((id) => members.indexOf(id))
    .filter((i) => i >= 0)
    .sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b);
  if (!targets.length) return null;
  const steps = Math.abs(targets[0] - from),
    lead = Math.min(
      600,
      Math.max(90, speed * (steps ? 4 + 5 * steps : 15), steps * 45),
    );
  if (remaining + plan.distanceAfterCurrent > lead) return null;
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
