import { expect, it } from "vitest";
import { v } from "../src/core/math";
import { emptyProject, makeRoad } from "../src/core/model";
import { Simulation } from "../src/simulation/simulation";

function setup() {
  const project = emptyProject();
  project.roads = [
    makeRoad(v(0, 0), v(2000, 0), {
      id: "road",
      lanesStart: 1,
      lanesEnd: 1,
      speed: 60,
    }),
  ];
  project.ports = [
    { road: "road", end: "start", type: "source", rate: 30 },
    { road: "road", end: "end", type: "sink", rate: 0 },
  ];
  const simulation = new Simulation();
  simulation.configure(project);
  return { simulation, project };
}

it("makes initial reachability available while paused so the UI can start", () => {
  const { simulation } = setup();
  expect(simulation.running).toBe(false);
  expect(simulation.elapsed).toBe(0);
  expect(simulation.routeCount).toBe(1);
  simulation.running = true;
  simulation.update(2);
  expect(simulation.generated).toBe(1);
  expect(simulation.entered).toBe(0);
  simulation.update(1 / 60);
  expect(simulation.entered).toBe(1);
  simulation.dispose();
});

it("keeps live rate and multiplier edits without resetting source vehicles or time", () => {
  const { simulation, project } = setup();
  simulation.running = true;
  for (let i = 0; i < 600; i++) simulation.update(1 / 60);
  expect(simulation.generated).toBe(5);
  const firstId = simulation.vehicles[0].id;
  const firstPosition = simulation.vehicles[0].s;
  const time = simulation.elapsed;
  project.ports[0].rate = 60;
  project.trafficMultiplier = 2;
  for (let i = 0; i < 600; i++) simulation.update(1 / 60);
  expect(simulation.generated).toBe(25);
  expect(simulation.elapsed).toBe(time + 10);
  expect(
    simulation.vehicles.some(
      (car) => car.id === firstId && car.s > firstPosition,
    ),
  ).toBe(true);
  project.trafficMultiplier = 0;
  for (let i = 0; i < 600; i++) simulation.update(1 / 60);
  expect(simulation.generated).toBe(25);
  expect(simulation.waiting).toBe(0);
  expect(simulation.elapsed).toBe(time + 20);
  simulation.dispose();
});

it("renders source interpolation without changing physical positions, then resets cleanly", () => {
  const { simulation } = setup();
  simulation.running = true;
  simulation.update(4);
  const physical = structuredClone(simulation.vehicles);
  const displayed = simulation.renderVehicles();
  expect(displayed.length).toBeGreaterThan(0);
  expect(displayed[0].position).not.toEqual(physical[0].position);
  expect(simulation.vehicles).toEqual(physical);
  simulation.reset();
  expect(simulation.vehicles).toHaveLength(0);
  expect(simulation.generated).toBe(0);
  expect(simulation.completed).toBe(0);
  expect(simulation.failed).toBe(0);
  expect(simulation.elapsed).toBe(0);
  expect(simulation.routeCount).toBe(1);
  simulation.dispose();
});
