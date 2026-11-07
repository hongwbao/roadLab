/** Original LaneOverlapSystem geometry and explicit owner/component world port.
 * XZ geometry is deliberate: source candidate owners, not a guessed height gate,
 * separate unrelated roads. See CS2_LANE_OVERLAPS.md for source/oracle evidence.
 */
import {
  cs2NavigationCurvePosition,
  type CS2NavigationCurve,
} from "./cs2-navigation-target";
import { cs2QuantizeOverlap, type CS2LaneOverlap } from "./cs2-conflicts";
import type { Cs2CompiledNetwork, Cs2NetworkLane } from "./cs2-network";

export type CS2OverlapPoint = { x: number; y: number };
export type CS2OverlapCubic = readonly [
  CS2OverlapPoint,
  CS2OverlapPoint,
  CS2OverlapPoint,
  CS2OverlapPoint,
];
export type CS2OverlapRange = readonly [number, number, number, number];
export type CS2OverlapNodeState = {
  widthOffset: readonly [number, number];
  sharedStartCount: number;
  sharedEndCount: number;
};
export type CS2OverlapLane = {
  curve: CS2NavigationCurve;
  nodes: { start: bigint; middle: bigint; end: bigint };
  prefab: { width: number; flags: number };
  carFlags?: number;
  pedestrianFlags?: number;
  node?: CS2OverlapNodeState;
  parking?: { flags: number; slotAngle?: number };
  trackTypes?: number;
  hasOverlapBuffer: boolean;
  /** Preserved on owners outside the source update set. */
  overlaps?: readonly CS2ProducedLaneOverlap[];
  /** Original master group members for node LaneCrossCount minimum. */
  masterMembers?: readonly string[];
  secondary?: boolean;
  /** EdgeLane component presence for the subsequent UpdateLaneFlagsJob. */
  edgeLane?: boolean;
};
export type CS2OverlapOwner = {
  lanes: readonly string[];
  edge?: { startOwner: string; endOwner: string };
  updated?: boolean;
  connectedEdges?: readonly string[];
  /** Original Entity.Index for PathNode.OwnerEquals; not an array index. */
  entityIndex: number;
};
export type CS2LaneOverlapWorld = {
  lanes: ReadonlyMap<string, CS2OverlapLane>;
  owners: ReadonlyMap<string, CS2OverlapOwner>;
};
export type CS2ProducedLaneOverlap = CS2LaneOverlap & { other: string };
export const CS2_LANE_OVERLAP_FLAGS = {
  mergeStart: 1,
  mergeEnd: 2,
  overlapLeft: 4,
  overlapRight: 8,
  mergeMiddleStart: 16,
  mergeMiddleEnd: 32,
  unsafe: 64,
  road: 128,
  track: 256,
  mergeFlip: 512,
  slow: 1024,
  water: 2048,
} as const;
export const CS2_OVERLAP_PREFAB_FLAGS = {
  road: 8,
  pedestrian: 16,
  parking: 32,
  track: 64,
  water: 0x8000,
  virtual: 0x10000,
} as const;
const O = CS2_LANE_OVERLAP_FLAGS,
  P = CS2_OVERLAP_PREFAB_FLAGS,
  f = Math.fround;
const plus = (a: number, b: number) => f(f(a) + f(b)),
  minus = (a: number, b: number) => f(f(a) - f(b)),
  times = (a: number, b: number) => f(f(a) * f(b));
const divide = (a: number, b: number) => f(f(a) / f(b));
const lerp = (a: number, b: number, t: number) =>
  plus(a, times(minus(b, a), t));
const vplus = (a: CS2OverlapPoint, b: CS2OverlapPoint): CS2OverlapPoint => ({
  x: plus(a.x, b.x),
  y: plus(a.y, b.y),
});
const vminus = (a: CS2OverlapPoint, b: CS2OverlapPoint): CS2OverlapPoint => ({
  x: minus(a.x, b.x),
  y: minus(a.y, b.y),
});
const vtimes = (a: CS2OverlapPoint, n: number): CS2OverlapPoint => ({
  x: times(a.x, n),
  y: times(a.y, n),
});
const vlerp = (
  a: CS2OverlapPoint,
  b: CS2OverlapPoint,
  t: number,
): CS2OverlapPoint => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const dot = (a: CS2OverlapPoint, b: CS2OverlapPoint) =>
  plus(times(a.x, b.x), times(a.y, b.y));
const left = (a: CS2OverlapPoint): CS2OverlapPoint => ({ x: f(-a.y), y: a.x });
const right = (a: CS2OverlapPoint): CS2OverlapPoint => ({ x: a.y, y: f(-a.x) });
const normal = (a: CS2OverlapPoint): CS2OverlapPoint => {
  const square = dot(a, a);
  return square > f(1.1754944e-38)
    ? vtimes(a, divide(1, f(Math.sqrt(square))))
    : { x: 0, y: 0 };
};
const roundEven = (n: number) => {
  const lo = Math.floor(n);
  return n - lo === 0.5 ? (lo % 2 === 0 ? lo : lo + 1) : Math.round(n);
};
const xz = (curve: CS2NavigationCurve): CS2OverlapCubic =>
  curve.points.map((p) => ({
    x: f(p.x),
    y: f(p.z),
  })) as unknown as CS2OverlapCubic;
function position(curve: CS2OverlapCubic, t: number): CS2OverlapPoint {
  const u = minus(1, t),
    three = times(3, t),
    weights = [
      times(times(u, u), u),
      times(times(three, u), u),
      times(times(three, t), u),
      times(times(t, t), t),
    ];
  return vplus(
    vplus(vtimes(curve[0], weights[0]), vtimes(curve[2], weights[2])),
    vplus(vtimes(curve[1], weights[1]), vtimes(curve[3], weights[3])),
  );
}
function tangent(curve: CS2OverlapCubic, t: number): CS2OverlapPoint {
  const u = minus(1, t),
    three = times(3, t),
    weights = [
      times(times(u, minus(-1, -t)), 3),
      times(times(u, minus(1, three)), 3),
      times(times(t, minus(2, three)), 3),
      times(times(t, t), 3),
    ];
  return vplus(
    vplus(vtimes(curve[0], weights[0]), vtimes(curve[2], weights[2])),
    vplus(vtimes(curve[1], weights[1]), vtimes(curve[3], weights[3])),
  );
}
function length(curve: CS2OverlapCubic) {
  let total = 0,
    previous = curve[0];
  for (let i = 1; i <= 16; i++) {
    const next = position(curve, f(i / 16)),
      delta = vminus(next, previous);
    total = plus(total, f(Math.sqrt(dot(delta, delta))));
    previous = next;
  }
  return total;
}
function split(
  curve: CS2OverlapCubic,
): readonly [CS2OverlapCubic, CS2OverlapCubic] {
  const mid = vlerp(curve[1], curve[2], 0.5),
    b = vlerp(curve[0], curve[1], 0.5),
    c = vlerp(curve[2], curve[3], 0.5),
    p = vlerp(b, mid, 0.5),
    q = vlerp(mid, c, 0.5),
    centre = vlerp(p, q, 0.5);
  return [
    [curve[0], b, p, centre],
    [centre, q, c, curve[3]],
  ];
}
type Bounds = { min: CS2OverlapPoint; max: CS2OverlapPoint };
function bounds(points: readonly CS2OverlapPoint[]): Bounds {
  return {
    min: {
      x: Math.min(...points.map((p) => p.x)),
      y: Math.min(...points.map((p) => p.y)),
    },
    max: {
      x: Math.max(...points.map((p) => p.x)),
      y: Math.max(...points.map((p) => p.y)),
    },
  };
}
const expand = (b: Bounds, radius: number): Bounds => ({
  min: { x: minus(b.min.x, radius), y: minus(b.min.y, radius) },
  max: { x: plus(b.max.x, radius), y: plus(b.max.y, radius) },
});
const intersects = (a: Bounds, b: Bounds) =>
  a.min.x <= b.max.x &&
  a.min.y <= b.max.y &&
  b.min.x <= a.max.x &&
  b.min.y <= a.max.y;
function boundsDistance(a: Bounds, b: Bounds) {
  const delta = {
    x: Math.max(minus(a.min.x, b.max.x), minus(b.min.x, a.max.x), 0),
    y: Math.max(minus(a.min.y, b.max.y), minus(b.min.y, a.max.y), 0),
  };
  return dot(delta, delta);
}
type Segment = readonly [CS2OverlapPoint, CS2OverlapPoint];
function intersectSegments(
  a: Segment,
  b: Segment,
): readonly [number, number] | null {
  const u = vminus(a[1], a[0]),
    v = vminus(b[1], b[0]),
    offset = vminus(a[0], b[0]),
    det = minus(times(u.x, v.y), times(u.y, v.x));
  const t = divide(minus(times(offset.y, v.x), times(offset.x, v.y)), det),
    s = divide(minus(times(offset.y, u.x), times(offset.x, u.y)), det);
  return t >= 0 &&
    t <= 1 &&
    s >= 0 &&
    s <= 1 &&
    intersects(bounds(a), bounds(b))
    ? [t, s]
    : null;
}
/** Original CalculateParallelism, LaneOverlapSystem.cs:1426. */
export function cs2CalculateLaneOverlapParallelism(
  a: CS2OverlapCubic,
  b: CS2OverlapCubic,
  range: CS2OverlapRange,
) {
  const middle = [lerp(range[0], range[1], 0.5), lerp(range[2], range[3], 0.5)];
  return Math.max(
    0,
    times(
      plus(
        plus(
          dot(normal(tangent(a, range[0])), normal(tangent(b, range[2]))),
          dot(normal(tangent(a, middle[0])), normal(tangent(b, middle[1]))),
        ),
        dot(normal(tangent(a, range[1])), normal(tangent(b, range[3]))),
      ),
      f(1 / 3),
    ),
  );
}
/** Original FindOverlapRange, including strict bounds radius, capped subdivision,
 * four side-segment pairs per quad edge and source LIFO traversal order.
 */
export function cs2FindLaneOverlapRange(input: {
  curve1: CS2OverlapCubic;
  curve2: CS2OverlapCubic;
  radius1: readonly [number, number];
  radius2: readonly [number, number];
  angle1?: number;
  angle2?: number;
}) {
  const r1 = input.radius1,
    r2 = input.radius2,
    angle1 = f(input.angle1 ?? 0),
    angle2 = f(input.angle2 ?? 0),
    cosine = [divide(1, f(Math.cos(angle1))), divide(1, f(Math.cos(angle2)))],
    tilt = [f(Math.tan(angle1)), f(Math.tan(angle2))];
  type Item = {
    a: CS2OverlapCubic;
    b: CS2OverlapCubic;
    rangeA: readonly [number, number];
    rangeB: readonly [number, number];
    iterations: readonly [number, number];
  };
  const iterations = [
    Math.min(
      roundEven(
        f(
          Math.sqrt(
            divide(length(input.curve1), Math.max(0.1, Math.min(r1[0], r1[1]))),
          ),
        ),
      ),
      4,
    ),
    Math.min(
      roundEven(
        f(
          Math.sqrt(
            divide(length(input.curve2), Math.max(0.1, Math.min(r2[0], r2[1]))),
          ),
        ),
      ),
      4,
    ),
  ] as const;
  const stack: Item[] = [
    {
      a: input.curve1,
      b: input.curve2,
      rangeA: [0, 1],
      rangeB: [0, 1],
      iterations,
    },
  ];
  let overlap = false;
  const range: [number, number, number, number] = [2, -1, 2, -1];
  const include = (a: number, b: number) => {
    range[0] = Math.min(range[0], a);
    range[1] = Math.max(range[1], a);
    range[2] = Math.min(range[2], b);
    range[3] = Math.max(range[3], b);
    overlap = true;
  };
  while (stack.length) {
    const item = stack.pop()!,
      ra = item.rangeA.map((t) => lerp(r1[0], r1[1], t)),
      rb = item.rangeB.map((t) => lerp(r2[0], r2[1], t)),
      ba = bounds(item.a),
      bb = bounds(item.b),
      outer = [
        times(Math.max(...ra), cosine[0]),
        times(Math.max(...rb), cosine[1]),
      ],
      radius = plus(outer[0], outer[1]);
    if (!(boundsDistance(ba, bb) < times(radius, radius))) continue;
    const ia = item.iterations[0] - 1,
      ib = item.iterations[1] - 1;
    if (ia < 0 && ib < 0) {
      function quad(
        curve: CS2OverlapCubic,
        radii: readonly number[],
        angle: number,
      ) {
        const offset = (v: CS2OverlapPoint, r: number) => {
          const n = vtimes(normal(right(v)), r);
          return vplus(n, vtimes(left(n), angle));
        };
        const start = offset(vminus(curve[1], curve[0]), radii[0]),
          end = offset(vminus(curve[3], curve[2]), radii[1]);
        const a = vplus(curve[0], start),
          b = vplus(curve[3], end),
          c = vminus(curve[3], end),
          d = vminus(curve[0], start);
        return [
          [a, b],
          [d, c],
          [a, d],
          [b, c],
        ] as readonly Segment[];
      }
      const a = quad(item.a, ra, tilt[0]),
        b = quad(item.b, rb, tilt[1]),
        expandedB = expand(bb, outer[1]);
      for (let i = 0; i < 4; i++)
        if (intersects(bounds(a[i]), expandedB))
          for (let j = 0; j < 4; j++) {
            const hit = intersectSegments(a[i], b[j]);
            if (!hit) continue;
            include(
              i < 2
                ? lerp(item.rangeA[0], item.rangeA[1], hit[0])
                : item.rangeA[i - 2],
              j < 2
                ? lerp(item.rangeB[0], item.rangeB[1], hit[1])
                : item.rangeB[j - 2],
            );
          }
    } else if (ia >= 0 && ib >= 0) {
      const [a1, a2] = split(item.a),
        [b1, b2] = split(item.b),
        ma = lerp(item.rangeA[0], item.rangeA[1], 0.5),
        mb = lerp(item.rangeB[0], item.rangeB[1], 0.5);
      stack.push(
        {
          a: a1,
          b: b1,
          rangeA: [item.rangeA[0], ma],
          rangeB: [item.rangeB[0], mb],
          iterations: [ia, ib],
        },
        {
          a: a1,
          b: b2,
          rangeA: [item.rangeA[0], ma],
          rangeB: [mb, item.rangeB[1]],
          iterations: [ia, ib],
        },
        {
          a: a2,
          b: b1,
          rangeA: [ma, item.rangeA[1]],
          rangeB: [item.rangeB[0], mb],
          iterations: [ia, ib],
        },
        {
          a: a2,
          b: b2,
          rangeA: [ma, item.rangeA[1]],
          rangeB: [mb, item.rangeB[1]],
          iterations: [ia, ib],
        },
      );
    } else if (ia >= 0) {
      const [a1, a2] = split(item.a),
        mid = lerp(item.rangeA[0], item.rangeA[1], 0.5);
      stack.push(
        { ...item, a: a1, rangeA: [item.rangeA[0], mid], iterations: [ia, ib] },
        { ...item, a: a2, rangeA: [mid, item.rangeA[1]], iterations: [ia, ib] },
      );
    } else {
      const [b1, b2] = split(item.b),
        mid = lerp(item.rangeB[0], item.rangeB[1], 0.5);
      stack.push(
        { ...item, b: b1, rangeB: [item.rangeB[0], mid], iterations: [ia, ib] },
        { ...item, b: b2, rangeB: [mid, item.rangeB[1]], iterations: [ia, ib] },
      );
    }
  }
  return { overlap, range };
}

const sameNode = (a: bigint, b: bigint) => a === b;
const sameIgnoringCurve = (a: bigint, b: bigint) =>
  ((a ^ b) & 0xffffffff8000ffffn) === 0n;
function nodeState(lane: CS2OverlapLane): CS2OverlapNodeState {
  return lane.node
    ? {
        ...lane.node,
        widthOffset: [...lane.node.widthOffset] as [number, number],
      }
    : { widthOffset: [0, 0], sharedStartCount: 0, sharedEndCount: 0 };
}
const position3 = (curve: CS2NavigationCurve, t: number): CS2OverlapPoint => {
  const p = cs2NavigationCurvePosition(curve, t);
  return { x: p.x, y: p.z };
};
/** Bezier4x3 arithmetic order differs from the packed Bezier4x2 method. */
function tangent3(curve: CS2NavigationCurve, t: number): CS2OverlapPoint {
  const p = xz(curve),
    u = minus(1, t),
    three = times(3, t),
    weights = [
      times(times(u, minus(-1, -t)), 3),
      times(times(u, minus(1, three)), 3),
      times(times(t, minus(2, three)), 3),
      times(times(t, t), 3),
    ];
  return vplus(
    vplus(
      vplus(vtimes(p[0], weights[0]), vtimes(p[1], weights[1])),
      vtimes(p[2], weights[2]),
    ),
    vtimes(p[3], weights[3]),
  );
}
const angle = (lane: CS2OverlapLane) =>
  lane.prefab.flags & P.parking &&
  lane.parking &&
  (lane.parking.slotAngle ?? 0) > 0.25
    ? lane.parking.flags & 0x800
      ? minus(lane.parking.slotAngle!, f(Math.PI / 2))
      : minus(f(Math.PI / 2), lane.parking.slotAngle!)
    : 0;

/** Full UpdateOverlaps/CheckOverlaps/ApplyExtraOverlaps/SortLaneOverlaps chain.
 * Original job candidates are explicit owners and edge endpoint node owners.
 * Existing overlaps/counts outside this update set survive, as in the ECS world.
 */
export function cs2UpdateLaneOverlaps(
  world: CS2LaneOverlapWorld,
  options: {
    owners?: readonly string[];
    leftHandTraffic?: boolean;
    updateAll?: boolean;
  } = {},
) {
  const overlaps = new Map<string, CS2ProducedLaneOverlap[]>(),
    nodes = new Map<string, CS2OverlapNodeState>();
  for (const [id, lane] of world.lanes) {
    if (lane.hasOverlapBuffer)
      overlaps.set(id, lane.overlaps?.map((overlap) => ({ ...overlap })) ?? []);
    if (lane.node) nodes.set(id, nodeState(lane));
  }
  const extra: {
    entity: string;
    overlap?: CS2ProducedLaneOverlap;
    sharedStartDelta: number;
    sharedEndDelta: number;
  }[] = [];
  function lane(id: string) {
    const value = world.lanes.get(id);
    if (!value) throw new Error(`Missing source overlap lane: ${id}`);
    return value;
  }
  function carFlags(row: CS2OverlapLane) {
    if (!(row.prefab.flags & P.road)) return 0;
    if (row.carFlags === undefined)
      throw new Error(
        `Road prefab requires source CarLane component: ${row.curve.id}`,
      );
    return row.carFlags;
  }
  function pedestrianFlags(row: CS2OverlapLane) {
    if (!(row.prefab.flags & P.pedestrian)) return 0;
    if (row.pedestrianFlags === undefined)
      throw new Error(
        `Pedestrian prefab requires source PedestrianLane component: ${row.curve.id}`,
      );
    return row.pedestrianFlags;
  }
  function check(
    id1: string,
    candidates: readonly string[],
    count: number,
    isEdge: boolean,
    differentOwner: boolean,
    firstNode: CS2OverlapNodeState,
  ) {
    const a = lane(id1),
      p1 = a.prefab.flags,
      node1 = !!a.node,
      c1 = xz(a.curve),
      car1Original = carFlags(a),
      ped1 = pedestrianFlags(a);
    const train1 = !!(p1 & P.track) && !!((a.trackTypes ?? 0) & 5);
    for (let i = 0; i < count; i++) {
      const id2 = candidates[i],
        b = lane(id2),
        output2 = overlaps.get(id2);
      if (!output2 || b.secondary) continue;
      const c2 = xz(b.curve);
      if (
        (sameNode(a.nodes.start, b.nodes.end) &&
          dot(normal(vminus(c1[1], c1[0])), normal(vminus(c2[3], c2[2]))) >=
            0) ||
        (sameNode(a.nodes.end, b.nodes.start) &&
          dot(normal(vminus(c1[3], c1[2])), normal(vminus(c2[1], c2[0]))) >= 0)
      )
        continue;
      const p2 = b.prefab.flags;
      if (p2 & P.parking) {
        if (!(p1 & P.road) || !node1 || p2 & P.virtual) continue;
      } else if (p1 & P.parking && !(p2 & P.road)) continue;
      const node2 = !!b.node;
      if (!node2 && (p1 & P.parking || (isEdge && !node1))) continue;
      const secondNode = node2
        ? {
            ...nodes.get(id2)!,
            widthOffset: [...nodes.get(id2)!.widthOffset] as [number, number],
          }
        : nodeState(b);
      const radii1 = firstNode.widthOffset.map((n) =>
          times(plus(a.prefab.width, n), 0.4),
        ) as [number, number],
        radii2 = secondNode.widthOffset.map((n) =>
          times(plus(b.prefab.width, n), 0.4),
        ) as [number, number];
      const found = cs2FindLaneOverlapRange({
        curve1: c1,
        curve2: c2,
        radius1: radii1,
        radius2: radii2,
        angle1: angle(a),
        angle2: angle(b),
      });
      if (!found.overlap) continue;
      const t = [...found.range] as [number, number, number, number],
        parallel = cs2CalculateLaneOverlapParallelism(c1, c2, t);
      let flags1 =
          (p2 & P.road ? O.road : 0) |
          (p2 & P.track ? O.track : 0) |
          (p2 & P.water ? O.water : 0),
        flags2 =
          (p1 & P.road ? O.road : 0) |
          (p1 & P.track ? O.track : 0) |
          (p1 & P.water ? O.water : 0);
      if (sameNode(a.nodes.start, b.nodes.start)) {
        flags1 |= O.mergeStart;
        flags2 |= O.mergeStart;
      } else if (sameIgnoringCurve(a.nodes.start, b.nodes.middle)) {
        flags1 |= O.mergeStart;
        flags2 |= O.mergeMiddleStart;
      } else if (sameIgnoringCurve(b.nodes.start, a.nodes.middle)) {
        flags1 |= O.mergeMiddleStart;
        flags2 |= O.mergeStart;
      } else if (sameNode(a.nodes.start, b.nodes.end)) {
        flags1 |= O.mergeStart | O.mergeFlip;
        flags2 |= O.mergeEnd | O.mergeFlip;
      }
      if (sameNode(a.nodes.end, b.nodes.end)) {
        flags1 |= O.mergeEnd;
        flags2 |= O.mergeEnd;
      } else if (sameIgnoringCurve(a.nodes.end, b.nodes.middle)) {
        flags1 |= O.mergeEnd;
        flags2 |= O.mergeMiddleEnd;
      } else if (sameIgnoringCurve(b.nodes.end, a.nodes.middle)) {
        flags1 |= O.mergeMiddleEnd;
        flags2 |= O.mergeEnd;
      } else if (sameNode(a.nodes.end, b.nodes.start)) {
        flags1 |= O.mergeEnd | O.mergeFlip;
        flags2 |= O.mergeStart | O.mergeFlip;
      }
      let car1 = car1Original,
        car2 = carFlags(b);
      const ped2 = pedestrianFlags(b);
      if (car1 & 1 || ped1 & 1) flags2 |= O.unsafe;
      if (car2 & 1 || ped2 & 1) flags1 |= O.unsafe;
      if (car1 & 0x200000) car1 &= ~(0x400 | 0x800 | 0x4000000);
      if (car2 & 0x200000) car2 &= ~(0x400 | 0x800 | 0x4000000);
      const changedCars = car1 ^ car2,
        changedPrefab = p1 ^ p2;
      let sharedStartDelta = 0,
        sharedEndDelta = 0,
        parallel1: number,
        parallel2: number;
      if (!((flags1 | flags2) & (O.mergeStart | O.mergeEnd))) {
        const length1 = Math.max(1, times(a.curve.length, minus(t[1], t[0]))),
          length2 = Math.max(1, times(b.curve.length, minus(t[3], t[2])));
        parallel1 = times(length1, divide(parallel, length2));
        parallel2 = times(length2, divide(parallel, length1));
        flags1 |= O.overlapLeft | O.overlapRight;
        flags2 |= O.overlapLeft | O.overlapRight;
      } else {
        parallel1 = parallel2 = parallel;
        if (!(changedCars & 1) && !(changedPrefab & P.road)) {
          if (node1 && flags1 & O.mergeStart)
            firstNode.sharedStartCount = Math.min(
              254,
              firstNode.sharedStartCount + 1,
            );
          if (node2 && flags2 & O.mergeStart) sharedStartDelta = 1;
          if (node1 && flags1 & O.mergeEnd)
            firstNode.sharedEndCount = Math.min(
              254,
              firstNode.sharedEndCount + 1,
            );
          if (node2 && flags2 & O.mergeEnd) sharedEndDelta = 1;
          if (node2 && !differentOwner) {
            secondNode.sharedStartCount = Math.min(
              254,
              secondNode.sharedStartCount + sharedStartDelta,
            );
            secondNode.sharedEndCount = Math.min(
              254,
              secondNode.sharedEndCount + sharedEndDelta,
            );
            nodes.set(id2, secondNode);
          }
        }
        function direction(
          row: CS2OverlapLane,
          curve: CS2OverlapCubic,
          flags: number,
          start: number,
          end: number,
        ) {
          const mask = flags & (O.mergeStart | O.mergeEnd),
            mid = lerp(start, end, 0.5);
          if (mask === O.mergeStart) {
            const candidate = vminus(curve[3], position3(row.curve, mid));
            return dot(vminus(curve[1], curve[0]), candidate) >= 0
              ? candidate
              : tangent3(row.curve, end);
          }
          if (mask === O.mergeEnd) {
            const candidate = vminus(position3(row.curve, mid), curve[0]);
            return dot(vminus(curve[3], curve[2]), candidate) >= 0
              ? candidate
              : tangent3(row.curve, start);
          }
          return vminus(curve[3], curve[0]);
        }
        const d1 = direction(a, c1, flags1, t[0], t[1]),
          d2 = direction(b, c2, flags2, t[2], t[3]),
          side = dot(right(d1), d2) > 0 === !(flags1 & O.mergeFlip);
        if (flags1 & O.mergeStart) {
          t[0] = 0;
          flags1 |= side ? O.overlapRight : O.overlapLeft;
        }
        if (flags2 & O.mergeStart) {
          t[2] = 0;
          flags2 |= side ? O.overlapLeft : O.overlapRight;
        }
        if (flags1 & O.mergeEnd) {
          t[1] = 1;
          flags1 |= side ? O.overlapLeft : O.overlapRight;
        }
        if (flags2 & O.mergeEnd) {
          t[3] = 1;
          flags2 |= side ? O.overlapRight : O.overlapLeft;
        }
      }
      // Original second-lane train test is guarded by Parking, first by Track.
      const train2 = !!(p2 & P.parking) && !!((b.trackTypes ?? 0) & 5);
      if (p1 & P.road && train2) flags1 |= O.slow;
      if (p2 & P.road && train1) flags2 |= O.slow;
      let priority = 0;
      if ((p1 | p2) & P.pedestrian) {
        if (p1 & P.road && !(ped2 & 1)) priority = 1;
        else if (p2 & P.road && !(ped1 & 1)) priority = -1;
      } else if (!(flags1 & (O.mergeStart | O.mergeMiddleStart))) {
        if (changedCars & 0x800) priority = car2 & 0x800 ? -1 : 1;
        else if (changedCars & 0x400) priority = car2 & 0x400 ? -1 : 1;
        else if (changedCars & 0x4000000) priority = car1 & 0x4000000 ? -1 : 1;
        else if (changedCars & 1) priority = car2 & 1 ? -1 : 1;
        else {
          const aTan = tangent3(a.curve, lerp(t[0], t[1], 0.5)),
            bTan = tangent3(b.curve, lerp(t[2], t[3], 0.5)),
            turn = options.leftHandTraffic ? right : left;
          priority =
            (dot(turn(aTan), bTan) > 0 ? 1 : 0) +
            (dot(turn(bTan), aTan) > 0 ? -1 : 0);
        }
      }
      if (!(p2 & P.parking))
        overlaps.get(id1)!.push({
          ...cs2QuantizeOverlap(t, flags1, parallel1, priority),
          other: id2,
        });
      const inverse: CS2OverlapRange = [t[2], t[3], t[0], t[1]];
      if (differentOwner) {
        if (sharedStartDelta || sharedEndDelta || !(p1 & P.parking))
          extra.push({
            entity: id2,
            sharedStartDelta,
            sharedEndDelta,
            ...(p1 & P.parking
              ? {}
              : {
                  overlap: {
                    ...cs2QuantizeOverlap(
                      inverse,
                      flags2,
                      parallel2,
                      -priority,
                    ),
                    other: id1,
                  },
                }),
          });
      } else if (!(p1 & P.parking))
        output2.push({
          ...cs2QuantizeOverlap(inverse, flags2, parallel2, -priority),
          other: id1,
        });
    }
  }
  const updatedOwners = [...(options.owners ?? [...world.owners.keys()])],
    added = new Set<string>();
  // AddNonUpdatedEdgesJob walks the growing source list and deduplicates additions.
  if (!options.updateAll)
    for (let i = 0; i < updatedOwners.length; i++)
      for (const edge of world.owners.get(updatedOwners[i])?.connectedEdges ??
        [])
        if (!world.owners.get(edge)?.updated && !added.has(edge)) {
          added.add(edge);
          updatedOwners.push(edge);
        }
  for (const ownerId of updatedOwners) {
    const owner = world.owners.get(ownerId);
    if (!owner) throw new Error(`Missing source overlap owner: ${ownerId}`);
    for (let i = 0; i < owner.lanes.length; i++) {
      const id = owner.lanes[i],
        row = lane(id),
        buffer = overlaps.get(id);
      if (
        !buffer ||
        row.secondary ||
        (row.prefab.flags & (P.parking | P.virtual)) === (P.parking | P.virtual)
      )
        continue;
      buffer.length = 0;
      const node = nodeState(row);
      node.sharedStartCount = node.sharedEndCount = 0;
      check(id, owner.lanes, i, !!owner.edge, false, node);
      if (owner.edge && !row.node)
        for (const endpoint of [owner.edge.startOwner, owner.edge.endOwner]) {
          const next = world.owners.get(endpoint);
          if (!next || !(options.updateAll || next.updated)) continue;
          const index = next.entityIndex >>> 0,
            matches = (key: bigint) =>
              Number((key >> 32n) & 0xffffffffn) === index;
          if (matches(row.nodes.start) || matches(row.nodes.end))
            check(id, next.lanes, next.lanes.length, true, true, node);
        }
      if (row.node) nodes.set(id, node);
    }
  }
  for (const item of extra) {
    if (item.overlap) overlaps.get(item.entity)!.push(item.overlap);
    if (item.sharedStartDelta || item.sharedEndDelta) {
      const node = nodes.get(item.entity);
      if (!node)
        throw new Error(`Missing extra-overlap NodeLane ${item.entity}`);
      node.sharedStartCount = Math.min(
        254,
        node.sharedStartCount + item.sharedStartDelta,
      );
      node.sharedEndCount = Math.min(
        254,
        node.sharedEndCount + item.sharedEndDelta,
      );
    }
  }
  const sortedOwners = new Set(updatedOwners);
  for (const ownerId of sortedOwners)
    for (const id of world.owners.get(ownerId)!.lanes)
      if (!lane(id).secondary)
        overlaps
          .get(id)
          ?.sort(
            (a, b) =>
              ((a.thisStart << 8) | a.thisEnd) -
              ((b.thisStart << 8) | b.thisEnd),
          );
  return { overlaps, nodes, extra, updatedOwners };
}

/** UpdateLaneFlagsJob's non-edge CarLane crossing-count predicate. */
export function cs2LaneOverlapCrossCount(overlaps: readonly CS2LaneOverlap[]) {
  let count = 0;
  for (const overlap of overlaps)
    if (
      (overlap.flags &
        (O.mergeStart |
          O.mergeEnd |
          O.mergeMiddleStart |
          O.mergeMiddleEnd |
          O.unsafe |
          O.road)) ===
        O.road ||
      (overlap.flags & (O.road | O.mergeFlip)) === (O.road | O.mergeFlip)
    )
      count++;
  return Math.min(255, count);
}

/** Exact ordinary-car non-edge branch of UpdateLaneFlagsJob: shared-count255
 * roundabout sentinels and lane-cross counts, including master minimum.
 * Other edge/track flag propagation is an explicit remaining upstream stage.
 */
export function cs2FinalizeNodeLaneOverlaps(
  world: CS2LaneOverlapWorld,
  previous: {
    overlaps: ReadonlyMap<string, readonly CS2ProducedLaneOverlap[]>;
    nodes: ReadonlyMap<string, CS2OverlapNodeState>;
  },
  options: {
    lanes?: readonly string[];
    collectedLanes?: readonly string[];
  } = {},
) {
  const nodes = new Map(
      [...previous.nodes].map(([id, node]) => [
        id,
        { ...node, widthOffset: [...node.widthOffset] as [number, number] },
      ]),
    ),
    laneCrossCounts = new Map<string, number>(),
    sources = new Map<bigint, number>(),
    targets = new Map<bigint, number>();
  // Normal CarLane branch of CollectLaneDirectionsJob. Unsafe lanes do not enter maps.
  const collectedIds = options.collectedLanes ?? options.lanes;
  const collected = collectedIds?.map((id) => world.lanes.get(id)!) ?? [
    ...world.lanes.values(),
  ];
  for (const lane of collected)
    if (
      !lane.secondary &&
      lane.prefab.flags & P.road &&
      !((lane.carFlags ?? 0) & 1)
    ) {
      sources.set(lane.nodes.end, (sources.get(lane.nodes.end) ?? 0) + 1);
      targets.set(lane.nodes.start, (targets.get(lane.nodes.start) ?? 0) + 1);
    }
  const edgeLanes = new Set(
    [...world.owners.values()].flatMap((owner) =>
      owner.edge ? [...owner.lanes] : [],
    ),
  );
  const ownerEquals = (a: bigint, b: bigint) => a >> 32n === b >> 32n;
  for (const id of options.lanes ?? [...world.lanes.keys()]) {
    const lane = world.lanes.get(id)!;
    if (
      !(lane.prefab.flags & P.road) ||
      (lane.edgeLane ?? edgeLanes.has(id)) ||
      lane.secondary
    )
      continue;
    const node = nodes.get(id);
    if (node && (lane.carFlags ?? 0) & 0x400000) {
      if (
        ownerEquals(lane.nodes.end, lane.nodes.middle) &&
        !(targets.get(lane.nodes.end) ?? 0)
      )
        node.sharedEndCount = 255;
      if (
        ownerEquals(lane.nodes.start, lane.nodes.middle) &&
        !(sources.get(lane.nodes.start) ?? 0)
      )
        node.sharedStartCount = 255;
    }
    let count = 0;
    if (lane.masterMembers) {
      let minimum = 256;
      for (const member of lane.masterMembers) {
        const overlaps = previous.overlaps.get(member);
        if (overlaps)
          minimum = Math.min(minimum, cs2LaneOverlapCrossCount(overlaps));
      }
      count = minimum === 256 ? 0 : minimum;
    } else count = cs2LaneOverlapCrossCount(previous.overlaps.get(id) ?? []);
    laneCrossCounts.set(id, count);
  }
  return { nodes, laneCrossCounts };
}

/** RoadLab projection, separate from the source algorithm. Physical successor
 * endpoints share a PathNode identity. Connections at one explicit junction
 * share a node owner; all pieces of a road share one edge owner. Synthetic IDs
 * are not represented as recovered original Unity entity or prefab values.
 */
export function cs2CreateLaneOverlapWorld(
  network: Cs2CompiledNetwork,
  options: {
    junctionForLane?: (lane: Cs2NetworkLane) => string | undefined;
    carFlags?: (lane: Cs2NetworkLane) => number;
  } = {},
): CS2LaneOverlapWorld {
  const physical = [...network.lanes.values()].filter(
      (lane) => lane.role !== "master",
    ),
    byId = new Map(physical.map((lane, i) => [lane.id, i]));
  const parent = Array.from({ length: physical.length * 2 }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a: number, b: number) => {
    parent[find(b)] = find(a);
  };
  for (const [from, next] of network.successors) {
    const a = byId.get(from);
    if (a === undefined) continue;
    for (const id of next) {
      const b = byId.get(id);
      if (b !== undefined) unite(a * 2 + 1, b * 2);
    }
  }
  const key = (type: string, id: string) => JSON.stringify([type, id]);
  const nodeOwners = new Map<number, string>(),
    ownerRows = new Map<
      string,
      {
        lanes: string[];
        edge?: { startOwner: string; endOwner: string };
        updated: boolean;
        entityIndex: number;
        connectedEdges: string[];
      }
    >();
  const ensure = (id: string) => {
    let row = ownerRows.get(id);
    if (!row) {
      row = {
        lanes: [],
        updated: true,
        entityIndex: ownerRows.size + 1,
        connectedEdges: [],
      };
      ownerRows.set(id, row);
    }
    return row;
  };
  const laneOwner = new Map<string, string>();
  for (let i = 0; i < physical.length; i++) {
    const lane = physical[i];
    if (lane.kind === "connection") {
      const junction = options.junctionForLane?.(lane) ?? lane.junction;
      if (junction === undefined)
        throw new Error(
          `Explicit junction owner required for overlap lane: ${lane.id}`,
        );
      const owner = key("junction", junction);
      ensure(owner);
      laneOwner.set(lane.id, owner);
      for (const endpoint of [i * 2, i * 2 + 1]) {
        const root = find(endpoint),
          previous = nodeOwners.get(root);
        if (previous && previous !== owner)
          throw new Error(
            `Physical endpoint belongs to different junction owners: ${lane.id}`,
          );
        nodeOwners.set(root, owner);
      }
    } else {
      if (lane.road === undefined)
        throw new Error(`Road owner required for overlap lane: ${lane.id}`);
      const owner = key("road", lane.road);
      ensure(owner);
      laneOwner.set(lane.id, owner);
    }
  }
  const roadEnds = new Map<string, [string | undefined, string | undefined]>(),
    extents = new Map<string, [number, number]>();
  for (const lane of physical)
    if (lane.kind === "road" && lane.roadInterval) {
      const owner = laneOwner.get(lane.id)!,
        extent = extents.get(owner) ?? [Infinity, -Infinity];
      extent[0] = Math.min(extent[0], ...lane.roadInterval);
      extent[1] = Math.max(extent[1], ...lane.roadInterval);
      extents.set(owner, extent);
    }
  const endSlot = (lane: Cs2NetworkLane, endpoint: number) => {
    const extent = extents.get(laneOwner.get(lane.id)!),
      t = lane.roadInterval?.[endpoint];
    return t === extent?.[0] ? 0 : t === extent?.[1] ? 1 : null;
  };
  // An unconnected outer lane still belongs to its road endpoint's junction.
  // Gather endpoint owners from actual connectors before allocating outside ends.
  for (let i = 0; i < physical.length; i++) {
    const lane = physical[i];
    if (lane.kind !== "road" || !lane.roadInterval) continue;
    const pair = roadEnds.get(laneOwner.get(lane.id)!) ?? [
      undefined,
      undefined,
    ];
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      const t = endSlot(lane, endpoint),
        owner = nodeOwners.get(find(i * 2 + endpoint));
      if (t !== null && owner) {
        if (pair[t] && pair[t] !== owner)
          throw new Error(
            `Road endpoint spans different junction owners: ${lane.id}`,
          );
        pair[t] = owner;
      }
    }
    roadEnds.set(laneOwner.get(lane.id)!, pair);
  }
  for (let i = 0; i < physical.length; i++) {
    const lane = physical[i];
    if (lane.kind !== "road") continue;
    if (!lane.roadInterval)
      throw new Error(
        `Road interval required for source edge endpoints: ${lane.id}`,
      );
    const pair = roadEnds.get(laneOwner.get(lane.id)!) ?? [
      undefined,
      undefined,
    ];
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      const t = endSlot(lane, endpoint);
      if (t === null) continue;
      const root = find(i * 2 + endpoint),
        owner =
          nodeOwners.get(root) ??
          pair[t] ??
          key("outside", JSON.stringify([lane.road, t]));
      if (pair[t] && pair[t] !== owner)
        throw new Error(
          `Road endpoint spans different junction owners: ${lane.id}`,
        );
      ensure(owner);
      nodeOwners.set(root, owner);
      pair[t] = owner;
    }
    roadEnds.set(laneOwner.get(lane.id)!, pair);
  }
  for (const [id, pair] of roadEnds) {
    const startOwner = pair[0] ?? key("outside-start", id),
      endOwner = pair[1] ?? key("outside-end", id);
    ensure(startOwner);
    ensure(endOwner);
    ensure(id).edge = { startOwner, endOwner };
    for (const endpoint of new Set([startOwner, endOwner]))
      ensure(endpoint).connectedEdges.push(id);
  }
  // CreateEdgeLane uses edge-owned PathNodes; CreateNodeLane inherits its
  // source/target edge PathNodes and owns only its middle node at the junction.
  // A node owner's SubLane scope is not a PathNode endpoint owner.
  const pathOwners = new Map<number, string>();
  for (let i = 0; i < physical.length; i++)
    if (physical[i].kind === "road") {
      const owner = laneOwner.get(physical[i].id)!;
      for (const endpoint of [i * 2, i * 2 + 1]) {
        const root = find(endpoint),
          previous = pathOwners.get(root);
        if (previous && previous !== owner)
          throw new Error(
            `Physical road endpoint shares incompatible edge owners: ${physical[i].id}`,
          );
        pathOwners.set(root, owner);
      }
    }
  const endpoints = new Map<number, bigint>(),
    counts = new Map<string, number>();
  const node = (owner: string) => {
    const count = counts.get(owner) ?? 0;
    if (count > 65535)
      throw new Error(
        `Synthetic PathNode ushort lane range exceeded: ${owner}`,
      );
    counts.set(owner, count + 1);
    return (BigInt(ensure(owner).entityIndex) << 32n) | BigInt(count);
  };
  const lanes = new Map<string, CS2OverlapLane>();
  for (let i = 0; i < physical.length; i++) {
    const lane = physical[i],
      owner = laneOwner.get(lane.id)!;
    ensure(owner).lanes.push(lane.id);
    const endpoint = (offset: number) => {
      const root = find(i * 2 + offset);
      if (!endpoints.has(root))
        endpoints.set(
          root,
          node(pathOwners.get(root) ?? nodeOwners.get(root) ?? owner),
        );
      return endpoints.get(root)!;
    };
    const curve: CS2NavigationCurve = {
      ...lane.curve,
      length: f(lane.curve.length),
      width: f(lane.curve.width),
      points: lane.curve.points.map((p) => ({
        x: f(p.x),
        y: f(p.y),
        z: f(p.z),
      })) as unknown as CS2NavigationCurve["points"],
      widthOffset: lane.curve.widthOffset?.map(f) as
        [number, number] | undefined,
    };
    lanes.set(lane.id, {
      curve,
      nodes: { start: endpoint(0), middle: node(owner), end: endpoint(1) },
      prefab: { width: curve.width, flags: P.road },
      carFlags: options.carFlags?.(lane) ?? lane.laneFlags,
      ...(lane.kind === "connection"
        ? {
            node: {
              widthOffset: curve.widthOffset ?? [0, 0],
              sharedStartCount: 0,
              sharedEndCount: 0,
            },
          }
        : {}),
      edgeLane: lane.kind === "road",
      hasOverlapBuffer: true,
    });
  }
  return { lanes, owners: ownerRows };
}
