import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  emptyProject,
  example,
  makeRoad,
  parseProject,
} from "../src/core/model";
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

function segmentedApproach(count = 4) {
  const project = emptyProject(),
    length = 480 / count;
  project.roads = Array.from({ length: count }, (_, i) =>
    makeRoad(v(i * length, 0), v((i + 1) * length, 0), {
      id: `part-${i}`,
      lanesStart: 2,
      lanesEnd: 2,
      speed: 100,
    }),
  );
  project.roads.push(
    makeRoad(v(480, 0), v(480, 200), {
      id: "exit",
      lanesStart: 1,
      lanesEnd: 1,
      speed: 100,
    }),
  );
  project.junctionLaneConnections = [0, 1].map((lane) => ({
    from: { road: `part-${count - 1}`, end: 1 as const, lane },
    to: lane === 1 ? [{ road: "exit", end: 0 as const, lane: 0 }] : [],
  }));
  const car: Vehicle = {
    id: 1,
    route: project.roads.map((road, i) => ({
      road: road.id,
      direction: 1 as const,
      inLane: i === 0 || road.id === "exit" ? 0 : 1,
      outLane: road.id === "exit" ? 0 : 1,
    })),
    step: 0,
    s: 110,
    lane: 0,
    speed: 100 / 3.6,
    age: 0,
    color: 0,
    position: lanePoint(project.roads[0], 0, 110 / length),
    heading: Math.PI / 2,
    pitch: 0,
  };
  return { project, car };
}

function observeSeam(sim: Cs2TrafficSimulation, count: number) {
  let minimum = Infinity,
    carried = false,
    overlaps = 0,
    entryLane: number | undefined,
    sourceExitLane: number | undefined;
  const exitLanes: number[] = [];
  for (let tick = 0; tick < 1800 && sim.completed < count; tick++) {
    sim.update(0.05);
    const cars = sim.renderVehicles(),
      view = sim.runtime!.readVehicle(1);
    for (let a = 0; a < cars.length; a++)
      for (let b = a + 1; b < cars.length; b++)
        if (bodiesOverlap(cars[a], cars[b], 0)) overlaps++;
    const car = cars.find((c) => c.id === 1);
    if (car && car.position.x >= 110 && car.position.x <= 150)
      minimum = Math.min(minimum, car.speed);
    for (const c of cars)
      if (c.laneChange)
        expect(Math.abs(c.laneChange.to - c.laneChange.from)).toBe(1);
    if (view) {
      const lane = sim.network!.lanes.get(view.current.laneId!)!;
      if (lane.road === "part-0")
        sourceExitLane =
          view.current.changeLaneId && view.current.changeProgress >= 1
            ? sim.network!.lanes.get(view.current.changeLaneId)!.lane
            : lane.lane;
      if (lane.road === "part-1" && entryLane === undefined)
        entryLane = lane.lane;
      if (
        lane.road === "part-1" &&
        view.current.changeLaneId &&
        view.current.changeProgress > 0 &&
        view.current.changeProgress < 1
      )
        carried = true;
      if (lane.from?.road === "part-0" && lane.to?.road === "part-1")
        exitLanes.push(lane.from.lane);
    }
  }
  return { minimum, carried, overlaps, exitLanes, entryLane, sourceExitLane };
}

it.each([15, 100 / 3.6])(
  "carries an adjacent change across authored 120m seams at %sm/s like the unsegmented road",
  (speed) => {
    const metrics = [1, 4].map((count) => {
      const { project, car } = segmentedApproach(count);
      car.speed = speed;
      const sim = new Cs2TrafficSimulation({
        synchronousPathsOnlyForTests: true,
      });
      sim.configure(project);
      sim.adoptVehicles([car]);
      sim.running = true;
      const metrics = observeSeam(sim, 1);
      expect(sim.completed).toBe(1);
      expect(sim.failed).toBe(0);
      expect(metrics.overlaps).toBe(0);
      if (count === 4) expect(metrics.carried).toBe(true);
      sim.dispose();
      return metrics;
    });
    expect(metrics[1].minimum).toBeGreaterThan(speed - 0.1);
    expect(Math.abs(metrics[1].minimum - metrics[0].minimum)).toBeLessThan(0.1);
  },
);

it.each(["identity", "forbidden", "crossed", "junction"] as const)(
  "respects %s authored mappings and physical junctions at the segment boundary",
  (kind) => {
    const { project, car } = segmentedApproach();
    if (kind !== "junction")
      project.junctionLaneConnections!.push(
        ...[0, 1].map((lane) => ({
          from: { road: "part-0", end: 1 as const, lane },
          to:
            kind === "forbidden" && lane === 0
              ? []
              : [
                  {
                    road: "part-1",
                    end: 0 as const,
                    lane: kind === "crossed" ? 1 - lane : lane,
                  },
                ],
        })),
      );
    else
      project.roads.push(
        makeRoad(v(120, 0), v(120, -100), {
          id: "branch",
          lanesStart: 1,
          lanesEnd: 1,
          speed: 50,
        }),
      );
    if (kind === "crossed") car.route[1].inLane = 0;
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(project);
    sim.adoptVehicles([car]);
    sim.running = true;
    const metrics = observeSeam(sim, 1);
    expect(metrics.carried).toBe(kind === "identity");
    if (kind === "forbidden") {
      expect(metrics.entryLane).toBe(1);
      expect(metrics.sourceExitLane).toBe(1);
      expect(metrics.exitLanes.every((l) => l === 1)).toBe(true);
    }
    if (kind === "crossed")
      expect(metrics.entryLane).toBe(1 - metrics.sourceExitLane!);
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    expect(metrics.overlaps).toBe(0);
    sim.dispose();
  },
);

it("keeps the rear gap when a faster target-lane car approaches the seam", () => {
  const { project, car } = segmentedApproach(),
    rear: Vehicle = {
      ...car,
      id: 2,
      s: 100,
      lane: 1,
      speed: 120 / 3.6,
      route: car.route.map((step) => ({
        ...step,
        inLane: step.road === "exit" ? 0 : 1,
      })),
      position: lanePoint(project.roads[0], 1, 100 / 120),
    },
    sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  sim.adoptVehicles([car, rear]);
  sim.running = true;
  const metrics = observeSeam(sim, 2);
  expect(metrics.overlaps).toBe(0);
  expect(sim.completed).toBe(2);
  expect(sim.failed).toBe(0);
  sim.dispose();
});

it.each(["lane-count", "median", "offset", "fork", "merge"] as const)(
  "keeps the ordinary boundary guard for a %s discontinuity",
  (kind) => {
    const { project } = segmentedApproach(),
      target = project.roads[1];
    if (kind === "lane-count") target.lanesStart = target.lanesEnd = 3;
    if (kind === "offset") target.sectionOffset = 1;
    if (kind === "median") {
      project.roads.slice(0, 4).forEach((road) => {
        road.twoWay = true;
      });
      target.median = { kind: "concrete", width: 2 };
    }
    if (kind === "fork" || kind === "merge") {
      project.roads.push(
        makeRoad(
          kind === "fork" ? v(120, 0) : v(120, -100),
          kind === "fork" ? v(120, -100) : v(120, 0),
          { id: "branch", lanesStart: 1, lanesEnd: 1, speed: 50 },
        ),
      );
    }
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(project);
    const seams = [...sim.network!.groups.values()].filter((g) => {
      const lane = sim.network!.lanes.get(g.members[0])!;
      return (
        lane.kind === "connection" &&
        lane.from?.road === "part-0" &&
        lane.to?.road === "part-1"
      );
    });
    expect(seams.length).toBeGreaterThan(0);
    for (const group of seams)
      expect((sim as any).continuousConnection(group.id)).toBe(false);
    sim.dispose();
  },
);

it.each([3, 10, 30].flatMap((gap) => [0, 10].map((speed) => ({ gap, speed }))))(
  "keeps safe gaps to a car $gap metres after a transparent seam at $speed m/s",
  ({ gap, speed }) => {
    const { project, car } = segmentedApproach(),
      leader: Vehicle = {
        ...car,
        id: 2,
        step: 1,
        s: gap,
        lane: 1,
        speed,
        route: car.route.map((step) => ({
          ...step,
          inLane: step.road === "exit" ? 0 : 1,
        })),
        position: lanePoint(project.roads[1], 1, gap / 120),
      },
      sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
    sim.configure(project);
    sim.adoptVehicles([car, leader]);
    sim.running = true;
    const metrics = observeSeam(sim, 2);
    expect(metrics.overlaps).toBe(0);
    expect(sim.completed).toBe(2);
    expect(sim.failed).toBe(0);
    sim.dispose();
  },
);

it("recomputes continuity after a live rule edit and keeps the restricted exit legal", () => {
  const { project } = segmentedApproach(),
    sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  const seam = () =>
    [...sim.network!.groups.values()].find((g) => {
      const lane = sim.network!.lanes.get(g.members[0])!;
      return (
        lane.kind === "connection" &&
        lane.from?.road === "part-0" &&
        lane.to?.road === "part-1"
      );
    })!;
  expect((sim as any).continuousConnection(seam().id)).toBe(true);
  project.junctionLaneConnections!.push({
    from: { road: "part-0", end: 1, lane: 0 },
    to: [],
  });
  sim.configure(project);
  expect((sim as any).continuousConnection(seam().id)).toBe(false);
  const from = sim.network!.roadLaneIds.get(JSON.stringify(["part-0", 0]))!;
  expect(sim.network!.successors.get(from.at(-1)!) ?? []).toEqual([]);
  sim.dispose();
});

it("crosses the improved cloverleaf's first ordinary seam while changing, then uses its authored right exit", async () => {
  const project = example("elevated");
  // Isolate one actual OD trip, rather than mask pressure with a lower demand assertion.
  project.ports.forEach((port) => {
    port.rate = 0;
  });
  const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
      deterministicSeed: 1,
    }),
    source = project.ports.find((p) => p.road === "cloverleaf-east-in")!;
  sim.configure(project);
  const id = (await sim.spawnTrip(source, project.ports[3], {
    lane: 0,
    startDistance: 55,
    initialSpeed: 100 / 3.6,
  }))!;
  sim.running = true;
  let firstMinimum = Infinity,
    carried = false,
    usedRightExit = false,
    minimum = Infinity,
    stopped = 0;
  let fixedRoads: string[] = [];
  for (let tick = 0; tick < 2400 && !sim.completed; tick++) {
    sim.update(0.05);
    const view = sim.runtime!.readVehicle(id),
      car = sim.vehicles[0];
    if (!view || !car) continue;
    const trip = (sim as any).trips.get(id);
    if (!fixedRoads.length) fixedRoads = [...trip.fixedRoads];
    expect(trip.fixedRoads).toEqual(fixedRoads);
    minimum = Math.min(minimum, car.speed);
    if (car.speed < 0.2) stopped += 0.05;
    if (car.route[car.step]?.road === source.road && car.s > 60)
      firstMinimum = Math.min(firstMinimum, car.speed);
    const lane = sim.network!.lanes.get(view.current.laneId!)!;
    if (
      lane.road === fixedRoads[1] &&
      view.current.changeLaneId &&
      view.current.changeProgress > 0 &&
      view.current.changeProgress < 1
    )
      carried = true;
    if (lane.to?.road === "cloverleaf-east-right") {
      expect(lane.from).toEqual({
        road: "cloverleaf-east-collector-0",
        lane: 1,
      });
      expect(lane.to.lane).toBe(0);
      usedRightExit = true;
    }
    if (car.laneChange)
      expect(Math.abs(car.laneChange.to - car.laneChange.from)).toBe(1);
  }
  expect(carried).toBe(true);
  expect(usedRightExit).toBe(true);
  expect(firstMinimum).toBeGreaterThan(26);
  expect(fixedRoads).toContain("cloverleaf-east-right");
  expect(sim.completed).toBe(1);
  expect(sim.failed).toBe(0);
  mkdirSync(".cache/traffic-ai-maintenance", { recursive: true });
  writeFileSync(
    ".cache/traffic-ai-maintenance/cloverleaf-regression.json",
    JSON.stringify(
      {
        firstMinimum,
        minimum,
        stopped,
        carried,
        usedRightExit,
        completed: sim.completed,
        failed: sim.failed,
        overlaps: 0,
        fixedRoads,
      },
      null,
      2,
    ),
  );
  sim.dispose();
});
