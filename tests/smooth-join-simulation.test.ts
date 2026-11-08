import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dist, lanePoint, laneWidth, v } from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  makeRoad,
} from "../src/core/model";
import { setJunctionLaneRule } from "../src/core/junction-lane-connections";
import { visibleRoadSurfaceTriangles } from "../src/render/road-visual-geometry";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import {
  compileCs2Network,
  cs2RoadLaneKey,
} from "../src/simulation/cs2-network";
import type { Project } from "../src/core/types";

type VisualProject = Project & {
  roadVisuals?: {
    version: 1;
    nodes: { arms: { road: string; end: 0 | 1 }[]; smooth: true }[];
  };
};

function visual(project: VisualProject, smooth: boolean) {
  project.roadVisuals = {
    version: 1,
    nodes: smooth
      ? [
          {
            arms: [
              { road: "a", end: 1 },
              { road: "b", end: 0 },
            ],
            smooth: true,
          },
        ]
      : [],
  };
}

function fixture(from = 3, to = 4, smooth = true) {
  const project = emptyProject();
  project.roads = [
    makeRoad(v(-120, 0), v(), { id: "a", lanesStart: from, lanesEnd: from }),
    makeRoad(v(), v(120, 0), {
      id: "b",
      lanesStart: to,
      lanesEnd: to,
    }),
  ];
  autoJunction(project);
  visual(project, smooth);
  return project;
}
function authored(project: Project, source: number, target: number) {
  for (let lane = 0; lane < project.roads[0].lanesStart; lane++)
    setJunctionLaneRule(
      project,
      { road: "a", lane, end: 1 },
      lane === source ? [{ road: "b", lane: target, end: 0 }] : [],
    );
  return `a:${source}>b:${target}`;
}

function pavementProbe(project: Project) {
  // Consume Scene's complete actual surface, including its node seam meshes.
  const triangles = visibleRoadSurfaceTriangles(project).map((polygon) => ({
    polygon,
    minX: Math.min(...polygon.map((p) => p.x)),
    maxX: Math.max(...polygon.map((p) => p.x)),
    minZ: Math.min(...polygon.map((p) => p.z)),
    maxZ: Math.max(...polygon.map((p) => p.z)),
  }));
  // scene.ts: 3.8x1.65 body; wheel centres +/-0.78 plus half the 0.2m
  // wheel depth. This conservative rectangle also contains cabin and wheels.
  const halfLength = 1.9,
    halfWidth = 0.88,
    perimeter: { x: number; z: number }[] = [];
  for (let i = 0; i <= 20; i++) {
    const f = i / 20;
    perimeter.push(
      { x: -halfLength + 2 * halfLength * f, z: -halfWidth },
      { x: -halfLength + 2 * halfLength * f, z: halfWidth },
      { x: -halfLength, z: -halfWidth + 2 * halfWidth * f },
      { x: halfLength, z: -halfWidth + 2 * halfWidth * f },
    );
  }
  const contains = (x: number, z: number) =>
    triangles.some((triangle) => {
      const epsilon = 1e-6;
      if (
        x < triangle.minX - epsilon ||
        x > triangle.maxX + epsilon ||
        z < triangle.minZ - epsilon ||
        z > triangle.maxZ + epsilon
      )
        return false;
      const sides = triangle.polygon.map((a, i, polygon) => {
        const b = polygon[(i + 1) % polygon.length];
        return (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
      });
      return (
        sides.every((side) => side >= -epsilon) ||
        sides.every((side) => side <= epsilon)
      );
    });
  let poses = 0,
    points = 0;
  return {
    inspect(car: { position: ReturnType<typeof v>; heading: number }) {
      if (Math.abs(car.position.x) > 55) return;
      poses++;
      const forward = { x: Math.cos(car.heading), z: Math.sin(car.heading) };
      for (const local of perimeter) {
        const x = car.position.x + forward.x * local.x - forward.z * local.z,
          z = car.position.z + forward.z * local.x + forward.x * local.z;
        expect(contains(x, z), `body outside pavement at ${x},${z}`).toBe(true);
        points++;
      }
    },
    evidence() {
      expect(poses).toBeGreaterThan(100);
      expect(contains(0, 1000)).toBe(false);
      return { envelope: [halfLength * 2, halfWidth * 2], poses, points };
    },
  };
}

it.each([
  [3, 4, 0, 3],
  [4, 3, 3, 2],
  [2, 3, 0, 2],
  [3, 5, 0, 4],
  [5, 3, 4, 2],
])(
  "compiles authored %i to%i lane%i to%i on the actual usable curves",
  (from, to, source, target) => {
    const project = fixture(from, to),
      id = authored(project, source, target),
      sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
    sim.configure(project);
    const network = sim.network!,
      link = network.lanes.get(network.connectionLaneIds.get(id)!)!;
    expect(link).toBeDefined();
    const incoming = network.lanes.get(
        network.roadLaneIds.get(cs2RoadLaneKey("a", source))!.at(-1)!,
      )!,
      outgoing = network.lanes.get(
        network.roadLaneIds.get(cs2RoadLaneKey("b", target))![0],
      )!;
    expect(network.successors.get(incoming.id)).toEqual([link.id]);
    expect(network.successors.get(link.id)).toEqual([outgoing.id]);
    expect(dist(link.curve.points[0], incoming.curve.points[3])).toBeLessThan(
      0.0001,
    );
    expect(dist(link.curve.points[3], outgoing.curve.points[0])).toBeLessThan(
      0.0001,
    );
    for (const lane of [incoming, outgoing]) {
      const road = project.roads.find((r) => r.id === lane.road)!;
      expect(
        laneWidth(
          road,
          lane.lane!,
          lane === incoming ? lane.roadInterval![1] : lane.roadInterval![0],
        ) + 1e-7,
      ).toBeGreaterThanOrEqual(road.width * 0.8 - 0.00001);
    }
    expect(
      network.warnings.filter(
        (w) => w.includes(id) && /fades|mismatch/.test(w),
      ),
    ).toEqual([]);
    expect((sim as any).trims.get("a")).toEqual({ start: 0, end: 0 });
    expect((sim as any).trims.get("b")).toEqual({ start: 0, end: 0 });
    sim.dispose();
  },
);

it("keeps the normal direct mappings and full fourth endpoint independent of visual style", () => {
  const project = fixture(),
    links = connections(project),
    network = compileCs2Network({ project, connections: links, revision: 1 });
  expect(links.length).toBeGreaterThan(0);
  expect(links).toEqual(connections(fixture(3, 4, false)));
  expect([...network.connectionLaneIds.keys()]).toEqual(links.map((c) => c.id));
  const explicit = {
    id: "a:0>b:3",
    from: { road: "a", lane: 0 },
    to: { road: "b", lane: 3 },
    enabled: true,
  };
  const ordinary = compileCs2Network({
    project,
    connections: [explicit],
    revision: 2,
  });
  expect(ordinary.connectionLaneIds.has(explicit.id)).toBe(true);
  expect(ordinary.warnings).not.toContain(
    `Connection ${explicit.id}: lane fades before endpoint`,
  );
});

it("does not extend a true disappearing profile even with a manual collar flag", () => {
  const project = fixture(4, 3);
  project.roads[0] = makeRoad(v(-120, 0), v(), {
    id: "a",
    lanesStart: 4,
    lanesEnd: 3,
    autoTaper: { end: { lanes: 3, firstLane: 0, offset: 0, span: 0.2 } },
  });
  expect(laneWidth(project.roads[0], 3, 1)).toBe(0);
  const forged = {
      id: "a:3>b:2",
      from: { road: "a", lane: 3 },
      to: { road: "b", lane: 2 },
      enabled: true,
      manual: true,
    },
    network = compileCs2Network({
      project,
      connections: [forged],
      revision: 1,
    });
  expect(network.connectionLaneIds.has(forged.id)).toBe(false);
  expect(network.warnings).toContain(
    `Connection ${forged.id}: lane fades before endpoint`,
  );
});

it("preserves an explicit empty lane rule instead of silently restoring the fourth destination", () => {
  const project = fixture();
  authored(project, 0, 3);
  setJunctionLaneRule(project, { road: "a", lane: 0, end: 1 }, []);
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  const incoming = sim
    .network!.roadLaneIds.get(cs2RoadLaneKey("a", 0))!
    .at(-1)!;
  expect(sim.network!.successors.get(incoming) ?? []).toEqual([]);
  sim.dispose();
});

it.each([
  [3, 4, 0, 3],
  [4, 3, 3, 2],
])(
  "retains a deeper real trim at both ends of an authored%i to%i link",
  (from, to, source, target) => {
    const project = fixture(from, to),
      id = authored(project, source, target),
      fromT = 0.7,
      toT = 0.3,
      network = compileCs2Network({
        project,
        connections: connections(project),
        revision: 1,
        roadTrims: new Map([
          ["a", { start: 0, end: (1 - fromT) * 120 }],
          ["b", { start: toT * 120, end: 0 }],
        ]),
      }),
      link = network.lanes.get(network.connectionLaneIds.get(id)!)!;
    expect(link).toBeDefined();
    expect(
      dist(link.curve.points[0], lanePoint(project.roads[0], source, fromT)),
    ).toBeLessThan(0.0001);
    expect(
      dist(link.curve.points[3], lanePoint(project.roads[1], target, toT)),
    ).toBeLessThan(0.0001);
  },
);

it("keeps configured width roots for a functional lane profile independent of visual style", () => {
  const project = fixture(2, 3);
  project.roads[1].lanesStart = 2;
  const startAt = (minimumLaneWidthRatio: number) => {
    const network = compileCs2Network({
      project,
      connections: [],
      revision: 1,
      minimumLaneWidthRatio,
    });
    return network.lanes.get(
      network.roadLaneIds.get(cs2RoadLaneKey("b", 2))![0],
    )!.roadInterval![0];
  };
  const at80 = startAt(0.8),
    at90 = startAt(0.9);
  expect(at80).toBeGreaterThan(0);
  expect(at90).toBeGreaterThan(at80);
  expect(laneWidth(project.roads[1], 2, at90)).toBeCloseTo(3.6, 5);
  visual(project, false);
  expect(startAt(0.9)).toBe(at90);
});

const metrics: unknown[] = [];
it.each([
  [3, 4, 0, 3, false],
  [3, 4, 0, 3, true],
  [4, 3, 3, 2, false],
  [4, 3, 3, 2, true],
  [2, 3, 0, 2, false],
  [2, 3, 0, 2, true],
  [3, 5, 0, 4, false],
  [3, 5, 0, 4, true],
  [5, 3, 4, 2, false],
  [5, 3, 4, 2, true],
] as const)(
  "physically drives authored%i to%i through source%i and target%i with visual%s and completes inside visible pavement",
  async (from, to, source, target, smooth) => {
    const project = fixture(from, to, smooth),
      id = authored(project, source, target),
      pavement = pavementProbe(project),
      sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
    sim.configure(project);
    const actor = await sim.spawnTrip(
      { road: "a", end: "start", type: "source", rate: 0 },
      { road: "b", end: "end", type: "sink", rate: 0 },
      { lane: source, initialSpeed: 10 },
    );
    expect(actor).not.toBeNull();
    sim.running = true;
    let used = false,
      entered = false,
      maxMove = 0;
    let previous: ReturnType<typeof v> | undefined;
    for (let tick = 0; tick < 3600 && !sim.completed; tick++) {
      sim.update(1 / 60);
      const view = sim.runtime!.readVehicle(actor!),
        car = sim.vehicles[0],
        displayed = sim.renderVehicles()[0];
      if (displayed) {
        pavement.inspect(displayed);
        if (previous)
          maxMove = Math.max(maxMove, dist(previous, displayed.position));
        previous = { ...displayed.position };
      }
      if (view)
        used ||=
          sim.network!.lanes.get(view.current.laneId!)!.connection === id;
      if (
        car &&
        !car.connector &&
        car.route[car.step]?.road === "b" &&
        car.lane === target &&
        car.s > 45 &&
        car.s < 110
      )
        entered ||=
          dist(car.position, lanePoint(project.roads[1], target, car.s / 120)) <
          1;
    }
    expect(used).toBe(true);
    expect(entered).toBe(true);
    expect(maxMove).toBeLessThan(1);
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    metrics.push({
      from,
      to,
      source,
      target,
      smooth,
      used,
      entered,
      maxMove,
      pavement: pavement.evidence(),
      completed: sim.completed,
      failed: sim.failed,
    });
    mkdirSync(".cache/traffic-ai-maintenance", { recursive: true });
    writeFileSync(
      ".cache/traffic-ai-maintenance/smooth-join-consumer-metrics.json",
      JSON.stringify(metrics, null, 2),
    );
    sim.dispose();
  },
);

it.each([false, true])(
  "consumes the fixed reverse endpoint on an asymmetric two-way median road with visual%s without enabling wrong-way targets",
  async (smooth) => {
    const project = fixture(2, 2, smooth);
    project.roads.forEach((road) => {
      road.twoWay = true;
      road.backwardLanesStart = road.backwardLanesEnd = road.id === "b" ? 3 : 2;
      road.median = { kind: "concrete", width: 2 };
    });
    autoJunction(project);
    const pavement = pavementProbe(project);
    expect(laneWidth(project.roads[1], 0, 0)).toBe(4);
    setJunctionLaneRule(project, { road: "b", lane: 0, end: 0 }, [
      { road: "a", lane: 0, end: 1 },
    ]);
    for (const lane of [1, 2])
      setJunctionLaneRule(project, { road: "b", lane, end: 0 }, []);
    expect(() =>
      setJunctionLaneRule(project, { road: "b", lane: 0, end: 0 }, [
        { road: "a", lane: 2, end: 1 },
      ]),
    ).toThrow();
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(project);
    const id = "b:0>a:0",
      connection = sim.network!.lanes.get(
        sim.network!.connectionLaneIds.get(id)!,
      )!;
    expect(connection).toBeDefined();
    const source = sim.network!.lanes.get(
      sim.network!.roadLaneIds.get(cs2RoadLaneKey("b", 0))!.at(-1)!,
    )!;
    expect(source.direction).toBe(-1);
    expect(source.roadInterval![1]).toBe(0);
    expect(
      dist(connection.curve.points[0], source.curve.points[3]),
    ).toBeLessThan(0.0001);
    const actor = await sim.spawnTrip(
      { road: "b", end: "end", type: "source", rate: 0 },
      { road: "a", end: "start", type: "sink", rate: 0 },
      { lane: 0, initialSpeed: 10 },
    );
    expect(actor).not.toBeNull();
    sim.running = true;
    let used = false,
      entered = false;
    for (let tick = 0; tick < 3600 && !sim.completed; tick++) {
      sim.update(1 / 60);
      const view = sim.runtime!.readVehicle(actor!),
        car = sim.vehicles[0],
        displayed = sim.renderVehicles()[0];
      if (displayed) pavement.inspect(displayed);
      if (view)
        used ||=
          sim.network!.lanes.get(view.current.laneId!)!.connection === id;
      if (
        car &&
        !car.connector &&
        car.route[car.step]?.road === "a" &&
        car.lane === 0 &&
        car.s > 20
      )
        entered ||=
          dist(car.position, lanePoint(project.roads[0], 0, 1 - car.s / 120)) <
          1;
    }
    expect(used).toBe(true);
    expect(entered).toBe(true);
    expect(sim.completed).toBe(1);
    expect(sim.failed).toBe(0);
    metrics.push({
      reverseMedian: true,
      smooth,
      pavement: pavement.evidence(),
    });
    writeFileSync(
      ".cache/traffic-ai-maintenance/smooth-join-consumer-metrics.json",
      JSON.stringify(metrics, null, 2),
    );
    sim.dispose();
  },
);
