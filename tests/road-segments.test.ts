import { expect, it } from "vitest";
import {
  center,
  dist,
  lanePoint,
  point,
  roadLength,
  v,
} from "../src/core/math";
import {
  connections,
  emptyProject,
  makeRoad,
  parseProject,
} from "../src/core/model";
import {
  roadSegmentCuts,
  roadSegmentNodes,
  segmentRoads,
} from "../src/core/road-segments";
import { attachLanes } from "../src/core/lane-rules";
import { Simulation } from "../src/simulation/simulation";
it("splits a long road into selectable pieces with exact lane continuity", () => {
  const p = emptyProject(),
    road = makeRoad(v(-300, 0), v(300, 0));
  p.roads = [road];
  const result = segmentRoads(p, new Set([road.id]));
  expect(result.get(road.id)).toHaveLength(5);
  expect(p.roads).toHaveLength(5);
  expect(p.roads.every((r) => roadLength(r) <= 120.01)).toBe(true);
  for (let i = 1; i < p.roads.length; i++)
    for (let lane = 0; lane < 2; lane++)
      expect(
        dist(
          lanePoint(p.roads[i - 1], lane, 1),
          lanePoint(p.roads[i], lane, 0),
        ),
      ).toBeLessThan(1e-7);
  expect(connections(p)).toHaveLength(8);
  expect(parseProject(JSON.stringify(p)).roads).toHaveLength(5);
});
it("preserves a curved widening, elevation, and the last lane attachment", () => {
  const p = emptyProject(),
    road = makeRoad(
      v(-300, -50),
      v(300, 60, 12),
      { lanesStart: 2, lanesEnd: 3, align: "left" },
      v(-80, -180, 3),
      v(120, 200, 9),
    );
  const target = makeRoad(v(300, 60, 12), v(450, 60, 12), {
    lanesStart: 3,
    lanesEnd: 3,
  });
  attachLanes(road, 1, target, 0, [0, 1, 2], [0, 1, 2]);
  const cuts = [0, ...roadSegmentCuts(road), 1],
    before = structuredClone(road);
  p.roads = [road, target];
  const ids = segmentRoads(p, new Set([road.id])).get(road.id)!;
  for (let i = 0; i < ids.length; i++) {
    const r = p.roads.find((r) => r.id === ids[i])!;
    for (const t of [0, 0.3, 0.7, 1]) {
      const originalT = cuts[i] + (cuts[i + 1] - cuts[i]) * t;
      expect(dist(point(r, t), point(before, originalT))).toBeLessThan(1e-7);
      expect(dist(center(r, t), center(before, originalT))).toBeLessThan(1e-7);
    }
  }
  const last = p.roads.find((r) => r.id === ids.at(-1))!;
  expect(last.attachments?.end?.road).toBe(target.id);
  expect(
    p.roads.find((r) => r.id === ids[0])!.attachments?.end,
  ).toBeUndefined();
});

it("segments kilometre-scale roads without hitting the endpoint split guard", () => {
  const p = emptyProject(),
    road = makeRoad(v(-3000, 0), v(3000, 0));
  p.roads = [road];
  const pieces = segmentRoads(p, new Set([road.id])).get(road.id)!;
  expect(pieces).toHaveLength(50);
  expect(p.roads.every((r) => roadLength(r) <= 120.01)).toBe(true);
  expect(point(p.roads[0], 0).x).toBeCloseTo(-3000);
  expect(point(p.roads.at(-1)!, 1).x).toBeCloseTo(3000);
});

it("rejects invalid lengths and over-budget plans before changing roads", () => {
  const p = emptyProject(),
    road = makeRoad(v(0, 0), v(120001, 0));
  p.roads = [road];
  expect(() => roadSegmentCuts(road, 0)).toThrow(/正数/);
  expect(() => roadSegmentCuts(road, Infinity)).toThrow(/正数/);
  expect(() => segmentRoads(p, new Set([road.id]))).toThrow(/过长|过多/);
  expect(roadSegmentNodes(road)).toEqual([]);
  expect(p.roads).toEqual([road]);
  expect(road.knots).toHaveLength(2);
});

it("preserves boundary ports and lets vehicles continue through internal nodes", () => {
  const p = emptyProject(),
    road = makeRoad(v(-300, 0), v(300, 0));
  p.roads = [road];
  p.ports = [
    { road: road.id, end: "start", type: "source", rate: 12 },
    { road: road.id, end: "end", type: "sink", rate: 0 },
  ];
  const pieces = segmentRoads(p, new Set([road.id])).get(road.id)!;
  expect(p.ports.map((port) => port.road)).toEqual([pieces[0], pieces.at(-1)]);
  const sim = new Simulation();
  sim.configure(p);
  sim.running = true;
  let passedNodes = 0;
  for (let i = 0; i < 1600; i++) {
    sim.update(0.05);
    const first = sim.vehicles.find((car) => car.id === 1);
    if (first && first.step > passedNodes) {
      passedNodes = first.step;
      expect(first.speed).toBeGreaterThan(5);
    }
  }
  expect(passedNodes).toBe(4);
  expect(sim.completed).toBeGreaterThan(5);
  expect(sim.statistics.safetyStops).toBe(0);
});
