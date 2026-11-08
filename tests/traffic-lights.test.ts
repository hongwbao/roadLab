import { expect, it, vi } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import { laneDirection, v } from "../src/core/math";
import {
  connections,
  emptyProject,
  makeRoad,
  parseProject,
  splitRoad,
} from "../src/core/model";
import {
  cloneTrafficSignals,
  normalizeTrafficSignals,
  makeTrafficSignal,
  SIGNAL_STOP_OFFSET,
  signalArmKey,
  signalStopOffset,
} from "../src/core/traffic-signals";
import {
  TrafficLightController,
  type SignalMovement,
} from "../src/simulation/traffic-lights";
import { Simulation, type Vehicle } from "../src/simulation/simulation";
import { DEFAULT_DRIVER } from "../src/simulation/driving";
import { bodiesOverlap, TrafficIndex } from "../src/simulation/collision";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";

function fixture(lanes = 1) {
  const p = emptyProject(),
    opts = {
      lanesStart: lanes,
      lanesEnd: lanes,
      twoWay: true,
      width: 3.5,
      speed: 50,
    };
  p.roads = [
    makeRoad(v(-160, 0), v(0, 0), opts),
    makeRoad(v(0, -160), v(0, 0), opts),
    makeRoad(v(0, 0), v(160, 0), opts),
    makeRoad(v(0, 0), v(0, 160), opts),
  ];
  const junctions = buildJunctions(p),
    junction = junctions[0];
  p.signals = [makeTrafficSignal(junction)];
  p.signals[0].mode = "sequential";
  const sim = new Simulation();
  sim.configure(p);
  const links = connections(p);
  const movements: SignalMovement[] = links.map((c) => {
    const from = p.roads.find((r) => r.id === c.from.road)!,
      to = p.roads.find((r) => r.id === c.to.road)!;
    const a = {
      road: from.id,
      direction: laneDirection(from, c.from.lane),
      inLane: c.from.lane,
      outLane: c.from.lane,
    };
    const b = {
      road: to.id,
      direction: laneDirection(to, c.to.lane),
      inLane: c.to.lane,
      outLane: c.to.lane,
    };
    const connector = (sim as any).connector(a, b);
    return {
      id: c.id,
      junction: junction.id,
      road: from.id,
      end: a.direction === 1 ? 1 : 0,
      turn: connector.movement.turn,
    };
  });
  return {
    p,
    sim,
    links,
    movements,
    junction,
    junctions,
    config: p.signals[0],
  };
}
it("runs green, yellow and all-red on simulation time and cycles every approach", () => {
  const { p, movements, junction, junctions, config } = fixture();
  const lights = new TrafficLightController();
  lights.configure(junctions, p.signals, movements);
  const first = lights.state(junction.id)!;
  expect(first.phases).toHaveLength(4);
  const allowed = movements.filter((m) => lights.allows(m.id, 1, 50, 10));
  expect(new Set(allowed.map((m) => signalArmKey(m))).size).toBe(1);
  lights.update(config.green);
  expect(lights.state(junction.id)!.stage).toBe("yellow");
  lights.update(config.yellow);
  expect(lights.state(junction.id)!.stage).toBe("all-red");
  expect(movements.every((m) => !lights.allows(m.id, 1, 0, 10))).toBe(true);
  lights.update(config.allRed);
  expect(lights.state(junction.id)!.phase).toBe(1);
  lights.update(first.cycle - config.green - config.yellow - config.allRed);
  expect(lights.state(junction.id)!.phase).toBe(0);
});
it("uses yellow for a close vehicle that cannot comfortably stop, and stops distant arrivals", () => {
  const { p, sim, movements, junction, config } = fixture();
  const lights = sim.trafficLights;
  const movement = movements.find((m) => lights.allows(m.id, 1, 50, 10))!;
  lights.update(config.green);
  expect(lights.allows(movement.id, 1, 35, 5)).toBe(false);
  expect(lights.allows(movement.id, 2, 10, 10)).toBe(true);
  lights.update(config.yellow);
  expect(lights.allows(movement.id, 2, 0, 10)).toBe(false);
  expect(lights.state(junction.id)!.stage).toBe("all-red");
  expect(p.signals).toHaveLength(1);
});
it("extends only the all-red clearance while a vehicle occupies the junction", () => {
  const { sim, junction, config } = fixture();
  const lights = sim.trafficLights;
  lights.update(config.green + config.yellow);
  lights.update(config.allRed + 10, new Set([junction.id]));
  expect(lights.state(junction.id)).toMatchObject({
    stage: "all-red",
    phase: 0,
    clearing: true,
    remaining: 0,
  });
  lights.update(0.025);
  expect(lights.state(junction.id)).toMatchObject({
    stage: "green",
    phase: 1,
    clearing: false,
  });
});
it("groups opposing through movements and gives left turns a separate protected phase", () => {
  const { p, junctions, junction, movements } = fixture(3);
  p.signals![0].mode = "protected";
  const lights = new TrafficLightController();
  lights.configure(junctions, p.signals, movements);
  const state = lights.state(junction.id)!;
  expect(state.phases).toHaveLength(4);
  expect(state.phases[0].arms).toHaveLength(2);
  expect(state.phases[0].turns).toEqual(["straight", "right"]);
  expect(state.phases[1].turns).toEqual(["left"]);
  const approach = state.phases[0].arms[0];
  expect(lights.armColor(junction.id, approach, "left")).toBe("red");
  expect(lights.armColor(junction.id, approach, "straight")).toBe("green");
});
it("preserves signal binding and timings through serialization and automatic road splits", () => {
  const { p, config, junction } = fixture();
  config.green = 27;
  config.offset = 13;
  const arm = junction.arms.find((a) => a.end === 1)!;
  const second = splitRoad(p, arm.road, 0.5)!;
  expect(p.signals![0].arms.some((a) => a.road === second && a.end === 1)).toBe(
    true,
  );
  const restored = parseProject(JSON.stringify(p));
  expect(restored.signals![0].green).toBe(27);
  expect(restored.signals![0].offset).toBe(13);
  expect(restored.signals![0].id).toBe(config.id);
  restored.signals![0].yellow = 0;
  expect(() => parseProject(JSON.stringify(restored))).toThrow(/红绿灯/);
});
it("has identical timing for small and large time steps, including a startup offset", () => {
  const { p, movements, junctions, junction } = fixture();
  p.signals![0].offset = 13;
  const a = new TrafficLightController(),
    b = new TrafficLightController();
  a.configure(junctions, p.signals, movements);
  b.configure(junctions, p.signals, movements);
  a.update(100);
  for (let i = 0; i < 4000; i++) b.update(0.025);
  expect(a.state(junction.id)!.phase).toBe(b.state(junction.id)!.phase);
  expect(a.state(junction.id)!.stage).toBe(b.state(junction.id)!.stage);
  expect(a.state(junction.id)!.remaining).toBeCloseTo(
    b.state(junction.id)!.remaining,
    7,
  );
});
function carFor(
  sim: Simulation,
  c: ReturnType<typeof connections>[number],
  id = 1,
) {
  const road = (sim as any).roads.get(c.from.road),
    nextRoad = (sim as any).roads.get(c.to.road);
  const step = {
    road: road.id,
    direction: laneDirection(road, c.from.lane),
    inLane: c.from.lane,
    outLane: c.from.lane,
  };
  const next = {
    road: nextRoad.id,
    direction: laneDirection(nextRoad, c.to.lane),
    inLane: c.to.lane,
    outLane: c.to.lane,
  };
  const car: Vehicle = {
    id,
    route: [step, next],
    step: 0,
    s: (sim as any).exit(step) - 55,
    speed: 12,
    lane: c.from.lane,
    age: 0,
    color: 0,
    position: v(),
    heading: 0,
    pitch: 0,
    driver: { ...DEFAULT_DRIVER },
    nextLaneDecision: Infinity,
  };
  (sim as any).pose(car);
  return car;
}
it("stops a real car before the crosswalk on red, then releases it on green", () => {
  const { sim, links, config } = fixture();
  const link = links.find((c) => !sim.trafficLights.allows(c.id, 1, 55, 12))!;
  const car = carFor(sim, link);
  sim.vehicles = [car];
  sim.running = true;
  for (let i = 0; i < 160; i++) sim.update(0.05);
  expect(car.connector).toBeUndefined();
  expect(car.speed).toBeLessThan(0.5);
  expect(car.s + 1.9).toBeLessThanOrEqual(
    (sim as any).exit(car.route[0]) - SIGNAL_STOP_OFFSET + 0.01,
  );
  expect(sim.statistics.junctionEntries).toBe(0);
  for (let i = 0; i < 2200 && !sim.completed; i++) sim.update(0.05);
  expect(sim.completed).toBe(1);
  expect(sim.statistics.safetyStops).toBe(0);
  expect(config.mode).toBe("sequential");
});
it("does not enter on green when the receiving lane lacks space", () => {
  const { sim, links, junction } = fixture();
  const link = links.find((c) => sim.trafficLights.allows(c.id, 1, 55, 12))!;
  const car = carFor(sim, link),
    step = car.route[1],
    targetArm = junction.arms.find((arm) => arm.road === step.road)!;
  const blocker: Vehicle = {
    ...car,
    id: 2,
    route: [step],
    step: 0,
    lane: step.inLane,
    // The physical source network joins at the stop-line boundary, beyond
    // the legacy pavement trim. Keep the blocker on the actual receiving lane.
    s: (sim as any).entry(step) + signalStopOffset(targetArm) + 3,
    speed: 0,
    cs2Car: { ...CS2_BASE_CAR, maxSpeed: 0, acceleration: 0 },
    nextLaneDecision: Infinity,
  };
  const network = (sim as any).sourceEngine.network,
    location = network.locateRoadLane(step.road, blocker.lane, blocker.s);
  expect(location).toBeDefined();
  expect(network.lanes.get(location.laneId)).toMatchObject({
    kind: "road",
    road: step.road,
    lane: step.inLane,
  });
  (sim as any).pose(blocker);
  const stoppedAt = { ...blocker.position };
  sim.vehicles = [car, blocker];
  sim.running = true;
  // Both runtimes must actually retain the blocker in the receiving clearance;
  // driver.speedFactor alone does not control a source-runtime vehicle.
  blocker.driver = { ...DEFAULT_DRIVER, speedFactor: 0.001 };
  for (let i = 0; i < 180; i++) {
    sim.update(0.05);
    const physical = sim.renderVehicles().find((vehicle) => vehicle.id === 2)!;
    expect(physical.speed).toBeLessThan(0.001);
    expect(
      Math.hypot(
        physical.position.x - stoppedAt.x,
        physical.position.z - stoppedAt.z,
      ),
    ).toBeLessThan(0.02);
  }
  expect(car.connector).toBeUndefined();
  expect(car.s + 1.9).toBeLessThanOrEqual(
    (sim as any).exit(car.route[0]) - SIGNAL_STOP_OFFSET + 0.01,
  );
  expect(sim.completed).toBe(0);
  expect(sim.statistics.junctionEntries).toBe(0);
  // Restore only the blocker's prefab; preserve the waiting car, signal clock
  // and route state so recovery cannot be attributed to resetting the test.
  const runtime = (sim as any).sourceEngine.runtime,
    released = runtime.getVehicle(2)!;
  runtime.removeVehicle(2);
  runtime.addVehicle({ ...released, car: { ...CS2_BASE_CAR } });
  for (let i = 0; i < 2400 && sim.completed < 2; i++) sim.update(0.05);
  expect(sim.completed).toBe(2);
  expect(sim.statistics.junctionEntries).toBe(1);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("serves an independent empty receiving lane while the opposite right-turn exit stays blocked", () => {
  const { p, sim, links, junction, movements, config } = fixture();
  config.mode = "protected";
  sim.configure(p);
  const right = new Set(
      movements
        .filter((movement) => movement.turn === "right")
        .map((movement) => movement.id),
    ),
    link = links.find(
      (connection) =>
        right.has(connection.id) &&
        sim.trafficLights.allows(connection.id, 1, 55, 12),
    )!,
    free = links.find(
      (connection) =>
        right.has(connection.id) &&
        connection.from.road !== link.from.road &&
        connection.to.road !== link.to.road &&
        sim.trafficLights.allows(connection.id, 3, 55, 12),
    )!,
    car = carFor(sim, link),
    independent = carFor(sim, free, 3),
    step = car.route[1],
    targetArm = junction.arms.find((arm) => arm.road === step.road)!,
    blocker: Vehicle = {
      ...car,
      id: 2,
      route: [step],
      step: 0,
      lane: step.inLane,
      s: (sim as any).entry(step) + signalStopOffset(targetArm) + 3,
      speed: 0,
      cs2Car: { ...CS2_BASE_CAR, maxSpeed: 0, acceleration: 0 },
      nextLaneDecision: Infinity,
    };
  (sim as any).pose(blocker);
  const stoppedAt = { ...blocker.position };
  sim.vehicles = [car, blocker, independent];
  sim.running = true;
  for (let i = 0; i < 800 && sim.completed < 1; i++) {
    sim.update(0.05);
    const physical = sim.renderVehicles().find((vehicle) => vehicle.id === 2)!;
    expect(physical.speed).toBeLessThan(0.001);
    expect(
      Math.hypot(
        physical.position.x - stoppedAt.x,
        physical.position.z - stoppedAt.z,
      ),
    ).toBeLessThan(0.02);
  }
  expect(sim.completedByExit.get(free.to.road)).toBe(1);
  expect(sim.completed).toBe(1);
  expect(sim.statistics.junctionEntries).toBe(1);
  expect(car.connector).toBeUndefined();
  const engine = (sim as any).sourceEngine,
    physicalLane = engine.network.lanes.get(
      engine.runtime.readVehicle(1).current.laneId,
    );
  expect(physicalLane).toMatchObject({ kind: "road", road: link.from.road });
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it.each(["cs2-derived", "legacy"] as const)(
  "%s keeps a real right-turning car moving during another movement's clearance",
  (model) => {
    const { p, sim, movements, links, config, junction } = fixture(3);
    config.mode = "custom";
    config.allRed = 8;
    sim.trafficModel = model;
    sim.configure(p);
    const right = movements.find((movement) => movement.turn === "right")!,
      link = links.find((connection) => connection.id === right.id)!,
      car = carFor(sim, link);
    car.s = (sim as any).exit(car.route[0]) - SIGNAL_STOP_OFFSET - 1.9 - 4;
    car.speed = 3;
    (sim as any).pose(car);
    sim.vehicles = [car];
    sim.trafficLights.update(
      config.program!.phases[0].duration + config.yellow,
    );
    expect(sim.trafficLights.state(junction.id)!.stage).toBe("all-red");
    expect(
      sim.trafficLights.armColor(junction.id, signalArmKey(right), "right"),
    ).toBe("green");
    sim.running = true;
    let minimumSpeed = Infinity;
    for (let i = 0; i < 120; i++) {
      sim.update(0.05);
      minimumSpeed = Math.min(minimumSpeed, car.speed);
    }
    expect(sim.trafficLights.state(junction.id)!.stage).toBe("all-red");
    expect(sim.statistics.junctionEntries).toBe(1);
    expect(minimumSpeed).toBeGreaterThan(0.1);
    expect(sim.statistics.safetyStops).toBe(0);
    sim.dispose();
  },
);

it("legacy signal admission survives all-red until the admitted car's rear clears", () => {
  const { sim, p, links, junction, config } = fixture();
  sim.trafficModel = "legacy";
  sim.configure(p);
  const link = links.find((c) => sim.trafficLights.allows(c.id, 1, 55, 12))!;
  const car = carFor(sim, link);
  car.s = (sim as any).exit(car.route[0]) - SIGNAL_STOP_OFFSET - 1.9 + 0.5;
  car.speed = 4;
  car.signalEntry = junction.id;
  (sim as any).pose(car);
  sim.vehicles = [car];
  sim.running = true;
  sim.trafficLights.update(config.green + config.yellow);
  for (let i = 0; i < 42; i++) sim.update(0.05);
  expect(sim.trafficLights.state(junction.id)).toMatchObject({
    stage: "all-red",
    clearing: true,
  });
  expect(car.connector).toBeDefined();
  expect(car.speed).toBeGreaterThan(0);
  for (let i = 0; i < 500 && !sim.completed; i++) sim.update(0.05);
  expect(sim.completed).toBe(1);
  expect(sim.statistics.safetyStops).toBe(0);
  expect(sim.trafficLights.state(junction.id)!.phase).toBeGreaterThan(0);
});

it("allows opposing straight streams together on the same green", () => {
  const { sim, p, links, movements } = fixture(3);
  p.signals![0].mode = "protected";
  sim.configure(p);
  const straight = new Set(
    movements
      .filter(
        (m) =>
          m.turn === "straight" && sim.trafficLights.allows(m.id, 1, 55, 12),
      )
      .map((m) => m.id),
  );
  const selected = links.filter((c) => straight.has(c.id));
  const from = [...new Set(selected.map((c) => c.from.road))];
  expect(from).toHaveLength(2);
  sim.vehicles = from.map((road, i) =>
    carFor(
      sim,
      selected.find((c) => c.from.road === road)!,
      i + 1,
    ),
  );
  sim.running = true;
  for (let i = 0; i < 550 && !sim.completed; i++) sim.update(0.05);
  for (let i = 0; i < 550 && sim.completed < 2; i++) sim.update(0.05);
  expect(sim.completed).toBe(2);
  expect(sim.statistics.simultaneousJunctions).toBeGreaterThanOrEqual(2);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("continues serving traffic across multiple signal cycles without body overlap", () => {
  const { p, sim } = fixture(3);
  p.signals![0].mode = "protected";
  p.signals![0].green = 12;
  p.signals![0].leftGreen = 6;
  p.signals![0].yellow = 2;
  p.signals![0].allRed = 1;
  p.ports = p.roads.map((r, i) => ({
    road: r.id,
    end: i < 2 ? "start" : "end",
    type: "both",
    rate: 8,
  }));
  sim.configure(p);
  sim.running = true;
  let overlaps = 0;
  for (let i = 0; i < 2400; i++) {
    sim.update(0.05);
    if (i % 4 === 0) {
      const displayed = sim.renderVehicles();
      for (let a = 0; a < displayed.length; a++)
        for (let b = a + 1; b < displayed.length; b++)
          if (bodiesOverlap(displayed[a], displayed[b], 0)) overlaps++;
    }
  }
  expect(overlaps).toBe(0);
  expect(sim.completed).toBeGreaterThan(15);
  expect(sim.trafficLights.statistics.transitions).toBeGreaterThan(12);
}, 30000);

it("anticipates a high-speed red signal before the ordinary connection lookahead", () => {
  const { p, sim } = fixture();
  for (const road of p.roads) road.speed = 100;
  sim.configure(p);
  const link = connections(p).find(
    (c) => !sim.trafficLights.allows(c.id, 1, 130, 22),
  )!;
  const car = carFor(sim, link);
  car.s = (sim as any).exit(car.route[0]) - 130;
  car.speed = 22;
  (sim as any).pose(car);
  sim.vehicles = [car];
  sim.running = true;
  let braking = 0;
  for (let i = 0; i < 300; i++) {
    sim.update(0.05);
    braking = Math.min(braking, car.acceleration ?? 0);
  }
  expect(sim.statistics.junctionEntries).toBe(0);
  expect(car.speed).toBeLessThan(1);
  // The recovered prefab base brakes at 10 m/s²; the old IDM fixture used 6.
  expect(braking).toBeGreaterThanOrEqual(-10.001);
});

it("keeps copied signal configurations bound to copied junctions", () => {
  const { p, config } = fixture(),
    ids = new Map(p.roads.map((road, i) => [road.id, `copied-${i}`]));
  const signals = cloneTrafficSignals(p.signals, ids),
    roads = structuredClone(p.roads);
  for (const road of roads) {
    road.id = ids.get(road.id)!;
    for (const knot of road.knots)
      for (const key of ["p", "incoming", "outgoing"] as const)
        knot[key].x += 400;
  }
  p.roads.push(...roads);
  p.signals!.push(...signals);
  normalizeTrafficSignals(p);
  expect(p.signals).toHaveLength(2);
  expect(p.signals![1].position.x).toBeCloseTo(400);
  expect(p.signals![1].id).not.toBe(config.id);
  expect(() => parseProject(JSON.stringify(p))).not.toThrow();
  const sim = new Simulation();
  sim.configure(p);
  expect(sim.trafficLights.states).toHaveLength(2);
});

it("legacy body guard revokes a signal admission when it rolls movement back", () => {
  const { sim, p, links } = fixture(),
    link = links.find((c) => sim.trafficLights.allows(c.id, 1, 55, 12))!;
  sim.trafficModel = "legacy";
  sim.configure(p);
  const car = carFor(sim, link);
  car.s = (sim as any).exit(car.route[0]) - SIGNAL_STOP_OFFSET - 1.9 - 0.01;
  car.speed = 1;
  (sim as any).pose(car);
  sim.vehicles = [car];
  sim.running = true;
  let rejected = false;
  const original = TrafficIndex.prototype.blocked;
  const spy = vi
    .spyOn(TrafficIndex.prototype, "blocked")
    .mockImplementation(function (this: TrafficIndex<Vehicle>, candidate) {
      if (
        candidate.id === 1 &&
        (candidate as Vehicle).signalEntry &&
        !rejected
      ) {
        rejected = true;
        return true;
      }
      return original.call(this, candidate);
    });
  try {
    sim.update(0.025);
    expect(rejected).toBe(true);
    expect(car.signalEntry).toBeUndefined();
    expect(sim.statistics.safetyStops).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
