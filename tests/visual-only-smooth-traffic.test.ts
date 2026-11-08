import { expect, it } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import { lanePoint, v } from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  makeRoad,
} from "../src/core/model";
import { setJunctionLaneRule } from "../src/core/junction-lane-connections";
import { setNodeSmooth } from "../src/core/road-visual-settings";
import { makeTrafficSignal } from "../src/core/traffic-signals";
import { sourceLanes } from "../src/core/traffic-demand";
import type { Project } from "../src/core/types";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import { compileCs2Network } from "../src/simulation/cs2-network";
import { Simulation } from "../src/simulation/simulation";

const seamNode = {
  arms: [
    { road: "a", end: 1 as const },
    { road: "b", end: 0 as const },
  ],
};
function seam(from = 3, to = 5) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-160, 0), v(), { id: "a", lanesStart: from, lanesEnd: from }),
    makeRoad(v(), v(160, 0), { id: "b", lanesStart: to, lanesEnd: to }),
  ];
  p.ports = [
    { road: "a", end: "start", type: "source", rate: 0 },
    { road: "b", end: "end", type: "sink", rate: 0 },
  ];
  autoJunction(p);
  return p;
}
function signalized() {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-200, 0), v(), { id: "a" }),
    makeRoad(v(), v(200, 0), { id: "b" }),
    makeRoad(v(0, -200), v(), { id: "c" }),
    makeRoad(v(), v(0, 200), { id: "d" }),
  ];
  p.ports = [
    { road: "a", end: "start", type: "source", rate: 0 },
    { road: "b", end: "end", type: "sink", rate: 0 },
  ];
  autoJunction(p);
  const signal = makeTrafficSignal(buildJunctions(p)[0]);
  signal.mode = "sequential";
  signal.green = 5;
  signal.yellow = 1;
  signal.allRed = 1;
  p.signals = [signal];
  return p;
}
function internal(sim: Cs2TrafficSimulation) {
  return sim as unknown as {
    project: Project;
    trims: Map<string, unknown>;
    geometry: Map<string, unknown>;
    laneOverlaps: Map<string, unknown>;
    earlyLanePlans: Map<number, unknown>;
    signalOccupancy: object;
    trips: Map<number, { ownerPath: unknown; fixedRoads?: string[] }>;
  };
}
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      entry instanceof Map
        ? [...entry.entries()]
        : entry instanceof Set
          ? [...entry.values()]
          : entry,
    ),
  );
}
function logicalSnapshot(sim: Cs2TrafficSimulation) {
  const state = internal(sim);
  return plain({
    network: sim.network,
    junctions: sim.junctions,
    trims: state.trims,
    geometry: state.geometry,
    laneOverlaps: state.laneOverlaps,
    entryLanes: state.project.ports.map((port) =>
      sourceLanes(state.project, port),
    ),
    signalStates: sim.trafficLights.states,
  });
}
function configured(project: Project) {
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    deterministicSeed: 19,
  });
  sim.configure(project);
  return sim;
}
function node(project: Project) {
  return project.roads.length === 2
    ? seamNode
    : {
        arms: project.roads.map((road) => ({
          road: road.id,
          end: road.id === "a" || road.id === "c" ? (1 as const) : (0 as const),
        })),
      };
}
function smooth(project: Project) {
  setNodeSmooth(project, node(project), true);
}

it.each([
  "3to5",
  "5to3",
  "asymmetric-median-offset",
  "functional-profile",
  "signals",
])(
  "keeps all compiled topology, curves, costs, stop anchors and collision inputs identical for %s",
  (kind) => {
    const p =
      kind === "signals" ? signalized() : kind === "5to3" ? seam(5, 3) : seam();
    if (kind === "asymmetric-median-offset") {
      for (const road of p.roads) {
        road.twoWay = true;
        road.backwardLanesStart = road.backwardLanesEnd = 2;
        road.median = { kind: "concrete", width: 2 };
        road.sectionOffset = 1.5;
      }
    }
    if (kind === "functional-profile") {
      p.roads[1].lanesStart = 3;
      p.roads[1].profile = {
        from: 3,
        to: 5,
        start: 0,
        end: 1,
        transitionStart: 0.2,
        transitionEnd: 0.8,
      };
    }
    const before = structuredClone(p),
      direct = configured(p),
      expected = logicalSnapshot(direct);
    smooth(p);
    const painted = configured(p);
    expect(logicalSnapshot(painted)).toEqual(expected);
    setNodeSmooth(p, node(p), false);
    const restored = configured(p);
    expect(logicalSnapshot(restored)).toEqual(expected);
    expect(p.roads).toEqual(before.roads);
    expect(p.junctionLaneConnections).toEqual(before.junctionLaneConnections);
    expect(p.signals).toEqual(before.signals);
    direct.dispose();
    painted.dispose();
    restored.dispose();
  },
);

it("ignores stale legacy collars throughout raw compilation, entry selection and actual runtime configuration", () => {
  const p = seam(),
    before = configured(p),
    expected = logicalSnapshot(before),
    compile = () =>
      plain(
        compileCs2Network({
          project: p,
          connections: connections(p),
          revision: 7,
        }),
      ),
    directGraph = compile();
  p.roads[1].transitionMode = "smooth";
  p.roads[1].autoTaper = {
    start: { lanes: 3, firstLane: 0, offset: 5, span: 0.3, medianWidth: 0 },
  };
  const stale = structuredClone(p.roads[1].autoTaper),
    source = configured(p);
  expect(compile()).toEqual(directGraph);
  expect(logicalSnapshot(source)).toEqual(expected);
  expect(p.roads[1].autoTaper).toEqual(stale);
  for (const trafficModel of ["legacy", "cs2-derived"] as const) {
    const sim = new Simulation();
    sim.trafficModel = trafficModel;
    sim.configure(p);
    expect(p.roads[1].autoTaper).toEqual(stale);
    const clean = new Simulation();
    clean.trafficModel = trafficModel;
    const q = structuredClone(p);
    delete q.roads[1].autoTaper;
    q.roads[1].transitionMode = "direct";
    clean.configure(q);
    expect(sim.routeCount).toBe(clean.routeCount);
    expect(sim.junctions).toEqual(clean.junctions);
    // Dispose the source branch through its existing edit lifecycle.
    sim.prepareForEditing(p);
    clean.prepareForEditing(q);
  }
  before.dispose();
  source.dispose();
});

it("keeps every target on the original common cross section and retains an authored fifth target and explicit closures", () => {
  const p = seam();
  for (let lane = 0; lane < 3; lane++)
    setJunctionLaneRule(
      p,
      { road: "a", end: 1, lane },
      lane === 0 ? [{ road: "b", end: 0, lane: 4 }] : [],
    );
  const before = configured(p),
    expected = logicalSnapshot(before),
    endpoints = Array.from({ length: 5 }, (_, lane) =>
      lanePoint(p.roads[1], lane, 0),
    );
  expect(new Set(endpoints.map((point) => point.x))).toEqual(new Set([0]));
  expect(endpoints.map((point) => point.z)).toEqual([-8, -4, 0, 4, 8]);
  smooth(p);
  const after = configured(p);
  expect(logicalSnapshot(after)).toEqual(expected);
  expect(after.network!.connectionLaneIds.has("a:0>b:4")).toBe(true);
  expect(after.network!.connectionLaneIds.has("a:1>b:4")).toBe(false);
  expect(
    Array.from({ length: 5 }, (_, lane) => lanePoint(p.roads[1], lane, 0)),
  ).toEqual(endpoints);
  before.dispose();
  after.dispose();
});

it("retains real median, carriageway offset and added-lane effects on the logical network", () => {
  const p = seam(2, 2);
  for (const road of p.roads) {
    road.twoWay = true;
    road.backwardLanesStart = road.backwardLanesEnd = 2;
    road.median = { kind: "concrete", width: 2 };
    road.sectionOffset = 1.5;
  }
  const road = p.roads[1],
    original = configured(p),
    originalGraph = logicalSnapshot(original),
    gap = () => lanePoint(road, 2, 0.5).z - lanePoint(road, 1, 0.5).z;
  expect(gap()).toBe(6);
  road.median!.width = 5;
  expect(gap()).toBe(9);
  const divided = configured(p);
  expect(logicalSnapshot(divided)).not.toEqual(originalGraph);
  const at = lanePoint(road, 2, 0.5);
  road.sectionOffset! += 3;
  expect(lanePoint(road, 2, 0.5).z).toBe(at.z + 3);
  const shifted = configured(p);
  expect(logicalSnapshot(shifted)).not.toEqual(logicalSnapshot(divided));
  road.lanesStart = road.lanesEnd = 3;
  const added = configured(p);
  expect(added.network!.roadLaneIds.has(JSON.stringify(["b", 4]))).toBe(true);
  expect(logicalSnapshot(added)).not.toEqual(logicalSnapshot(shifted));
  for (const sim of [original, divided, shifted, added]) sim.dispose();
});

it.each(["fifth-target", "five-to-three", "signalized"])(
  "keeps real paths, vehicle poses and signal/occupancy state identical while visually toggling %s",
  async (kind) => {
    const p =
        kind === "signalized"
          ? signalized()
          : kind === "five-to-three"
            ? seam(5, 3)
            : seam(),
      target = kind === "fifth-target" ? 4 : kind === "five-to-three" ? 2 : 0,
      from = kind === "five-to-three" ? 4 : 0;
    for (let lane = 0; lane < p.roads[0].lanesStart; lane++)
      setJunctionLaneRule(
        p,
        { road: "a", lane, end: 1 },
        lane === from ? [{ road: "b", lane: target, end: 0 }] : [],
      );
    const reference = configured(p),
      painted = configured(p),
      controllers = [reference.trafficLights, painted.trafficLights],
      network = painted.network,
      runtime = painted.runtime,
      tracker = internal(painted).signalOccupancy;
    const ids = await Promise.all(
      [reference, painted].map((sim) =>
        sim.spawnTrip(p.ports[0], p.ports[1], { lane: from, initialSpeed: 10 }),
      ),
    );
    expect(ids[0]).not.toBeNull();
    expect(ids[1]).toBe(ids[0]);
    reference.running = painted.running = true;
    let samples = 0,
      used = false,
      entered = false;
    for (let tick = 0; tick < 3600 && !reference.completed; tick++) {
      if (tick === 180 || tick === 360) {
        if (tick === 360) reference.running = painted.running = false;
        const frame = painted.frame,
          vehicles = plain(painted.renderVehicles()),
          state = plain(painted.trafficLights.states),
          occupancy = plain(internal(painted).signalOccupancy),
          running = painted.running,
          owner = internal(painted).trips.get(ids[1]!)!.ownerPath;
        setNodeSmooth(internal(painted).project, node(p), tick === 180);
        expect(painted.network).toBe(network);
        expect(painted.runtime).toBe(runtime);
        expect(internal(painted).signalOccupancy).toBe(tracker);
        expect(painted.trafficLights).toBe(controllers[1]);
        expect(internal(painted).trips.get(ids[1]!)!.ownerPath).toBe(owner);
        expect(painted.frame).toBe(frame);
        expect(painted.running).toBe(running);
        expect(plain(painted.renderVehicles())).toEqual(vehicles);
        expect(plain(painted.trafficLights.states)).toEqual(state);
        expect(plain(internal(painted).signalOccupancy)).toEqual(occupancy);
        reference.running = painted.running = true;
      }
      reference.update(1 / 60);
      painted.update(1 / 60);
      const view = painted.runtime!.readVehicle(ids[1]!),
        car = painted.vehicles[0];
      if (view)
        used ||=
          painted.network!.lanes.get(view.current.laneId!)!.connection ===
          `a:${from}>b:${target}`;
      entered ||= !!(
        car &&
        !car.connector &&
        car.route[car.step]?.road === "b" &&
        car.lane === target &&
        car.s > 40
      );
      if (tick % 12 === 0) {
        expect(plain(painted.renderVehicles())).toEqual(
          plain(reference.renderVehicles()),
        );
        expect(plain(painted.trafficLights.states)).toEqual(
          plain(reference.trafficLights.states),
        );
        expect(plain(internal(painted).earlyLanePlans)).toEqual(
          plain(internal(reference).earlyLanePlans),
        );
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(50);
    expect(used).toBe(true);
    expect(entered).toBe(true);
    expect(painted.completed).toBe(1);
    expect(reference.completed).toBe(1);
    expect(painted.failed).toBe(0);
    expect(reference.failed).toBe(0);
    expect(painted.statistics).toEqual(reference.statistics);
    reference.dispose();
    painted.dispose();
  },
  15000,
);
