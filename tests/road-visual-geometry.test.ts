import { describe, expect, it } from "vitest";
import { buildLaneJunctions } from "../src/core/lane-junctions";
import { setJunctionLaneRule } from "../src/core/junction-lane-connections";
import {
  add,
  center,
  dist,
  laneCount,
  lanePoint,
  laneWidth,
  medianWidth,
  mul,
  normal,
  pavementWidth,
  v,
} from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  makeRoad,
} from "../src/core/model";
import {
  logicalProjectSignature,
  setNodeSmooth,
} from "../src/core/road-visual-settings";
import {
  logicalRoadSurface,
  logicalSurfacePlan,
  roadVisualPlan,
  visibleRoadSurfaceTriangles,
  visualExtensionSurfaces,
  visualRoadEdges,
  type RoadSurfaceTriangle,
} from "../src/render/road-visual-geometry";
import type { Project, Road, V } from "../src/core/types";

function seam(from = 3, to = 5): Project {
  const project = emptyProject();
  project.roads = [
    makeRoad(v(-120, 0), v(), {
      id: "a",
      width: 4,
      lanesStart: from,
      lanesEnd: from,
    }),
    makeRoad(v(), v(120, 0), {
      id: "b",
      width: 4,
      lanesStart: to,
      lanesEnd: to,
    }),
  ];
  autoJunction(project);
  return project;
}
function smoothAll(project: Project) {
  for (const node of buildLaneJunctions(project))
    setNodeSmooth(project, node, true);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function area(triangles: readonly RoadSurfaceTriangle[]) {
  return triangles.reduce(
    (sum, [a, b, c]) =>
      sum + Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2,
    0,
  );
}
/** Independent barycentric containment, with a height check for separated decks. */
function contains(triangles: readonly RoadSurfaceTriangle[], point: V) {
  return triangles.some(([a, b, c]) => {
    const determinant = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(determinant) < 1e-10) return false;
    const u =
        ((b.z - c.z) * (point.x - c.x) + (c.x - b.x) * (point.z - c.z)) /
        determinant,
      w =
        ((c.z - a.z) * (point.x - c.x) + (a.x - c.x) * (point.z - c.z)) /
        determinant,
      t = 1 - u - w;
    return (
      u >= -1e-7 &&
      w >= -1e-7 &&
      t >= -1e-7 &&
      Math.abs(point.y - u * a.y - w * b.y - t * c.y) < 0.03
    );
  });
}
function geometry(roads: readonly Road[]) {
  return roads.map((road) =>
    [0, 0.15, 0.5, 0.85, 1].map((t) => ({
      center: center(road, t),
      pavement: pavementWidth(road, t),
      median: medianWidth(road, t),
      lanes: Array.from({ length: laneCount(road) }, (_, lane) => ({
        point: lanePoint(road, lane, t),
        width: laneWidth(road, lane, t),
      })),
    })),
  );
}

describe("independent road display geometry", () => {
  it("reads a frozen authored project without changing roads, rules or visual metadata", () => {
    const project = seam();
    setJunctionLaneRule(project, { road: "a", lane: 0, end: 1 }, [
      { road: "b", lane: 4, end: 0 },
    ]);
    setJunctionLaneRule(project, { road: "a", lane: 1, end: 1 }, []);
    smoothAll(project);
    const before = structuredClone(project);
    freeze(project);
    const plan = roadVisualPlan(project),
      logical = logicalSurfacePlan(project);
    expect(plan.size).toBeGreaterThan(0);
    expect(visibleRoadSurfaceTriangles(project).length).toBeGreaterThan(0);
    expect(
      [...visualExtensionSurfaces(project, plan, logical).values()].flat()
        .length,
    ).toBeGreaterThan(0);
    expect(project).toEqual(before);
  });

  it.each([
    [3, 5],
    [5, 3],
  ])(
    "widens the visible %i to %i seam while retaining every logical lane and direct surface",
    (from, to) => {
      const project = seam(from, to),
        direct = visibleRoadSurfaceTriangles(project),
        signature = logicalProjectSignature(project),
        links = connections(project),
        beforeGeometry = geometry(project.roads);
      smoothAll(project);
      const visible = visibleRoadSurfaceTriangles(project),
        plan = roadVisualPlan(project),
        narrow = project.roads[from < to ? 0 : 1],
        end = from < to ? 1 : 0;
      expect(area(visible)).toBeGreaterThan(area(direct));
      expect(
        dist(...visualRoadEdges(narrow, end, plan.get(narrow.id))),
      ).toBeGreaterThan(pavementWidth(narrow, end) + 0.7);
      for (const triangle of direct) {
        const centroid = mul(triangle.reduce(add, v()), 1 / 3);
        expect(
          contains(visible, centroid),
          `direct pavement lost at ${JSON.stringify(centroid)}`,
        ).toBe(true);
      }
      for (const road of project.roads)
        for (const t of [0, 0.02, 0.15, 0.5, 0.85, 0.98, 1])
          for (let lane = 0; lane < laneCount(road); lane++)
            for (const side of [-1, 1]) {
              const edge = add(
                lanePoint(road, lane, t),
                mul(normal(road, t), side * 0.88),
              );
              expect(
                contains(visible, edge),
                `lane body edge outside ${road.id}/${lane}/${t}`,
              ).toBe(true);
            }
      expect(geometry(project.roads)).toEqual(beforeGeometry);
      expect(logicalProjectSignature(project)).toBe(signature);
      expect(connections(project)).toEqual(links);
    },
  );

  it("keeps the visible widening at a road's two adjacent nodes independent", () => {
    const project = seam(5, 3);
    project.roads.push(
      makeRoad(v(120, 0), v(240, 0), {
        id: "c",
        width: 4,
        lanesStart: 5,
        lanesEnd: 5,
      }),
    );
    autoJunction(project);
    const nodes = buildLaneJunctions(project),
      left = nodes.find((node) => node.arms.some((arm) => arm.road === "a"))!,
      right = nodes.find((node) => node.arms.some((arm) => arm.road === "c"))!,
      middle = project.roads[1],
      baseline = pavementWidth(middle, 0) + 0.7;
    expect(nodes).toHaveLength(2);
    setNodeSmooth(project, left, true);
    let plan = roadVisualPlan(project);
    expect(dist(...visualRoadEdges(middle, 0, plan.get("b")))).toBeGreaterThan(
      baseline,
    );
    expect(dist(...visualRoadEdges(middle, 1, plan.get("b")))).toBeCloseTo(
      baseline,
      8,
    );
    setNodeSmooth(project, right, true);
    setNodeSmooth(project, left, false);
    plan = roadVisualPlan(project);
    expect(dist(...visualRoadEdges(middle, 0, plan.get("b")))).toBeCloseTo(
      baseline,
      8,
    );
    expect(dist(...visualRoadEdges(middle, 1, plan.get("b")))).toBeGreaterThan(
      baseline,
    );
  });

  it("preserves asymmetric directions, median and lateral placement throughout display planning", () => {
    const project = seam(3, 2);
    for (const [index, road] of project.roads.entries()) {
      road.twoWay = true;
      road.backwardLanesStart = road.backwardLanesEnd = index === 0 ? 2 : 3;
      road.median = { kind: "concrete", width: 2 };
      road.sectionOffset = index === 0 ? -1 : 3;
    }
    autoJunction(project);
    const before = geometry(project.roads),
      signature = logicalProjectSignature(project);
    smoothAll(project);
    const triangles = visibleRoadSurfaceTriangles(project);
    expect(triangles.length).toBeGreaterThan(0);
    for (const road of project.roads) {
      expect(medianWidth(road)).toBe(2);
      for (const t of [0.1, 0.5, 0.9])
        for (let lane = 0; lane < laneCount(road); lane++)
          expect(contains(triangles, lanePoint(road, lane, t))).toBe(true);
    }
    expect(project.roads.map((road) => road.sectionOffset)).toEqual([-1, 3]);
    expect(geometry(project.roads)).toEqual(before);
    expect(logicalProjectSignature(project)).toBe(signature);
  });

  it("retains a real authored lane profile instead of turning it into display-only constant width", () => {
    const project = seam(3, 3),
      road = project.roads[1];
    road.lanesEnd = 5;
    road.align = "left";
    road.widthOrigin = 3;
    road.profile = {
      from: 3,
      to: 5,
      start: 0,
      end: 1,
      transitionStart: 0.1,
      transitionEnd: 0.9,
    };
    autoJunction(project);
    const before = geometry(project.roads),
      authored = structuredClone(road.profile);
    smoothAll(project);
    visibleRoadSurfaceTriangles(project);
    expect(laneWidth(road, 4, 0)).toBe(0);
    expect(laneWidth(road, 4, 1)).toBe(4);
    expect(pavementWidth(road, 0)).toBe(12);
    expect(pavementWidth(road, 1)).toBe(20);
    expect(road.profile).toEqual(authored);
    expect(geometry(project.roads)).toEqual(before);
  });

  it("updates the direct seam body envelope from final authored connections and explicit closures", () => {
    const project = seam();
    for (let lane = 0; lane < 3; lane++)
      setJunctionLaneRule(project, { road: "a", lane, end: 1 }, []);
    const outsideStraightApproach = v(-3.2, 7.1),
      closed = visibleRoadSurfaceTriangles(project);
    expect(contains(closed, outsideStraightApproach)).toBe(false);
    setJunctionLaneRule(project, { road: "a", lane: 0, end: 1 }, [
      { road: "b", lane: 4, end: 0 },
    ]);
    expect(connections(project).map((link) => link.id)).toEqual(["a:0>b:4"]);
    expect(
      contains(visibleRoadSurfaceTriangles(project), outsideStraightApproach),
    ).toBe(true);
    expect(project.roadVisuals?.nodes ?? []).toEqual([]);
    setJunctionLaneRule(project, { road: "a", lane: 0, end: 1 }, []);
    expect(
      contains(visibleRoadSurfaceTriangles(project), outsideStraightApproach),
    ).toBe(false);
    expect(connections(project)).toEqual([]);
  });

  it("keeps fork pavement clipped and leaves the real gap between diverging roads open", () => {
    const project = emptyProject(),
      reference = makeRoad(v(-40, 0), v(), { id: "ref", width: 4 }),
      trunk = makeRoad(v(), v(100, 0), { id: "trunk", width: 4 }),
      branch = makeRoad(
        v(0, 2),
        v(100, 25),
        {
          id: "branch",
          width: 4,
          lanesStart: 1,
          lanesEnd: 1,
          kind: "ramp",
          attachments: {
            start: { road: "ref", end: 1, lanes: [1], ownLanes: [0] },
          },
        },
        v(35, 2),
        v(70, 8),
      );
    project.roads = [reference, trunk, branch];
    autoJunction(project);
    const before = visibleRoadSurfaceTriangles(project),
      rawBranch = logicalRoadSurface(branch, { start: 0, end: 1 });
    expect(
      buildLaneJunctions(project).some((node) => node.arms.length === 3),
    ).toBe(true);
    smoothAll(project);
    const logical = logicalSurfacePlan(project),
      visible = visibleRoadSurfaceTriangles(project);
    expect(area(logical.roads.get("branch")!)).toBeLessThan(
      area(rawBranch) * 0.9,
    );
    expect(area(logical.roads.get("branch")!)).toBeGreaterThan(
      area(rawBranch) * 0.3,
    );
    expect(area(visible)).toBeCloseTo(area(before), 8);
    expect(contains(visible, lanePoint(branch, 0, 0.75))).toBe(true);
    expect(contains(visible, v(60, 6))).toBe(false);
  });

  it("does not bridge separate elevations even when old metadata requests a join", () => {
    const project = seam();
    for (const knot of project.roads[1].knots)
      for (const part of ["p", "incoming", "outgoing"] as const)
        knot[part].y = 8;
    const direct = visibleRoadSurfaceTriangles(project);
    project.roadVisuals = {
      version: 1,
      nodes: [
        {
          arms: [
            { road: "a", end: 1 },
            { road: "b", end: 0 },
          ],
          smooth: true,
        },
      ],
    };
    const visible = visibleRoadSurfaceTriangles(project);
    expect(buildLaneJunctions(project)).toEqual([]);
    expect(roadVisualPlan(project).size).toBe(0);
    expect(logicalSurfacePlan(project).seams.size).toBe(0);
    expect(visible).toEqual(direct);
    expect(
      visible
        .flat()
        .every(
          (point) => Math.min(Math.abs(point.y), Math.abs(point.y - 8)) < 1e-9,
        ),
    ).toBe(true);
    expect(contains(visible, v(0, 0, 4))).toBe(false);
    expect(contains(visible, v(-60, 0))).toBe(true);
    expect(contains(visible, v(60, 0, 8))).toBe(true);
  });

  it("does not fill the gap between disconnected parallel roads", () => {
    const project = emptyProject();
    project.roads = [
      makeRoad(v(-120, 0), v(), {
        id: "a",
        width: 4,
        lanesStart: 3,
        lanesEnd: 3,
      }),
      makeRoad(v(-120, 24), v(0, 24), {
        id: "b",
        width: 4,
        lanesStart: 5,
        lanesEnd: 5,
      }),
    ];
    const direct = visibleRoadSurfaceTriangles(project);
    project.roadVisuals = {
      version: 1,
      nodes: [
        {
          arms: [
            { road: "a", end: 1 },
            { road: "b", end: 1 },
          ],
          smooth: true,
        },
      ],
    };
    expect(buildLaneJunctions(project)).toEqual([]);
    expect(roadVisualPlan(project).size).toBe(0);
    const visible = visibleRoadSurfaceTriangles(project);
    expect(visible).toEqual(direct);
    expect(contains(visible, v(-60, 10))).toBe(false);
    expect(contains(visible, lanePoint(project.roads[0], 0, 0.5))).toBe(true);
    expect(contains(visible, lanePoint(project.roads[1], 4, 0.5))).toBe(true);
  });
});
