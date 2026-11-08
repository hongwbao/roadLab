/** Frame-scheduled source target/motion runtime; no lane-following integrator. */
import { type CS2CarData, CS2_BASE_CAR } from "./cs2-driving";
import {
  cs2InterpolateTransform,
  cs2InterpolationFrames,
  cs2MotionEffectsChanged,
  cs2MotionSchedule,
  cs2MoveCar,
  CS2_MOTION_TIMESTEP,
  CS2_MOTION_HALF_TIMESTEP,
  type CS2MotionFrame,
  type CS2MotionNavigation,
  type CS2MotionState,
} from "./cs2-motion";
import {
  cs2UpdateRoadNavigationTarget,
  CS2_NAV_TARGET_FLAGS,
  type CS2NavigationCurve,
  type CS2NavigationCurrentState,
  type CS2NavigationQueuedLane,
} from "./cs2-navigation-target";

export type CS2RuntimeVehicleId = number | string;
export type CS2RuntimeFrame = CS2MotionFrame & {
  stateTimer?: number;
  state?: number;
  activity?: number;
};
export type CS2RuntimeVehicleSeed = {
  id: CS2RuntimeVehicleId;
  updateGroup?: number;
  car?: CS2CarData;
  geometry: { width: number; frontExtent: number; pivotOffset: number };
  state: CS2MotionState;
  navigation: CS2MotionNavigation;
  current: CS2NavigationCurrentState;
  nextLanes: readonly CS2NavigationQueuedLane[];
  seed?: number;
  carFlags?: number;
  frames?: readonly CS2RuntimeFrame[];
  frameInitialization?: "created" | "loaded";
  /** Exact source frame at which serialization/creation initialization occurs. */
  initializationFrame?: number;
  odometer?: number;
};
export type CS2RuntimeVehicleView = Omit<
  CS2RuntimeVehicleSeed,
  "updateGroup" | "car" | "frames" | "nextLanes"
> & {
  updateGroup: number;
  car: CS2CarData;
  frames: readonly CS2RuntimeFrame[];
  nextLanes: readonly CS2NavigationQueuedLane[];
  odometer: number;
  navigationUpdates: number;
  motionUpdates: number;
  lastNavigationFrame: number | null;
  lastMotionFrame: number | null;
  temporaryBlocker: boolean;
  fullUpdatePending: boolean;
};
export type CS2RuntimeReadonly<T> = T extends readonly (infer Item)[]
  ? readonly CS2RuntimeReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: CS2RuntimeReadonly<T[Key]> }
    : T;
export type CS2RuntimeReadonlyVehicleView =
  CS2RuntimeReadonly<CS2RuntimeVehicleView>;
type StoredVehicle = Omit<CS2RuntimeVehicleView, "nextLanes" | "frames"> & {
  nextLanes: CS2NavigationQueuedLane[];
  frames: CS2RuntimeFrame[];
};
export type CS2RuntimeEvent =
  | {
      type: "lane-flow";
      id: CS2RuntimeVehicleId;
      frame: number;
      laneId: string;
      duration: number;
      distance: number;
    }
  | {
      type:
        | "end-reached"
        | "effects-updated"
        | "full-update-requested"
        | "vehicle-removed"
        | "frames-reset";
      id: CS2RuntimeVehicleId;
      frame: number;
    }
  | {
      type: "special-target-deferred";
      id: CS2RuntimeVehicleId;
      frame: number;
      lane: CS2NavigationQueuedLane;
    };
export type CS2RuntimePhysicalState = {
  readonly position: Readonly<CS2MotionState["position"]>;
  readonly velocity: Readonly<CS2MotionState["velocity"]>;
  readonly rotation: Readonly<CS2MotionState["rotation"]>;
};
export type CS2RuntimeContext = {
  frame: number;
  updateGroup: number;
  physicalSnapshot: ReadonlyMap<CS2RuntimeVehicleId, CS2RuntimePhysicalState>;
};
export type CS2RuntimeDecision = {
  maxSpeed: number;
  random01: number;
  rollingExit?: boolean;
  oncoming?: number;
  canChangeLane?: number;
  temporaryBlocker?: boolean;
  upcomingTurnFlags?: number;
  leftHandTraffic?: boolean;
  /** Explicit source lane-selection/path results, applied before the target phase. */
  current?: CS2NavigationCurrentState;
  nextLanes?: readonly CS2NavigationQueuedLane[];
  navigation?: CS2MotionNavigation;
  carFlags?: number;
  dayLightBrightness?: number;
  selectNextLane?: (
    previousLane: string,
    requestedLane: string,
  ) => string | undefined;
};
export type CS2RuntimeDecisionCallback = (
  vehicle: CS2RuntimeVehicleView,
  context: CS2RuntimeContext,
) => CS2RuntimeDecision;
export type CS2RuntimeAfterNavigation = (
  vehicle: CS2RuntimeVehicleView,
  context: CS2RuntimeContext & {
    navigationSnapshot: ReadonlyMap<CS2RuntimeVehicleId, CS2RuntimeVehicleView>;
  },
) => void | {
  remove?: boolean;
  skipMotion?: boolean;
  navigation?: CS2MotionNavigation;
  current?: CS2NavigationCurrentState;
  nextLanes?: readonly CS2NavigationQueuedLane[];
  carFlags?: number;
};
export type CS2RuntimeFrameResult = {
  frame: number;
  updatedIds: CS2RuntimeVehicleId[];
  motionIds: CS2RuntimeVehicleId[];
  events: CS2RuntimeEvent[];
};
const f = Math.fround;
const vector = (v: CS2MotionState["position"]) => ({
  x: f(v.x),
  y: f(v.y),
  z: f(v.z),
});
const quaternion = (q: CS2MotionState["rotation"]) => ({
  ...vector(q),
  w: f(q.w),
});
const stateCopy = (s: CS2MotionState): CS2MotionState => ({
  position: vector(s.position),
  velocity: vector(s.velocity),
  rotation: quaternion(s.rotation),
});
const navCopy = (n: CS2MotionNavigation): CS2MotionNavigation => ({
  targetPosition: vector(n.targetPosition),
  maxSpeed: f(n.maxSpeed),
  targetRotation: n.targetRotation
    ? quaternion(n.targetRotation)
    : { x: 0, y: 0, z: 0, w: 0 },
});
const currentCopy = (
  c: CS2NavigationCurrentState,
): CS2NavigationCurrentState => ({
  ...c,
  curvePosition: vector(c.curvePosition),
  changeProgress: f(c.changeProgress),
  lanePosition: f(c.lanePosition),
  duration: f(c.duration),
  distance: f(c.distance),
});
const frameCopy = (v: CS2RuntimeFrame): CS2RuntimeFrame => ({
  ...stateCopy(v),
  flags: v.flags,
  stateTimer: v.stateTimer ?? 0,
  state: v.state ?? 0,
  activity: v.activity ?? 0,
});
const emptyFrame = (s: CS2MotionState): CS2RuntimeFrame => ({
  position: vector(s.position),
  velocity: { x: 0, y: 0, z: 0 },
  rotation: quaternion(s.rotation),
  flags: 0,
  stateTimer: 0,
  state: 0,
  activity: 0,
});
const viewCopy = (v: StoredVehicle): CS2RuntimeVehicleView => ({
  ...v,
  car: { ...v.car },
  geometry: { ...v.geometry },
  state: stateCopy(v.state),
  navigation: navCopy(v.navigation),
  current: currentCopy(v.current),
  nextLanes: v.nextLanes.map((q) => ({ ...q })),
  frames: v.frames.map(frameCopy),
});
function freezeSnapshot<T>(value: T): CS2RuntimeReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value as CS2RuntimeReadonly<T>;
}

/** UpdateGroupJob.FindUpdateIndex: least population, first index wins ties. */
export function cs2ChooseVehicleUpdateGroup(
  populations: readonly number[],
  preferred?: number,
) {
  if (preferred !== undefined) {
    if (!Number.isInteger(preferred) || preferred < 0 || preferred >= 16)
      throw new Error("A normal car update group must be in 0..15");
    return preferred;
  }
  let result = 0,
    minimum = Infinity;
  for (let i = 0; i < 16; i++)
    if ((populations[i] ?? 0) < minimum) {
      minimum = populations[i] ?? 0;
      result = i;
    }
  return result;
}

/** Created frames, or serialization's velocity back-projected load frames. */
export function cs2InitializeVehicleFrames(
  state: CS2MotionState,
  mode: "created" | "loaded",
  simulationFrame: number,
  updateGroup: number,
  existing?: readonly CS2RuntimeFrame[],
) {
  if (mode === "created")
    return Array.from({ length: 4 }, () => emptyFrame(state));
  const offset = Math.floor(
    (((simulationFrame >>> 0) - (updateGroup >>> 0)) >>> 0) / 16,
  );
  return Array.from({ length: 4 }, (_, i) => {
    const frame =
        existing?.length === 4 ? frameCopy(existing[i]) : emptyFrame(state),
      age = f(
        f((((offset - i) >>> 0) % 4) * CS2_MOTION_TIMESTEP) +
          CS2_MOTION_HALF_TIMESTEP,
      );
    frame.position = {
      x: f(f(state.position.x) - f(f(state.velocity.x) * age)),
      y: f(f(state.position.y) - f(f(state.velocity.y) * age)),
      z: f(f(state.position.z) - f(f(state.velocity.z) * age)),
    };
    frame.velocity = vector(state.velocity);
    frame.rotation = quaternion(state.rotation);
    return frame;
  });
}

/** Updated moving-object reset; game mode clears flags and zeroes frame velocities. */
export function cs2ResetUpdatedVehicleFrames(
  state: CS2MotionState,
  simulationFrame: number,
  updateGroup: number,
  previous?: readonly CS2RuntimeFrame[],
  editorMode = false,
) {
  const frame = simulationFrame >>> 0,
    phase = Math.floor(((frame + (frame % 16) - updateGroup) >>> 0) / 16) % 4,
    frames = Array.from({ length: 4 }, () => emptyFrame(state));
  for (let k = 0; k < 4; k++) {
    let index = k - phase - 1;
    if (index < 0) index += 4;
    frames[index].stateTimer = k;
    if (editorMode) frames[index].flags = previous?.[index]?.flags ?? 0;
  }
  return frames;
}

export class Cs2VehicleRuntime {
  private lanes: ReadonlyMap<string, CS2NavigationCurve>;
  private vehicles = new Map<CS2RuntimeVehicleId, StoredVehicle>();
  private readCache = new WeakMap<
    StoredVehicle,
    CS2RuntimeReadonlyVehicleView
  >();
  private physicalCache = new WeakMap<StoredVehicle, CS2RuntimePhysicalState>();
  private readList?: readonly CS2RuntimeReadonlyVehicleView[];
  private stepping = false;
  private lastFrame: number;
  constructor(
    lanes: ReadonlyMap<string, CS2NavigationCurve>,
    private options: {
      initialFrame?: number;
      afterNavigation?: CS2RuntimeAfterNavigation;
    } = {},
  ) {
    this.lanes = lanes;
    this.lastFrame = (options.initialFrame ?? 0) - 1;
  }
  get frame() {
    return this.lastFrame;
  }
  get size() {
    return this.vehicles.size;
  }
  private assertIdle() {
    if (this.stepping)
      throw new Error(
        "Mutate the source runtime through decision/owner-AI return values during a frame",
      );
  }
  private concrete(current: CS2NavigationCurrentState) {
    for (const id of [current.laneId, current.changeLaneId])
      if (id) {
        const lane = this.lanes.get(id) as
          (CS2NavigationCurve & { isMaster?: boolean }) | undefined;
        if (!lane) throw new Error(`Missing physical lane ${id}`);
        if (lane.isMaster)
          throw new Error(
            `Vehicle motion requires a physical slave lane, not master ${id}`,
          );
      }
  }
  setLanes(lanes: ReadonlyMap<string, CS2NavigationCurve>) {
    this.assertIdle();
    this.lanes = lanes;
  }
  addVehicle(seed: CS2RuntimeVehicleSeed) {
    this.assertIdle();
    if (this.vehicles.has(seed.id))
      throw new Error(`Duplicate source vehicle ${seed.id}`);
    this.concrete(seed.current);
    const populations = Array<number>(16).fill(0);
    for (const v of this.vehicles.values()) populations[v.updateGroup]++;
    const updateGroup = cs2ChooseVehicleUpdateGroup(
        populations,
        seed.updateGroup,
      ),
      state = stateCopy(seed.state),
      frames =
        seed.frameInitialization === "loaded"
          ? cs2InitializeVehicleFrames(
              state,
              "loaded",
              seed.initializationFrame ?? Math.max(0, this.lastFrame + 1),
              updateGroup,
              seed.frames,
            )
          : seed.frames?.length === 4
            ? seed.frames.map(frameCopy)
            : cs2InitializeVehicleFrames(
                state,
                "created",
                seed.initializationFrame ?? Math.max(0, this.lastFrame + 1),
                updateGroup,
              );
    const car = seed.car ?? CS2_BASE_CAR;
    this.vehicles.set(seed.id, {
      ...seed,
      updateGroup,
      car: {
        maxSpeed: f(car.maxSpeed),
        acceleration: f(car.acceleration),
        braking: f(car.braking),
        turningX: f(car.turningX),
        turningY: f(car.turningY),
      },
      geometry: {
        width: f(seed.geometry.width),
        frontExtent: f(seed.geometry.frontExtent),
        pivotOffset: f(seed.geometry.pivotOffset),
      },
      state,
      navigation: navCopy(seed.navigation),
      current: currentCopy(seed.current),
      nextLanes: seed.nextLanes.map((q) => ({ ...q })),
      frames,
      seed: seed.seed ?? 0,
      carFlags: seed.carFlags ?? 0,
      odometer: f(seed.odometer ?? 0),
      navigationUpdates: 0,
      motionUpdates: 0,
      lastNavigationFrame: null,
      lastMotionFrame: null,
      temporaryBlocker: false,
      fullUpdatePending: false,
    });
    this.readList = undefined;
    return this.getVehicle(seed.id)!;
  }
  removeVehicle(id: CS2RuntimeVehicleId) {
    this.assertIdle();
    const removed = this.vehicles.delete(id);
    if (removed) this.readList = undefined;
    return removed;
  }
  getVehicle(id: CS2RuntimeVehicleId) {
    const v = this.vehicles.get(id);
    return v ? viewCopy(v) : undefined;
  }
  allVehicles() {
    return [...this.vehicles.values()].map(viewCopy);
  }
  /** Immutable snapshots are shared until the corresponding vehicle changes. */
  readVehicle(id: CS2RuntimeVehicleId) {
    const vehicle = this.vehicles.get(id);
    return vehicle ? this.readView(vehicle) : undefined;
  }
  readVehicles(): readonly CS2RuntimeReadonlyVehicleView[] {
    return (this.readList ??= Object.freeze(
      [...this.vehicles.values()].map((vehicle) => this.readView(vehicle)),
    ));
  }
  private readView(vehicle: StoredVehicle) {
    let snapshot = this.readCache.get(vehicle);
    if (!snapshot) {
      snapshot = freezeSnapshot(viewCopy(vehicle));
      this.readCache.set(vehicle, snapshot);
    }
    return snapshot;
  }
  private physicalView(vehicle: StoredVehicle) {
    let snapshot = this.physicalCache.get(vehicle);
    if (!snapshot) {
      snapshot = freezeSnapshot(stateCopy(vehicle.state));
      this.physicalCache.set(vehicle, snapshot);
    }
    return snapshot;
  }
  physicalState(id: CS2RuntimeVehicleId) {
    const v = this.vehicles.get(id);
    return v ? stateCopy(v.state) : undefined;
  }
  displayPose(
    id: CS2RuntimeVehicleId,
    frameTime = 0,
    renderFrame = this.lastFrame,
  ) {
    const vehicle = this.vehicles.get(id);
    if (!vehicle) return undefined;
    const selection = cs2InterpolationFrames(
      renderFrame,
      frameTime,
      vehicle.updateGroup,
    );
    return {
      ...cs2InterpolateTransform(
        vehicle.frames[selection.frame1],
        vehicle.frames[selection.frame2],
        selection.position,
      ),
      selection,
    };
  }
  applyFullUpdate(
    id: CS2RuntimeVehicleId,
    state?: CS2MotionState,
    editorMode = false,
    sourceFrame = this.lastFrame,
  ): CS2RuntimeEvent | undefined {
    this.assertIdle();
    const v = this.vehicles.get(id);
    if (!v) return undefined;
    this.readCache.delete(v);
    this.physicalCache.delete(v);
    this.readList = undefined;
    if (state) v.state = stateCopy(state);
    v.frames = cs2ResetUpdatedVehicleFrames(
      v.state,
      Math.max(0, sourceFrame),
      v.updateGroup,
      v.frames,
      editorMode,
    );
    v.fullUpdatePending = false;
    return { type: "frames-reset", id, frame: sourceFrame };
  }
  stepFrame(
    absoluteFrame: number,
    decide: CS2RuntimeDecisionCallback,
  ): CS2RuntimeFrameResult {
    this.assertIdle();
    if (!Number.isSafeInteger(absoluteFrame) || absoluteFrame < 0)
      throw new Error("Source frame must be a nonnegative safe integer");
    if (absoluteFrame === this.lastFrame)
      return {
        frame: absoluteFrame,
        updatedIds: [],
        motionIds: [],
        events: [],
      };
    if (absoluteFrame !== this.lastFrame + 1)
      throw new Error("Use advanceToFrame to preserve every 60Hz source frame");
    this.stepping = true;
    try {
      const physicalSnapshot = new Map<
        CS2RuntimeVehicleId,
        CS2RuntimePhysicalState
      >();
      for (const [id, v] of this.vehicles) {
        physicalSnapshot.set(id, this.physicalView(v));
      }
      const context: CS2RuntimeContext = {
          frame: absoluteFrame,
          updateGroup: absoluteFrame & 15,
          physicalSnapshot,
        },
        events: CS2RuntimeEvent[] = [],
        updatedIds: CS2RuntimeVehicleId[] = [],
        motionIds: CS2RuntimeVehicleId[] = [];
      const pending = [...this.vehicles.values()]
        .filter((v) => cs2MotionSchedule(absoluteFrame, v.updateGroup).eligible)
        .map((old) => {
          const decision = decide(viewCopy(old), context),
            v: {
              vehicle: StoredVehicle;
              decision: CS2RuntimeDecision;
              skipMotion: boolean;
              remove: boolean;
            } = {
              vehicle: {
                ...old,
                current: currentCopy(decision.current ?? old.current),
                navigation: navCopy(decision.navigation ?? old.navigation),
                nextLanes: (decision.nextLanes ?? old.nextLanes).map((q) => ({
                  ...q,
                })),
                carFlags: decision.carFlags ?? old.carFlags,
              },
              decision,
              skipMotion: false,
              remove: false,
            };
          this.concrete(v.vehicle.current);
          const result = cs2UpdateRoadNavigationTarget({
            state: old.state,
            navigation: v.vehicle.navigation,
            current: v.vehicle.current,
            nextLanes: v.vehicle.nextLanes,
            lanes: this.lanes,
            vehicleWidth: old.geometry.width,
            frontExtent: old.geometry.frontExtent,
            pivotOffset: old.geometry.pivotOffset,
            car: old.car,
            maxSpeed: decision.maxSpeed,
            rollingExit: decision.rollingExit,
            random01: decision.random01,
            oncoming: decision.oncoming,
            canChangeLane: decision.canChangeLane,
            temporaryBlocker: decision.temporaryBlocker,
            previousTemporaryBlocker: old.temporaryBlocker,
            upcomingTurnFlags: decision.upcomingTurnFlags,
            leftHandTraffic: decision.leftHandTraffic,
            selectNextLane: decision.selectNextLane,
          });
          v.vehicle = {
            ...v.vehicle,
            navigation: navCopy(result.navigation),
            current: currentCopy(result.current),
            nextLanes: result.nextLanes.map((q) => ({ ...q })),
            odometer: f(old.odometer + result.odometerDelta),
            navigationUpdates: old.navigationUpdates + 1,
            lastNavigationFrame: absoluteFrame,
            temporaryBlocker: decision.temporaryBlocker ?? false,
          };
          updatedIds.push(old.id);
          for (const row of result.sideEffects)
            events.push({
              type: "lane-flow",
              id: old.id,
              frame: absoluteFrame,
              ...row,
            });
          if (
            result.endReached &&
            (old.current.flags & CS2_NAV_TARGET_FLAGS.EndReached) === 0
          )
            events.push({
              type: "end-reached",
              id: old.id,
              frame: absoluteFrame,
            });
          if (result.deferredLane) {
            v.skipMotion = true;
            events.push({
              type: "special-target-deferred",
              id: old.id,
              frame: absoluteFrame,
              lane: { ...result.deferredLane },
            });
          }
          return v;
        });
      const navigationSnapshot = new Map(
        pending.map((p) => [p.vehicle.id, viewCopy(p.vehicle)]),
      );
      for (const row of pending) {
        const action = this.options.afterNavigation?.(viewCopy(row.vehicle), {
          ...context,
          navigationSnapshot,
        });
        if (action) {
          row.remove = action.remove ?? false;
          row.skipMotion = action.skipMotion ?? row.skipMotion;
          if (action.navigation)
            row.vehicle.navigation = navCopy(action.navigation);
          if (action.current) {
            this.concrete(action.current);
            row.vehicle.current = currentCopy(action.current);
          }
          if (action.nextLanes)
            row.vehicle.nextLanes = action.nextLanes.map((q) => ({ ...q }));
          if (action.carFlags !== undefined)
            row.vehicle.carFlags = action.carFlags;
        }
      }
      for (const row of pending) {
        const v = row.vehicle;
        if (row.remove) {
          events.push({
            type: "vehicle-removed",
            id: v.id,
            frame: absoluteFrame,
          });
          continue;
        }
        if (row.skipMotion) continue;
        const motion = cs2MoveCar({
          state: v.state,
          navigation: v.navigation,
          pivotOffset: v.geometry.pivotOffset,
          carFlags: v.carFlags,
          laneFlags: v.current.flags,
          seed: v.seed,
          dayLightBrightness: row.decision.dayLightBrightness,
        });
        const slot = cs2MotionSchedule(
          absoluteFrame,
          v.updateGroup,
        ).transformFrameIndex;
        if (
          cs2MotionEffectsChanged(
            v.frames.map((frame) => frame.flags),
            slot,
            motion.frame.flags,
          )
        )
          events.push({
            type: "effects-updated",
            id: v.id,
            frame: absoluteFrame,
          });
        v.frames = v.frames.map(frameCopy);
        v.frames[slot] = frameCopy(motion.frame);
        v.state = stateCopy(motion.state);
        v.motionUpdates++;
        v.lastMotionFrame = absoluteFrame;
        motionIds.push(v.id);
        // CarMoveJob's localNavigation is read-only component scratch, never persisted.
        if (motion.forceFullUpdate) {
          v.fullUpdatePending = true;
          events.push({
            type: "full-update-requested",
            id: v.id,
            frame: absoluteFrame,
          });
        }
      }
      for (const row of pending)
        if (row.remove) this.vehicles.delete(row.vehicle.id);
        else this.vehicles.set(row.vehicle.id, row.vehicle);
      if (pending.length) this.readList = undefined;
      this.lastFrame = absoluteFrame;
      return { frame: absoluteFrame, updatedIds, motionIds, events };
    } finally {
      this.stepping = false;
    }
  }
  advanceToFrame(targetFrame: number, decide: CS2RuntimeDecisionCallback) {
    if (!Number.isSafeInteger(targetFrame) || targetFrame < this.lastFrame)
      throw new Error(
        "Cannot rewind source runtime without restoring a snapshot",
      );
    const results: CS2RuntimeFrameResult[] = [];
    while (this.lastFrame < targetFrame)
      results.push(this.stepFrame(this.lastFrame + 1, decide));
    return results;
  }
}
