import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  selectCs2SignalGroup,
  tickCs2TrafficLights,
  updateCs2LaneSignal,
  type Cs2SignalClock,
  type Cs2SignalLane,
} from "../src/simulation/cs2-junctions";

type TickResult = {
  changed: boolean;
  clock: Cs2SignalClock;
  lanes: Cs2SignalLane[];
};
type TickCase = {
  id: string;
  origin: string;
  clock: Cs2SignalClock;
  lanes: Cs2SignalLane[];
  movingTime: number;
  notEmpty: number[];
  expected: TickResult;
};
type SelectCase = {
  id: string;
  origin: string;
  clock: Cs2SignalClock;
  lanes: Cs2SignalLane[];
  preferChange: boolean;
  expected: { group: number; canExtend: boolean; lanes: Cs2SignalLane[] };
};
type TraceCase = {
  id: string;
  origin: string;
  clock: Cs2SignalClock;
  lanes: Cs2SignalLane[];
  movingTime: number;
  steps: {
    priorities: number[];
    notEmpty: number[];
    expected: TickResult;
    projected: Cs2SignalLane[];
  }[];
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-signal-clock-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  mvid: string;
  source: string;
  extraction: {
    adapterChanges: string[];
    methods: { originalSha256: string; adaptedSha256: string }[];
  };
  tickCases: TickCase[];
  selectCases: SelectCase[];
  traces: TraceCase[];
};

it("distinguishes direct original execution from source-extracted populated lookups", () => {
  expect(oracle.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
  expect(oracle.source).toContain("source-extracted");
  expect(oracle.extraction.methods).toHaveLength(4);
  expect(oracle.extraction.methods[0].originalSha256).toBe(
    "518eb9ba9d74c2e3f2d6f9723247bb1de9aaeabe34f24d2c8a4d96ca2bab644f",
  );
  expect(
    oracle.tickCases.some((row) => row.origin === "direct-original-dll-empty"),
  ).toBe(true);
  expect(
    oracle.tickCases.some((row) => row.origin === "source-extracted"),
  ).toBe(true);
});

it("matches original/extracted signal selection and all lane side effects", () => {
  for (const row of oracle.selectCases) {
    const lanes = structuredClone(row.lanes);
    const selected = selectCs2SignalGroup(row.clock, lanes, row.preferChange);
    expect({ ...selected, lanes }, row.id).toEqual(row.expected);
  }
});

it("matches seven-state clock steps, byte wrap, bridge timers and clearance callbacks", () => {
  for (const row of oracle.tickCases) {
    const clock = structuredClone(row.clock);
    const lanes = structuredClone(row.lanes);
    const changed = tickCs2TrafficLights(
      clock,
      lanes,
      row.movingTime,
      (next) => !row.notEmpty.includes(next),
    );
    expect({ changed, clock, lanes }, row.id).toEqual(row.expected);
  }
});

for (const row of oracle.traces)
  it(`matches continuous original-source demand/extension trace ${row.id}`, () => {
    const clock = structuredClone(row.clock);
    const lanes = structuredClone(row.lanes);
    row.steps.forEach((step, frame) => {
      for (let i = 0; i < lanes.length; i++) {
        lanes[i].priority = step.priorities[i];
        lanes[i].petitioner = step.priorities[i] > 0 ? i + 1 : null;
      }
      const changed = tickCs2TrafficLights(
        clock,
        lanes,
        row.movingTime,
        (next) => !step.notEmpty.includes(next),
      );
      expect({ changed, clock, lanes }, `${row.id}/${frame}`).toEqual(
        step.expected,
      );
      if (changed)
        for (const lane of lanes) {
          lane.signal = updateCs2LaneSignal(clock, lane);
          lane.petitioner = null;
          lane.priority = lane.defaultPriority;
        }
      expect(lanes, `${row.id}/${frame}/projection`).toEqual(step.projected);
    });
  });
