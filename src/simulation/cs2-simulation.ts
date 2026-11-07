/** Ordinary-car source runtime assembly. Browser/world adapters are explicit. */
import { updateAutomaticTransitions } from "../core/auto-transitions";
import {
  buildEarlyLanePlan,
  chooseEarlyLane,
  laneChangeGapClear,
  type EarlyLanePlan,
} from "./early-lane-planning";
import { buildJunctions, type Junction } from "../core/junctions";
import {
  add,
  arcParameter,
  arcTable,
  bezier,
  clamp,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  mul,
  tangent,
} from "../core/math";
import { connections, normalizePorts } from "../core/model";
import { turnOf } from "../core/lane-rules";
import {
  isSink,
  isSource,
  type Connection,
  type Port,
  type Project,
  type Road,
  type V,
} from "../core/types";
import { signalStopOffset, signalForJunction } from "../core/traffic-signals";
import {
  CS2_BASE_CAR,
  CS2_NAVIGATION_TIMESTEP,
  cs2CurveCurviness,
  cs2LowSpeedDistanceOffset,
  cs2MaxDriveSpeed,
  cs2SafetyTime,
  cs2SpeedRange,
} from "./cs2-driving";
import {
  cs2AdvanceReservation,
  cs2ApplyReservation,
  type CS2LaneReservation,
} from "./cs2-conflicts";
import {
  cs2ReserveNavigationLanes,
  type CS2ReservationWorld,
} from "./cs2-reservations";
import {
  CS2CarLaneSpeedIterator,
  type CS2LaneSpeedLane,
  type CS2LaneSpeedObject,
  type CS2LaneSpeedWorld,
} from "./cs2-lane-speed";
import {
  CS2CurrentLaneCache,
  applyCS2LaneCacheCommands,
  cs2AddLaneObject,
  type CS2BlockedLane,
  type CS2LaneCacheBounds,
  type CS2LaneCacheCommand,
  type CS2LaneCacheCurrent,
  type CS2LaneCacheWorld,
} from "./cs2-lane-cache";
import type { CS2LaneSpeedLaneObject } from "./cs2-lane-speed";
import {
  cs2CheckLaneSelectionBlocker,
  cs2CreateLaneSelectWorld,
  cs2GetNextSelectLane,
  cs2ResolveLaneSelectionMaster,
  cs2SelectCurveDistanceSquared,
  cs2SelectOptimalLanes,
  type CS2LaneSelectWorld,
} from "./cs2-lane-select";
import { cs2LookRotationSafe, type CS2MotionState } from "./cs2-motion";
import {
  compileCs2Network,
  cs2NetworkPathSpecification,
  cs2RoadLaneKey,
  type Cs2CompiledNetwork,
  type Cs2NetworkConnectionGeometry,
  type Cs2NetworkLane,
  type Cs2NetworkPathGroup,
} from "./cs2-network";
import {
  CS2_NAV_TARGET_FLAGS,
  cs2LaneOffset,
  cs2NavigationCurvePosition,
  type CS2NavigationCurrentState,
  type CS2NavigationQueuedLane,
} from "./cs2-navigation-target";
import {
  cs2CreateLaneOverlapWorld,
  cs2FinalizeNodeLaneOverlaps,
  cs2UpdateLaneOverlaps,
  type CS2ProducedLaneOverlap,
} from "./cs2-lane-overlaps";
import { CS2_ROAD_LANE_FLAGS as NET } from "./cs2-road-rules";
import {
  Cs2BlockerType,
  Cs2PathFlags,
  applyCs2PathResult,
  cs2PathfindFailed,
  cs2PersonalCarFallbackParameters,
  cs2RequireNewPath,
  cs2StuckPathDecision,
  prepareCs2PersonalCarPathRequest,
  type Cs2PathBlocker,
  type Cs2PathOwner,
} from "./cs2-path-policy";
import {
  CS2_PERSONAL_CAR_FLAGS,
  createCS2PersonalCarWorld,
  runCS2PersonalCarAI,
  type CS2PersonalCarAdvance,
  type CS2PersonalCarCallbacks,
  type CS2PersonalCarCommand,
  type CS2PersonalCarState,
  type CS2PersonalCarWorld,
  type CS2PersonalPathElement,
} from "./cs2-personal-car-ai";
import { Cs2PathService } from "./cs2-path-service";
import {
  SourceRandom32,
  deriveCs2WorkerSeed,
  searchCs2Path,
  type Cs2SearchGraph,
  type Cs2SearchQuery,
  type Cs2SearchResult,
  type Cs2SearchStep,
  type Cs2SearchTarget,
} from "./cs2-path-search";
import {
  deriveCs2ConnectionRules,
  type Cs2RoadConnectionGeometry,
} from "./cs2-road-adapter";
import {
  cs2FlowOffset,
  cs2LaneFlowSample,
  cs2TrafficTimeFactors,
  cs2UpdateLaneFlow,
  type Cs2CostVector,
  type Cs2FlowBuckets,
} from "./cs2-routing";
import {
  Cs2VehicleRuntime,
  type CS2RuntimeDecision,
  type CS2RuntimeReadonlyVehicleView,
  type CS2RuntimeVehicleView,
} from "./cs2-vehicle-runtime";
import { TrafficLightController, type SignalMovement } from "./traffic-lights";
import type { Step, Vehicle } from "./simulation";

const f = Math.fround;
const LENGTH = 3.8;
const WIDTH = 1.65;
const FRONT = LENGTH / 2;
const FRAME = 1 / 60;
const objectGeometry = {
  min: { x: -WIDTH / 2, y: -0.7, z: -FRONT },
  max: { x: WIDTH / 2, y: 0.7, z: FRONT },
  size: { x: WIDTH, y: 1.4, z: LENGTH },
};
type Trip = {
  id: number;
  source: Port;
  sink: Port;
  lane?: number;
  startDistance?: number;
  initialSpeed: number;
  externalSpawn?: boolean;
  unspawned?: boolean;
  owner: Cs2PathOwner;
  born: number;
  seed: number;
  color: number;
  groups: Cs2NetworkPathGroup[];
  path: Cs2SearchStep[];
  ownerPath: CS2PersonalPathElement[];
  ownerState?: CS2PersonalCarState;
  groupIndex: number;
  car?: Vehicle;
  projection?: {
    groups: Cs2NetworkPathGroup[];
    route: Step[];
    groupSteps: number[];
    view?: CS2RuntimeReadonlyVehicleView;
  };
  request?: number;
  completed: boolean;
};
type Occupant = {
  id: number;
  lane: string;
  t: number;
  s: number;
  speed: number;
  view: CS2RuntimeReadonlyVehicleView;
};
type Geometry = {
  connection: Connection;
  points: readonly [V, V, V, V];
  length: number;
  junction: string;
  from: string;
  to: string;
  turn: "left" | "right" | "straight";
  laneFlags: number;
};
type Boundary = {
  port: Port;
  credit: number;
  waiting: number;
  request?: number;
  ready?: Trip;
};
export type Cs2SimulationTrace = {
  frame: number;
  phase: "paths" | "spawn" | "navigation" | "ai" | "motion" | "flow";
  id?: number;
  lane?: string;
  value?: number;
};
export type Cs2TrafficSimulationOptions = {
  pathService?: Cs2PathService;
  deterministicSeed?: number;
  recordTrace?: boolean;
  /** Tests only: same source executor, result held until the next source frame. */
  synchronousPathsOnlyForTests?: boolean;
  /** Real world extension; default input contains only ordinary road lanes and boundary DummyTraffic. */
  personalCarWorld?: (
    world: CS2PersonalCarWorld,
    frame: number,
  ) => CS2PersonalCarWorld;
  personalCarCallbacks?: CS2PersonalCarCallbacks;
};

type OwnerComplete = Extract<CS2PersonalCarAdvance, { status: "complete" }>;
type OwnerPending = Extract<CS2PersonalCarAdvance, { status: "pending" }>;
export type Cs2OwnerCommand = {
  frame: number;
  owner: number;
  command: CS2PersonalCarCommand;
};

const speedOf = (view: CS2RuntimeReadonlyVehicleView) =>
  Math.hypot(
    view.state.velocity.x,
    view.state.velocity.y,
    view.state.velocity.z,
  );
const portKey = (port: Port) => `${port.road}:${port.end}`;
/** VehicleUtils.CheckUnspawned(CarCurrentLane), invoked by owner AI after navigation. */
export function cs2TrafficUnspawnedState(flags: number, previous: boolean) {
  if (
    flags &
    (CS2_NAV_TARGET_FLAGS.Connection | CS2_NAV_TARGET_FLAGS.ResetSpeed)
  )
    return true;
  if (
    !(
      flags &
      (CS2_NAV_TARGET_FLAGS.TransformTarget | CS2_NAV_TARGET_FLAGS.ParkingSpace)
    ) &&
    previous
  )
    return false;
  return previous;
}
const unitXZ = (from: V, to: V) => {
  const x = to.x - from.x,
    z = to.z - from.z,
    length = Math.hypot(x, z);
  return length > 1e-8 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
};
const headingPose = (state: Pick<CS2MotionState, "rotation">) => {
  const { x, y, z, w } = state.rotation;
  const dx = 2 * (x * z + w * y),
    dy = 2 * (y * z - w * x),
    dz = 1 - 2 * (x * x + y * y);
  return {
    heading: Math.atan2(dz, dx),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
};

/** Fixed 60Hz groups; all actual movement is the validated source vector runtime. */
export class Cs2TrafficSimulation {
  running = false;
  speed = 1;
  vehicles: Vehicle[] = [];
  completed = 0;
  failed = 0;
  generated = 0;
  unreachable = 0;
  totalTime = 0;
  elapsed = 0;
  navigationLimits = 0;
  readonly completedByExit = new Map<string, number>();
  readonly trafficLights = new TrafficLightController();
  junctions: Junction[] = [];
  readonly trace: Cs2SimulationTrace[] = [];
  statistics = {
    safetyStops: 0,
    junctionEntries: 0,
    simultaneousJunctions: 0,
    reroutes: 0,
    discretionaryChanges: 0,
    mandatoryChanges: 0,
  };
  network?: Cs2CompiledNetwork;
  runtime?: Cs2VehicleRuntime;
  private project?: Project;
  private graph?: Cs2SearchGraph;
  private revision = 0;
  private generation = 0;
  private sourceFrame = 0;
  private accumulator = 0;
  private nextId = 0;
  private requestId = 0;
  private enteredCount = 0;
  private random: SourceRandom32;
  private navigationRandom: SourceRandom32;
  private ownerBatchSeed = 0;
  private pathService?: Cs2PathService;
  private paths = new Map<number, Promise<unknown>>();
  private readyPaths: {
    frame: number;
    trip?: Trip;
    result: Cs2SearchResult;
    probe?: string;
  }[] = [];
  private knownRoutes = new Set<string>();
  private roads = new Map<string, Road>();
  private arcs = new Map<string, ReturnType<typeof arcTable>>();
  private trims = new Map<string, { start: number; end: number }>();
  private geometry = new Map<string, Geometry>();
  private trips = new Map<number, Trip>();
  private boundaries: Boundary[] = [];
  private flowBuckets = new Map<string, Cs2FlowBuckets>();
  private flowNext = new Map<string, [number, number]>();
  readonly flowOffsets = new Map<string, number>();
  private roadGroups = new Map<string, number>();
  private laneOverlaps = new Map<string, CS2ProducedLaneOverlap[]>();
  private reservations = new Map<string, CS2LaneReservation>();
  private reservationGroups = new Map<string, number>();
  private reservationRequests: {
    lane: string;
    offset: number;
    priority: number;
  }[] = [];
  private navigationActionsFrame = -1;
  private earlyLanePlans = new Map<
    number,
    { groups: Trip["groups"]; index: number; plan: EarlyLanePlan | null }
  >();
  private reservedNavigation = new Map<
    number,
    { current: CS2NavigationCurrentState; nextLanes: CS2NavigationQueuedLane[] }
  >();
  private personalWorld?: CS2PersonalCarWorld;
  private ownerCommandBuffer: Cs2OwnerCommand[] = [];
  private ownerCompletions = new Map<number, OwnerComplete>();
  private ownerDependencies = new Map<number, OwnerPending>();
  private ownerWorldCommands: Cs2OwnerCommand[] = [];
  /** Structural state played back at the original end-frame barrier. */
  readonly ownerComponents = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();
  readonly parkedOwners = new Map<number, CS2PersonalCarState>();
  readonly ownerCommandTrace: Cs2OwnerCommand[] = [];
  private requestSpace = new Map<number, string>();
  private speedWorld: CS2LaneSpeedWorld = {
    lanes: new Map(),
    objects: new Map(),
  };
  private selectionWorld?: CS2LaneSelectWorld;
  private reservationWorld?: CS2ReservationWorld;
  private laneObjects = new Map<string, CS2LaneSpeedLaneObject[]>();
  private searchTree = new Map<string, CS2LaneCacheBounds>();
  private blockedLanes = new Map<number, CS2BlockedLane[]>();
  private laneCaches = new Map<number, CS2CurrentLaneCache>();
  private cacheCommands: CS2LaneCacheCommand[] = [];
  private cacheWorld: CS2LaneCacheWorld = {
    entities: new Set(),
    laneObjects: new Map(),
    searchTree: new Map(),
  };
  private blockers = new Map<number, Cs2PathBlocker>();
  private occupancy = new Map<string, Occupant[]>();
  private physical = new Map<number, Occupant>();
  private positionCache = new Map<
    number,
    { lane: string; position: V; t: number }
  >();
  private enteredMovements = new Map<number, string>();
  private curveTables = new Map<string, { t: number; s: number }[]>();
  private curviness = new Map<string, number>();
  private disposed = false;

  constructor(private readonly options: Cs2TrafficSimulationOptions = {}) {
    this.random = new SourceRandom32(options.deterministicSeed ?? 123456);
    this.navigationRandom = new SourceRandom32(
      deriveCs2WorkerSeed(options.deterministicSeed ?? 123456),
    );
    this.pathService =
      options.pathService ??
      (options.synchronousPathsOnlyForTests ? undefined : new Cs2PathService());
  }
  get frame() {
    return this.sourceFrame;
  }
  get queued() {
    return this.vehicles.filter((car) => car.speed < 1).length;
  }
  get waiting() {
    return this.boundaries.reduce(
      (sum, boundary) =>
        sum +
        (isSource(boundary.port) &&
        boundary.port.rate * this.trafficMultiplier > 0
          ? boundary.waiting
          : 0),
      0,
    );
  }
  get entered() {
    return this.enteredCount;
  }
  get average() {
    return this.completed ? this.totalTime / this.completed : 0;
  }
  get routeCount() {
    return this.knownRoutes.size;
  }
  get pendingPathCount() {
    return this.paths.size;
  }
  /** Missing native queries retain their exact suspended transaction and pause this host. */
  get pendingOwnerQueries(): ReadonlyMap<number, OwnerPending> {
    return this.ownerDependencies;
  }
  /** Unimplemented world consumers receive the full source command, with no fake success. */
  drainOwnerWorldCommands() {
    const commands = this.ownerWorldCommands;
    this.ownerWorldCommands = [];
    return commands;
  }
  get unspawnedIds() {
    return new Set(
      [...this.trips.values()]
        .filter((trip) => trip.unspawned)
        .map((trip) => trip.id),
    );
  }
  get trafficMultiplier() {
    return this.project?.trafficMultiplier ?? 1;
  }
  private log(
    phase: Cs2SimulationTrace["phase"],
    id?: number,
    lane?: string,
    value?: number,
  ) {
    if (!this.options.recordTrace) return;
    this.trace.push({
      frame: this.sourceFrame,
      phase,
      ...(id === undefined ? {} : { id }),
      ...(lane ? { lane } : {}),
      ...(value === undefined ? {} : { value }),
    });
    if (this.trace.length > 20000) this.trace.splice(0, 1000);
  }
  configure(input: Project) {
    if (this.disposed) throw new Error("Source simulation is disposed");
    this.generation++;
    this.clear();
    const project = structuredClone(input);
    updateAutomaticTransitions(project);
    normalizePorts(project);
    this.project = project;
    this.roads = new Map(project.roads.map((road) => [road.id, road]));
    this.arcs = new Map(project.roads.map((road) => [road.id, arcTable(road)]));
    this.junctions = buildJunctions(project);
    const signalized = new Set(
      this.junctions
        .filter((junction) => !!signalForJunction(project.signals, junction))
        .map((junction) => junction.id),
    );
    this.trims = new Map(
      project.roads.map((road) => [
        road.id,
        {
          start:
            this.junctions
              .flatMap((j) =>
                j.arms.map((arm) => ({
                  ...arm,
                  trim:
                    arm.trim +
                    (signalized.has(j.id) ? signalStopOffset(arm) : 0),
                })),
              )
              .find((a) => a.road === road.id && a.end === 0)?.trim ?? 0,
          end:
            this.junctions
              .flatMap((j) =>
                j.arms.map((arm) => ({
                  ...arm,
                  trim:
                    arm.trim +
                    (signalized.has(j.id) ? signalStopOffset(arm) : 0),
                })),
              )
              .find((a) => a.road === road.id && a.end === 1)?.trim ?? 0,
        },
      ]),
    );
    const links = connections(project).filter(
      (connection) => connection.enabled,
    );
    this.buildGeometry(links);
    const sourceRules = deriveCs2ConnectionRules(
      [...this.geometry.values()].map((row): Cs2RoadConnectionGeometry => ({
        id: row.connection.id,
        junction: row.junction,
        fromKey: row.from,
        toKey: row.to,
        source: this.roads.get(row.connection.from.road)!,
        target: this.roads.get(row.connection.to.road)!,
        from: row.points[0],
        c1: row.points[1],
        c2: row.points[2],
        to: row.points[3],
      })),
      signalized,
    );
    const geometry = new Map<string, Cs2NetworkConnectionGeometry>();
    const signals: SignalMovement[] = [];
    for (const row of this.geometry.values()) {
      const rule = sourceRules.get(row.connection.id);
      row.laneFlags = rule?.flags ?? 0;
      // Signal permissions use RoadLab's visible map directions. Original lane
      // flags retain their source coordinate convention and driving behavior.
      row.turn = turnOf(
        { ...unitXZ(row.points[0], row.points[1]), y: 0 },
        { ...unitXZ(row.points[2], row.points[3]), y: 0 },
      );
      geometry.set(row.connection.id, {
        points: row.points,
        length: row.length,
        laneFlags: row.laneFlags,
        junction: row.junction,
      });
      const road = this.roads.get(row.connection.from.road)!;
      signals.push({
        id: row.connection.id,
        junction: row.junction,
        road: road.id,
        end: laneDirection(road, row.connection.from.lane) === 1 ? 1 : 0,
        turn: row.turn,
        sourceStraight: rule ? !rule.turn.isTurn : row.turn === "straight",
        startDirection: unitXZ(row.points[0], row.points[1]),
        endDirection: unitXZ(row.points[3], row.points[2]),
      });
    }
    this.network = compileCs2Network({
      project,
      connections: links,
      revision: ++this.revision,
      roadTrims: this.trims,
      connectionGeometry: geometry,
    });
    this.graph = this.network.graph;
    this.runtime = new Cs2VehicleRuntime(this.network.curves, {
      afterNavigation: (vehicle, context) =>
        this.afterNavigation(vehicle, context.navigationSnapshot),
    });
    for (const lane of this.network.lanes.values()) {
      if (lane.role !== "master") this.laneObjects.set(lane.id, []);
      const table = [{ t: 0, s: 0 }];
      let previous = lane.curve.points[0],
        length = 0;
      for (let i = 1; i <= 64; i++) {
        const point = bezier(...lane.curve.points, i / 64);
        length += dist(previous, point);
        table.push({ t: i / 64, s: length });
        previous = point;
      }
      this.curveTables.set(lane.id, table);
      this.curviness.set(
        lane.id,
        cs2CurveCurviness(
          lane.curve.points,
          lane.curve.length,
          lane.curve.width,
        ),
      );
      if (lane.kind === "connection" && lane.role !== "master") {
        this.reservations.set(lane.id, {
          next: { offset: 0, priority: 0 },
          previous: { offset: 0, priority: 0 },
          blocker: null,
        });
        let hash = 0;
        for (const char of lane.id)
          hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
        this.reservationGroups.set(lane.id, hash & 15);
      }
    }
    project.roads.forEach((road, index) =>
      this.roadGroups.set(road.id, index & 15),
    );
    this.trafficLights.configure(this.junctions, project.signals, signals);
    this.prepareSpeedWorld();
    const overlapWorld = cs2CreateLaneOverlapWorld(this.network, {
        carFlags: (lane) => this.speedWorld.lanes.get(lane.id)!.carLane.flags,
      }),
      overlaps = cs2UpdateLaneOverlaps(overlapWorld, { updateAll: true }),
      finalized = cs2FinalizeNodeLaneOverlaps(overlapWorld, overlaps);
    this.laneOverlaps = overlaps.overlaps;
    // LaneDataSystem uses the minimum node crossing count for a master lane.
    this.graph = {
      ...this.graph,
      edges: this.graph.edges.map((edge) => {
        const lane = this.network!.lanes.get(edge.owner)!,
          group = this.network!.groups.get(lane.group)!,
          count = Math.min(
            ...group.members.map(
              (id) => finalized.laneCrossCounts.get(id) ?? 0,
            ),
          ),
          specification = cs2NetworkPathSpecification(
            lane.curve,
            lane.maxSpeed,
            {
              laneFlags: lane.laneFlags,
              laneCrossCount: count,
            },
          );
        return {
          ...edge,
          specification: { ...edge.specification, costs: specification.costs },
        };
      }),
    };
    this.network.graph = this.graph;
    this.pathService?.configure(this.graph);
    this.boundaries = project.ports
      .filter(isSource)
      .map((port) => ({ port, credit: 0, waiting: 0 }));
    for (const source of project.ports.filter(isSource))
      for (const sink of project.ports.filter(isSink)) {
        if (portKey(source) === portKey(sink)) continue;
        this.requestPath(
          this.query(source, sink),
          undefined,
          `${portKey(source)}>${portKey(sink)}`,
        );
      }
  }
  private clear() {
    for (const request of this.paths.keys()) this.pathService?.cancel(request);
    this.paths.clear();
    this.readyPaths = [];
    this.knownRoutes.clear();
    this.trips.clear();
    this.earlyLanePlans.clear();
    this.boundaries = [];
    this.runtime = undefined;
    this.network = undefined;
    this.graph = undefined;
    this.geometry.clear();
    this.curveTables.clear();
    this.curviness.clear();
    this.occupancy.clear();
    this.physical.clear();
    this.positionCache.clear();
    this.enteredMovements.clear();
    this.blockers.clear();
    this.reservations.clear();
    this.reservationGroups.clear();
    this.reservationRequests = [];
    this.requestSpace.clear();
    this.speedWorld = { lanes: new Map(), objects: new Map() };
    this.laneObjects.clear();
    this.searchTree.clear();
    this.blockedLanes.clear();
    this.laneCaches.clear();
    this.cacheCommands = [];
    this.navigationActionsFrame = -1;
    this.reservedNavigation.clear();
    this.personalWorld = undefined;
    this.ownerCommandBuffer = [];
    this.ownerCompletions.clear();
    this.ownerDependencies.clear();
    this.ownerWorldCommands = [];
    this.ownerComponents.clear();
    this.parkedOwners.clear();
    this.ownerCommandTrace.length = 0;
    this.cacheWorld = {
      entities: new Set(),
      laneObjects: this.laneObjects,
      searchTree: this.searchTree,
    };
    this.flowBuckets.clear();
    this.flowNext.clear();
    this.flowOffsets.clear();
    this.roadGroups.clear();
    this.vehicles = [];
    this.completed = 0;
    this.failed = 0;
    this.generated = 0;
    this.unreachable = 0;
    this.totalTime = 0;
    this.elapsed = 0;
    this.enteredCount = 0;
    this.navigationLimits = 0;
    this.selectionWorld = undefined;
    this.completedByExit.clear();
    this.trafficLights.clear();
    this.laneOverlaps.clear();
    this.trace.length = 0;
    this.sourceFrame = 0;
    this.accumulator = 0;
    this.nextId = 0;
    this.random = new SourceRandom32(this.options.deterministicSeed ?? 123456);
    this.navigationRandom = new SourceRandom32(
      deriveCs2WorkerSeed(this.options.deterministicSeed ?? 123456),
    );
    this.statistics = {
      safetyStops: 0,
      junctionEntries: 0,
      simultaneousJunctions: 0,
      reroutes: 0,
      discretionaryChanges: 0,
      mandatoryChanges: 0,
    };
  }
  reset() {
    if (this.project) this.configure(this.project);
    else this.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.generation++;
    this.clear();
    this.pathService?.dispose();
    this.disposed = true;
  }
  setTrafficMultiplier(multiplier: number) {
    if (this.project && Number.isFinite(multiplier))
      this.project.trafficMultiplier = clamp(multiplier, 0, 4);
  }
  setPortRate(road: string, end: Port["end"], rate: number) {
    if (!Number.isFinite(rate)) return;
    for (const port of this.project?.ports ?? [])
      if (port.road === road && port.end === end) port.rate = Math.max(0, rate);
    for (const boundary of this.boundaries)
      if (boundary.port.road === road && boundary.port.end === end)
        boundary.port.rate = Math.max(0, rate);
  }
  /** Live boundary controls are independent of immutable road/Worker topology. */
  syncDemand(ports: readonly Port[], multiplier: number) {
    if (!this.project) return;
    this.setTrafficMultiplier(multiplier);
    const active = new Map(ports.map((port) => [portKey(port), port]));
    for (const boundary of this.boundaries) {
      const port = active.get(portKey(boundary.port));
      if (port)
        Object.assign(boundary.port, port, { rate: Math.max(0, port.rate) });
      else {
        boundary.port.rate = 0;
        boundary.port.type = "sink";
      }
    }
    for (const port of ports.filter(isSource))
      if (
        !this.boundaries.some(
          (boundary) => portKey(boundary.port) === portKey(port),
        )
      )
        this.boundaries.push({ port: { ...port }, credit: 0, waiting: 0 });
    this.project.ports = ports.map((port) => ({ ...port }));
  }
  private endpoint(road: Road, direction: 1 | -1, exit: boolean) {
    const total = this.arcs.get(road.id)!.at(-1)!.s,
      trim = this.trims.get(road.id)!;
    return exit
      ? total - (direction === 1 ? trim.end : trim.start)
      : direction === 1
        ? trim.start
        : trim.end;
  }
  private targets(
    port: Port,
    source: boolean,
    lane?: number,
    startDistance?: number,
  ): Cs2SearchTarget[] {
    const road = this.roads.get(port.road);
    if (!road || !this.network) return [];
    const direction: 1 | -1 = (
      source ? port.end === "start" : port.end === "end"
    )
      ? 1
      : -1;
    const values = Array.from({ length: laneCount(road) }, (_, i) => i).filter(
      (index) =>
        laneDirection(road, index) === direction &&
        (lane === undefined || lane === index),
    );
    const targets = values.flatMap((index) =>
      this.network!.targetsForRoad(
        road.id,
        startDistance ?? this.endpoint(road, direction, !source),
        index,
      ),
    );
    return [
      ...new Map(
        targets.map((target) => [`${target.edge}:${target.delta}`, target]),
      ).values(),
    ];
  }
  private query(
    source: Port,
    sink: Port,
    lane?: number,
    startDistance?: number,
  ): Cs2SearchQuery {
    return {
      requestId: ++this.requestId,
      revision: this.graph!.revision,
      start: this.targets(source, true, lane, startDistance),
      end: this.targets(sink, false),
      parameters: {
        ...cs2PersonalCarFallbackParameters(CS2_BASE_CAR.maxSpeed),
        methods: 8194,
      },
      seed: this.random.nextUInt(),
      actionIndex: 0,
    };
  }
  private queryForTrip(trip: Trip, current?: CS2LaneCacheCurrent) {
    const query = this.query(
        trip.source,
        trip.sink,
        trip.lane,
        trip.startDistance,
      ),
      view = this.runtime?.readVehicle(trip.id),
      location = current ?? view?.current,
      lane = location?.laneId && this.network?.lanes.get(location.laneId);
    if (view && lane) {
      const group = this.network!.groups.get(lane.group)!;
      query.start = [
        {
          edge: group.edge,
          delta: location!.curvePosition.x,
          target: lane.id,
        },
      ];
      query.parameters.maxSpeed = [view.car.maxSpeed, view.car.maxSpeed];
    }
    return query;
  }
  private requestPath(
    query: Cs2SearchQuery,
    trip?: Trip,
    probe?: string,
    ownerPrepared = false,
  ) {
    const generation = this.generation;
    const consume = (result: Cs2SearchResult) => {
      if (generation === this.generation && !this.disposed) {
        if (probe) {
          if (result.status === "found") this.knownRoutes.add(probe);
          else if (result.status !== "stale" && result.status !== "cancelled")
            this.unreachable++;
        } else
          this.readyPaths.push({ frame: this.sourceFrame + 1, trip, result });
      }
      return result;
    };
    if (trip) {
      trip.request = query.requestId;
      if (!ownerPrepared) prepareCs2PersonalCarPathRequest(trip.owner, 0);
    }
    if (this.options.synchronousPathsOnlyForTests) {
      consume(searchCs2Path(this.graph!, query));
      return Promise.resolve();
    }
    const pending = this.pathService!.submit(query)
      .then(consume)
      .finally(() => this.paths.delete(query.requestId));
    this.paths.set(query.requestId, pending);
    return pending;
  }
  async waitForPaths() {
    while (this.paths.size) await Promise.all([...this.paths.values()]);
  }
  /** Explicit RoadLab Step-save/test adapter; normal demand always uses global source search. */
  adoptVehicles(vehicles: readonly Vehicle[]) {
    if (!this.runtime || !this.network)
      throw new Error("Configure the source network before adopting vehicles");
    for (const vehicle of this.runtime.readVehicles())
      this.runtime.removeVehicle(vehicle.id);
    for (const buffer of this.laneObjects.values()) buffer.length = 0;
    this.searchTree.clear();
    this.blockedLanes.clear();
    this.laneCaches.clear();
    this.cacheCommands = [];
    this.navigationActionsFrame = -1;
    this.reservedNavigation.clear();
    this.ownerCommandBuffer = [];
    this.ownerCompletions.clear();
    this.ownerDependencies.clear();
    this.ownerWorldCommands = [];
    this.ownerComponents.clear();
    this.parkedOwners.clear();
    this.trips.clear();
    this.earlyLanePlans.clear();
    this.positionCache.clear();
    this.blockers.clear();
    for (const car of vehicles) {
      if (!car.route.length) continue;
      const path: Cs2SearchStep[] = [];
      for (let i = 0; i < car.route.length; i++) {
        const step = car.route[i],
          ids =
            this.network.roadLaneIds.get(
              cs2RoadLaneKey(step.road, step.inLane),
            ) ?? [];
        for (const id of ids) {
          const lane = this.network.lanes.get(id)!,
            group = this.network.groups.get(lane.group)!,
            edge = this.network.graph.edges[group.edge];
          path.push({ edge: edge.id, owner: edge.owner, delta: [0, 1] });
        }
        const next = car.route[i + 1];
        if (next) {
          const connection = [...this.geometry.values()].find(
            (row) =>
              row.connection.from.road === step.road &&
              row.connection.from.lane === step.outLane &&
              row.connection.to.road === next.road &&
              row.connection.to.lane === next.inLane,
          );
          const laneId =
              connection &&
              this.network.connectionLaneIds.get(connection.connection.id),
            lane = laneId && this.network.lanes.get(laneId);
          if (!lane)
            throw new Error(
              `Cannot adopt disconnected route ${step.road} → ${next.road}`,
            );
          const group = this.network.groups.get(lane.group)!,
            edge = this.network.graph.edges[group.edge];
          path.push({ edge: edge.id, owner: edge.owner, delta: [0, 1] });
        }
      }
      const step = car.route[car.step],
        location =
          step &&
          this.network.locateRoadLane(
            step.road,
            Math.round(car.laneChange?.from ?? car.lane),
            car.s,
          ),
        connectionId =
          car.connector?.id &&
          this.network.connectionLaneIds.get(car.connector.id),
        laneId = connectionId || location?.laneId;
      if (!laneId)
        throw new Error(
          `Vehicle ${car.id} is outside the physical source lane network`,
        );
      const lane = this.network.lanes.get(laneId)!,
        t = connectionId ? car.connector!.progress : location!.curveT,
        groups = this.network.groupsForPath(path),
        groupIndex = groups.findIndex((group) => group.group === lane.group),
        first = car.route[0],
        last = car.route.at(-1)!,
        seed = car.id >>> 0,
        trip: Trip = {
          id: car.id,
          source: {
            road: first.road,
            end: first.direction === 1 ? "start" : "end",
            type: "source",
            rate: 0,
          },
          sink: {
            road: last.road,
            end: last.direction === 1 ? "end" : "start",
            type: "sink",
            rate: 0,
          },
          initialSpeed: car.speed,
          owner: car.sourcePath ?? {
            flags: 0,
            elementIndex: Math.max(0, groupIndex),
          },
          born: this.sourceFrame - Math.round(car.age * 60),
          seed,
          color: car.color,
          unspawned: !!(car as Vehicle & { sourceUnspawned?: boolean })
            .sourceUnspawned,
          groups,
          path,
          ownerPath: this.ownerPathFromSearch(path),
          groupIndex: Math.max(0, groupIndex),
          car,
          completed: false,
        };
      this.trips.set(car.id, trip);
      this.nextId = Math.max(this.nextId, car.id);
      const position = cs2NavigationCurvePosition(lane.curve, t),
        a = cs2NavigationCurvePosition(lane.curve, Math.max(0, t - 0.001)),
        b = cs2NavigationCurvePosition(lane.curve, Math.min(1, t + 0.001)),
        forward = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
        length = Math.hypot(forward.x, forward.y, forward.z) || 1,
        state: CS2MotionState = {
          position,
          velocity: mul(forward, car.speed / length),
          rotation: cs2LookRotationSafe(forward, { x: 0, y: 1, z: 0 }),
        },
        current: CS2NavigationCurrentState = {
          laneId,
          curvePosition: { x: t, y: t, z: 1 },
          changeProgress: 0,
          lanePosition: 0,
          duration: 0,
          distance: 0,
          flags: 4 | (groupIndex === groups.length - 1 ? 1 : 0),
        };
      this.runtime.addVehicle({
        id: car.id,
        seed,
        car: car.cs2Car ?? CS2_BASE_CAR,
        geometry: {
          width: WIDTH,
          frontExtent: FRONT,
          pivotOffset: -LENGTH * 0.2,
        },
        state,
        navigation: { targetPosition: { ...position }, maxSpeed: car.speed },
        current,
        nextLanes: this.queuedLanes(trip, laneId),
        frameInitialization: "loaded",
        initializationFrame: this.sourceFrame,
      });
      cs2AddLaneObject(this.laneObjects.get(laneId)!, String(car.id), [
        current.curvePosition.x,
        current.curvePosition.y,
      ]);
    }
    this.snapshot();
    this.vehicles = [...vehicles];
    for (const trip of this.trips.values())
      this.projectVehicle(trip, this.runtime.readVehicle(trip.id)!);
  }
  async spawnTrip(
    source: Port,
    sink: Port,
    options: {
      lane?: number;
      initialSpeed?: number;
      startDistance?: number;
    } = {},
  ): Promise<number | null> {
    if (!this.network || !this.graph || this.disposed) return null;
    const id = ++this.nextId,
      seed = this.random.nextUInt(),
      trip: Trip = {
        id,
        source: { ...source },
        sink: { ...sink },
        lane: options.lane,
        startDistance: options.startDistance,
        initialSpeed: options.initialSpeed ?? 0,
        owner: { flags: Cs2PathFlags.Obsolete, elementIndex: 0 },
        born: this.sourceFrame,
        seed,
        color: seed % 5,
        groups: [],
        path: [],
        ownerPath: [],
        groupIndex: 0,
        completed: false,
      };
    this.trips.set(id, trip);
    await this.requestPath(
      this.query(source, sink, options.lane, options.startDistance),
      trip,
    );
    return this.trips.has(id) ? id : null;
  }
  /** Debug/render projection only. The canonical owner buffer retains non-road elements and flags. */
  private searchPathFromOwner(path: readonly CS2PersonalPathElement[]) {
    return path.flatMap((element): Cs2SearchStep[] => {
      const lane = element.target && this.network!.lanes.get(element.target),
        group = lane && this.network!.groups.get(lane.group);
      if (!group || element.target === null) return [];
      return [
        { edge: group.edge, owner: element.target, delta: [...element.delta] },
      ];
    });
  }
  /** PathfindJobs.CreatePath: Secondary comes from EdgeFlags and the first element is PathStart. */
  private ownerPathFromSearch(
    path: readonly Cs2SearchStep[],
  ): CS2PersonalPathElement[] {
    return path.map((step, index) => ({
      target: step.owner,
      delta: [...step.delta],
      flags:
        (index === 0 ? 2 : 0) |
        (this.graph!.edges[step.edge].specification.flags & 256 ? 1 : 0),
    }));
  }
  private applyPaths() {
    const remaining: typeof this.readyPaths = [];
    for (const row of this.readyPaths) {
      if (row.frame > this.sourceFrame) {
        remaining.push(row);
        continue;
      }
      this.log("paths", row.trip?.id);
      if (row.probe) {
        if (row.result.status === "found") this.knownRoutes.add(row.probe);
        else if (
          row.result.status !== "stale" &&
          row.result.status !== "cancelled"
        )
          this.unreachable++;
        continue;
      }
      const trip = row.trip;
      if (
        !trip ||
        !this.trips.has(trip.id) ||
        trip.request !== row.result.requestId
      )
        continue;
      trip.request = undefined;
      if (row.result.status === "stale" || row.result.status === "cancelled") {
        trip.owner.flags =
          (trip.owner.flags & ~Cs2PathFlags.Pending) | Cs2PathFlags.Obsolete;
        continue;
      }
      trip.ownerPath = applyCs2PathResult(
        trip.owner,
        trip.ownerPath,
        row.result.status === "found"
          ? this.ownerPathFromSearch(row.result.steps)
          : [],
      ).path;
      trip.path = this.searchPathFromOwner(trip.ownerPath);
      if (trip.ownerState) {
        trip.ownerState.path = structuredClone(trip.ownerPath);
        trip.ownerState.pathOwner = { ...trip.owner };
      }
      if (cs2PathfindFailed(trip.owner.flags)) {
        if (!trip.car) this.fail(trip);
        continue;
      }
      trip.groups = this.network!.groupsForPath(trip.path);
      trip.groupIndex = 0;
      // PersonalCarAI owns ResetUpdatedPath/ResetPath after the navigation job.
      this.knownRoutes.add(`${portKey(trip.source)}>${portKey(trip.sink)}`);
      if (trip.car) this.statistics.reroutes++;
    }
    this.readyPaths = remaining;
  }
  private buildGeometry(links: readonly Connection[]) {
    // The renderer has no native node entity. All connections sharing a logical
    // road endpoint must nevertheless have one owner, including parallel lanes.
    const parents = new Map<string, string>();
    const find = (id: string): string => {
      const p = parents.get(id);
      if (p === undefined) {
        parents.set(id, id);
        return id;
      }
      if (p === id) return id;
      const root = find(p);
      parents.set(id, root);
      return root;
    };
    const unite = (a: string, b: string) => {
      parents.set(find(b), find(a));
    };
    const endpointKey = (road: string, end: number) =>
      JSON.stringify([road, end]);
    for (const junction of this.junctions) {
      const keys = junction.arms.map((a) => endpointKey(a.road, a.end));
      for (const key of keys.slice(1)) unite(keys[0], key);
    }
    for (const link of links) {
      const source = this.roads.get(link.from.road)!,
        target = this.roads.get(link.to.road)!;
      unite(
        endpointKey(
          source.id,
          laneDirection(source, link.from.lane) === 1 ? 1 : 0,
        ),
        endpointKey(
          target.id,
          laneDirection(target, link.to.lane) === 1 ? 0 : 1,
        ),
      );
    }
    const owners = new Map<string, string>();
    for (const junction of this.junctions)
      for (const arm of junction.arms)
        owners.set(find(endpointKey(arm.road, arm.end)), junction.id);
    for (const key of [...parents.keys()].sort()) {
      const root = find(key);
      if (!owners.has(root)) owners.set(root, `endpoint:${key}`);
    }
    for (const connection of links) {
      const road = this.roads.get(connection.from.road),
        next = this.roads.get(connection.to.road);
      if (!road || !next) continue;
      const direction = laneDirection(road, connection.from.lane),
        nextDirection = laneDirection(next, connection.to.lane),
        ft = arcParameter(
          this.arcs.get(road.id)!,
          direction === 1
            ? this.endpoint(road, direction, true)
            : this.arcs.get(road.id)!.at(-1)!.s -
                this.endpoint(road, direction, true),
        ),
        nt = arcParameter(
          this.arcs.get(next.id)!,
          nextDirection === 1
            ? this.endpoint(next, nextDirection, false)
            : this.arcs.get(next.id)!.at(-1)!.s -
                this.endpoint(next, nextDirection, false),
        ),
        from = lanePoint(road, connection.from.lane, ft),
        to = lanePoint(next, connection.to.lane, nt),
        span = dist(from, to) * 0.45,
        points: readonly [V, V, V, V] = [
          from,
          add(from, mul(tangent(road, ft), span * direction)),
          add(to, mul(tangent(next, nt), -span * nextDirection)),
          to,
        ];
      let previous = from,
        length = 0;
      for (let i = 1; i <= 64; i++) {
        const p = bezier(...points, i / 64);
        length += dist(previous, p);
        previous = p;
      }
      const junction = owners.get(
        find(endpointKey(road.id, direction === 1 ? 1 : 0)),
      )!;
      this.geometry.set(connection.id, {
        connection,
        points,
        length,
        junction,
        from: `${road.id}:${connection.from.lane}`,
        to: `${next.id}:${connection.to.lane}`,
        turn: "straight",
        laneFlags: 0,
      });
    }
  }
  private curveS(id: string, t: number) {
    const table = this.curveTables.get(id)!;
    const u = clamp(t, 0, 1) * 64,
      index = Math.min(63, Math.floor(u));
    return table[index].s + (table[index + 1].s - table[index].s) * (u - index);
  }
  private nearest(lane: Cs2NetworkLane, position: V) {
    return cs2SelectCurveDistanceSquared(lane.curve, position).t;
  }
  private physicalS(lane: Cs2NetworkLane, t: number, position: V) {
    const a = lane.curve.points[0],
      b = lane.curve.points[1],
      c = lane.curve.points[2],
      d = lane.curve.points[3];
    if (t < 0.001) {
      const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
        n = Math.hypot(v.x, v.y, v.z) || 1,
        projected =
          ((position.x - a.x) * v.x +
            (position.y - a.y) * v.y +
            (position.z - a.z) * v.z) /
          n;
      if (projected < 0) return projected;
    }
    if (t > 0.999) {
      const v = { x: d.x - c.x, y: d.y - c.y, z: d.z - c.z },
        n = Math.hypot(v.x, v.y, v.z) || 1,
        projected =
          ((position.x - d.x) * v.x +
            (position.y - d.y) * v.y +
            (position.z - d.z) * v.z) /
          n;
      if (projected > 0) return lane.curve.length + projected;
    }
    return this.curveS(lane.id, t);
  }
  private snapshot() {
    this.occupancy.clear();
    this.physical.clear();
    for (const view of this.runtime!.readVehicles()) {
      const id = Number(view.id),
        lane = this.network!.lanes.get(view.current.laneId!);
      if (!lane) continue;
      const cache = this.positionCache.get(id),
        position = view.state.position;
      const t =
        cache &&
        cache.lane === lane.id &&
        cache.position.x === position.x &&
        cache.position.y === position.y &&
        cache.position.z === position.z
          ? cache.t
          : this.nearest(lane, position);
      this.positionCache.set(id, {
        lane: lane.id,
        position: { ...position },
        t,
      });
      const row: Occupant = {
        id,
        lane: lane.id,
        t,
        s: this.physicalS(lane, t, position),
        speed: speedOf(view),
        view,
      };
      this.physical.set(id, row);
      if (
        lane.kind === "connection" &&
        row.s >= 0 &&
        row.s <= lane.curve.length &&
        this.enteredMovements.get(id) !== lane.id
      ) {
        this.enteredMovements.set(id, lane.id);
        this.statistics.junctionEntries++;
      }
      for (const laneId of new Set(
        [lane.id, view.current.changeLaneId].filter((v): v is string => !!v),
      )) {
        const list = this.occupancy.get(laneId) ?? [];
        list.push(
          laneId === lane.id
            ? row
            : { ...row, lane: laneId, s: this.curveS(laneId, t) },
        );
        this.occupancy.set(laneId, list);
      }
    }
    for (const rows of this.occupancy.values())
      rows.sort((a, b) => a.s - b.s || a.id - b.id);
    this.statistics.simultaneousJunctions = Math.max(
      this.statistics.simultaneousJunctions,
      [...this.physical.values()].filter((row) => {
        const lane = this.network!.lanes.get(row.lane)!;
        return (
          lane.kind === "connection" && row.s >= 0 && row.s <= lane.curve.length
        );
      }).length,
    );
  }
  private syncGroup(trip: Trip, laneId: string) {
    const group = this.network!.lanes.get(laneId)?.group;
    if (trip.groups[trip.groupIndex]?.group !== group) {
      const index = trip.groups.findIndex(
        (row, index) => index >= trip.groupIndex && row.group === group,
      );
      if (index >= 0) trip.groupIndex = index;
    }
  }
  private nominate(
    group: Cs2NetworkPathGroup,
    current?: CS2NavigationCurrentState,
  ) {
    const master = this.network!.groups.get(group.group)!.master;
    const result = cs2ResolveLaneSelectionMaster({
      world: this.selectionWorld!,
      lane: {
        laneId: master,
        start: group.interval[0],
        end: group.interval[1],
        flags: this.navigationLaneFlags(group.laneIds[0]),
      },
      randomState: this.navigationRandom.state,
      fixedStartCurrent:
        current &&
        current.flags & 0x100 &&
        !(current.flags & CS2_NAV_TARGET_FLAGS.Connection)
          ? current
          : undefined,
    });
    this.navigationRandom.state = result.randomState;
    return result.lane;
  }
  private queuedLanes(
    trip: Trip,
    _laneId: string,
    _currentChange?: string | null,
  ): CS2NavigationQueuedLane[] {
    return trip.groups
      .slice(trip.groupIndex + 1, trip.groupIndex + 13)
      .map((group, i) => {
        const nominee = this.nominate(group);
        return {
          ...nominee,
          flags: nominee.flags | this.nominateTerminalFlags(trip, i + 1, group),
        };
      });
  }
  /** FillNavigationPaths ordinary CarLane metadata, source lines 900–938. */
  private navigationLaneFlags(laneId: string) {
    const net =
      this.speedWorld.lanes.get(laneId)?.carLane.flags ??
      this.network!.lanes.get(laneId)!.laneFlags;
    let flags = 4;
    if (!(net & NET.forward)) {
      const left = !!(
          net &
          (NET.uTurnLeft | NET.turnLeft | NET.gentleTurnLeft)
        ),
        right = !!(
          net &
          (NET.uTurnRight | NET.turnRight | NET.gentleTurnRight)
        );
      if (left && !right) flags |= CS2_NAV_TARGET_FLAGS.TurnLeft;
      if (right && !left) flags |= CS2_NAV_TARGET_FLAGS.TurnRight;
    }
    if ((net & (NET.approach | NET.roundabout)) === NET.roundabout)
      flags |= 0x8000000;
    if (net & NET.twoway) flags |= CS2_NAV_TARGET_FLAGS.CanReverse;
    // RoadLab has no Owner that is itself a Curve; ordinary node unsafe U-turns
    // are the supported source RequestSpace branch for this world.
    if (net & NET.unsafe && net & (NET.uTurnLeft | NET.uTurnRight))
      flags |= CS2_NAV_TARGET_FLAGS.RequestSpace;
    return flags;
  }
  private nominateTerminalFlags(
    trip: Trip,
    offset: number,
    group: Cs2NetworkPathGroup,
  ) {
    const standalone =
      this.network!.groups.get(group.group)!.members.length === 1;
    return (
      (standalone ? 0x100 : 0) |
      (trip.groupIndex + offset === trip.groups.length - 1 ? 1 : 0)
    );
  }
  /** A fitted RoadLab lane may contain several cubics. Their artificial joins
   * are one continuous physical lane, rather than a new lane choice at a node.
   * Project only disconnected same-road entries with source FixedStart logic;
   * the ordinary source DP may still change lanes after entering the piece. */
  private constrainArtificialSeams(
    current: CS2NavigationCurrentState,
    queue: CS2NavigationQueuedLane[],
  ) {
    let previous = this.network!.lanes.get(
      current.changeLaneId ?? current.laneId!,
    );
    return queue.map((requested) => {
      const next = this.network!.lanes.get(requested.laneId)!;
      let result = requested;
      if (
        previous?.kind === "road" &&
        next.kind === "road" &&
        previous.road === next.road &&
        previous.direction === next.direction &&
        Math.abs(previous.roadInterval![1] - next.roadInterval![0]) < 1e-7
      ) {
        const successors = this.network!.successors.get(previous.id) ?? [],
          group = this.network!.groups.get(next.group)!;
        if (
          !successors.includes(next.id) &&
          group.members.some((id) => successors.includes(id))
        ) {
          const resolved = cs2ResolveLaneSelectionMaster({
            world: this.selectionWorld!,
            lane: { ...requested, laneId: group.master },
            randomState: this.navigationRandom.state,
            fixedStartCurrent: {
              ...current,
              laneId: previous.id,
              changeLaneId: null,
              curvePosition: { x: 1, y: 1, z: 1 },
              flags:
                (current.flags | 0x100) & ~CS2_NAV_TARGET_FLAGS.TransformTarget,
            },
          });
          this.navigationRandom.state = resolved.randomState;
          result = resolved.lane;
          if (!successors.includes(result.laneId))
            throw new Error(
              `Fitted road seam has no continuous fixed-start selection: ${previous.id} -> ${result.laneId}`,
            );
        }
      }
      previous = this.network!.lanes.get(result.laneId);
      return result;
    });
  }
  private createVehicle(trip: Trip) {
    if (!trip.groups.length || !this.runtime || !this.network) return false;
    const group = trip.groups[0],
      preferred = trip.lane;
    const lanes = group.laneIds.filter(
      (id) =>
        preferred === undefined ||
        this.network!.lanes.get(id)?.lane === preferred,
    );
    // Source GetRandomLane's reservoir sample, with explicit boundary seed.
    const random = new SourceRandom32(deriveCs2WorkerSeed(trip.seed));
    let selected = 0;
    for (let i = 0; i < lanes.length; i++)
      if (
        Math.floor((((random.nextUInt() + 1) >>> 0) * (i + 1)) / 4294967296) ===
        0
      )
        selected = i;
    if (selected) [lanes[0], lanes[selected]] = [lanes[selected], lanes[0]];
    for (const laneId of lanes) {
      const lane = this.network.lanes.get(laneId)!,
        t = group.interval[0],
        s = this.curveS(laneId, t),
        rows = this.occupancy.get(laneId) ?? [];
      if (rows.some((row) => Math.abs(row.s - s) < LENGTH + 1)) continue;
      const position = cs2NavigationCurvePosition(lane.curve, t),
        nextPosition = cs2NavigationCurvePosition(
          lane.curve,
          Math.min(1, t + 0.001),
        ),
        forward = {
          x: nextPosition.x - position.x,
          y: nextPosition.y - position.y,
          z: nextPosition.z - position.z,
        },
        length = Math.hypot(forward.x, forward.y, forward.z) || 1,
        initialSpeed = Math.min(trip.initialSpeed, lane.maxSpeed),
        state: CS2MotionState = {
          position,
          velocity: mul(forward, initialSpeed / length),
          rotation: cs2LookRotationSafe(forward, { x: 0, y: 1, z: 0 }),
        },
        current: CS2NavigationCurrentState = {
          laneId,
          curvePosition: { x: t, y: t, z: group.interval[1] },
          changeProgress: 0,
          lanePosition: 0,
          flags:
            4 |
            (trip.externalSpawn ? CS2_NAV_TARGET_FLAGS.ResetSpeed : 0) |
            (trip.groups.length === 1 ? 1 : 0),
          duration: 0,
          distance: 0,
        };
      this.runtime.addVehicle({
        id: trip.id,
        seed: trip.seed,
        car: CS2_BASE_CAR,
        geometry: {
          width: WIDTH,
          frontExtent: FRONT,
          pivotOffset: -LENGTH * 0.2,
        },
        state,
        navigation: {
          targetPosition: { ...position },
          maxSpeed: initialSpeed,
          targetRotation: { x: 0, y: 0, z: 0, w: 0 },
        },
        current,
        nextLanes: this.queuedLanes(trip, laneId),
      });
      cs2AddLaneObject(this.laneObjects.get(laneId)!, String(trip.id), [
        current.curvePosition.x,
        current.curvePosition.y,
      ]);
      // Boundary-created entities begin in the source's Unspawned lifecycle;
      // subsequent transitions occur only in their scheduled owner-AI phase.
      trip.unspawned ??= !!trip.externalSpawn;
      trip.born = this.sourceFrame;
      trip.car ??= {
        id: trip.id,
        route: [],
        step: 0,
        s: 0,
        lane: lane.lane ?? 0,
        speed: initialSpeed,
        age: 0,
        color: trip.color,
        position: { ...position },
        heading: 0,
        pitch: 0,
      };
      this.enteredCount++;
      this.log("spawn", trip.id, laneId);
      this.snapshot();
      return true;
    }
    return false;
  }
  private demand() {
    for (const boundary of this.boundaries) {
      const rate = Math.max(0, boundary.port.rate * this.trafficMultiplier);
      if (!isSource(boundary.port) || rate === 0) continue;
      boundary.credit += rate / 3600;
      const count = Math.floor(boundary.credit + 1e-9);
      boundary.credit -= count;
      boundary.waiting += count;
      this.generated += count;
      if (!boundary.waiting || boundary.request || boundary.ready) continue;
      const exits = this.project!.ports.filter(isSink).filter(
        (sink) => portKey(sink) !== portKey(boundary.port),
      );
      if (!exits.length) continue;
      const sink = exits[this.random.nextUInt() % exits.length],
        id = ++this.nextId,
        seed = this.random.nextUInt(),
        trip: Trip = {
          id,
          source: boundary.port,
          sink,
          initialSpeed: 0,
          externalSpawn: true,
          owner: { flags: Cs2PathFlags.Obsolete, elementIndex: 0 },
          born: this.sourceFrame,
          seed,
          color: seed % 5,
          groups: [],
          path: [],
          ownerPath: [],
          groupIndex: 0,
          completed: false,
        };
      boundary.request = id;
      this.trips.set(id, trip);
      void this.requestPath(this.query(boundary.port, sink), trip).then(() => {
        if (boundary.request === id) {
          boundary.ready = trip;
          boundary.request = undefined;
        }
      });
      // The test scheduler must not depend on Promise microtasks inside a tight frame loop.
      if (this.options.synchronousPathsOnlyForTests) {
        boundary.ready = trip;
        boundary.request = undefined;
      }
    }
  }
  private admit() {
    for (const boundary of this.boundaries) {
      if (
        !isSource(boundary.port) ||
        boundary.port.rate * this.trafficMultiplier <= 0
      )
        continue;
      const trip = boundary.ready;
      if (!trip) continue;
      if (!this.trips.has(trip.id)) {
        boundary.ready = undefined;
        boundary.waiting = Math.max(0, boundary.waiting - 1);
        continue;
      }
      if (trip.groups.length && !trip.car && this.createVehicle(trip)) {
        boundary.waiting--;
        boundary.ready = undefined;
      }
    }
    for (const trip of this.trips.values()) {
      if (
        trip.car ||
        this.boundaries.some(
          (boundary) => boundary.request === trip.id || boundary.ready === trip,
        ) ||
        !trip.groups.length
      )
        continue;
      this.createVehicle(trip);
    }
  }
  private fail(trip: Trip) {
    if (trip.completed) return;
    trip.completed = true;
    this.failed++;
    this.removeLaneMembership(trip.id);
    this.trips.delete(trip.id);
    this.earlyLanePlans.delete(trip.id);
    this.positionCache.delete(trip.id);
    this.blockers.delete(trip.id);
    this.requestSpace.delete(trip.id);
    this.enteredMovements.delete(trip.id);
  }
  private removeLaneMembership(id: number) {
    for (const [lane, buffer] of this.laneObjects)
      if (buffer.some((entry) => entry.object === String(id)))
        this.cacheCommands.push({
          kind: "lane-remove",
          lane,
          object: String(id),
        });
    this.cacheCommands.push({ kind: "tree-remove", object: String(id) });
    this.blockedLanes.delete(id);
    this.laneCaches.delete(id);
  }
  private outsideTarget(trip: Trip) {
    return `outside:${trip.sink.road}:${trip.sink.end}`;
  }
  private prepareNavigationActions(
    snapshot: ReadonlyMap<number | string, CS2RuntimeVehicleView>,
  ) {
    if (this.navigationActionsFrame === this.sourceFrame) return;
    this.navigationActionsFrame = this.sourceFrame;
    this.reservedNavigation.clear();
    // CarNavigation.Actions runs after the complete navigation batch and before
    // PersonalCarAI. Owner queries must not see the pre-navigation lane cache.
    for (const vehicle of snapshot.values()) {
      const id = Number(vehicle.id),
        trip = this.trips.get(id);
      if (!trip) continue;
      const reserved = cs2ReserveNavigationLanes(this.reservationWorld!, {
        entity: String(id),
        priority: 100,
        car: vehicle.car,
        carFlags: vehicle.carFlags ?? 0,
        frontExtent: FRONT,
        maxSpeed: vehicle.navigation.maxSpeed,
        current: vehicle.current,
        nextLanes: vehicle.nextLanes,
        randomState: this.navigationRandom.state,
      });
      this.navigationRandom.state = reserved.randomState;
      this.reservedNavigation.set(id, reserved);
      this.reservationRequests.push(...reserved.reservations);
      for (const signal of reserved.signals) {
        const connection = this.network!.lanes.get(signal.lane)?.connection;
        if (connection) this.trafficLights.petition(connection, id);
      }
      const cache = this.laneCaches.get(id);
      if (cache)
        this.cacheCommands.push(
          ...cache.checkChanges(String(id), reserved.current, {
            ...vehicle.state,
            targetPosition: vehicle.navigation.targetPosition,
            maxSpeed: vehicle.navigation.maxSpeed,
            geometry: objectGeometry,
          }),
        );
      if (
        reserved.current.flags & CS2_NAV_TARGET_FLAGS.ResetSpeed &&
        reserved.current.duration > 60
      )
        this.blockers.set(id, {
          blocker: id,
          type: Cs2BlockerType.Spawn,
          maxSpeed: this.blockers.get(id)?.maxSpeed ?? 255,
        });
    }
    this.flushLaneActions();
    const trips = [...this.trips.values()],
      world = createCS2PersonalCarWorld({
        entities: new Set([
          ...this.network!.lanes.keys(),
          ...trips.map((trip) => String(trip.id)),
          ...trips.map((trip) => this.outsideTarget(trip)),
        ]),
        // Every network lane currently represents CarLane, including node CarLane;
        // it is not the source's special ConnectionLane or a parking/spawn lane.
        lanes: new Map(
          [...this.network!.lanes.keys()].map((id) => [id, { car: true }]),
        ),
        passengers: new Map(trips.map((trip) => [String(trip.id), []])),
        paths: new Map(trips.map((trip) => [String(trip.id), trip.ownerPath])),
        pathOwners: new Map(
          trips.map((trip) => [String(trip.id), { ...trip.owner }]),
        ),
        targets: new Map(
          trips.map((trip) => [
            String(trip.id),
            trip.ownerState ? trip.ownerState.target : this.outsideTarget(trip),
          ]),
        ),
        city: null,
        timeOfDay: (this.sourceFrame % 262144) / 262144,
      });
    this.personalWorld =
      this.options.personalCarWorld?.(world, this.sourceFrame) ?? world;
  }
  private flushLaneActions() {
    applyCS2LaneCacheCommands(
      this.cacheCommands,
      this.laneObjects,
      this.searchTree,
    );
    this.cacheCommands = [];
    for (const request of this.reservationRequests) {
      const reservation = this.reservations.get(request.lane);
      if (reservation)
        this.reservations.set(
          request.lane,
          cs2ApplyReservation(reservation, {
            offset: request.offset,
            priority: request.priority,
          }),
        );
    }
    this.reservationRequests = [];
  }
  private queueOwnerCommand(trip: Trip, command: CS2PersonalCarCommand) {
    const entry = { frame: this.sourceFrame, owner: trip.id, command };
    if (this.options.recordTrace) {
      this.ownerCommandTrace.push(entry);
      if (this.ownerCommandTrace.length > 20000)
        this.ownerCommandTrace.splice(0, 1000);
    }
    if (command.kind === "pathfind") {
      if (
        command.destination.entity !== this.outsideTarget(trip) ||
        !(command.parameters.methods & 8194) ||
        command.parameters.methods & ~8194 ||
        command.parameters.authorization1 !== null ||
        command.parameters.authorization2 !== null
      ) {
        // The road-only setup adapter cannot resolve residents, multimodal or
        // authorized city targets. Preserve the actual request for that host.
        this.ownerWorldCommands.push(entry);
        this.running = false;
        return;
      }
      const query = this.queryForTrip(trip, trip.ownerState!.current);
      query.parameters = {
        ...query.parameters,
        ...command.parameters,
      };
      void this.requestPath(query, trip, undefined, true);
    } else if (
      command.kind === "money-transfer" ||
      command.kind === "fee-event"
    ) {
      // These are original action/service queues, not structural ECB commands.
      this.ownerWorldCommands.push(entry);
    } else this.ownerCommandBuffer.push(entry);
  }
  private commitOwner(trip: Trip, result: OwnerComplete) {
    const state = result.state;
    Object.assign(trip.owner, state.pathOwner);
    const samePath =
      state.path.length === trip.ownerPath.length &&
      state.path.every((element, index) => {
        const old = trip.ownerPath[index];
        return (
          element.target === old.target &&
          element.flags === old.flags &&
          element.delta[0] === old.delta[0] &&
          element.delta[1] === old.delta[1]
        );
      });
    if (!samePath) {
      trip.ownerPath = state.path;
      trip.path = this.searchPathFromOwner(trip.ownerPath);
      trip.groups = this.network!.groupsForPath(trip.path);
      trip.groupIndex = Math.max(
        0,
        trip.groups.findIndex((group) =>
          group.laneIds.includes(state.current.laneId ?? ""),
        ),
      );
    }
    state.path = trip.ownerPath;
    trip.ownerState = state;
    for (const command of result.commands)
      this.queueOwnerCommand(trip, command);
    if (result.outcome.kind === "deleted" || result.outcome.kind === "parked")
      this.ownerCompletions.set(trip.id, result);
  }
  private afterNavigation(
    vehicle: CS2RuntimeVehicleView,
    snapshot: ReadonlyMap<number | string, CS2RuntimeVehicleView>,
  ) {
    this.prepareNavigationActions(snapshot);
    const trip = this.trips.get(Number(vehicle.id));
    if (!trip) return { remove: true };
    const reserved = this.reservedNavigation.get(trip.id)!;
    const state: CS2PersonalCarState = {
      ...(trip.ownerState ?? {
        personalCar: {
          keeper: null,
          flags: CS2_PERSONAL_CAR_FLAGS.dummyTraffic,
        },
        target: this.outsideTarget(trip),
      }),
      carFlags: vehicle.carFlags ?? 0,
      current: reserved.current,
      pathOwner: { ...trip.owner },
      path: trip.ownerPath,
      navigationLanes: reserved.nextLanes,
      unspawned: !!trip.unspawned,
    };
    const result = runCS2PersonalCarAI(
      this.personalWorld!,
      {
        entity: String(trip.id),
        entityIndex: trip.id,
        batchSeed: this.ownerBatchSeed,
        // CarBasePrefab's actual field defaults: Small=0, Fuel=1. Asset overrides
        // must be provided with the real prefab when that world is introduced.
        prefabCar: { ...vehicle.car, sizeClass: 0, energyType: 1 },
        geometry: objectGeometry,
        state,
      },
      this.options.personalCarCallbacks,
    );
    this.log(
      "ai",
      trip.id,
      reserved.current.laneId ?? undefined,
      trip.unspawned ? 1 : 0,
    );
    if (result.status === "pending") {
      this.ownerDependencies.set(trip.id, result);
      this.running = false;
      // No partial owner state or commands are committed while native world
      // input is missing. This experimental host pauses at the frame boundary.
      return { ...reserved, skipMotion: true };
    }
    this.commitOwner(trip, result);
    return {
      current: { ...reserved.current, ...result.state.current },
      nextLanes: result.state.navigationLanes,
      carFlags: result.state.carFlags,
    };
  }
  private playbackOwnerCommands() {
    const deleted = new Set<number>(),
      parked = new Set<number>();
    for (const { command } of this.ownerCommandBuffer) {
      if (
        command.kind === "pathfind" ||
        command.kind === "money-transfer" ||
        command.kind === "fee-event"
      )
        throw new Error("Non-structural owner command reached EndFrameBarrier");
      let components = this.ownerComponents.get(command.entity);
      if (!components) {
        components = new Map();
        this.ownerComponents.set(command.entity, components);
      }
      const add = (component: string, value: Record<string, unknown> = {}) => {
        components!.set(component, structuredClone(value));
        if (component === "Deleted") deleted.add(Number(command.entity));
        if (component === "ParkedCar") parked.add(Number(command.entity));
        if (component === "Unspawned") {
          const trip = this.trips.get(Number(command.entity));
          if (trip) trip.unspawned = true;
        }
      };
      const remove = (component: string) => {
        components!.delete(component);
        const trip = this.trips.get(Number(command.entity));
        if (component === "Unspawned" && trip) trip.unspawned = false;
        if (component === "LayoutElement" && trip?.ownerState)
          delete trip.ownerState.layout;
      };
      if (command.kind === "add-components")
        command.components.forEach((component) => add(component));
      else if (command.kind === "remove-components")
        command.components.forEach(remove);
      else if (command.kind === "remove-component") remove(command.component);
      else if ("component" in command) add(command.component, command.value);
    }
    this.ownerCommandBuffer = [];
    for (const id of new Set([...deleted, ...parked])) {
      const trip = this.trips.get(id);
      if (!trip) continue;
      const result = this.ownerCompletions.get(id);
      if (deleted.has(id) && result?.outcome.reason === "path-end") {
        this.completed++;
        this.totalTime += (this.sourceFrame - trip.born) / 60;
        const key = portKey(trip.sink);
        this.completedByExit.set(key, (this.completedByExit.get(key) ?? 0) + 1);
      } else if (deleted.has(id) && result?.outcome.reason === "path-failure")
        this.failed++;
      if (!deleted.has(id) && parked.has(id) && trip.ownerState)
        this.parkedOwners.set(id, structuredClone(trip.ownerState));
      trip.completed = true;
      this.runtime!.removeVehicle(id);
      this.removeLaneMembership(id);
      this.trips.delete(id);
      this.earlyLanePlans.delete(id);
      this.positionCache.delete(id);
      this.blockers.delete(id);
      this.requestSpace.delete(id);
      this.enteredMovements.delete(id);
      if (deleted.has(id)) this.ownerComponents.delete(String(id));
    }
    this.ownerCompletions.clear();
    // Native ECS cleanup is projected to the host's end-frame membership removal.
    this.flushLaneActions();
  }
  private prepareSpeedWorld() {
    for (const [lane, group] of this.reservationGroups)
      if ((this.sourceFrame & 15) === group)
        this.reservations.set(
          lane,
          cs2AdvanceReservation(this.reservations.get(lane)!),
        );
    const lanes = new Map<string, CS2LaneSpeedLane>(),
      objects = new Map<string, CS2LaneSpeedObject>();
    const mask =
      NET.uTurnLeft |
      NET.turnLeft |
      NET.turnRight |
      NET.levelCrossing |
      NET.yield |
      NET.stop |
      NET.uTurnRight |
      NET.gentleTurnLeft |
      NET.gentleTurnRight |
      NET.forward |
      NET.forbidPassing |
      NET.rightOfWay |
      NET.trafficLights;
    for (const lane of this.network!.lanes.values()) {
      if (lane.role === "master") continue;
      let flags = lane.laneFlags;
      if (lane.kind === "road") {
        for (const id of this.network!.successors.get(lane.id) ?? []) {
          const next = this.network!.lanes.get(id)!;
          if (next.kind === "connection") {
            const propagated = next.laneFlags & mask;
            flags |= propagated;
            if (propagated & 0xfdffffff) flags |= NET.approach;
          }
        }
      }
      lanes.set(lane.id, {
        curve: lane.curve,
        carLane: {
          flags,
          speedLimit: lane.maxSpeed,
          curviness: this.curviness.get(lane.id) ?? 0,
        },
        reservation: this.reservations.get(lane.id),
        signal:
          lane.connection && this.trafficLights.has(lane.junction)
            ? {
                type: this.trafficLights.laneSignal(lane.connection),
                flags: 2,
                blocker: null,
              }
            : undefined,
        overlaps: this.laneOverlaps.get(lane.id) ?? [],
        objects: this.laneObjects.get(lane.id) ?? [],
      });
    }
    for (const row of this.physical.values()) {
      objects.set(String(row.id), {
        kind: "car",
        position: row.view.state.position,
        velocity: row.view.state.velocity,
        car: row.view.car,
        geometry: objectGeometry,
      });
    }
    this.speedWorld = { lanes, objects };
    this.cacheWorld = {
      entities: new Set([...this.network!.lanes.keys(), ...objects.keys()]),
      laneObjects: this.laneObjects,
      searchTree: this.searchTree,
    };
    this.selectionWorld = cs2CreateLaneSelectWorld(
      this.network!,
      this.speedWorld,
    );
    this.reservationWorld = {
      lanes: new Map(
        [...this.network!.lanes.values()].map((lane) => {
          const selection = this.selectionWorld!.lanes.get(lane.id)!;
          return [
            lane.id,
            {
              length: lane.curve.length,
              carLane: true,
              hasReservation: this.reservations.has(lane.id),
              signal: this.speedWorld.lanes.get(lane.id)?.signal,
              owner: selection.owner,
              slave: selection.slave,
            },
          ];
        }),
      ),
      owners: new Map(
        [...this.selectionWorld.owners].map(([id, lanes]) => [
          id,
          lanes.map((lane) => lane.laneId),
        ]),
      ),
    };
    if ((this.sourceFrame & 3) === 0)
      for (const row of this.physical.values()) {
        if (row.view.updateGroup !== ((this.sourceFrame >>> 2) & 15)) continue;
        const trip = this.trips.get(row.id),
          blocker = this.blockers.get(row.id);
        if (!trip || !blocker) continue;
        const decision = cs2StuckPathDecision({
          self: row.id,
          target: null,
          ownerFlags: trip.owner.flags,
          blocker,
          blockers: this.blockers,
        });
        trip.owner.flags = decision.flags;
        if (decision.requestSpaceFor !== null) {
          const targetLane = this.physical.get(decision.requestSpaceFor)?.view
            .current.laneId;
          if (targetLane)
            this.requestSpace.set(decision.requestSpaceFor, targetLane);
        }
      }
  }
  /** RoadLab route preparation policy; the recovered selection/motion helpers
   * remain unchanged. Physical changes stay adjacent and use real lane gaps. */
  private prepareEarlyLaneChange(
    trip: Trip,
    view: CS2RuntimeVehicleView,
    selected: CS2NavigationCurrentState,
  ) {
    const network = this.network!,
      lane = network.lanes.get(view.current.laneId!)!,
      group = network.groups.get(lane.group)!;
    if (
      lane.kind !== "road" ||
      !group.allowChange ||
      selected.laneId !== view.current.laneId ||
      selected.flags & 0x100
    )
      return selected;
    const cached = this.earlyLanePlans.get(trip.id);
    const plan =
      cached?.groups === trip.groups && cached.index === trip.groupIndex
        ? cached.plan
        : buildEarlyLanePlan(network, trip.groups, trip.groupIndex);
    if (
      !cached ||
      cached.groups !== trip.groups ||
      cached.index !== trip.groupIndex
    )
      this.earlyLanePlans.set(trip.id, {
        groups: trip.groups,
        index: trip.groupIndex,
        plan,
      });
    const row = this.physical.get(trip.id),
      speed = speedOf(view),
      remaining =
        this.curveS(lane.id, trip.groups[trip.groupIndex].interval[1]) -
        (row?.s ?? 0),
      planned = chooseEarlyLane(plan, group.members, lane.id, remaining, speed);
    let target = planned ?? selected.changeLaneId ?? null;
    if (view.current.changeLaneId && view.current.changeProgress > 0)
      target = view.current.changeLaneId;
    const origin = group.members.indexOf(lane.id),
      index = target ? group.members.indexOf(target) : origin;
    if (index < 0 || origin < 0) return selected;
    if (Math.abs(index - origin) > 1)
      target = group.members[origin + Math.sign(index - origin)];
    if (target === lane.id) target = null;
    if (
      target &&
      target !== view.current.changeLaneId &&
      !laneChangeGapClear(
        trip.id,
        this.curveS(target, selected.curvePosition.x),
        speed,
        this.occupancy.get(target) ?? [],
      )
    )
      target = null;
    if (
      target === (selected.changeLaneId ?? null) &&
      (!target ||
        target !== view.current.changeLaneId ||
        selected.changeProgress === view.current.changeProgress)
    )
      return selected;
    const current = {
      ...selected,
      changeLaneId: target,
      changeProgress:
        target && target === view.current.changeLaneId
          ? view.current.changeProgress
          : 0,
    };
    const turnMask =
      CS2_NAV_TARGET_FLAGS.TurnLeft | CS2_NAV_TARGET_FLAGS.TurnRight;
    current.flags &= ~turnMask;
    if (target) {
      const destination = group.members.indexOf(target),
        inverted = !!(
          (this.selectionWorld!.lanes.get(lane.id)?.carLane?.flags ?? 0) & 4
        );
      current.flags |=
        destination < origin !== inverted
          ? CS2_NAV_TARGET_FLAGS.TurnLeft
          : CS2_NAV_TARGET_FLAGS.TurnRight;
    }
    return current;
  }
  private decision(view: CS2RuntimeVehicleView): CS2RuntimeDecision {
    const id = Number(view.id),
      trip = this.trips.get(id)!,
      network = this.network!;
    let lane = network.lanes.get(view.current.laneId!)!;
    this.syncGroup(trip, lane.id);
    let current = {
      ...view.current,
      curvePosition: { ...view.current.curvePosition },
    };
    const blocked = this.blockedLanes.get(id) ?? [];
    this.blockedLanes.set(id, blocked);
    this.laneCaches.set(
      id,
      new CS2CurrentLaneCache(this.cacheWorld, current, blocked),
    );
    const pending = !!(
        trip.owner.flags &
        (Cs2PathFlags.Pending |
          Cs2PathFlags.Failed |
          Cs2PathFlags.Obsolete |
          Cs2PathFlags.Updated)
      ),
      car = pending ? { ...view.car, acceleration: 0 } : view.car,
      speed = speedOf(view),
      range =
        view.current.flags &
        (CS2_NAV_TARGET_FLAGS.Connection | CS2_NAV_TARGET_FLAGS.ResetSpeed)
          ? { min: 0, max: car.maxSpeed }
          : cs2SpeedRange(car, speed, CS2_NAVIGATION_TIMESTEP),
      safe = f(
        CS2_NAVIGATION_TIMESTEP + cs2SafetyTime(this.sourceFrame, trip.seed),
      ),
      offset = cs2LowSpeedDistanceOffset(speed);
    current.flags =
      (current.flags & ~1) |
      (trip.groupIndex === trip.groups.length - 1 ? 1 : 0);
    if (pending) current.flags = (current.flags & ~1) | 0x100;
    else current.flags &= ~0x100;
    // Retain selected physical lanes and their Reserved/Fixed flags from the
    // previous source buffer; append only missing global path groups.
    let queue: CS2NavigationQueuedLane[] = [];
    for (
      let i = 0;
      i < Math.min(12, trip.groups.length - trip.groupIndex - 1);
      i++
    ) {
      const group = trip.groups[trip.groupIndex + i + 1],
        old = view.nextLanes[i];
      if (old && network.lanes.get(old.laneId)?.group === group.group)
        queue.push({ ...old });
      else {
        const nominee = this.nominate(group, i === 0 ? current : undefined);
        nominee.flags |=
          trip.groupIndex + i + 1 === trip.groups.length - 1 ? 1 : 0;
        queue.push({ ...nominee });
        current.flags |= 4;
      }
    }
    if (this.requestSpace.get(id) === current.laneId)
      current.flags |= CS2_NAV_TARGET_FLAGS.RequestSpace;
    else this.requestSpace.delete(id);
    const selected = cs2SelectOptimalLanes({
      world: this.selectionWorld!,
      current,
      nextLanes: queue,
      entity: String(id),
      blocker:
        this.blockers.get(id)?.blocker === null ||
        this.blockers.get(id)?.blocker === undefined
          ? null
          : String(this.blockers.get(id)!.blocker),
      priority: 100,
      pathMethods: 2,
    });
    current = this.prepareEarlyLaneChange(trip, view, selected.current);
    queue = this.constrainArtificialSeams(current, selected.nextLanes);
    trip.owner.elementIndex = Math.min(
      trip.path.length,
      trip.groupIndex + queue.length + 1,
    );
    lane = network.lanes.get(current.laneId!)!;
    if (selected.invalidPath !== null)
      trip.owner.flags |= Cs2PathFlags.Obsolete;
    if (
      current.changeLaneId &&
      current.changeLaneId !== view.current.changeLaneId
    ) {
      const nextGroup = trip.groups[trip.groupIndex + 1],
        needed =
          nextGroup &&
          !(network.successors.get(lane.id) ?? []).some((id) =>
            nextGroup.laneIds.includes(id),
          );
      if (needed) this.statistics.mandatoryChanges++;
      else this.statistics.discretionaryChanges++;
    }
    const oldBlocker = this.blockers.get(id),
      iterator = new CS2CarLaneSpeedIterator(this.speedWorld, {
        entity: String(id),
        ignore:
          current.flags & 0x2000 &&
          oldBlocker?.blocker !== null &&
          oldBlocker?.blocker !== undefined
            ? String(oldBlocker.blocker)
            : null,
        priority: 100,
        timeStep: CS2_NAVIGATION_TIMESTEP,
        safeTimeStep: safe,
        distanceOffset: offset,
        speedLimitFactor: 1,
        currentSpeed: speed,
        prefabCar: car,
        prefabGeometry: objectGeometry,
        speedRange: range,
        maxSpeed: range.max,
        canChangeLane: 1,
        currentPosition: view.state.position,
        pushBlockers: !!(current.flags & CS2_NAV_TARGET_FLAGS.PushBlockers),
      });
    const laneOffset = cs2LaneOffset(
        lane.curve,
        current.curvePosition.x,
        WIDTH,
        current.lanePosition,
      ),
      next = queue[0],
      nextOffset: readonly [number, number] = next
        ? [next.start, next.end]
        : [0, 0],
      requestSpace = !!(current.flags & CS2_NAV_TARGET_FLAGS.RequestSpace);
    let changedOffset = laneOffset;
    const first = current.changeLaneId
      ? (() => {
          const destination = network.lanes.get(current.changeLaneId!)!,
            turn =
              current.flags &
              (CS2_NAV_TARGET_FLAGS.TurnLeft | CS2_NAV_TARGET_FLAGS.TurnRight),
            targetPosition = -clamp(
              current.lanePosition,
              turn === CS2_NAV_TARGET_FLAGS.TurnRight ? 0 : -0.5,
              turn === CS2_NAV_TARGET_FLAGS.TurnLeft ? 0 : 0.5,
            );
          changedOffset = cs2LaneOffset(
            destination.curve,
            current.curvePosition.x,
            WIDTH,
            targetPosition,
          );
          return iterator.iterateChangingLane({
            lane1: lane.id,
            lane2: destination.id,
            curveOffset: current.curvePosition,
            nextLane: next?.laneId,
            nextOffset,
            laneDelta: current.changeProgress,
            laneOffset1: laneOffset,
            laneOffset2: changedOffset,
            requestSpace,
          });
        })()
      : iterator.iterateFirstLane({
          lane: lane.id,
          curveOffset: current.curvePosition,
          nextLane: next?.laneId,
          nextOffset,
          laneOffset,
          requestSpace,
        });
    let stop = first.stop,
      laneFlags = first.laneFlags;
    if (!stop)
      for (let i = 0; i < queue.length; i++) {
        const row = queue[i],
          same =
            row.laneId === current.laneId ||
            row.laneId === current.changeLaneId,
          result = iterator.iterateNextLane({
            lane: row.laneId,
            curveOffset: [row.start, row.end],
            laneOffset: changedOffset,
            minOffset: same
              ? current.curvePosition.y
              : row.end < row.start
                ? 2
                : -1,
            nextLanes: queue.slice(i + 1).map((next) => ({
              lane: next.laneId,
              curvePosition: [next.start, next.end],
            })),
            requestSpace: !!(row.flags & CS2_NAV_TARGET_FLAGS.RequestSpace),
            laneFlags,
          });
        laneFlags = result.laneFlags;
        if (result.needSignal) {
          const connection = network.lanes.get(row.laneId)?.connection;
          if (connection) this.trafficLights.petition(connection, id);
        }
        if (result.stop) {
          stop = true;
          break;
        }
      }
    if (!stop) iterator.iterateTarget(iterator.state.currentPosition);
    const maxSpeed = iterator.state.maxSpeed;
    const checked = cs2CheckLaneSelectionBlocker({
      world: this.selectionWorld!,
      current,
      previousBlocker:
        oldBlocker?.blocker === undefined || oldBlocker.blocker === null
          ? null
          : String(oldBlocker.blocker),
      blocker: iterator.state.blocker,
      blockerType: iterator.state.blockerType,
      maxSpeed,
    });
    current = checked.current;
    this.blockers.set(id, {
      blocker:
        checked.blocker.entity === null ? null : Number(checked.blocker.entity),
      type: iterator.state.blockerType,
      maxSpeed: checked.blocker.maxSpeed,
    });
    if (maxSpeed < range.max - 0.01) this.navigationLimits++;
    this.log("navigation", id, lane.id, maxSpeed);
    const upcoming = queue
        .map((row) => network.lanes.get(row.laneId))
        .find((lane) => lane?.kind === "connection"),
      turn =
        upcoming?.connection && this.geometry.get(upcoming.connection)?.turn;
    return {
      current,
      nextLanes: queue,
      maxSpeed,
      random01: speed > 0.01 ? this.navigationRandom.nextFloat() : 0.5,
      canChangeLane: iterator.state.canChangeLane,
      oncoming: iterator.state.oncoming,
      temporaryBlocker: iterator.state.blockerType === Cs2BlockerType.Temporary,
      upcomingTurnFlags:
        turn === "left"
          ? CS2_NAV_TARGET_FLAGS.TurnLeft
          : turn === "right"
            ? CS2_NAV_TARGET_FLAGS.TurnRight
            : 0,
      selectNextLane: (previous, requested) =>
        cs2GetNextSelectLane(this.selectionWorld!, previous, requested) ??
        undefined,
    };
  }
  private projectVehicle(trip: Trip, view: CS2RuntimeReadonlyVehicleView) {
    const lane = this.network!.lanes.get(view.current.laneId!)!;
    this.syncGroup(trip, lane.id);
    if (trip.projection?.groups !== trip.groups) {
      const route: Step[] = [],
        groupSteps: number[] = [];
      for (const group of trip.groups) {
        const member = this.network!.lanes.get(group.laneIds[0])!;
        if (member.kind === "road") {
          if (
            route.at(-1)?.road !== member.road ||
            route.at(-1)?.direction !== member.direction
          )
            route.push({
              road: member.road!,
              direction: member.direction!,
              inLane: member.lane!,
              outLane: member.lane!,
            });
          groupSteps.push(route.length - 1);
        } else groupSteps.push(route.length);
      }
      trip.projection = { groups: trip.groups, route, groupSteps };
    }
    const { route, groupSteps } = trip.projection;
    if (trip.projection.view === view) {
      trip.car!.age = (this.sourceFrame - trip.born) / 60;
      trip.car!.yieldingFor = this.blockers.get(trip.id)?.blocker ?? undefined;
      return trip.car!;
    }
    trip.projection.view = view;
    const row = this.physical.get(trip.id),
      t = row?.t ?? this.nearest(lane, view.state.position),
      car = trip.car!;
    let step = Math.min(route.length - 1, groupSteps[trip.groupIndex]),
      s = 0;
    car.connector = undefined;
    car.laneChange = undefined;
    if (lane.kind === "road") {
      const roadT =
          lane.roadInterval![0] +
          (lane.roadInterval![1] - lane.roadInterval![0]) * t,
        table = this.arcs.get(lane.road!)!,
        total = table.at(-1)!.s;
      let i = table.findIndex((row) => row.t >= roadT);
      i = Math.max(1, i < 0 ? table.length - 1 : i);
      const a = table[i - 1],
        b = table[i],
        distance =
          a.s + ((b.s - a.s) * (roadT - a.t)) / Math.max(1e-9, b.t - a.t);
      s = lane.direction === 1 ? distance : total - distance;
      car.lane = lane.lane!;
      if (view.current.changeLaneId) {
        const target = this.network!.lanes.get(view.current.changeLaneId);
        car.laneChange = {
          from: lane.lane!,
          to: target?.lane ?? lane.lane!,
          start: s,
          length: 0,
        };
        car.lane =
          lane.lane! +
          ((target?.lane ?? lane.lane!) - lane.lane!) *
            Math.min(1, view.current.changeProgress);
      }
    } else {
      const geometry = this.geometry.get(lane.connection!)!;
      step = Math.max(0, step);
      car.lane = lane.to!.lane;
      s = this.endpoint(
        this.roads.get(lane.to!.road)!,
        laneDirection(this.roads.get(lane.to!.road)!, lane.to!.lane),
        false,
      );
      car.connector = {
        id: lane.connection,
        from: geometry.points[0],
        c1: geometry.points[1],
        c2: geometry.points[2],
        to: geometry.points[3],
        progress: t,
        length: lane.curve.length,
        arc: this.curveTables.get(lane.id)!,
        junction: lane.junction,
      };
    }
    if (route[step]) {
      route[step].inLane = lane.kind === "road" ? lane.lane! : lane.to!.lane;
      route[step].outLane = route[step].inLane;
    }
    Object.assign(car, {
      route,
      step,
      s,
      speed: speedOf(view),
      position: { ...view.state.position },
      ...headingPose(view.state),
      age: (this.sourceFrame - trip.born) / 60,
      sourcePath: trip.owner,
      sourceLaneFlags: view.current.flags,
      sourceUnspawned: !!trip.unspawned,
      cs2Car: view.car,
      yieldingFor: this.blockers.get(trip.id)?.blocker ?? undefined,
    });
    return car;
  }
  renderVehicles(frameFraction = this.accumulator * 60) {
    if (!this.runtime) return [];
    return this.vehicles
      .filter((vehicle) => !this.trips.get(vehicle.id)?.unspawned)
      .map((vehicle) => {
        const pose = this.runtime!.displayPose(vehicle.id, frameFraction);
        return pose
          ? { ...vehicle, position: { ...pose.position }, ...headingPose(pose) }
          : vehicle;
      });
  }
  private updateFlow() {
    if (
      this.sourceFrame === 0 ||
      this.sourceFrame % 512 ||
      !this.network ||
      !this.graph
    )
      return;
    const factors = cs2TrafficTimeFactors((this.sourceFrame % 262144) / 262144),
      active = (this.sourceFrame >>> 9) & 15;
    for (const lane of this.network.lanes.values()) {
      if (
        lane.kind !== "road" ||
        lane.role === "master" ||
        this.roadGroups.get(lane.road!) !== active
      )
        continue;
      const previous = this.flowBuckets.get(lane.id) ?? {
          duration: [0, 0, 0, 0],
          distance: [0, 0, 0, 0],
        },
        buckets = cs2UpdateLaneFlow(
          previous,
          this.flowNext.get(lane.id) ?? [0, 0],
          factors,
        );
      this.flowNext.delete(lane.id);
      this.flowBuckets.set(lane.id, buckets);
      this.flowOffsets.set(lane.id, cs2FlowOffset(buckets, factors));
    }
    const offsets = this.network.graph.edges.map((edge) => {
      const lane = this.network!.lanes.get(edge.owner)!,
        group = this.network!.groups.get(lane.group)!;
      if (lane.kind !== "road") return 0;
      const duration = [0, 0, 0, 0],
        distance = [0, 0, 0, 0];
      for (const id of group.members) {
        const buckets = this.flowBuckets.get(id);
        if (buckets)
          for (let i = 0; i < 4; i++) {
            duration[i] = f(duration[i] + buckets.duration[i]);
            distance[i] = f(distance[i] + buckets.distance[i]);
          }
      }
      return cs2FlowOffset(
        {
          duration: duration as unknown as Cs2CostVector,
          distance: distance as unknown as Cs2CostVector,
        },
        factors,
      );
    });
    if (
      offsets.every(
        (offset, index) =>
          offset === this.graph!.edges[index].specification.flowOffset,
      )
    )
      return;
    this.graph = {
      ...this.network.graph,
      revision: ++this.revision,
      edges: this.network.graph.edges.map((edge) => {
        return {
          ...edge,
          specification: {
            ...edge.specification,
            flowOffset: offsets[edge.id],
          },
        };
      }),
    };
    this.pathService?.configure(this.graph);
    this.log("flow", undefined, undefined, this.graph.revision);
  }
  update(realDelta: number) {
    if (
      !this.running ||
      !this.runtime ||
      !this.network ||
      this.ownerDependencies.size > 0 ||
      this.disposed ||
      !Number.isFinite(realDelta) ||
      realDelta < 0
    )
      return;
    this.accumulator += realDelta * Math.max(0, this.speed);
    let frames = 0;
    while (this.accumulator + 1e-10 >= FRAME && frames++ < 240) {
      this.applyPaths();
      this.demand();
      this.admit();
      for (const trip of this.trips.values())
        if (!trip.car && !trip.request && cs2RequireNewPath(trip.owner.flags))
          void this.requestPath(this.queryForTrip(trip), trip);
      const occupied = new Set(
        [...this.physical.values()]
          .filter(
            (row) => this.network!.lanes.get(row.lane)?.kind === "connection",
          )
          .map((row) => this.network!.lanes.get(row.lane)?.junction)
          .filter((id): id is string => !!id),
      );
      this.trafficLights.update(FRAME, occupied);
      this.prepareSpeedWorld();
      this.navigationRandom = new SourceRandom32(
        deriveCs2WorkerSeed(this.random.nextUInt(), 0),
      );
      // PersonalCarAI.OnUpdate obtains its own RandomSeed.Next(), then mixes
      // each entity.Index inside Tick. It must not consume navigation's stream.
      this.ownerBatchSeed = this.random.nextUInt();
      const result = this.runtime.stepFrame(this.sourceFrame, (vehicle) =>
        this.decision(vehicle),
      );
      this.flushLaneActions();
      this.laneCaches.clear();
      for (const id of result.motionIds) this.log("motion", Number(id));
      for (const event of result.events) {
        if (event.type === "lane-flow") {
          const lane = this.network.lanes.get(event.laneId);
          if (lane?.kind === "road") {
            const sample = cs2LaneFlowSample({
                duration: event.duration,
                distance: event.distance,
                laneLength: lane.curve.length,
                maxDriveSpeed: cs2MaxDriveSpeed(
                  CS2_BASE_CAR,
                  lane.maxSpeed,
                  this.curviness.get(lane.id) ?? 0,
                ),
              }),
              previous = this.flowNext.get(lane.id) ?? [0, 0];
            this.flowNext.set(lane.id, [
              f(previous[0] + sample[0]),
              f(previous[1] + sample[1]),
            ]);
          }
        }
        if (event.type === "full-update-requested")
          this.runtime.applyFullUpdate(event.id);
      }
      // Original PersonalCarAI structural commands target EndFrameBarrier;
      // Deleted/Parked/Unspawned become structural only after this CarMove batch.
      this.playbackOwnerCommands();
      this.snapshot();
      this.vehicles = this.runtime.readVehicles().flatMap((vehicle) => {
        const trip = this.trips.get(Number(vehicle.id));
        return trip ? [this.projectVehicle(trip, vehicle)] : [];
      });
      this.updateFlow();
      this.sourceFrame++;
      this.elapsed = this.sourceFrame / 60;
      this.accumulator = Math.max(0, this.accumulator - FRAME);
      if (!this.running) break;
    }
  }
}
