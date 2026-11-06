/** PathOwner policy from the supplied CS2 1.6.0f1 managed code.
 * Geometry invalidation and city activities are explicit inputs, not timers.
 */
export enum Cs2PathFlags {
  Pending = 1,
  Failed = 2,
  Obsolete = 4,
  Scheduled = 8,
  Append = 16,
  Updated = 32,
  Stuck = 64,
  WantsEvent = 128,
  AddDestination = 256,
  Debug = 512,
  Divert = 1024,
  DivertObsolete = 2048,
  CachedObsolete = 4096,
}
export type Cs2PathOwner = { flags: number; elementIndex: number };
export const CS2_PERSONAL_CAR_PATH_FLAGS = {
  transporting: 1,
  boarding: 2,
  disembarking: 4,
  dummyTraffic: 8,
  homeTarget: 16,
} as const;
export const CS2_PATH_LANE_FLAGS = {
  endOfPath: 1,
  endReached: 2,
  parkingSpace: 16,
  obsolete: 64,
  fixedLane: 256,
  waypoint: 512,
  requestSpace: 0x400000,
} as const;

export function cs2PathfindFailed(flags: number) {
  return !!(flags & (Cs2PathFlags.Failed | Cs2PathFlags.Stuck));
}
export function cs2RequireNewPath(flags: number) {
  return (
    !!(flags & (Cs2PathFlags.Obsolete | Cs2PathFlags.DivertObsolete)) &&
    !(flags & (Cs2PathFlags.Pending | Cs2PathFlags.Failed | Cs2PathFlags.Stuck))
  );
}
export function resetCs2UpdatedPath(owner: Cs2PathOwner) {
  const updated = !!(owner.flags & Cs2PathFlags.Updated);
  owner.flags &= ~Cs2PathFlags.Updated;
  return updated;
}
/** VehicleUtils.SetTarget clears Failed but deliberately does not clear Stuck. */
export function setCs2PathTarget(owner: Cs2PathOwner) {
  owner.flags = (owner.flags & ~Cs2PathFlags.Failed) | Cs2PathFlags.Obsolete;
}
export function invalidateCs2Path(owner: Cs2PathOwner) {
  owner.flags |= Cs2PathFlags.Obsolete;
}

/** VehicleUtils.SetupPathfind's state change; enqueue belongs to the caller. */
export function cs2SetupCarPathfind(owner: Cs2PathOwner, laneFlags: number) {
  if (
    (owner.flags & (Cs2PathFlags.Obsolete | Cs2PathFlags.Divert)) ===
    (Cs2PathFlags.Obsolete | Cs2PathFlags.Divert)
  )
    owner.flags |= Cs2PathFlags.CachedObsolete;
  owner.flags &= ~(
    Cs2PathFlags.Failed |
    Cs2PathFlags.Obsolete |
    Cs2PathFlags.DivertObsolete
  );
  owner.flags |= Cs2PathFlags.Pending;
  return (
    (laneFlags & ~CS2_PATH_LANE_FLAGS.endOfPath) | CS2_PATH_LANE_FLAGS.fixedLane
  );
}

/** PersonalCarAISystem.FindNewPath's preparation before SetupPathfind. */
export function prepareCs2PersonalCarPathRequest(
  owner: Cs2PathOwner,
  laneFlags: number,
) {
  owner.flags &= ~(Cs2PathFlags.AddDestination | Cs2PathFlags.Divert);
  return cs2SetupCarPathfind(owner, laneFlags);
}

/** PathfindJobs.ProcessResultsJob.Execute for an owner with a PathElement buffer. The source
 * does not compare a replacement route against a 15%/2.5-second benefit gate.
 */
export function applyCs2PathResult<T>(
  owner: Cs2PathOwner,
  oldPath: readonly T[],
  resultPath: readonly T[],
  options: { destination?: T } = {},
) {
  let path = [...oldPath];
  let publishInformation = true;
  if (resultPath.length === 0 && owner.flags & Cs2PathFlags.Divert) {
    publishInformation = false;
    owner.flags |= Cs2PathFlags.Failed;
  } else {
    if (owner.flags & Cs2PathFlags.Append) {
      if (owner.elementIndex !== 0) {
        if (owner.elementIndex < 0 || owner.elementIndex > path.length)
          throw new RangeError(
            "PathOwner element index is outside its path buffer",
          );
        path.splice(0, owner.elementIndex);
        owner.elementIndex = 0;
      }
    } else {
      path = [];
      owner.elementIndex = 0;
    }
    if (!(owner.flags & Cs2PathFlags.Obsolete)) {
      path.push(...resultPath);
      if (owner.flags & Cs2PathFlags.AddDestination) {
        if (!("destination" in options))
          throw new Error("AddDestination requires the result destination");
        path.push(options.destination as T);
      }
    }
    if (owner.flags & Cs2PathFlags.Obsolete) publishInformation = false;
    else if (resultPath.length === 0) owner.flags |= Cs2PathFlags.Failed;
    if (owner.flags & Cs2PathFlags.Divert)
      owner.flags |= Cs2PathFlags.CachedObsolete;
    else owner.flags &= ~Cs2PathFlags.CachedObsolete;
    owner.flags |= Cs2PathFlags.Updated;
  }
  owner.flags &= ~Cs2PathFlags.Pending;
  return { path, publishInformation };
}

/** Normal driving branch of PersonalCarAI.Tick. Activity means delegate the
 * source boarding/disembarking/parking helper before making further decisions;
 * it does not simulate a missing city or silently treat Stuck as a retry.
 */
export function decideCs2PersonalCarPathAction(input: {
  owner: Cs2PathOwner;
  laneFlags: number;
  personalFlags: number;
  targetExists: boolean;
}) {
  const updated = resetCs2UpdatedPath(input.owner);
  let laneFlags = input.laneFlags;
  const activity =
    CS2_PERSONAL_CAR_PATH_FLAGS.transporting |
    CS2_PERSONAL_CAR_PATH_FLAGS.boarding |
    CS2_PERSONAL_CAR_PATH_FLAGS.disembarking;
  let action: "invalid" | "activity" | "arrived" | "request" | "continue";
  if (
    (!(input.personalFlags & activity) && !input.targetExists) ||
    cs2PathfindFailed(input.owner.flags)
  )
    action = "invalid";
  else if (
    ((laneFlags &
      (CS2_PATH_LANE_FLAGS.endReached | CS2_PATH_LANE_FLAGS.parkingSpace)) ===
      (CS2_PATH_LANE_FLAGS.endReached | CS2_PATH_LANE_FLAGS.parkingSpace) &&
      !(input.owner.flags & Cs2PathFlags.Pending)) ||
    input.personalFlags &
      (CS2_PERSONAL_CAR_PATH_FLAGS.boarding |
        CS2_PERSONAL_CAR_PATH_FLAGS.disembarking)
  )
    action = "activity";
  else if (
    (laneFlags &
      (CS2_PATH_LANE_FLAGS.endOfPath |
        CS2_PATH_LANE_FLAGS.endReached |
        CS2_PATH_LANE_FLAGS.parkingSpace |
        CS2_PATH_LANE_FLAGS.waypoint)) ===
    (CS2_PATH_LANE_FLAGS.endOfPath | CS2_PATH_LANE_FLAGS.endReached)
  )
    action =
      input.personalFlags & CS2_PERSONAL_CAR_PATH_FLAGS.transporting
        ? "activity"
        : "arrived";
  else {
    if (
      (laneFlags &
        (CS2_PATH_LANE_FLAGS.endReached | CS2_PATH_LANE_FLAGS.waypoint)) ===
      (CS2_PATH_LANE_FLAGS.endReached | CS2_PATH_LANE_FLAGS.waypoint)
    ) {
      laneFlags &= ~CS2_PATH_LANE_FLAGS.waypoint;
      input.owner.flags =
        (input.owner.flags & ~Cs2PathFlags.Failed) | Cs2PathFlags.Obsolete;
    }
    action = cs2RequireNewPath(input.owner.flags) ? "request" : "continue";
  }
  return { action, updated, laneFlags };
}

export function cs2PersonalCarFallbackParameters(maxSpeed: number) {
  const speed = Math.fround(maxSpeed),
    walk = Math.fround(5.555556);
  return {
    maxSpeed: [speed, speed] as const,
    walkSpeed: [walk, walk] as const,
    weights: [1, 1, 1, 1] as const,
    pathfindFlags: 0,
    stable: false,
    ignoreFlow: false,
  };
}

/** Search parameters use PathfindFlags, NOT PathOwner's similarly numbered
 * PathFlags. math.select evaluates the random draw even for Stable searches.
 */
export function cs2PathfindRandomPolicy(pathfindFlags: number) {
  const stable = !!(pathfindFlags & 1);
  return {
    stable,
    sampleRange: [0.5, 1] as const,
    consumeSample: true,
    heuristicMultiplier: stable ? 1 : 2,
  };
}

export enum Cs2BlockerType {
  None,
  Continuing,
  Crossing,
  Signal,
  Temporary,
  Limit,
  Caution,
  Spawn,
  Oncoming,
}
export type Cs2PathBlocker = {
  blocker: number | null;
  type: Cs2BlockerType;
  /** Source Blocker.m_MaxSpeed encoded BYTE, not metres/second. */
  maxSpeed: number;
};

/** StuckMovingObjectSystem.IsBlocked: circular dependency or 100 traversals;
 * neither ordinary elapsed red time nor a finite stopped queue is enough.
 */
export function cs2BlockedPathChain(
  self: number,
  target: number | null,
  blocker: Cs2PathBlocker,
  blockers: ReadonlyMap<number, Cs2PathBlocker>,
  controllers: ReadonlyMap<number, number> = new Map(),
) {
  let id = blocker.blocker;
  if (id !== null) id = controllers.get(id) ?? id;
  let count = 0;
  while (id !== null && blockers.has(id)) {
    if (++count === 100 || id === self || (target !== null && id === target))
      return true;
    const next = blockers.get(id)!;
    if (
      next.blocker === null ||
      next.type === Cs2BlockerType.Temporary ||
      next.maxSpeed >= 6
    )
      return false;
    id = controllers.get(next.blocker) ?? next.blocker;
  }
  return false;
}

/** StuckCheckJob's car-relevant outer guards and RequestSpace side effect. */
export function cs2StuckPathDecision(input: {
  self: number;
  target: number | null;
  ownerFlags: number;
  blocker: Cs2PathBlocker;
  blockers: ReadonlyMap<number, Cs2PathBlocker>;
  controllers?: ReadonlyMap<number, number>;
  isCar?: boolean;
  blockerIsParkedTrain?: boolean;
  blockerIsParkedCar?: boolean;
}) {
  const isCar = input.isCar ?? true;
  const initial = input.blocker;
  if (initial.blocker === null || initial.type === Cs2BlockerType.Temporary)
    return { flags: input.ownerFlags, requestSpaceFor: null };
  const controllers = input.controllers ?? new Map<number, number>();
  const requestSpaceFor =
    isCar && initial.type === Cs2BlockerType.Crossing
      ? (controllers.get(initial.blocker) ?? initial.blocker)
      : null;
  if (initial.maxSpeed >= 6)
    return { flags: input.ownerFlags, requestSpaceFor };
  const target =
    input.target === null
      ? null
      : (controllers.get(input.target) ?? input.target);
  const blocked =
    input.blockerIsParkedTrain ||
    (!isCar && input.blockerIsParkedCar) ||
    cs2BlockedPathChain(
      input.self,
      target,
      initial,
      input.blockers,
      controllers,
    );
  const flags =
    blocked && !(input.ownerFlags & Cs2PathFlags.Pending)
      ? input.ownerFlags | Cs2PathFlags.Stuck
      : input.ownerFlags;
  return { flags, requestSpaceFor };
}

/** TrafficBottleneckSystem.AddBottlenecks is notification policy, NOT a path
 * request. Source group counts include every entity in the continuing chain.
 */
export function classifyCs2TrafficBottleneck(
  groupCount: number,
  blocker: Cs2PathBlocker,
): "none" | "keep" | "add" {
  if (groupCount < 10) return "none";
  if (
    (blocker.type === Cs2BlockerType.Continuing && blocker.blocker !== null) ||
    groupCount < 50
  )
    return "keep";
  return "add";
}
