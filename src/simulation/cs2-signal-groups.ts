/** TrafficLightInitializationSystem's normal-node group construction.
 * Inputs decode Unity master/slave lane ranges into movement/member IDs.
 * Bridge mechanisms and actual vehicle yielding are separate systems.
 */
export type Cs2SignalDirection = { x: number; z: number };
export type Cs2SignalLane = {
  id: string;
  /** Master lane members, if the caller has already decoded a master range. */
  members?: readonly string[];
  /** Start tangent in travel direction. */
  startDirection: Cs2SignalDirection;
  /** NEGATIVE end tangent, pointing back into the movement. */
  endDirection: Cs2SignalDirection;
  /** Derived from lane flags, including gentle/U-turn flags, not angle alone. */
  straight: boolean;
  unsafe?: boolean;
  track?: boolean;
  waterway?: boolean;
  pedestrian?: boolean;
  car?: boolean;
  secondary?: boolean;
  hasSignal?: boolean;
};
export type Cs2InitializedLaneSignal = {
  groupMask: number;
  defaultPriority: number;
  canExtend: boolean;
};
export type Cs2SignalGroupResult = {
  groupCount: number;
  groups: {
    index: number;
    signalGroup: number;
    mask: number;
    lanes: string[];
  }[];
  laneSignals: ReadonlyMap<string, Cs2InitializedLaneSignal>;
};
type SourceGroup = {
  lane: Cs2SignalLane;
  index: number;
  mask: number;
  combined: boolean;
};
const f = Math.fround;
const SAME_DIRECTION = f(0.999);
const dot = (a: Cs2SignalDirection, b: Cs2SignalDirection) =>
  f(f(a.x * b.x) + f(a.z * b.z));

export function normalizeCs2SignalDirection(
  direction: Cs2SignalDirection,
): Cs2SignalDirection {
  const squared = dot(direction, direction);
  if (!(squared > 1.17549435e-38)) return { x: 0, z: 0 };
  const inverse = f(1 / f(Math.sqrt(squared)));
  return { x: f(direction.x * inverse), z: f(direction.z * inverse) };
}

function removeAtSwapBack<T>(values: T[], index: number): T {
  const value = values[index];
  const last = values.pop()!;
  if (index < values.length) values[index] = last;
  return value;
}

function memberIds(lane: Cs2SignalLane) {
  return [...new Set([lane.id, ...(lane.members ?? [])])];
}

function vehicleGroups(lanes: SourceGroup[], levelCrossing: boolean) {
  const groups: SourceGroup[] = [];
  let count = 0;
  while (lanes.length) {
    const seed = removeAtSwapBack(lanes, 0);
    seed.index = count++;
    groups.push(seed);
    let i = 0;
    while (i < lanes.length) {
      const lane = lanes[i];
      if (
        (!levelCrossing || !!seed.lane.track === !!lane.lane.track) &&
        dot(seed.lane.startDirection, lane.lane.startDirection) > SAME_DIRECTION
      ) {
        lane.index = seed.index;
        groups.push(removeAtSwapBack(lanes, i));
      } else i++;
    }
  }
  let i = 0;
  count = 0;
  while (i < groups.length) {
    const seed = groups[i++];
    if (!seed.combined) count = seed.index + 1;
    let start = { x: 0, z: 0 },
      end = { x: 0, z: 0 },
      bestDot = 1;
    if (seed.lane.straight && !seed.combined) {
      start = seed.lane.startDirection;
      end = seed.lane.endDirection;
      bestDot = dot(start, end);
    }
    for (; i < groups.length; i++) {
      const lane = groups[i];
      if (lane.index !== seed.index) break;
      if (lane.lane.straight && !lane.combined) {
        const straightness = dot(
          lane.lane.startDirection,
          lane.lane.endDirection,
        );
        if (straightness < bestDot) {
          start = lane.lane.startDirection;
          end = lane.lane.endDirection;
          bestDot = straightness;
        }
      }
    }
    if (bestDot >= 0) continue;
    let scan = i;
    while (scan < groups.length) {
      const first = scan;
      let last = scan;
      const other = groups[scan++];
      const compatible = (candidate: SourceGroup) =>
        !candidate.combined &&
        (levelCrossing
          ? !!seed.lane.track === !!candidate.lane.track
          : candidate.lane.straight &&
            dot(start, candidate.lane.endDirection) > SAME_DIRECTION &&
            dot(end, candidate.lane.startDirection) > SAME_DIRECTION);
      let combine = compatible(other);
      while (scan < groups.length) {
        const candidate = groups[scan];
        if (candidate.index !== other.index) break;
        combine ||= compatible(candidate);
        last = scan++;
      }
      if (!combine) continue;
      for (let j = first; j <= last; j++) {
        groups[j].index = seed.index;
        groups[j].combined = true;
      }
      for (let j = last + 1; j < groups.length; j++)
        if (!groups[j].combined) groups[j].index--;
    }
  }
  for (const group of groups) group.mask = (1 << (group.index & 15)) & 0xffff;
  return { groups, count };
}

/** Regular car/track nodes and pedestrian phase assignment, preserving the
 * source's source-list order and swap-back grouping. No conflict-free promise:
 * permissive left turns share the opposing group and must still yield.
 */
export function buildCs2SignalGroups(
  lanes: readonly Cs2SignalLane[],
  options: {
    levelCrossing?: boolean;
    /** Actual LaneOverlap-like membership, keyed by pedestrian lane ID. */
    overlaps?: ReadonlyMap<string, ReadonlySet<string>>;
  } = {},
): Cs2SignalGroupResult {
  const levelCrossing = options.levelCrossing ?? false;
  const valid = lanes
    .filter((lane) => lane.hasSignal !== false && !lane.secondary)
    .map((lane) => ({
      lane: {
        ...lane,
        startDirection: normalizeCs2SignalDirection(lane.startDirection),
        endDirection: normalizeCs2SignalDirection(lane.endDirection),
      },
      index: 0,
      mask: 0,
      combined: false,
    }));
  const vehicles = valid.filter((group) => !group.lane.pedestrian);
  const pedestrians = valid.filter((group) => group.lane.pedestrian);
  const result = vehicleGroups(vehicles, levelCrossing);
  const groups = result.groups;
  let groupCount = result.count;
  if (groupCount <= 1) {
    // The source increments even when the pedestrian list is empty.
    const index = groupCount++;
    for (const group of pedestrians) {
      group.mask = (1 << (index & 15)) & 0xffff;
      groups.push(group);
    }
  } else {
    const vehicleCount = groups.length;
    let pedestrianOnlyIndex = -1;
    for (const pedestrian of pedestrians) {
      pedestrian.mask = ((1 << Math.min(16, groupCount)) - 1) & 0xffff;
      const overlaps = options.overlaps?.get(pedestrian.lane.id);
      if (!pedestrian.lane.unsafe && overlaps)
        for (let i = 0; i < vehicleCount; i++) {
          const vehicle = groups[i];
          let ignoreOverlap: boolean;
          if (levelCrossing) ignoreOverlap = !vehicle.lane.track;
          else {
            ignoreOverlap = !vehicle.lane.straight;
            if (ignoreOverlap) {
              const xx = Math.abs(
                dot(
                  pedestrian.lane.startDirection,
                  vehicle.lane.startDirection,
                ),
              );
              const xy = Math.abs(
                dot(pedestrian.lane.startDirection, vehicle.lane.endDirection),
              );
              const zx = Math.abs(
                dot(pedestrian.lane.endDirection, vehicle.lane.startDirection),
              );
              const zy = Math.abs(
                dot(pedestrian.lane.endDirection, vehicle.lane.endDirection),
              );
              ignoreOverlap = f(xx + zx) > f(xy + zy);
            }
          }
          if (
            !ignoreOverlap &&
            memberIds(vehicle.lane).some((id) => overlaps.has(id))
          )
            pedestrian.mask &= ~vehicle.mask & 0xffff;
        }
      if (pedestrian.mask === 0) {
        if (pedestrianOnlyIndex === -1) pedestrianOnlyIndex = groupCount++;
        pedestrian.mask = (1 << (pedestrianOnlyIndex & 15)) & 0xffff;
      }
      groups.push(pedestrian);
    }
  }
  const laneSignals = new Map<string, Cs2InitializedLaneSignal>();
  for (const group of groups) {
    const lane = group.lane;
    const car = lane.car ?? (!lane.pedestrian && !lane.track && !lane.waterway);
    const signal = {
      groupMask: group.mask,
      defaultPriority:
        levelCrossing && (lane.track || (lane.waterway && !lane.pedestrian))
          ? -1
          : 0,
      canExtend: !levelCrossing && car,
    };
    for (const id of memberIds(lane)) laneSignals.set(id, { ...signal });
  }
  const count = Math.min(16, groupCount);
  return {
    groupCount: count,
    groups: Array.from({ length: count }, (_, index) => {
      const mask = 1 << index;
      return {
        index,
        signalGroup: index + 1,
        mask,
        lanes: [...laneSignals]
          .filter(([, signal]) => (signal.groupMask & mask) !== 0)
          .map(([id]) => id),
      };
    }),
    laneSignals,
  };
}
