import { expect, it } from "vitest";
import { bezier, v } from "../src/core/math";
import { laneDirection } from "../src/core/math";
import { buildJunctions } from "../src/core/junctions";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import { makeTrafficSignal } from "../src/core/traffic-signals";
import { Simulation, type Vehicle } from "../src/simulation/simulation";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import { DEFAULT_DRIVER } from "../src/simulation/driving";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import {
  SignalMovementOccupancy,
  type SignalBody,
  type SignalPath,
} from "../src/simulation/signal-movement-occupancy";

const body = (x: number, z = 0, heading = 0): SignalBody => ({
  id: 1,
  position: v(x, z),
  heading,
  halfLength: 1.9,
  halfWidth: 0.825,
});
function path(id = "straight"): SignalPath {
  return {
    id,
    junction: "junction",
    curve: {
      id,
      points: [v(), v(10 / 3, 0), v(20 / 3, 0), v(10, 0)],
      length: 10,
      width: 4,
    },
    entryDirection: v(1, 0),
    exitDirection: v(1, 0),
  };
}
const sample = (tracker: SignalMovementOccupancy, car: SignalBody) =>
  tracker.update(new Map([[car.id, car]]));

it("does not turn a distant route nomination or a car stopped before the entry into occupied space", () => {
  const tracker = new SignalMovementOccupancy();
  tracker.nominate(1, path());
  expect(sample(tracker, body(-30)).size).toBe(0);
  for (let i = 0; i < 120; i++)
    expect(sample(tracker, body(-2.2)).size).toBe(0);
});
it("retains the movement from physical front entry until the rear clears, independent of the current navigation lane", () => {
  const tracker = new SignalMovementOccupancy();
  tracker.nominate(1, path());
  for (const x of [-1, 3, 8, 10.5, 11.9])
    expect(sample(tracker, body(x)).get("junction")).toEqual(
      new Set(["straight"]),
    );
  expect(sample(tracker, body(12.2)).size).toBe(0);
});
it("never releases a stopped body merely because time passed or a phase changed", () => {
  const tracker = new SignalMovementOccupancy();
  tracker.nominate(1, path("old-phase"));
  for (let i = 0; i < 600; i++)
    expect(sample(tracker, body(5)).get("junction")).toEqual(
      new Set(["old-phase"]),
    );
});
it("releases deleted vehicles, explicit removals and reset state without retaining stale admission", () => {
  const tracker = new SignalMovementOccupancy();
  tracker.nominate(1, path());
  expect(sample(tracker, body(5)).size).toBe(1);
  expect(tracker.update(new Map()).size).toBe(0);
  expect(sample(tracker, body(5)).size).toBe(0);
  tracker.nominate(1, path());
  tracker.remove(1);
  expect(sample(tracker, body(5)).size).toBe(0);
  tracker.nominate(1, path());
  tracker.clear();
  expect(sample(tracker, body(5)).size).toBe(0);
});
it("tracks a zero-length connector using the actual incoming and outgoing tangents", () => {
  const tracker = new SignalMovementOccupancy(),
    zero = path();
  zero.curve = {
    ...zero.curve,
    points: [v(5, 0), v(5, 0), v(5, 0), v(5, 0)],
    length: 0,
  };
  tracker.nominate(1, zero);
  expect(sample(tracker, body(2.8)).size).toBe(0);
  expect(sample(tracker, body(4)).get("junction")).toEqual(
    new Set(["straight"]),
  );
  expect(sample(tracker, body(6.9)).size).toBe(1);
  expect(sample(tracker, body(7.2)).size).toBe(0);
});
it("keeps a curved movement near its entrance even if its distant exit plane is already behind the car", () => {
  const tracker = new SignalMovementOccupancy(),
    curve = path("curved");
  curve.curve = {
    ...curve.curve,
    points: [v(), v(20, 0), v(20, 10), v(10, 10)],
    length: 30,
  };
  curve.exitDirection = v(-1, 0);
  tracker.nominate(1, curve);
  expect(sample(tracker, body(-1)).size).toBe(1);
  expect(
    sample(tracker, {
      ...body(0),
      position: bezier(...curve.curve.points, 0.5),
    }).size,
  ).toBe(1);
  expect(sample(tracker, body(7.8, 10, Math.PI)).size).toBe(0);
});
it("uses the oriented body extent when its rear corner still straddles the exit plane", () => {
  const tracker = new SignalMovementOccupancy();
  tracker.nominate(1, path());
  expect(sample(tracker, body(5)).size).toBe(1);
  expect(sample(tracker, body(11.8, 0, Math.PI / 4)).size).toBe(1);
  expect(sample(tracker, body(12.2, 0, Math.PI / 4)).size).toBe(0);
});
it("keeps a movement occupied until every car clears it", () => {
  const tracker = new SignalMovementOccupancy();
  tracker.nominate(1, path());
  tracker.nominate(2, path());
  expect(
    tracker
      .update(
        new Map([
          [1, body(13)],
          [2, { ...body(8), id: 2 }],
        ]),
      )
      .get("junction"),
  ).toEqual(new Set(["straight"]));
  expect(tracker.update(new Map([[2, { ...body(13), id: 2 }]])).size).toBe(0);
});

it("clears old movement admission when source vehicles are replaced, even if an ID is reused", () => {
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(emptyProject());
  const tracker: SignalMovementOccupancy = (sim as any).signalOccupancy;
  tracker.nominate(1, path());
  expect(sample(tracker, body(5)).size).toBe(1);
  sim.adoptVehicles([]);
  expect(sample(tracker, body(5)).size).toBe(0);
  sim.dispose();
});

it.each(
  ["cs2-derived", "legacy"].flatMap((model) =>
    ["straight", "right"].map((turn) => ({
      model: model as "cs2-derived" | "legacy",
      turn,
    })),
  ),
)(
  "feeds the actual $turn car's tail occupancy through the $model signal boundary",
  ({ model, turn }) => {
    const project = emptyProject(),
      options = {
        lanesStart: 1,
        lanesEnd: 1,
        twoWay: true,
        width: 4,
        speed: 50,
      };
    project.roads = [
      makeRoad(v(-160, 0), v(), options),
      makeRoad(v(0, -160), v(), options),
      makeRoad(v(), v(160, 0), options),
      makeRoad(v(), v(0, 160), options),
    ];
    const junction = buildJunctions(project)[0],
      config = makeTrafficSignal(junction),
      sim = new Simulation();
    config.program!.phases[0].duration = 120;
    project.signals = [config];
    sim.trafficModel = model;
    sim.configure(project);
    const initial = sim.trafficLights.state(junction.id)!,
      link = connections(project).find((connection) => {
        const from = project.roads.find((r) => r.id === connection.from.road)!,
          to = project.roads.find((r) => r.id === connection.to.road)!,
          connector = (sim as any).connector(
            {
              road: from.id,
              direction: laneDirection(from, connection.from.lane),
              inLane: connection.from.lane,
              outLane: connection.from.lane,
            },
            {
              road: to.id,
              direction: laneDirection(to, connection.to.lane),
              inLane: connection.to.lane,
              outLane: connection.to.lane,
            },
          );
        return (
          initial.phases[0].movements.has(connection.id) &&
          connector.movement?.turn === turn
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
      })),
      connector = (sim as any).connector(route[0], route[1]),
      engine = (sim as any).sourceEngine,
      points =
        model === "cs2-derived"
          ? engine.geometry.get(link.id).points
          : [connector.from, connector.c1, connector.c2, connector.to],
      end = points[3],
      delta = { x: end.x - points[2].x, z: end.z - points[2].z },
      size = Math.hypot(delta.x, delta.z),
      direction = { x: delta.x / size, z: delta.z / size },
      car: Vehicle = {
        id: 1,
        route,
        step: 0,
        s: (sim as any).exit(route[0]) - 55,
        lane: link.from.lane,
        speed: 4,
        cs2Car: { ...CS2_BASE_CAR, maxSpeed: 4 },
        driver: { ...DEFAULT_DRIVER, speedFactor: 0.25 },
        age: 0,
        color: 0,
        position: v(),
        heading: 0,
        pitch: 0,
        nextLaneDecision: Infinity,
      };
    (sim as any).pose(car);
    sim.vehicles = [car];
    sim.running = true;
    let tailSamples = 0,
      cleared = false,
      checkedBoundary = false;
    for (let tick = 0; tick < 2000 && !sim.completed; tick++) {
      sim.update(0.05);
      const current = sim.vehicles[0];
      if (!current) continue;
      const map: Map<string, Set<string>> = model === "cs2-derived"
          ? engine.occupiedSignalMovements()
          : (sim as any).occupiedSignals().movements,
        beyond =
          (current.position.x - end.x) * direction.x +
          (current.position.z - end.z) * direction.z,
        onExitRoad =
          current.route[current.step]?.road === route[1].road &&
          !current.connector;
      if (onExitRoad && beyond > 0 && beyond < 1.8) {
        expect(map.get(junction.id)?.has(link.id)).toBe(true);
        tailSamples++;
        if (!checkedBoundary) {
          sim.trafficLights.update(
            sim.trafficLights.state(junction.id)!.remaining +
              config.yellow +
              config.allRed,
            new Set(map.keys()),
            map,
          );
          expect(sim.trafficLights.state(junction.id)).toMatchObject(
            turn === "right"
              ? { phase: 1, stage: "green", clearing: false }
              : { phase: 0, stage: "all-red", clearing: true },
          );
          checkedBoundary = true;
        }
      }
      if (onExitRoad && beyond > 7) {
        expect(map.get(junction.id)?.has(link.id) ?? false).toBe(false);
        cleared = true;
      }
    }
    expect(tailSamples).toBeGreaterThan(0);
    expect(checkedBoundary).toBe(true);
    expect(cleared).toBe(true);
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    sim.dispose();
  },
);
