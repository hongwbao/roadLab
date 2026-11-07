import { describe, expect, it } from "vitest";
import { emptyProject, makeRoad } from "../src/core/model";
import { center, nearest, point, v } from "../src/core/math";
import { cs2RoadCurvePosition } from "../src/core/cs2-net-geometry";
import { createCS2RoadLabCourseWorld } from "../src/core/cs2-road-building";
import {
  createCS2RoadLabSnapWorld,
  cs2RoadLabSnapNodeId,
  type CS2RoadLabSnapWorld,
} from "../src/core/cs2-road-snap-world";
import {
  cs2RoadControlPoint,
  cs2SnapRoad,
  CS2_ROAD_SNAP,
} from "../src/core/cs2-road-snapping";
import type { Road, V } from "../src/core/types";

const mask = CS2_ROAD_SNAP.existingGeometry | CS2_ROAD_SNAP.nearbyGeometry;
const proposed = () =>
  makeRoad(v(0, 0), v(40, 0), {
    id: "proposed",
    lanesStart: 2,
    lanesEnd: 2,
    width: 3.5,
  });
function snap(
  adapter: CS2RoadLabSnapWorld,
  position: V,
  elevation = position.y,
  original: string | null = null,
  snapMask = mask,
) {
  const result = cs2SnapRoad(adapter.world, {
    prefab: adapter.prefab,
    controlPoints: [cs2RoadControlPoint(position, original)],
    mode: 0,
    snap: snapMask,
    elevation,
  });
  return {
    ...result,
    reference: adapter.resolveReference(
      result.best.originalEntity,
      result.best.curvePosition,
      result.best.direction,
    ),
  };
}
function adapter(roads: Road[], draw = proposed()) {
  return createCS2RoadLabSnapWorld({ roads }, draw, {
    assetId: "custom-asset",
  });
}

describe("RoadLab flat world through actual source road snapping", () => {
  it("builds a new road's direction/grid control point with no existing world geometry", () => {
    const a = adapter([]),
      start = cs2RoadControlPoint(v());
    start.direction = { x: 1, y: 0 };
    const result = cs2SnapRoad(a.world, {
      prefab: a.prefab,
      controlPoints: [start, cs2RoadControlPoint(v(47, 2))],
      mode: 0,
      snap: CS2_ROAD_SNAP.straightDirection | CS2_ROAD_SNAP.cellLength,
      elevation: 0,
    });
    expect(result.best.position.x).toBeCloseTo(48, 5);
    expect(result.best.position.z).toBe(0);
    expect(result.best.originalEntity).toBeNull();
    expect(result.queries).toEqual([
      { kind: "surface", position: result.best.position },
    ]);
  });
  it("snaps a new mid-road attachment using the source candidate choice", () => {
    const road = makeRoad(v(), v(100, 0), { id: "main" }),
      a = adapter([road]),
      result = snap(a, v(43, 1));
    expect(a.pieces).toHaveLength(1);
    expect(result.best.position.x).toBeCloseTo(43, 4);
    expect(result.best.position.z).toBe(0);
    expect(result.reference).toMatchObject({
      road: "main",
      extended: false,
      artificialSeam: false,
    });
    expect(result.reference!.t).toBeCloseTo(0.43, 4);
    expect(result.reference!.end).toBeUndefined();
  });
  it("maps true end/start snaps to logical road endpoints", () => {
    const road = makeRoad(v(), v(100, 0), { id: "main" }),
      a = adapter([road]);
    const end = snap(a, v(102, 2));
    expect(end.best.position).toEqual(v(100, 0));
    expect(end.reference).toMatchObject({ road: "main", t: 1, end: 1 });
    const start = snap(a, v(-2, -1));
    expect(start.best.position).toEqual(v());
    expect(start.reference).toMatchObject({ road: "main", t: 0, end: 0 });
  });
  it("preserves real ramp Y and accepts the matching construction elevation", () => {
    const road = makeRoad(v(0, 0, 0), v(100, 0, 16), { id: "slope" }),
      a = adapter([road]);
    const result = snap(a, v(50, 2, 8));
    expect(result.reference?.road).toBe("slope");
    expect(result.best.position.y).toBeCloseTo(8, 4);
    expect(result.reference!.t).toBeCloseTo(0.5, 4);
    const ground = snap(a, v(50, 2, 0));
    expect(ground.best.position.y).toBe(0);
    expect(ground.reference).toBeUndefined();
  });
  it("keeps stacked ground/high roads separate under the original height stage", () => {
    const ground = makeRoad(v(0, 0, 0), v(100, 0, 0), { id: "ground" }),
      high = makeRoad(v(0, 0, 8), v(100, 0, 8), { id: "high" }),
      a = adapter([ground, high]);
    expect(snap(a, v(50, 2, 0)).reference?.road).toBe("ground");
    expect(snap(a, v(50, 2, 8)).reference?.road).toBe("high");
  });
  it("generates source side-offset choices from the actual nominal lane widths", () => {
    const road = makeRoad(v(), v(100, 0), {
        id: "wide",
        lanesStart: 3,
        lanesEnd: 3,
        width: 3.6,
      }),
      draw = makeRoad(v(), v(40, 0), {
        lanesStart: 1,
        lanesEnd: 1,
        width: 3.6,
      }),
      a = adapter([road], draw),
      result = snap(a, v(50, 3.5));
    expect(result.reference?.road).toBe("wide");
    expect(result.best.position.z).toBeCloseTo(3.6, 5);
    expect(a.world.geometryData.get(a.prefab)!.defaultWidth).toBeCloseTo(
      3.6,
      6,
    );
  });
  it("maps two-way roads using both carriageways, with source offset selection", () => {
    const road = makeRoad(v(), v(100, 0), {
        id: "two-way",
        twoWay: true,
        lanesStart: 2,
        lanesEnd: 2,
        width: 3.5,
      }),
      draw = makeRoad(v(), v(40, 0), {
        twoWay: true,
        lanesStart: 1,
        lanesEnd: 1,
        width: 3.5,
      }),
      a = adapter([road], draw),
      result = snap(a, v(50, 3.4));
    expect(result.reference?.road).toBe("two-way");
    expect(result.best.position.z).toBeCloseTo(3.5, 5);
    const prefab = a.world.prefabRefs.get(road.id)!;
    expect(a.world.geometryData.get(prefab!)!.defaultWidth).toBe(14);
  });
  it("deduplicates real endpoint identities consistently with the course adapter", () => {
    const roads = [
        makeRoad(v(-100, 0), v(), { id: "west" }),
        makeRoad(v(), v(100, 0), { id: "east" }),
        makeRoad(v(0, -100), v(), { id: "south" }),
        makeRoad(v(), v(0, 100), { id: "north" }),
      ],
      a = adapter(roads),
      course = createCS2RoadLabCourseWorld({ roads }, a.prefab, proposed()),
      node = cs2RoadLabSnapNodeId(v());
    expect(a.world.connectedEdges.get(node)).toHaveLength(4);
    expect(course.nodes.has(node)).toBe(true);
    expect(a.diagnostics.logicalNodeCount).toBe(5);
    const result = snap(a, v(1, 2), 0, node);
    expect(result.best.position).toEqual(v());
    expect(result.reference!.end).toBeDefined();
    const vertical = a.resolveReference(node, 0.4, { x: 0, y: 1 })!;
    expect(["south", "north"]).toContain(vertical.road);
    expect(vertical.t === 0 || vertical.t === 1).toBe(true);
  });
  it("uses the same native entity and parameter for a real raycast hit", () => {
    const road = makeRoad(v(), v(100, 0), { id: "picked" }),
      a = adapter([road]),
      native = a.referenceForRoad("picked", 0.43)!;
    const result = snap(a, v(43, 1), 0, native.entity);
    expect(result.reference?.road).toBe("picked");
    expect(result.reference!.t).toBeCloseTo(0.43, 4);
    expect(a.referenceForRoad("unknown", 0.5)).toBeUndefined();
  });
  it("preserves source position versus quantized curve parameter independently", () => {
    const road = makeRoad(v(), v(100, 0), { id: "quantized" }),
      a = adapter([road]),
      prefab = a.world.prefabRefs.get("quantized")!;
    // Explicit contract probe for this original source prefab flag; the default
    // RoadLab asset mapping does not claim to recover this flag from old saves.
    a.world.geometryData.get(prefab!)!.flags |= 4;
    const result = snap(a, v(43, 1));
    expect(result.best.position.x).toBeCloseTo(43, 4);
    expect(result.reference!.t).toBeCloseTo(0.44, 4);
    expect(result.best.position.x).not.toBeCloseTo(
      center(road, result.reference!.t).x,
      2,
    );
  });
  it("keeps source extended parameters explicit instead of inventing an endpoint", () => {
    const road = makeRoad(v(), v(100, 0), { id: "extended" }),
      a = adapter([road]);
    const ref = a.resolveReference("extended", 1.2)!;
    expect(ref.t).toBe(1.2);
    expect(ref.extended).toBe(true);
    expect(ref.end).toBeUndefined();
  });
  it("excludes the edited road without mutating project or proposed asset", () => {
    const road = makeRoad(v(), v(100, 0), { id: "exclude" }),
      project = { ...emptyProject(), roads: [road] },
      draw = proposed(),
      before = structuredClone({ project, draw }),
      a = createCS2RoadLabSnapWorld(project, draw, {
        assetId: "asset",
        excludeRoad: "exclude",
      });
    expect(snap(a, v(50, 1)).reference).toBeUndefined();
    expect(a.pieces).toHaveLength(0);
    expect({ project, draw }).toEqual(before);
  });
  it("invalidates geometry reuse after an in-place road edit while preserving old snapshots", () => {
    const road = makeRoad(v(), v(100, 0), { id: "cached" }),
      before = adapter([road]);
    for (const knot of road.knots)
      for (const p of [knot.p, knot.incoming, knot.outgoing]) p.z += 10;
    const after = adapter([road]);
    expect(snap(before, v(43, 1)).best.position.z).toBe(0);
    expect(snap(after, v(43, 11)).best.position.z).toBe(10);
    before.world.curves.get("cached")!.bezier[0].z = 200;
    const independent = adapter([road]);
    expect(independent.world.curves.get("cached")!.bezier[0].z).toBe(10);
  });
});

describe("non-cubic RoadLab geometry adaptation", () => {
  it("maps an aligned widening's actual visible center and interior seams", () => {
    const road = makeRoad(v(), v(200, 0), {
        id: "taper",
        lanesStart: 2,
        lanesEnd: 3,
        align: "left",
        width: 3.5,
        transitionStart: 0.2,
        transitionEnd: 0.8,
      }),
      a = adapter([road]),
      target = center(road, 0.6),
      result = snap(
        a,
        { ...target, z: target.z + 0.1 },
        0,
        null,
        CS2_ROAD_SNAP.existingGeometry,
      );
    expect(a.pieces.length).toBeGreaterThan(1);
    expect(result.reference?.road).toBe("taper");
    // The source can select a snap-line intersection and quantize its reference
    // parameter. Validate physical geometry independently from that parameter.
    expect(nearest(road, result.best.position).distance).toBeLessThan(0.02);
    const piece = a.pieces.find((p) => p.to !== 1)!;
    const seam = a.resolveReference(piece.entity, 1)!;
    expect(seam.artificialSeam).toBe(true);
    expect(seam.end).toBeUndefined();
    const node = a.world.edges.get(piece.entity)!.end;
    expect(a.resolveReference(node, 0)).toMatchObject({
      road: "taper",
      artificialSeam: true,
    });
    expect(a.resolveReference(node, 0)!.end).toBeUndefined();
  });
  it("checks fit error densely against the visible offset center", () => {
    const road = makeRoad(
        v(),
        v(140, 70),
        {
          id: "curved-taper",
          lanesStart: 1,
          lanesEnd: 3,
          align: "right",
          width: 3.5,
        },
        v(70, -20),
        v(70, 100),
      ),
      a = adapter([road]);
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000,
        native = a.referenceForRoad(road.id, t)!,
        shape = a.world.curves.get(native.entity)!.bezier,
        mapped = cs2RoadCurvePosition(shape, native.curvePosition),
        actual = center(road, t);
      expect(
        Math.hypot(
          mapped.x - actual.x,
          mapped.y - actual.y,
          mapped.z - actual.z,
        ),
      ).toBeLessThanOrEqual(0.021);
    }
    expect(a.diagnostics.maxCenterError).toBeLessThanOrEqual(0.02);
    expect(a.diagnostics.maxWidthError).toBeLessThanOrEqual(0.125);
  });
  it("preserves automatic taper center shifts, slopes and source round-trip mapping", () => {
    const road = makeRoad(v(), v(120, 40, 16), {
      id: "auto",
      lanesStart: 3,
      lanesEnd: 3,
    });
    road.autoTaper = {
      start: { lanes: 2, firstLane: 1, offset: 1.8, span: 0.4 },
    };
    const a = adapter([road]);
    for (const t of [0, 0.1, 0.4, 0.7, 1]) {
      const native = a.referenceForRoad(road.id, t)!,
        ref = a.resolveReference(native.entity, native.curvePosition)!;
      expect(ref.t).toBeCloseTo(t, 12);
      const expected = center(road, t),
        actual = cs2RoadCurvePosition(
          a.world.curves.get(native.entity)!.bezier,
          native.curvePosition,
        );
      expect(
        Math.hypot(
          actual.x - expected.x,
          actual.y - expected.y,
          actual.z - expected.z,
        ),
      ).toBeLessThan(0.021);
    }
    const target = center(road, 0.7),
      result = snap(
        a,
        { ...target, x: target.x + 0.05 },
        target.y,
        null,
        CS2_ROAD_SNAP.existingGeometry,
      );
    expect(result.reference?.road).toBe("auto");
    expect(result.best.position.y).toBeCloseTo(
      center(road, result.reference!.t).y,
      2,
    );
  });
  it("maps a continuous multi-knot road through source candidates without exposing fitting seams as endpoints", () => {
    const road = makeRoad(
        v(),
        v(100, 100),
        { id: "multi", width: 3.5 },
        v(40, -20),
        v(60, 100),
      ),
      blend = (a: V, b: V, t: number): V => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      }),
      [a, d] = road.knots,
      cut = 0.3,
      ab = blend(a.p, a.outgoing, cut),
      bc = blend(a.outgoing, d.incoming, cut),
      cd = blend(d.incoming, d.p, cut),
      abc = blend(ab, bc, cut),
      bcd = blend(bc, cd, cut),
      middle = blend(abc, bcd, cut);
    road.knots = [
      { p: a.p, incoming: a.p, outgoing: ab, at: 0 },
      { p: middle, incoming: abc, outgoing: bcd, at: cut },
      { p: d.p, incoming: cd, outgoing: d.p, at: 1 },
    ];
    const world = adapter([road]),
      native = world.referenceForRoad(road.id, 0.6)!,
      target = center(road, 0.6),
      result = snap(
        world,
        { ...target, z: target.z + 0.2 },
        0,
        native.entity,
        CS2_ROAD_SNAP.existingGeometry,
      );
    expect(result.reference?.road).toBe("multi");
    expect(result.reference!.end).toBeUndefined();
    expect(
      world.resolveReference(native.entity, native.curvePosition)!.t,
    ).toBeCloseTo(0.6, 12);
    for (const piece of world.pieces) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const actual = cs2RoadCurvePosition(piece.curve, u),
          expected = center(road, piece.from + (piece.to - piece.from) * u);
        expect(
          Math.hypot(
            actual.x - expected.x,
            actual.y - expected.y,
            actual.z - expected.z,
          ),
        ).toBeLessThan(0.02);
      }
    }
  });
  it("returns editable anchors without applying the proposed center shift twice", () => {
    const draw = makeRoad(v(), v(80, 0), {
        lanesStart: 2,
        lanesEnd: 3,
        align: "left",
        width: 3.5,
      }),
      a = adapter([], draw),
      physical = v(90, 4),
      editable = a.editablePosition(physical, 1),
      shift = sub3(center(draw, 1), point(draw, 1));
    expect({
      x: editable.x + shift.x,
      y: editable.y + shift.y,
      z: editable.z + shift.z,
    }).toEqual(physical);
  });
  it("reports unrepresentable offset discontinuities instead of hiding them in kernel tolerance", () => {
    const road = makeRoad(v(), v(100, 0), {
      id: "discontinuous",
      lanesStart: 2,
      lanesEnd: 3,
      align: "left",
    });
    road.knots.splice(1, 0, {
      p: v(50, 0),
      incoming: v(40, 0),
      outgoing: v(50, 10),
      at: 0.5,
    });
    expect(() =>
      createCS2RoadLabSnapWorld({ roads: [road] }, proposed(), {
        assetId: "asset",
        maxFitDepth: 3,
      }),
    ).toThrow("cannot fit source cubic snapshot");
  });
});
const sub3 = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
