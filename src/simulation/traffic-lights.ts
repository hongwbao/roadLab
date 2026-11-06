import type { Junction } from "../core/junctions";
import {
  signalArmKey,
  signalForJunction,
  type TrafficSignal,
} from "../core/traffic-signals";
import type { Turn, V } from "../core/types";

export type LightColor = "red" | "yellow" | "green";
export type SignalMovement = {
  id: string;
  junction: string;
  road: string;
  end: 0 | 1;
  turn: Turn;
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
    for (const junction of junctions) {
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
      if (config.mode === "sequential") {
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
        stage: "green",
        elapsed: 0,
        clearing: false,
        yellowPasses: new Set(),
      };
      this.clocks.set(junction.id, clock);
      for (const movement of links)
        this.movements.set(movement.id, { clock, movement });
      const cycle = phases.reduce(
        (n, p) => n + p.duration + config.yellow + config.allRed,
        0,
      );
      this.advance(clock, config.offset % cycle, false);
    }
  }
  has(junction: string | undefined) {
    return !!junction && this.clocks.has(junction);
  }
  private duration(clock: Clock) {
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
    for (const clock of this.clocks.values())
      this.advance(clock, dt, occupied.has(clock.junction));
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
    if (!clock || clock.stage === "all-red") return "red";
    const phase = clock.phases[clock.phase];
    return phase.arms.includes(arm) && phase.turns.includes(turn)
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
      cycle: clock.phases.reduce(
        (n, p) => n + p.duration + clock.config.yellow + clock.config.allRed,
        0,
      ),
    };
  }
  get states() {
    return [...this.clocks.keys()].map((id) => this.state(id)!);
  }
}
