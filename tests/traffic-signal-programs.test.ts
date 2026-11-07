import { describe, expect, it } from "vitest";
import type { Junction } from "../src/core/junctions";
import { buildJunctions } from "../src/core/junctions";
import { emptyProject, makeRoad, parseProject } from "../src/core/model";
import { v } from "../src/core/math";
import type { Turn } from "../src/core/types";
import {
  cloneTrafficSignals,
  makeTrafficSignal,
  signalArmKey,
} from "../src/core/traffic-signals";
import {
  adaptSignalProgram,
  clearSignalPresets,
  createDefaultSignalProgram,
  loadSignalPresets,
  makeSignalPreset,
  parseSignalPreset,
  removeSignalPreset,
  resolveSignalApproaches,
  serializeSignalPreset,
  signalApproaches,
  storeSignalPreset,
  validateSignalProgram,
  type SignalPresetStorage,
} from "../src/core/traffic-signal-programs";
import {
  TrafficLightController,
  type SignalMovement,
} from "../src/simulation/traffic-lights";
import { Cs2LaneSignal } from "../src/simulation/cs2-junctions";

function junction(
  prefix = "road",
  bearings = [0, Math.PI / 2, Math.PI, Math.PI * 1.5],
): Junction {
  return {
    id: `junction-${prefix}`,
    position: v(),
    radius: 10,
    crosswalks: true,
    polygon: [],
    arms: bearings.map((bearing, index) => ({
      road: `${prefix}-${index}`,
      end: 1,
      direction: { x: Math.sin(bearing), y: 0, z: -Math.cos(bearing) },
      halfWidth: 4,
      trim: 10,
      t: 1,
    })),
  };
}
function setup(j = junction()) {
  const config = makeTrafficSignal(j);
  const movements: SignalMovement[] = j.arms.flatMap((arm) =>
    (["straight", "left", "right"] as Turn[]).map((turn) => ({
      id: `${signalArmKey(arm)}:${turn}`,
      junction: j.id,
      road: arm.road,
      end: arm.end,
      turn,
    })),
  );
  const lights = new TrafficLightController();
  lights.configure([j], [config], movements);
  return { j, config, movements, lights };
}
function storage(
  initial: string | null = null,
): SignalPresetStorage & { value: string | null; writes: number } {
  return {
    value: initial,
    writes: 0,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
      this.writes++;
    },
  };
}
const timings = { yellow: 3, allRed: 2, offset: 0 };

describe("portable signal phase programs", () => {
  it("makes the requested four-stage default and supplies exact per-turn vehicle signals", () => {
    const { j, config, movements, lights } = setup();
    expect(config.mode).toBe("custom");
    expect(config.program!.phases.map((p) => p.duration)).toEqual([
      20, 8, 20, 8,
    ]);
    expect(lights.state(j.id)!.cycle).toBe(76);
    const directions = new Map(
      signalApproaches(j).map((a) => [signalArmKey(a.arm), a.id]),
    );
    for (let phase = 0; phase < 4; phase++) {
      expect(lights.state(j.id)!.phase).toBe(phase);
      for (const movement of movements) {
        const direction = directions.get(signalArmKey(movement)),
          horizontal = direction === "east" || direction === "west";
        const expected =
          movement.turn === "right" ||
          (horizontal === phase < 2 &&
            movement.turn === (phase % 2 === 0 ? "straight" : "left"));
        expect(
          lights.allows(movement.id, 1, 100, 0),
          `${phase}/${direction}/${movement.turn}`,
        ).toBe(expected);
        expect(lights.laneSignal(movement.id)).toBe(
          expected ? Cs2LaneSignal.Go : Cs2LaneSignal.Stop,
        );
        expect(
          lights.armColor(j.id, signalArmKey(movement), movement.turn),
        ).toBe(expected ? "green" : "red");
      }
      lights.update(config.program!.phases[phase].duration);
      expect(lights.state(j.id)!.stage).toBe("yellow");
      lights.update(config.yellow);
      expect(
        movements.every((m) => lights.laneSignal(m.id) === Cs2LaneSignal.Stop),
      ).toBe(true);
      lights.update(config.allRed);
    }
    expect(lights.state(j.id)!.phase).toBe(0);
  });
  it("does not display a Cartesian-product green for north/south left during east/west left + all rights", () => {
    const { j, config, lights } = setup();
    lights.update(20 + config.yellow + config.allRed);
    const north = signalApproaches(j).find((a) => a.id === "north")!,
      east = signalApproaches(j).find((a) => a.id === "east")!;
    expect(lights.armColor(j.id, signalArmKey(north.arm), "left")).toBe("red");
    expect(lights.armColor(j.id, signalArmKey(north.arm), "right")).toBe(
      "green",
    );
    expect(lights.armColor(j.id, signalArmKey(east.arm), "left")).toBe("green");
    expect(lights.armColor(j.id, signalArmKey(east.arm), "straight")).toBe(
      "red",
    );
  });
  it("keeps an explicitly empty phase and its own duration rather than silently dropping it", () => {
    const { j, config, movements, lights } = setup();
    config.program!.phases = [
      { id: "empty", name: "清空等待", duration: 7.5, movements: [] },
      config.program!.phases[0],
    ];
    lights.configure([j], [config], movements);
    expect(lights.state(j.id)!.phases).toHaveLength(2);
    expect(lights.state(j.id)!.remaining).toBe(7.5);
    expect(movements.every((m) => !lights.allows(m.id, 1, 0, 0))).toBe(true);
    lights.update(7.5 + config.yellow + config.allRed);
    expect(lights.state(j.id)!.phase).toBe(1);
  });
  it("uses exact custom duration, phase order and stable yellow/all-red clearance", () => {
    const { j, config, movements, lights } = setup();
    const phases = config.program!.phases;
    config.program!.phases = [
      { ...phases[3], name: "先放南北左转", duration: 11 },
      { ...phases[0], duration: 9 },
    ];
    lights.configure([j], [config], movements);
    expect(lights.state(j.id)!.name).toBe("先放南北左转");
    lights.update(10.5);
    expect(lights.state(j.id)!.remaining).toBe(0.5);
    lights.update(0.5 + config.yellow + config.allRed + 30, new Set([j.id]));
    expect(lights.state(j.id)).toMatchObject({
      phase: 0,
      stage: "all-red",
      clearing: true,
    });
    lights.update(0.025);
    expect(lights.state(j.id)).toMatchObject({
      phase: 1,
      stage: "green",
      remaining: 8.975,
      clearing: false,
    });
  });
  it("uses equivalent phase timing for small and large steps with a custom startup offset", () => {
    const { j, config, movements } = setup();
    config.offset = 29;
    const a = new TrafficLightController(),
      b = new TrafficLightController();
    a.configure([j], [config], movements);
    b.configure([j], [config], movements);
    a.update(100);
    for (let i = 0; i < 4000; i++) b.update(0.025);
    expect(a.state(j.id)!.phase).toBe(b.state(j.id)!.phase);
    expect(a.state(j.id)!.stage).toBe(b.state(j.id)!.stage);
    expect(a.state(j.id)!.remaining).toBeCloseTo(b.state(j.id)!.remaining, 7);
  });
  it("imports an edited program onto unrelated road IDs without mutating the saved preset", () => {
    const original = junction("source"),
      target = junction("target"),
      program = createDefaultSignalProgram(original);
    program.phases[1].duration = 13;
    program.phases[1].movements = [
      { approach: "north", turn: "left" },
      { approach: "west", turn: "right" },
    ];
    const preset = makeSignalPreset("测试方案", program, timings),
      before = structuredClone(preset),
      adapted = adaptSignalProgram(preset.program, target),
      resolved = resolveSignalApproaches(adapted, target);
    expect(adapted.phases[1].duration).toBe(13);
    expect(adapted.phases[1].movements).toEqual(program.phases[1].movements);
    expect(
      [...resolved.values()].every((a) => a.road.startsWith("target-")),
    ).toBe(true);
    expect(preset).toEqual(before);
    expect(serializeSignalPreset(preset)).not.toContain("source-");
  });
  it("preserves missing cardinal directions as red and maps a plan safely to a three-way junction", () => {
    const source = junction(),
      target = junction("three", [0, Math.PI / 2, Math.PI]);
    const adapted = adaptSignalProgram(
      createDefaultSignalProgram(source),
      target,
    );
    expect(adapted.approaches.map((a) => a.id)).toEqual([
      "north",
      "east",
      "south",
    ]);
    expect(
      adapted.phases.every((p) =>
        p.movements.every((m) => m.approach !== "west"),
      ),
    ).toBe(true);
    expect(adapted.phases).toHaveLength(4);
    expect(() => validateSignalProgram(adapted)).not.toThrow();
  });
  it("assigns unique, stable cardinal ports on a skew cross junction", () => {
    const j = junction("skew", [0.3, 1.9, 3.2, 4.3]);
    const approaches = signalApproaches(j);
    expect(new Set(approaches.map((a) => a.id)).size).toBe(4);
    expect(
      new Set(
        resolveSignalApproaches(createDefaultSignalProgram(j), j).values(),
      ).size,
    ).toBe(4);
  });
  it("can map a four-way preset to a larger junction without binding two ports to one arm", () => {
    const target = junction("five", [0, 1.2, 2.4, 3.6, 4.8]),
      adapted = adaptSignalProgram(
        createDefaultSignalProgram(junction()),
        target,
      ),
      resolved = resolveSignalApproaches(adapted, target);
    expect(adapted.approaches).toHaveLength(5);
    expect(adapted.phases[0].movements.length).toBeGreaterThan(0);
    expect(new Set(resolved.values()).size).toBe(5);
  });
  it("persists custom matrix and per-phase times with the map and keeps old modes unchanged", () => {
    const p = emptyProject(),
      options = {
        lanesStart: 2,
        lanesEnd: 2,
        twoWay: true,
        width: 3.5,
        speed: 50,
      };
    p.roads = [
      makeRoad(v(-80, 0), v(), options),
      makeRoad(v(0, -80), v(), options),
      makeRoad(v(), v(80, 0), options),
      makeRoad(v(), v(0, 80), options),
    ];
    p.signals = [makeTrafficSignal(buildJunctions(p)[0])];
    p.signals[0].program!.phases[2].duration = 31;
    const restored = parseProject(JSON.stringify(p));
    expect(restored.signals![0].program).toEqual(p.signals[0].program);
    const ids = new Map(
      p.roads.map((road, index) => [road.id, `copy-${index}`]),
    );
    const cloned = cloneTrafficSignals(p.signals, ids);
    expect(cloned[0].program).toEqual(p.signals[0].program);
    cloned[0].program!.phases[0].duration = 77;
    expect(p.signals[0].program!.phases[0].duration).toBe(20);
    p.signals[0].mode = "cs2";
    delete p.signals[0].program;
    expect(parseProject(JSON.stringify(p)).signals![0].mode).toBe("cs2");
    p.signals[0].mode = "custom";
    expect(() => parseProject(JSON.stringify(p))).toThrow(/红绿灯/);
  });
});

describe("saved portable signal presets", () => {
  const preset = () =>
    makeSignalPreset(
      "四相位方案",
      createDefaultSignalProgram(junction()),
      timings,
    );
  it("round-trips a named JSON scheme and validates its directional matrix", () => {
    const original = preset();
    expect(parseSignalPreset(serializeSignalPreset(original))).toEqual(
      original,
    );
  });
  it("keeps saved copies independent and replaces the same name without accumulating duplicates", () => {
    const local = storage(),
      p = preset();
    storeSignalPreset(p, local);
    p.program.phases[0].duration = 99;
    expect(loadSignalPresets(local).presets[0].program.phases[0].duration).toBe(
      20,
    );
    const replacement = preset();
    replacement.program.phases[0].duration = 17;
    storeSignalPreset(replacement, local);
    expect(loadSignalPresets(local).presets).toHaveLength(1);
    expect(loadSignalPresets(local).presets[0].program.phases[0].duration).toBe(
      17,
    );
    removeSignalPreset(replacement.id, local);
    expect(loadSignalPresets(local).presets).toHaveLength(0);
  });
  it("does not overwrite corrupt saved data and supports explicit recovery", () => {
    const local = storage("{broken");
    expect(loadSignalPresets(local).error).toBeTruthy();
    expect(() => storeSignalPreset(preset(), local)).toThrow(/方案库/);
    expect(local.value).toBe("{broken");
    expect(local.writes).toBe(0);
    clearSignalPresets(local);
    storeSignalPreset(preset(), local);
    expect(loadSignalPresets(local).presets).toHaveLength(1);
  });
  it("reports storage failures without claiming a save", () => {
    const local = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => storeSignalPreset(preset(), local)).toThrow(/保存失败/);
  });
  it("bounds the preset library and supports deleting before adding another", () => {
    const local = storage();
    for (let i = 0; i < 24; i++) {
      const p = preset();
      p.name = `方案 ${i}`;
      storeSignalPreset(p, local);
    }
    const extra = preset();
    extra.name = "额外方案";
    expect(() => storeSignalPreset(extra, local)).toThrow(/24/);
    removeSignalPreset(loadSignalPresets(local).presets[0].id, local);
    expect(() => storeSignalPreset(extra, local)).not.toThrow();
    expect(loadSignalPresets(local).presets).toHaveLength(24);
  });
  it.each([
    "",
    " ",
    "{invalid",
    "null",
    "[]",
    JSON.stringify({ version: 2 }),
    "x".repeat(512001),
  ])("rejects malformed/empty/oversized imported JSON: %s", (json) => {
    expect(() => parseSignalPreset(json)).toThrow();
  });
  it.each([
    "duration",
    "duplicate-phase",
    "duplicate-permission",
    "missing-approach",
    "bad-turn",
    "duplicate-direction",
    "nan",
    "yellow",
    "empty-name",
  ])("rejects invalid %s before applying a preset", (fault) => {
    const p = preset();
    switch (fault) {
      case "duration":
        p.program.phases[0].duration = 0;
        break;
      case "duplicate-phase":
        p.program.phases[1].id = p.program.phases[0].id;
        break;
      case "duplicate-permission":
        p.program.phases[0].movements.push({
          ...p.program.phases[0].movements[0],
        });
        break;
      case "missing-approach":
        p.program.phases[0].movements[0].approach = "not-present";
        break;
      case "bad-turn":
        (p.program.phases[0].movements[0] as any).turn = "u-turn";
        break;
      case "duplicate-direction":
        p.program.approaches[1].id = p.program.approaches[0].id;
        break;
      case "nan":
        p.program.phases[0].duration = NaN;
        break;
      case "yellow":
        p.yellow = 0;
        break;
      case "empty-name":
        p.name = " ";
        break;
    }
    expect(() => parseSignalPreset(JSON.stringify(p))).toThrow();
  });
});
