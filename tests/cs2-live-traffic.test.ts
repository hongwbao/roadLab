import { expect, it } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import { laneDirection, v } from "../src/core/math";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import { makeTrafficSignal } from "../src/core/traffic-signals";
import type { Connection, Project } from "../src/core/types";
import { bodiesOverlap } from "../src/simulation/collision";
import { Simulation, type Vehicle } from "../src/simulation/simulation";

function crossing(signals: boolean) {
  const project = emptyProject();
  const options = { twoWay: true, lanesStart: 2, lanesEnd: 2, speed: 60 };
  project.roads = [
    makeRoad(v(-160, 0), v(0, 0), options),
    makeRoad(v(0, 0), v(160, 0), options),
    makeRoad(v(0, -160), v(0, 0), options),
    makeRoad(v(0, 0), v(0, 160), options),
  ];
  project.ports = [];
  if (signals) {
    const config = makeTrafficSignal(buildJunctions(project)[0]);
    // Keep source automatic-control regression separate from the new user default.
    config.mode = "cs2";
    project.signals = [config];
  }
  const sim = new Simulation();
  sim.configure(project);
  sim.running = true;
  return { project, sim };
}
function vehicle(
  project: Project,
  sim: Simulation,
  link: Connection,
  id: number,
) {
  const road = project.roads.find((r) => r.id === link.from.road)!;
  const next = project.roads.find((r) => r.id === link.to.road)!;
  const route = [
    {
      road: road.id,
      direction: laneDirection(road, link.from.lane),
      inLane: link.from.lane,
      outLane: link.from.lane,
    },
    {
      road: next.id,
      direction: laneDirection(next, link.to.lane),
      inLane: link.to.lane,
      outLane: link.to.lane,
    },
  ];
  const car: Vehicle = {
    id,
    route,
    step: 0,
    s: (sim as any).exit(route[0]) - 40,
    lane: link.from.lane,
    speed: 8,
    age: 0,
    color: 0,
    position: v(0, 0),
    heading: 0,
    pitch: 0,
    nextLaneDecision: Infinity,
  };
  (sim as any).pose(car);
  return car;
}

it("uses two opposing source signal groups and serves demanded directions safely", () => {
  const { project, sim } = crossing(true);
  const links = connections(project);
  const west = links.find(
    (c) =>
      c.from.road === project.roads[0].id && c.to.road === project.roads[1].id,
  )!;
  const north = links.find(
    (c) =>
      c.from.road === project.roads[2].id && c.to.road === project.roads[3].id,
  )!;
  sim.vehicles = [
    vehicle(project, sim, west, 1),
    vehicle(project, sim, north, 2),
  ];
  const state = sim.trafficLights.states[0];
  expect(project.signals![0].mode).toBe("cs2");
  expect(state.actuated).toBe(true);
  expect(state.phases).toHaveLength(2);
  const seen = new Set<number>();
  for (let frame = 0; frame < 2400 && sim.completed < 2; frame++) {
    sim.update(1 / 60);
    seen.add(sim.trafficLights.states[0].phase);
    if (sim.vehicles.length === 2)
      expect(bodiesOverlap(sim.vehicles[0], sim.vehicles[1], 0)).toBe(false);
  }
  expect(seen.size).toBe(2);
  expect(sim.failed).toBe(0);
  expect(sim.completed).toBe(2);
  expect([...sim.completedByExit.values()].reduce((a, b) => a + b, 0)).toBe(2);
});

it("fixed source frames produce the same result for different render frame sizes", () => {
  const project = emptyProject();
  const road = makeRoad(v(0, 0), v(2000, 0), {
    lanesStart: 1,
    lanesEnd: 1,
    speed: 100,
  });
  project.roads = [road];
  const run = (dt: number, frames: number) => {
    const sim = new Simulation();
    sim.configure(project);
    sim.running = true;
    sim.vehicles = [
      {
        id: 7,
        route: [{ road: road.id, direction: 1, inLane: 0, outLane: 0 }],
        step: 0,
        s: 10,
        lane: 0,
        speed: 0,
        age: 0,
        color: 0,
        position: v(10, 0),
        heading: 0,
        pitch: 0,
      },
    ];
    for (let i = 0; i < frames; i++) sim.update(dt);
    return {
      s: sim.vehicles[0].s,
      speed: sim.vehicles[0].speed,
      elapsed: sim.elapsed,
    };
  };
  expect(run(1 / 60, 600)).toEqual(run(0.05, 200));
});
