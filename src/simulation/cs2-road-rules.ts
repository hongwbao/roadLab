/** Source road rules from supplied Game.dll 1.6.0f1. See CS2_ROAD_RULES.md. */
export type Cs2RuleVector = { x: number; z: number };
export type Cs2TurnEndpoint = {
  position: Cs2RuleVector;
  /** Inward source/target ConnectPosition tangent, not both travel directions. */
  tangent: Cs2RuleVector;
};
export type Cs2RoadRuleArm = Cs2TurnEndpoint & {
  owner: string;
  priority: number;
  highway: boolean;
};
export type Cs2TurnClassification = {
  isTurn: boolean;
  right: boolean;
  gentle: boolean;
  uturn: boolean;
};
const f = Math.fround;
const saturate = (x: number) => Math.max(0, Math.min(1, x));
const dot = (ax: number, az: number, bx: number, bz: number) =>
  f(f(f(ax) * f(bx)) + f(f(az) * f(bz)));

/** NetCompositionSystem: lane counts exclude Master and other non-road lanes. */
export function cs2RoadCompositionPriority(input: {
  /** m/s: RoadPrefab km/h was converted by NetInitializeSystem first. */
  speedLimit: number;
  forwardLanes: number;
  backwardLanes: number;
  highwayRules: boolean;
  gravel?: boolean;
}) {
  let priority = f(input.speedLimit);
  if (input.gravel) priority = f(priority - f(1.25));
  const maximum = Math.max(input.forwardLanes, input.backwardLanes),
    total = input.forwardLanes + input.backwardLanes;
  return f(
    priority +
      (input.highwayRules
        ? maximum
        : f(f(maximum * f(0.5)) + f(total * f(0.25)))),
  );
}

/** NetUtils.IsTurn, preserving float32 operations and its geometric blending. */
export function cs2IsTurn(
  source: Cs2TurnEndpoint,
  target: Cs2TurnEndpoint,
): Cs2TurnClassification {
  const a = source.tangent,
    b = target.tangent,
    rx = f(a.z),
    rz = f(-a.x),
    px = f(f(source.position.x) - f(target.position.x)),
    pz = f(f(source.position.z) - f(target.position.z)),
    length = f(Math.sqrt(dot(px, pz, px, pz)));
  let x = -1,
    y = dot(a.x, a.z, b.x, b.z),
    z = 0,
    w = dot(rx, rz, b.x, b.z);
  if (length > f(0.1)) {
    const dx = f(px / length),
      dz = f(pz / length);
    x = dot(a.x, a.z, dx, dz);
    z = dot(rx, rz, dx, dz);
  }
  const tx = saturate(f(f(z * w) * f(-2))),
    ty = saturate(f(f(z * w) * f(-4))),
    tz = saturate(x),
    tw = saturate(y),
    oldZ = z,
    oldW = w;
  const lerp = (start: number, end: number, t: number) =>
    f(start + f(t * f(end - start)));
  x = lerp(x, -1, tx);
  y = lerp(y, -1, ty);
  z = lerp(z, oldW, tz);
  w = lerp(w, oldZ, tw);
  if (y > x) [x, y, z, w] = [y, x, w, z];
  return {
    isTurn: x > f(-0.9335804),
    right: z < 0,
    gentle: x > f(-0.9335804) && x <= f(-0.4848096),
    uturn: x > f(0.7547096),
  };
}

/**
 * LaneSystem.CalculateYieldOffset, with explicit node/arm snapshots replacing
 * ComponentLookup and NativeList. Incoming/outgoing must be source-compatible
 * road positions; owner identifies a road edge, not a vehicle or lane number.
 */
export function cs2CalculateYieldOffset(input: {
  source: Cs2RoadRuleArm;
  incoming: readonly Cs2RoadRuleArm[];
  outgoing: readonly Cs2RoadRuleArm[];
  allWayStop?: boolean;
  trafficLights?: boolean;
  levelCrossing?: boolean;
}) {
  if (input.allWayStop) return 2;
  if (input.levelCrossing || input.trafficLights) return 0;
  const source = input.source;
  let higherOwner: string | undefined;
  const higher = (arm: Cs2RoadRuleArm) =>
    f(f(arm.priority) - f(source.priority)) > f(0.99);
  for (const arm of input.incoming)
    if (
      arm.owner !== source.owner &&
      arm.owner !== higherOwner &&
      higher(arm)
    ) {
      if (higherOwner !== undefined) return 1;
      higherOwner = arm.owner;
    }
  if (higherOwner === undefined) {
    if (!source.highway) return 0;
    let alternatives = 0;
    for (const incoming of input.incoming) {
      let through = false;
      for (const outgoing of input.outgoing)
        if (outgoing.owner !== incoming.owner) {
          const turn = cs2IsTurn(incoming, outgoing);
          through ||= !turn.isTurn || turn.gentle;
        }
      if (through) {
        if (incoming.owner === source.owner) return 0;
        alternatives++;
      }
    }
    return alternatives >= 1 ? 1 : 0;
  }
  for (const target of input.outgoing)
    if (
      target.owner !== source.owner &&
      target.owner !== higherOwner &&
      higher(target)
    )
      return 1;
  return 0;
}

/** Original Game.Net.CarLaneFlags values used by the road builders below. */
export const CS2_ROAD_LANE_FLAGS = Object.freeze({
  unsafe: 0x1,
  uTurnLeft: 0x2,
  sideConnection: 0x8,
  turnLeft: 0x10,
  turnRight: 0x20,
  levelCrossing: 0x40,
  twoway: 0x80,
  runway: 0x200,
  yield: 0x400,
  stop: 0x800,
  secondaryStart: 0x1000,
  secondaryEnd: 0x2000,
  publicOnly: 0x8000,
  highway: 0x10000,
  uTurnRight: 0x20000,
  gentleTurnLeft: 0x40000,
  gentleTurnRight: 0x80000,
  forward: 0x100000,
  approach: 0x200000,
  roundabout: 0x400000,
  rightLimit: 0x800000,
  leftLimit: 0x1000000,
  forbidPassing: 0x2000000,
  rightOfWay: 0x4000000,
  trafficLights: 0x8000000,
  forbidden: 0x40000000,
});
export type Cs2NodeLaneFlagInput = {
  sourceHighway: boolean;
  targetHighway: boolean;
  yieldOffset: number;
  turn?: Cs2TurnClassification;
  isIntersection?: boolean;
  isUnsafe?: boolean;
  isForbidden?: boolean;
  isRoundabout?: boolean;
  isSideConnection?: boolean;
  isLeftLimit?: boolean;
  isRightLimit?: boolean;
  curviness?: number;
  sourceMultilaneBothDirections?: boolean;
  targetMultilaneBothDirections?: boolean;
  /** Both native lane prefab flags permit two-way use of ONE lane. */
  sharedTwoway?: boolean;
  publicOnly?: boolean;
  sourcePedestrian?: boolean;
  targetPedestrian?: boolean;
  runway?: boolean;
  trafficLights?: boolean;
  levelCrossing?: boolean;
};

/**
 * CreateNodeLane's road-lane flag writes, after a valid connection was selected.
 * This does not reproduce lane allocation, merge layers or owner deduplication.
 */
export function cs2NodeLaneFlags(input: Cs2NodeLaneFlagInput) {
  const F = CS2_ROAD_LANE_FLAGS,
    highway = input.sourceHighway && input.targetHighway,
    turn = input.turn ?? {
      isTurn: false,
      right: false,
      gentle: false,
      uturn: false,
    };
  let flags = 0;
  if (input.isUnsafe) flags |= F.unsafe;
  if (input.isForbidden) flags |= F.forbidden;
  if (input.isRoundabout) flags |= F.roundabout;
  if (input.isLeftLimit) flags |= F.leftLimit;
  if (input.isRightLimit) flags |= F.rightLimit;
  if (highway) flags |= F.highway;
  if (
    input.isIntersection ||
    input.isRoundabout ||
    turn.uturn ||
    input.isSideConnection
  ) {
    flags |= F.forbidPassing;
    flags |= turn.isTurn
      ? turn.gentle
        ? turn.right
          ? F.gentleTurnRight
          : F.gentleTurnLeft
        : turn.uturn
          ? turn.right
            ? F.uTurnRight
            : F.uTurnLeft
          : turn.right
            ? F.turnRight
            : F.turnLeft
      : F.forward;
  } else {
    if (
      highway &&
      (input.sourceMultilaneBothDirections ||
        input.targetMultilaneBothDirections)
    )
      flags |= F.forbidPassing;
    if (f(input.curviness ?? 0) > f(f(Math.PI) / (highway ? 360 : 180)))
      flags |= F.forbidPassing;
  }
  if (input.sharedTwoway) flags |= F.twoway;
  if (input.publicOnly) flags |= F.publicOnly;
  if (input.sourcePedestrian) flags |= F.secondaryStart;
  if (input.targetPedestrian) flags |= F.secondaryEnd;
  if (input.runway) flags |= F.runway;
  if (input.yieldOffset === 1) flags |= F.yield;
  else if (input.yieldOffset === 2) flags |= F.stop;
  else if (input.yieldOffset === -1) flags |= F.rightOfWay;
  if (input.trafficLights) flags |= F.trafficLights;
  if (input.levelCrossing) flags |= F.levelCrossing;
  return flags >>> 0;
}

/** Separate MiddleConnection builder, not an alias for Road.kind === ramp. */
export function cs2MiddleConnectionFlags(input: {
  source: boolean;
  highway: boolean;
  turnRight: boolean;
  trafficLights?: boolean;
  runway?: boolean;
  pedestrian?: boolean;
}) {
  const F = CS2_ROAD_LANE_FLAGS;
  let flags = F.unsafe | F.sideConnection;
  if (input.source) flags |= F.yield;
  if (input.highway) flags |= F.highway;
  if (input.trafficLights) flags |= F.trafficLights;
  if (input.runway) flags |= F.runway;
  if (input.pedestrian)
    flags |= input.source ? F.secondaryStart : F.secondaryEnd;
  flags |= input.turnRight ? F.turnRight : F.turnLeft;
  return flags >>> 0;
}
