import { describe, expect, it } from "vitest";
import { updateAutomaticTransitions } from "../src/core/auto-transitions";
import {
  add,
  center,
  countAt,
  dist,
  laneCount,
  lanePoint,
  laneWidth,
  mul,
  normal,
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
import { bodiesOverlap } from "../src/simulation/collision";
import { Simulation } from "../src/simulation/simulation";

const options = (lanes: number, twoWay = false) => ({
  lanesStart: lanes,
  lanesEnd: lanes,
  width: 3.5,
  speed: 60,
  twoWay,
  transitionMode: "smooth" as const,
});
function pair(from = 2, to = 3, twoWay = false) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-100, 0), v(0, 0), options(from, twoWay)),
    makeRoad(v(0, 0), v(100, 0), options(to, twoWay)),
  ];
  return p;
}

describe("explicit smooth upgrades on ordinary road joins", () => {
  it("widens a normal three-lane road from two lanes without changing nominal assets or controls", () => {
    const p = pair(),
      original = structuredClone(p.roads);
    autoJunction(p);
    const [a, b] = p.roads;
    expect(p.roads).toHaveLength(2);
    expect(b.lanesStart).toBe(3);
    expect(b.lanesEnd).toBe(3);
    expect(b.knots).toEqual(original[1].knots);
    expect(a.autoTaper).toBeUndefined();
    expect(b.autoTaper?.start?.lanes).toBe(2);
    expect(countAt(b, 0)).toBeCloseTo(2);
    expect(countAt(b, 0.1)).toBeGreaterThan(2);
    expect(countAt(b, 0.1)).toBeLessThan(3);
    expect(countAt(b, 0.7)).toBe(3);
    expect(laneWidth(b, 2, 0)).toBe(0);
    for (let lane = 0; lane < 2; lane++)
      expect(dist(lanePoint(a, lane, 1), lanePoint(b, lane, 0))).toBeLessThan(
        1e-8,
      );
    expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const before = JSON.stringify(p);
    updateAutomaticTransitions(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
  it("narrows on the wider approach before joining a smaller road", () => {
    const p = pair(3, 2);
    updateAutomaticTransitions(p);
    const [a, b] = p.roads;
    expect(a.autoTaper?.end?.lanes).toBe(2);
    expect(b.autoTaper).toBeUndefined();
    expect(countAt(a, 0.4)).toBe(3);
    expect(countAt(a, 1)).toBe(2);
    expect(laneWidth(a, 2, 1)).toBe(0);
    for (let lane = 0; lane < 2; lane++)
      expect(dist(lanePoint(a, lane, 1), lanePoint(b, lane, 0))).toBeLessThan(
        1e-8,
      );
  });
  it.each([0, 1, 2])(
    "retains the selected two-lane group starting at %i",
    (first) => {
      const p = pair(2, 4),
        [a, b] = p.roads;
      attachLanes(a, 1, b, 0, [first, first + 1], [0, 1]);
      updateAutomaticTransitions(p);
      expect(b.autoTaper?.start?.firstLane).toBe(first);
      for (let lane = 0; lane < 2; lane++) {
        const seam = lanePoint(b, first + lane, 0);
        expect(dist(lanePoint(a, lane, 1), seam)).toBeLessThan(1e-8);
        for (const t of [0.02, 0.08, 0.15, 0.4])
          expect(lanePoint(b, first + lane, t).z).toBeCloseTo(seam.z, 7);
      }
      expect(connections(p).map((c) => c.to.lane)).toEqual([first, first + 1]);
    },
  );
  it("supports symmetric two-way transitions with matching lanes in both directions", () => {
    const p = pair(2, 3, true);
    updateAutomaticTransitions(p);
    const [a, b] = p.roads;
    expect(countAt(b, 0)).toBe(2);
    expect(laneCount(b)).toBe(6);
    expect(connections(p)).toHaveLength(4);
    for (const c of connections(p)) {
      const from = p.roads.find((r) => r.id === c.from.road)!,
        to = p.roads.find((r) => r.id === c.to.road)!;
      expect(
        dist(
          lanePoint(from, c.from.lane, from === a ? 1 : 0),
          lanePoint(to, c.to.lane, to === b ? 0 : 1),
        ),
      ).toBeLessThan(1e-8);
    }
  });
  it("keeps two automatic collars separated on a short wider segment", () => {
    const p = emptyProject();
    p.roads = [
      makeRoad(v(-80, 0), v(0, 0), options(2)),
      makeRoad(v(0, 0), v(35, 0), options(3)),
      makeRoad(v(35, 0), v(100, 0), options(2)),
    ];
    updateAutomaticTransitions(p);
    const wide = p.roads[1];
    expect(wide.autoTaper?.start).toBeDefined();
    expect(wide.autoTaper?.end).toBeDefined();
    expect(
      wide.autoTaper!.start!.span + wide.autoTaper!.end!.span,
    ).toBeLessThan(1);
    expect(countAt(wide, 0)).toBe(2);
    expect(countAt(wide, 0.5)).toBe(3);
    expect(countAt(wide, 1)).toBe(2);
  });
  it("removes derived transitions after disconnecting their neighbour", () => {
    const p = pair();
    updateAutomaticTransitions(p);
    const [a, b] = p.roads;
    removeRoads(p, new Set([a.id]));
    autoJunction(p);
    expect(b.autoTaper).toBeUndefined();
    expect(countAt(b, 0)).toBe(3);
  });
  it("does not consume lanes required by a split or a real junction", () => {
    const p = emptyProject(),
      wide = makeRoad(v(-80, 0), v(0, 0), options(3));
    p.roads = [wide];
    makeBranch(p, wide.id);
    updateAutomaticTransitions(p);
    expect(p.roads.every((r) => !r.autoTaper)).toBe(true);
    expect(connections(p)).toHaveLength(3);
    const q = pair();
    q.roads.push(makeRoad(v(0, 0), v(0, 80), options(1)));
    updateAutomaticTransitions(q);
    expect(q.roads.every((r) => !r.autoTaper)).toBe(true);
  });
  it("does not treat an elevated crossing or manual taper as an automatic join", () => {
    const p = pair();
    for (const k of p.roads[1].knots)
      for (const key of ["p", "incoming", "outgoing"] as const) k[key].y = 8;
    updateAutomaticTransitions(p);
    expect(p.roads.every((r) => !r.autoTaper)).toBe(true);
    const q = pair();
    q.roads[1].lanesStart = 2;
    updateAutomaticTransitions(q);
    expect(q.roads.every((r) => !r.autoTaper)).toBe(true);
  });
  it("rejects corrupt derived collar data on import", () => {
    const p = pair();
    updateAutomaticTransitions(p);
    p.roads[1].autoTaper!.start!.span = 0;
    expect(() => parseProject(JSON.stringify(p))).toThrow(/自动过渡/);
  });
  it("keeps lane paths and pavement edges continuous at the taper boundaries", () => {
    const p = pair();
    updateAutomaticTransitions(p);
    const [a, b] = p.roads;
    for (const side of [-1, 1]) {
      const edge = (r: typeof a, t: number) =>
        add(
          center(r, t),
          mul(normal(r, t), (side * countAt(r, t) * r.width) / 2),
        );
      expect(dist(edge(a, 1), edge(b, 0))).toBeLessThan(1e-8);
    }
    const span = b.autoTaper!.start!.span;
    expect(
      dist(lanePoint(b, 0, span - 1e-6), lanePoint(b, 0, span + 1e-6)),
    ).toBeLessThan(0.001);
    expect(
      Math.abs((lanePoint(b, 0, 0.0001).z - lanePoint(b, 0, 0).z) / 0.01),
    ).toBeLessThan(0.001);
  });
});

it.each([
  [2, 3],
  [3, 2],
])(
  "traffic traverses an automatic %i→%i transition without body overlap",
  (from, to) => {
    const p = pair(from, to);
    p.ports = [
      { road: p.roads[0].id, end: "start", type: "source", rate: 36 },
      { road: p.roads[1].id, end: "end", type: "sink", rate: 0 },
    ];
    const sim = new Simulation();
    sim.configure(p);
    sim.running = true;
    for (let i = 0; i < 2400; i++) {
      sim.update(0.05);
      if (i % 10 === 0)
        for (let a = 0; a < sim.vehicles.length; a++)
          for (let b = a + 1; b < sim.vehicles.length; b++)
            expect(bodiesOverlap(sim.vehicles[a], sim.vehicles[b], 0)).toBe(
              false,
            );
    }
    expect(sim.completed).toBeGreaterThan(40);
  },
);

it("previews automatic collars without mutating either existing or incoming roads", async () => {
  const { automaticTransitionPreview } =
    await import("../src/core/auto-transitions");
  const p = pair(3, 2),
    incoming = p.roads.pop()!;
  const before = JSON.stringify(p),
    original = JSON.stringify(incoming);
  const preview = automaticTransitionPreview(p, [incoming]);
  expect(preview.hasTransitions).toBe(true);
  expect(preview.replaces).toEqual([p.roads[0].id]);
  expect(preview.roads).toHaveLength(2);
  expect(
    preview.roads.find((r) => r.id === p.roads[0].id)?.autoTaper?.end?.lanes,
  ).toBe(2);
  expect(JSON.stringify(p)).toBe(before);
  expect(JSON.stringify(incoming)).toBe(original);
});
