import { describe, expect, it } from "vitest";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import {
  add,
  boundaryPoint,
  backwardLaneCount,
  mul,
  normal,
  tangent,
  v,
} from "../src/core/math";
import { buildLaneJunctions } from "../src/core/lane-junctions";
import { buildJunctions } from "../src/core/junctions";
import { setNodeSmooth } from "../src/core/road-visual-settings";
import { setJunctionLaneRule } from "../src/core/junction-lane-connections";
import { buildRoadConnectionPlan } from "../src/core/road-connection-geometry";
import {
  connectionVisuals,
  connectionRoadPaint,
} from "../src/render/connection-visuals";
import {
  logicalSurfacePlan,
  roadVisualPlan,
} from "../src/render/road-visual-geometry";
import type { V } from "../src/core/types";

function seam(median = false) {
  const p = emptyProject();
  p.ports = [];
  p.roads = [
    makeRoad(v(-100, 0), v(), {
      id: "a",
      twoWay: median,
      lanesStart: median ? 3 : 2,
      lanesEnd: median ? 3 : 2,
      speed: 60,
      ...(median ? { median: { kind: "concrete" as const, width: 4 } } : {}),
    }),
    makeRoad(v(), v(100, 0), {
      id: "b",
      twoWay: median,
      lanesStart: 3,
      lanesEnd: 3,
      speed: 60,
      ...(median
        ? { backwardLanesStart: 5, backwardLanesEnd: 5, sectionOffset: 2 }
        : {}),
    }),
  ];
  return p;
}
function contains(triangles: readonly (readonly V[])[], p: V) {
  return triangles.some(([a, b, c]) => {
    const cross = (x: V, y: V) =>
        (y.x - x.x) * (p.z - x.z) - (y.z - x.z) * (p.x - x.x),
      s = [cross(a, b), cross(b, c), cross(c, a)];
    return s.every((v) => v >= -1e-6) || s.every((v) => v <= 1e-6);
  });
}

describe("connection gap display", () => {
  it("restores full-span edges and ordered separators only when the node is smooth", () => {
    const p = seam(),
      node = buildLaneJunctions(p)[0],
      geometry = buildRoadConnectionPlan(p, connections(p));
    expect(connectionVisuals(p, roadVisualPlan(p)).size).toBe(0);
    setNodeSmooth(p, node, true);
    const rows = connectionVisuals(p, roadVisualPlan(p)),
      row = [...rows.values()][0];
    expect(row.edges).toHaveLength(2);
    expect(row.lanes).toHaveLength(1);
    expect(row.edges[0][0].x).toBeLessThan(-20);
    expect(row.edges[0].at(-1)!.x).toBeGreaterThan(20);
    expect(row.lanes[0][0].x).toBeCloseTo(
      geometry.curves.values().next().value!.points[0].x,
    );
    expect(buildRoadConnectionPlan(p, connections(p))).toEqual(geometry);
    setNodeSmooth(p, node, false);
    expect(connectionVisuals(p, roadVisualPlan(p)).size).toBe(0);
  });
  it("does not paint a path network for crossing or branching custom movements", () => {
    const p = seam();
    setJunctionLaneRule(p, { road: "a", lane: 0, end: 1 }, [
      { road: "b", lane: 2, end: 0 },
    ]);
    setNodeSmooth(p, buildLaneJunctions(p)[0], true);
    const row = [...connectionVisuals(p, roadVisualPlan(p)).values()][0];
    expect(row.edges).toHaveLength(2);
    expect(row.lanes).toHaveLength(0);
    setJunctionLaneRule(p, { road: "a", lane: 0, end: 1 }, [
      { road: "b", lane: 0, end: 0 },
      { road: "b", lane: 2, end: 0 },
    ]);
    expect(
      [...connectionVisuals(p, roadVisualPlan(p)).values()][0].lanes,
    ).toHaveLength(0);
  });
  it("fills the divider and old triangular cap gaps without changing its true median or station", () => {
    const p = seam(true);
    setNodeSmooth(p, buildLaneJunctions(p)[0], true);
    const before = structuredClone(p),
      logical = logicalSurfacePlan(p),
      row = [...connectionVisuals(p, roadVisualPlan(p), logical).values()][0];
    expect(row.median).toHaveLength(2);
    expect(row.medianFill.length).toBeGreaterThan(128);
    const road = p.roads[0],
      t = logical.functional.stations.get("a:1")!.t,
      cap = add(
        add(
          boundaryPoint(road, backwardLaneCount(road), t),
          mul(tangent(road, t), -1),
        ),
        mul(normal(road, t), 1.8),
      );
    expect(contains(row.medianFill, cap)).toBe(true);
    expect(p).toEqual(before);
  });
  it("keeps genuine intersections unmarked and preserves their crosswalk semantics", () => {
    const p = seam();
    p.roads.push(makeRoad(v(0, -100), v(), { id: "branch" }));
    for (const n of buildLaneJunctions(p)) setNodeSmooth(p, n, true);
    expect(buildJunctions(p).some((n) => n.crosswalks)).toBe(true);
    expect(connectionVisuals(p, roadVisualPlan(p)).size).toBe(0);
  });
  it("ends road paint at the actual cut instead of suppressing another obsolete collar", () => {
    const p = seam();
    setNodeSmooth(p, buildLaneJunctions(p)[0], true);
    const paint = new Map([
        ["a", { 1: [{ end: 1 as const, span: 0.24, continuous: false }] }],
      ]),
      rows = connectionVisuals(p, roadVisualPlan(p));
    expect(connectionRoadPaint(paint, rows).get("a")![1]).toEqual([]);
    expect(paint.get("a")![1]).toHaveLength(1);
  });
});
