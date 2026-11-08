import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildJunctions } from "../src/core/junctions";
import { lanePoint, v } from "../src/core/math";
import { emptyProject, insertKnot, makeRoad } from "../src/core/model";
import { makeTrafficSignal } from "../src/core/traffic-signals";
import type { Port, Project } from "../src/core/types";
import { bodiesOverlap } from "../src/simulation/collision";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import type {
  CS2RuntimeDecision,
  CS2RuntimeVehicleView,
} from "../src/simulation/cs2-vehicle-runtime";
import type { Vehicle } from "../src/simulation/simulation";

type Observation = {
  frame: number;
  id: number;
  road?: string;
  kind?: string;
  direction?: number;
  interval?: readonly [number, number];
  rolling: boolean;
  queue: number;
  position: ReturnType<typeof v>;
  speed: number;
  limit: number;
};
function configured(project: Project) {
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    deterministicSeed: 19,
  });
  sim.configure(project);
  // Two-way sinks normalize to bidirectional ports with a default source rate.
  // Keep the real boundary configuration but generate only the explicit actors.
  sim.setTrafficMultiplier(0);
  const host = sim as unknown as {
      decision(view: CS2RuntimeVehicleView): CS2RuntimeDecision;
    },
    original = host.decision.bind(sim),
    observations: Observation[] = [];
  host.decision = (view) => {
    const result = original(view),
      lane = sim.network!.lanes.get(
        result.current?.laneId ?? view.current.laneId!,
      );
    observations.push({
      frame: sim.frame,
      id: Number(view.id),
      road: lane?.road,
      kind: lane?.kind,
      direction: lane?.direction,
      interval: lane?.roadInterval,
      rolling: result.rollingExit === true,
      queue: result.nextLanes?.length ?? 0,
      position: { ...view.state.position },
      speed: Math.hypot(
        view.state.velocity.x,
        view.state.velocity.y,
        view.state.velocity.z,
      ),
      limit: result.maxSpeed,
    });
    return result;
  };
  return { sim, observations };
}
function straight(reverse = false) {
  const project = emptyProject();
  project.roads = [
    makeRoad(v(), v(240, 0), {
      id: "r",
      lanesStart: 1,
      lanesEnd: 1,
      twoWay: true,
      width: 4,
      speed: 60,
    }),
  ];
  const source: Port = {
      road: "r",
      end: reverse ? "end" : "start",
      type: "source",
      rate: 0,
    },
    sink: Port = {
      road: "r",
      end: reverse ? "start" : "end",
      type: "sink",
      rate: 0,
    };
  project.ports = [source, sink];
  return { project, source, sink, lane: reverse ? 0 : 1 };
}
const metrics: unknown[] = [];
function evidence(value: unknown) {
  metrics.push(value);
  mkdirSync(".cache/traffic-ai-maintenance", { recursive: true });
  writeFileSync(
    ".cache/traffic-ai-maintenance/rolling-exit-metrics.json",
    JSON.stringify(metrics, null, 2),
  );
}

it.each([false, true])(
  "crosses the real external sink without endpoint braking, reverse %s",
  async (reverse) => {
    const { project, source, sink, lane } = straight(reverse),
      { sim, observations } = configured(project),
      id = await sim.spawnTrip(source, sink, { lane, initialSpeed: 10 });
    expect(id).not.toBeNull();
    sim.running = true;
    for (let tick = 0; tick < 2400 && !sim.completed; tick++)
      sim.update(1 / 60);
    const near = observations.filter(
      (row) =>
        row.id === id && (reverse ? row.position.x < 20 : row.position.x > 220),
    );
    expect(near.length).toBeGreaterThanOrEqual(4);
    expect(
      near.every((row) => row.rolling && row.queue === 0 && row.road === "r"),
    ).toBe(true);
    expect(near.every((row) => row.direction === (reverse ? -1 : 1))).toBe(
      true,
    );
    expect(Math.min(...near.map((row) => row.speed))).toBeGreaterThan(14);
    const last = near.at(-1)!;
    expect(reverse ? -last.position.x : last.position.x - 240).toBeGreaterThan(
      -0.5,
    );
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    evidence({
      case: "external",
      reverse,
      samples: near.length,
      minExitSpeed: Math.min(...near.map((row) => row.speed)),
      last: last.position,
      completed: sim.completed,
    });
    sim.dispose();
  },
);

it("enables rolling only on the final physical piece, preserving intermediate road and connection navigation", async () => {
  const project = emptyProject(),
    a = makeRoad(v(), v(180, 0), {
      id: "a",
      lanesStart: 1,
      lanesEnd: 1,
      speed: 60,
    }),
    b = makeRoad(v(180, 0), v(420, 0), {
      id: "b",
      lanesStart: 1,
      lanesEnd: 1,
      speed: 60,
    });
  insertKnot(b, 1 / 3);
  insertKnot(b, 2 / 3);
  project.roads = [a, b];
  const source: Port = { road: "a", end: "start", type: "source", rate: 0 },
    sink: Port = { road: "b", end: "end", type: "sink", rate: 0 };
  project.ports = [source, sink];
  const { sim, observations } = configured(project);
  expect(
    sim.network!.roadLaneIds.get(JSON.stringify(["b", 0]))!.length,
  ).toBeGreaterThanOrEqual(3);
  expect(
    await sim.spawnTrip(source, sink, { initialSpeed: 10 }),
  ).not.toBeNull();
  sim.running = true;
  for (let tick = 0; tick < 3000 && !sim.completed; tick++) sim.update(1 / 60);
  const intermediate = observations.filter(
    (row) =>
      row.kind === "connection" ||
      row.road === "a" ||
      (row.road === "b" && row.interval![1] < 0.999),
  );
  expect(intermediate.length).toBeGreaterThan(10);
  expect(intermediate.every((row) => !row.rolling)).toBe(true);
  const rolling = observations.filter((row) => row.rolling);
  expect(rolling.length).toBeGreaterThan(5);
  expect(
    rolling.every(
      (row) =>
        row.road === "b" &&
        row.kind === "road" &&
        row.interval![1] === 1 &&
        row.queue === 0,
    ),
  ).toBe(true);
  expect(sim.completed).toBe(1);
  expect(sim.failed).toBe(0);
  evidence({
    case: "intermediate",
    protectedSamples: intermediate.length,
    rollingSamples: rolling.length,
    completed: sim.completed,
  });
  sim.dispose();
});

function crossing(approachLength = 160) {
  const project = emptyProject(),
    options = { lanesStart: 1, lanesEnd: 1, twoWay: true, width: 4, speed: 50 };
  project.roads = [
    makeRoad(v(-approachLength, 0), v(), { ...options, id: "a" }),
    makeRoad(v(), v(160, 0), { ...options, id: "b" }),
    makeRoad(v(0, -160), v(), { ...options, id: "c" }),
    makeRoad(v(), v(0, 160), { ...options, id: "d" }),
  ];
  const signal = makeTrafficSignal(buildJunctions(project)[0]);
  signal.program!.phases[0].duration = 120;
  signal.program!.phases[0].movements =
    signal.program!.phases[0].movements.filter(
      (permission) => permission.turn === "right",
    );
  project.signals = [signal];
  return project;
}

it("does not bypass a red signal on the way to an external sink", async () => {
  const project = crossing(),
    source: Port = { road: "a", end: "start", type: "source", rate: 0 },
    sink: Port = { road: "b", end: "end", type: "sink", rate: 0 };
  project.ports = [source, sink];
  const { sim, observations } = configured(project),
    trim = (
      sim as unknown as { trims: Map<string, { end: number }> }
    ).trims.get("a")!.end,
    stop = 160 - trim,
    movement = "a:1>b:1";
  expect(sim.trafficLights.allows(movement, 1, 10, 6)).toBe(false);
  expect(
    await sim.spawnTrip(source, sink, {
      lane: 1,
      startDistance: stop - 16,
      initialSpeed: 6,
    }),
  ).not.toBeNull();
  sim.running = true;
  for (let tick = 0; tick < 600; tick++) sim.update(1 / 60);
  expect(sim.vehicles).toHaveLength(1);
  const car = sim.vehicles[0];
  expect(car.route[car.step].road).toBe("a");
  expect(car.connector).toBeUndefined();
  expect(car.position.x + 1.9).toBeLessThanOrEqual(-trim + 0.1);
  expect(car.speed).toBeLessThan(0.1);
  expect(observations.every((row) => !row.rolling)).toBe(true);
  expect(sim.completed).toBe(0);
  expect(sim.failed).toBe(0);
  evidence({
    case: "red-signal",
    samples: observations.length,
    stop: -trim,
    front: car.position.x + 1.9,
    speed: car.speed,
  });
  sim.dispose();
});

it.each([160, 20000])(
  "keeps native endpoint stopping for a junction-trimmed sink on a %im road",
  async (approachLength) => {
    const project = crossing(approachLength),
      source: Port = { road: "a", end: "start", type: "source", rate: 0 },
      sink: Port = { road: "a", end: "end", type: "sink", rate: 0 };
    project.ports = [source, sink];
    const { sim, observations } = configured(project);
    const trim = (
      sim as unknown as { trims: Map<string, { end: number }> }
    ).trims.get("a")!.end;
    expect(
      await sim.spawnTrip(source, sink, {
        lane: 1,
        initialSpeed: 6,
        startDistance: approachLength - trim - 25,
      }),
    ).not.toBeNull();
    sim.running = true;
    for (let tick = 0; tick < 2400 && !sim.completed; tick++)
      sim.update(1 / 60);
    expect(observations.length).toBeGreaterThan(10);
    expect(observations.every((row) => !row.rolling)).toBe(true);
    expect(observations.at(-1)!.interval![1]).toBeLessThan(1);
    expect(observations.at(-1)!.speed).toBeLessThan(0.5);
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    evidence({
      case: "trimmed-non-external",
      approachLength,
      last: observations.at(-1),
      completed: sim.completed,
    });
    sim.dispose();
  },
);

it("still brakes behind a real stopped leader on the final external road", () => {
  const { project } = straight(),
    { sim, observations } = configured(project),
    route = [{ road: "r", direction: 1 as const, inLane: 1, outLane: 1 }],
    car = (id: number, s: number, speed: number): Vehicle => ({
      id,
      route: structuredClone(route),
      step: 0,
      s,
      lane: 1,
      speed,
      age: 0,
      color: 0,
      position: lanePoint(project.roads[0], 1, s / 240),
      heading: 0,
      pitch: 0,
      nextLaneDecision: Infinity,
      ...(id === 1
        ? { cs2Car: { ...CS2_BASE_CAR, maxSpeed: 0, acceleration: 0 } }
        : {}),
    });
  sim.adoptVehicles([car(1, 225, 0), car(2, 185, 10)]);
  const initial = { ...sim.vehicles.find((row) => row.id === 1)!.position };
  sim.running = true;
  for (let tick = 0; tick < 600; tick++) {
    sim.update(1 / 60);
    const cars = sim.renderVehicles(),
      leader = cars.find((row) => row.id === 1)!,
      follower = cars.find((row) => row.id === 2)!;
    expect(leader).toBeDefined();
    expect(follower).toBeDefined();
    expect(
      Math.hypot(leader.position.x - initial.x, leader.position.z - initial.z),
    ).toBeLessThan(0.02);
    expect(leader.speed).toBeLessThan(0.001);
    expect(bodiesOverlap(leader, follower, 0)).toBe(false);
  }
  const follower = sim.vehicles.find((row) => row.id === 2)!;
  expect(follower.speed).toBeLessThan(0.1);
  expect(
    observations.some((row) => row.id === 2 && row.rolling && row.limit < 0.1),
  ).toBe(true);
  expect(sim.completed).toBe(0);
  expect(sim.failed).toBe(0);
  evidence({
    case: "blocked-external",
    followerSpeed: follower.speed,
    gap: initial.x - follower.position.x,
    rollingSamples: observations.filter((row) => row.id === 2 && row.rolling)
      .length,
  });
  sim.dispose();
});
