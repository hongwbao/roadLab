import { expect, it } from "vitest";
import {
  withRoadMedian,
  setRoadMedian,
  roadMedianRange,
} from "../src/core/road-median";
import {
  arcTable,
  backwardLaneCount,
  boundaryPoint,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  medianWidth,
  nodePoint,
  pavementWidth,
  v,
} from "../src/core/math";
import { buildJunctions } from "../src/core/junctions";
import {
  autoJunction,
  connections,
  emptyProject,
  History,
  makeRoad,
  parseProject,
  splitRoad,
} from "../src/core/model";
import { addRoadsideLanes } from "../src/core/road-sections";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import { renderRoadMedian } from "../src/render/road-median";
import * as T from "three";

it.each([1, 2, 4])(
  "adds a %im real median while preserving lane identities",
  (width) => {
    const r = makeRoad(v(-50, 0), v(50, 0), {
        twoWay: true,
        lanesStart: 3,
        lanesEnd: 3,
        backwardLanesStart: 2,
        backwardLanesEnd: 2,
        width: 3.5,
      }),
      next = withRoadMedian(r, width);
    expect(laneCount(next)).toBe(5);
    expect(pavementWidth(next, 0.5)).toBe(17.5 + width);
    for (let i = 0; i < 5; i++) {
      const old = lanePoint(r, i, 0.5),
        p = lanePoint(next, i, 0.5);
      expect(laneDirection(next, i)).toBe(laneDirection(r, i));
      expect(p.z - old.z).toBeCloseTo((laneDirection(r, i) * width) / 2);
    }
    expect(dist(nodePoint(r, 0), nodePoint(next, 0))).toBe(0);
    expect(boundaryPoint(next, backwardLaneCount(next), 0.5).z).toBeCloseTo(0);
    expect(withRoadMedian(next, null)).toEqual(r);
  },
);
it("saves,undoes,and splits median roads without losing their section", () => {
  const p = emptyProject(),
    r = makeRoad(v(-60, 0), v(60, 0), { twoWay: true });
  p.roads = [r];
  const h = new History();
  h.commit(p);
  setRoadMedian(p, r.id, 2);
  expect(parseProject(JSON.stringify(p)).roads[0].median?.width).toBe(2);
  expect(h.undo(p)!.roads[0].median).toBeUndefined();
  splitRoad(p, r.id, 0.5);
  expect(p.roads).toHaveLength(2);
  expect(p.roads.every((r) => medianWidth(r) === 2)).toBe(true);
  const j = buildJunctions(p);
  expect(j).toHaveLength(0);
  expect(roadMedianRange(p, p.roads[0], j)!.noseEnd).toBe(false);
  expect(roadMedianRange(p, p.roads[1], j)!.noseStart).toBe(false);
});
it("preserves an existing median and old lane centres during unilateral expansion", () => {
  const p = emptyProject(),
    r = withRoadMedian(makeRoad(v(), v(80, 0), { twoWay: true }), 2);
  p.roads = [r];
  const { road } = addRoadsideLanes(p, r.id, "right");
  expect(road.median).toEqual(r.median);
  for (let i = 0; i < 4; i++)
    expect(dist(lanePoint(r, i, 0.5), lanePoint(road, i, 0.5))).toBeLessThan(
      1e-8,
    );
});
it("leaves a clear median end before every crosswalk and builds matching source lane curves", () => {
  const p = emptyProject(),
    o = { twoWay: true, lanesStart: 2, lanesEnd: 2, width: 3.5 };
  p.roads = [
    makeRoad(v(-80, 0), v(), o),
    makeRoad(v(), v(80, 0), o),
    makeRoad(v(), v(0, 80), o),
  ];
  for (const r of p.roads) r.median = { kind: "concrete", width: 2 };
  autoJunction(p);
  const junctions = buildJunctions(p);
  for (const arm of junctions[0].arms) {
    const r = p.roads.find((r) => r.id === arm.road)!,
      range = roadMedianRange(p, r, junctions)!;
    expect(
      arm.end === 0
        ? range.startDistance
        : arcTable(r).at(-1)!.s - range.endDistance,
    ).toBeGreaterThan(arm.crosswalkDistance! + 1.5);
  }
  const sim = new Cs2TrafficSimulation();
  sim.configure(p);
  for (const link of connections(p))
    expect(sim.network!.connectionLaneIds.has(link.id)).toBe(true);
  sim.dispose();
});
it("renders a finite elevated curb and stops it before the junction zebra", () => {
  const road = withRoadMedian(
      makeRoad(v(), v(80, 20), { twoWay: true }, v(25, -10), v(55, 25)),
      2,
    ),
    p = emptyProject();
  p.roads = [road];
  const group = new T.Group(),
    material = new T.MeshBasicMaterial();
  renderRoadMedian(p, road, [], group, material);
  expect(group.children).toHaveLength(1);
  const mesh = group.children[0] as T.Mesh,
    positions = mesh.geometry.getAttribute("position");
  expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  expect(
    Math.max(
      ...Array.from({ length: positions.count }, (_, i) => positions.getY(i)),
    ),
  ).toBeCloseTo(0.31);
  mesh.geometry.dispose();
  material.dispose();
});
it("rejects a median on a one-way road and invalid widths without changing the road", () => {
  const road = makeRoad(v(), v(80, 0)),
    before = JSON.stringify(road);
  expect(() => withRoadMedian(road, 2)).toThrow(/双向/);
  expect(JSON.stringify(road)).toBe(before);
  const two = makeRoad(v(), v(80, 0), { twoWay: true });
  for (const width of [0, NaN, Infinity, 7])
    expect(() => withRoadMedian(two, width)).toThrow(/宽度/);
});
it.each([
  null,
  { kind: "concrete", width: 0 },
  { kind: "concrete", width: 7 },
  { kind: "trees", width: 2 },
])("rejects malformed saved median %s", (median) => {
  const p = emptyProject();
  p.roads = [makeRoad(v(), v(80, 0), { twoWay: true })];
  (p.roads[0] as any).median = median;
  expect(() => parseProject(JSON.stringify(p))).toThrow(/隔离带/);
});
