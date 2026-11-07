/** PersonalCarAISystem owner lifecycle. Native parking queries are explicit resumable contracts. */
import type { CS2CarData } from "./cs2-driving";
import type { CS2LaneSpeedGeometry } from "./cs2-lane-speed";
import type { CS2NavigationQueuedLane } from "./cs2-navigation-target";
import type { CS2LaneCacheCurrent } from "./cs2-lane-cache";
import {
  Cs2PathFlags as P,
  cs2PathfindFailed,
  cs2RequireNewPath,
  cs2SetupCarPathfind,
  resetCs2UpdatedPath,
  type Cs2PathOwner,
} from "./cs2-path-policy";
import { cs2CitizenPathfindWeights, type Cs2CostVector } from "./cs2-routing";
import { SourceRandom32, deriveCs2WorkerSeed } from "./cs2-path-search";

export const CS2_PERSONAL_CAR_FLAGS = {
  transporting: 1,
  boarding: 2,
  disembarking: 4,
  dummyTraffic: 8,
  homeTarget: 16,
} as const;
export type CS2PersonalPathElement = {
  target: string | null;
  delta: readonly [number, number];
  flags: number;
};
export type CS2PersonalCarState = {
  personalCar: { keeper: string | null; flags: number };
  carFlags: number;
  current: CS2LaneCacheCurrent;
  pathOwner: Cs2PathOwner;
  target: string | null;
  path: CS2PersonalPathElement[];
  navigationLanes: CS2NavigationQueuedLane[];
  /** undefined and an empty created Layout buffer have different source semantics. */
  layout?: string[];
  unspawned: boolean;
};
export type CS2PersonalCarLane = {
  car?: boolean;
  pedestrianFlags?: number;
  pedestrianAccessRestriction?: string | null;
  connectionFlags?: number;
  parking?: { fee: number };
  garage?: { count: number; capacity: number; fee: number };
  spawnLocation?: boolean;
  spawn?: { connectionType: number; roadTypes: number; activityMask: number };
};
export type CS2PersonalCarWorld = {
  entities: ReadonlySet<string>;
  lanes: ReadonlyMap<string, CS2PersonalCarLane>;
  passengers: ReadonlyMap<string, readonly string[]>;
  currentVehicles: ReadonlyMap<string, { flags: number }>;
  paths: ReadonlyMap<string, readonly CS2PersonalPathElement[]>;
  pathOwners: ReadonlyMap<string, Cs2PathOwner>;
  targets: ReadonlyMap<string, string | null>;
  residents: ReadonlyMap<
    string,
    {
      citizen: string;
      flags: number;
      walkSpeed: number;
      supportedActivities: number;
    }
  >;
  householdMembers: ReadonlyMap<string, string>;
  propertyRenters: ReadonlyMap<string, string>;
  households: ReadonlyMap<string, { flags: number; consumptionPerDay: number }>;
  householdCitizens: ReadonlyMap<string, readonly string[]>;
  movingAway: ReadonlySet<string>;
  citizens: ReadonlyMap<
    string,
    { flags: number; pseudoRandom: number; leisureCounter: number }
  >;
  workers: ReadonlyMap<string, { workplace: string }>;
  travelPurposes: ReadonlyMap<string, { purpose: number }>;
  diverts: ReadonlyMap<string, { target: string | null; purpose: number }>;
  city: string | null;
  timeOfDay: number;
};
export type CS2PersonalCarInput = {
  entity: string;
  entityIndex: number;
  batchSeed: number;
  state: CS2PersonalCarState;
  prefabCar: CS2CarData & { sizeClass: number; energyType: number };
  geometry?: CS2LaneSpeedGeometry;
  isBicycle?: boolean;
  /** Original owner query excludes all of these, including TripSource. */
  excluded?: {
    deleted?: boolean;
    temp?: boolean;
    tripSource?: boolean;
    outOfControl?: boolean;
    destroyed?: boolean;
  };
};
export type CS2PersonalSetupTarget = {
  type: number;
  methods: number;
  entity: string | null;
  entity2: string | null;
  resource: number;
  activityMask: number;
  maintenanceType: number;
  flags: number;
  trackTypes: number;
  roadTypes: number;
  flyingTypes: number;
  value: number;
  value2: number;
  randomCost: number;
  value3: number;
};
export type CS2PersonalPathParameters = {
  parkingTarget: string | null;
  authorization1: string | null;
  authorization2: string | null;
  weights: Cs2CostVector;
  maxSpeed: readonly [number, number];
  walkSpeed: readonly [number, number];
  parkingSize: readonly [number, number];
  parkingDelta: number;
  maxCost: number;
  maxResultCount: number;
  methods: number;
  pathfindFlags: number;
  ignoredRules: number;
  taxiIgnoredRules: number;
};
export type CS2PersonalCarCommand =
  | {
      kind: "add-component" | "remove-component";
      entity: string;
      component: string;
      value?: Record<string, unknown>;
    }
  | {
      kind: "set-component";
      entity: string;
      component: string;
      value: Record<string, unknown>;
    }
  | {
      kind: "add-components" | "remove-components";
      entity: string;
      components: readonly string[];
    }
  | {
      kind: "money-transfer";
      payer: string;
      recipient: string | null;
      amount: number;
    }
  | {
      kind: "fee-event";
      amount: number;
      cost: number;
      resource: "Parking";
      outside: false;
    }
  | {
      kind: "pathfind";
      owner: string;
      parameters: CS2PersonalPathParameters;
      origin: CS2PersonalSetupTarget;
      destination: CS2PersonalSetupTarget;
    };
export type CS2PersonalCarNativeKind =
  | "reset-parking-lane-status"
  | "set-parking-curve-pos"
  | "validate-parking-space"
  | "find-free-parking-space";
export type CS2PersonalCarNativeRequest = {
  kind: CS2PersonalCarNativeKind;
  entity: string;
  randomState: number;
  input: Readonly<Record<string, string | number | boolean | null>>;
  state: CS2PersonalCarState;
};
export type CS2PersonalCarNativeReply = {
  /** Required for value-returning queries; explicit null/false is meaningful. */
  result?: string | number | boolean | null;
  curvePosition?: number;
  randomState?: number;
  current?: CS2LaneCacheCurrent;
  pathOwner?: Cs2PathOwner;
  path?: CS2PersonalPathElement[];
  navigationLanes?: CS2NavigationQueuedLane[];
};
export type CS2PersonalCarCallbacks = Partial<
  Record<
    CS2PersonalCarNativeKind,
    (
      request: CS2PersonalCarNativeRequest,
    ) => CS2PersonalCarNativeReply | undefined
  >
>;
export type CS2PersonalCarOutcome = {
  kind: "continuing" | "deleted" | "parked" | "filtered";
  reason:
    | "none"
    | "path-failure"
    | "invalid-target"
    | "path-end"
    | "parking-reached"
    | "boarding"
    | "excluded-query";
};
export type CS2PersonalCarAdvance =
  | {
      status: "pending";
      request: CS2PersonalCarNativeRequest;
      transaction: CS2PersonalCarAITransaction;
    }
  | {
      status: "complete";
      state: CS2PersonalCarState;
      commands: readonly CS2PersonalCarCommand[];
      randomState: number;
      outcome: CS2PersonalCarOutcome;
    };

/** Empty maps mean explicitly absent components; required source buffer reads still throw. */
export function createCS2PersonalCarWorld(
  input: Pick<CS2PersonalCarWorld, "entities" | "city" | "timeOfDay"> &
    Partial<Omit<CS2PersonalCarWorld, "entities" | "city" | "timeOfDay">>,
): CS2PersonalCarWorld {
  return {
    lanes: new Map(),
    passengers: new Map(),
    currentVehicles: new Map(),
    paths: new Map(),
    pathOwners: new Map(),
    targets: new Map(),
    residents: new Map(),
    householdMembers: new Map(),
    propertyRenters: new Map(),
    households: new Map(),
    householdCitizens: new Map(),
    movingAway: new Set(),
    citizens: new Map(),
    workers: new Map(),
    travelPurposes: new Map(),
    diverts: new Map(),
    ...input,
  };
}

const F = CS2_PERSONAL_CAR_FLAGS,
  f = Math.fround;
const PATH_END_MASK = 1 | 2 | 16 | 512;
const removeMoving = [
  "Moving",
  "TransformFrame",
  "InterpolatedTransform",
  "Swaying",
  "CarNavigation",
  "CarNavigationLane",
  "CarCurrentLane",
  "PathOwner",
  "Target",
  "Blocker",
  "PathElement",
] as const;
const addParked = ["ParkedCar", "Stopped", "Updated"] as const;
const pathEnd = (current: CS2LaneCacheCurrent) =>
  (current.flags & PATH_END_MASK) === 3;
const required = <T>(
  map: ReadonlyMap<string, T>,
  entity: string,
  component: string,
): T => {
  if (!map.has(entity))
    throw new Error(`Missing source ${component} for ${entity}`);
  return map.get(entity)!;
};
const targetDefaults = (): CS2PersonalSetupTarget => ({
  type: 0,
  methods: 0,
  entity: null,
  entity2: null,
  resource: 0,
  activityMask: 0,
  maintenanceType: 0,
  flags: 0,
  trackTypes: 0,
  roadTypes: 0,
  flyingTypes: 0,
  value: 0,
  value2: 0,
  randomCost: 0,
  value3: 0,
});

/** A paused native query resumes inside the same Tick, without committing partial commands. */
export class CS2PersonalCarAITransaction {
  readonly state: CS2PersonalCarState;
  readonly commands: CS2PersonalCarCommand[] = [];
  readonly outcome: CS2PersonalCarOutcome = {
    kind: "continuing",
    reason: "none",
  };
  private readonly random: SourceRandom32;
  private readonly execution: Generator<
    CS2PersonalCarNativeRequest,
    void,
    CS2PersonalCarNativeReply | undefined
  >;
  private waiting = false;
  constructor(
    readonly world: CS2PersonalCarWorld,
    readonly input: CS2PersonalCarInput,
  ) {
    this.state = structuredClone(input.state);
    this.random = new SourceRandom32(
      deriveCs2WorkerSeed(input.batchSeed, input.entityIndex),
    );
    this.execution = this.tick();
  }
  advance(reply?: CS2PersonalCarNativeReply): CS2PersonalCarAdvance {
    if (this.waiting && reply === undefined)
      throw new Error("A pending native query requires an explicit reply");
    const next = this.execution.next(reply);
    this.waiting = !next.done;
    return next.done
      ? {
          status: "complete",
          state: this.state,
          commands: this.commands,
          randomState: this.random.state,
          outcome: this.outcome,
        }
      : { status: "pending", request: next.value, transaction: this };
  }
  private nextInt(max: number) {
    return Number(
      (BigInt((this.random.nextUInt() + 1) >>> 0) * BigInt(max)) >> 32n,
    );
  }
  private lane(id: string | null) {
    return id ? this.world.lanes.get(id) : undefined;
  }
  private parking(id: string | null) {
    const lane = this.lane(id);
    return !!lane?.parking || !!((lane?.connectionFlags ?? 0) & 256);
  }
  private carLane(id: string | null) {
    const lane = this.lane(id);
    if (lane?.car) return true;
    if (lane?.connectionFlags !== undefined)
      return !!(lane.connectionFlags & 32);
    return (
      !!lane?.spawn &&
      (lane.spawnLocation ?? true) &&
      (lane.spawn.connectionType === 1 || lane.spawn.connectionType === 6)
    );
  }
  private bicycleLane(id: string | null) {
    const lane = this.lane(id);
    if (lane?.pedestrianFlags !== undefined)
      return !!(lane.pedestrianFlags & 0x100);
    if (lane?.connectionFlags !== undefined)
      return (
        !!(lane.connectionFlags & 128) && !!(lane.connectionFlags & (8 | 16))
      );
    return (
      !!lane?.spawn &&
      (lane.spawnLocation ?? true) &&
      (lane.spawn.connectionType === 2 ||
        (lane.spawn.connectionType === 6 && lane.spawn.roadTypes === 16)) &&
      lane.spawn.activityMask === 0
    );
  }
  private *native(
    kind: CS2PersonalCarNativeKind,
    input: CS2PersonalCarNativeRequest["input"] = {},
  ) {
    const reply: CS2PersonalCarNativeReply | undefined = yield {
      kind,
      input,
      entity: this.input.entity,
      randomState: this.random.state,
      state: structuredClone(this.state),
    } satisfies CS2PersonalCarNativeRequest;
    if (reply === undefined)
      throw new Error(`Native ${kind} requires a response`);
    if (
      kind === "reset-parking-lane-status" &&
      (reply.navigationLanes ||
        (reply.randomState !== undefined &&
          reply.randomState !== this.random.state))
    )
      throw new Error(
        "ResetParkingLaneStatus cannot mutate navigation buffer or consume caller RNG",
      );
    if (
      (kind === "set-parking-curve-pos" ||
        kind === "find-free-parking-space") &&
      (reply.current || reply.pathOwner || reply.navigationLanes)
    )
      throw new Error(
        `${kind} does not receive mutable current/pathOwner/navigation`,
      );
    if (kind === "find-free-parking-space" && reply.path)
      throw new Error("FindFreeParkingSpace cannot mutate PathElement buffer");
    if (reply.current)
      Object.assign(this.state.current, structuredClone(reply.current));
    if (reply.pathOwner) this.state.pathOwner = { ...reply.pathOwner };
    if (reply.path) this.state.path = structuredClone(reply.path);
    if (reply.navigationLanes)
      this.state.navigationLanes = structuredClone(reply.navigationLanes);
    if (reply.randomState !== undefined)
      this.random.state = reply.randomState >>> 0;
    return reply;
  }
  private *resetPath() {
    const state = this.state;
    if (state.personalCar.flags & F.transporting && !this.input.isBicycle)
      state.carFlags |= 2;
    else state.carFlags &= ~2;
    // The actual CarCurrentLane PathUtils.ResetPath overload has an empty body.
    if (this.parking(state.current.laneId))
      yield* this.native("reset-parking-lane-status", {
        isBicycle: !!this.input.isBicycle,
      });
    else if (
      this.carLane(state.current.laneId) ||
      (this.input.isBicycle && this.bicycleLane(state.current.laneId))
    )
      state.current.flags &= ~16;
    if (
      state.path
        .slice(state.pathOwner.elementIndex)
        .some((p) => this.parking(p.target))
    )
      yield* this.native("set-parking-curve-pos", { ignoreDriveways: false });
  }
  private removePath() {
    this.state.path.length = 0;
    this.state.pathOwner.elementIndex = 0;
  }
  private passengers(vehicle: string) {
    return required(this.world.passengers, vehicle, "Passenger buffer");
  }
  private vehicles() {
    return this.state.layout?.length ? this.state.layout : [this.input.entity];
  }
  private hasPassengers() {
    return this.vehicles().some(
      (vehicle) => this.passengers(vehicle).length !== 0,
    );
  }
  private findLeader() {
    for (const vehicle of this.vehicles())
      for (const passenger of this.passengers(vehicle))
        if ((this.world.currentVehicles.get(passenger)?.flags ?? 0) & 2)
          return passenger;
    return null;
  }
  private passengersReady() {
    let leader: string | null = null;
    for (const vehicle of this.vehicles())
      for (const passenger of this.passengers(vehicle)) {
        const current = this.world.currentVehicles.get(passenger);
        if (!current) continue;
        if (!(current.flags & 1)) return { ready: false, leader };
        if (current.flags & 2) leader = passenger;
      }
    return { ready: true, leader };
  }
  private startBoarding() {
    if (this.state.personalCar.flags & F.dummyTraffic) return false;
    this.state.personalCar.flags |= F.boarding;
    return true;
  }
  private stopBoarding() {
    const { ready, leader } = this.passengersReady(),
      state = this.state;
    if (!ready) return false;
    state.personalCar.flags &= ~F.boarding;
    if (leader === null) return true;
    const source = required(this.world.paths, leader, "PathElement buffer"),
      owner = required(this.world.pathOwners, leader, "PathOwner");
    state.path = structuredClone(source.slice(owner.elementIndex));
    state.pathOwner.elementIndex = 0;
    state.pathOwner.flags |= P.Updated;
    state.personalCar.flags |= F.transporting;
    state.target = required(this.world.targets, leader, "Target");
    const resident = this.world.residents.get(leader),
      household = resident && this.world.householdMembers.get(resident.citizen),
      property = household && this.world.propertyRenters.get(household);
    let home = property !== undefined && property === state.target;
    const divert = this.world.diverts.get(leader);
    if (divert) home &&= divert.purpose === 0;
    if (home) state.personalCar.flags |= F.homeTarget;
    else state.personalCar.flags &= ~F.homeTarget;
    if (state.navigationLanes.length)
      state.navigationLanes[state.navigationLanes.length - 1].flags &= ~1;
    else state.current.flags &= ~1;
    return true;
  }
  private startDisembarking() {
    if (!this.hasPassengers()) return false;
    const state = this.state,
      lane = this.lane(state.current.laneId);
    state.personalCar.flags =
      (state.personalCar.flags & ~F.transporting) | F.disembarking;
    let fee = 0;
    if (lane?.parking) fee = Math.max(0, lane.parking.fee);
    else if (
      pathEnd(state.current) &&
      !cs2PathfindFailed(state.pathOwner.flags) &&
      (lane?.spawnLocation ?? !!lane?.spawn) &&
      state.path.length <= state.pathOwner.elementIndex
    ) {
      state.pathOwner.elementIndex = 0;
      state.path = [
        {
          target: state.current.laneId,
          delta: [
            f(state.current.curvePosition.z),
            f(state.current.curvePosition.z),
          ],
          flags: 0,
        },
      ];
    }
    if (fee === 0 && lane?.garage) fee = Math.max(0, lane.garage.fee);
    if (fee > 0) {
      const leader = this.findLeader(),
        resident = leader ? this.world.residents.get(leader) : undefined,
        household =
          resident && this.world.householdMembers.get(resident.citizen);
      if (household) {
        this.commands.push({
          kind: "money-transfer",
          payer: household,
          recipient: this.world.city,
          amount: fee,
        });
        this.commands.push({
          kind: "fee-event",
          amount: 1,
          cost: fee,
          resource: "Parking",
          outside: false,
        });
      }
    }
    return true;
  }
  private stopDisembarking() {
    if (this.hasPassengers()) return false;
    this.removePath();
    this.state.personalCar.flags &= ~F.disembarking;
    return true;
  }
  private deleteVehicle() {
    for (const entity of this.vehicles())
      this.commands.push({
        kind: "add-component",
        entity,
        component: "Deleted",
      });
    this.outcome.kind = "deleted";
  }
  private parkCar(resetLocation: boolean) {
    const state = this.state,
      id = this.input.entity,
      lane = this.lane(state.current.laneId);
    if (
      (this.input.isBicycle &&
        (resetLocation ||
          ((!lane?.parking || state.current.changeLaneId != null) &&
            !lane?.garage))) ||
      state.personalCar.flags & F.dummyTraffic
    ) {
      this.deleteVehicle();
      return;
    }
    state.personalCar.flags &= ~(F.transporting | F.boarding | F.disembarking);
    if (state.layout !== undefined) {
      for (const vehicle of state.layout)
        if (vehicle !== id)
          this.commands.push({
            kind: "add-component",
            entity: vehicle,
            component: "Deleted",
          });
      this.commands.push({
        kind: "remove-component",
        entity: id,
        component: "LayoutElement",
      });
    }
    this.commands.push(
      { kind: "remove-components", entity: id, components: removeMoving },
      { kind: "add-components", entity: id, components: addParked },
      {
        kind: "set-component",
        entity: id,
        component: "ParkedCar",
        value: {
          lane: state.current.laneId,
          curvePosition: f(state.current.curvePosition.x),
        },
      },
    );
    const fix = (reset: string | null) =>
      this.commands.push({
        kind: "add-component",
        entity: id,
        component: "FixParkingLocation",
        value: {
          changeLane: state.current.changeLaneId ?? null,
          resetLocation: reset,
        },
      });
    if (resetLocation) {
      const household =
          state.personalCar.keeper &&
          this.world.householdMembers.get(state.personalCar.keeper),
        property = household && this.world.propertyRenters.get(household);
      let reset: string | null = null;
      if (
        household &&
        property !== undefined &&
        required(this.world.households, household, "Household").flags & 4 &&
        !this.world.movingAway.has(household)
      )
        reset = property;
      fix(reset);
    } else if (lane?.parking && state.current.changeLaneId == null) {
      this.commands.push({
        kind: "add-component",
        entity: state.current.laneId!,
        component: "PathfindUpdated",
      });
    } else {
      if (lane?.garage)
        this.commands.push({
          kind: "add-component",
          entity: state.current.laneId!,
          component: "PathfindUpdated",
        });
      fix(id);
    }
    this.outcome.kind = "parked";
  }
  private parkingSize() {
    const g = this.input.geometry;
    return g
      ? {
          size: [
            Math.max(f(0.01), f(f(g.max.x) - f(g.min.x))),
            Math.max(f(1.01), f(f(g.max.z) - f(g.min.z))),
          ] as const,
          offset: f(-f(f(f(g.min.z) + f(g.max.z)) * 0.5)),
        }
      : { size: [0, 0] as const, offset: 0 };
  }
  private *checkParkingSpace() {
    const state = this.state;
    if (
      state.current.flags & 16 ||
      state.navigationLanes.some((lane) => lane.flags & 16)
    ) {
      const result = yield* this.native("validate-parking-space", {
        ignoreDriveways: false,
        ignoreDisabled: true,
        boardingOnly: false,
      });
      if (result.result !== null && typeof result.result !== "string")
        throw new Error(
          "ValidateParkingSpace requires an explicit entity/null result",
        );
      if (result.result !== null) return;
    }
    const count = Math.min(
      40000,
      state.path.length - state.pathOwner.elementIndex,
    );
    if (count <= 0 || state.navigationLanes.length <= 0) return;
    const offset = Math.trunc(
        (this.nextInt(count) * (this.nextInt(count) + 1)) / count,
      ),
      index = state.pathOwner.elementIndex + offset,
      element = state.path[index],
      lane = this.lane(element.target);
    if (lane?.parking) {
      const last = state.navigationLanes[state.navigationLanes.length - 1],
        minT =
          offset === 0
            ? last.flags & 128
              ? last.end
              : last.start
            : state.path[index - 1].delta[0],
        size = this.parkingSize(),
        reply = yield* this.native("find-free-parking-space", {
          lane: element.target,
          minT,
          parkingLength: size.size[1],
          parkingOffset: size.offset,
          curvePosition: element.delta[0],
          ignoreDriveways: false,
          ignoreDisabled: true,
        });
      if (typeof reply.result !== "boolean")
        throw new Error(
          "FindFreeParkingSpace requires an explicit boolean result",
        );
      if (reply.result) return;
    } else {
      if (!lane?.garage) return;
      if (lane.connectionFlags === undefined)
        throw new Error("GarageLane requires ConnectionLane snapshot");
      if (
        lane.garage.count < lane.garage.capacity &&
        !(lane.connectionFlags & 0x4000)
      )
        return;
    }
    for (let i = 0; i < offset; i++)
      if (this.parking(state.path[state.pathOwner.elementIndex + i].target))
        return;
    state.pathOwner.flags |= P.Obsolete;
  }
  private findNewPath() {
    const state = this.state,
      car = this.input.prefabCar,
      methods = car.sizeClass < 2 ? 8194 : car.sizeClass === 2 ? 2 : 0,
      ignored =
        64 |
        (car.sizeClass < 2 ? 8 : 0) |
        (!(car.energyType & 1) ? 2 : 0) |
        (f(car.maxSpeed) >= f(22.222223) ? 32 : 0),
      transport = !!(state.personalCar.flags & F.transporting),
      size = this.parkingSize(),
      origin = targetDefaults(),
      destination = targetDefaults(),
      parameters: CS2PersonalPathParameters = {
        parkingTarget: this.parking(state.current.laneId)
          ? state.current.laneId
          : this.input.entity,
        authorization1: null,
        authorization2: null,
        weights: [1, 1, 1, 1],
        maxSpeed: [f(car.maxSpeed), transport ? f(277.77777) : f(car.maxSpeed)],
        walkSpeed: [f(5.555556), f(5.555556)],
        parkingSize: transport ? size.size : [0, 0],
        parkingDelta: f(state.current.curvePosition.z),
        maxCost: 0,
        maxResultCount: 0,
        methods,
        pathfindFlags: 0,
        ignoredRules: ignored,
        taxiIgnoredRules: 0,
      };
    state.pathOwner.flags &= ~(P.AddDestination | P.Divert);
    let home = false;
    if (transport) {
      parameters.taxiIgnoredRules = 2 | 8 | 16 | 32 | 64;
      destination.methods = 1;
      destination.entity = state.target;
      destination.randomCost = 30;
      if (this.input.isBicycle) {
        parameters.methods = 1 | 16384 | 32768;
        parameters.ignoredRules = 2 | 4 | 8;
        origin.methods = 16384 | 32768;
        origin.roadTypes = 16;
      } else {
        parameters.methods = methods | 4 | 1;
        origin.methods = methods | 4;
        origin.roadTypes = 1;
      }
      const leader = this.findLeader(),
        resident = leader ? this.world.residents.get(leader) : undefined;
      if (resident) {
        parameters.maxCost = 17000;
        parameters.walkSpeed = [f(resident.walkSpeed), f(resident.walkSpeed)];
        parameters.methods |= resident.flags & 0x100 ? 0 : 32;
        if (!(resident.flags & 0x200)) {
          const t = f(f(this.world.timeOfDay) + f(1 / 48)),
            phase = f(t - Math.floor(t));
          parameters.methods |=
            phase >= f(0.25) && phase < f(11 / 12) ? 8 : 512;
        }
        destination.activityMask = resident.supportedActivities >>> 0;
        const household = this.world.householdMembers.get(resident.citizen),
          property = household && this.world.propertyRenters.get(household);
        if (property !== undefined) {
          parameters.authorization1 = property;
          home ||= property === state.target;
        }
        const worker = this.world.workers.get(resident.citizen);
        if (worker)
          parameters.authorization2 =
            this.world.propertyRenters.get(worker.workplace) ??
            worker.workplace;
        const citizen = this.world.citizens.get(resident.citizen);
        if (citizen) {
          const h = required(
              this.world.householdMembers,
              resident.citizen,
              "HouseholdMember",
            ),
            house = required(this.world.households, h, "Household"),
            count = required(
              this.world.householdCitizens,
              h,
              "HouseholdCitizen buffer",
            ).length,
            seed =
              (305419905 ^
                ((citizen.pseudoRandom << 16) | citizen.pseudoRandom)) >>>
              0,
            random = new SourceRandom32(seed);
          random.nextUInt();
          let next = random.nextUInt();
          if (next === 0) next = 0xffffffff;
          const comfort = new SourceRandom32(next).nextFloat();
          parameters.weights = cs2CitizenPathfindWeights({
            leisureCounter: citizen.leisureCounter,
            householdCitizens: count,
            consumptionPerDay: house.consumptionPerDay,
            comfortRandom: comfort,
            movedIn: !!(house.flags & 4),
            movingAwayTouristOrCommuter: !!(
              citizen.flags &
              (4 | 0x200 | 0x400)
            ),
          });
        }
        if (this.world.travelPurposes.get(resident.citizen)?.purpose === 16)
          parameters.weights = [1, f(0.2), 0, f(0.1)];
        const divert = leader && this.world.diverts.get(leader);
        if (divert) {
          if (divert.purpose !== 0) {
            if (divert.target !== null) {
              destination.entity = divert.target;
              state.pathOwner.flags |= P.Divert;
            } else if (divert.purpose === 35) {
              destination.type = 18;
              state.pathOwner.flags |= P.AddDestination | P.Divert;
            } else if (divert.purpose === 15 || divert.purpose === 23) {
              destination.type = 22;
              state.pathOwner.flags |= P.Divert;
            } else if (divert.purpose === 36) {
              destination.type = 19;
              state.pathOwner.flags |= P.AddDestination | P.Divert;
            }
          }
          home &&= divert.purpose === 0;
        }
        if (this.input.isBicycle && home) {
          destination.methods |= 16384;
          destination.roadTypes |= 16;
        }
      }
    } else {
      origin.methods = methods | 4;
      origin.roadTypes = 1;
      destination.methods = methods;
      destination.roadTypes = 1;
      destination.entity = state.target;
    }
    if (home) state.personalCar.flags |= F.homeTarget;
    else state.personalCar.flags &= ~F.homeTarget;
    state.current.flags = cs2SetupCarPathfind(
      state.pathOwner,
      state.current.flags,
    );
    this.commands.push({
      kind: "pathfind",
      owner: this.input.entity,
      parameters,
      origin,
      destination,
    });
  }
  private *tick(): Generator<
    CS2PersonalCarNativeRequest,
    void,
    CS2PersonalCarNativeReply | undefined
  > {
    if (
      this.input.excluded &&
      Object.values(this.input.excluded).some(Boolean)
    ) {
      this.outcome.kind = "filtered";
      this.outcome.reason = "excluded-query";
      return;
    }
    const state = this.state,
      addComponent = (component: string) =>
        this.commands.push({
          kind: "add-component",
          entity: this.input.entity,
          component,
        });
    if (state.current.flags & (0x1000000 | 0x2000000)) {
      if (!state.unspawned) {
        addComponent("Unspawned");
        addComponent("BatchesUpdated");
      }
    } else if (!(state.current.flags & (8 | 16)) && state.unspawned) {
      this.commands.push({
        kind: "remove-component",
        entity: this.input.entity,
        component: "Unspawned",
      });
      addComponent("BatchesUpdated");
    }
    if (resetCs2UpdatedPath(state.pathOwner)) yield* this.resetPath();
    const pedestrianLane = this.lane(state.current.laneId),
      pedestrian = pedestrianLane?.pedestrianFlags;
    if (
      this.input.isBicycle &&
      state.current.laneId !== null &&
      !(state.pathOwner.flags & (P.Pending | P.Obsolete)) &&
      pedestrian !== undefined &&
      pedestrianLane?.pedestrianAccessRestriction != null &&
      !(pedestrian & (8 | 128))
    )
      state.pathOwner.flags |= P.Failed;
    const failed = cs2PathfindFailed(state.pathOwner.flags),
      inactive = !(
        state.personalCar.flags &
        (F.transporting | F.boarding | F.disembarking)
      ),
      missing =
        inactive &&
        (state.target === null || !this.world.entities.has(state.target));
    if (missing || failed) {
      this.outcome.reason = failed ? "path-failure" : "invalid-target";
      this.removePath();
      if (state.personalCar.flags & F.disembarking) {
        if (this.stopDisembarking()) this.parkCar(true);
        return;
      }
      if (state.personalCar.flags & F.transporting) {
        if (!this.startDisembarking()) this.parkCar(true);
        return;
      }
      if (!(state.personalCar.flags & F.boarding)) {
        this.parkCar(false);
        return;
      }
      if (!this.stopBoarding()) return;
      if (!(state.personalCar.flags & F.transporting)) {
        this.parkCar(false);
        return;
      }
    } else if (
      ((state.current.flags & (2 | 16)) === (2 | 16) &&
        !(state.pathOwner.flags & P.Pending)) ||
      state.personalCar.flags & (F.boarding | F.disembarking)
    ) {
      this.outcome.reason =
        (state.current.flags & (2 | 16)) === (2 | 16) &&
        !(state.pathOwner.flags & P.Pending)
          ? "parking-reached"
          : "boarding";
      if (state.personalCar.flags & F.disembarking) {
        if (this.stopDisembarking()) this.parkCar(false);
        return;
      }
      if (state.personalCar.flags & F.transporting) {
        if (!this.startDisembarking()) this.parkCar(false);
        return;
      }
      if (!(state.personalCar.flags & F.boarding)) {
        if (!this.startBoarding()) this.deleteVehicle();
        return;
      }
      if (!this.stopBoarding()) return;
      if (!(state.personalCar.flags & F.transporting)) {
        this.parkCar(false);
        return;
      }
    } else {
      if (pathEnd(state.current)) {
        this.outcome.reason = "path-end";
        if (state.personalCar.flags & F.transporting) {
          if (!this.startDisembarking()) this.parkCar(false);
        } else this.deleteVehicle();
        return;
      }
      if ((state.current.flags & (2 | 512)) === (2 | 512)) {
        state.current.flags &= ~512;
        state.pathOwner.flags =
          (state.pathOwner.flags & ~P.Failed) | P.Obsolete;
      }
    }
    if (!(state.personalCar.flags & F.disembarking)) {
      if (cs2RequireNewPath(state.pathOwner.flags)) this.findNewPath();
      else if (!(state.pathOwner.flags & (P.Pending | P.Failed | P.Stuck)))
        yield* this.checkParkingSpace();
    }
  }
}

/** Synchronous adapters can answer every query; otherwise retain the returned transaction. */
export function runCS2PersonalCarAI(
  world: CS2PersonalCarWorld,
  input: CS2PersonalCarInput,
  callbacks: CS2PersonalCarCallbacks = {},
): CS2PersonalCarAdvance {
  const transaction = new CS2PersonalCarAITransaction(world, input);
  let result = transaction.advance();
  while (result.status === "pending") {
    const reply = callbacks[result.request.kind]?.(result.request);
    if (reply === undefined) return result;
    result = transaction.advance(reply);
  }
  return result;
}
