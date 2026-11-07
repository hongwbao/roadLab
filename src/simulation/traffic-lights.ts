import type { Junction } from "../core/junctions";
import {
  signalArmKey,
  signalForJunction,
  type TrafficSignal,
} from "../core/traffic-signals";
import type { Turn, V } from "../core/types";
import {
  CS2_SIGNAL_TICK,
  CS2_SIGNAL_CAN_EXTEND,
  Cs2LaneSignal,
  Cs2TrafficLightState,
  tickCs2TrafficLights,
  updateCs2LaneSignal,
  updateCs2SignalHeads,
  type Cs2SignalClock,
  type Cs2SignalLane,
} from "./cs2-junctions";
import { buildCs2SignalGroups } from "./cs2-signal-groups";
import {
  resolveSignalApproaches,
  validateSignalProgram,
} from "../core/traffic-signal-programs";

export type LightColor = "red" | "yellow" | "green";
export type SignalMovement = {
  id: string;
  junction: string;
  road: string;
  end: 0 | 1;
  turn: Turn;
  /** The source grouping's straight classification can differ from map turn labels on shallow bends. */
  sourceStraight?: boolean;
  startDirection?: { x: number; z: number };
  endDirection?: { x: number; z: number };
};
export type SignalPhase = {
  name: string;
  duration: number;
  arms: string[];
  turns: Turn[];
  movements: ReadonlySet<string>;
};
export type SignalState = {
  id: string;
  junction: string;
  phase: number;
  name: string;
  stage: "green" | "yellow" | "all-red";
  remaining: number;
  clearing: boolean;
  phases: readonly SignalPhase[];
  cycle: number;
  actuated?: boolean;
  sourceState?: Cs2TrafficLightState;
};
type Clock = {
  config: TrafficSignal;
  junction: string;
  phases: SignalPhase[];
  phase: number;
  stage: SignalState["stage"];
  elapsed: number;
  clearing: boolean;
  yellowPasses: Set<number>;
  source?: {
    clock: Cs2SignalClock;
    lanes: Map<string, Cs2SignalLane>;
    heads: Map<string, number>;
    elapsed: number;
    nextTick: number;
  };
};
const sideName = (d: V) =>
  Math.abs(d.x) > Math.abs(d.z)
    ? d.x > 0
      ? "东侧"
      : "西侧"
    : d.z > 0
      ? "南侧"
      : "北侧";
const stages = ["green", "yellow", "all-red"] as const;

/** Simulation-time clocks and signal admission, independent of vehicles, DOM and rendering. */
export class TrafficLightController {
  private clocks = new Map<string, Clock>();
  private movements = new Map<
    string,
    { clock: Clock; movement: SignalMovement }
  >();
  statistics = { transitions: 0, yellowPassages: 0, clearanceExtensions: 0 };
  get enabled() {
    return this.clocks.size > 0;
  }
  clear() {
    this.clocks.clear();
    this.movements.clear();
    this.statistics = {
      transitions: 0,
      yellowPassages: 0,
      clearanceExtensions: 0,
    };
  }
  configure(
    junctions: readonly Junction[],
    configs: TrafficSignal[] | undefined,
    movements: readonly SignalMovement[],
  ) {
    this.clear();
    for (const [junctionIndex, junction] of junctions.entries()) {
      const config = signalForJunction(configs, junction);
      if (!config || junction.arms.length < 3) continue;
      const links = movements.filter((m) => m.junction === junction.id);
      const arms = junction.arms
        .filter((a) => links.some((m) => m.road === a.road && m.end === a.end))
        .sort(
          (a, b) =>
            Math.atan2(a.direction.z, a.direction.x) -
            Math.atan2(b.direction.z, b.direction.x),
        );
      const phases: SignalPhase[] = [];
      const append = (
        name: string,
        selected: typeof arms,
        turns: Turn[],
        duration: number,
      ) => {
        const keys = selected.map(signalArmKey);
        const ids = new Set(
          links
            .filter(
              (m) => keys.includes(signalArmKey(m)) && turns.includes(m.turn),
            )
            .map((m) => m.id),
        );
        if (ids.size)
          phases.push({ name, duration, arms: keys, turns, movements: ids });
      };
      let source: Clock["source"];
      if (config.mode === "custom") {
        validateSignalProgram(config.program);
        const resolved = resolveSignalApproaches(config.program, junction);
        for (const phase of config.program.phases) {
          const ids = new Set(
            links
              .filter((movement) =>
                phase.movements.some((permission) => {
                  const arm = resolved.get(permission.approach);
                  return (
                    arm &&
                    signalArmKey(arm) === signalArmKey(movement) &&
                    permission.turn === movement.turn
                  );
                }),
              )
              .map((movement) => movement.id),
          );
          const selected = links.filter((movement) => ids.has(movement.id));
          phases.push({
            name: phase.name,
            duration: phase.duration,
            arms: [...new Set(selected.map(signalArmKey))],
            turns: [...new Set(selected.map((movement) => movement.turn))],
            movements: ids,
          });
        }
      } else if (config.mode === "cs2") {
        const groups = buildCs2SignalGroups(
          links.map((movement) => {
            const arm = arms.find(
              (a) => a.road === movement.road && a.end === movement.end,
            )!;
            return {
              id: movement.id,
              startDirection: movement.startDirection ?? {
                x: -arm.direction.x,
                z: -arm.direction.z,
              },
              // Simulation supplies exact curve tangents. The fallback serves
              // older standalone controller clients without curve geometry.
              endDirection: movement.endDirection ?? arm.direction,
              straight: movement.sourceStraight ?? movement.turn === "straight",
              car: true,
            };
          }),
        );
        source = {
          clock: {
            state: Cs2TrafficLightState.None,
            current: 0,
            next: 0,
            groupCount: groups.groupCount,
            timer: 0,
            flags: 0,
          },
          lanes: new Map(
            [...groups.laneSignals].map(([id, lane]) => [
              id,
              {
                groupMask: lane.groupMask,
                signal: Cs2LaneSignal.None,
                flags: lane.canExtend ? CS2_SIGNAL_CAN_EXTEND : 0,
                priority: lane.defaultPriority,
                defaultPriority: lane.defaultPriority,
                petitioner: null,
                blocker: null,
              },
            ]),
          ),
          heads: new Map(),
          elapsed: 0,
          nextTick: (junctionIndex & 15) * (4 / 60),
        };
        for (let group = 1; group <= groups.groupCount; group++) {
          const movements = new Set(
            [...source.lanes]
              .filter(([, lane]) => lane.groupMask & (1 << (group - 1)))
              .map(([id]) => id),
          );
          const selected = links.filter((m) => movements.has(m.id));
          const keys = [...new Set(selected.map(signalArmKey))];
          const names = arms
            .filter((a) => keys.includes(signalArmKey(a)))
            .map((a) => sideName(a.direction));
          phases.push({
            name: names.length ? `${names.join("／")}通行` : "预留信号组",
            duration: 6 * CS2_SIGNAL_TICK,
            arms: keys,
            turns: [...new Set(selected.map((m) => m.turn))],
            movements,
          });
        }
      } else if (config.mode === "sequential") {
        for (const arm of arms)
          append(
            `${sideName(arm.direction)}进口`,
            [arm],
            ["left", "straight", "right"],
            config.green,
          );
      } else {
        const groups: (typeof arms)[] = [];
        for (const arm of arms) {
          const group = groups.find(
            (group) =>
              Math.abs(
                group[0].direction.x * arm.direction.x +
                  group[0].direction.z * arm.direction.z,
              ) > 0.94,
          );
          if (group) group.push(arm);
          else groups.push([arm]);
        }
        for (const group of groups) {
          const name = group.map((a) => sideName(a.direction)).join("／");
          append(`${name}直行`, group, ["straight", "right"], config.green);
          append(`${name}左转`, group, ["left"], config.leftGreen);
        }
      }
      if (!phases.length) continue;
      const clock: Clock = {
        config,
        junction: junction.id,
        phases,
        phase: 0,
        stage: source ? "all-red" : "green",
        elapsed: 0,
        clearing: false,
        yellowPasses: new Set(),
        source,
      };
      this.clocks.set(junction.id, clock);
      for (const movement of links)
        this.movements.set(movement.id, { clock, movement });
      const cycle = phases.reduce(
        (n, p) => n + p.duration + config.yellow + config.allRed,
        0,
      );
      if (!source) this.advance(clock, config.offset % cycle, false);
    }
  }
  has(junction: string | undefined) {
    return !!junction && this.clocks.has(junction);
  }
  private duration(clock: Clock) {
    if (clock.source) {
      const ticks = [1, 1, 6, 2, 1, 2, 4];
      return ticks[clock.source.clock.state] * CS2_SIGNAL_TICK;
    }
    return clock.stage === "green"
      ? clock.phases[clock.phase].duration
      : clock.stage === "yellow"
        ? clock.config.yellow
        : clock.config.allRed;
  }
  private advance(clock: Clock, dt: number, occupied: boolean) {
    for (let guard = 0; guard < 10000; guard++) {
      const remaining = Math.max(0, this.duration(clock) - clock.elapsed);
      if (dt < remaining - 1e-9) {
        clock.elapsed += dt;
        return;
      }
      dt = Math.max(0, dt - remaining);
      if (clock.stage === "all-red" && occupied) {
        if (!clock.clearing) this.statistics.clearanceExtensions++;
        clock.elapsed = this.duration(clock);
        clock.clearing = true;
        return;
      }
      clock.clearing = false;
      clock.elapsed = 0;
      if (clock.stage === "all-red") {
        clock.phase = (clock.phase + 1) % clock.phases.length;
        clock.stage = "green";
        clock.yellowPasses.clear();
      } else clock.stage = stages[stages.indexOf(clock.stage) + 1];
      this.statistics.transitions++;
      if (dt < 1e-9) return;
    }
  }
  update(dt: number, occupied: ReadonlySet<string> = new Set()) {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (const clock of this.clocks.values()) {
      if (!clock.source) {
        this.advance(clock, dt, occupied.has(clock.junction));
        continue;
      }
      const source = clock.source;
      source.elapsed += dt;
      while (source.elapsed + 1e-9 >= source.nextTick) {
        const lanes = [...source.lanes.values()];
        if (tickCs2TrafficLights(source.clock, lanes)) {
          for (const [id, lane] of source.lanes) {
            lane.signal = updateCs2LaneSignal(source.clock, lane);
            source.heads.set(
              id,
              updateCs2SignalHeads(
                source.clock,
                lane.groupMask,
                0,
                source.heads.get(id) ?? 0,
              ),
            );
          }
          this.statistics.transitions++;
        }
        source.nextTick += CS2_SIGNAL_TICK;
      }
      clock.phase = Math.max(
        0,
        (source.clock.current || source.clock.next || 1) - 1,
      );
      clock.stage =
        source.clock.state === Cs2TrafficLightState.Ongoing ||
        source.clock.state === Cs2TrafficLightState.Extending ||
        source.clock.state === Cs2TrafficLightState.Extended
          ? "green"
          : source.clock.state === Cs2TrafficLightState.Ending ||
              source.clock.state === Cs2TrafficLightState.Beginning
            ? "yellow"
            : "all-red";
      clock.elapsed = source.clock.timer * CS2_SIGNAL_TICK;
    }
  }
  petition(movementId: string, vehicleId: number, priority = 100) {
    const lane = this.movements
      .get(movementId)
      ?.clock.source?.lanes.get(movementId);
    if (lane && priority > lane.priority) {
      lane.priority = priority;
      lane.petitioner = vehicleId;
    }
  }
  laneSignal(movementId: string): Cs2LaneSignal {
    const entry = this.movements.get(movementId);
    if (!entry) return Cs2LaneSignal.None;
    const lane = entry.clock.source?.lanes.get(movementId);
    if (lane) return lane.signal;
    if (!entry.clock.phases[entry.clock.phase].movements.has(movementId))
      return Cs2LaneSignal.Stop;
    return entry.clock.stage === "green"
      ? Cs2LaneSignal.Go
      : entry.clock.stage === "yellow"
        ? Cs2LaneSignal.SafeStop
        : Cs2LaneSignal.Stop;
  }
  allows(
    movementId: string,
    vehicleId: number,
    distance: number,
    speed: number,
    braking = 2.5,
  ) {
    const entry = this.movements.get(movementId);
    if (!entry) return true;
    const { clock } = entry;
    if (clock.source) {
      const signal = this.laneSignal(movementId);
      if (signal === Cs2LaneSignal.Stop || signal === Cs2LaneSignal.SafeStop) {
        const stopping = (speed * speed) / (2 * Math.max(0.001, braking));
        return stopping > distance + (signal === Cs2LaneSignal.Stop ? 1 : 0);
      }
      return true;
    }
    if (
      !clock.phases[clock.phase].movements.has(movementId) ||
      clock.stage === "all-red"
    )
      return false;
    if (clock.stage === "green") return true;
    if (clock.yellowPasses.has(vehicleId)) return true;
    const remaining = Math.max(0, clock.config.yellow - clock.elapsed);
    const stopping =
      (speed * speed) / (2 * Math.max(0.5, braking)) + speed * 0.35;
    if (
      speed > 1 &&
      distance <= stopping &&
      Math.max(0, distance) / speed <= remaining + 0.05
    ) {
      clock.yellowPasses.add(vehicleId);
      this.statistics.yellowPassages++;
      return true;
    }
    return false;
  }
  armColor(junction: string, arm: string, turn: Turn): LightColor {
    const clock = this.clocks.get(junction);
    if (clock?.source) {
      let yellow = false;
      for (const [id, value] of clock.source.heads) {
        const movement = this.movements.get(id)?.movement;
        if (
          !movement ||
          signalArmKey(movement) !== arm ||
          movement.turn !== turn
        )
          continue;
        if (value & 4) return "green";
        if (value & 2) yellow = true;
      }
      return yellow ? "yellow" : "red";
    }
    if (!clock || clock.stage === "all-red") return "red";
    const phase = clock.phases[clock.phase];
    return [...phase.movements].some((id) => {
      const movement = this.movements.get(id)?.movement;
      return (
        movement && signalArmKey(movement) === arm && movement.turn === turn
      );
    })
      ? clock.stage
      : "red";
  }
  state(junction: string): SignalState | undefined {
    const clock = this.clocks.get(junction);
    if (!clock) return;
    return {
      id: clock.config.id,
      junction,
      phase: clock.phase,
      name: clock.phases[clock.phase].name,
      stage: clock.stage,
      remaining: Math.max(0, this.duration(clock) - clock.elapsed),
      clearing: clock.clearing,
      phases: clock.phases,
      cycle: clock.source
        ? 0
        : clock.phases.reduce(
            (n, p) =>
              n + p.duration + clock.config.yellow + clock.config.allRed,
            0,
          ),
      actuated: !!clock.source,
      sourceState: clock.source?.clock.state,
    };
  }
  get states() {
    return [...this.clocks.keys()].map((id) => this.state(id)!);
  }
}
