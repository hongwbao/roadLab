/** Source-derived scalar routing and navigation costs. All speeds are m/s.
 * The component/road adapter supplies topology and prefab values explicitly;
 * these helpers do not pretend RoadLab has Unity's complete entity graph.
 */
export type Cs2CostVector = readonly [
  time: number,
  behaviour: number,
  money: number,
  comfort: number,
];

/** CarPathfind field initializers, not values recovered from serialized assets. */
export const CS2_DEFAULT_CAR_PATH_COSTS = {
  driving: [0, 0, 0.01, 0],
  turning: [0, 0, 0, 1],
  uTurn: [0, 0, 0, 10],
  unsafeUTurn: [0, 50, 0, 10],
  curveAngle: [2, 0, 0, 3],
  laneCross: [0, 0, 0, 2],
  parking: [10, 0, 0, 0],
  spawn: [5, 0, 0, 0],
  forbidden: [10, 100, 20, 50],
} as const satisfies Record<string, Cs2CostVector>;

/** PersonalCarAISystem's actual fallback without a resolved citizen. */
export const CS2_FALLBACK_PATH_WEIGHTS: Cs2CostVector = [1, 1, 1, 1];
export const CS2_NORMAL_VEHICLE_PRIORITY = 100;

/** CitizenUtils.GetPathfindWeights; comfortRandom is the actual random sample
 * from Citizen.GetPseudoRandom(TrafficComfort), not a new RNG consumption.
 */
export function cs2CitizenPathfindWeights(input: {
  leisureCounter: number;
  householdCitizens: number;
  consumptionPerDay: number;
  comfortRandom: number;
  movedIn: boolean;
  movingAwayTouristOrCommuter?: boolean;
}): Cs2CostVector {
  const time = f(5 * f(4 - f(f(f(3.75) * input.leisureCounter) / 255)));
  let money = f(
    f(2500 * Math.max(1, input.householdCitizens)) /
      Math.max(250, input.consumptionPerDay),
  );
  if (!input.movedIn && !input.movingAwayTouristOrCommuter)
    money = f(money * f(0.1));
  return [time, 2, money, f(1 + f(2 * input.comfortRandom))];
}

/** Road-only branch of PathUtils.GetCarDriveSpecification's cost vector.
 * The adapter supplies tangent angle and component flags; no guessed seconds
 * per lane-change or left/right turn penalty are introduced here.
 */
export function cs2CarDriveCosts(
  input: {
    length: number;
    curveAngle?: number;
    laneCrossCount?: number;
    approach?: boolean;
    turning?: boolean;
    uTurn?: boolean;
    unsafe?: boolean;
    highway?: boolean;
    forbidden?: boolean;
  },
  coefficients: Readonly<
    Record<keyof typeof CS2_DEFAULT_CAR_PATH_COSTS, Cs2CostVector>
  > = CS2_DEFAULT_CAR_PATH_COSTS,
): Cs2CostVector {
  const cost: [number, number, number, number] = [0, 0, 0, 0];
  const add = (vector: Cs2CostVector, factor = 1) => {
    for (let i = 0; i < 4; i++)
      cost[i] = f(cost[i] + f(f(vector[i]) * f(factor)));
  };
  add(coefficients.driving, input.length);
  add(coefficients.curveAngle, input.curveAngle ?? 0);
  add(coefficients.laneCross, input.laneCrossCount ?? 0);
  if (!input.approach) {
    if (input.forbidden || (input.unsafe && input.highway && input.uTurn))
      add(coefficients.forbidden);
    if (input.turning) add(coefficients.turning);
    if (input.uTurn)
      add(input.unsafe ? coefficients.unsafeUTurn : coefficients.uTurn);
  }
  return cost;
}

export type Cs2FlowBuckets = {
  duration: Cs2CostVector;
  distance: Cs2CostVector;
};

/** CarNavigationSystem.ApplySideEffects normalizes both quantities by length;
 * duration is weighted by the capped free driving speed, not raw seconds.
 */
export function cs2LaneFlowSample(input: {
  duration: number;
  distance: number;
  laneLength: number;
  maxDriveSpeed: number;
}): readonly [duration: number, distance: number] {
  const scale = f(1 / Math.max(1, input.laneLength));
  return [
    f(f(input.duration * input.maxDriveSpeed) * scale),
    f(input.distance * scale),
  ];
}

/** TrafficFlowSystem.OnUpdate's four time-of-day triangular weights. */
export function cs2TrafficTimeFactors(normalizedTime: number): Cs2CostVector {
  const n = f(normalizedTime * 4);
  const saturate = (x: number) => f(Math.min(1, Math.max(0, x)));
  return [
    saturate(Math.max(f(n - 3), f(1 - n))),
    saturate(f(1 - Math.abs(f(n - 1)))),
    saturate(f(1 - Math.abs(f(n - 2)))),
    saturate(f(1 - Math.abs(f(n - 3)))),
  ];
}

/** UpdateLaneFlowJob lerps each bucket toward the accumulated next sample.
 * Call at the SOURCE scheduler interval; this does not choose its own period.
 */
export function cs2UpdateLaneFlow(
  previous: Cs2FlowBuckets,
  next: readonly [duration: number, distance: number],
  timeFactors: Cs2CostVector,
): Cs2FlowBuckets {
  const duration = [0, 0, 0, 0] as [number, number, number, number];
  const distance = [0, 0, 0, 0] as [number, number, number, number];
  for (let i = 0; i < 4; i++) {
    const factor = f(timeFactors[i] * f(0.125));
    duration[i] = f(
      previous.duration[i] + f(f(next[0] - previous.duration[i]) * factor),
    );
    distance[i] = f(
      previous.distance[i] + f(f(next[1] - previous.distance[i]) * factor),
    );
  }
  return { duration, distance };
}

/** NetUtils.GetTrafficFlowSpeed, including Unity.Mathematics' NaN->one
 * saturate result on an empty duration/distance pair under the managed oracle.
 */
export function cs2TrafficFlowSpeed(duration: number, distance: number) {
  const ratio = f(distance / duration);
  return Number.isNaN(ratio) ? 1 : Math.min(1, Math.max(0, ratio));
}

/** UpdateRoadFlowJob.UpdateLaneFlow; Mathf.RoundToInt uses ties to even. */
export function cs2FlowOffset(
  buckets: Cs2FlowBuckets,
  timeFactors: Cs2CostVector,
) {
  const flow = buckets.duration.map((duration, i) =>
    cs2TrafficFlowSpeed(duration, buckets.distance[i]),
  ) as [number, number, number, number];
  const value = f(dot(flow, timeFactors) * 256);
  const floor = Math.floor(value),
    fraction = value - floor;
  const rounded =
    fraction < 0.5
      ? floor
      : fraction > 0.5
        ? floor + 1
        : floor % 2 === 0
          ? floor
          : floor + 1;
  return Math.min(255, Math.max(0, 256 - rounded));
}

export const CS2_PATH_METHOD = {
  pedestrian: 1,
  road: 2,
  parking: 4,
  track: 16,
  flying: 256,
  boarding: 1024,
  mediumRoad: 8192,
  bicycle: 16384,
} as const;

export type Cs2PathSpecification = {
  length: number;
  maxSpeed: number;
  flowOffset: number;
  costs: Cs2CostVector;
  methods: number;
  secondary?: boolean;
};
export type Cs2PathParameters = {
  maxSpeed: readonly [primary: number, secondary: number];
  walkSpeed: readonly [primary: number, secondary: number];
  weights: Cs2CostVector;
  methods: number;
  ignoreFlow?: boolean;
};

const f = Math.fround;
const FLOAT_MAX = 3.4028234663852886e38;
const UNREACHABLE = 1_000_000;

/** Game.Pathfind.PathUtils.CalculateSpeed; flowOffset is the stored byte. */
export function calculateCs2PathSpeed(
  spec: Cs2PathSpecification,
  parameters: Cs2PathParameters,
) {
  const methods = spec.methods & parameters.methods;
  const personalSpeed =
    methods & CS2_PATH_METHOD.pedestrian
      ? parameters.walkSpeed
      : parameters.maxSpeed;
  const cappedMethods =
    CS2_PATH_METHOD.pedestrian |
    CS2_PATH_METHOD.road |
    CS2_PATH_METHOD.track |
    CS2_PATH_METHOD.flying |
    CS2_PATH_METHOD.mediumRoad |
    CS2_PATH_METHOD.bicycle;
  const speed =
    methods & cappedMethods
      ? f(Math.min(personalSpeed[spec.secondary ? 1 : 0], spec.maxSpeed))
      : f(spec.maxSpeed);
  return parameters.ignoreFlow
    ? speed
    : f(speed - f(f(spec.flowOffset * 0.00390625) * speed));
}

/** Public PathUtils.CalculateCost. The caller owns the source random stream;
 * supply 1 for Stable, or its sampled [0.5, 1) multiplier otherwise.
 */
export function calculateCs2PathCost(
  spec: Cs2PathSpecification,
  parameters: Cs2PathParameters,
  randomFactor = 1,
) {
  const speed = calculateCs2PathSpeed(spec, parameters);
  const costs: Cs2CostVector = [
    f(spec.costs[0] + f(spec.length / speed)),
    spec.costs[1],
    spec.costs[2],
    spec.costs[3],
  ];
  return f(dot(costs, parameters.weights) * f(randomFactor));
}

/** PathfindJobs.PathfindExecutor.CalculateCost; graph flags and rules have
 * already been resolved for this traveller by the adapter.
 */
export function calculateCs2EdgeCost(
  spec: Cs2PathSpecification,
  parameters: Cs2PathParameters,
  options: {
    delta?: readonly [number, number];
    trafficRulePenalty?: boolean;
    avoidBicycles?: boolean;
    requireAuthorization?: boolean;
    authorized?: boolean;
    freeForward?: boolean;
    freeBackward?: boolean;
    boardingOnly?: boolean;
    randomFactor?: number;
    reducedCostFactor?: number;
  } = {},
) {
  const delta = options.delta ?? [0, 1];
  const span = f(delta[1] - delta[0]);
  const speed = calculateCs2PathSpeed(spec, parameters);
  const value = [...spec.costs] as [number, number, number, number];
  value[0] = f(value[0] + f(spec.length * f(1 / speed)));
  value[1] = f(
    value[1] + f(spec.length * (options.trafficRulePenalty ? 1 : 0)),
  );
  value[3] = f(
    value[3] + f(spec.length * (options.avoidBicycles ? f(0.1) : 0)),
  );
  if (!!options.requireAuthorization !== !!options.authorized)
    value[1] = f(value[1] + 100);
  if (
    (span >= 0 && options.freeForward) ||
    (span <= 0 && options.freeBackward) ||
    options.boardingOnly
  ) {
    value[0] = 0;
    value[1] = 0;
    value[2] = 0;
  }
  const cost = f(dot(value, parameters.weights) * Math.abs(span));
  return f(
    cost * f((options.randomFactor ?? 1) * (options.reducedCostFactor ?? 1)),
  );
}

function dot(a: Cs2CostVector, b: Cs2CostVector) {
  return f(
    f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2])) + f(a[3] * b[3]),
  );
}

export type Cs2LaneSwitchOptions = {
  baseCost?: number;
  allowChange?: boolean;
  turnAhead?: boolean;
};

/** CarLaneSelectIterator.GetLaneSwitchCost and coefficient setup. */
export function cs2LaneSwitchCost(
  laneDistance: number,
  options: Cs2LaneSwitchOptions = {},
) {
  let coefficient = f(
    (options.baseCost ?? 0) + (options.allowChange === false ? 5 : 1),
  );
  if (options.turnAhead) coefficient = f(coefficient * 7);
  return f(laneDistance * laneDistance * laneDistance * coefficient);
}

/** CarLaneSelectIterator.GetLanePriorityCost. */
export function cs2LanePriorityCost(
  lanePriority: number,
  vehiclePriority: number,
) {
  return f(Math.max(0, lanePriority - vehiclePriority));
}

/** CarLaneSelectIterator.GetLaneDriveCost, with decoded component flags. */
export function cs2LaneDriveCost(input: {
  allowed: boolean;
  forbidden?: boolean;
  preferenceRequested?: boolean;
  preferred?: boolean;
  vehiclePriority: number;
  bicycle?: boolean;
  bicycleOnly?: boolean;
  indexFromKerb?: number;
}) {
  if (!input.allowed) return FLOAT_MAX;
  let cost = input.forbidden
    ? input.vehiclePriority < 108
      ? f(4.9)
      : f(0.9)
    : input.preferenceRequested && !input.preferred
      ? f(0.4)
      : 0;
  if (input.bicycle && !input.bicycleOnly)
    cost = f(cost + f(f(1.4) + f((input.indexFromKerb ?? 0) * f(0.4))));
  return cost;
}

/** Cost of an object specifically inspected as a blocker/current-lane object.
 * Far-future groups normally just count objects, as the source does.
 */
export function cs2LaneObjectCost(
  object: {
    curveEnd: number;
    moving: boolean;
    queueing?: boolean;
    queueLane?: boolean;
  },
  perObjectCost = 0.49,
) {
  if (object.moving || (object.queueing && object.queueLane))
    return f(perObjectCost);
  return f(10_000_000 + f(-1_000_000 * f(object.curveEnd)));
}

export type Cs2NavigationLane = {
  /** Stable physical order within this lane group. */
  lane: number;
  /** Number of lane objects; the current group should count only those ahead. */
  objectCount: number;
  /** Additional specifically inspected blocker cost beyond normal counting. */
  blockerCost?: number;
  reservationPriority?: number;
  driveCost?: number;
  /** Connected indices in the following group. Source uses their min/max span. */
  next?: readonly number[];
};
export type Cs2NavigationGroup = {
  lanes: readonly Cs2NavigationLane[];
  curveStart?: number;
  curveEnd?: number;
  allowChange?: boolean;
  fixed?: boolean;
  transformTarget?: boolean;
  groupTarget?: boolean;
};
export type Cs2BackwardLaneCosts = {
  costs: ReadonlyMap<number, number>[];
  switchBaseCost: number;
};

function countCost(
  lane: Cs2NavigationLane,
  group: Cs2NavigationGroup,
  index: number,
  terminal: boolean,
) {
  let perObject = f(
    Math.abs(f((group.curveEnd ?? 1) - (group.curveStart ?? 0))) * f(0.49),
  );
  if (!terminal) perObject = f(perObject * f(2 / (2 + index)));
  return f(f(perObject * lane.objectCount) + (lane.blockerCost ?? 0));
}

function extraCost(lane: Cs2NavigationLane, priority: number) {
  return f(
    cs2LanePriorityCost(lane.reservationPriority ?? 0, priority) +
      (lane.driveCost ?? 0),
  );
}

function range(values: readonly number[] | undefined) {
  return values?.length
    ? [Math.min(...values), Math.max(...values)]
    : undefined;
}

/** Back-to-front lane-group dynamic programming from CalculateLaneCosts.
 * Groups correspond to the navigation buffer AFTER the current lane group.
 * Owner/SlaveLane and node-equality queries are decoded into lane.next indices.
 */
export function backwardCs2LaneCosts(
  groups: readonly Cs2NavigationGroup[],
  options: { priority?: number; turnAhead?: boolean } = {},
): Cs2BackwardLaneCosts {
  const costs = groups.map(() => new Map<number, number>());
  const priority = options.priority ?? CS2_NORMAL_VEHICLE_PRIORITY;
  let baseCost = 0;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (!group.fixed && !group.transformTarget) {
      const next = groups[i + 1];
      const switchOptions = {
        baseCost,
        allowChange: group.allowChange,
        turnAhead: options.turnAhead,
      };
      if (!next || next.transformTarget) {
        for (const lane of group.lanes)
          costs[i].set(
            lane.lane,
            f(countCost(lane, group, i, !next) + extraCost(lane, priority)),
          );
      } else if (next.fixed) {
        const connected = group.lanes
          .filter((lane) => lane.next?.length)
          .map((lane) => lane.lane);
        const span = range(connected);
        for (const lane of group.lanes) {
          const distance = span
            ? Math.max(0, span[0] - lane.lane, lane.lane - span[1])
            : 0;
          costs[i].set(
            lane.lane,
            f(
              f(countCost(lane, group, i, false) + extraCost(lane, priority)) +
                cs2LaneSwitchCost(distance, switchOptions),
            ),
          );
        }
      } else {
        const connected: { lane: number; base: number }[] = [];
        for (const lane of group.lanes) {
          const span = next.groupTarget
            ? range(next.lanes.map((v) => v.lane))
            : range(lane.next);
          let cost = UNREACHABLE;
          if (span) {
            for (const target of next.lanes) {
              const distance = Math.max(
                0,
                span[0] - target.lane,
                target.lane - span[1],
              );
              cost = Math.min(
                cost,
                f(
                  (costs[i + 1].get(target.lane) ?? UNREACHABLE) +
                    cs2LaneSwitchCost(distance, switchOptions),
                ),
              );
            }
            cost = f(cost + countCost(lane, group, i, false));
            connected.push({ lane: lane.lane, base: cost });
            cost = f(cost + extraCost(lane, priority));
          }
          costs[i].set(lane.lane, cost);
        }
        const first = connected[0],
          last = connected.at(-1);
        if (first && last)
          for (const lane of group.lanes) {
            if (lane.lane >= first.lane && lane.lane <= last.lane) continue;
            const nearest = lane.lane < first.lane ? first : last;
            costs[i].set(
              lane.lane,
              f(
                f(
                  nearest.base +
                    cs2LaneSwitchCost(
                      Math.abs(nearest.lane - lane.lane),
                      switchOptions,
                    ),
                ) + extraCost(lane, priority),
              ),
            );
          }
      }
    }
    if (i < groups.length - 1) baseCost = f(baseCost + f(0.01));
  }
  return { costs, switchBaseCost: baseCost };
}

/** Current-group choice from UpdateOptimalLane. Actual change permission and
 * collision/gap execution belong to the separate source navigation iterator.
 */
export function chooseCs2CurrentLane(input: {
  group: Cs2NavigationGroup;
  currentLane: number;
  changingLane?: number;
  nextGroup?: Cs2NavigationGroup;
  nextCosts?: ReadonlyMap<number, number>;
  priority?: number;
  baseCost?: number;
  turnAhead?: boolean;
}) {
  if (input.group.fixed) return input.changingLane ?? input.currentLane;
  const effective = input.changingLane ?? input.currentLane;
  const priority = input.priority ?? CS2_NORMAL_VEHICLE_PRIORITY;
  let bestLane = effective,
    bestCost = FLOAT_MAX;
  const connected = range(
    input.group.lanes
      .filter((lane) => lane.next?.length)
      .map((lane) => lane.lane),
  );
  for (const lane of input.group.lanes) {
    let cost = UNREACHABLE;
    const own = f(
      f(f(lane.objectCount * f(0.49)) + (lane.blockerCost ?? 0)) +
        cs2LanePriorityCost(lane.reservationPriority ?? 0, priority),
    );
    const next = input.nextGroup;
    if (!next || next.transformTarget) cost = own;
    else if (next.fixed) {
      if (
        !connected ||
        (lane.lane >= connected[0] && lane.lane <= connected[1])
      )
        cost = own;
    } else {
      const span = next.groupTarget
        ? range(next.lanes.map((v) => v.lane))
        : range(lane.next);
      if (span) {
        for (const target of next.lanes)
          if (target.lane >= span[0] && target.lane <= span[1])
            cost = Math.min(
              cost,
              input.nextCosts?.get(target.lane) ?? UNREACHABLE,
            );
        cost = f(cost + own);
      }
    }
    const effectiveDistance = Math.abs(lane.lane - effective);
    const distance =
      effectiveDistance === 0
        ? 0
        : Math.max(effectiveDistance, Math.abs(lane.lane - input.currentLane));
    cost = f(
      cost +
        cs2LaneSwitchCost(distance, {
          baseCost: input.baseCost,
          allowChange: input.group.allowChange,
          turnAhead: input.turnAhead,
        }),
    );
    if (lane.driveCost === FLOAT_MAX) cost = FLOAT_MAX;
    if (cost < bestCost) {
      bestCost = cost;
      bestLane = lane.lane;
    }
  }
  return bestLane;
}
