import { describe, expect, it } from "vitest";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import { bezier, dist, lanePoint, sub, v } from "../src/core/math";
import { buildLaneJunctions } from "../src/core/lane-junctions";
import {
  junctionLaneLayout,
  setJunctionLaneRule,
} from "../src/core/junction-lane-connections";
import { buildRoadConnectionPlan } from "../src/core/road-connection-geometry";
import { setNodeSmooth } from "../src/core/road-visual-settings";
import {
  logicalSurfacePlan,
  visibleRoadSurfaceTriangles,
  type RoadSurfaceTriangle,
} from "../src/render/road-visual-geometry";
import {
  makeTrafficSignal,
  signalStopOffset,
} from "../src/core/traffic-signals";
import { buildJunctions } from "../src/core/junctions";

function seam(length = 100) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-length, 0), v(), {
      id: "wide",
      twoWay: true,
      lanesStart: 3,
      lanesEnd: 3,
      backwardLanesStart: 5,
      backwardLanesEnd: 5,
      sectionOffset: 2,
    }),
    makeRoad(v(), v(length, 0), {
      id: "six",
      twoWay: true,
      lanesStart: 3,
      lanesEnd: 3,
      median: { kind: "concrete", width: 4 },
    }),
  ];
  p.roads.forEach((r) => {
    r.speed = 60;
  });
  p.ports = [];
  setJunctionLaneRule(p, { road: "six", lane: 0, end: 0 }, [
    { road: "wide", lane: 1, end: 1 },
    { road: "wide", lane: 0, end: 1 },
  ]);
  setJunctionLaneRule(p, { road: "six", lane: 2, end: 0 }, [
    { road: "wide", lane: 3, end: 1 },
    { road: "wide", lane: 4, end: 1 },
  ]);
  return p;
}
const dot = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) => a.x * b.x + a.y * b.y + a.z * b.z;
function contains(
  triangles: readonly RoadSurfaceTriangle[],
  p: { x: number; y: number; z: number },
) {
  return triangles.some(([a, b, c]) => {
    const cross = (x: typeof a, y: typeof a, q: typeof a) =>
      (y.x - x.x) * (q.z - x.z) - (y.z - x.z) * (q.x - x.x);
    const s = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
    return s.every((n) => n >= -1e-6) || s.every((n) => n <= 1e-6);
  });
}

describe("functional continuation geometry", () => {
  it("also supplies a forward-only curve in the opposite traffic direction", () => {
    const p = seam();
    setJunctionLaneRule(p, { road: "wide", lane: 5, end: 1 }, [
      { road: "six", lane: 4, end: 0 },
    ]);
    const links = connections(p),
      plan = buildRoadConnectionPlan(p, links),
      link = links.find(
        (c) => c.from.road === "wide" && c.from.lane === 5 && c.to.lane === 4,
      )!;
    expect(link.manual).toBe(true);
    const curve = plan.curves.get(link.id)!;
    expect(curve.length).toBeGreaterThan(50);
    for (let i = 1; i < 4; i++)
      expect(curve.points[i].x).toBeGreaterThan(curve.points[i - 1].x);
  });

  it("reserves a non-overlapping road interval when both ends need a connection region", () => {
    const p = emptyProject();
    p.ports = [];
    const options = { twoWay: false, lanesStart: 2, lanesEnd: 2, speed: 60 };
    p.roads = [
      makeRoad(v(-120, 0), v(), { ...options, id: "a" }),
      makeRoad(v(), v(20, 0), { ...options, id: "mid" }),
      makeRoad(v(20, 0), v(140, 0), { ...options, id: "b" }),
    ];
    setJunctionLaneRule(p, { road: "a", lane: 0, end: 1 }, [
      { road: "mid", lane: 1, end: 0 },
    ]);
    setJunctionLaneRule(p, { road: "mid", lane: 0, end: 1 }, [
      { road: "b", lane: 1, end: 0 },
    ]);
    const plan = buildRoadConnectionPlan(p, connections(p)),
      trim = plan.trims.get("mid")!;
    expect(trim.start).toBeGreaterThan(0);
    expect(trim.end).toBeGreaterThan(0);
    expect(trim.start + trim.end).toBeLessThanOrEqual(16);
    expect(plan.stations.get("mid:0")!.t).toBeLessThan(
      plan.stations.get("mid:1")!.t,
    );
  });

  it("preserves authored multi-target rules and gives4m lateral movements real forward space", () => {
    const p = seam(),
      before = structuredClone(p),
      links = connections(p),
      plan = buildRoadConnectionPlan(p, links);
    for (const [from, to] of [
      [0, 0],
      [2, 4],
    ]) {
      const link = links.find(
        (c) =>
          c.from.road === "six" &&
          c.from.lane === from &&
          c.to.road === "wide" &&
          c.to.lane === to,
      )!;
      expect(link.manual).toBe(true);
      const curve = plan.curves.get(link.id)!,
        forward = v(-1, 0);
      expect(curve.length).toBeGreaterThan(50);
      for (let i = 1; i < 4; i++)
        expect(
          dot(sub(curve.points[i], curve.points[i - 1]), forward),
        ).toBeGreaterThan(0);
      expect(
        dist(
          curve.points[0],
          lanePoint(p.roads[1], from, plan.stations.get("six:0")!.t),
        ),
      ).toBeLessThan(1e-8);
      expect(
        dist(
          curve.points[3],
          lanePoint(p.roads[0], to, plan.stations.get("wide:1")!.t),
        ),
      ).toBeLessThan(1e-8);
    }
    expect(p).toEqual(before);
  });

  it("uses exactly the shared controls for enabled UI links and one station per arm", () => {
    const p = seam(),
      links = connections(p),
      node = buildLaneJunctions(p)[0],
      plan = buildRoadConnectionPlan(p, links),
      layout = junctionLaneLayout(p, node, links);
    for (const arm of node.arms) {
      const ports = layout.ports.filter((port) => port.road === arm.road);
      expect(ports.length).toBeGreaterThan(0);
      expect(
        new Set(ports.map((port) => port.position.x.toFixed(7))).size,
      ).toBe(1);
    }
    for (const link of layout.links) {
      expect(link.points).toEqual(plan.curves.get(link.id)!.points);
      for (let i = 0; i < link.samples.length; i++)
        expect(link.samples[i]).toEqual(bezier(...link.points, i / 48));
    }
  });

  it("keeps a wholly aligned ordinary seam transparent and all-closed nodes editable", () => {
    const p = emptyProject();
    p.ports = [];
    p.roads = [
      makeRoad(v(-80, 0), v(), { id: "a" }),
      makeRoad(v(), v(80, 0), { id: "b" }),
    ];
    let plan = buildRoadConnectionPlan(p, connections(p));
    expect(plan.trims.get("a")!.end).toBe(0);
    expect(plan.trims.get("b")!.start).toBe(0);
    const node = buildLaneJunctions(p)[0];
    for (const port of junctionLaneLayout(p, node, connections(p)).ports.filter(
      (port) => port.kind === "in",
    ))
      setJunctionLaneRule(p, port, []);
    plan = buildRoadConnectionPlan(p, connections(p));
    const layout = junctionLaneLayout(p, node, connections(p));
    expect(layout.links).toHaveLength(0);
    expect(layout.candidates.length).toBeGreaterThan(0);
    expect(layout.ports.length).toBeGreaterThan(0);
    expect(plan.nodes[0].id).toBe(node.id);
  });

  it("is independent of visual style and leaves zero crossings in the control polygon even when short", () => {
    const p = seam(8),
      before = buildRoadConnectionPlan(p, connections(p));
    setNodeSmooth(p, buildLaneJunctions(p)[0], true);
    expect(buildRoadConnectionPlan(p, connections(p))).toEqual(before);
    for (const trim of before.trims.values())
      expect(trim.start + trim.end).toBeLessThanOrEqual(6.4);
    for (const [id, curve] of before.curves)
      if (id.includes("six:0") && id.includes("wide:0")) {
        expect(curve.length).toBeGreaterThan(4);
        for (let i = 1; i < 4; i++)
          expect(curve.points[i].x).toBeLessThan(curve.points[i - 1].x);
      }
  });

  it("covers every sampled vehicle body across the real connection with style off and on", () => {
    const p = seam(),
      links = connections(p),
      plan = buildRoadConnectionPlan(p, links);
    for (const smooth of [false, true]) {
      setNodeSmooth(p, buildLaneJunctions(p)[0], smooth);
      const surface = visibleRoadSurfaceTriangles(p),
        ranges = logicalSurfacePlan(p).ranges;
      expect(ranges.get("wide")!.end).toBeLessThan(1);
      expect(ranges.get("six")!.start).toBeGreaterThan(0);
      for (const curve of plan.curves.values())
        for (let i = 0; i <= 40; i++) {
          const t = i / 40,
            center = bezier(...curve.points, t),
            a = bezier(...curve.points, Math.max(0, t - 0.001)),
            b = bezier(...curve.points, Math.min(1, t + 0.001));
          const angle = Math.atan2(b.z - a.z, b.x - a.x);
          for (const x of [-1.9, 0, 1.9])
            for (const z of [-0.88, 0, 0.88])
              expect(
                contains(surface, {
                  x: center.x + x * Math.cos(angle) - z * Math.sin(angle),
                  y: 0,
                  z: center.z + x * Math.sin(angle) + z * Math.cos(angle),
                }),
              ).toBe(true);
        }
    }
  });

  it("preserves actual junction stop-line trims and does not add the signal offset twice", () => {
    const p = emptyProject();
    p.ports = [];
    p.roads = [
      makeRoad(v(-100, 0), v(), { id: "w" }),
      makeRoad(v(), v(100, 0), { id: "e" }),
      makeRoad(v(0, -100), v(), { id: "n" }),
    ];
    const node = buildJunctions(p)[0];
    p.signals = [makeTrafficSignal(node)];
    const plan = buildRoadConnectionPlan(p, connections(p));
    for (const arm of node.arms)
      expect(
        plan.trims.get(arm.road)![arm.end === 0 ? "start" : "end"],
      ).toBeCloseTo(arm.trim + signalStopOffset(arm));
    expect(
      buildRoadConnectionPlan(p, connections(p), plan.trims).trims,
    ).toEqual(plan.trims);
  });
});
