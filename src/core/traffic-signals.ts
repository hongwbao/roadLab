import { buildJunctions, type Junction, type Arm } from "./junctions";
import { dist } from "./math";
import { copy, uid, type Project, type V } from "./types";
import {
  createDefaultSignalProgram,
  validateSignalProgram,
  type SignalProgram,
} from "./traffic-signal-programs";
export type SignalArm = { road: string; end: 0 | 1 };
export type TrafficSignal = {
  id: string;
  position: V;
  arms: SignalArm[];
  mode: "cs2" | "protected" | "sequential" | "custom";
  program?: SignalProgram;
  green: number;
  leftGreen: number;
  yellow: number;
  allRed: number;
  offset: number;
};
export const SIGNAL_STOP_OFFSET = 4.5;
/** Keep one metre between the zebra's outer edge and the stop line. */
export const signalStopOffset = (
  arm: Pick<Arm, "trim" | "crosswalkDistance">,
) =>
  Math.max(
    SIGNAL_STOP_OFFSET,
    (arm.crosswalkDistance ?? arm.trim + 2) + 2.5 - arm.trim,
  );
export const signalArmKey = (arm: SignalArm) => `${arm.road}:${arm.end}`;
export function signalMatches(signal: TrafficSignal, junction: Junction) {
  return junction.arms.filter((a) =>
    signal.arms.some((b) => b.road === a.road && b.end === a.end),
  ).length;
}
export function signalForJunction(
  signals: readonly TrafficSignal[] | undefined,
  junction: Junction,
) {
  return signals?.find((signal) => signalMatches(signal, junction) >= 2);
}
export function makeTrafficSignal(junction: Junction): TrafficSignal {
  return {
    id: uid("signal"),
    position: copy(junction.position),
    arms: junction.arms.map(({ road, end }) => ({ road, end })),
    mode: junction.arms.length === 4 ? "custom" : "cs2",
    ...(junction.arms.length === 4
      ? { program: createDefaultSignalProgram(junction) }
      : {}),
    green: 20,
    leftGreen: 8,
    yellow: 3,
    allRed: 2,
    offset: 0,
  };
}
export function normalizeTrafficSignals(project: Project) {
  if (!project.signals?.length) return;
  const junctions = buildJunctions(project).filter((j) => j.arms.length >= 3),
    used = new Set<string>();
  project.signals = project.signals.filter((signal) => {
    const junction = junctions
      .filter((j) => !used.has(j.id) && signalMatches(signal, j) >= 2)
      .sort(
        (a, b) =>
          signalMatches(signal, b) - signalMatches(signal, a) ||
          dist(a.position, signal.position) - dist(b.position, signal.position),
      )[0];
    if (!junction) return false;
    used.add(junction.id);
    signal.position = copy(junction.position);
    signal.arms = junction.arms.map(({ road, end }) => ({ road, end }));
    return true;
  });
}
export function cloneTrafficSignals(
  signals: readonly TrafficSignal[] | undefined,
  ids: ReadonlyMap<string, string>,
) {
  return (signals ?? [])
    .filter((signal) => signal.arms.every((arm) => ids.has(arm.road)))
    .map((signal) => ({
      ...copy(signal),
      id: uid("signal"),
      arms: signal.arms.map((arm) => ({ ...arm, road: ids.get(arm.road)! })),
    }));
}
export function validateTrafficSignals(project: Project) {
  if (project.signals === undefined) return;
  if (!Array.isArray(project.signals) || project.signals.length > 500)
    throw new Error("红绿灯配置格式不正确。");
  const ids = new Set<string>(),
    arms = new Set<string>();
  for (const signal of project.signals) {
    if (
      !signal ||
      typeof signal.id !== "string" ||
      !/^[a-zA-Z0-9_.:-]{1,120}$/.test(signal.id) ||
      ids.has(signal.id) ||
      !signal.position ||
      ![signal.position.x, signal.position.y, signal.position.z].every(
        (n) => Number.isFinite(n) && Math.abs(n) < 100000,
      ) ||
      !["cs2", "protected", "sequential", "custom"].includes(signal.mode) ||
      !Array.isArray(signal.arms) ||
      signal.arms.length < 3 ||
      signal.arms.length > 100 ||
      !Number.isFinite(signal.green) ||
      signal.green < 5 ||
      signal.green > 120 ||
      !Number.isFinite(signal.leftGreen) ||
      signal.leftGreen < 3 ||
      signal.leftGreen > 60 ||
      !Number.isFinite(signal.yellow) ||
      signal.yellow < 1 ||
      signal.yellow > 8 ||
      !Number.isFinite(signal.allRed) ||
      signal.allRed < 1 ||
      signal.allRed > 10 ||
      !Number.isFinite(signal.offset) ||
      signal.offset < 0 ||
      signal.offset > 600
    )
      throw new Error("红绿灯配时不合法。");
    if (signal.mode === "custom" || signal.program !== undefined)
      validateSignalProgram(signal.program);
    ids.add(signal.id);
    for (const arm of signal.arms) {
      if (
        !arm ||
        ![0, 1].includes(arm.end) ||
        !project.roads.some((r) => r.id === arm.road) ||
        arms.has(signalArmKey(arm))
      )
        throw new Error("红绿灯道路引用不合法。");
      arms.add(signalArmKey(arm));
    }
  }
}
