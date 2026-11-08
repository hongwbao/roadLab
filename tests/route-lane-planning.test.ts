import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { emptyProject, makeRoad, parseProject } from "../src/core/model";
import { lanePoint, v } from "../src/core/math";
import type { Vehicle } from "../src/simulation/simulation";
import { bodiesOverlap } from "../src/simulation/collision";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import { Cs2PathFlags } from "../src/simulation/cs2-path-policy";
import {
  buildEarlyLanePlan,
  chooseEarlyLane,
  laneLookaheadEnd,
} from "../src/simulation/early-lane-planning";
import type {
  Cs2CompiledNetwork,
  Cs2NetworkPathGroup,
} from "../src/simulation/cs2-network";

function fixture(custom = true) {
  const project = emptyProject();
  const approach = makeRoad(v(), v(1000, 0), {
    id: "approach",
    lanesStart: 4,
    lanesEnd: 4,
    speed: 60,
  });
  const exit = makeRoad(v(1000, 0), v(1000, 250), {
    id: "exit",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 40,
  });
  project.roads = [approach, exit];
  if (custom)
    project.junctionLaneConnections = [0, 1, 2, 3].map((lane) => ({
      from: { road: approach.id, end: 1 as const, lane },
      to: lane === 3 ? [{ road: exit.id, end: 0 as const, lane: 0 }] : [],
    }));
  const car = (id: number, lane: number, s = 150): Vehicle => ({
    id,
    route: [
      { road: approach.id, direction: 1, inLane: lane, outLane: 3 },
      { road: exit.id, direction: 1, inLane: 0, outLane: 0 },
    ],
    step: 0,
    s,
    lane,
    speed: 15,
    age: 0,
    color: 0,
    position: lanePoint(approach, lane, s / 1000),
    heading: Math.PI / 2,
    pitch: 0,
  });
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  sim.running = true;
  return { project, approach, exit, car, sim };
}

it("checks a moving 500m frontier through multiple roads and connectors, including future lateral moves", () => {
  const groups: Cs2NetworkPathGroup[] = [0, 1, 2, 3].map(
    (i) =>
      ({
        group: `g${i}`,
        laneIds: [0, 1, 2, 3].map((j) => `${i}:${j}`),
        interval: [0, 1],
        navigation: { lanes: [] },
      }) as Cs2NetworkPathGroup,
  );
  const lanes = new Map(
    groups.flatMap((g, i) =>
      g.laneIds.map((id) => [id, { curve: { length: i === 1 ? 20 : 200 } }]),
    ),
  );
  const successors = new Map(
    groups.flatMap((g, i) =>
      g.laneIds.map((id, j) => [
        id,
        i < 2
          ? [groups[i + 1].laneIds[j]]
          : i === 2 && j === 3
            ? groups[3].laneIds
            : [],
      ]),
    ),
  );
  const network = {
    lanes,
    successors,
    groups: new Map(groups.map((g, i) => [g.group, { allowChange: i !== 1 }])),
  } as unknown as Cs2CompiledNetwork;
  expect(laneLookaheadEnd(network, groups, 0, 600, 500)).toBe(0);
  expect(laneLookaheadEnd(network, groups, 0, 300, 500)).toBe(2);
  expect(laneLookaheadEnd(network, groups, 0, 280, 500)).toBe(3);
  const plan = buildEarlyLanePlan(network, groups, 0, 3)!;
  expect(plan.allowed).toEqual(["0:3"]);
  expect(plan.distanceAfterCurrent).toBe(220);
  expect(chooseEarlyLane(plan, groups[0].laneIds, "0:0", 280, 15, 500)).toBe(
    "0:1",
  );
  expect(
    chooseEarlyLane(plan, groups[0].laneIds, "0:0", 281, 15, 500),
  ).toBeNull();
});

it.each([true, false])(
  "prepares within 500m for %s custom/automatic connections, using only adjacent moves",
  (custom) => {
    const { sim, car } = fixture(custom);
    sim.adoptVehicles([car(1, 0)]);
    const starts: number[] = [],
      targets: number[] = [],
      roads: string[] = [];
    let previous: number | undefined,
      lastChange = 0,
      stoppedNearExit = 0;
    for (let i = 0; i < 2200 && !sim.completed; i++) {
      sim.update(0.05);
      const c = sim.vehicles[0];
      if (!c) continue;
      const road = c.route[c.step]?.road;
      if (roads.at(-1) !== road) roads.push(road);
      if (road !== "approach") continue;
      if (c.s > 970 && c.speed < 0.2) stoppedNearExit += 0.05;
      if (c.laneChange) {
        expect(Math.abs(c.laneChange.to - c.laneChange.from)).toBe(1);
        lastChange = c.s;
        if (previous !== c.laneChange.to) {
          starts.push(c.s);
          targets.push(c.laneChange.to);
        }
        previous = c.laneChange.to;
      }
    }
    expect(starts.length).toBeGreaterThan(0);
    expect(starts[0]).toBeGreaterThan(470);
    expect(starts[0]).toBeLessThan(560);
    expect(lastChange).toBeLessThan(970);
    expect(targets).toEqual([1, 2, 3]);
    expect(roads).toEqual(["approach", "exit"]);
    expect(stoppedNearExit).toBe(0);
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    sim.dispose();
  },
);

it("coordinates four parallel cars upstream without overlapping or stopping to change at the junction", () => {
  const { sim, car } = fixture();
  sim.adoptVehicles([0, 1, 2, 3].map((lane) => car(lane + 1, lane)));
  let overlap = 0,
    stoppedNearExit = 0;
  const final: Record<
    number,
    { s: number; lane: number; step: number; speed: number }
  > = {};
  for (let i = 0; i < 2400 && sim.completed < 4; i++) {
    sim.update(0.05);
    const cars = sim.renderVehicles();
    for (let a = 0; a < cars.length; a++)
      for (let b = a + 1; b < cars.length; b++)
        if (bodiesOverlap(cars[a], cars[b], 0)) overlap++;
    for (const c of cars) {
      final[c.id] = { s: c.s, lane: c.lane, step: c.step, speed: c.speed };
      if (c.route[c.step]?.road === "approach" && c.s > 970 && c.speed < 0.2)
        stoppedNearExit += 0.05;
      if (c.laneChange)
        expect(Math.abs(c.laneChange.to - c.laneChange.from)).toBe(1);
    }
  }
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/route-lane-parallel.json",
    JSON.stringify(
      {
        completed: sim.completed,
        failed: sim.failed,
        overlap,
        stoppedNearExit,
        final,
      },
      null,
      2,
    ),
  );
  expect(overlap).toBe(0);
  expect(stoppedNearExit).toBe(0);
  expect(sim.completed).toBe(4);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("retains the original macro path when the source owner requests a path repair", async () => {
  const { sim, approach, exit } = fixture();
  const id = (await sim.spawnTrip(
    { road: approach.id, end: "start", type: "source", rate: 0 },
    { road: exit.id, end: "end", type: "sink", rate: 0 },
    { lane: 0, initialSpeed: 15 },
  ))!;
  for (let i = 0; i < 10; i++) sim.update(0.05);
  const trip = (sim as any).trips.get(id),
    original = structuredClone(trip.fixedPath);
  expect(original.length).toBeGreaterThan(2);
  trip.owner.flags |= Cs2PathFlags.Obsolete;
  for (let i = 0; i < 200; i++) sim.update(0.05);
  expect(trip.fixedPath).toEqual(original);
  expect(trip.fixedRoads).toEqual([approach.id, exit.id]);
  expect(
    trip.path.every((step: any) =>
      original.some((fixed: any) => fixed.owner === step.owner),
    ),
  ).toBe(true);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("validates and saves the configurable horizon, and live changes preserve vehicles and time", () => {
  const { project, sim, car } = fixture();
  expect(parseProject(JSON.stringify(project)).laneLookahead).toBeUndefined();
  project.laneLookahead = 750;
  expect(parseProject(JSON.stringify(project)).laneLookahead).toBe(750);
  for (const bad of [99, 2001, NaN])
    expect(sim.setLaneLookahead(bad)).toBe(false);
  for (const bad of [0, 2001])
    expect(() =>
      parseProject(JSON.stringify({ ...project, laneLookahead: bad })),
    ).toThrow();
  sim.adoptVehicles([car(1, 0)]);
  sim.update(0.5);
  const elapsed = sim.elapsed,
    ids = sim.vehicles.map((c) => c.id);
  expect(sim.setLaneLookahead(900)).toBe(true);
  expect(sim.elapsed).toBe(elapsed);
  expect(sim.vehicles.map((c) => c.id)).toEqual(ids);
  sim.update(0.5);
  expect(sim.vehicles[0].laneChange?.to).toBe(1);
  sim.dispose();
});

it("prepares across fitted curve pieces and an intervening road before a custom lane restriction", () => {
  const project = emptyProject();
  const approach = makeRoad(
    v(),
    v(650, 0),
    { id: "curved", lanesStart: 4, lanesEnd: 4, speed: 60 },
    v(200, 150),
    v(450, 0),
  );
  const bridge = makeRoad(v(650, 0), v(800, 0), {
    id: "bridge",
    lanesStart: 4,
    lanesEnd: 4,
    speed: 60,
  });
  const exit = makeRoad(v(800, 0), v(800, 180), {
    id: "exit",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 40,
  });
  project.roads = [approach, bridge, exit];
  project.junctionLaneConnections = [0, 1, 2, 3].map((lane) => ({
    from: { road: bridge.id, end: 1 as const, lane },
    to: lane === 3 ? [{ road: exit.id, end: 0 as const, lane: 0 }] : [],
  }));
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  sim.adoptVehicles([
    {
      id: 1,
      route: [
        { road: approach.id, direction: 1, inLane: 0, outLane: 3 },
        { road: bridge.id, direction: 1, inLane: 3, outLane: 3 },
        { road: exit.id, direction: 1, inLane: 0, outLane: 0 },
      ],
      step: 0,
      s: 20,
      lane: 0,
      speed: 15,
      age: 0,
      color: 0,
      position: lanePoint(approach, 0, 0.02),
      heading: Math.PI / 2,
      pitch: 0,
    },
  ]);
  const n = (sim as any).network;
  expect(
    [...n.groups.values()].filter(
      (g: any) => n.lanes.get(g.members[0])?.road === approach.id,
    ).length,
  ).toBeGreaterThan(1);
  sim.running = true;
  let changedUpstream = false;
  const roads: string[] = [];
  for (let i = 0; i < 2400 && !sim.completed; i++) {
    sim.update(0.05);
    const c = sim.vehicles[0];
    if (!c) continue;
    const road = c.route[c.step]?.road;
    if (roads.at(-1) !== road) roads.push(road);
    if (c.laneChange) {
      expect(Math.abs(c.laneChange.to - c.laneChange.from)).toBe(1);
      if (road === approach.id) changedUpstream = true;
    }
  }
  expect(changedUpstream).toBe(true);
  expect(roads).toEqual([approach.id, bridge.id, exit.id]);
  expect(sim.completed).toBe(1);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it("finishes an aligned lane change at a short road endpoint instead of blocking the navigator overrun", () => {
  const { project, approach, exit, sim, car } = fixture();
  approach.knots[1].p.x = 60;
  approach.knots[1].incoming.x = 40;
  approach.knots[0].outgoing.x = 20;
  exit.knots.forEach((k) => {
    k.p.x = 60;
    k.incoming.x = 60;
    k.outgoing.x = 60;
  });
  sim.configure(project);
  const c = car(1, 2, 40);
  c.position = lanePoint(approach, 2, 40 / 60);
  sim.adoptVehicles([c]);
  sim.running = true;
  for (let i = 0; i < 2000 && !sim.completed; i++) sim.update(0.05);
  expect(sim.completed).toBe(1);
  expect(sim.failed).toBe(0);
  sim.dispose();
});
