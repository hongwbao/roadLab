/**
 * Primitive portions of the supplied CS2 1.6.0f1 lane-conflict implementation.
 * See docs/CS2_CONFLICTS.md for the original method identities and scope limits.
 * Lane curve positions are normalized; distances/speeds are metres and m/s.
 */
export const CS2_OVERLAP = Object.freeze({
  mergeStart: 1,
  mergeEnd: 2,
  mergeMiddleStart: 16,
  mergeMiddleEnd: 32,
  road: 128,
  slow: 1024,
  water: 2048,
});

const f = Math.fround;
const clamp = (x: number, min: number, max: number) =>
  Math.max(min, Math.min(max, x));
const byte = (n: number) => n & 255;
const signedByte = (n: number) => (n << 24) >> 24;
const roundEven = (x: number) => {
  const low = Math.floor(x);
  return x - low === 0.5 ? (low % 2 === 0 ? low : low + 1) : Math.round(x);
};
const quantize = (value: number, scale: number) =>
  clamp(roundEven(f(f(value) * scale)), 0, 255);

/** VehicleUtils.GetPriority(Car): Emergency is CarFlags bit zero. */
export const cs2VehiclePriority = (emergency: boolean) =>
  emergency ? 108 : 100;

/** VehicleUtils.GetPriority(TrainData): Train=1, Tram=2, Subway=4. */
export const cs2TrainPriority = (trackTypes: number) =>
  (trackTypes & 5) !== 0 ? 110 : 104;
/** VehicleUtils.GetPriority(WatercraftData), SizeClass Small=0/Medium=1/Large=2. */
export const cs2WatercraftPriority = (sizeClass: number) =>
  sizeClass === 1 ? 102 : sizeClass === 2 ? 104 : 100;
/** VehicleUtils.GetPriority(AircraftData). */
export const cs2AircraftPriority = () => 104;

export type CS2ReservationData = { offset: number; priority: number };
export type CS2LaneReservation = {
  next: CS2ReservationData;
  previous: CS2ReservationData;
  blocker: string | null;
};

/** CarNavigationHelpers.LaneReservation constructor, including round-to-even. */
export function cs2QuantizeReservation(offset: number, priority: number) {
  return { offset: quantize(offset, 255), priority: byte(priority) };
}

/** Game.Net.LaneReservation combines previous and next update buckets. */
export const cs2ReservationPriority = (r: CS2LaneReservation) =>
  Math.max(r.next.priority, r.previous.priority);
export const cs2ReservationOffset = (r: CS2LaneReservation) =>
  f(Math.max(r.next.offset, r.previous.offset) * f(0.003921569));

/** CarNavigationSystem.UpdateLaneReservationsJob; maxima are independent. */
export function cs2ApplyReservation(
  r: CS2LaneReservation,
  request: CS2ReservationData,
): CS2LaneReservation {
  const offset = Math.max(r.next.offset, request.offset);
  let priority = r.next.priority,
    blocker = r.blocker;
  if (request.priority > priority) {
    if (request.priority >= r.previous.priority) blocker = null;
    priority = request.priority;
  }
  return { previous: { ...r.previous }, next: { offset, priority }, blocker };
}

/** NetLaneReservationSystem.ResetLaneReservationsJob, on its 16-frame bucket. */
export function cs2AdvanceReservation(
  r: CS2LaneReservation,
): CS2LaneReservation {
  return {
    previous: { ...r.next },
    next: { offset: 0, priority: 0 },
    blocker: r.next.priority < r.previous.priority ? null : r.blocker,
  };
}

export type CS2LaneOverlap = {
  thisStart: number;
  thisEnd: number;
  otherStart: number;
  otherEnd: number;
  parallelism: number;
  priorityDelta: number;
  flags: number;
};

/** Game.Net.LaneOverlap constructor. The stored parallelism is unsigned. */
export function cs2QuantizeOverlap(
  positions: readonly [number, number, number, number],
  flags: number,
  parallelism: number,
  priorityDelta: number,
): CS2LaneOverlap {
  const [thisStart, thisEnd, otherStart, otherEnd] = positions.map((x) =>
    quantize(x, 255),
  );
  return {
    thisStart,
    thisEnd,
    otherStart,
    otherEnd,
    parallelism: quantize(parallelism, 128),
    priorityDelta: signedByte(priorityDelta),
    flags: flags & 65535,
  };
}

/** LaneOverlapSystem.CheckOverlap: road-to-road priority-delta branch. */
export function cs2LanePriorityDelta(input: {
  selfFlags: number;
  otherFlags: number;
  selfTangent: readonly [number, number];
  otherTangent: readonly [number, number];
  mergeStart?: boolean;
  leftHandTraffic?: boolean;
}) {
  if (input.mergeStart) return 0;
  const stop = 0x800,
    yieldFlag = 0x400,
    rightOfWay = 0x4000000,
    approach = 0x200000,
    unsafe = 1;
  let a = input.selfFlags,
    b = input.otherFlags;
  if ((a & approach) !== 0) a &= ~(stop | yieldFlag | rightOfWay);
  if ((b & approach) !== 0) b &= ~(stop | yieldFlag | rightOfWay);
  const changed = a ^ b;
  if ((changed & stop) !== 0) return (b & stop) !== 0 ? -1 : 1;
  if ((changed & yieldFlag) !== 0) return (b & yieldFlag) !== 0 ? -1 : 1;
  if ((changed & rightOfWay) !== 0) return (a & rightOfWay) !== 0 ? -1 : 1;
  if ((changed & unsafe) !== 0) return (b & unsafe) !== 0 ? -1 : 1;
  const [ax, az] = input.selfTangent,
    [bx, bz] = input.otherTangent,
    cross = f(f(f(ax) * f(bz)) - f(f(az) * f(bx))),
    oriented = input.leftHandTraffic ? -cross : cross;
  return oriented > 0 ? 1 : oriented < 0 ? -1 : 0;
}

/** The overlap-window arithmetic from CheckOverlappingLanes. */
export function cs2OverlapWindow(input: {
  overlap: CS2LaneOverlap;
  selfCurveStart: number;
  minimumOffset: number;
  laneLength: number;
  distance: number;
  inverse?: boolean;
  bicycle?: boolean;
}) {
  const o = input.overlap,
    [start, end, otherStart, otherEnd] = [
      o.thisStart,
      o.thisEnd,
      o.otherStart,
      o.otherEnd,
    ].map((x) => f(x * f(0.003921569))),
    inverse = input.inverse ?? false,
    margin = f(input.bicycle ? 0.4 : 0.9),
    passed = inverse
      ? start >= input.selfCurveStart
      : end <= input.selfCurveStart,
    minimumDelta = Math.max(
      0,
      f(inverse ? end - input.minimumOffset : input.minimumOffset - start),
    ),
    along = f(
      f(input.laneLength) *
        f(inverse ? input.selfCurveStart - end : start - input.selfCurveStart),
    ),
    distance = f(f(f(input.distance) - margin) + along),
    mergeMask = inverse
      ? CS2_OVERLAP.mergeEnd | CS2_OVERLAP.mergeMiddleEnd
      : CS2_OVERLAP.mergeStart | CS2_OVERLAP.mergeMiddleStart,
    continuingMask = inverse
      ? CS2_OVERLAP.mergeStart | CS2_OVERLAP.mergeMiddleStart
      : CS2_OVERLAP.mergeEnd | CS2_OVERLAP.mergeMiddleEnd,
    ahead = inverse ? end < input.minimumOffset : start > input.minimumOffset;
  return {
    skip: passed || (o.flags & CS2_OVERLAP.water) !== 0,
    start,
    end,
    otherStart,
    otherEnd,
    minimumDelta,
    distance,
    stoppingDistance: f(distance + margin),
    distanceFactor: f(o.parallelism * f(1 / 128)),
    checkReservation: (o.flags & mergeMask) === 0 && ahead,
    reservationOffsetThreshold: inverse
      ? 0
      : Math.max(f(minimumDelta + otherStart), otherStart),
    continuing: (o.flags & continuingMask) !== 0,
  };
}

export type CS2OverlapDecisionInput = {
  selfPriority: number;
  ownReservationPriority?: number;
  priorityDelta: number;
  yieldOverride: number;
  /** LaneSignalType: None=0, Stop=1, SafeStop=2, Yield=3, Go=4. */
  otherSignal: number;
  requestSpace: boolean;
  otherReservation?: { offset: number; priority: number };
  reservationOffsetThreshold: number;
  slow: boolean;
  brakingSpeed: number;
  speedRange: { min: number; max: number };
  maxSpeed: number;
  speedLimit: number;
  canStopBeforeOverlap: boolean;
  overlapSpaceAvailable?: boolean;
};

/**
 * Reservation branch of CheckOverlappingLanes, after geometry/filtering.
 * `brakingSpeed` is VehicleUtils.GetMaxBrakingSpeed at the overlap entrance.
 * Offset and priority do not represent exclusive ownership of a whole junction.
 */
export function cs2OverlapDecision(input: CS2OverlapDecisionInput) {
  let priority = input.selfPriority;
  if ((input.ownReservationPriority ?? 0) >= 108 && priority < 106)
    priority = 106;
  const signalYield =
    input.yieldOverride +
    (input.otherSignal === 1 ? 1 : input.otherSignal === 3 ? -1 : 0);
  let delta = signalYield !== 0 ? signalYield : input.priorityDelta;
  if (input.requestSpace && delta > 0) delta = 0;
  priority -= delta;
  const reservation = input.otherReservation,
    yieldForReservation =
      !!reservation &&
      (reservation.offset > input.reservationOffsetThreshold ||
        reservation.priority > priority),
    cautionYield = input.slow
      ? 1
      : signalYield !== 0
        ? input.yieldOverride
        : input.priorityDelta,
    approachCautiously =
      !!reservation && !yieldForReservation && cautionYield > 0,
    checkSpace =
      !!reservation &&
      input.canStopBeforeOverlap &&
      !input.requestSpace &&
      reservation.priority === 96,
    blockForSpace = checkSpace && input.overlapSpaceAvailable === false;
  let maxSpeed = f(input.maxSpeed);
  if (yieldForReservation)
    maxSpeed = Math.min(
      maxSpeed,
      clamp(f(input.brakingSpeed), input.speedRange.min, input.speedRange.max),
    );
  else if (
    approachCautiously &&
    input.brakingSpeed >= f(f(input.speedLimit) * 0.5)
  )
    maxSpeed = Math.min(maxSpeed, f(input.brakingSpeed));
  if (blockForSpace) maxSpeed = Math.min(maxSpeed, f(input.brakingSpeed));
  return {
    priority,
    signalYield,
    yieldForReservation,
    approachCautiously,
    checkSpace,
    blockForSpace,
    maxSpeed,
  };
}

/** Two-second advance only for higher-priority objects, then window filtering. */
export function cs2OverlapVehicleWindow(input: {
  curvePosition: readonly [number, number];
  objectSpeed: number;
  objectPriority: number;
  effectivePriority: number;
  laneLength: number;
  otherStart: number;
  otherEnd: number;
  minimumDelta: number;
  mayProjectPriority: boolean;
}) {
  const inverse = input.curvePosition[1] < input.curvePosition[0];
  let projected = f(input.curvePosition[1]);
  if (
    input.mayProjectPriority &&
    input.objectPriority > input.effectivePriority
  )
    projected = f(
      projected +
        f(f(f(input.objectSpeed) * 2) / Math.max(1, f(input.laneLength))),
    );
  return {
    inverse,
    projected,
    intersects: inverse
      ? projected < f(input.otherEnd - input.minimumDelta)
      : projected > f(input.otherStart + input.minimumDelta),
  };
}

/**
 * CheckOverlapSpace after ECS geometry projection and self/trailer filtering.
 * `blockerRearDistance` already includes a moving leader's braking distance.
 * Queue records must preserve their original lane-buffer order.
 */
export function cs2CheckOverlapSpace(input: {
  selfLength: number;
  bicycle?: boolean;
  currentRemainingLength: number;
  nextLaneLength?: number;
  currentObjects: readonly {
    id: string;
    moving: boolean;
    length?: number;
    bicycle?: boolean;
    reachesOverlapEnd: boolean;
  }[];
  nextBlocker?: string | null;
  blockerRearDistance?: number;
}) {
  const selfSize = f(f(input.selfLength) + f(input.bicycle ? 0.5 : 1));
  let required = selfSize,
    previousBicycle = !!input.bicycle,
    blocker: string | null = null,
    objectAtEnd: string | null = null;
  for (const object of input.currentObjects) {
    if (object.moving && object.length !== undefined) {
      const bicycle = !!object.bicycle;
      required = f(
        required +
          (bicycle && previousBicycle
            ? f(f(object.length) * 0.5)
            : f(f(object.length) + f(bicycle ? 0.5 : 1))),
      );
      previousBicycle = bicycle;
      blocker = object.id;
    }
    if (object.reachesOverlapEnd) {
      objectAtEnd = object.id;
      break;
    }
  }
  let available = f(input.currentRemainingLength);
  if (!objectAtEnd && input.nextLaneLength !== undefined) {
    available = f(available + f(input.nextLaneLength));
    objectAtEnd = input.nextBlocker ?? null;
  }
  available = Math.max(available, selfSize);
  if (objectAtEnd) {
    blocker = objectAtEnd;
    if (input.blockerRearDistance !== undefined)
      available = f(input.blockerRearDistance);
  }
  const fits = available >= required;
  return { fits, required, available, blocker: fits ? null : blocker };
}

/** UpdateMaxSpeed's final IgnoreBlocker/oncoming handling; no reverse motion. */
export function cs2ResolveBlockerSpeed(input: {
  brakingSpeed: number;
  speedRange: { min: number; max: number };
  ignore: boolean;
  oncoming?: boolean;
  previousOncoming?: number;
}) {
  let speed = f(input.brakingSpeed),
    oncoming = f(input.previousOncoming ?? 0);
  if (input.oncoming) {
    oncoming = Math.max(oncoming, f(2 - f(speed * f(1 / 6))));
    speed = Math.max(speed, 3);
  } else if (input.ignore && speed < 3) speed = 3;
  return {
    speed: clamp(speed, input.speedRange.min, input.speedRange.max),
    oncoming,
    hasVehicleBlocker: !input.oncoming,
  };
}

export type CS2BlockerRecord = {
  blocker: string | null;
  /** BlockerType: Temporary=4. */
  type: number;
  /** Original Blocker.m_MaxSpeed byte, not m/s. */
  maxSpeedByte: number;
};

/** CarNavigationSystem.CheckBlocker: current encoding (not old save migration). */
export const cs2EncodeBlockerSpeed = (speed: number) =>
  quantize(speed, f(2.2949998));

/** StuckMovingObjectSystem.IsBlocked's bounded blocker-chain walk. */
export function cs2IsBlockedChain(
  self: string,
  initial: CS2BlockerRecord,
  blockers: ReadonlyMap<string, CS2BlockerRecord>,
  controllers: ReadonlyMap<string, string> = new Map(),
  target?: string,
) {
  let id = initial.blocker,
    count = 0;
  if (id) id = controllers.get(id) ?? id;
  while (id && blockers.has(id)) {
    if (++count === 100 || id === self || id === target) return true;
    const record = blockers.get(id)!;
    id = record.blocker;
    if (!id || record.type === 4 || record.maxSpeedByte >= 6) return false;
    id = controllers.get(id) ?? id;
  }
  return false;
}

/** Car branch of StuckMovingObjectSystem.StuckCheckJob, for a supplied snapshot. */
export function cs2StuckCarDecision(input: {
  self: string;
  initial: CS2BlockerRecord;
  blockers: ReadonlyMap<string, CS2BlockerRecord>;
  controllers?: ReadonlyMap<string, string>;
  target?: string;
  parkedTrainBlocker?: boolean;
  pathPending?: boolean;
}) {
  const initial = input.initial,
    controllers = input.controllers ?? new Map<string, string>();
  if (!initial.blocker || initial.type === 4)
    return { requestSpaceFor: null, stuck: false, markPathStuck: false };
  const requestSpaceFor =
    initial.type === 2
      ? (controllers.get(initial.blocker) ?? initial.blocker)
      : null;
  if (initial.maxSpeedByte >= 6)
    return { requestSpaceFor, stuck: false, markPathStuck: false };
  const stuck =
    !!input.parkedTrainBlocker ||
    cs2IsBlockedChain(
      input.self,
      initial,
      input.blockers,
      controllers,
      input.target
        ? (controllers.get(input.target) ?? input.target)
        : undefined,
    );
  return { requestSpaceFor, stuck, markPathStuck: stuck && !input.pathPending };
}

/** CarNavigationSystem.UpdateNavigationTarget, temporary pedestrian blockers. */
export function cs2PushBlockers(
  previous: boolean,
  temporary: boolean,
  duration: number,
) {
  return duration >= 5 ? temporary : previous;
}

/**
 * VehicleCollisionIterator.CheckCollision's moving-object speed branch.
 * Used for AreaLane navigation only, after its path intersection/front filter.
 * The actual iterator also pushes the target laterally inside the area polygon.
 */
export function cs2AreaCollisionLimit(input: {
  pathDistance: number;
  combinedRadius: number;
  otherDirectionDot: number;
  otherVelocityAlong: number;
  objectDistance: number;
  objectForwardDistance: number;
  speedRange: { min: number; max: number };
  maxSpeed: number;
}) {
  if (input.pathDistance >= input.combinedRadius)
    return { maxSpeed: input.maxSpeed, blockerType: 0 };
  const ratio = f(f(input.pathDistance) / f(input.combinedRadius));
  let speed = f(
    Math.min(1, f(f(0.7 + f(0.3 * input.otherDirectionDot)) + ratio)) *
      f(input.speedRange.max),
  );
  let blockerType = 2;
  if (
    input.objectDistance < input.combinedRadius &&
    input.objectForwardDistance > 0
  ) {
    blockerType = 1;
    if (input.objectDistance > 0.01) {
      const pressure = f(
          f(
            f(input.objectForwardDistance) *
              f(input.combinedRadius - input.objectDistance),
          ) / f(f(input.combinedRadius) * f(input.objectDistance)),
        ),
        interpolated = f(
          f(input.otherVelocityAlong) +
            f(f(input.speedRange.max - input.otherVelocityAlong) * ratio),
        );
      speed = Math.min(
        speed,
        Math.max(0, f(Math.max(1, interpolated) - pressure)),
      );
    } else speed = 0;
  }
  speed = clamp(speed, input.speedRange.min, input.speedRange.max);
  return {
    maxSpeed: Math.min(input.maxSpeed, speed),
    blockerType: speed < input.maxSpeed ? blockerType : 0,
  };
}
