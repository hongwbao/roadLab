import { expect, it } from "vitest";
import { add, center, dist, lanePoint, point, sub, v } from "../src/core/math";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import { endpointAnchors } from "../src/core/snapping";
const source = () =>
  makeRoad(v(-80, 0), v(0, 0), { lanesStart: 3, lanesEnd: 3, width: 3.6 });
it("offsets a two-lane continuation so the first two lane paths match a three-lane approach", () => {
  const r = source(),
    n = makeRoad(v(0, 0), v(80, 0), { lanesStart: 2, lanesEnd: 2, width: 3.6 });
  const a = endpointAnchors(r, 1, n, 0, "left")[0];
  expect(a.offset).toBeCloseTo(-1.8);
  const road = makeRoad(a.position, add(a.position, v(80, 0)), {
    lanesStart: 2,
    lanesEnd: 2,
    width: 3.6,
  });
  for (let lane = 0; lane < 2; lane++)
    expect(dist(lanePoint(r, lane, 1), lanePoint(road, lane, 0))).toBeLessThan(
      1e-8,
    );
});
it("aligns a one-lane exit to the outer lane and derives its connection automatically", () => {
  const r = source(),
    n = makeRoad(v(0, 0), v(80, 0), { lanesStart: 1, lanesEnd: 1, width: 3.6 });
  const a = endpointAnchors(r, 1, n, 0, "right")[0];
  expect(a.offset).toBeCloseTo(3.6);
  const road = makeRoad(a.position, add(a.position, v(80, 0)), {
    lanesStart: 1,
    lanesEnd: 1,
    width: 3.6,
  });
  expect(dist(lanePoint(r, 2, 1), lanePoint(road, 0, 0))).toBeLessThan(1e-8);
  const p = emptyProject();
  p.roads = [r, road];
  expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([[2, 0]]);
});
it("compensates the editable axis when the physical centre shifts along a widening", () => {
  const old = makeRoad(v(80, 0), v(150, 0), {
    lanesStart: 3,
    lanesEnd: 3,
    width: 3.6,
  });
  const proposed = makeRoad(v(0, 0), v(80, 0), {
    lanesStart: 2,
    lanesEnd: 3,
    width: 3.6,
    align: "left",
  });
  const a = endpointAnchors(old, 0, proposed, 1, "center")[0];
  expect(a.position.z).toBeCloseTo(-1.8);
  const delta = sub(a.position, point(proposed, 1));
  for (const k of proposed.knots)
    for (const key of ["p", "incoming", "outgoing"] as const)
      k[key] = add(k[key], delta);
  expect(dist(center(proposed, 1), a.contact)).toBeLessThan(1e-8);
});
it("rotates offset anchors with the road instead of world-grid axes", () => {
  const r = makeRoad(v(-60, -60), v(0, 0), {
      lanesStart: 3,
      lanesEnd: 3,
      width: 3.6,
    }),
    n = makeRoad(v(0, 0), v(60, 60), {
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.6,
    });
  const a = endpointAnchors(r, 1, n, 0, "right")[0],
    road = makeRoad(a.position, add(a.position, v(60, 60)), {
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.6,
    });
  expect(dist(lanePoint(r, 2, 1), lanePoint(road, 0, 0))).toBeLessThan(1e-8);
});
it("keeps city junctions and perpendicular connections on the shared centre node", () => {
  const r = source();
  for (const proposed of [
    makeRoad(v(0, 0), v(0, 80)),
    makeRoad(v(0, 0), v(80, 0), { twoWay: true }),
  ]) {
    const as = endpointAnchors(r, 1, proposed, 0);
    expect(as).toHaveLength(1);
    expect(as[0].alignment).toBe("center");
  }
});
