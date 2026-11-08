import { describe, expect, it } from "vitest";
import {
  automaticTransitionPreview,
  updateAutomaticTransitions,
} from "../src/core/auto-transitions";
import { buildJunctions } from "../src/core/junctions";
import { buildLaneJunctions } from "../src/core/lane-junctions";
import { junctionLanePorts } from "../src/core/junction-lane-connections";
import {
  center,
  countAt,
  laneCount,
  lanePoint,
  laneWidth,
  medianWidth,
  nodePoint,
  pavementWidth,
  v,
} from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  makeBranch,
  makeRoad,
  parseProject,
  removeRoads,
} from "../src/core/model";
import { attachLanes } from "../src/core/lane-rules";
import { isNodeSmooth, setNodeSmooth } from "../src/core/road-visual-settings";
import type { Project } from "../src/core/types";
import { bodiesOverlap } from "../src/simulation/collision";
import { Simulation } from "../src/simulation/simulation";

const options = (lanes: number, twoWay = false) => ({
  lanesStart: lanes,
  lanesEnd: lanes,
  speed: 60,
  twoWay,
  transitionMode: "direct" as const,
});
function pair(from = 2, to = 3, twoWay = false) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-100, 0), v(), { ...options(from, twoWay), id: "a" }),
    makeRoad(v(), v(100, 0), { ...options(to, twoWay), id: "b" }),
  ];
  autoJunction(p);
  return p;
}
function logicalState(p: Project) {
  return {
    geometry: p.roads.map((road) =>
      [0, 0.02, 0.1, 0.4, 0.7, 0.98, 1].map((t) => ({
        center: center(road, t),
        node: nodePoint(road, t),
        count: countAt(road, t),
        median: medianWidth(road, t),
        pavement: pavementWidth(road, t),
        lanes: Array.from({ length: laneCount(road) }, (_, lane) => ({
          width: laneWidth(road, lane, t),
          position: lanePoint(road, lane, t),
        })),
      })),
    ),
    connections: connections(p),
    junctions: buildJunctions(p),
    ports: buildLaneJunctions(p).map((node) => junctionLanePorts(p, node)),
  };
}
function expectVisualOnly(p: Project) {
  const nodes = buildLaneJunctions(p),
    roads = structuredClone(p.roads),
    baseline = logicalState(p);
  expect(nodes.length).toBeGreaterThan(0);
  for (const enabled of [true, false, true, false]) {
    for (const node of nodes) {
      setNodeSmooth(p, node, enabled);
      expect(isNodeSmooth(p, node)).toBe(enabled);
    }
    expect(p.roads).toEqual(roads);
    expect(logicalState(p)).toEqual(baseline);
    expect(logicalState(parseProject(JSON.stringify(p)))).toEqual(baseline);
  }
}

describe("node smoothing preserves the ordinary logical road section", () => {
  it.each([
    [0, 2],
    [2, 0],
    [2, 4],
    [4, 2],
    [0, 4],
    [4, 0],
  ])("keeps the authored %im to %im median change", (from, to) => {
    const p = pair(2, 2, true);
    if (from) p.roads[0].median = { kind: "concrete", width: from };
    if (to) p.roads[1].median = { kind: "concrete", width: to };
    expectVisualOnly(p);
    for (const t of [0, 0.1, 0.9, 1]) {
      expect(medianWidth(p.roads[0], t)).toBe(from);
      expect(medianWidth(p.roads[1], t)).toBe(to);
      expect(pavementWidth(p.roads[0], t)).toBe(16 + from);
      expect(pavementWidth(p.roads[1], t)).toBe(16 + to);
    }
  });

  it("keeps an attached lateral offset instead of moving its logical centre", () => {
    const p = pair(2, 2),
      [a, b] = p.roads;
    b.sectionOffset = 3;
    attachLanes(a, 1, b, 0, [0], [0]);
    const baseline = center(b, 0);
    expectVisualOnly(p);
    expect(center(b, 0)).toEqual(baseline);
    expect(b.sectionOffset).toBe(3);
  });

  it("does not carry a real divider into the neighbouring wider road", () => {
    const p = pair(1, 2, true);
    p.roads[0].median = { kind: "concrete", width: 2 };
    expectVisualOnly(p);
    expect(medianWidth(p.roads[0], 1)).toBe(2);
    expect(medianWidth(p.roads[1], 0)).toBe(0);
    expect(laneCount(p.roads[1])).toBe(4);
    for (let lane = 0; lane < 4; lane++)
      expect(laneWidth(p.roads[1], lane, 0)).toBe(4);
  });

  it("preserves all lanes of asymmetric 2+3 and 3+2 median sections", () => {
    const p = pair(3, 2, true),
      [a, b] = p.roads;
    a.backwardLanesStart = a.backwardLanesEnd = 2;
    b.backwardLanesStart = b.backwardLanesEnd = 3;
    for (const road of p.roads) road.median = { kind: "concrete", width: 2 };
    expectVisualOnly(p);
    expect(center(a, 1).z).toBe(2);
    expect(center(b, 0).z).toBe(-2);
    for (const road of p.roads) {
      expect(laneCount(road)).toBe(5);
      for (let lane = 0; lane < 5; lane++)
        expect(laneWidth(road, lane, road === a ? 1 : 0)).toBe(4);
    }
  });

  it.each([
    [2, 3],
    [3, 2],
    [3, 5],
    [5, 3],
  ])(
    "preserves the direct %i to %i geometry and default connections",
    (from, to) => {
      const p = pair(from, to),
        baseline = connections(p);
      expect(baseline.length).toBeGreaterThan(0);
      expectVisualOnly(p);
      for (const road of p.roads)
        for (const t of [0, 0.1, 0.5, 0.9, 1]) {
          expect(countAt(road, t)).toBe(road.lanesStart);
          for (let lane = 0; lane < laneCount(road); lane++)
            expect(laneWidth(road, lane, t)).toBe(road.width);
        }
      expect(connections(p)).toEqual(baseline);
    },
  );

  it.each([0, 1, 2])(
    "preserves an authored attachment beginning at lane %i",
    (first) => {
      const p = pair(2, 4),
        [a, b] = p.roads;
      attachLanes(a, 1, b, 0, [first, first + 1], [0, 1]);
      const attachment = structuredClone(a.attachments);
      expectVisualOnly(p);
      expect(a.attachments).toEqual(attachment);
      expect(connections(p).map((c) => c.to.lane)).toEqual([first, first + 1]);
      for (let lane = 0; lane < 4; lane++)
        expect(laneWidth(b, lane, 0)).toBe(b.width);
    },
  );

  it("keeps both nodes of a short wider segment independently visual", () => {
    const p = emptyProject();
    p.roads = [
      makeRoad(v(-80, 0), v(), options(2)),
      makeRoad(v(), v(35, 0), options(3)),
      makeRoad(v(35, 0), v(100, 0), options(2)),
    ];
    autoJunction(p);
    const nodes = buildLaneJunctions(p),
      baseline = logicalState(p);
    expect(nodes).toHaveLength(2);
    setNodeSmooth(p, nodes[0], true);
    expect(isNodeSmooth(p, nodes[0])).toBe(true);
    expect(isNodeSmooth(p, nodes[1])).toBe(false);
    setNodeSmooth(p, nodes[1], true);
    setNodeSmooth(p, nodes[0], false);
    expect(isNodeSmooth(p, nodes[0])).toBe(false);
    expect(isNodeSmooth(p, nodes[1])).toBe(true);
    expect(logicalState(p)).toEqual(baseline);
    for (const t of [0, 0.5, 1]) expect(countAt(p.roads[1], t)).toBe(3);
  });

  it("does not consume lanes in a split or a real junction", () => {
    const p = emptyProject(),
      wide = makeRoad(v(-80, 0), v(), options(3));
    p.roads = [wide];
    makeBranch(p, wide.id);
    autoJunction(p);
    expectVisualOnly(p);
    expect(connections(p)).toHaveLength(3);
    const q = pair();
    q.roads.push(makeRoad(v(), v(0, 80), options(1)));
    autoJunction(q);
    expect(buildJunctions(q)).toHaveLength(1);
    expectVisualOnly(q);
    expect(q.roads.every((road) => !road.autoTaper)).toBe(true);
  });

  it("keeps a grade-separated crossing disconnected", () => {
    const p = pair();
    for (const knot of p.roads[1].knots)
      for (const key of ["p", "incoming", "outgoing"] as const) knot[key].y = 8;
    const baseline = logicalState(p);
    expect(buildLaneJunctions(p)).toEqual([]);
    updateAutomaticTransitions(p);
    expect(logicalState(p)).toEqual(baseline);
    expect(connections(p)).toEqual([]);
    expect(p.roadVisuals?.nodes ?? []).toEqual([]);
  });

  it("retains a real authored profile and its disappearing lane", () => {
    const p = pair(4, 3),
      road = p.roads[0];
    road.lanesEnd = 3;
    road.profile = {
      from: 4,
      to: 3,
      start: 0,
      end: 1,
      transitionStart: 0.2,
      transitionEnd: 0.8,
    };
    const profile = structuredClone(road.profile);
    expectVisualOnly(p);
    expect(road.profile).toEqual(profile);
    expect(laneWidth(road, 3, 0)).toBe(road.width);
    expect(laneWidth(road, 3, 0.5)).toBeGreaterThan(0);
    expect(laneWidth(road, 3, 0.5)).toBeLessThan(road.width);
    expect(laneWidth(road, 3, 1)).toBe(0);
    expect(
      connections(p).some((c) => c.from.road === "a" && c.from.lane === 3),
    ).toBe(false);
  });
});

describe("legacy automatic transitions migrate only display intent", () => {
  it("discards the old collar cache without changing genuine geometry or rules", () => {
    const p = pair(3, 5),
      baseline = logicalState(p),
      knots = p.roads.map((road) => structuredClone(road.knots));
    // Legacy input fixture only: new visual operations always use setNodeSmooth.
    delete p.roadVisuals;
    p.roads[1].transitionMode = "smooth";
    p.roads[1].autoTaper = {
      start: { lanes: 3, firstLane: 0, offset: -4, span: 0.2 },
    };
    updateAutomaticTransitions(p);
    const [node] = buildLaneJunctions(p);
    expect(isNodeSmooth(p, node)).toBe(true);
    expect(p.roads.every((road) => !road.autoTaper)).toBe(true);
    expect(p.roads.every((road) => road.transitionMode === "direct")).toBe(
      true,
    );
    expect(p.roads.map((road) => road.knots)).toEqual(knots);
    expect(logicalState(p)).toEqual(baseline);
    const before = structuredClone(p);
    updateAutomaticTransitions(p);
    expect(p).toEqual(before);
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });

  it("does not recreate a cancelled node from stale legacy smooth flags", () => {
    const p = pair(),
      [node] = buildLaneJunctions(p),
      baseline = logicalState(p);
    setNodeSmooth(p, node, true);
    setNodeSmooth(p, node, false);
    p.roads[1].transitionMode = "smooth";
    updateAutomaticTransitions(p);
    expect(isNodeSmooth(p, node)).toBe(false);
    expect(logicalState(p)).toEqual(baseline);
    expect(isNodeSmooth(parseProject(JSON.stringify(p)), node)).toBe(false);
  });

  it("removes a deleted neighbour's display reference without narrowing its surviving road", () => {
    const p = pair(),
      [node] = buildLaneJunctions(p);
    setNodeSmooth(p, node, true);
    removeRoads(p, new Set(["a"]));
    autoJunction(p);
    expect(p.roads).toHaveLength(1);
    expect(p.roadVisuals?.nodes ?? []).toEqual([]);
    expect(countAt(p.roads[0], 0)).toBe(3);
    expect(p.roads[0].autoTaper).toBeUndefined();
  });

  it("previews incoming roads without deriving physical collars or mutating either input", () => {
    const p = pair(3, 2),
      incoming = p.roads.pop()!,
      before = structuredClone(p),
      original = structuredClone(incoming),
      preview = automaticTransitionPreview(p, [incoming]);
    expect(p).toEqual(before);
    expect(incoming).toEqual(original);
    expect(preview.hasTransitions).toBe(false);
    expect(preview.replaces).toEqual([]);
    expect(preview.roads).toEqual([incoming]);
    expect(preview.roads.every((road) => !road.autoTaper)).toBe(true);
  });
});

it.each([
  [2, 3],
  [3, 2],
])(
  "keeps the direct %i to %i traffic trajectories and overlap result under visual smoothing",
  (from, to) => {
    const baseline = pair(from, to),
      visual = pair(from, to),
      [node] = buildLaneJunctions(visual);
    setNodeSmooth(visual, node, true);
    const run = (p: Project) => {
      p.ports = [
        { road: "a", end: "start", type: "source", rate: 36 },
        { road: "b", end: "end", type: "sink", rate: 0 },
      ];
      const sim = new Simulation(),
        frames: unknown[] = [],
        overlaps: number[][] = [];
      try {
        sim.configure(p);
        sim.running = true;
        for (let i = 0; i < 2400; i++) {
          sim.update(0.05);
          if (i % 10 !== 0) continue;
          frames.push(
            sim.vehicles.map((car) => ({
              id: car.id,
              position: { ...car.position },
              heading: car.heading,
              lane: car.lane,
              step: car.step,
              connector: car.connector?.id,
              speed: car.speed,
            })),
          );
          for (let a = 0; a < sim.vehicles.length; a++)
            for (let b = a + 1; b < sim.vehicles.length; b++)
              if (bodiesOverlap(sim.vehicles[a], sim.vehicles[b], 0))
                overlaps.push([i, sim.vehicles[a].id, sim.vehicles[b].id]);
        }
        expect(sim.completed).toBeGreaterThan(40);
        return {
          frames,
          overlaps,
          completed: sim.completed,
          failed: sim.failed,
        };
      } finally {
        sim.dispose();
      }
    };
    // Any pre-existing direct-join overlap stays visible in the baseline result;
    // a display switch must not add one or alter any vehicle trajectory.
    expect(run(visual)).toEqual(run(baseline));
  },
);
