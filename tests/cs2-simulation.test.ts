import { expect, it } from "vitest";
import { emptyProject, example, makeRoad } from "../src/core/model";
import { v } from "../src/core/math";
import type { Port, Project } from "../src/core/types";
import {
  Cs2TrafficSimulation,
  cs2TrafficUnspawnedState,
} from "../src/simulation/cs2-simulation";
import { buildJunctions } from "../src/core/junctions";
import {
  makeTrafficSignal,
  SIGNAL_STOP_OFFSET,
} from "../src/core/traffic-signals";
import {
  CS2_BASE_CAR,
  CS2_NAVIGATION_TIMESTEP,
} from "../src/simulation/cs2-driving";
import { CS2_NAV_TARGET_FLAGS } from "../src/simulation/cs2-navigation-target";
import type { CS2LaneSpeedWorld } from "../src/simulation/cs2-lane-speed";
import { Cs2PathFlags } from "../src/simulation/cs2-path-policy";
import type {
  CS2PersonalCarState,
  CS2PersonalPathElement,
} from "../src/simulation/cs2-personal-car-ai";
import type { Cs2PathOwner } from "../src/simulation/cs2-path-policy";
import type { Cs2SearchQuery } from "../src/simulation/cs2-path-search";
import { bodiesOverlap } from "../src/simulation/collision";
import {
  Cs2PathService,
  createCs2InProcessTransport,
} from "../src/simulation/cs2-path-service";

function straight(length = 300) {
  const project = emptyProject();
  const road = makeRoad(v(0, 0), v(length, 0), {
    id: "straight",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 60,
  });
  project.roads = [road];
  const source: Port = {
    road: road.id,
    end: "start",
    type: "source",
    rate: 60,
  };
  const sink: Port = { road: road.id, end: "end", type: "sink", rate: 0 };
  project.ports = [source, sink];
  return { project, source, sink };
}
function simulation(project: Project, trace = false) {
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    recordTrace: trace,
  });
  sim.configure(project);
  sim.running = true;
  return sim;
}
function ownerTrip(sim: Cs2TrafficSimulation, id: number) {
  return (
    sim as unknown as {
      trips: Map<
        number,
        {
          owner: Cs2PathOwner;
          ownerPath: CS2PersonalPathElement[];
          ownerState?: CS2PersonalCarState;
        }
      >;
    }
  ).trips.get(id)!;
}
function advanceToFirstOwner(sim: Cs2TrafficSimulation, id: number) {
  for (
    let frame = 0;
    frame < 40 && !sim.runtime!.readVehicle(id)?.motionUpdates;
    frame++
  )
    sim.update(1 / 60);
}

it("runs actual source target/vector motion on physical lanes and completes the full path", async () => {
  const { project, source, sink } = straight();
  project.ports = [];
  const sim = simulation(project, true);
  const id = await sim.spawnTrip(source, sink, { initialSpeed: 5 });
  for (let i = 0; i < 3600 && sim.completed === 0; i++) sim.update(1 / 60);
  expect(
    sim.completed,
    JSON.stringify({
      failed: sim.failed,
      vehicles: sim.vehicles,
      runtime: sim.runtime?.allVehicles(),
    }),
  ).toBe(1);
  expect(sim.failed).toBe(0);
  expect(sim.completedByExit.get("straight:end")).toBe(1);
  expect(
    sim.trace.some((row) => row.id === id && row.phase === "navigation"),
  ).toBe(true);
  expect(sim.trace.some((row) => row.id === id && row.phase === "motion")).toBe(
    true,
  );
  sim.dispose();
});

it("projects an artificial same-road cubic seam to a continuous FixedStart entry", () => {
  const sim = simulation(example("transition")),
    network = sim.network!;
  const pair = [...network.lanes.values()].flatMap((from) => {
    if (from.role === "master" || from.kind !== "road") return [];
    return [...network.groups.values()].flatMap((group) => {
      if (group.kind !== "road" || group.members.length < 2) return [];
      const successors = network.successors.get(from.id) ?? [],
        bad = group.members.find((id) => {
          const next = network.lanes.get(id)!;
          return (
            next.road === from.road &&
            next.direction === from.direction &&
            Math.abs(from.roadInterval![1] - next.roadInterval![0]) < 1e-7 &&
            !successors.includes(id)
          );
        });
      return bad && group.members.some((id) => successors.includes(id))
        ? [{ from, bad }]
        : [];
    });
  })[0];
  expect(pair).toBeDefined();
  const current = {
      laneId: pair.from.id,
      changeLaneId: null,
      curvePosition: { x: 0.5, y: 1, z: 1 },
      lanePosition: 0,
      changeProgress: 0,
      duration: 0,
      distance: 0,
      flags: 0,
    },
    requested = { laneId: pair.bad, start: 0, end: 1, flags: 0x80 };
  expect(network.successors.get(pair.from.id)).not.toContain(pair.bad);
  const [projected] = (sim as any).constrainArtificialSeams(current, [
    requested,
  ]);
  expect(network.successors.get(pair.from.id)).toContain(projected.laneId);
  expect(projected.flags & 0x800000).not.toBe(0);
  expect(projected.flags & 0x80).toBe(0x80);
  // Actual node/road transitions keep the source selector's physical choice.
  const connector = [...network.lanes.values()].find(
    (lane) => lane.kind === "connection" && lane.role !== "master",
  )!;
  const nodeRequest = { ...requested, laneId: connector.id };
  expect((sim as any).constrainArtificialSeams(current, [nodeRequest])[0]).toBe(
    nodeRequest,
  );
  sim.dispose();
});

it("carries source turn metadata so an explicit ramp trip selects its lane before node entry", async () => {
  const p = example("transition");
  p.trafficMultiplier = 4;
  for (const port of p.ports)
    if (port.type === "source" || port.type === "both") port.rate = 60;
  const sim = simulation(p),
    ramp = p.roads.find((road) => road.kind === "ramp")!,
    tripId = await sim.spawnTrip(
      p.ports.find((port) => port.type === "source")!,
      p.ports.find((port) => port.road === ramp.id)!,
      { lane: 1, initialSpeed: 10 },
    ),
    runtime = sim.runtime!,
    original = runtime.stepFrame.bind(runtime),
    evidence: { frame: number; connected: boolean; turnFlags: number }[] = [];
  runtime.stepFrame = (frame, decide) =>
    original(frame, (input, context) => {
      const decision = decide(input, context),
        current = decision.current ?? input.current,
        queue = decision.nextLanes ?? input.nextLanes,
        lane = sim.network!.lanes.get(current.laneId!),
        next = sim.network!.lanes.get(queue[0]?.laneId);
      // The explicit destination keeps this regression independent of changes
      // in the source systems' global RandomSeed.Next() call sequence.
      if (
        input.id === tripId &&
        lane?.kind === "road" &&
        next?.kind === "connection" &&
        next.to?.road === ramp.id &&
        current.curvePosition.x > 0.7
      ) {
        evidence.push({
          frame,
          connected:
            !!current.changeLaneId ||
            (sim.network!.successors.get(lane.id) ?? []).includes(next.id),
          turnFlags:
            queue[0].flags &
            (CS2_NAV_TARGET_FLAGS.TurnLeft | CS2_NAV_TARGET_FLAGS.TurnRight),
        });
      }
      return decision;
    });
  for (let frame = 0; frame < 1040; frame++) sim.update(1 / 60);
  expect(evidence.length).toBeGreaterThan(2);
  expect(
    evidence.every((row) => row.connected && row.turnFlags !== 0),
    JSON.stringify(evidence),
  ).toBe(true);
  sim.dispose();
});

it("keeps four-slot display interpolation separate from physical state", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project);
  await sim.spawnTrip(source, sink, { initialSpeed: 10 });
  sim.update(1);
  const physical = structuredClone(sim.vehicles[0]);
  const render = sim.renderVehicles(0.5)[0];
  expect(render.position).not.toEqual(physical.position);
  expect(sim.vehicles[0]).toEqual(physical);
  expect(sim.runtime!.allVehicles()[0].frames).toHaveLength(4);
  sim.dispose();
});

it("uses source update groups and the navigation→owner AI→motion ordering", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project, true);
  await sim.spawnTrip(source, sink);
  sim.update(1);
  const view = sim.runtime!.allVehicles()[0];
  expect(view.navigationUpdates).toBe(view.motionUpdates);
  expect(view.navigationUpdates).toBeGreaterThanOrEqual(3);
  for (const frame of new Set(
    sim.trace
      .filter((row) => row.id === view.id && row.phase === "navigation")
      .map((row) => row.frame),
  )) {
    expect(frame & 15).toBe(view.updateGroup);
    expect(
      sim.trace
        .filter((row) => row.id === view.id && row.frame === frame)
        .map((row) => row.phase),
    ).toEqual(["navigation", "ai", "motion"]);
  }
  sim.dispose();
});

it("maps 0..400 percent demand to arrivals without treating failed paths as completed", () => {
  const a = straight(2000),
    b = structuredClone(a.project);
  const low = simulation(a.project),
    high = simulation(b);
  low.setTrafficMultiplier(1);
  high.setTrafficMultiplier(4);
  for (let frame = 0; frame < 600; frame++) {
    low.update(1 / 60);
    high.update(1 / 60);
  }
  expect(low.generated).toBe(10);
  expect(high.generated).toBe(40);
  high.setTrafficMultiplier(0);
  const generated = high.generated;
  high.update(1);
  expect(high.generated).toBe(generated);
  low.dispose();
  high.dispose();
});

function crossing(signal = false) {
  const project = emptyProject(),
    opts = { twoWay: true, lanesStart: 2, lanesEnd: 2, speed: 60 };
  project.roads = [
    makeRoad(v(-160, 0), v(0, 0), { ...opts, id: "west" }),
    makeRoad(v(0, 0), v(160, 0), { ...opts, id: "east" }),
    makeRoad(v(0, -160), v(0, 0), { ...opts, id: "north" }),
    makeRoad(v(0, 0), v(0, 160), { ...opts, id: "south" }),
  ];
  if (signal) {
    const config = makeTrafficSignal(buildJunctions(project)[0]);
    // This scenario specifically verifies the original demand-actuated controller.
    config.mode = "cs2";
    project.signals = [config];
  }
  return project;
}
const boundary = (
  road: string,
  end: "start" | "end",
  type: "source" | "sink",
): Port => ({ road, end, type, rate: 0 });

it("crosses a real connection lane under source automatic traffic lights", async () => {
  const sim = simulation(crossing(true), true);
  expect(sim.trafficLights.states[0].phases).toHaveLength(2);
  await sim.spawnTrip(
    boundary("west", "start", "source"),
    boundary("east", "end", "sink"),
    { initialSpeed: 8 },
  );
  await sim.spawnTrip(
    boundary("north", "start", "source"),
    boundary("south", "end", "sink"),
    { initialSpeed: 8 },
  );
  const seen = new Set<number>();
  for (let i = 0; i < 7200 && sim.completed < 2; i++) {
    sim.update(1 / 60);
    seen.add(sim.trafficLights.states[0].phase);
    if (sim.vehicles.length === 2)
      expect(bodiesOverlap(sim.vehicles[0], sim.vehicles[1], 0)).toBe(false);
  }
  expect(
    sim.completed,
    JSON.stringify({
      failed: sim.failed,
      vehicles: sim.vehicles,
      runtime: sim.runtime?.allVehicles(),
    }),
  ).toBe(2);
  expect(sim.failed).toBe(0);
  expect(seen.size).toBe(2);
  expect(sim.statistics.junctionEntries).toBe(2);
  sim.dispose();
});

it("refills a 12-lane lookahead without deleting at an intermediate buffer end", async () => {
  const { project, source, sink } = straight(600);
  project.ports = [];
  project.roads[0].knots = Array.from({ length: 31 }, (_, i) => ({
    p: v(i * 20, 0),
    incoming: v(i * 20 - (i ? 20 / 3 : 0), 0),
    outgoing: v(i * 20 + (i < 30 ? 20 / 3 : 0), 0),
    at: i / 30,
  }));
  const sim = simulation(project);
  await sim.spawnTrip(source, sink, { initialSpeed: 5 });
  let maximum = 0,
    passedWindow = false;
  for (let i = 0; i < 6000 && sim.completed < 1; i++) {
    sim.update(1 / 60);
    const vehicle = sim.runtime!.allVehicles()[0];
    if (vehicle) {
      maximum = Math.max(maximum, vehicle.nextLanes.length);
      if (sim.vehicles[0].s > 300) passedWindow = true;
    }
  }
  expect(sim.network!.graph.edges.length).toBeGreaterThan(12);
  expect(maximum).toBeLessThanOrEqual(12);
  expect(passedWindow).toBe(true);
  expect(sim.completed).toBe(1);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("records source path failure and Stuck deletion separately from completed trips", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project);
  await sim.spawnTrip({ ...source, road: "missing" }, sink);
  sim.update(0.1);
  expect(sim.failed).toBe(1);
  expect(sim.completed).toBe(0);
  await sim.spawnTrip(source, sink);
  sim.update(0.1);
  sim.vehicles[0].sourcePath!.flags |= Cs2PathFlags.Stuck;
  sim.update(1);
  expect(sim.failed).toBe(2);
  expect(sim.completed).toBe(0);
  expect(sim.vehicles).toHaveLength(0);
  sim.dispose();
});

it("keeps Updated until full owner ResetPath writes CarFlags before motion", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project, true),
    runtime = sim.runtime!,
    original = runtime.stepFrame.bind(runtime);
  runtime.stepFrame = (frame, decide) =>
    original(frame, (vehicle, context) => ({
      ...decide(vehicle, context),
      carFlags: 2,
    }));
  const id = (await sim.spawnTrip(source, sink, { initialSpeed: 5 }))!;
  sim.update(2 / 60);
  expect(ownerTrip(sim, id).owner.flags & Cs2PathFlags.Updated).not.toBe(0);
  advanceToFirstOwner(sim, id);
  expect(ownerTrip(sim, id).owner.flags & Cs2PathFlags.Updated).toBe(0);
  // DummyTraffic is not Transporting, so the complete source ResetPath clears
  // StayOnRoad. The old hand-written failure/arrival prefix never did this.
  expect((runtime.readVehicle(id)!.carFlags ?? 0) & 2).toBe(0);
  expect(ownerTrip(sim, id).ownerState!.personalCar.flags).toBe(8);
  expect(ownerTrip(sim, id).ownerState!.path).toEqual(
    ownerTrip(sim, id).ownerPath,
  );
  sim.dispose();
});

it("plays owner Deleted after the final same-frame CarMove at EndFrameBarrier", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project, true),
    runtime = sim.runtime!,
    id = (await sim.spawnTrip(source, sink, { initialSpeed: 5 }))!;
  advanceToFirstOwner(sim, id);
  const previous = runtime.readVehicle(id)!.motionUpdates,
    originalRemove = runtime.removeVehicle.bind(runtime);
  let removed:
    { frame: number; lastMotion: number | null; updates: number } | undefined;
  runtime.removeVehicle = (entity) => {
    const view = runtime.readVehicle(entity)!;
    removed = {
      frame: sim.frame,
      lastMotion: view.lastMotionFrame,
      updates: view.motionUpdates,
    };
    return originalRemove(entity);
  };
  ownerTrip(sim, id).owner.flags |= Cs2PathFlags.Stuck;
  for (let frame = 0; frame < 40 && !removed; frame++) sim.update(1 / 60);
  expect(removed).toBeDefined();
  expect(removed!.lastMotion).toBe(removed!.frame);
  expect(removed!.updates).toBe(previous + 1);
  expect(
    sim.ownerCommandTrace.some(
      (entry) =>
        entry.frame === removed!.frame &&
        entry.owner === id &&
        entry.command.kind === "add-component" &&
        entry.command.component === "Deleted",
    ),
  ).toBe(true);
  expect(sim.failed).toBe(1);
  expect(sim.completed).toBe(0);
  expect(runtime.readVehicle(id)).toBeUndefined();
  sim.dispose();
});

it("does not count owner deletion for an invalid target as an exit or path failure", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    recordTrace: true,
    personalCarWorld: (world) => ({
      ...world,
      entities: new Set(
        [...world.entities].filter((id) => !id.startsWith("outside:")),
      ),
    }),
  });
  sim.configure(project);
  sim.running = true;
  const id = (await sim.spawnTrip(source, sink))!;
  for (let frame = 0; frame < 40; frame++) sim.update(1 / 60);
  expect(sim.entered).toBe(1);
  expect(sim.runtime!.readVehicle(id)).toBeUndefined();
  expect(
    sim.ownerCommandTrace.some(
      (entry) =>
        entry.command.kind === "add-component" &&
        entry.command.component === "Deleted",
    ),
  ).toBe(true);
  expect(sim.completed).toBe(0);
  expect(sim.failed).toBe(0);
  expect(sim.completedByExit.size).toBe(0);
  sim.dispose();
});

it("retains parked owner state and all conversion commands for a non-Dummy failed personal car", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project, true),
    id = (await sim.spawnTrip(source, sink))!;
  advanceToFirstOwner(sim, id);
  const trip = ownerTrip(sim, id);
  trip.ownerState!.personalCar = { keeper: null, flags: 0 };
  trip.owner.flags |= Cs2PathFlags.Stuck;
  for (let frame = 0; frame < 40 && !sim.parkedOwners.has(id); frame++)
    sim.update(1 / 60);
  expect(sim.runtime!.readVehicle(id)).toBeUndefined();
  expect(sim.completed).toBe(0);
  expect(sim.failed).toBe(0);
  expect(sim.parkedOwners.get(id)!.personalCar.flags).toBe(0);
  expect(sim.parkedOwners.get(id)!.path).toEqual([]);
  expect(sim.ownerComponents.get(String(id))!.has("ParkedCar")).toBe(true);
  expect(
    sim.ownerComponents.get(String(id))!.get("FixParkingLocation")!
      .resetLocation,
  ).toBe(String(id));
  const removals = sim.ownerCommandTrace.find(
    (entry) => entry.owner === id && entry.command.kind === "remove-components",
  )!.command;
  expect(
    removals.kind === "remove-components" && removals.components,
  ).toContain("Moving");
  expect(
    removals.kind === "remove-components" && removals.components,
  ).toContain("PathElement");
  expect(
    sim.ownerCommandTrace.some(
      (entry) =>
        entry.owner === id &&
        entry.command.kind === "set-component" &&
        entry.command.component === "ParkedCar",
    ),
  ).toBe(true);
  sim.dispose();
});

it("submits the full source owner path parameters from the post-navigation current lane", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = simulation(project, true),
    id = (await sim.spawnTrip(source, sink, { initialSpeed: 5 }))!;
  advanceToFirstOwner(sim, id);
  const internals = sim as unknown as {
      requestPath: (
        query: Cs2SearchQuery,
        ...rest: unknown[]
      ) => Promise<unknown>;
    },
    original = internals.requestPath.bind(sim),
    submitted: Cs2SearchQuery[] = [];
  internals.requestPath = (query, ...rest) => {
    submitted.push(structuredClone(query));
    return original(query, ...rest);
  };
  ownerTrip(sim, id).owner.flags |= Cs2PathFlags.Obsolete;
  for (let frame = 0; frame < 40 && submitted.length === 0; frame++)
    sim.update(1 / 60);
  const command = sim.ownerCommandTrace.find(
    (entry) => entry.owner === id && entry.command.kind === "pathfind",
  )!.command;
  expect(command.kind).toBe("pathfind");
  if (command.kind !== "pathfind")
    throw new Error("Expected source pathfind command");
  expect(submitted).toHaveLength(1);
  expect(submitted[0].parameters.ignoredRules).toBe(64 | 8 | 32);
  expect(submitted[0].parameters.weights).toEqual(command.parameters.weights);
  expect(submitted[0].parameters.maxSpeed).toEqual(command.parameters.maxSpeed);
  expect(submitted[0].parameters.methods).toBe(command.parameters.methods);
  const state = ownerTrip(sim, id).ownerState!;
  expect(submitted[0].start[0].target).toBe(state.current.laneId);
  expect(submitted[0].start[0].delta).toBe(state.current.curvePosition.x);
  expect(state.current.flags & 256).not.toBe(0);
  expect(ownerTrip(sim, id).owner.flags & Cs2PathFlags.Pending).not.toBe(0);
  sim.dispose();
});

it("preserves a missing native parking dependency and pauses without committing partial owner state", async () => {
  const { project, source, sink } = straight(2000);
  project.ports = [];
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    recordTrace: true,
    personalCarWorld: (world) => {
      const current = sim.runtime!.readVehicles()[0]?.current.laneId,
        lanes = new Map(world.lanes);
      if (current)
        lanes.set(current, { ...lanes.get(current), parking: { fee: 0 } });
      return { ...world, lanes };
    },
  });
  sim.configure(project);
  sim.running = true;
  const id = (await sim.spawnTrip(source, sink))!;
  sim.update(1);
  const pending = sim.pendingOwnerQueries.get(id)!;
  expect(pending.request.kind).toBe("reset-parking-lane-status");
  expect(pending.request.state.pathOwner.flags & Cs2PathFlags.Updated).toBe(0);
  expect(ownerTrip(sim, id).owner.flags & Cs2PathFlags.Updated).not.toBe(0);
  expect(ownerTrip(sim, id).ownerState).toBeUndefined();
  expect(sim.running).toBe(false);
  expect(sim.ownerCommandTrace).toEqual([]);
  expect(sim.runtime!.readVehicle(id)!.motionUpdates).toBe(0);
  const pausedFrame = sim.frame;
  sim.running = true;
  sim.update(1);
  expect(sim.frame).toBe(pausedFrame);
  expect(sim.completed).toBe(0);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("adopts explicit Step vehicles through source vector motion while preserving object references", () => {
  const { project } = straight(2000);
  project.ports = [];
  const sim = simulation(project);
  const car = {
    id: 7,
    route: [{ road: "straight", direction: 1 as const, inLane: 0, outLane: 0 }],
    step: 0,
    s: 10,
    lane: 0,
    speed: 5,
    age: 0,
    color: 0,
    position: v(10, 0),
    heading: Math.PI / 2,
    pitch: 0,
  };
  sim.adoptVehicles([car]);
  sim.update(1);
  expect(sim.vehicles[0]).toBe(car);
  expect(car.s).toBeGreaterThan(10);
  expect(sim.runtime!.allVehicles()[0].motionUpdates).toBeGreaterThan(0);
  sim.dispose();
});

it("produces identical source physical frames across different render delta sizes", () => {
  const { project } = straight(2000);
  project.ports = [];
  const run = (delta: number, count: number) => {
    const sim = simulation(project);
    sim.adoptVehicles([
      {
        id: 3,
        route: [{ road: "straight", direction: 1, inLane: 0, outLane: 0 }],
        step: 0,
        s: 20,
        lane: 0,
        speed: 5,
        age: 0,
        color: 0,
        position: v(20, 0),
        heading: Math.PI / 2,
        pitch: 0,
      },
    ]);
    for (let i = 0; i < count; i++) sim.update(delta);
    const state = {
      physical: sim.runtime!.allVehicles()[0],
      elapsed: sim.elapsed,
      completed: sim.completed,
    };
    sim.dispose();
    return state;
  };
  expect(run(1 / 60, 600)).toEqual(run(0.05, 200));
});

it("drives a 2→3 lane expansion and exits through the physical outer 1-lane ramp", async () => {
  const project = example("transition"),
    source = project.ports.find((p) => p.type === "source")!,
    sink = project.ports.find(
      (p) => project.roads.find((r) => r.id === p.road)?.kind === "ramp",
    )!;
  project.ports = [];
  const sim = simulation(project);
  await sim.spawnTrip(source, sink, { initialSpeed: 8 });
  for (let frame = 0; frame < 7200 && sim.completed < 1; frame++)
    sim.update(1 / 60);
  expect(
    sim.completed,
    JSON.stringify({
      failed: sim.failed,
      vehicles: sim.vehicles,
      runtime: sim.runtime?.allVehicles(),
    }),
  ).toBe(1);
  expect(sim.completedByExit.get(`${sink.road}:end`)).toBe(1);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("keeps boundary and trip accounting under 100% and 400% source-driven crossing demand", () => {
  const summaries = [];
  for (const multiplier of [1, 4]) {
    const project = crossing(true);
    project.ports = ["west", "east", "north", "south"].map((road) => ({
      road,
      end: road === "east" || road === "south" ? "end" : "start",
      type: "both",
      rate: 24,
    }));
    const sim = simulation(project);
    sim.setTrafficMultiplier(multiplier);
    for (let frame = 0; frame < 3600; frame++) sim.update(1 / 60);
    expect(sim.generated).toBe(96 * multiplier);
    expect(sim.entered + sim.waiting).toBe(sim.generated);
    expect(sim.completed + sim.failed + sim.vehicles.length).toBe(sim.entered);
    expect(sim.completed).toBeGreaterThan(0);
    expect(
      sim
        .runtime!.allVehicles()
        .every((vehicle) =>
          Object.values(vehicle.state.position).every(Number.isFinite),
        ),
    ).toBe(true);
    summaries.push({
      multiplier,
      generated: sim.generated,
      entered: sim.entered,
      completed: sim.completed,
      failed: sim.failed,
      vehicles: sim.vehicles.length,
      waiting: sim.waiting,
      queued: sim.queued,
    });
    sim.dispose();
  }
  expect(summaries).toHaveLength(2);
}, 60000);

it("publishes path probes while paused so the editor can start a connected network", async () => {
  const { project } = straight();
  const sim = new Cs2TrafficSimulation({
    pathService: new Cs2PathService({
      transport: createCs2InProcessTransport(),
    }),
  });
  sim.configure(project);
  await sim.waitForPaths();
  expect(sim.frame).toBe(0);
  expect(sim.running).toBe(false);
  expect(sim.routeCount).toBe(1);
  expect(sim.pendingPathCount).toBe(0);
  sim.dispose();
});

it("synchronizes live boundary rate and multiplier without resetting source state or admitting disabled demand", () => {
  const { project } = straight(2000),
    sim = simulation(project);
  sim.update(2);
  const frame = sim.frame,
    generated = sim.generated,
    entered = sim.entered,
    current = sim.runtime!.allVehicles()[0];
  sim.syncDemand(project.ports, 0);
  sim.update(1);
  expect(sim.generated).toBe(generated);
  expect(sim.entered).toBe(entered);
  expect(sim.waiting).toBe(0);
  expect(sim.frame).toBe(frame + 60);
  expect(sim.runtime!.getVehicle(current.id)!.motionUpdates).toBeGreaterThan(
    current.motionUpdates,
  );
  sim.syncDemand(project.ports, 2);
  sim.setPortRate("straight", "start", 120);
  sim.update(1);
  expect(sim.generated).toBe(generated + 4);
  expect(sim.elapsed).toBe(4);
  sim.dispose();
});

it("projects Unity +Z-forward rotations into RoadLab +X-long-axis headings in all four directions", async () => {
  for (const [x, z, heading] of [
    [200, 0, 0],
    [0, 200, Math.PI / 2],
    [-200, 0, Math.PI],
    [0, -200, -Math.PI / 2],
  ]) {
    const project = emptyProject();
    project.roads = [
      makeRoad(v(0, 0), v(x, z), {
        id: "orientation",
        lanesStart: 1,
        lanesEnd: 1,
      }),
    ];
    const sim = simulation(project);
    await sim.spawnTrip(
      boundary("orientation", "start", "source"),
      boundary("orientation", "end", "sink"),
      { initialSpeed: 5 },
    );
    sim.update(2 / 60);
    expect(Math.cos(sim.vehicles[0].heading)).toBeCloseTo(Math.cos(heading), 5);
    expect(Math.sin(sim.vehicles[0].heading)).toBeCloseTo(Math.sin(heading), 5);
    expect(sim.vehicles[0].pitch).toBeCloseTo(0, 5);
    sim.dispose();
  }
});

it("keeps source Unspawned component transitions in owner AI, including parking/transform holds", () => {
  const F = CS2_NAV_TARGET_FLAGS;
  expect(cs2TrafficUnspawnedState(F.ResetSpeed, false)).toBe(true);
  expect(cs2TrafficUnspawnedState(F.Connection, false)).toBe(true);
  expect(cs2TrafficUnspawnedState(F.TransformTarget, true)).toBe(true);
  expect(cs2TrafficUnspawnedState(F.ParkingSpace, true)).toBe(true);
  expect(cs2TrafficUnspawnedState(0, true)).toBe(false);
  expect(cs2TrafficUnspawnedState(F.TransformTarget, false)).toBe(false);
});

it("uses the external-spawner ResetSpeed range and keeps its entity in simulation while hidden", () => {
  const { project } = straight(2000),
    sim = simulation(project);
  for (let frame = 0; frame < 100 && sim.entered === 0; frame++)
    sim.update(1 / 60);
  expect(sim.entered).toBe(1);
  sim.setPortRate("straight", "start", 0);
  const id = sim.vehicles[0].id;
  expect(sim.unspawnedIds.has(id)).toBe(true);
  expect(sim.renderVehicles()).toHaveLength(0);
  let view = sim.runtime!.getVehicle(id)!;
  for (let frame = 0; frame < 20 && !view.motionUpdates; frame++) {
    sim.update(1 / 60);
    view = sim.runtime!.getVehicle(id)!;
  }
  expect(view.current.flags & CS2_NAV_TARGET_FLAGS.ResetSpeed).not.toBe(0);
  expect(sim.vehicles[0].speed).toBeGreaterThan(
    CS2_BASE_CAR.acceleration * CS2_NAVIGATION_TIMESTEP,
  );
  const world = (sim as unknown as { speedWorld: CS2LaneSpeedWorld })
    .speedWorld;
  expect(world.objects.has(String(id))).toBe(true);
  expect(
    [...world.lanes.values()].some((lane) =>
      lane.objects?.some((object) => object.object === String(id)),
    ),
  ).toBe(true);
  for (let frame = 0; frame < 300 && sim.unspawnedIds.has(id); frame++)
    sim.update(1 / 60);
  expect(sim.unspawnedIds.has(id)).toBe(false);
  expect(sim.renderVehicles()).toHaveLength(1);
  expect(sim.statistics.safetyStops).toBe(0);
  sim.dispose();
});

it("uses the displayed signal stopline as the shared road/node geometry boundary", () => {
  const project = crossing(true),
    sim = simulation(project),
    junction = buildJunctions(project)[0],
    arm = junction.arms.find((arm) => arm.road === "west")!;
  const road = project.roads.find((road) => road.id === "west")!,
    travelEnd = 160 - arm.trim - SIGNAL_STOP_OFFSET;
  const lane = sim.network!.locateRoadLane("west", 2, travelEnd);
  expect(lane?.curveT).toBeCloseTo(1, 5);
  expect(
    sim.network!.locateRoadLane("west", 2, travelEnd + 0.1),
  ).toBeUndefined();
  expect(
    sim.network!.warnings.filter((warning) =>
      warning.includes("endpoint mismatch"),
    ),
  ).toEqual([]);
  expect(road.knots[1].p.x).toBe(0);
  sim.dispose();
});
