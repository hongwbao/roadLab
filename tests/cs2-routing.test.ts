import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  backwardCs2LaneCosts,
  calculateCs2EdgeCost,
  calculateCs2PathCost,
  calculateCs2PathSpeed,
  chooseCs2CurrentLane,
  cs2CarDriveCosts,
  cs2CitizenPathfindWeights,
  cs2FlowOffset,
  cs2LaneDriveCost,
  cs2LaneFlowSample,
  cs2LaneObjectCost,
  cs2LanePriorityCost,
  cs2LaneSwitchCost,
  cs2TrafficFlowSpeed,
  cs2TrafficTimeFactors,
  cs2UpdateLaneFlow,
  type Cs2CostVector,
  type Cs2NavigationGroup,
  type Cs2PathParameters,
  type Cs2PathSpecification,
} from "../src/simulation/cs2-routing";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-routing-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  mvid: string;
  source: string;
  switches: { distance: number; coefficient: number; expected: number }[];
  priorities: {
    lanePriority: number;
    vehiclePriority: number;
    expected: number;
  }[];
  paths: {
    scenario: number;
    spec: Cs2PathSpecification;
    parameters: Cs2PathParameters;
    speed: number;
    cost: number;
  }[];
  citizens: {
    scenario: number;
    input: Parameters<typeof cs2CitizenPathfindWeights>[0];
    expected: Cs2CostVector;
  }[];
  carSpecs: {
    scenario: number;
    input: Parameters<typeof cs2CarDriveCosts>[0];
    expected: Cs2CostVector;
  }[];
  flows: { duration: number; distance: number; expected: number }[];
  rounds: { value: number; expected: number }[];
  edges: {
    scenario: number;
    spec: Cs2PathSpecification;
    parameters: Cs2PathParameters;
    options: NonNullable<Parameters<typeof calculateCs2EdgeCost>[2]>;
    expected: number;
  }[];
};

it("identifies the original DLL oracle rather than a translated implementation", () => {
  expect(oracle.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
  expect(oracle.source).toContain("invoked by reflection");
});

for (const row of oracle.paths)
  it(`matches original PathUtils speed and stable cost, scenario ${row.scenario}`, () => {
    expect(calculateCs2PathSpeed(row.spec, row.parameters)).toBe(
      Math.fround(row.speed),
    );
    expect(calculateCs2PathCost(row.spec, row.parameters)).toBe(
      Math.fround(row.cost),
    );
  });

it("matches original cubic lane-switch and lane-reservation priority costs", () => {
  for (const row of oracle.switches)
    expect(
      cs2LaneSwitchCost(row.distance, { baseCost: row.coefficient - 1 }),
    ).toBe(Math.fround(row.expected));
  for (const row of oracle.priorities)
    expect(cs2LanePriorityCost(row.lanePriority, row.vehiclePriority)).toBe(
      row.expected,
    );
  expect(cs2LaneSwitchCost(2, { allowChange: false, turnAhead: true })).toBe(
    280,
  );
});

for (const row of oracle.citizens)
  it(`matches original CitizenUtils weights, scenario ${row.scenario}`, () => {
    expect(cs2CitizenPathfindWeights(row.input)).toEqual(
      row.expected.map(Math.fround),
    );
  });

for (const row of oracle.carSpecs)
  it(`matches original road drive specification costs, scenario ${row.scenario}`, () => {
    expect(cs2CarDriveCosts(row.input)).toEqual(row.expected.map(Math.fround));
  });

for (const row of oracle.edges)
  it(`matches original executor edge cost, scenario ${row.scenario}`, () => {
    expect(calculateCs2EdgeCost(row.spec, row.parameters, row.options)).toBe(
      Math.fround(row.expected),
    );
  });

it("matches original traffic flow ratios, including empty-lane NaN saturation", () => {
  for (const row of oracle.flows)
    expect(cs2TrafficFlowSpeed(row.duration, row.distance)).toBe(row.expected);
});

it("encodes traffic flow with the original Mathf ties-to-even rounding", () => {
  for (const row of oracle.rounds)
    expect(
      cs2FlowOffset(
        { duration: [1, 0, 0, 0], distance: [row.value / 256, 0, 0, 0] },
        [1, 0, 0, 0],
      ),
    ).toBe(Math.min(255, Math.max(0, 256 - row.expected)));
});

it("retains source cost-vector order and rule/free-edge behavior", () => {
  const row = oracle.paths[0];
  expect(
    calculateCs2EdgeCost(row.spec, row.parameters, {
      delta: [0, 0.5],
      trafficRulePenalty: true,
      avoidBicycles: true,
      requireAuthorization: true,
    }),
  ).toBeCloseTo(267, 4);
  // Free traversal zeroes time/behaviour/money but retains comfort cost.
  expect(
    calculateCs2EdgeCost(row.spec, row.parameters, { freeForward: true }),
  ).toBe(20);
  expect(
    calculateCs2EdgeCost(row.spec, row.parameters, { delta: [0.5, 0.5] }),
  ).toBe(0);
});

it("keeps forbidden-lane preferences and stationary obstacles distinct", () => {
  expect(
    cs2LaneDriveCost({ allowed: true, forbidden: true, vehiclePriority: 100 }),
  ).toBe(Math.fround(4.9));
  expect(
    cs2LaneDriveCost({ allowed: true, forbidden: true, vehiclePriority: 108 }),
  ).toBe(Math.fround(0.9));
  expect(cs2LaneObjectCost({ curveEnd: 0.5, moving: false })).toBe(9_500_000);
  expect(
    cs2LaneObjectCost({
      curveEnd: 0.5,
      moving: false,
      queueing: true,
      queueLane: true,
    }),
  ).toBe(Math.fround(0.49));
});

it("propagates future lane costs backward through actual connection groups", () => {
  const groups: Cs2NavigationGroup[] = [
    {
      lanes: [
        { lane: 0, objectCount: 0, next: [0] },
        { lane: 1, objectCount: 0, next: [1] },
      ],
    },
    {
      lanes: [
        { lane: 0, objectCount: 20 },
        { lane: 1, objectCount: 0 },
      ],
    },
  ];
  const result = backwardCs2LaneCosts(groups);
  expect(result.costs[1].get(0)).toBeCloseTo(9.8);
  expect(result.costs[0].get(0)).toBe(1);
  expect(result.costs[0].get(1)).toBe(0);
  expect(result.switchBaseCost).toBe(Math.fround(0.01));
});

it("uses cubic costs to distinguish one- and two-lane changes and protects an upcoming turn", () => {
  const group: Cs2NavigationGroup = {
    lanes: [
      { lane: 0, objectCount: 10 },
      { lane: 1, objectCount: 0 },
      { lane: 2, objectCount: 0 },
    ],
  };
  expect(chooseCs2CurrentLane({ group, currentLane: 0 })).toBe(1);
  expect(chooseCs2CurrentLane({ group, currentLane: 0, turnAhead: true })).toBe(
    0,
  );
});

it("keeps the current lane connected to the selected downstream route", () => {
  const nextGroup: Cs2NavigationGroup = {
    lanes: [{ lane: 0, objectCount: 0 }],
    fixed: true,
  };
  const group: Cs2NavigationGroup = {
    lanes: [
      { lane: 0, objectCount: 0 },
      { lane: 1, objectCount: 10, next: [0] },
    ],
  };
  expect(chooseCs2CurrentLane({ group, currentLane: 0, nextGroup })).toBe(1);
  expect(
    chooseCs2CurrentLane({
      group: { ...group, fixed: true },
      currentLane: 0,
      nextGroup,
    }),
  ).toBe(0);
});

it("normalizes measured flow, blends time-of-day buckets and encodes the speed byte", () => {
  const factors = cs2TrafficTimeFactors(0.25);
  expect(factors).toEqual([0, 1, 0, 0]);
  const sample = cs2LaneFlowSample({
    duration: 2,
    distance: 20,
    laneLength: 100,
    maxDriveSpeed: 20,
  });
  expect(sample[0]).toBeCloseTo(0.4);
  expect(sample[1]).toBeCloseTo(0.2);
  const flow = cs2UpdateLaneFlow(
    { duration: [0, 0, 0, 0], distance: [0, 0, 0, 0] },
    sample,
    factors,
  );
  expect(cs2FlowOffset(flow, factors)).toBe(128);
  expect(
    cs2FlowOffset({ duration: [0, 0, 0, 0], distance: [0, 0, 0, 0] }, factors),
  ).toBe(0);
});
