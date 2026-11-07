import type { Arm, Junction } from "./junctions";
import { copy, uid, type Turn } from "./types";

/** Portable approaches use map bearings, never a particular road's entity ID. */
export type SignalApproach = { id: string; name: string; bearing: number };
export type SignalPermission = { approach: string; turn: Turn };
export type CustomSignalPhase = {
  id: string;
  name: string;
  duration: number;
  movements: SignalPermission[];
};
export type SignalProgram = {
  version: 1;
  approaches: SignalApproach[];
  phases: CustomSignalPhase[];
};
export type SignalPreset = {
  version: 1;
  id: string;
  name: string;
  program: SignalProgram;
  yellow: number;
  allRed: number;
  offset: number;
};
export type SignalPresetStorage = Pick<Storage, "getItem" | "setItem">;
export const SIGNAL_PRESETS_KEY = "roadlab.signal-presets.v1";
export const SIGNAL_DIRECTIONS = ["north", "east", "south", "west"] as const;
export const SIGNAL_TURNS: readonly Turn[] = ["straight", "left", "right"];
export const SIGNAL_TURN_NAMES: Record<Turn, string> = {
  straight: "直行",
  left: "左转",
  right: "右转",
};
const directionNames = ["北侧", "东侧", "南侧", "西侧"];
const circle = Math.PI * 2;
const angleDistance = (a: number, b: number) =>
  Math.abs(((a - b + Math.PI * 3) % circle) - Math.PI);
const bearing = (arm: Arm) =>
  (Math.atan2(arm.direction.x, -arm.direction.z) + circle) % circle;
const key = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value);
const name = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const numeric = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

/** Unique cardinal assignment avoids mapping two approaches to the same direction on skew junctions. */
export function signalApproaches(
  junction: Junction,
): (SignalApproach & { arm: Arm })[] {
  const arms = [...junction.arms].sort((a, b) => bearing(a) - bearing(b));
  let assignment: number[] = [];
  if (arms.length <= 4) {
    let best = Infinity;
    const visit = (picked: number[], cost: number) => {
      if (picked.length === arms.length) {
        if (cost < best) {
          best = cost;
          assignment = [...picked];
        }
        return;
      }
      for (let i = 0; i < 4; i++)
        if (!picked.includes(i))
          visit(
            [...picked, i],
            cost +
              angleDistance(bearing(arms[picked.length]), (i * Math.PI) / 2) **
                2,
          );
    };
    visit([], 0);
  }
  return arms
    .map((arm, i) => ({
      id: arms.length <= 4 ? SIGNAL_DIRECTIONS[assignment[i]] : `approach-${i}`,
      name:
        arms.length <= 4
          ? directionNames[assignment[i]]
          : `${directionNames[Math.round(bearing(arm) / (Math.PI / 2)) % 4]}进口 ${i + 1}`,
      bearing: bearing(arm),
      arm,
    }))
    .sort((a, b) =>
      SIGNAL_DIRECTIONS.includes(a.id as (typeof SIGNAL_DIRECTIONS)[number]) &&
      SIGNAL_DIRECTIONS.includes(b.id as (typeof SIGNAL_DIRECTIONS)[number])
        ? SIGNAL_DIRECTIONS.indexOf(
            a.id as (typeof SIGNAL_DIRECTIONS)[number],
          ) -
          SIGNAL_DIRECTIONS.indexOf(b.id as (typeof SIGNAL_DIRECTIONS)[number])
        : a.bearing - b.bearing,
    );
}

export function createDefaultSignalProgram(
  junction: Junction,
  green = 20,
  leftGreen = 8,
): SignalProgram {
  const approaches = signalApproaches(junction).map(
    ({ arm: _arm, ...approach }) => approach,
  );
  const phases = [
    ["东西直行 + 四向右转", true, "straight", green],
    ["东西左转 + 四向右转", true, "left", leftGreen],
    ["南北直行 + 四向右转", false, "straight", green],
    ["南北左转 + 四向右转", false, "left", leftGreen],
  ] as const;
  return {
    version: 1,
    approaches,
    phases: phases.map(([phaseName, eastWest, turn, duration], index) => ({
      id: `phase-${index + 1}`,
      name: phaseName,
      duration,
      movements: approaches.flatMap((a) => {
        const horizontal =
          a.id === "east" ||
          a.id === "west" ||
          (!SIGNAL_DIRECTIONS.includes(
            a.id as (typeof SIGNAL_DIRECTIONS)[number],
          ) &&
            Math.abs(Math.sin(a.bearing)) > Math.abs(Math.cos(a.bearing)));
        return [
          { approach: a.id, turn: "right" as const },
          ...(horizontal === eastWest ? [{ approach: a.id, turn }] : []),
        ];
      }),
    })),
  };
}

export function validateSignalProgram(
  value: unknown,
): asserts value is SignalProgram {
  const program = value as SignalProgram;
  if (
    !program ||
    program.version !== 1 ||
    !Array.isArray(program.approaches) ||
    program.approaches.length < 3 ||
    program.approaches.length > 100 ||
    !Array.isArray(program.phases) ||
    program.phases.length < 1 ||
    program.phases.length > 16
  )
    throw new Error("红绿灯方案需要 1–16 个相位，并包含有效进口方向。");
  const approaches = new Set<string>(),
    phases = new Set<string>();
  for (const approach of program.approaches) {
    if (
      !approach ||
      !key(approach.id) ||
      approaches.has(approach.id) ||
      !name(approach.name, 40) ||
      !numeric(approach.bearing, 0, circle)
    )
      throw new Error("红绿灯方案的进口方向不合法。");
    approaches.add(approach.id);
  }
  for (const phase of program.phases) {
    if (
      !phase ||
      !key(phase.id) ||
      phases.has(phase.id) ||
      !name(phase.name, 60) ||
      !numeric(phase.duration, 1, 180) ||
      !Array.isArray(phase.movements) ||
      phase.movements.length > program.approaches.length * 3
    )
      throw new Error("红绿灯相位名称或时长不合法；绿灯应为 1–180 秒。");
    phases.add(phase.id);
    const permissions = new Set<string>();
    for (const movement of phase.movements) {
      const permission = movement && `${movement.approach}:${movement.turn}`;
      if (
        !movement ||
        !approaches.has(movement.approach) ||
        !SIGNAL_TURNS.includes(movement.turn) ||
        permissions.has(permission)
      )
        throw new Error("红绿灯相位的通行方向不合法或重复。");
      permissions.add(permission);
    }
  }
}

/** Match a portable plan onto the target junction; cardinal labels retain their meaning. */
export function resolveSignalApproaches(
  program: SignalProgram,
  junction: Junction,
): Map<string, Arm> {
  const targets = signalApproaches(junction),
    result = new Map<string, Arm>(),
    used = new Set<string>();
  for (const source of program.approaches) {
    const target = targets.find(
      (a) =>
        a.id === source.id &&
        SIGNAL_DIRECTIONS.includes(
          source.id as (typeof SIGNAL_DIRECTIONS)[number],
        ),
    );
    if (target) {
      result.set(source.id, target.arm);
      used.add(target.id);
    }
  }
  const pairs = program.approaches
    .filter(
      (a) =>
        !result.has(a.id) &&
        (targets.length > 4 ||
          !SIGNAL_DIRECTIONS.includes(
            a.id as (typeof SIGNAL_DIRECTIONS)[number],
          )),
    )
    .flatMap((source) =>
      targets
        .filter((target) => !used.has(target.id))
        .map((target) => ({
          source,
          target,
          distance: angleDistance(source.bearing, target.bearing),
        })),
    )
    .sort((a, b) => a.distance - b.distance);
  for (const { source, target } of pairs)
    if (!result.has(source.id) && !used.has(target.id)) {
      result.set(source.id, target.arm);
      used.add(target.id);
    }
  return result;
}
export function adaptSignalProgram(
  program: SignalProgram,
  junction: Junction,
): SignalProgram {
  validateSignalProgram(program);
  const resolved = resolveSignalApproaches(program, junction),
    targets = signalApproaches(junction),
    mapping = new Map(
      [...resolved].map(([id, arm]) => [
        id,
        targets.find((a) => a.arm === arm)!.id,
      ]),
    );
  const adapted: SignalProgram = {
    version: 1,
    approaches: targets.map(({ arm: _arm, ...a }) => a),
    phases: program.phases.map((phase) => ({
      ...copy(phase),
      movements: phase.movements
        .filter((m) => mapping.has(m.approach))
        .map((m) => ({ approach: mapping.get(m.approach)!, turn: m.turn })),
    })),
  };
  validateSignalProgram(adapted);
  return adapted;
}

export function validateSignalPreset(
  value: unknown,
): asserts value is SignalPreset {
  const preset = value as SignalPreset;
  if (
    !preset ||
    preset.version !== 1 ||
    !key(preset.id) ||
    !name(preset.name, 60) ||
    !numeric(preset.yellow, 1, 8) ||
    !numeric(preset.allRed, 1, 10) ||
    !numeric(preset.offset, 0, 600)
  )
    throw new Error("红绿灯方案文件格式或转换时间不合法。");
  validateSignalProgram(preset.program);
}
export function makeSignalPreset(
  presetName: string,
  program: SignalProgram,
  timings: { yellow: number; allRed: number; offset: number },
): SignalPreset {
  const preset: SignalPreset = {
    version: 1,
    id: uid("signal-preset"),
    name: presetName.trim(),
    program: copy(program),
    ...timings,
  };
  validateSignalPreset(preset);
  return preset;
}
export function parseSignalPreset(json: string): SignalPreset {
  if (!json.trim() || json.length > 512000)
    throw new Error("方案文件为空或超过 500 KB。");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("方案不是有效的 JSON 文件。");
  }
  validateSignalPreset(value);
  return copy(value);
}
export function serializeSignalPreset(preset: SignalPreset) {
  validateSignalPreset(preset);
  return JSON.stringify(preset, null, 2);
}
function browserStorage(): SignalPresetStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return;
  }
}
export function loadSignalPresets(
  storage: SignalPresetStorage | undefined = browserStorage(),
): { presets: SignalPreset[]; error?: string } {
  try {
    const json = storage?.getItem(SIGNAL_PRESETS_KEY);
    if (!json) return { presets: [] };
    if (json.length > 4000000) throw new Error("本机方案库超过大小限制。");
    const values: unknown = JSON.parse(json);
    if (!Array.isArray(values) || values.length > 24)
      throw new Error("本机方案库格式不正确。");
    for (const value of values) validateSignalPreset(value);
    if (new Set(values.map((value) => value.id)).size !== values.length)
      throw new Error("本机方案库存在重复方案。");
    return { presets: copy(values) };
  } catch {
    return {
      presets: [],
      error:
        "本机方案库无法读取。当前路口不受影响；可导入 JSON，或清空损坏方案库后重试。",
    };
  }
}
export function storeSignalPreset(
  preset: SignalPreset,
  storage: SignalPresetStorage | undefined = browserStorage(),
) {
  validateSignalPreset(preset);
  if (!storage) throw new Error("当前浏览器无法保存方案，请导出 JSON 备份。");
  const loaded = loadSignalPresets(storage);
  if (loaded.error) throw new Error(loaded.error);
  const presets = loaded.presets.filter(
    (value) => value.name !== preset.name && value.id !== preset.id,
  );
  if (presets.length >= 24)
    throw new Error("本机最多保存 24 个方案，请先删除不需要的方案。");
  presets.push(copy(preset));
  try {
    storage.setItem(SIGNAL_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    throw new Error(
      "方案保存失败，浏览器存储空间不足或不可用。请导出 JSON 备份。",
    );
  }
}
export function removeSignalPreset(
  id: string,
  storage: SignalPresetStorage | undefined = browserStorage(),
) {
  if (!storage) throw new Error("当前浏览器无法访问本机方案库。");
  const loaded = loadSignalPresets(storage);
  if (loaded.error) throw new Error(loaded.error);
  try {
    storage.setItem(
      SIGNAL_PRESETS_KEY,
      JSON.stringify(loaded.presets.filter((value) => value.id !== id)),
    );
  } catch {
    throw new Error("无法更新本机方案库，请重试或导出 JSON 备份。");
  }
}
export function clearSignalPresets(
  storage: SignalPresetStorage | undefined = browserStorage(),
) {
  if (!storage) throw new Error("当前浏览器无法访问本机方案库。");
  try {
    storage.setItem(SIGNAL_PRESETS_KEY, "[]");
  } catch {
    throw new Error("无法清空本机方案库，请检查浏览器存储权限。");
  }
}
