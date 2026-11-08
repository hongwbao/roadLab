import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { lanePoint, v } from "../src/core/math";
import { emptyProject, makeRoad } from "../src/core/model";
import { cs2RoadLaneKey } from "../src/simulation/cs2-network";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import {
  LaneCongestion,
  leastOccupiedLane,
} from "../src/simulation/lane-congestion";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import { bodiesOverlap } from "../src/simulation/collision";
import type { Vehicle } from "../src/simulation/simulation";

function fixture(count = 4, length = 480, lanes = 2, twoWay = false) {
  const project = emptyProject(),
    size = length / count;
  project.roads = Array.from({ length: count }, (_, i) =>
    makeRoad(v(i * size, 0), v((i + 1) * size, 0), {
      id: `part-${i}`,
      lanesStart: lanes,
      lanesEnd: lanes,
      twoWay,
      speed: 60,
    }),
  );
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  const lane = (road: number, index: number) =>
      sim.network!.roadLaneIds.get(cs2RoadLaneKey(`part-${road}`, index))![0],
    congestion: LaneCongestion = (sim as any).laneCongestion;
  const car = (
    id: number,
    index: number,
    global: number,
    speed = 60 / 3.6,
  ): Vehicle => {
    const step = Math.min(count - 1, Math.floor(global / size)),
      s = global - step * size;
    return {
      id,
      route: project.roads.map((road) => ({
        road: road.id,
        direction: 1 as const,
        inLane: index,
        outLane: index,
      })),
      step,
      s,
      lane: index,
      speed,
      age: 0,
      color: 0,
      position: lanePoint(project.roads[step], index, s / size),
      heading: 0,
      pitch: 0,
      ...(speed === 0
        ? { cs2Car: { ...CS2_BASE_CAR, maxSpeed: 0, acceleration: 0 } }
        : {}),
    };
  };
  return { project, sim, lane, congestion, car };
}

it("counts the physical500m window across seams without self/opposite/behind or duplicate bodies", () => {
  const { sim, lane, congestion } = fixture(4, 480, 2, true),
    rows = new Map([
      [
        lane(0, 2),
        [
          { id: 2, s: 40 },
          { id: 1, s: 50 },
          { id: 3, s: 100 },
        ],
      ],
      [
        lane(1, 2),
        [
          { id: 3, s: -20 },
          { id: 4, s: 0 },
          { id: 5, s: 100 },
        ],
      ],
      [lane(2, 2), [{ id: 6, s: 20 }]],
      [
        lane(3, 2),
        [
          { id: 7, s: 30 },
          { id: 8, s: 200 },
        ],
      ],
      [lane(0, 0), [{ id: 20, s: 80 }]],
    ]);
  expect(congestion.count(lane(0, 2), 1, 50, 500, rows)).toBe(5);
  sim.dispose();
});
it("preserves cars at a seam when navigation is ahead of the physical body", () => {
  const { sim, lane, congestion } = fixture(),
    rows = new Map([
      [lane(0, 0), [{ id: 2, s: 115 }]],
      [
        lane(1, 0),
        [
          { id: 2, s: -5 },
          { id: 3, s: 10 },
        ],
      ],
    ]);
  expect(congestion.count(lane(1, 0), 1, -10, 50, rows)).toBe(2);
  sim.dispose();
});

it("checks forward and rear safety gaps across a continuous authored seam", () => {
  const { sim, lane, congestion } = fixture();
  expect(
    congestion.gapClear(
      lane(0, 1),
      1,
      110,
      100 / 3.6,
      new Map([[lane(1, 1), [{ id: 2, s: 3, speed: 0 }]]]),
    ),
  ).toBe(false);
  expect(
    congestion.gapClear(
      lane(1, 1),
      1,
      5,
      100 / 3.6,
      new Map([[lane(0, 1), [{ id: 2, s: 110, speed: 100 / 3.6 }]]]),
    ),
  ).toBe(false);
  sim.dispose();
});
it("counts one720m road and six120m segments consistently", () => {
  const counts = [1, 6].map((count) => {
    const { sim, lane, congestion } = fixture(count, 720),
      rows = new Map<string, { id: number; s: number }[]>(),
      size = 720 / count;
    for (const [id, at] of [50, 100, 130, 230, 390, 650].entries()) {
      const part = Math.floor(at / size),
        key = lane(part, 0),
        list = rows.get(key) ?? [];
      list.push({ id, s: at - part * size });
      rows.set(key, list);
    }
    const result = congestion.count(lane(0, 0), 1, 100, 500, rows);
    sim.dispose();
    return result;
  });
  expect(counts).toEqual([3, 3]);
});
it("ends the comparable corridor at a real fork without counting another exit", () => {
  const { sim, project, lane } = fixture();
  project.roads.push(
    makeRoad(v(120, 0), v(120, 180), {
      id: "branch",
      lanesStart: 2,
      lanesEnd: 2,
    }),
  );
  sim.configure(project);
  const congestion: LaneCongestion = (sim as any).laneCongestion;
  expect(
    congestion.count(
      lane(0, 0),
      1,
      50,
      500,
      new Map([[lane(1, 0), [{ id: 2, s: 20 }]]]),
    ),
  ).toBe(0);
  sim.dispose();
});
it("chooses the global minimum eligible lane and keeps current/previous lanes on ties", () => {
  const lanes = ["a", "b", "c", "d"],
    counts = new Map([
      ["a", 3],
      ["b", 2],
      ["c", 1],
      ["d", 0],
    ]);
  expect(leastOccupiedLane(lanes, lanes, "a", counts)).toBe("d");
  expect(leastOccupiedLane(lanes, ["b", "c"], "a", counts)).toBe("c");
  counts.set("c", 0);
  expect(leastOccupiedLane(lanes, lanes, "c", counts, "d")).toBe("c");
  expect(leastOccupiedLane(lanes, lanes, "a", counts, "d")).toBe("d");
});

it("reaches the least occupied lane beyond its neighbour through adjacent moves across120m seams", () => {
  const { sim, car, lane } = fixture(10, 1200, 4);
  sim.adoptVehicles([
    car(1, 0, 100),
    ...[
      [0, 300],
      [0, 350],
      [0, 400],
      [1, 350],
      [1, 450],
      [2, 500],
    ].map(([index, at], i) => car(i + 10, index, at, 0)),
  ]);
  sim.running = true;
  sim.update(1 / 60);
  expect((sim as any).congestionChoices.get(1).goal).toBe(lane(0, 3));
  const actions: number[] = [];
  let previous: number | undefined,
    overlaps = 0;
  for (let tick = 0; tick < 180; tick++) {
    sim.update(0.05);
    const hero = sim.vehicles.find((c) => c.id === 1)!;
    if (hero.laneChange) {
      expect(Math.abs(hero.laneChange.to - hero.laneChange.from)).toBe(1);
      if (hero.laneChange.to !== previous) {
        actions.push(hero.laneChange.to);
        previous = hero.laneChange.to;
      }
    }
    const cars = sim.renderVehicles();
    for (let a = 0; a < cars.length; a++)
      for (let b = a + 1; b < cars.length; b++)
        if (bodiesOverlap(cars[a], cars[b], 0)) overlaps++;
  }
  expect(actions).toEqual([1, 2, 3]);
  expect(sim.vehicles.find((c) => c.id === 1)!.lane).toBe(3);
  expect(overlaps).toBe(0);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it.each([2, 3])(
  "keeps an empty-road %i-lane change at the holding-lane control's cruise speed",
  (lanes) => {
    const traces: number[][] = [],
      actions: number[][] = [];
    for (const start of [lanes - 1, 0]) {
      const { sim, project, car } = fixture(10, 1200, lanes);
      project.roads.forEach((road) => {
        road.speed = 100;
      });
      project.roads.push(
        makeRoad(v(1200, 0), v(1500, 0), {
          id: "exit",
          lanesStart: lanes,
          lanesEnd: lanes,
          speed: 100,
        }),
      );
      project.junctionLaneConnections = Array.from(
        { length: lanes },
        (_, index) => ({
          from: { road: "part-9", end: 1 as const, lane: index },
          to:
            index === lanes - 1
              ? [{ road: "exit", end: 0 as const, lane: index }]
              : [],
        }),
      );
      sim.configure(project);
      const hero = car(1, start, 800, 100 / 3.6);
      hero.route.forEach((step, index) => {
        step.inLane = index <= hero.step ? start : lanes - 1;
        step.outLane = index < hero.step ? start : lanes - 1;
      });
      sim.adoptVehicles([hero]);
      sim.running = true;
      const speeds: number[] = [],
        targets: number[] = [];
      let previous: number | undefined;
      for (let tick = 0; tick < 120; tick++) {
        sim.update(0.05);
        const current = sim.vehicles[0];
        speeds.push(current.speed);
        if (current.laneChange && current.laneChange.to !== previous) {
          expect(
            Math.abs(current.laneChange.to - current.laneChange.from),
          ).toBe(1);
          targets.push(current.laneChange.to);
          previous = current.laneChange.to;
        }
      }
      traces.push(speeds);
      actions.push(targets);
      sim.dispose();
    }
    expect(actions[0]).toEqual([]);
    expect(actions[1]).toEqual(
      Array.from({ length: lanes - 1 }, (_, i) => i + 1),
    );
    expect(Math.min(...traces[1])).toBeGreaterThan(100 / 3.6 - 0.1);
    expect(
      Math.max(...traces[1].map((speed, i) => Math.abs(speed - traces[0][i]))),
    ).toBeLessThan(0.1);
    mkdirSync(".cache/traffic-ai-maintenance", { recursive: true });
    writeFileSync(
      `.cache/traffic-ai-maintenance/lane-change-cruise-${lanes}.json`,
      JSON.stringify(
        {
          speed: 100 / 3.6,
          minimum: Math.min(...traces[1]),
          maximumControlDifference: Math.max(
            ...traces[1].map((speed, i) => Math.abs(speed - traces[0][i])),
          ),
          actions,
        },
        null,
        2,
      ),
    );
  },
);

it("excludes a less occupied lane that cannot follow the custom route", () => {
  const { sim, project, car } = fixture(1, 1000, 3);
  project.roads.push(
    makeRoad(v(1000, 0), v(1000, 200), {
      id: "exit",
      lanesStart: 1,
      lanesEnd: 1,
    }),
  );
  project.junctionLaneConnections = [0, 1, 2].map((index) => ({
    from: { road: "part-0", end: 1 as const, lane: index },
    to: index === 2 ? [{ road: "exit", end: 0 as const, lane: 0 }] : [],
  }));
  sim.configure(project);
  const hero = car(1, 0, 550),
    leader = car(2, 2, 800, 0);
  hero.route[0].outLane = leader.route[0].outLane = 2;
  hero.route[1].inLane = hero.route[1].outLane = 0;
  leader.route[1].inLane = leader.route[1].outLane = 0;
  sim.adoptVehicles([hero, leader]);
  sim.running = true;
  sim.update(0.1);
  const goal = sim.network!.lanes.get(
    (sim as any).congestionChoices.get(1).goal,
  )!;
  expect(goal.lane).toBe(2);
  expect(sim.vehicles.find((c) => c.id === 1)!.laneChange?.to).toBe(1);
  sim.dispose();
});

it("keeps equal-count choices stable across repeated reviews", () => {
  const { sim, car } = fixture(1, 2000, 4);
  sim.adoptVehicles([car(1, 2, 100)]);
  sim.running = true;
  for (let tick = 0; tick < 240; tick++) {
    sim.update(0.05);
    expect(sim.vehicles[0].laneChange).toBeUndefined();
    expect(sim.vehicles[0].lane).toBe(2);
  }
  expect(sim.statistics.discretionaryChanges).toBe(0);
  sim.dispose();
});

it("reviews congestion at one-second intervals and invalidates only the choice on a live window edit", () => {
  const { sim, car, congestion } = fixture(1, 2000, 4);
  sim.adoptVehicles([car(1, 0, 100)]);
  sim.running = true;
  sim.update(0.9);
  expect(congestion.statistics.queries).toBe(4);
  sim.update(0.3);
  expect(congestion.statistics.queries).toBe(8);
  const elapsed = sim.elapsed,
    before = sim.vehicles[0].s;
  expect(sim.setLaneLookahead(750)).toBe(true);
  sim.update(0.1);
  expect(congestion.statistics.queries).toBe(12);
  expect(sim.elapsed).toBeGreaterThan(elapsed);
  expect(sim.vehicles[0].s).toBeGreaterThanOrEqual(before);
  expect(sim.vehicles[0].id).toBe(1);
  sim.dispose();
});

it("keeps a dense balanced convoy from weaving during repeated count updates", () => {
  const { sim, car } = fixture(1, 2000, 3),
    cars = [0, 1, 2].flatMap((lane) =>
      [100, 140, 180, 220].map((s, i) => car(lane * 4 + i + 1, lane, s)),
    );
  sim.adoptVehicles(cars);
  sim.running = true;
  let overlaps = 0;
  for (let tick = 0; tick < 240; tick++) {
    sim.update(0.05);
    for (const c of sim.vehicles) {
      expect(c.laneChange).toBeUndefined();
      expect(c.lane).toBe(Math.floor((c.id - 1) / 4));
    }
    const bodies = sim.renderVehicles();
    for (let a = 0; a < bodies.length; a++)
      for (let b = a + 1; b < bodies.length; b++)
        if (bodiesOverlap(bodies[a], bodies[b], 0)) overlaps++;
  }
  expect(overlaps).toBe(0);
  expect(sim.statistics.discretionaryChanges).toBe(0);
  sim.dispose();
});

it("waits for a safe ordinary lane-change gap without slowing its unobstructed lane", () => {
  const { sim, car } = fixture(1, 2000, 2);
  sim.adoptVehicles([
    car(1, 0, 100),
    car(2, 1, 104, 0),
    ...[300, 350, 400, 450].map((s, i) => car(i + 3, 0, s, 0)),
  ]);
  sim.running = true;
  for (let tick = 0; tick < 10; tick++) {
    sim.update(0.05);
    const hero = sim.vehicles.find((c) => c.id === 1)!;
    expect(hero.laneChange).toBeUndefined();
    expect(hero.speed).toBeGreaterThan(60 / 3.6 - 0.1);
  }
  sim.dispose();
});

it("delays a lane change when the apparent empty segment has a blocked gap just beyond it", () => {
  const { sim, car } = fixture(10, 1200, 2);
  sim.adoptVehicles([
    car(1, 0, 110),
    car(2, 1, 123, 0),
    ...[200, 300, 400].map((s, i) => car(i + 3, 0, s, 0)),
  ]);
  sim.running = true;
  for (let tick = 0; tick < 10; tick++) {
    sim.update(0.05);
    const hero = sim.vehicles.find((c) => c.id === 1)!;
    expect(hero.laneChange).toBeUndefined();
    expect(hero.speed).toBeGreaterThan(60 / 3.6 - 0.1);
  }
  sim.dispose();
});

it("still brakes for a real stopped leader when the less occupied lane has no safe gap", () => {
  const { sim, car } = fixture(1, 2000, 2);
  sim.adoptVehicles([car(1, 0, 100), car(2, 0, 130, 0), car(3, 1, 95)]);
  sim.running = true;
  let minimum = Infinity,
    overlaps = 0;
  for (let tick = 0; tick < 60; tick++) {
    sim.update(0.05);
    minimum = Math.min(minimum, sim.vehicles.find((c) => c.id === 1)!.speed);
    const bodies = sim.renderVehicles();
    for (let a = 0; a < bodies.length; a++)
      for (let b = a + 1; b < bodies.length; b++)
        if (bodiesOverlap(bodies[a], bodies[b], 0)) overlaps++;
  }
  expect(minimum).toBeLessThan(60 / 3.6 - 2);
  expect(overlaps).toBe(0);
  sim.dispose();
});

it("uses local indexes instead of rescanning a20000-car lane for every query", () => {
  const { sim, lane, congestion } = fixture(1, 200000),
    rows = new Map([
      [
        lane(0, 0),
        Array.from({ length: 20000 }, (_, i) => ({ id: i + 1, s: i * 10 })),
      ],
    ]),
    began = performance.now();
  for (let i = 0; i < 100; i++)
    expect(congestion.count(lane(0, 0), -1, i * 1000, 500, rows)).toBe(51);
  const milliseconds = performance.now() - began;
  expect(congestion.statistics.rowsVisited).toBe(5100);
  expect(congestion.statistics.binarySteps).toBeLessThan(4000);
  expect(congestion.statistics.corridorBuilds).toBe(1);
  mkdirSync(".cache/traffic-ai-maintenance", { recursive: true });
  writeFileSync(
    ".cache/traffic-ai-maintenance/lane-congestion-performance.json",
    JSON.stringify(
      {
        milliseconds,
        ...congestion.statistics,
        vehicles: 20000,
        fullScanComparisons: 2000000,
      },
      null,
      2,
    ),
  );
  sim.dispose();
});
