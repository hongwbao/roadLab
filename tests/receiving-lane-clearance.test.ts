import { expect, it } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import { laneDirection, v } from "../src/core/math";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import {
  makeTrafficSignal,
  SIGNAL_STOP_OFFSET,
  signalStopOffset,
} from "../src/core/traffic-signals";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import { Simulation, type Vehicle } from "../src/simulation/simulation";

function fixture(short = false) {
  const project = emptyProject(),
    options = { lanesStart: 1, lanesEnd: 1, twoWay: true, width: 4, speed: 50 };
  project.roads = [
    makeRoad(v(-160, 0), v(), { ...options, id: "west" }),
    makeRoad(v(0, -160), v(), { ...options, id: "north" }),
    makeRoad(v(), v(160, 0), { ...options, id: "east" }),
    makeRoad(v(), v(0, 160), { ...options, id: "south" }),
  ];
  const junction = buildJunctions(project)[0],
    signal = makeTrafficSignal(junction),
    sim = new Simulation();
  signal.program!.phases[0].duration = 120;
  project.signals = [signal];
  sim.configure(project);
  const link = connections(project).find((c) => {
      const from = project.roads.find((r) => r.id === c.from.road)!,
        to = project.roads.find((r) => r.id === c.to.road)!;
      return (
        c.from.road === "west" &&
        sim.trafficLights.allows(c.id, 1, 55, 12) &&
        (sim as any).connector(
          {
            road: from.id,
            direction: laneDirection(from, c.from.lane),
            inLane: c.from.lane,
            outLane: c.from.lane,
          },
          {
            road: to.id,
            direction: laneDirection(to, c.to.lane),
            inLane: c.to.lane,
            outLane: c.to.lane,
          },
        ).movement.turn === "right"
      );
    })!,
    route = [link.from, link.to].map((ref) => ({
      road: ref.road,
      direction: laneDirection(
        project.roads.find((r) => r.id === ref.road)!,
        ref.lane,
      ),
      inLane: ref.lane,
      outLane: ref.lane,
    }));
  if (short) {
    const target = project.roads.find((r) => r.id === link.to.road)!,
      direction = route[1].direction,
      origin = direction === 1 ? target.knots[0].p : target.knots.at(-1)!.p,
      outer = direction === 1 ? target.knots.at(-1)!.p : target.knots[0].p,
      join = v(
        origin.x + (outer.x - origin.x) * 0.1,
        origin.z + (outer.z - origin.z) * 0.1,
      );
    project.roads[project.roads.indexOf(target)] = makeRoad(
      direction === 1 ? origin : join,
      direction === 1 ? join : origin,
      { ...options, id: target.id },
    );
    project.roads.push(
      makeRoad(direction === 1 ? join : outer, direction === 1 ? outer : join, {
        ...options,
        id: "after-short",
      }),
    );
    route.push({ ...route[1], road: "after-short" });
    sim.configure(project);
  }
  const car: Vehicle = {
    id: 1,
    route,
    step: 0,
    s: (sim as any).exit(route[0]) - SIGNAL_STOP_OFFSET - 1.9 - 4,
    lane: link.from.lane,
    speed: 4,
    age: 0,
    color: 0,
    position: v(),
    heading: 0,
    pitch: 0,
    nextLaneDecision: Infinity,
  };
  (sim as any).pose(car);
  return { project, sim, car, junction, link };
}
function stopped(
  car: Vehicle,
  id: number,
  step: Vehicle["route"][number],
  s: number,
): Vehicle {
  return {
    ...car,
    id,
    route: [step],
    step: 0,
    lane: step.inLane,
    s,
    speed: 0,
    cs2Car: { ...CS2_BASE_CAR, maxSpeed: 0, acceleration: 0 },
  };
}
function assertWaiting(sim: Simulation, car: Vehicle) {
  expect(car.connector).toBeUndefined();
  expect(sim.statistics.junctionEntries).toBe(0);
  expect(car.s + 1.9).toBeLessThanOrEqual(
    (sim as any).exit(car.route[0]) - SIGNAL_STOP_OFFSET + 0.01,
  );
  expect(sim.completed).toBe(0);
  expect(sim.failed).toBe(0);
}

it("does not forecast a moving receiving car through the stationary queue in front of it", () => {
  const { sim, car, junction } = fixture(),
    step = car.route[1],
    arm = junction.arms.find((a) => a.road === step.road)!,
    entry = (sim as any).entry(step) + signalStopOffset(arm),
    moving = {
      ...stopped(car, 2, step, entry + 3),
      speed: 5,
      cs2Car: { ...CS2_BASE_CAR, acceleration: 0 },
    },
    blocker = stopped(car, 3, step, entry + 9);
  (sim as any).pose(moving);
  (sim as any).pose(blocker);
  const position = { ...blocker.position };
  sim.vehicles = [car, moving, blocker];
  sim.running = true;
  let movingSamples = 0;
  for (let tick = 0; tick < 180; tick++) {
    sim.update(0.05);
    const cars = sim.renderVehicles(),
      fixed = cars.find((c) => c.id === 3)!;
    if (cars.find((c) => c.id === 2)!.speed > 0.5) movingSamples++;
    expect(fixed.speed).toBeLessThan(0.001);
    expect(
      Math.hypot(fixed.position.x - position.x, fixed.position.z - position.z),
    ).toBeLessThan(0.02);
    assertWaiting(sim, car);
  }
  expect(movingSamples).toBeGreaterThan(0);
  sim.dispose();
});

it("includes occupancy immediately beyond a short ordinary receiving segment", () => {
  const { sim, car } = fixture(true),
    step = car.route[2],
    blocker = stopped(car, 2, step, 0.3),
    engine = (sim as any).sourceEngine,
    receiver = engine.network.roadLaneIds.get(
      JSON.stringify([car.route[1].road, car.route[1].inLane]),
    );
  expect(receiver).toBeDefined();
  const usable = receiver.reduce(
    (sum: number, id: string) =>
      sum + engine.network.lanes.get(id).curve.length,
    0,
  );
  expect(usable).toBeLessThan(6.7);
  expect(
    engine.network.locateRoadLane(step.road, step.inLane, blocker.s),
  ).toBeDefined();
  (sim as any).pose(blocker);
  const position = { ...blocker.position };
  sim.vehicles = [car, blocker];
  sim.running = true;
  for (let tick = 0; tick < 180; tick++) {
    sim.update(0.05);
    const fixed = sim.renderVehicles().find((c) => c.id === 2)!;
    expect(fixed.speed).toBeLessThan(0.001);
    expect(
      Math.hypot(fixed.position.x - position.x, fixed.position.z - position.z),
    ).toBeLessThan(0.02);
    assertWaiting(sim, car);
  }
  sim.dispose();
});
