import { cs2RoadCurveCurviness as cs2CreatedNodeCurveCurviness } from "../core/cs2-road-curviness";
export { cs2RoadCurveCurviness as cs2CreatedNodeCurveCurviness } from "../core/cs2-road-curviness";
/** Source CreateNodeLane and helpers; evidence boundaries: CS2_NODE_LANE_CREATION.md. */
import type { CS2Point } from "./cs2-driving";
import type {
  CS2LaneConnectPosition,
  CS2LaneCompositionFlags,
  CS2NodeLaneCreationRequest,
} from "./cs2-lane-generation";
import { cs2PackPathNode } from "../core/cs2-path-node";
import {
  cs2FitRoadCurve,
  cs2StraightRoadCurve,
  cs2RoadCurveLength,
  cs2RoadCurvePosition,
} from "../core/cs2-net-geometry";

type Entity = string | null;
type Cubic = readonly [CS2Point, CS2Point, CS2Point, CS2Point];
const f = Math.fround;
const lerp = (a: number, b: number, t: number) =>
  f(f(a) + f(f(t) * f(f(b) - f(a))));
const required = <K, V>(map: ReadonlyMap<K, V>, key: K, name: string): V => {
  const result = map.get(key);
  if (result === undefined) throw new Error(`Missing ${name}: ${String(key)}`);
  return result;
};
class SourceRandom {
  constructor(public state: number) {
    this.state >>>= 0;
  }
  draw() {
    const old = this.state;
    let n = old ^ (old << 13);
    n ^= n >>> 17;
    n ^= n << 5;
    this.state = n >>> 0;
    return old;
  }
  int(maximum: number) {
    return Number((BigInt(this.draw()) * BigInt(maximum >>> 0)) >> 32n);
  }
}

export type CS2NodePrefabWorld = {
  editorMode: boolean;
  defaultTheme: Entity;
  placeholders: ReadonlyMap<Entity, readonly Entity[]>;
  requirements: ReadonlyMap<
    Entity,
    readonly { group: number; requirement: Entity }[]
  >;
  spawnables: ReadonlyMap<
    Entity,
    { randomizationGroup: Entity; probability: number }
  >;
};
/** Full LaneSystem.CheckPrefab, including grouped theme requirements and draw order. */
export function cs2CheckNodeLanePrefab(
  world: CS2NodePrefabWorld,
  input: {
    prefab: Entity;
    randomState: number;
    selectedSpawnables: ReadonlyMap<Entity, number>;
  },
) {
  const random = new SourceRandom(input.randomState);
  const selectedSpawnables = new Map(input.selectedSpawnables);
  let prefab = input.prefab;
  if (!world.editorMode) {
    const placeholders = world.placeholders.get(prefab);
    if (placeholders !== undefined) {
      let score = -1;
      let entity: Entity = null;
      let key: Entity = null;
      let selectedState = 0;
      let probability = 0;
      for (const candidate of placeholders) {
        let candidateScore = 0;
        const requirements = world.requirements.get(candidate);
        if (requirements !== undefined) {
          let group = -1;
          let matches = true;
          for (const requirement of requirements) {
            if (requirement.group !== group) {
              if (!matches) break;
              group = requirement.group;
              matches = false;
            }
            matches = matches || requirement.requirement === world.defaultTheme;
          }
          if (!matches) continue;
        }
        const data = required(
          world.spawnables,
          candidate,
          "SpawnableObjectData",
        );
        const candidateKey = data.randomizationGroup ?? candidate;
        let candidateState = random.state;
        random.draw();
        random.draw();
        const prior = selectedSpawnables.get(candidateKey);
        if (prior !== undefined) {
          candidateScore = f(candidateScore + 0.5);
          candidateState = prior;
        }
        if (candidateScore > score) {
          score = candidateScore;
          entity = candidate;
          key = candidateKey;
          selectedState = candidateState;
          probability = data.probability;
        } else if (candidateScore === score) {
          probability = (probability + data.probability) | 0;
          if (random.int(probability) < data.probability) {
            entity = candidate;
            key = candidateKey;
            selectedState = candidateState;
          }
        }
      }
      if (random.int(100) < probability) {
        if (!selectedSpawnables.has(key))
          selectedSpawnables.set(key, selectedState);
        prefab = entity;
        return {
          accepted: true,
          prefab,
          randomState: random.state,
          outRandomState: selectedState,
          selectedSpawnables,
        };
      }
      const outRandomState = random.state;
      random.draw();
      random.draw();
      return {
        accepted: false,
        prefab,
        randomState: random.state,
        outRandomState,
        selectedSpawnables,
      };
    }
    const data = world.spawnables.get(prefab);
    const key = data?.randomizationGroup ?? prefab;
    let outRandomState = random.state;
    random.draw();
    random.draw();
    const prior = selectedSpawnables.get(key);
    if (prior !== undefined) outRandomState = prior;
    else selectedSpawnables.set(key, outRandomState);
    return {
      accepted: true,
      prefab,
      randomState: random.state,
      outRandomState,
      selectedSpawnables,
    };
  }
  const outRandomState = random.state;
  random.draw();
  random.draw();
  return {
    accepted: true,
    prefab,
    randomState: random.state,
    outRandomState,
    selectedSpawnables,
  };
}

export type CS2NodeCreationComposition = {
  flags: CS2LaneCompositionFlags;
  state: number;
  surfaceHeightMin: number;
};
export type CS2NodeLanePrefabSelectionWorld = {
  compositions: ReadonlyMap<Entity, CS2NodeCreationComposition>;
  carLanes: ReadonlyMap<
    Entity,
    { notBusLanePrefab: Entity; notTrackLanePrefab: Entity }
  >;
  trackLanes: ReadonlyMap<
    Entity,
    { fallbackPrefab: Entity; maxCurviness: number }
  >;
  pedestrianLanes: ReadonlyMap<Entity, { notWalkLanePrefab: Entity }>;
};
const plus = (a: number, b: number) => f(f(a) + f(b));
const minus = (a: number, b: number) => f(f(a) - f(b));
const times = (a: number, b: number) => f(f(a) * f(b));
const subtract = (a: CS2Point, b: CS2Point): CS2Point => ({
  x: minus(a.x, b.x),
  y: minus(a.y, b.y),
  z: minus(a.z, b.z),
});
const scaled = (v: CS2Point, n: number): CS2Point => ({
  x: times(v.x, n),
  y: times(v.y, n),
  z: times(v.z, n),
});
const added = (a: CS2Point, b: CS2Point): CS2Point => ({
  x: plus(a.x, b.x),
  y: plus(a.y, b.y),
  z: plus(a.z, b.z),
});
const dot = (a: CS2Point, b: CS2Point) =>
  plus(plus(times(a.x, b.x), times(a.y, b.y)), times(a.z, b.z));
const distance = (a: CS2Point, b: CS2Point) => {
  const d = subtract(a, b);
  return f(Math.sqrt(dot(d, d)));
};
const distanceXZ = (a: CS2Point, b: CS2Point) => {
  const d = subtract(a, b);
  return f(Math.sqrt(f(f(d.x * d.x) + f(d.z * d.z))));
};

/** Full original CanConnectTrack helper used by fallback prefab selection. */
export function cs2CanConnectCreatedNodeTrack(input: {
  isUTurn: boolean;
  isRoundabout: boolean;
  source: CS2LaneConnectPosition;
  target: CS2LaneConnectPosition;
  maxCurviness?: number;
}) {
  const { source, target } = input;
  if (
    input.isUTurn ||
    input.isRoundabout ||
    (source.lane.flags | target.lane.flags) & 4 ||
    !(source.lane.flags & target.lane.flags & 64) ||
    input.maxCurviness === undefined
  )
    return false;
  const a = { ...source.tangent, y: 0 },
    b = { ...target.tangent, y: 0 };
  const angle = f(Math.acos(Math.max(-1, Math.min(1, dot(a, scaled(b, -1))))));
  const curviness = f(
    f(2 * f(Math.sin(f(angle * 0.5)))) /
      Math.max(1, distance(source.position, target.position)),
  );
  return (
    curviness <= f(input.maxCurviness) &&
    source.trackTypes === target.trackTypes
  );
}

/** Complete prefab-role/fallback choice at the beginning of CreateNodeLane. */
export function cs2SelectCreatedNodeLanePrefab(
  world: CS2NodeLanePrefabSelectionWorld,
  request: CS2NodeCarCreationParameters,
) {
  const source = request.source,
    target = request.target;
  let laneFlags = 0,
    prefab: Entity = null;
  if (request.trackOnly) {
    laneFlags = source.lane.flags & ~(2 | 4);
    prefab = source.lane.prefab;
    if ((laneFlags & (8 | 64)) === (8 | 64)) {
      laneFlags &= ~8;
      prefab = required(
        world.trackLanes,
        prefab,
        "TrackLaneData",
      ).fallbackPrefab;
    }
  } else {
    const selected =
      source.lane.flags & 4
        ? source
        : target.lane.flags & 4
          ? target
          : source.lane.flags & 2
            ? source
            : target.lane.flags & 2
              ? target
              : source;
    laneFlags = selected.lane.flags;
    prefab = selected.lane.prefab;
    const score = (p: CS2LaneConnectPosition) => {
      let n = p.composition.roadFlags & 16 ? 1 : 0;
      const composition = world.compositions.get(p.edgeComposition);
      if (composition) {
        if (composition.flags.general & 0x8000000) n += 2;
        if (composition.flags.general & 0x4000000) n -= 4;
      }
      if (p.lane.flags & (16 | 0x2000000)) n += 8;
      return n;
    };
    const a = score(source),
      b = score(target);
    if (a > b && prefab !== source.lane.prefab) {
      laneFlags = (laneFlags & (2 | 4)) | (source.lane.flags & ~(2 | 4));
      prefab = source.lane.prefab;
    }
    if (b > a && prefab !== target.lane.prefab) {
      laneFlags = (laneFlags & (2 | 4)) | (target.lane.flags & ~(2 | 4));
      prefab = target.lane.prefab;
    }
    if (
      (laneFlags & (8 | 0x4000)) === (8 | 0x4000) &&
      !(source.lane.flags & target.lane.flags & 0x4000)
    ) {
      laneFlags &= ~0x4000;
      prefab = required(world.carLanes, prefab, "CarLaneData").notBusLanePrefab;
    }
    if (
      (laneFlags & (8 | 64)) === (8 | 64) &&
      !cs2CanConnectCreatedNodeTrack({
        source,
        target,
        isUTurn: request.isUTurn,
        isRoundabout: request.isRoundabout,
        maxCurviness: world.trackLanes.get(prefab)?.maxCurviness,
      })
    ) {
      laneFlags &= ~64;
      prefab = required(
        world.carLanes,
        prefab,
        "CarLaneData",
      ).notTrackLanePrefab;
    }
    if (laneFlags & 16) {
      laneFlags = (laneFlags & ~16) | 8;
      prefab = required(
        world.pedestrianLanes,
        prefab,
        "PedestrianLaneData",
      ).notWalkLanePrefab;
    }
  }
  return { laneFlags: laneFlags >>> 0, prefab };
}

/** Source NodeLane width offsets and bicycle flags, before overlap counts. */
export function cs2CreateNodeLaneWidthOffsets(input: {
  selectedWidth: number;
  sourcePrefab?: { width: number; flags: number };
  targetPrefab?: { width: number; flags: number };
  laneFlags: number;
}) {
  let start = 0,
    end = 0,
    flags = 0;
  if (input.laneFlags & 8) {
    if (input.sourcePrefab)
      start = f(f(input.sourcePrefab.width) - f(input.selectedWidth));
    if (input.targetPrefab)
      end = f(f(input.targetPrefab.width) - f(input.selectedWidth));
    if (start !== 0) flags |= 1;
    if (end !== 0) flags |= 2;
    if ((input.sourcePrefab?.flags ?? 0) & 0x2000000) flags |= 4;
    if ((input.targetPrefab?.flags ?? 0) & 0x2000000) flags |= 8;
  }
  return {
    widthOffset: { x: start, y: end },
    flags,
    sharedStartCount: 0,
    sharedEndCount: 0,
  };
}

export type CS2NodeCreationPiece = {
  flags: number;
  offset: CS2Point;
  size: CS2Point;
};
/** Actual source curve/height/hanging/U-turn adjustments for one resolved lane. */
export function cs2BuildCreatedNodeLaneGeometry(input: {
  request: CS2NodeCarCreationParameters;
  sourceComposition: CS2NodeCreationComposition;
  targetComposition: CS2NodeCreationComposition;
  laneFlags: number;
  selectedWidth: number;
  widthOffset: { x: number; y: number };
  utilityHanging?: number;
  sourcePieces?: readonly CS2NodeCreationPiece[];
}) {
  const p = input.request,
    s = p.source,
    t = p.target;
  let shortConnection = distance(s.position, t.position) < f(0.1);
  let curve: Cubic = shortConnection
    ? cs2StraightRoadCurve(s.position, t.position)
    : p.fixedTangents
      ? [
          s.position,
          added(s.position, s.tangent),
          added(t.position, t.tangent),
          t.position,
        ]
      : cs2FitRoadCurve(
          s.position,
          s.tangent,
          scaled(t.tangent, -1),
          t.position,
        );
  curve = cs2ModifyNodeLaneCurveHeight(
    curve,
    { baseHeight: s.baseHeight, composition: input.sourceComposition },
    { baseHeight: t.baseHeight, composition: input.targetComposition },
  );
  let utilityFlags = 0,
    hasHanging = false,
    hangingDistance = 0;
  if (input.laneFlags & 0x800) {
    if (input.utilityHanging === undefined)
      throw new Error("Missing UtilityLaneData");
    if (f(input.utilityHanging) !== 0) {
      const sag = f(
        f(distanceXZ(curve[0], curve[3]) * f(input.utilityHanging)) *
          f(1.3333334),
      );
      const b = {
        x: lerp(curve[0].x, curve[3].x, f(1 / 3)),
        y: f(lerp(curve[0].y, curve[3].y, f(1 / 3)) - sag),
        z: lerp(curve[0].z, curve[3].z, f(1 / 3)),
      };
      const c = {
        x: lerp(curve[0].x, curve[3].x, f(2 / 3)),
        y: f(lerp(curve[0].y, curve[3].y, f(2 / 3)) - sag),
        z: lerp(curve[0].z, curve[3].z, f(2 / 3)),
      };
      curve = [curve[0], b, c, curve[3]];
      hangingDistance = f(0.1);
      hasHanging = true;
    }
    if (input.laneFlags & 0x20000) {
      utilityFlags |= 3;
      hangingDistance = 0;
    }
  }
  if (
    input.laneFlags & 8 &&
    p.isUTurn &&
    s.owner === t.owner &&
    s.lane.carriageway !== t.lane.carriageway
  ) {
    if (!input.sourcePieces)
      throw new Error("Missing source composition pieces for U-turn");
    const lengths = [
      distanceXZ(curve[0], curve[1]),
      distanceXZ(curve[3], curve[2]),
    ];
    let correction = [f(-3.4028234663852886e38), f(-3.4028234663852886e38)];
    for (const piece of input.sourcePieces)
      if (piece.flags & 2) {
        const positions = [
          minus(s.lane.position.x, piece.offset.x),
          minus(t.lane.position.x, piece.offset.x),
        ];
        if (positions[0] > 0 !== positions[1] > 0) {
          let offsets = positions.map((v, i) =>
            f(
              Math.abs(v) -
                f(
                  f(input.selectedWidth) +
                    (i === 0 ? input.widthOffset.x : input.widthOffset.y),
                ),
            ),
          );
          offsets = offsets.map((v) =>
            times(
              minus(plus(piece.size.z, times(piece.size.x, 0.5)), v),
              1.3333334,
            ),
          );
          const previous = [...offsets];
          offsets = offsets.map((v, i) =>
            f(v + Math.max(0, f(v - Math.max(0, previous[1 - i])))),
          );
          correction = correction.map((v, i) =>
            Math.max(v, f(offsets[i] - lengths[i])),
          );
        }
      }
    if (correction.some((v) => v > 0)) {
      const previous = [...correction];
      correction = correction.map((v, i) =>
        Math.max(
          v,
          Math.max(Math.min(0, f(-previous[1 - i])), f(lengths[i] * -0.5)),
        ),
      );
      curve = [
        curve[0],
        added(curve[1], scaled(s.tangent, correction[0])),
        added(curve[2], scaled(t.tangent, correction[1])),
        curve[3],
      ];
    }
  }
  return {
    points: curve,
    length: cs2RoadCurveLength(curve),
    shortConnection,
    utilityLane: { flags: utilityFlags },
    hangingLane: { distances: { x: hangingDistance, y: hangingDistance } },
    hasHanging,
  };
}

/** Initial source Master/Slave components before lane-group range propagation. */
export function cs2CreateNodeLaneMembership(input: {
  laneFlags: number;
  group: number;
  laneIndex: number;
  isMergeLeft: boolean;
  isMergeRight: boolean;
}) {
  const index = input.laneIndex & 65535,
    group = input.group >>> 0;
  const master =
    input.laneFlags & 4
      ? { flags: 0, group, minIndex: 0, maxIndex: 0 }
      : undefined;
  const slave =
    input.laneFlags & 2
      ? {
          flags: input.isMergeLeft || input.isMergeRight ? 16 : 0,
          group,
          minIndex: index,
          maxIndex: index,
          subIndex: index,
          masterIndex: 0,
        }
      : undefined;
  return { master, slave };
}

const cross = (a: CS2Point, b: CS2Point): CS2Point => ({
  x: minus(times(a.y, b.z), times(a.z, b.y)),
  y: minus(times(a.z, b.x), times(a.x, b.z)),
  z: minus(times(a.x, b.y), times(a.y, b.x)),
});
const determinant = (a: CS2Point, b: CS2Point, c: CS2Point) =>
  dot(a, cross(b, c));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function sourcePointLineDistance(
  line: readonly [CS2Point, CS2Point],
  p: CS2Point,
) {
  const tangent = subtract(line[1], line[0]),
    delta = subtract(p, line[0]),
    square = dot(tangent, tangent);
  const t = square !== 0 ? clamp01(f(dot(tangent, delta) / square)) : 0;
  return { distance: distance(scaled(tangent, t), delta), t };
}
function sourceLineLineDistance(
  a: readonly [CS2Point, CS2Point],
  b: readonly [CS2Point, CS2Point],
) {
  const ta = subtract(a[1], a[0]),
    tb = subtract(b[1], b[0]),
    delta = subtract(a[0], b[0]),
    normal = cross(ta, tb);
  let n = determinant(ta, normal, tb);
  if (n === 0) {
    const candidates = [
      sourcePointLineDistance(b, a[0]),
      sourcePointLineDistance(b, a[1]),
      sourcePointLineDistance(a, b[0]),
      sourcePointLineDistance(a, b[1]),
    ];
    let best = {
      distance: candidates[0].distance,
      t: { x: 0, y: candidates[0].t },
    };
    const params = [
      { x: 1, y: candidates[1].t },
      { x: candidates[2].t, y: 0 },
      { x: candidates[3].t, y: 1 },
    ];
    for (let i = 1; i < candidates.length; i++)
      if (candidates[i].distance < best.distance)
        best = { distance: candidates[i].distance, t: params[i - 1] };
    return best;
  }
  let x = clamp01(f(determinant(delta, tb, normal) / n)),
    y = clamp01(f(determinant(ta, normal, delta) / n));
  if (x === 0 || x === 1) {
    const out = sourcePointLineDistance(b, a[x]);
    return { distance: out.distance, t: { x, y: out.t } };
  }
  if (y === 0 || y === 1) {
    const out = sourcePointLineDistance(a, b[y]);
    return { distance: out.distance, t: { x: out.t, y } };
  }
  n = f(determinant(ta, tb, delta) / n);
  // Preserve the original non-boundary return expression, including its square.
  return { distance: times(dot(normal, normal), times(n, n)), t: { x, y } };
}
/** Full original MathUtils.Distance(Bezier4x3,Line3.Segment) refinement. */
export function cs2CreatedNodeCurveLineDistance(
  curve: Cubic,
  line: readonly [CS2Point, CS2Point],
) {
  let best = f(3.4028234663852886e38),
    tx = 0,
    ty = 0,
    start = 0,
    a = curve[0];
  for (let i = 1; i <= 16; i++) {
    const next = f(i / 16),
      p = cs2RoadCurvePosition(curve, next),
      result = sourceLineLineDistance([a, p], line);
    if (result.distance < best) {
      best = result.distance;
      tx = lerp(start, next, result.t.x);
    }
    start = next;
    a = p;
  }
  let step = f(1 / 32);
  for (let i = 0; i < 4; i++) {
    const b = cs2RoadCurvePosition(curve, Math.max(0, minus(tx, step))),
      center = cs2RoadCurvePosition(curve, tx),
      c = cs2RoadCurvePosition(curve, Math.min(1, plus(tx, step)));
    const left = sourceLineLineDistance([center, b], line),
      right = sourceLineLineDistance([center, c], line);
    if (left.distance < right.distance) {
      tx = Math.max(0, minus(tx, times(step, left.t.x)));
      ty = left.t.y;
      best = left.distance;
    } else {
      tx = Math.min(1, plus(tx, times(step, right.t.x)));
      ty = right.t.y;
      best = right.distance;
    }
    step = times(step, 0.5);
  }
  return { distance: best, t: { x: tx, y: ty } };
}
export type CS2CreatedNodeMiddleConnection = {
  connectPosition: CS2LaneConnectPosition;
  sourceEdge: Entity;
  sourceNode: Entity;
  targetCurve: { points: Cubic; length: number };
  targetCurvePos: number;
  distance: number;
  targetComposition: CS2LaneConnectPosition["composition"];
  targetLane: Entity;
  targetOwner: Entity;
  targetFlags: number;
  targetGroup: number;
  sortIndex: number;
  targetNode: bigint;
  targetCarriageway: number;
  isSource: boolean;
};
/** Complete middle-connection update block inside original CreateNodeLane. */
export function cs2UpdateCreatedNodeMiddleConnections(input: {
  request: CS2NodeCarCreationParameters;
  prefab: Entity;
  laneFlags: number;
  curve: { points: Cubic; length: number };
  carLaneFlags: number;
  carriagewayGroup: number;
  middleNode: bigint;
  middleConnections: readonly CS2CreatedNodeMiddleConnection[];
}) {
  const p = input.request,
    result = input.middleConnections.map(copyMiddleConnection);
  if (input.carLaneFlags & 1) return result;
  for (let m = 0; m < result.length; m++) {
    let value = structuredClone(result[m]);
    if (
      value.connectPosition.roadTypes === 0 ||
      (p.isRoundabout &&
        p.roadPassThrough !== 0 &&
        ((p.source.owner === p.owner && !value.isSource) ||
          (p.target.owner === p.owner && value.isSource)))
    )
      continue;
    let flags = input.laneFlags;
    if (value.connectPosition.lane.flags & 4) {
      if (flags & 2) continue;
      flags |= 4;
    } else if (value.connectPosition.lane.flags & 2) {
      if (flags & 4) continue;
      flags |= 2;
    }
    const group = p.isRoundabout
      ? (p.group | (p.group << 16)) >>> 0
      : p.group >>> 0;
    const mask =
      p.isRoundabout || input.laneFlags & 4
        ? 0xffffffff
        : value.isSource
          ? 0xffff0000
          : 0xffff;
    let index = m;
    if (value.targetLane !== null) {
      value.distance = f(3.4028234663852886e38);
      index = -1;
      for (; m < result.length; m++) {
        const candidate = result[m];
        if (candidate.sortIndex !== value.sortIndex) break;
        if (
          ((candidate.targetGroup ^ group) & mask) === 0 &&
          (((candidate.targetFlags ^ flags) & (4 | 0x2000000)) === 0 ||
            (candidate.targetFlags & flags & 4) !== 0)
        ) {
          value = structuredClone(candidate);
          index = m;
        }
      }
      m--;
    }
    const points = [...input.curve.points, value.connectPosition.position];
    const sizes = { x: 0, y: 0, z: 0 };
    for (const axis of ["x", "y", "z"] as const)
      sizes[axis] = minus(
        Math.max(...points.map((v) => v[axis])),
        Math.min(...points.map((v) => v[axis])),
      );
    const length = f(Math.sqrt(dot(sizes, sizes)));
    const query = cs2CreatedNodeCurveLineDistance(input.curve.points, [
      value.connectPosition.position,
      added(
        value.connectPosition.position,
        scaled(value.connectPosition.tangent, length),
      ),
    ]);
    const score = plus(query.distance, times(length, query.t.y));
    let curvePos = query.t.x;
    if (p.roadPassThrough !== 0)
      curvePos = value.isSource
        ? lerp(curvePos, 1, 0.5)
        : lerp(0, curvePos, 0.5);
    if (score < value.distance) {
      value.distance = score;
      value.targetLane = input.prefab;
      value.targetOwner = value.isSource ? p.source.owner : p.target.owner;
      value.targetGroup = group;
      value.targetNode = input.middleNode;
      value.targetCarriageway = input.carriagewayGroup;
      value.targetComposition = structuredClone(
        value.isSource ? p.target.composition : p.source.composition,
      );
      value.targetCurve = structuredClone(input.curve);
      value.targetCurvePos = curvePos;
      value.targetFlags = flags >>> 0;
      if (index !== -1) result[index] = value;
      else result.splice(++m, 0, value);
    }
  }
  return result;
}
export type CS2CreatedNodeAuxiliaryLane = {
  prefab: Entity;
  position: CS2Point;
  spacing: CS2Point;
  compositionAll: CS2LaneCompositionFlags;
  compositionAny: CS2LaneCompositionFlags;
  compositionNone: CS2LaneCompositionFlags;
  flags: number;
};
function testAuxiliaryFlags(
  lane: CS2CreatedNodeAuxiliaryLane,
  flags: CS2LaneCompositionFlags,
) {
  for (const key of ["general", "left", "right"] as const)
    if (
      ((lane.compositionAll[key] | lane.compositionNone[key]) & flags[key]) >>>
        0 !==
      lane.compositionAll[key] >>> 0
    )
      return false;
  if (
    (lane.compositionAny.general |
      lane.compositionAny.left |
      lane.compositionAny.right) ===
    0
  )
    return true;
  return (["general", "left", "right"] as const).some(
    (key) => (lane.compositionAny[key] & flags[key]) !== 0,
  );
}
export type CS2CreatedNodeEndGeometry = {
  middleRadius: number;
  left: readonly [CS2Point, CS2Point];
  right: readonly [CS2Point, CS2Point];
};
/** Full CalculateAuxialryZOffset, using actual node-end boundary lines. */
export function cs2CreatedNodeAuxiliaryZOffset(
  position: CS2Point,
  tangent: CS2Point,
  geometry: CS2CreatedNodeEndGeometry,
  composition: CS2NodeCreationComposition & { width: number },
  lane: CS2CreatedNodeAuxiliaryLane,
) {
  let amount = f(lane.position.z);
  const intersect = (line: readonly [CS2Point, CS2Point]) => {
    const a = subtract(added(position, tangent), position),
      b = subtract(line[1], line[0]),
      delta = subtract(position, line[0]);
    const denominator = minus(times(a.x, b.z), times(a.z, b.x));
    return denominator !== 0
      ? f(minus(times(delta.z, b.x), times(delta.x, b.z)) / denominator)
      : undefined;
  };
  const limit = (line: readonly [CS2Point, CS2Point]) => {
    const t = intersect(line);
    if (t !== undefined) amount = Math.max(0, Math.min(amount, times(t, 0.5)));
  };
  if (composition.flags.general & 16)
    amount = Math.max(0, Math.min(amount, times(composition.width, 0.125)));
  else if (f(geometry.middleRadius) > 0) limit(geometry.right);
  else {
    limit(geometry.left);
    limit(geometry.right);
  }
  return scaled(tangent, amount);
}
export function cs2DeriveCreatedNodeTrackLane(input: {
  request: CS2NodeCarCreationParameters;
  laneFlags: number;
  sourceComposition: CS2NodeCreationComposition;
  targetComposition: CS2NodeCreationComposition;
  curviness: number;
  curve: { points: Cubic; length: number; width: number };
  maxCurviness?: number;
  skipCandidate: boolean;
  hasSignal: boolean;
}) {
  const p = input.request,
    s = p.source,
    t = p.target;
  const curviness =
    f(input.curviness) < 0
      ? cs2CreatedNodeCurveCurviness(
          input.curve.points,
          input.curve.length,
          input.curve.width,
        )
      : f(input.curviness);
  const track = {
    accessRestriction: null as Entity,
    flags: 0,
    speedLimit: lerp(s.composition.speedLimit, t.composition.speedLimit, 0.5),
    curviness,
  };
  let skipped = input.skipCandidate,
    hasSignal = input.hasSignal;
  if (track.curviness > f(1e-6) && input.maxCurviness !== undefined)
    track.curviness = Math.min(track.curviness, f(input.maxCurviness));
  if (s.lane.flags & t.lane.flags & 128) {
    const a = s.isEnd === !(s.lane.flags & 1),
      b = t.isEnd === !(t.lane.flags & 1);
    if (a !== b) {
      if (b)
        return {
          allowed: false,
          trackLane: track,
          curviness,
          skipped,
          hasSignal,
        };
    } else if (s.ownerIndex >= t.ownerIndex)
      return {
        allowed: false,
        trackLane: track,
        curviness,
        skipped,
        hasSignal,
      };
  }
  if ((s.lane.flags | t.lane.flags) & 128) track.flags |= 2;
  if (!(input.laneFlags & 8)) track.flags |= 16;
  if (input.sourceComposition.flags.general & 0x400) {
    hasSignal = true;
    skipped = false;
  }
  if (input.sourceComposition.flags.general & 0x80) {
    track.flags |= 32;
    hasSignal = true;
    skipped = false;
  }
  if (
    (input.sourceComposition.flags.left |
      input.sourceComposition.flags.right |
      input.targetComposition.flags.left |
      input.targetComposition.flags.right) &
    (0x100 | 0x200)
  )
    track.flags |= 0x800;
  if (input.sourceComposition.flags.general & 32 && p.isTurn)
    track.flags |= p.isRight ? 0x2000 : 0x1000;
  return { allowed: true, trackLane: track, curviness, skipped, hasSignal };
}
/** Full source ModifyCurveHeight; returns a copy and preserves float32 updates. */
export function cs2ModifyNodeLaneCurveHeight(
  input: Cubic,
  source: { baseHeight: number; composition: CS2NodeCreationComposition },
  target: { baseHeight: number; composition: CS2NodeCreationComposition },
): [CS2Point, CS2Point, CS2Point, CS2Point] {
  const curve = input.map((v) => ({ x: f(v.x), y: f(v.y), z: f(v.z) })) as [
    CS2Point,
    CS2Point,
    CS2Point,
    CS2Point,
  ];
  const startSurface = f(
    f(source.baseHeight) + f(source.composition.surfaceHeightMin),
  );
  const endSurface = f(
    f(target.baseHeight) + f(target.composition.surfaceHeightMin),
  );
  const maxY = Math.max(curve[0].y, curve[3].y);
  const minY = Math.min(curve[0].y, curve[3].y);
  if (source.composition.flags.general & (0x40 | 0x80)) {
    const correction = f(
      Math.max(0, f(minY - curve[1].y)) - Math.max(0, f(curve[1].y - maxY)),
    );
    curve[1].y = f(curve[1].y + f(correction * f(2 / 3)));
  }
  if (target.composition.flags.general & (0x40 | 0x80)) {
    const correction = f(
      Math.max(0, f(minY - curve[2].y)) - Math.max(0, f(curve[2].y - maxY)),
    );
    curve[2].y = f(curve[2].y + f(correction * f(2 / 3)));
  }
  curve[1].y = f(
    curve[1].y +
      f(
        Math.max(0, f(startSurface - Math.max(curve[0].y, curve[1].y))) *
          f(1.3333334),
      ),
  );
  curve[2].y = f(
    curve[2].y +
      f(
        Math.max(0, f(endSurface - Math.max(curve[3].y, curve[2].y))) *
          f(1.3333334),
      ),
  );
  return curve;
}

export type CS2CreatedNodeCarLane = {
  accessRestriction: Entity;
  flags: number;
  defaultSpeedLimit: number;
  speedLimit: number;
  curviness: number;
  carriagewayGroup: number;
  blockageStart: number;
  blockageEnd: number;
  cautionStart: number;
  cautionEnd: number;
  flowOffset: number;
  laneCrossCount: number;
};
export type CS2NodeCarCreationParameters = Omit<
  CS2NodeLaneCreationRequest,
  "isRoundabout" | "fixedTangents" | "trackOnly"
> & {
  isRoundabout: boolean;
  fixedTangents: boolean;
  trackOnly: boolean;
};
/** Complete original CarLane component block inside CreateNodeLane. */
export function cs2DeriveCreatedNodeCarLane(input: {
  request: CS2NodeCarCreationParameters;
  sourceComposition: CS2NodeCreationComposition;
  sourceEdgeCompositionState?: number;
  targetEdgeCompositionState?: number;
  curviness: number;
  curve?: { points: Cubic; length: number; width: number };
  shortConnection: boolean;
}) {
  const p = input.request;
  const source = p.source;
  const target = p.target;
  let curviness = f(input.curviness);
  if (curviness < 0) {
    if (!input.curve)
      throw new Error("Missing curve geometry for negative source curviness");
    curviness = cs2CreatedNodeCurveCurviness(
      input.curve.points,
      input.curve.length,
      input.curve.width,
    );
  }
  const car: CS2CreatedNodeCarLane = {
    accessRestriction: null,
    flags: 0,
    defaultSpeedLimit: lerp(
      source.composition.speedLimit,
      target.composition.speedLimit,
      0.5,
    ),
    speedLimit: 0,
    curviness,
    carriagewayGroup: 0,
    blockageStart: 0,
    blockageEnd: 0,
    cautionStart: 0,
    cautionEnd: 0,
    flowOffset: 0,
    laneCrossCount: 0,
  };
  let skipped = input.shortConnection;
  let hasSignal = false;
  const highway =
    (source.composition.roadFlags & target.composition.roadFlags & 16) !== 0;
  if (p.isUnsafe) car.flags |= 1;
  if (p.isForbidden) car.flags |= 0x40000000;
  if (p.isRoundabout) car.flags |= 0x400000;
  if (p.isLeftLimit) car.flags |= 0x1000000;
  if (p.isRightLimit) car.flags |= 0x800000;
  if (highway) car.flags |= 0x10000;
  if (
    input.sourceComposition.flags.general & 32 ||
    p.isRoundabout ||
    p.isUTurn ||
    source.isSideConnection
  ) {
    car.carriagewayGroup = 0;
    car.flags |= 0x2000000;
    if (p.isTurn) {
      if (p.isGentle) car.flags |= p.isRight ? 0x80000 : 0x40000;
      else if (p.isUTurn) car.flags |= p.isRight ? 0x20000 : 2;
      else car.flags |= p.isRight ? 32 : 16;
    } else car.flags |= 0x100000;
  } else {
    car.carriagewayGroup =
      source.ownerIndex >= target.ownerIndex
        ? target.lane.carriageway
        : source.lane.carriageway;
    if (highway) {
      const multi = 8 | 0x40 | 0x1000;
      if (
        input.sourceEdgeCompositionState !== undefined &&
        (input.sourceEdgeCompositionState & multi) === multi
      )
        car.flags |= 0x2000000;
      if (
        input.targetEdgeCompositionState !== undefined &&
        (input.targetEdgeCompositionState & multi) === multi
      )
        car.flags |= 0x2000000;
    }
    const threshold = highway ? f(f(Math.PI) / 360) : f(f(Math.PI) / 180);
    if (car.curviness > threshold) car.flags |= 0x2000000;
  }
  if ((source.lane.flags & target.lane.flags & 128) !== 0) {
    if (source.ownerIndex >= target.ownerIndex)
      return { allowed: false, carLane: car, skipped, hasSignal };
    car.flags |= 128;
  }
  if ((source.lane.flags & target.lane.flags & 0x4000) !== 0)
    car.flags |= 0x8000;
  if (source.lane.flags & 16) car.flags |= 0x1000;
  if (target.lane.flags & 16) car.flags |= 0x2000;
  if (source.composition.taxiwayFlags & target.composition.taxiwayFlags & 1)
    car.flags |= 0x200;
  if (p.yieldValue === 1) {
    car.flags |= 0x400;
    skipped = false;
  } else if (p.yieldValue === 2) {
    car.flags |= 0x800;
    skipped = false;
  } else if (p.yieldValue === -1) {
    car.flags |= 0x4000000;
    skipped = false;
  }
  if (p.intersectionFlags.general & 0x400) {
    car.flags |= 0x8000000;
    hasSignal = true;
    skipped = false;
  }
  if (input.sourceComposition.flags.general & 0x80) {
    car.flags |= 0x40;
    hasSignal = true;
    skipped = false;
  }
  car.flags >>>= 0;
  return { allowed: true, carLane: car, skipped, hasSignal };
}

/** Original major/auxiliary PathNode allocation; counter conversion is ushort. */
export function cs2AllocateCreatedNodeLaneNodes(input: {
  source: CS2LaneConnectPosition;
  target: CS2LaneConnectPosition;
  ownerIndex: number;
  nodeLaneIndex: number;
  auxiliary: boolean;
}) {
  let next = input.nodeLaneIndex;
  const node = () => {
    const result = cs2PackPathNode({
      owner: input.ownerIndex,
      lane: next & 65535,
    });
    next = (next + 1) | 0;
    return result;
  };
  const start = input.auxiliary
    ? node()
    : cs2PackPathNode({
        owner: input.source.ownerIndex,
        lane: input.source.lane.index,
        segment: input.source.segmentIndex,
      });
  const middle = node();
  const end = input.auxiliary
    ? node()
    : cs2PackPathNode({
        owner: input.target.ownerIndex,
        lane: input.target.lane.index,
        segment: input.target.segmentIndex,
      });
  return { nodes: [start, middle, end] as const, nodeLaneIndex: next };
}

export type CS2CreatedNodeLaneNodes = readonly [bigint, bigint, bigint];
export type CS2NodeLaneCommand = { jobIndex: number } & (
  | { kind: "create"; entity: string; archetype: string }
  | { kind: "set" | "add"; entity: string; component: string; value: unknown }
  | {
      kind: "add-types" | "remove-types";
      entity: string;
      components: readonly string[];
    }
);
export type CS2NodeLaneCommitWorld = {
  entityIndices: ReadonlyMap<Entity, number>;
  temp: ReadonlyMap<Entity, { original: Entity; flags: number }>;
  edges: ReadonlySet<Entity>;
  pseudoRandomSeeds: ReadonlyMap<Entity, number>;
  laneSignals: ReadonlySet<Entity>;
  archetypes: ReadonlyMap<
    Entity,
    { node: string; slave: string; master: string }
  >;
};
export type CS2NodeLaneCommitBuffers = {
  oldLanes: ReadonlyMap<string, string>;
  originalLanes: ReadonlyMap<string, string>;
  updates: readonly string[];
};
export const cs2CreatedNodeLaneKey = (
  nodes: CS2CreatedNodeLaneNodes,
  prefab: Entity,
  laneFlags: number,
) => JSON.stringify([nodes.map(String), prefab, laneFlags & (2 | 4)]);
export function cs2CreatedNodeLaneTemp(ownerTemp: {
  original: Entity;
  flags: number;
}) {
  let flags = ownerTemp.flags & (1 | 2 | 0x20 | 0x40 | 0x400);
  if (ownerTemp.flags & 0x100) flags |= 0x40;
  return { original: null as Entity, flags };
}
/**
 * Source CreateNodeLane skip, temporary-owner identity, pseudo-seed and complete
 * old/new entity command tail. World components are read-only until playback.
 */
export function cs2CommitCreatedNodeLane(
  world: CS2NodeLaneCommitWorld,
  buffers: CS2NodeLaneCommitBuffers,
  input: {
    request: CS2NodeCarCreationParameters;
    nodes: CS2CreatedNodeLaneNodes;
    laneFlags: number;
    prefab: Entity;
    netLaneFlags: number;
    sourceCompositionState: number;
    targetCompositionState: number;
    nodeLane: unknown;
    curve: unknown;
    carLane?: unknown;
    trackLane?: unknown;
    utilityLane?: unknown;
    hangingLane?: unknown;
    hasHanging: boolean;
    hasSignal: boolean;
    skipCandidate: boolean;
    isSkipped: boolean;
    auxiliary: boolean;
    temp: { original: Entity; flags: number };
    outRandomState: number;
  },
  createEntity: (archetype: string) => string,
) {
  const request = input.request;
  const oldLanes = new Map(buffers.oldLanes),
    originalLanes = new Map(buffers.originalLanes),
    updates = [...buffers.updates];
  const commands: CS2NodeLaneCommand[] = [];
  let temp = { ...input.temp },
    isSkipped = input.isSkipped,
    skip = input.skipCandidate;
  if (input.laneFlags & 4) skip = isSkipped;
  else if (!input.auxiliary) isSkipped = isSkipped || skip;
  if (skip) {
    const nodes = input.nodes.map((n) =>
      request.isTemp ? n | 0x80000000n : n,
    ) as unknown as CS2CreatedNodeLaneNodes;
    return {
      commands,
      buffers: { oldLanes, originalLanes, updates },
      temp,
      isSkipped,
      outRandomState: input.outRandomState >>> 0,
      skippedLane: nodes,
      entity: undefined as string | undefined,
    };
  }
  const key = cs2CreatedNodeLaneKey(input.nodes, input.prefab, input.laneFlags);
  if (request.isTemp) {
    let originalNodes = [...input.nodes] as [bigint, bigint, bigint];
    for (const owner of [
      request.owner,
      request.source.owner,
      request.target.owner,
    ]) {
      const ownerTemp = world.temp.get(owner);
      if (
        ownerTemp?.original !== null &&
        ownerTemp?.original !== undefined &&
        (!world.edges.has(ownerTemp.original) || world.edges.has(owner))
      ) {
        const oldIndex =
            required(world.entityIndices, owner, "Entity.Index") | 0,
          newIndex =
            required(world.entityIndices, ownerTemp.original, "Entity.Index") |
            0;
        originalNodes = originalNodes.map((n) =>
          Number(BigInt.asIntN(32, n >> 32n)) === oldIndex
            ? BigInt.asUintN(64, (BigInt(newIndex) << 32n) | (n & 0xffffffffn))
            : n,
        ) as [bigint, bigint, bigint];
      }
    }
    const originalKey = cs2CreatedNodeLaneKey(
        originalNodes,
        input.prefab,
        input.laneFlags,
      ),
      original = originalLanes.get(originalKey);
    if (original !== undefined) {
      temp.original = original;
      originalLanes.delete(originalKey);
    }
  }
  const random = new SourceRandom(input.outRandomState);
  let pseudoSeed = world.pseudoRandomSeeds.get(temp.original);
  if (input.netLaneFlags & 0x1000000 && pseudoSeed === undefined)
    pseudoSeed = random.int(65536);
  const component = (
    entity: string,
    kind: "set" | "add",
    name: string,
    value: unknown,
  ) =>
    commands.push({
      jobIndex: request.jobIndex,
      kind,
      entity,
      component: name,
      value: structuredClone(value),
    });
  const set = (entity: string, name: string, value: unknown) =>
    component(entity, "set", name, value);
  const add = (entity: string, name: string, value: unknown) =>
    component(entity, "add", name, value);
  const types = (
    entity: string,
    kind: "add-types" | "remove-types",
    components: readonly string[],
  ) => commands.push({ jobIndex: request.jobIndex, kind, entity, components });
  const lane = { nodes: input.nodes };
  const membership = cs2CreateNodeLaneMembership({
    laneFlags: input.laneFlags,
    group: request.group,
    laneIndex: request.laneIndex,
    isMergeLeft: request.isMergeLeft,
    isMergeRight: request.isMergeRight,
  });
  const value = (v: unknown, name: string) => {
    if (v === undefined) throw new Error(`Missing created ${name} component`);
    return v;
  };
  const body = (entity: string, isNew: boolean) => {
    if (input.laneFlags & 8)
      set(entity, "CarLane", value(input.carLane, "CarLane"));
    if (input.laneFlags & 64)
      set(entity, "TrackLane", value(input.trackLane, "TrackLane"));
    if (input.laneFlags & 0x800)
      set(entity, "UtilityLane", value(input.utilityLane, "UtilityLane"));
    if (input.hasHanging)
      component(
        entity,
        isNew ? "set" : "add",
        "HangingLane",
        value(input.hangingLane, "HangingLane"),
      );
  };
  const existing = oldLanes.get(key);
  let entity: string;
  if (existing !== undefined) {
    entity = existing;
    oldLanes.delete(key);
    set(entity, "Lane", lane);
    set(entity, "NodeLane", input.nodeLane);
    set(entity, "Curve", input.curve);
    if (input.netLaneFlags & 0x1000000)
      component(
        entity,
        world.pseudoRandomSeeds.has(entity) ? "set" : "add",
        "PseudoRandomSeed",
        { seed: pseudoSeed },
      );
    body(entity, false);
    if (request.isTemp) {
      updates.push(entity);
      set(entity, "Temp", temp);
    } else if (world.temp.has(entity)) {
      types(entity, "remove-types", ["Deleted", "Temp"]);
      types(entity, "add-types", ["Applied", "Created", "Updated"]);
    } else updates.push(entity);
    if (membership.master) set(entity, "MasterLane", membership.master);
    if (membership.slave) set(entity, "SlaveLane", membership.slave);
    if (input.hasSignal) {
      if (!world.laneSignals.has(entity))
        add(entity, "LaneSignal", { default: true });
    } else if (world.laneSignals.has(entity))
      types(entity, "remove-types", ["LaneSignal"]);
  } else {
    const archetypes = required(
      world.archetypes,
      input.prefab,
      "NetLaneArchetypeData",
    );
    entity = createEntity(
      input.laneFlags & 2
        ? archetypes.slave
        : input.laneFlags & 4
          ? archetypes.master
          : archetypes.node,
    );
    commands.push({
      jobIndex: request.jobIndex,
      kind: "create",
      entity,
      archetype:
        input.laneFlags & 2
          ? archetypes.slave
          : input.laneFlags & 4
            ? archetypes.master
            : archetypes.node,
    });
    if ((input.sourceCompositionState | input.targetCompositionState) & 0x40000)
      types(entity, "remove-types", ["CullingInfo", "MeshBatch", "MeshColor"]);
    set(entity, "PrefabRef", { prefab: input.prefab });
    set(entity, "Lane", lane);
    set(entity, "NodeLane", input.nodeLane);
    set(entity, "Curve", input.curve);
    if (input.netLaneFlags & 0x1000000)
      set(entity, "PseudoRandomSeed", { seed: pseudoSeed });
    body(entity, true);
    if (membership.master) set(entity, "MasterLane", membership.master);
    if (membership.slave) set(entity, "SlaveLane", membership.slave);
    if (request.isTemp) {
      types(entity, "add-types", ["Temp", "Owner"]);
      set(entity, "Owner", { owner: request.owner });
      set(entity, "Temp", temp);
    } else add(entity, "Owner", { owner: request.owner });
    if (input.hasSignal) add(entity, "LaneSignal", { default: true });
  }
  return {
    commands,
    buffers: { oldLanes, originalLanes, updates },
    temp,
    isSkipped,
    outRandomState: random.state,
    skippedLane: undefined as CS2CreatedNodeLaneNodes | undefined,
    entity,
  };
}

export type CS2NodeLaneCreationWorld = CS2NodePrefabWorld &
  Omit<CS2NodeLanePrefabSelectionWorld, "compositions"> &
  CS2NodeLaneCommitWorld & {
    compositions: ReadonlyMap<
      Entity,
      CS2NodeCreationComposition & { width: number }
    >;
    netLanes: ReadonlyMap<Entity, { flags: number; width: number }>;
    utilityLanes: ReadonlyMap<Entity, { hanging: number }>;
    auxiliaryLanes: ReadonlyMap<Entity, readonly CS2CreatedNodeAuxiliaryLane[]>;
    nodeEndGeometries: ReadonlyMap<
      Entity,
      { start: CS2CreatedNodeEndGeometry; end: CS2CreatedNodeEndGeometry }
    >;
    compositionPieces: ReadonlyMap<Entity, readonly CS2NodeCreationPiece[]>;
  };
export type CS2NodeLaneCreationBuffers = CS2NodeLaneCommitBuffers & {
  selectedSpawnables: ReadonlyMap<Entity, number>;
};
export type CS2NodeLaneCreationInput = {
  request: CS2NodeCarCreationParameters;
  nodeLaneIndex: number;
  randomState: number;
  curviness: number;
  isSkipped: boolean;
  buffers: CS2NodeLaneCreationBuffers;
  middleConnections: readonly CS2CreatedNodeMiddleConnection[];
};
function copyConnectPosition(
  p: CS2LaneConnectPosition,
): CS2LaneConnectPosition {
  const out = structuredClone(p),
    vec = (v: CS2Point): CS2Point => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
  out.position = vec(out.position);
  out.tangent = vec(out.tangent);
  out.lane.position = vec(out.lane.position);
  out.order = f(out.order);
  out.curvePosition = f(out.curvePosition);
  out.baseHeight = f(out.baseHeight);
  out.elevation = f(out.elevation);
  out.composition.speedLimit = f(out.composition.speedLimit);
  out.composition.priority = f(out.composition.priority);
  return out;
}
function copyMiddleConnection(
  p: CS2CreatedNodeMiddleConnection,
): CS2CreatedNodeMiddleConnection {
  const out = structuredClone(p),
    vec = (v: CS2Point): CS2Point => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
  out.connectPosition = copyConnectPosition(out.connectPosition);
  out.targetCurve = {
    points: out.targetCurve.points.map(vec) as unknown as Cubic,
    length: f(out.targetCurve.length),
  };
  out.targetCurvePos = f(out.targetCurvePos);
  out.distance = f(out.distance);
  out.targetComposition.speedLimit = f(out.targetComposition.speedLimit);
  out.targetComposition.priority = f(out.targetComposition.priority);
  return out;
}
/**
 * Full source CreateNodeLane control flow, including resolved/auxiliary lanes,
 * car/track/utility geometry, middle connections and deferred entity commands.
 * Actual ECS entity allocation is supplied explicitly by the host.
 */
export function cs2CreateNodeLane(
  world: CS2NodeLaneCreationWorld,
  input: CS2NodeLaneCreationInput,
  createEntity: (archetype: string) => string,
) {
  let request = {
    ...structuredClone(input.request),
    source: copyConnectPosition(input.request.source),
    target: copyConnectPosition(input.request.target),
  };
  const sourceComposition = required(
      world.compositions,
      request.source.nodeComposition,
      "NetCompositionData",
    ),
    targetComposition = required(
      world.compositions,
      request.target.nodeComposition,
      "NetCompositionData",
    );
  let nodeLaneIndex = input.nodeLaneIndex | 0,
    randomState = input.randomState >>> 0,
    curviness = f(input.curviness),
    isSkipped = input.isSkipped;
  let buffers: CS2NodeLaneCreationBuffers = {
    oldLanes: new Map(input.buffers.oldLanes),
    originalLanes: new Map(input.buffers.originalLanes),
    updates: [...input.buffers.updates],
    selectedSpawnables: new Map(input.buffers.selectedSpawnables),
  };
  let middleConnections = input.middleConnections.map(copyMiddleConnection);
  let outRandomState = 0;
  const commands: CS2NodeLaneCommand[] = [],
    skippedLanes: CS2CreatedNodeLaneNodes[] = [],
    entities: string[] = [];
  const result = (created: boolean) => ({
    created,
    nodeLaneIndex,
    randomState,
    curviness,
    isSkipped,
    buffers,
    middleConnections,
    commands,
    skippedLanes,
    entities,
  });
  if (
    (request.isUTurn && sourceComposition.state & 1) ||
    request.source.lane.flags & request.target.lane.flags & 16
  )
    return result(false);
  let temp = request.isTemp
    ? cs2CreatedNodeLaneTemp(request.ownerTemp)
    : { original: null as Entity, flags: 0 };
  const choice = cs2SelectCreatedNodeLanePrefab(world, request);
  let laneFlags = choice.laneFlags,
    prefab = choice.prefab;
  const checked = cs2CheckNodeLanePrefab(world, {
    prefab,
    randomState,
    selectedSpawnables: buffers.selectedSpawnables,
  });
  // Original caller intentionally ignores CheckPrefab's bool return value.
  prefab = checked.prefab;
  randomState = checked.randomState;
  outRandomState = checked.outRandomState;
  buffers = { ...buffers, selectedSpawnables: checked.selectedSpawnables };
  let data = required(world.netLanes, prefab, "NetLaneData");
  const auxiliaries =
    data.flags & 0x400000
      ? required(world.auxiliaryLanes, prefab, "AuxiliaryNetLane buffer")
      : [];
  const start = { ...request.source.position },
    end = { ...request.target.position };
  for (let i = 0; i <= auxiliaries.length; i++) {
    if (i !== 0) {
      let auxiliary = structuredClone(auxiliaries[i - 1]);
      if (
        !testAuxiliaryFlags(auxiliary, sourceComposition.flags) ||
        !testAuxiliaryFlags(auxiliary, targetComposition.flags) ||
        f(auxiliary.spacing.x) > f(0.1)
      )
        continue;
      request = {
        ...request,
        source: {
          ...request.source,
          position: { ...start, y: plus(start.y, auxiliary.position.y) },
        },
        target: {
          ...request.target,
          position: { ...end, y: plus(end.y, auxiliary.position.y) },
        },
      };
      prefab = auxiliary.prefab;
      data = required(world.netLanes, prefab, "NetLaneData");
      laneFlags = (data.flags | auxiliary.flags) >>> 0;
      if (f(auxiliary.position.z) > f(0.1)) {
        if (request.source.owner !== request.owner) {
          if (request.source.lane.flags & 0x400000) {
            const sourceAux = required(
              world.auxiliaryLanes,
              request.source.lane.prefab,
              "AuxiliaryNetLane buffer",
            );
            const matched = sourceAux.find(
              (v) => v.prefab === auxiliary.prefab,
            );
            if (matched) auxiliary = structuredClone(matched);
          }
          const geometry = required(
            world.nodeEndGeometries,
            request.source.owner,
            "Start/EndNodeGeometry",
          );
          request.source.position = added(
            request.source.position,
            cs2CreatedNodeAuxiliaryZOffset(
              request.source.position,
              request.source.tangent,
              request.source.isEnd ? geometry.end : geometry.start,
              sourceComposition,
              auxiliary,
            ),
          );
        }
        if (request.target.owner !== request.owner) {
          if (request.target.lane.flags & 0x400000) {
            const targetAux = required(
              world.auxiliaryLanes,
              request.target.lane.prefab,
              "AuxiliaryNetLane buffer",
            );
            const matched = targetAux.find(
              (v) => v.prefab === auxiliary.prefab,
            );
            if (matched) auxiliary = structuredClone(matched);
          }
          const geometry = required(
            world.nodeEndGeometries,
            request.target.owner,
            "Start/EndNodeGeometry",
          );
          request.target.position = added(
            request.target.position,
            cs2CreatedNodeAuxiliaryZOffset(
              request.target.position,
              request.target.tangent,
              request.target.isEnd ? geometry.end : geometry.start,
              targetComposition,
              auxiliary,
            ),
          );
        }
      }
    }
    const sourcePrefab = world.netLanes.get(request.source.lane.prefab),
      targetPrefab = world.netLanes.get(request.target.lane.prefab);
    const nodeLane = cs2CreateNodeLaneWidthOffsets({
      selectedWidth: data.width,
      sourcePrefab,
      targetPrefab,
      laneFlags,
    });
    const geometry = cs2BuildCreatedNodeLaneGeometry({
      request,
      sourceComposition,
      targetComposition,
      laneFlags,
      selectedWidth: data.width,
      widthOffset: nodeLane.widthOffset,
      utilityHanging: world.utilityLanes.get(prefab)?.hanging,
      sourcePieces: world.compositionPieces.get(request.source.nodeComposition),
    });
    const curve = { points: geometry.points, length: geometry.length };
    let skipCandidate = geometry.shortConnection,
      hasSignal = false,
      carLane: CS2CreatedNodeCarLane | undefined;
    let trackLane:
      ReturnType<typeof cs2DeriveCreatedNodeTrackLane>["trackLane"] | undefined;
    if (laneFlags & 8) {
      const derived = cs2DeriveCreatedNodeCarLane({
        request,
        sourceComposition,
        sourceEdgeCompositionState: world.compositions.get(
          request.source.edgeComposition,
        )?.state,
        targetEdgeCompositionState: world.compositions.get(
          request.target.edgeComposition,
        )?.state,
        curviness,
        curve: { ...curve, width: data.width },
        shortConnection: skipCandidate,
      });
      carLane = derived.carLane;
      curviness = carLane.curviness;
      skipCandidate = derived.skipped;
      hasSignal = derived.hasSignal;
      if (!derived.allowed) return result(false);
    }
    if (laneFlags & 64) {
      const derived = cs2DeriveCreatedNodeTrackLane({
        request,
        laneFlags,
        sourceComposition,
        targetComposition,
        curviness,
        curve: { ...curve, width: data.width },
        maxCurviness: world.trackLanes.get(prefab)?.maxCurviness,
        skipCandidate,
        hasSignal,
      });
      trackLane = derived.trackLane;
      curviness = derived.curviness;
      skipCandidate = derived.skipped;
      hasSignal = derived.hasSignal;
      if (!derived.allowed) return result(false);
    }
    const allocation = cs2AllocateCreatedNodeLaneNodes({
      source: request.source,
      target: request.target,
      ownerIndex: required(world.entityIndices, request.owner, "Entity.Index"),
      nodeLaneIndex,
      auxiliary: i !== 0,
    });
    nodeLaneIndex = allocation.nodeLaneIndex;
    if (i !== 0) skipCandidate = false;
    middleConnections = cs2UpdateCreatedNodeMiddleConnections({
      request,
      prefab,
      laneFlags,
      curve,
      carLaneFlags: carLane?.flags ?? 0,
      carriagewayGroup: carLane?.carriagewayGroup ?? 0,
      middleNode: allocation.nodes[1],
      middleConnections,
    });
    const committed = cs2CommitCreatedNodeLane(
      world,
      buffers,
      {
        request,
        nodes: allocation.nodes,
        laneFlags,
        prefab,
        netLaneFlags: data.flags,
        sourceCompositionState: sourceComposition.state,
        targetCompositionState: targetComposition.state,
        nodeLane,
        curve,
        carLane,
        trackLane,
        utilityLane: geometry.utilityLane,
        hangingLane: geometry.hangingLane,
        hasHanging: geometry.hasHanging,
        hasSignal,
        skipCandidate,
        isSkipped,
        auxiliary: i !== 0,
        temp,
        outRandomState,
      },
      createEntity,
    );
    commands.push(...committed.commands);
    if (committed.skippedLane) skippedLanes.push(committed.skippedLane);
    if (committed.entity) entities.push(committed.entity);
    buffers = {
      ...committed.buffers,
      selectedSpawnables: buffers.selectedSpawnables,
    };
    temp = committed.temp;
    isSkipped = committed.isSkipped;
    outRandomState = committed.outRandomState;
  }
  return result(true);
}
