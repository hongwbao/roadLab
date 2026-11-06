/**
 * Traffic signal decisions recovered from the supplied Game.dll, CS2 1.6.0f1.
 * SHA256 721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee.
 * Sources: Game.Simulation.TrafficLightSystem.UpdateLaneSignal,
 * UpdateTrafficLightState, UpdateTrafficLightsJob.GetNextSignalGroup and
 * UpdateTrafficLightsJob.UpdateTrafficLightState. Entity IDs are browser IDs;
 * ECS lookups are passed as lane records. This module does not generate groups.
 */
export enum Cs2TrafficLightState {
  None,
  Beginning,
  Ongoing,
  Ending,
  Changing,
  Extending,
  Extended,
}
export enum Cs2LaneSignal {
  None,
  Stop,
  SafeStop,
  Yield,
  Go,
}
export const CS2_SIGNAL_CAN_EXTEND = 1;
export const CS2_SIGNAL_PHYSICAL = 2;
export const CS2_LEVEL_CROSSING = 1;
export const CS2_MOVEABLE_BRIDGE = 2;
// GetUpdateInterval() = 4; sixteen UpdateFrame groups, 60 simulation frames/s.
export const CS2_SIGNAL_TICK = 64 / 60;
const f = Math.fround;
export type Cs2SignalClock = {
  state: Cs2TrafficLightState;
  current: number;
  next: number;
  groupCount: number;
  timer: number;
  flags: number;
};
export type Cs2SignalLane = {
  groupMask: number;
  signal: Cs2LaneSignal;
  flags: number;
  priority: number;
  defaultPriority: number;
  petitioner: number | null;
  blocker: number | null;
};
export const cs2SignalBit = (group: number) =>
  group > 0 ? 1 << (group - 1) : 0;

/** Original lane-facing signal projection, including transition history. */
export function updateCs2LaneSignal(
  clock: Pick<Cs2SignalClock, "state" | "current" | "next">,
  lane: Pick<Cs2SignalLane, "groupMask" | "signal" | "flags">,
): Cs2LaneSignal {
  const current = !!(lane.groupMask & cs2SignalBit(clock.current));
  const next = !!(lane.groupMask & cs2SignalBit(clock.next));
  const extend = !!(lane.flags & CS2_SIGNAL_CAN_EXTEND);
  switch (clock.state) {
    case Cs2TrafficLightState.Beginning:
      return next
        ? lane.signal === Cs2LaneSignal.Go
          ? Cs2LaneSignal.Go
          : Cs2LaneSignal.Yield
        : Cs2LaneSignal.Stop;
    case Cs2TrafficLightState.Ongoing:
      return current ? Cs2LaneSignal.Go : Cs2LaneSignal.Stop;
    case Cs2TrafficLightState.Extending:
      if (extend) return current ? Cs2LaneSignal.Go : Cs2LaneSignal.Stop;
      if (lane.signal === Cs2LaneSignal.Go)
        return next ? Cs2LaneSignal.Go : Cs2LaneSignal.SafeStop;
      return Cs2LaneSignal.Stop;
    case Cs2TrafficLightState.Extended:
      return extend && current ? Cs2LaneSignal.Go : Cs2LaneSignal.Stop;
    case Cs2TrafficLightState.Ending:
      if (lane.signal === Cs2LaneSignal.Go)
        return next ? Cs2LaneSignal.Go : Cs2LaneSignal.SafeStop;
      return Cs2LaneSignal.Stop;
    case Cs2TrafficLightState.Changing:
      return lane.signal === Cs2LaneSignal.Go && next
        ? Cs2LaneSignal.Go
        : Cs2LaneSignal.Stop;
    default:
      return Cs2LaneSignal.None;
  }
}

/** Two packed light heads: vehicle low nibble, pedestrian high nibble. */
export function updateCs2SignalHeads(
  clock: Pick<Cs2SignalClock, "state" | "current" | "next" | "flags">,
  mask0: number,
  mask1: number,
  previous: number,
): number {
  const RED = 1,
    YELLOW = 2,
    GREEN = 4,
    FLASHING = 8;
  const current = cs2SignalBit(clock.current),
    next = cs2SignalBit(clock.next),
    crossing = !!(clock.flags & CS2_LEVEL_CROSSING),
    yellow = crossing ? YELLOW | FLASHING : YELLOW,
    red = crossing ? RED | FLASHING : RED;
  let vehicle = previous & 15,
    pedestrian = (previous >> 4) & 15;
  switch (clock.state) {
    case Cs2TrafficLightState.Beginning:
      if (mask0 & next) {
        if (vehicle !== GREEN) vehicle = red | yellow;
      } else vehicle = red;
      pedestrian = mask1 & next ? GREEN : RED;
      break;
    case Cs2TrafficLightState.Ongoing:
      vehicle = mask0 & current ? GREEN : red;
      pedestrian = mask1 & current ? GREEN : RED;
      break;
    case Cs2TrafficLightState.Extending:
      vehicle = mask0 & current ? GREEN : red;
      if (pedestrian === GREEN) {
        if (!(mask1 & next)) pedestrian = GREEN | FLASHING;
      } else pedestrian = RED;
      break;
    case Cs2TrafficLightState.Extended:
      vehicle = mask0 & current ? GREEN : red;
      if (pedestrian !== GREEN || !(mask1 & next)) pedestrian = RED;
      break;
    case Cs2TrafficLightState.Ending:
      if (vehicle === GREEN) {
        if (!(mask0 & next)) vehicle = yellow;
      } else vehicle = red;
      if (pedestrian === GREEN) {
        if (!(mask1 & next)) pedestrian = GREEN | FLASHING;
      } else pedestrian = RED;
      break;
    case Cs2TrafficLightState.Changing:
      if (vehicle !== GREEN || !(mask0 & next)) vehicle = red;
      if (pedestrian !== GREEN || !(mask1 & next)) pedestrian = RED;
      break;
    default:
      vehicle = 0;
      pedestrian = 0;
      break;
  }
  return vehicle | (pedestrian << 4);
}

/** Mutates petitioner/priority/blocker exactly as the original selection pass. */
export function selectCs2SignalGroup(
  clock: Pick<Cs2SignalClock, "current" | "groupCount" | "flags">,
  lanes: Cs2SignalLane[],
  preferChange: boolean,
): { group: number; canExtend: boolean } {
  let petitioner: number | null = null,
    blocker: number | null = null,
    priority = 0,
    mask = 0,
    extendMask = 0,
    negativeMask = 0;
  const maximum = clock.flags & CS2_MOVEABLE_BRIDGE ? 1 : 127;
  for (const lane of lanes) {
    const value = Math.min(lane.priority, maximum);
    const canExtend = lane.flags & CS2_SIGNAL_CAN_EXTEND ? lane.groupMask : 0;
    if (value > priority) {
      petitioner = lane.petitioner;
      priority = value;
      mask = lane.groupMask;
      extendMask = canExtend;
    } else if (value === priority) {
      mask |= lane.groupMask;
      extendMask |= canExtend;
    } else if (value < 0) negativeMask |= lane.groupMask;
    if (lane.blocker !== null) blocker = lane.blocker;
    lane.petitioner = null;
    lane.priority = lane.defaultPriority;
  }
  if (petitioner !== blocker)
    for (const lane of lanes)
      lane.blocker = lane.groupMask & mask ? null : petitioner;
  if (priority === 0) {
    preferChange = false;
    mask &= ~negativeMask;
  }
  const start = preferChange
      ? clock.current >= clock.groupCount
        ? 1
        : (clock.current + 1) & 255
      : Math.max(1, clock.current),
    end = preferChange ? clock.current : clock.current - 1;
  const canExtend =
    preferChange &&
    clock.current >= 1 &&
    !!(extendMask & cs2SignalBit(clock.current));
  for (let group = start; group <= clock.groupCount; group++)
    if (mask & cs2SignalBit(group)) return { group, canExtend };
  for (let group = 1; group <= end; group++)
    if (mask & cs2SignalBit(group)) return { group, canExtend };
  return { group: clock.current, canExtend };
}

const clearCs2Priorities = (lanes: Cs2SignalLane[]) => {
  for (const lane of lanes) {
    lane.petitioner = null;
    lane.priority = lane.defaultPriority;
  }
};
const requiresCs2Ending = (lanes: Cs2SignalLane[], next: number) =>
  lanes.some(
    (lane) =>
      lane.signal === Cs2LaneSignal.Go &&
      !(lane.groupMask & cs2SignalBit(next)),
  );

/**
 * One original controller tick. The caller supplies generated signal groups,
 * current lane petition priorities and movable-bridge clearance when relevant.
 * Returns whether lane/head projections need updating. Timers are source bytes.
 */
export function tickCs2TrafficLights(
  clock: Cs2SignalClock,
  lanes: Cs2SignalLane[],
  movingTime = 0,
  isEmpty: (next: number) => boolean = () => true,
): boolean {
  const increment = () => (clock.timer = (clock.timer + 1) & 255);
  const select = (prefer: boolean) =>
    selectCs2SignalGroup(clock, lanes, prefer);
  const reset = () => (clock.timer = 0);
  switch (clock.state) {
    case Cs2TrafficLightState.None:
      if (increment() >= 1) {
        clock.state = Cs2TrafficLightState.Beginning;
        clock.current = 0;
        clock.next = select(true).group;
        reset();
        return true;
      }
      break;
    case Cs2TrafficLightState.Beginning:
      if (increment() >= 1) {
        clock.state = Cs2TrafficLightState.Ongoing;
        clock.current = clock.next;
        clock.next = 0;
        reset();
        return true;
      }
      break;
    case Cs2TrafficLightState.Ongoing:
      if (increment() >= 2) {
        const maximum = movingTime
          ? Math.max(
              6,
              Math.min(
                255,
                Math.trunc(f(f(f(movingTime) * f(1.875)) + f(0.5))),
              ),
            )
          : 6;
        const next = select(clock.timer >= maximum);
        if (next.group !== clock.current) {
          clock.state = next.canExtend
            ? Cs2TrafficLightState.Extending
            : Cs2TrafficLightState.Ending;
          clock.next = next.group;
          reset();
          return true;
        }
        return false;
      }
      break;
    case Cs2TrafficLightState.Extending:
      if (increment() >= 2) {
        const next = select(true);
        if (next.group === clock.current) {
          clock.state = Cs2TrafficLightState.Beginning;
          clock.current = 0;
        } else
          clock.state = next.canExtend
            ? Cs2TrafficLightState.Extended
            : Cs2TrafficLightState.Ending;
        clock.next = next.group;
        reset();
        return true;
      }
      break;
    case Cs2TrafficLightState.Extended:
      if (increment() >= 2) {
        const next = select(true);
        if (next.group === clock.current) {
          clock.state = Cs2TrafficLightState.Beginning;
          clock.current = 0;
          clock.next = next.group;
          reset();
          return true;
        }
        if (clock.timer >= 4 || !next.canExtend) {
          clock.state = Cs2TrafficLightState.Ending;
          clock.next = next.group;
          reset();
          return true;
        }
        return false;
      }
      break;
    case Cs2TrafficLightState.Ending:
      if (increment() >= 2) {
        const next = select(true).group;
        if (clock.flags & CS2_MOVEABLE_BRIDGE && !isEmpty(next)) return false;
        if (next !== clock.next) {
          if (requiresCs2Ending(lanes, next)) clock.current = clock.next;
          else clock.state = Cs2TrafficLightState.Changing;
          clock.next = next;
        } else clock.state = Cs2TrafficLightState.Changing;
        reset();
        return true;
      }
      break;
    case Cs2TrafficLightState.Changing: {
      const minimum =
        movingTime && clock.current !== clock.next
          ? Math.max(
              1,
              Math.min(
                255,
                Math.trunc(f(f(f(movingTime) * f(0.9375)) + f(0.5))),
              ),
            )
          : 1;
      if (increment() >= minimum) {
        const next = select(true).group;
        if (next !== clock.next) {
          if (requiresCs2Ending(lanes, next)) {
            clock.current = clock.next;
            clock.state = Cs2TrafficLightState.Ending;
          } else if (!movingTime) clock.state = Cs2TrafficLightState.Beginning;
          else clock.current = clock.next;
          clock.next = next;
        } else clock.state = Cs2TrafficLightState.Beginning;
        reset();
        return true;
      }
      break;
    }
  }
  clearCs2Priorities(lanes);
  return false;
}
