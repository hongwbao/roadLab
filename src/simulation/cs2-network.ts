/** Shared lane topology adapter; source boundaries are documented in CS2_NETWORK.md. */
import type { Connection, Project, Road, V } from "../core/types";
import { physicalLaneEndpointT } from "../core/junction-lane-geometry";
import {
  add,
  arcParameter,
  arcTable,
  bezier,
  clamp,
  dist,
  knotAt,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  mul,
  norm,
  sub,
} from "../core/math";
import type { CS2NavigationCurve } from "./cs2-navigation-target";
import type {
  Cs2SearchGraph,
  Cs2SearchStep,
  Cs2SearchTarget,
} from "./cs2-path-search";
import {
  CS2_DEFAULT_CAR_PATH_COSTS,
  CS2_PATH_METHOD,
  cs2CarDriveCosts,
  type Cs2CostVector,
  type Cs2NavigationGroup,
} from "./cs2-routing";
import {
  CS2_ROAD_LANE_FLAGS as F,
  cs2IsTurn,
  cs2NodeLaneFlags,
} from "./cs2-road-rules";

export type Cs2NetworkBezier = readonly [V, V, V, V];
const DEFAULT_LANE_WIDTH_RATIO = 0.8;

/** Host rule for an authored connection into/out of a derived collar. Keep a
 * deeper real junction trim; never extend a genuine profile or an automatic
 * connection through a zero-width endpoint. Geometry and compiler share it. */
export function cs2NetworkLaneEndpointT(
  road: Road,
  lane: number,
  end: 0 | 1,
  trimT: number,
  authored: boolean,
  minimumWidthRatio = DEFAULT_LANE_WIDTH_RATIO,
) {
  if (!authored || !road.autoTaper?.[end === 0 ? "start" : "end"]) return trimT;
  const root = physicalLaneEndpointT(road, lane, end, minimumWidthRatio);
  return root === undefined
    ? trimT
    : end === 0
      ? Math.max(trimT, root)
      : Math.min(trimT, root);
}
export type Cs2NetworkConnectionGeometry = {
  /** Actual lane-centre connector, in travel order, after junction trimming. */
  points: Cs2NetworkBezier;
  length?: number;
  width?: number;
  widthOffset?: readonly [number, number];
  laneFlags?: number;
  junction?: string;
};
export type Cs2NetworkPathProperties = {
  laneFlags?: number;
  flowOffset?: number;
  density?: number;
  laneCrossCount?: number;
  rules?: number;
  methods?: number;
  accessRequirement?: number;
  blockageStart?: number;
  blockageEnd?: number;
};
export type Cs2NetworkLane = {
  id: string;
  kind: "road" | "connection";
  /** Source-compatible global owner; physical slaves are absent from graph. */
  group: string;
  role: "standalone" | "slave" | "master";
  curve: CS2NavigationCurve;
  laneFlags: number;
  maxSpeed: number;
  road?: string;
  lane?: number;
  direction?: 1 | -1;
  /** Original road parameter at the travel-oriented curve start and end. */
  roadInterval?: readonly [number, number];
  connection?: string;
  from?: { road: string; lane: number };
  to?: { road: string; lane: number };
  junction?: string;
};
export type Cs2NetworkGroup = {
  id: string;
  master: string;
  /** Actual drivable lanes only. Never drive a virtual master centreline. */
  members: readonly string[];
  kind: "road" | "connection";
  allowChange: boolean;
  startNode: number;
  middleNode: number;
  endNode: number;
  edge: number;
};
export type Cs2NetworkLocation = {
  laneId: string;
  group: string;
  edge: number;
  curveT: number;
  roadT: number;
  /** Global master parameter; may differ from a slave's local arc length. */
  delta: number;
};
export type Cs2NetworkPathGroup = {
  group: string;
  laneIds: readonly string[];
  interval: readonly [number, number];
  navigation: Cs2NavigationGroup;
};
export type Cs2NetworkInput = {
  project: Project;
  /** Use the caller's real, already rule-filtered connections, not regenerated ones. */
  connections: readonly Connection[];
  revision: number;
  /** Metres along the geometric road centreline, from each end. */
  roadTrims?: ReadonlyMap<string, { start: number; end: number }>;
  connectionGeometry?:
    | ReadonlyMap<string, Cs2NetworkConnectionGeometry>
    | ((connection: Connection) => Cs2NetworkConnectionGeometry | undefined);
  /** Browser geometry fitting tolerance in metres, not a recovered CS2 setting. */
  geometryTolerance?: number;
  /** RoadLab's usable-lane policy. Source lane allocation is a separate system. */
  minimumLaneWidthRatio?: number;
  pathProperties?: (
    lane: Readonly<Cs2NetworkLane>,
  ) => Cs2NetworkPathProperties | undefined;
  heuristicCosts?: Cs2CostVector;
};
export type Cs2CompiledNetwork = {
  revision: number;
  lanes: ReadonlyMap<string, Cs2NetworkLane>;
  /** Includes virtual masters for inspection; runtime must queue only group.members. */
  curves: ReadonlyMap<string, CS2NavigationCurve>;
  groups: ReadonlyMap<string, Cs2NetworkGroup>;
  graph: Cs2SearchGraph;
  graphLaneIds: readonly string[];
  /** Key created by cs2RoadLaneKey; values are physical pieces in travel order. */
  roadLaneIds: ReadonlyMap<string, readonly string[]>;
  connectionLaneIds: ReadonlyMap<string, string>;
  /** Physical lane continuity only. Lane changes are local group selection. */
  successors: ReadonlyMap<string, readonly string[]>;
  warnings: readonly string[];
  locateRoadLane(
    road: string,
    lane: number,
    travelS: number,
  ): Cs2NetworkLocation | undefined;
  targetsForRoad(
    road: string,
    travelS: number,
    lane?: number,
  ): Cs2SearchTarget[];
  groupsForPath(steps: readonly Cs2SearchStep[]): Cs2NetworkPathGroup[];
  nextLane(oldLaneId: string, requestedLaneId: string): string | null;
};

export const cs2RoadLaneKey = (road: string, lane: number) =>
  JSON.stringify([road, lane]);
const key = (...parts: (string | number)[]) => "cs2:" + JSON.stringify(parts);
const copy = (p: V): V => ({ x: p.x, y: p.y, z: p.z });
const float = Math.fround;
const parameterKey = (t: number) => Number(t.toFixed(10));
const tiny = 1e-8;

export {
  cs2PackPathNode,
  cs2ReadPathNode,
  cs2StripPathNodeCurve,
} from "../core/cs2-path-node";

function curveLength(points: Cs2NetworkBezier) {
  let previous = points[0],
    length = 0;
  for (let i = 1; i <= 64; i++) {
    const p = bezier(...points, i / 64);
    length += dist(previous, p);
    previous = p;
  }
  return length;
}
function fit(fn: (t: number) => V, a: number, b: number): Cs2NetworkBezier {
  const width = b - a,
    h = Math.min(1e-5, Math.abs(width) / 1000);
  const start = fn(a),
    end = fn(b);
  // One-sided derivatives stay within the same original knot and taper piece.
  const startDerivative = mul(sub(fn(a + Math.sign(width) * h), start), 1 / h);
  const endDerivative = mul(sub(end, fn(b - Math.sign(width) * h)), 1 / h);
  return [
    start,
    add(start, mul(startDerivative, Math.abs(width) / 3)),
    sub(end, mul(endDerivative, Math.abs(width) / 3)),
    end,
  ];
}
function fitError(
  points: Cs2NetworkBezier,
  fn: (t: number) => V,
  a: number,
  b: number,
) {
  let error = 0;
  for (const u of [0.125, 0.25, 0.5, 0.75, 0.875])
    error = Math.max(error, dist(bezier(...points, u), fn(a + (b - a) * u)));
  return error;
}
function horizontalAngle(points: Cs2NetworkBezier) {
  // Colossal.MathUtils.TryNormalize: float32 dot, rsqrt and multiplication.
  const normalize = (a: V, b: V): readonly [number, number] | undefined => {
    const x = float(float(b.x) - float(a.x)),
      z = float(float(b.z) - float(a.z)),
      square = float(float(x * x) + float(z * z));
    if (!(square > float(1.1754944e-38))) return;
    const inverse = float(1 / float(Math.sqrt(square)));
    return [float(x * inverse), float(z * inverse)];
  };
  const a = normalize(points[0], points[1]),
    b = normalize(points[2], points[3]);
  return a && b
    ? float(
        Math.acos(clamp(float(float(a[0] * b[0]) + float(a[1] * b[1])), -1, 1)),
      )
    : 0;
}

/** Normal car branch of original GetCarDriveSpecification, independent of ECS. */
export function cs2NetworkPathSpecification(
  curve: CS2NavigationCurve,
  maxSpeed: number,
  input: Cs2NetworkPathProperties = {},
) {
  const flags = input.laneFlags ?? 0,
    unsafe = !!(flags & F.unsafe);
  let edgeFlags = 1 | (unsafe ? 0 : 4),
    rules = input.rules ?? 0;
  if (flags & F.twoway) edgeFlags |= 2;
  if (flags & F.sideConnection) edgeFlags |= 8;
  if ((flags >>> 0) & 0x80000000) edgeFlags |= 512;
  if (flags & F.publicOnly) rules |= 16;
  if (flags & F.highway) rules |= 32;
  const blockageStart = input.blockageStart ?? 255,
    blockageEnd = input.blockageEnd ?? 0;
  if (blockageEnd >= blockageStart) rules |= 1;
  return {
    length: float(curve.length),
    maxSpeed: float(maxSpeed),
    flowOffset: input.flowOffset ?? 0,
    methods: input.methods ?? CS2_PATH_METHOD.road,
    costs: cs2CarDriveCosts({
      length: curve.length,
      curveAngle: horizontalAngle(curve.points),
      laneCrossCount: input.laneCrossCount,
      approach: !!(flags & F.approach),
      turning: !!(
        flags &
        (F.turnLeft | F.turnRight | F.gentleTurnLeft | F.gentleTurnRight)
      ),
      uTurn: !!(flags & (F.uTurnLeft | F.uTurnRight)),
      unsafe,
      highway: !!(flags & F.highway),
      forbidden: !!(flags & F.forbidden),
    }),
    flags: edgeFlags,
    rules,
    accessRequirement: input.accessRequirement ?? -1,
    blockageStart: blockageEnd >= blockageStart ? blockageStart : 0,
    blockageEnd: blockageEnd >= blockageStart ? blockageEnd : 0,
    density: float(Math.sqrt(float(input.density ?? 0.01))),
  };
}

/** Compile one immutable topology revision shared by route selection and motion. */
export function compileCs2Network(input: Cs2NetworkInput): Cs2CompiledNetwork {
  const lanes = new Map<string, Cs2NetworkLane>(),
    curves = new Map<string, CS2NavigationCurve>(),
    groups = new Map<string, Cs2NetworkGroup>(),
    roadLaneIds = new Map<string, string[]>(),
    connectionLaneIds = new Map<string, string>(),
    successors = new Map<string, string[]>(),
    warnings: string[] = [],
    roadTables = new Map<string, ReturnType<typeof arcTable>>(),
    roads = new Map(input.project.roads.map((r) => [r.id, r]));
  const tolerance = Math.max(0.001, input.geometryTolerance ?? 0.03),
    usableRatio = clamp(
      input.minimumLaneWidthRatio ?? DEFAULT_LANE_WIDTH_RATIO,
      0.01,
      1,
    );
  let nextNode = 0;
  const nodeIds = new Map<string, number>();
  const node = (id: string) => {
    if (!nodeIds.has(id)) nodeIds.set(id, nextNode++);
    return nodeIds.get(id)!;
  };
  const register = (lane: Cs2NetworkLane) => {
    lanes.set(lane.id, lane);
    curves.set(lane.id, lane.curve);
    if (lane.role !== "master") successors.set(lane.id, []);
  };
  const link = (a: string, b: string) => {
    const list = successors.get(a);
    if (list && !list.includes(b)) list.push(b);
  };
  const addGroup = (
    id: string,
    members: string[],
    masterCurve: CS2NavigationCurve,
    kind: Cs2NetworkGroup["kind"],
    startNode: number,
    endNode: number,
  ) => {
    const master = members.length === 1 ? members[0] : key("master", id);
    const representative = lanes.get(members[0])!;
    if (members.length > 1)
      register({
        ...representative,
        id: master,
        role: "master",
        // Runtime uses this extra marker to reject accidental motion on a master.
        curve: Object.assign(
          { ...masterCurve, id: master },
          { isMaster: true },
        ),
        group: id,
      });
    for (const member of members) {
      const lane = lanes.get(member)!;
      lane.group = id;
      lane.role = members.length > 1 ? "slave" : "standalone";
    }
    groups.set(id, {
      id,
      master,
      members,
      kind,
      allowChange: kind === "road" && members.length > 1,
      startNode,
      middleNode: node(key("middle", id)),
      endNode,
      edge: -1,
    });
    return groups.get(id)!;
  };

  for (const road of [...roads.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (road.knots.length < 2) {
      warnings.push(`Road ${road.id}: fewer than two knots`);
      continue;
    }
    const table = arcTable(road),
      total = table.at(-1)!.s;
    roadTables.set(road.id, table);
    const trim = input.roadTrims?.get(road.id),
      lower = arcParameter(table, Math.max(0, trim?.start ?? 0)),
      upper = arcParameter(table, total - Math.max(0, trim?.end ?? 0));
    if (upper - lower < tiny) {
      warnings.push(`Road ${road.id}: trims consume road`);
      continue;
    }
    for (const direction of [-1, 1] as const) {
      const roadLanes = Array.from(
        { length: laneCount(road) },
        (_, i) => i,
      ).filter((lane) => laneDirection(road, lane) === direction);
      if (!roadLanes.length) continue;
      const usable = (lane: number, t: number) =>
        laneWidth(road, lane, t) + 1e-7 >= road.width * usableRatio;
      const cuts = new Set([
        lower,
        upper,
        ...road.knots
          .map((_, i) => knotAt(road, i))
          .filter((t) => t > lower && t < upper),
      ]);
      // Width roots encode the browser's existing taper policy explicitly.
      for (const lane of roadLanes) {
        roadLaneIds.set(cs2RoadLaneKey(road.id, lane), []);
        for (let i = 0; i < 128; i++) {
          let a = lower + ((upper - lower) * i) / 128,
            b = lower + ((upper - lower) * (i + 1)) / 128;
          const state = usable(lane, a);
          if (state === usable(lane, b)) continue;
          for (let j = 0; j < 32; j++) {
            const middle = (a + b) / 2;
            if (usable(lane, middle) === state) a = middle;
            else b = middle;
          }
          cuts.add((a + b) / 2);
        }
      }
      const weightedCentre = (t: number) => {
        let sum = { x: 0, y: 0, z: 0 },
          weight = 0;
        for (const lane of roadLanes) {
          const w = laneWidth(road, lane, t);
          sum = add(sum, mul(lanePoint(road, lane, t), w));
          weight += w;
        }
        return weight > tiny
          ? mul(sum, 1 / weight)
          : lanePoint(road, roadLanes[0], t);
      };
      const refined: number[] = [];
      const refine = (a: number, b: number, depth: number) => {
        const functions = roadLanes
          .filter((lane) => usable(lane, (a + b) / 2))
          .map((lane) => (t: number) => lanePoint(road, lane, t));
        functions.push(weightedCentre);
        const error = Math.max(
          ...functions.map((fn) => fitError(fit(fn, a, b), fn, a, b)),
        );
        if (error > tolerance && depth < 9) {
          const m = (a + b) / 2;
          refine(a, m, depth + 1);
          refine(m, b, depth + 1);
        } else {
          refined.push(a);
          if (error > tolerance)
            warnings.push(
              `Road ${road.id}: cubic fit error ${error.toFixed(3)}m`,
            );
        }
      };
      const orderedCuts = [...cuts].sort((a, b) => a - b);
      for (let i = 1; i < orderedCuts.length; i++)
        refine(orderedCuts[i - 1], orderedCuts[i], 0);
      refined.push(upper);
      if (direction === -1) refined.reverse();
      for (let i = 1; i < refined.length; i++) {
        const a = refined[i - 1],
          b = refined[i];
        if (Math.abs(a - b) < tiny) continue;
        const members: string[] = [],
          groupId = key(
            "road-group",
            road.id,
            direction,
            parameterKey(a),
            parameterKey(b),
          );
        for (const laneIndex of roadLanes) {
          if (!usable(laneIndex, (a + b) / 2)) continue;
          const id = key(
              "road-lane",
              road.id,
              laneIndex,
              parameterKey(a),
              parameterKey(b),
            ),
            points = fit((t) => lanePoint(road, laneIndex, t), a, b),
            width = road.width,
            curve: CS2NavigationCurve = {
              id,
              points,
              length: curveLength(points),
              width,
              widthOffset: [
                laneWidth(road, laneIndex, a) - width,
                laneWidth(road, laneIndex, b) - width,
              ],
              highway: !!road.highwayRules,
            };
          register({
            id,
            group: groupId,
            kind: "road",
            role: "standalone",
            curve,
            road: road.id,
            lane: laneIndex,
            direction,
            roadInterval: [a, b],
            laneFlags: road.highwayRules ? F.highway : 0,
            maxSpeed: road.speed / 3.6,
          });
          const previous = roadLaneIds.get(cs2RoadLaneKey(road.id, laneIndex))!;
          const last = lanes.get(previous.at(-1) ?? "");
          if (last && Math.abs(last.roadInterval![1] - a) < 1e-7)
            link(last.id, id);
          previous.push(id);
          members.push(id);
        }
        if (!members.length) continue;
        const points = fit(weightedCentre, a, b);
        addGroup(
          groupId,
          members,
          {
            id: groupId,
            points,
            length: curveLength(points),
            width: road.width,
            highway: !!road.highwayRules,
          },
          "road",
          node(key("road-node", road.id, direction, parameterKey(a))),
          node(key("road-node", road.id, direction, parameterKey(b))),
        );
      }
    }
  }

  const connectionGroups = new Map<
    string,
    { members: string[]; from: Cs2NetworkGroup; to: Cs2NetworkGroup }
  >();
  for (const connection of [...input.connections].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (!connection.enabled) continue;
    const fromRoad = roads.get(connection.from.road),
      toRoad = roads.get(connection.to.road),
      fromId = roadLaneIds
        .get(cs2RoadLaneKey(connection.from.road, connection.from.lane))
        ?.at(-1),
      toId = roadLaneIds.get(
        cs2RoadLaneKey(connection.to.road, connection.to.lane),
      )?.[0];
    if (!fromRoad || !toRoad || !fromId || !toId) {
      warnings.push(`Connection ${connection.id}: missing usable lane`);
      continue;
    }
    const from = lanes.get(fromId)!,
      to = lanes.get(toId)!,
      fromEnd = from.roadInterval![1],
      toStart = to.roadInterval![0],
      fromTrim = input.roadTrims?.get(fromRoad.id),
      toTrim = input.roadTrims?.get(toRoad.id),
      fromTable = roadTables.get(fromRoad.id)!,
      toTable = roadTables.get(toRoad.id)!,
      expectedFrom = cs2NetworkLaneEndpointT(
        fromRoad,
        connection.from.lane,
        from.direction === 1 ? 1 : 0,
        arcParameter(
          fromTable,
          from.direction === 1
            ? fromTable.at(-1)!.s - (fromTrim?.end ?? 0)
            : (fromTrim?.start ?? 0),
        ),
        !!connection.manual,
        usableRatio,
      ),
      expectedTo = cs2NetworkLaneEndpointT(
        toRoad,
        connection.to.lane,
        to.direction === 1 ? 0 : 1,
        arcParameter(
          toTable,
          to.direction === 1
            ? (toTrim?.start ?? 0)
            : toTable.at(-1)!.s - (toTrim?.end ?? 0),
        ),
        !!connection.manual,
        usableRatio,
      );
    if (
      Math.abs(fromEnd - expectedFrom) > 1e-6 ||
      Math.abs(toStart - expectedTo) > 1e-6
    ) {
      warnings.push(`Connection ${connection.id}: lane fades before endpoint`);
      continue;
    }
    const supplied =
      typeof input.connectionGeometry === "function"
        ? input.connectionGeometry(connection)
        : input.connectionGeometry?.get(connection.id);
    let points: Cs2NetworkBezier;
    if (supplied)
      points = supplied.points.map(copy) as unknown as Cs2NetworkBezier;
    else {
      const a = from.curve.points[3],
        d = to.curve.points[0],
        span = dist(a, d) / 3,
        startTangent = norm(sub(a, from.curve.points[2])),
        endTangent = norm(sub(to.curve.points[1], d));
      points = [
        copy(a),
        add(a, mul(startTangent, span)),
        sub(d, mul(endTangent, span)),
        copy(d),
      ];
      warnings.push(
        `Connection ${connection.id}: generated Hermite geometry adapter`,
      );
    }
    if (
      dist(points[0], from.curve.points[3]) > 0.1 ||
      dist(points[3], to.curve.points[0]) > 0.1
    )
      warnings.push(
        `Connection ${connection.id}: supplied geometry endpoint mismatch`,
      );
    const fromGroup = groups.get(from.group)!,
      toGroup = groups.get(to.group)!,
      groupId = key("connection-group", from.group, to.group),
      id = key("connection-lane", connection.id),
      width = supplied?.width ?? Math.min(fromRoad.width, toRoad.width),
      curve: CS2NavigationCurve = {
        id,
        points,
        width,
        length: supplied?.length ?? curveLength(points),
        widthOffset: supplied?.widthOffset ?? [
          laneWidth(fromRoad, connection.from.lane, fromEnd) - width,
          laneWidth(toRoad, connection.to.lane, toStart) - width,
        ],
        highway: !!fromRoad.highwayRules && !!toRoad.highwayRules,
      },
      turn = cs2IsTurn(
        { position: points[0], tangent: norm(sub(points[1], points[0])) },
        { position: points[3], tangent: norm(sub(points[2], points[3])) },
      ),
      laneFlags =
        supplied?.laneFlags ??
        cs2NodeLaneFlags({
          sourceHighway: !!fromRoad.highwayRules,
          targetHighway: !!toRoad.highwayRules,
          yieldOffset: 0,
          turn,
          isIntersection: true,
        });
    register({
      id,
      group: groupId,
      kind: "connection",
      role: "standalone",
      curve,
      laneFlags,
      maxSpeed: (from.maxSpeed + to.maxSpeed) / 2,
      connection: connection.id,
      from: { ...connection.from },
      to: { ...connection.to },
      junction: supplied?.junction,
    });
    link(fromId, id);
    link(id, toId);
    connectionLaneIds.set(connection.id, id);
    const group = connectionGroups.get(groupId) ?? {
      members: [],
      from: fromGroup,
      to: toGroup,
    };
    group.members.push(id);
    connectionGroups.set(groupId, group);
  }
  for (const [id, group] of connectionGroups) {
    // Asset connection IDs do not express physical order. Local DP distances do.
    group.members.sort((a, b) => {
      const first = lanes.get(a)!,
        second = lanes.get(b)!;
      return (
        first.from!.lane - second.from!.lane ||
        first.to!.lane - second.to!.lane ||
        a.localeCompare(b)
      );
    });
    const memberCurves = group.members.map(
        (member) => lanes.get(member)!.curve,
      ),
      avg = (index: number) =>
        mul(
          memberCurves.reduce((sum, curve) => add(sum, curve.points[index]), {
            x: 0,
            y: 0,
            z: 0,
          }),
          1 / memberCurves.length,
        ),
      from = lanes.get(group.from.master)!.curve.points[3],
      to = lanes.get(group.to.master)!.curve.points[0],
      points: Cs2NetworkBezier = [
        copy(from),
        add(from, sub(avg(1), avg(0))),
        add(to, sub(avg(2), avg(3))),
        copy(to),
      ];
    addGroup(
      id,
      group.members,
      {
        id,
        points,
        length: curveLength(points),
        width: memberCurves[0].width,
        highway: memberCurves.every((curve) => curve.highway),
      },
      "connection",
      group.from.endNode,
      group.to.startNode,
    );
  }
  const graphLaneIds: string[] = [],
    graph: Cs2SearchGraph = {
      revision: input.revision,
      edges: [],
      heuristicCosts: {
        road: input.heuristicCosts ?? CS2_DEFAULT_CAR_PATH_COSTS.driving,
      },
    };
  const edges: Cs2SearchGraph["edges"][number][] = [];
  for (const group of groups.values()) {
    const lane = lanes.get(group.master)!;
    const properties = input.pathProperties?.(lane) ?? {};
    const specification = cs2NetworkPathSpecification(
      lane.curve,
      lane.maxSpeed,
      { ...properties, laneFlags: properties.laneFlags ?? lane.laneFlags },
    );
    group.edge = edges.length;
    graphLaneIds.push(lane.id);
    edges.push({
      id: group.edge,
      owner: lane.id,
      start: group.startNode,
      end: group.endNode,
      middle: group.middleNode,
      location: [copy(lane.curve.points[0]), copy(lane.curve.points[3])],
      specification,
    });
  }
  graph.edges = edges;

  const locateRoadLane = (
    roadId: string,
    laneIndex: number,
    travelS: number,
  ): Cs2NetworkLocation | undefined => {
    const road = roads.get(roadId),
      table = roadTables.get(roadId);
    if (
      !road ||
      !table ||
      !Number.isFinite(travelS) ||
      travelS < -tiny ||
      travelS > table.at(-1)!.s + tiny
    )
      return;
    const t = arcParameter(
        table,
        laneDirection(road, laneIndex) === 1
          ? travelS
          : table.at(-1)!.s - travelS,
      ),
      physical = roadLaneIds.get(cs2RoadLaneKey(roadId, laneIndex));
    if (!physical) return;
    // Prefer the following piece at a shared boundary, except at the route end.
    const id = [...physical].reverse().find((id) => {
      const [a, b] = lanes.get(id)!.roadInterval!;
      return t >= Math.min(a, b) - tiny && t <= Math.max(a, b) + tiny;
    });
    if (!id) return;
    const lane = lanes.get(id)!,
      [a, b] = lane.roadInterval!,
      group = groups.get(lane.group)!,
      curveT = clamp((t - a) / (b - a));
    return {
      laneId: id,
      group: group.id,
      edge: group.edge,
      curveT,
      roadT: t,
      delta: curveT,
    };
  };
  const targetsForRoad = (
    road: string,
    travelS: number,
    requestedLane?: number,
  ): Cs2SearchTarget[] => {
    const targetRoad = roads.get(road);
    if (!targetRoad) return [];
    const indices =
        requestedLane === undefined
          ? Array.from({ length: laneCount(targetRoad) }, (_, i) => i)
          : [requestedLane],
      targets = new Map<string, Cs2SearchTarget>();
    for (const lane of indices) {
      const position = locateRoadLane(road, lane, travelS);
      if (position)
        targets.set(`${position.edge}:${position.delta}`, {
          edge: position.edge,
          delta: position.delta,
          target: position.laneId,
        });
    }
    return [...targets.values()];
  };
  const groupsForPath = (
    steps: readonly Cs2SearchStep[],
  ): Cs2NetworkPathGroup[] =>
    steps.map((step, index) => {
      const master = lanes.get(step.owner),
        group = master && groups.get(master.group);
      if (!group || group.master !== step.owner || group.edge !== step.edge)
        throw new Error(`Stale or invalid CS2 path lane ${step.owner}`);
      const nextMaster = steps[index + 1] && lanes.get(steps[index + 1].owner),
        nextGroup = nextMaster && groups.get(nextMaster.group);
      return {
        group: group.id,
        laneIds: group.members,
        interval: step.delta,
        navigation: {
          curveStart: step.delta[0],
          curveEnd: step.delta[1],
          allowChange: group.allowChange,
          lanes: group.members.map((id, lane) => ({
            lane,
            objectCount: 0,
            next: nextGroup
              ? nextGroup.members.flatMap((nextId, nextIndex) =>
                  successors.get(id)?.includes(nextId) ? [nextIndex] : [],
                )
              : undefined,
          })),
        },
      };
    });
  const nextLane = (oldLaneId: string, requestedLaneId: string) => {
    const next = successors.get(oldLaneId) ?? [];
    if (next.includes(requestedLaneId)) return requestedLaneId;
    const requested = lanes.get(requestedLaneId);
    return requested
      ? (next.find((id) => lanes.get(id)?.group === requested.group) ?? null)
      : null;
  };
  return {
    revision: input.revision,
    lanes,
    curves,
    groups,
    graph,
    graphLaneIds,
    roadLaneIds,
    connectionLaneIds,
    successors,
    warnings,
    locateRoadLane,
    targetsForRoad,
    groupsForPath,
    nextLane,
  };
}
