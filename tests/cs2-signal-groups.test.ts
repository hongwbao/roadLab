import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  buildCs2SignalGroups,
  type Cs2SignalLane,
} from "../src/simulation/cs2-signal-groups";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-signal-groups-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  mvid: string;
  source: string;
  scenarios: {
    scenario: number;
    lanes: Cs2SignalLane[];
    options: { levelCrossing: boolean };
    groupCount: number;
    expected: Record<string, number>;
  }[];
};

it("records direct original NativeList grouping execution as its oracle", () => {
  expect(oracle.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
  expect(oracle.source).toContain("invoked directly");
});

for (const row of oracle.scenarios)
  it(`matches original complete vehicle group construction, scenario ${row.scenario}`, () => {
    const result = buildCs2SignalGroups(row.lanes, row.options);
    expect(result.groupCount).toBe(row.groupCount);
    expect(
      Object.fromEntries(
        [...result.laneSignals].map(([id, signal]) => [id, signal.groupMask]),
      ),
    ).toEqual(row.expected);
  });

it("shares opposing left/right/straight movements in the same permissive phase", () => {
  const row = oracle.scenarios[0];
  const { groupCount, laneSignals } = buildCs2SignalGroups(row.lanes);
  expect(groupCount).toBe(2);
  const east = laneSignals.get("east-straight")!;
  for (const id of [
    "east-left",
    "east-right",
    "west-straight",
    "west-left",
    "west-right",
  ])
    expect(laneSignals.get(id)?.groupMask).toBe(east.groupMask);
  expect(laneSignals.get("north-straight")?.groupMask).not.toBe(east.groupMask);
  expect(east.canExtend).toBe(true);
  expect(east.defaultPriority).toBe(0);
});

it("uses lane-signal default -1 and no extension for railway crossings", () => {
  const row = oracle.scenarios.find((row) => row.scenario === 5)!;
  const result = buildCs2SignalGroups(row.lanes, row.options);
  expect(result.laneSignals.get("track-north")).toMatchObject({
    defaultPriority: -1,
    canExtend: false,
  });
  expect(result.laneSignals.get("car-east")).toMatchObject({
    defaultPriority: 0,
    canExtend: false,
  });
});

it("propagates master-group signals to members and skips secondary/non-signal lanes", () => {
  const row = oracle.scenarios[0];
  const first: Cs2SignalLane = {
    ...row.lanes[0],
    members: ["slave-1", "slave-2"],
  };
  const result = buildCs2SignalGroups([
    first,
    { ...row.lanes[1], id: "secondary", secondary: true },
    { ...row.lanes[2], id: "uncontrolled", hasSignal: false },
  ]);
  expect(result.laneSignals.get("slave-1")).toEqual(
    result.laneSignals.get(first.id),
  );
  expect(result.laneSignals.get("slave-2")).toEqual(
    result.laneSignals.get(first.id),
  );
  expect(result.laneSignals.has("secondary")).toBe(false);
  expect(result.laneSignals.has("uncontrolled")).toBe(false);
});

it("removes only overlapping conflicting straight groups from a pedestrian mask", () => {
  const row = oracle.scenarios[0];
  const pedestrian: Cs2SignalLane = {
    id: "crosswalk",
    pedestrian: true,
    straight: false,
    startDirection: { x: 0, z: 1 },
    endDirection: { x: 0, z: -1 },
  };
  const result = buildCs2SignalGroups([...row.lanes, pedestrian], {
    overlaps: new Map([
      ["crosswalk", new Set(["east-straight", "west-straight"])],
    ]),
  });
  expect(result.groupCount).toBe(2);
  expect(result.laneSignals.get("crosswalk")?.groupMask).toBe(
    result.laneSignals.get("north-straight")?.groupMask,
  );
  expect(result.laneSignals.get("crosswalk")?.canExtend).toBe(false);
});

it("adds one shared pedestrian-only group if all vehicle phases conflict", () => {
  const row = oracle.scenarios[0];
  const p: Cs2SignalLane = {
    id: "ped-a",
    pedestrian: true,
    straight: false,
    startDirection: { x: 1, z: 0 },
    endDirection: { x: -1, z: 0 },
  };
  const result = buildCs2SignalGroups(
    [...row.lanes, p, { ...p, id: "ped-b" }],
    {
      overlaps: new Map([
        [
          "ped-a",
          new Set(
            row.lanes.filter((lane) => lane.straight).map((lane) => lane.id),
          ),
        ],
        [
          "ped-b",
          new Set(
            row.lanes.filter((lane) => lane.straight).map((lane) => lane.id),
          ),
        ],
      ]),
    },
  );
  expect(result.groupCount).toBe(3);
  expect(result.laneSignals.get("ped-a")?.groupMask).toBe(4);
  expect(result.laneSignals.get("ped-b")?.groupMask).toBe(4);
});
