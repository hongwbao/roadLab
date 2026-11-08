import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { bodiesOverlap } from "../src/simulation/collision";
import { lanePoint, v } from "../src/core/math";
import { emptyProject, makeRoad } from "../src/core/model";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import {
  chooseEarlyLane,
  laneChangeGapClear,
} from "../src/simulation/early-lane-planning";

it("starts preparation inside the configured window and requests adjacent steps", () => {
  const members = ["left", "middle-left", "middle-right", "right"],
    plan = { allowed: ["right"], distanceAfterCurrent: 0 };
  expect(chooseEarlyLane(plan, members, "left", 250, 16)).toBe("middle-left");
  expect(chooseEarlyLane(plan, members, "middle-left", 180, 16)).toBe(
    "middle-right",
  );
  expect(chooseEarlyLane(plan, members, "middle-right", 120, 16)).toBe("right");
  expect(chooseEarlyLane(plan, members, "left", 700, 16)).toBeNull();
  expect(chooseEarlyLane(plan, members, "right", 100, 16)).toBe("right");
});

it("honours upstream distance and waits for a safe gap ahead and behind", () => {
  expect(
    chooseEarlyLane(
      { allowed: ["right"], distanceAfterCurrent: 450 },
      ["left", "right"],
      "left",
      120,
      16,
    ),
  ).toBeNull();
  expect(laneChangeGapClear(1, 100, 15, [{ id: 2, s: 105, speed: 15 }])).toBe(
    false,
  );
  expect(laneChangeGapClear(1, 100, 15, [{ id: 2, s: 90, speed: 20 }])).toBe(
    false,
  );
  expect(
    laneChangeGapClear(1, 100, 15, [
      { id: 1, s: 100, speed: 15 },
      { id: 2, s: 140, speed: 15 },
      { id: 3, s: 60, speed: 20 },
    ]),
  ).toBe(true);
});

function restrictedTurn() {
  const project = emptyProject();
  const approach = makeRoad(v(), v(600, 0), {
    id: "approach",
    lanesStart: 4,
    lanesEnd: 4,
    speed: 60,
  });
  const exit = makeRoad(v(600, 0), v(600, 180), {
    id: "exit",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 40,
  });
  project.roads = [approach, exit];
  project.junctionLaneConnections = [0, 1, 2, 3].map((lane) => ({
    from: { road: approach.id, end: 1 as const, lane },
    to: lane === 3 ? [{ road: exit.id, end: 0 as const, lane: 0 }] : [],
  }));
  return { project, approach, exit };
}

it("moves an actual car toward a right-only exit early, one lane at a time, and completes the turn", () => {
  const { project, approach, exit } = restrictedTurn();
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  const car = {
    id: 9,
    route: [
      { road: approach.id, direction: 1 as const, inLane: 0, outLane: 3 },
      { road: exit.id, direction: 1 as const, inLane: 0, outLane: 0 },
    ],
    step: 0,
    s: 20,
    lane: 0,
    speed: 15,
    age: 0,
    color: 0,
    position: lanePoint(approach, 0, 20 / 600),
    heading: Math.PI / 2,
    pitch: 0,
  };
  sim.adoptVehicles([car]);
  sim.running = true;
  const starts: number[] = [],
    targets: number[] = [];
  let previous: number | undefined;
  for (let i = 0; i < 1800 && !sim.completed; i++) {
    sim.update(0.05);
    const current = sim.vehicles[0];
    if (current?.route[current.step]?.road !== approach.id) continue;
    if (current.laneChange) {
      expect(
        Math.abs(current.laneChange.to - current.laneChange.from),
      ).toBeLessThanOrEqual(1);
      if (previous !== current.laneChange.to) {
        starts.push(current.s);
        targets.push(current.laneChange.to);
      }
      previous = current.laneChange.to;
    }
  }
  expect(starts.length).toBeGreaterThanOrEqual(3);
  expect(600 - starts[0]).toBeGreaterThan(180);
  expect(targets.slice(0, 3)).toEqual([1, 2, 3]);
  expect(sim.failed).toBe(0);
  expect(sim.completed).toBe(1);
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/early-lane-preparation.json",
    JSON.stringify(
      {
        starts,
        targets,
        first_change_distance_to_junction: 600 - starts[0],
        completed: sim.completed,
        failed: sim.failed,
      },
      null,
      2,
    ),
  );
  sim.dispose();
});

it("waits for an occupied adjacent lane and keeps two actual displayed car bodies separate", () => {
  const { project, approach, exit } = restrictedTurn();
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  const make = (id: number, lane: number) => ({
    id,
    route: [
      { road: approach.id, direction: 1 as const, inLane: lane, outLane: 3 },
      { road: exit.id, direction: 1 as const, inLane: 0, outLane: 0 },
    ],
    step: 0,
    s: 300,
    lane,
    speed: 15,
    age: 0,
    color: 0,
    position: lanePoint(approach, lane, 0.5),
    heading: Math.PI / 2,
    pitch: 0,
  });
  const first = make(9, 0),
    second = make(10, 1);
  sim.adoptVehicles([first, second]);
  sim.running = true;
  sim.update(0.5);
  expect(sim.vehicles.find((car) => car.id === 9)!.laneChange).toBeUndefined();
  for (let i = 0; i < 360; i++) {
    sim.update(0.05);
    const cars = sim.renderVehicles();
    if (cars.length === 2 && bodiesOverlap(cars[0], cars[1], 0)) {
      mkdirSync("artifacts", { recursive: true });
      writeFileSync(
        "artifacts/early-gap-collision.json",
        JSON.stringify(
          {
            i,
            cars: cars.map((c) => ({
              id: c.id,
              position: c.position,
              s: c.s,
              lane: c.lane,
              laneChange: c.laneChange,
              speed: c.speed,
              step: c.step,
              heading: c.heading,
            })),
            runtime: sim.runtime!.readVehicles().map((v) => ({
              id: v.id,
              current: v.current,
              next: v.nextLanes.slice(0, 3),
              position: v.state.position,
            })),
          },
          null,
          2,
        ),
      );
    }
    if (cars.length === 2)
      expect(bodiesOverlap(cars[0], cars[1], 0)).toBe(false);
  }
  expect(sim.failed).toBe(0);
  for (let i = 0; i < 1200 && sim.completed < 2; i++) {
    sim.update(0.05);
    const cars = sim.renderVehicles();
    if (cars.length === 2)
      expect(bodiesOverlap(cars[0], cars[1], 0)).toBe(false);
  }
  expect(sim.completed).toBe(2);
  sim.dispose();
});
