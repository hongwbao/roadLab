import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { v } from "../src/core/math";
import { emptyProject, makeRoad } from "../src/core/model";
import {
  CS2_BASE_CAR,
  CS2_NAVIGATION_TIMESTEP,
  cs2SpeedRange,
} from "../src/simulation/cs2-driving";
import {
  Cs2PathHeap,
  Cs2RoadFlow,
  buildCs2RoadNavigation,
  chooseCs2RoadLane,
  cs2RoadPathCost,
  roadLaneCs2Curviness,
} from "../src/simulation/cs2-road-adapter";
import { LaneTraffic } from "../src/simulation/lane-traffic";
import { Simulation, type Vehicle } from "../src/simulation/simulation";

it("uses source road costs, flow bytes and citizenless fallback weights", () => {
  expect(cs2RoadPathCost({ length: 120, speedLimit: 60 / 3.6 })).toBeCloseTo(
    8.4,
    5,
  );
  expect(
    cs2RoadPathCost({ length: 120, speedLimit: 60 / 3.6, flowOffset: 128 }),
  ).toBeCloseTo(15.6, 5);
  expect(
    cs2RoadPathCost({ length: 0, speedLimit: 20, laneCrossCount: 2 }),
  ).toBe(4);
});

it("keeps priority heap ordering stable while admitting cheaper replacement entries", () => {
  const queue = new Cs2PathHeap<string>();
  queue.push("expensive", 40);
  queue.push("first-tie", 2);
  queue.push("second-tie", 2);
  queue.push("expensive", 1);
  expect(Array.from({ length: 4 }, () => queue.pop()!.value)).toEqual([
    "expensive",
    "first-tie",
    "second-tie",
    "expensive",
  ]);
  expect(queue.size).toBe(0);
  expect(queue.pop()).toBeUndefined();
});

it("updates only the selected source flow group and preserves empty-road free flow", () => {
  const a = makeRoad(v(0, 0), v(100, 0));
  const b = makeRoad(v(100, 0), v(200, 0));
  const flow = new Cs2RoadFlow();
  flow.configure([a, b]);
  flow.record(`${b.id}:1:0`, 10, 50, 100, 10);
  flow.update(8);
  expect(flow.offsets.size).toBe(0);
  flow.update(512 / 60 + 0.001);
  expect(flow.offsets.get(`${b.id}:1:0`)).toBe(128);
  expect(flow.offsets.has(`${a.id}:1:0`)).toBe(false);
  flow.configure([a, b]);
  flow.update(512 / 60 + 0.001);
  expect(flow.offsets.get(`${b.id}:1:0`)).toBe(0);
});

it("propagates a downstream required lane and counts current objects only ahead", () => {
  const road = makeRoad(v(0, 0), v(500, 0), { lanesStart: 2, lanesEnd: 2 });
  const next = makeRoad(v(500, 0), v(800, 0));
  const route = [
    { road: road.id, direction: 1 as const, inLane: 0, outLane: 1 },
    { road: next.id, direction: 1 as const, inLane: 0, outLane: 0 },
  ];
  const traffic = new LaneTraffic([
    { id: 1, s: 60, speed: 10, lane: 0, step: 0, route },
    { id: 2, s: 40, speed: 10, lane: 0, step: 0, route },
    { id: 3, s: 90, speed: 10, lane: 0, step: 0, route },
  ]);
  const groups = buildCs2RoadNavigation({
    route,
    step: 0,
    s: 60,
    id: 1,
    roads: new Map([road, next].map((r) => [r.id, r])),
    lengths: new Map([
      [road.id, 500],
      [next.id, 300],
    ]),
    connections: [
      {
        id: "only-exit",
        from: { road: road.id, lane: 1 },
        to: { road: next.id, lane: 0 },
        enabled: true,
      },
    ],
    traffic,
  });
  expect(groups[0].lanes[0].objectCount).toBe(1);
  expect(chooseCs2RoadLane(groups, 0, true)).toBe(1);
});

it("retains original straight-road rounding and resolves a tight curve in the live model", () => {
  const straight = makeRoad(v(0, 0), v(500, 0), { lanesStart: 1, lanesEnd: 1 });
  const original = JSON.parse(
    readFileSync(
      new URL("./fixtures/cs2-road-curviness-oracle.json", import.meta.url),
      "utf8",
    ),
  ).cases.find(
    (row: { name: string }) => row.name === "roadlab-500m-axis-aligned",
  );
  // The actual DLL returns a tiny nonzero curvature after float32 tangent
  // normalization. Keep the original result instead of forcing a straight 0.
  expect(roadLaneCs2Curviness(straight, 0)).toBe(
    Math.fround(original.expected),
  );
  const bend = makeRoad(
    v(0, 0),
    v(40, 40),
    { lanesStart: 1, lanesEnd: 1 },
    v(40, 0),
    v(40, 0),
  );
  expect(roadLaneCs2Curviness(bend, 0)).toBeGreaterThan(0.01);
});

it("the default runtime uses source acceleration at its 16-frame update cadence", () => {
  const project = emptyProject();
  const road = makeRoad(v(0, 0), v(1000, 0), {
    lanesStart: 1,
    lanesEnd: 1,
    speed: 100,
  });
  project.roads = [road];
  const simulation = new Simulation();
  simulation.configure(project);
  const car: Vehicle = {
    id: 5,
    route: [{ road: road.id, direction: 1, inLane: 0, outLane: 0 }],
    step: 0,
    lane: 0,
    s: 10,
    speed: 0,
    age: 0,
    color: 0,
    position: v(10, 0),
    heading: 0,
    pitch: 0,
  };
  simulation.vehicles = [car];
  simulation.running = true;
  simulation.update(1 / 60);
  expect(simulation.trafficModel).toBe("cs2-derived");
  const first = cs2SpeedRange(CS2_BASE_CAR, 0, CS2_NAVIGATION_TIMESTEP).max;
  expect(car.speed).toBeCloseTo(first, 6);
  simulation.update(14 / 60);
  expect(car.speed).toBeCloseTo(first, 6);
  simulation.update(2 / 60);
  expect(car.speed).toBeGreaterThan(first);
  simulation.dispose();
});
