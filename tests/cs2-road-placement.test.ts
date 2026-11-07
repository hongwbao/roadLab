import { expect, it } from "vitest";
import { makeRoad } from "../src/core/model";
import { center, v } from "../src/core/math";
import { cs2RoadControlPoint } from "../src/core/cs2-road-snapping";
import {
  placeCS2RoadLabPoint,
  type CS2RoadLabPlacementInput,
  type CS2RoadLabPlacementPoint,
} from "../src/core/cs2-road-placement";
import type { Road } from "../src/core/types";

function input(
  roads: Road[],
  raw = v(),
  previous: readonly CS2RoadLabPlacementPoint[] = [],
): CS2RoadLabPlacementInput {
  return {
    project: { roads },
    proposedRoad: makeRoad(v(), v(100, 0), { width: 3.5 }),
    assetId: "custom",
    raw,
    previous,
    mode: 0,
    snap: true,
    grid: true,
  };
}
function firstPoint(height = 0) {
  const road = makeRoad(v(-100, 0, height), v(0, 0, height), {
      id: "existing",
      width: 3.5,
    }),
    base = input([road], v(-1, 1, height)),
    first = placeCS2RoadLabPoint({ ...base, grid: false });
  return { road, base, first };
}

it("retains the first source-selected endpoint and snaps the second click to the 64m grid position", () => {
  const { base, first } = firstPoint();
  expect(first.point.position).toEqual(v());
  expect(first.point.reference).toMatchObject({ road: "existing", end: 1 });
  const second = placeCS2RoadLabPoint({
    ...base,
    raw: v(62, 2),
    previous: [first.point],
  });
  expect(second.point.position.x).toBeCloseTo(64, 5);
  expect(second.point.position.z).toBe(0);
  const native = second.adapter!.referenceForRoad("existing", 1)!;
  expect(second.source!.controlPoints[0].originalEntity).toBe(native.node);
  expect(second.source!.controlPoints[0].position).toEqual(
    first.point.source.position,
  );
  expect(second.source!.controlPoints[0].direction).toEqual(
    first.point.source.direction,
  );
  expect(second.source!.controlPoints[0].snapPriority).toEqual(
    first.point.source.snapPriority,
  );
});
it("turns off cell-length quantization while preserving source direction snapping", () => {
  const { base, first } = firstPoint(),
    result = placeCS2RoadLabPoint({
      ...base,
      raw: v(62, 2),
      previous: [first.point],
      grid: false,
    });
  expect(result.point.position.x).toBeCloseTo(62, 5);
  expect(result.point.position.z).toBe(0);
});
it("retains the source centered grid phase on arbitrary old road lengths", () => {
  const { base } = firstPoint(),
    first = placeCS2RoadLabPoint(base);
  expect(first.point.source.position.x).toBeCloseTo(-1.95, 4);
  expect(first.point.reference!.end).toBeUndefined();
  expect(first.point.reference!.t).toBeCloseTo(0.9805, 4);
  const second = placeCS2RoadLabPoint({
    ...base,
    raw: v(62, 2),
    previous: [first.point],
  });
  expect(second.point.source.position.x).toBeCloseTo(62.05, 4);
});
it("preserves the source grid phase even when the real raycast hits an endpoint node", () => {
  const { base } = firstPoint(),
    result = placeCS2RoadLabPoint({ ...base, hit: { road: "existing", t: 1 } });
  expect(result.point.source.position.x).toBeCloseTo(-1.95, 4);
  // Node identity itself is a real endpoint; its snapped physical position and
  // source curve parameter are still retained independently.
  expect(result.point.reference).toMatchObject({ road: "existing", end: 1 });
});
it("maps real endpoint and middle raycast hits without a nearest-pixel ranking layer", () => {
  const { base } = firstPoint(),
    endpoint = placeCS2RoadLabPoint({
      ...base,
      grid: false,
      hit: { road: "existing", t: 1 },
    }),
    middle = placeCS2RoadLabPoint({
      ...base,
      raw: v(-50, 1),
      grid: false,
      hit: { road: "existing", t: 0.5 },
    });
  expect(endpoint.point.position).toEqual(v());
  expect(endpoint.point.reference).toMatchObject({ road: "existing", end: 1 });
  expect(middle.point.source.position.x).toBeCloseTo(-50, 4);
  expect(middle.point.reference!.t).toBeCloseTo(0.5, 4);
});
it("drops a missing raycast entity instead of borrowing an unrelated road", () => {
  const request = input([], v(47, 3)),
    result = placeCS2RoadLabPoint({
      ...request,
      hit: { road: "deleted", t: 0.5 },
    });
  expect(result.point.reference).toBeUndefined();
  expect(result.point.source.originalEntity).toBeNull();
});
it("continues from the previous source control point after a completed straight segment", () => {
  const { base, first } = firstPoint(),
    second = placeCS2RoadLabPoint({
      ...base,
      raw: v(62, 2),
      previous: [first.point],
    }),
    third = placeCS2RoadLabPoint({
      ...base,
      raw: v(103, 2),
      previous: [second.point],
    });
  expect(third.point.position.x).toBeCloseTo(104, 5);
  expect(third.point.position.z).toBe(0);
  expect(third.source!.controlPoints[0].direction).toEqual(
    second.point.source.direction,
  );
});
it("preserves two clicked source points when placing the third simple-curve point", () => {
  const { base, first } = firstPoint(),
    middle = placeCS2RoadLabPoint({
      ...base,
      mode: 1,
      grid: false,
      raw: v(40, 20),
      previous: [first.point],
    }),
    before = structuredClone([first.point, middle.point]),
    last = placeCS2RoadLabPoint({
      ...base,
      mode: 1,
      grid: false,
      raw: v(81, 40),
      previous: before,
    });
  expect(last.source!.controlPoints).toHaveLength(3);
  expect(last.source!.controlPoints[0].position).toEqual(
    first.point.source.position,
  );
  expect(last.source!.controlPoints[1].position).toEqual(
    middle.point.source.position,
  );
  const difference = {
    x: last.point.source.position.x - middle.point.source.position.x,
    z: last.point.source.position.z - middle.point.source.position.z,
  };
  expect(difference.z / difference.x).toBeCloseTo(0.5, 5);
  expect(before).toEqual([first.point, middle.point]);
});
it("writes the original caller's construction elevation for normal elevated placement", () => {
  const { base, first } = firstPoint(16),
    second = placeCS2RoadLabPoint({
      ...base,
      raw: v(62, 2, 16),
      previous: [first.point],
    });
  expect(first.point.source.elevation).toBe(16);
  expect(second.point.position.y).toBe(16);
  expect(second.point.source.elevation).toBe(16);
});
it("disables snapping metadata while preserving raw coordinates and elevated construction", () => {
  const raw = { x: 12.3456789, y: 16, z: -7.654321 },
    proposal = input([], raw),
    result = placeCS2RoadLabPoint({ ...proposal, snap: false });
  expect(result.point.position).toEqual(raw);
  expect(result.point.source).toEqual({
    ...cs2RoadControlPoint(raw),
    elevation: 16,
  });
  expect(result.point.reference).toBeUndefined();
  expect(result.source).toBeUndefined();
  expect(result.adapter).toBeUndefined();
});
it("bypasses world creation entirely when snapping is disabled", () => {
  const malformed = { ...makeRoad(v(), v(20, 0)), knots: [] },
    result = placeCS2RoadLabPoint({
      ...input([malformed], v(13, 9, 8)),
      snap: false,
    });
  expect(result.point.position).toEqual(v(13, 9, 8));
  expect(result.point.source.elevation).toBe(8);
});
it("rebinds a saved global reference after native road segmentation changes", () => {
  const road = makeRoad(v(), v(200, 0), { id: "changed", width: 3.5 }),
    base = input([road], v(64, 1)),
    first = placeCS2RoadLabPoint({ ...base, grid: false });
  expect(first.point.reference).toMatchObject({
    road: "changed",
    extended: false,
  });
  road.autoTaper = {
    start: { lanes: 1, firstLane: 0, offset: 1.75, span: 0.5 },
  };
  const before = structuredClone(first.point),
    next = placeCS2RoadLabPoint({
      ...base,
      raw: v(120, 40),
      previous: [first.point],
    }),
    rebound = next.adapter!.referenceForRoad(
      road.id,
      first.point.reference!.t,
    )!;
  expect(next.source!.controlPoints[0].originalEntity).toBe(rebound.entity);
  expect(next.source!.controlPoints[0].curvePosition).toBeCloseTo(
    rebound.curvePosition,
    6,
  );
  expect(next.source!.controlPoints[0].position).toEqual(
    first.point.source.position,
  );
  expect(next.source!.controlPoints[0].snapPriority).toEqual(
    first.point.source.snapPriority,
  );
  expect(first.point).toEqual(before);
});
it("clears deleted-road native identity without moving the previous physical click", () => {
  const { base, first } = firstPoint(),
    next = placeCS2RoadLabPoint({
      ...base,
      project: { roads: [] },
      raw: v(40, 2),
      previous: [first.point],
    });
  expect(next.source!.controlPoints[0].originalEntity).toBeNull();
  expect(next.source!.controlPoints[0].curvePosition).toBe(0);
  expect(next.source!.controlPoints[0].position).toEqual(
    first.point.source.position,
  );
  expect(next.source!.controlPoints[0].direction).toEqual(
    first.point.source.direction,
  );
});
it("keeps an artificial seam internal when its global reference is rebound", () => {
  const road = makeRoad(v(), v(200, 0), {
      id: "taper",
      lanesStart: 2,
      lanesEnd: 3,
      align: "left",
    }),
    base = input([road], center(road, 0.5)),
    first = placeCS2RoadLabPoint(base),
    piece = first.adapter!.pieces.find((p) => p.to < 1)!,
    reference = first.adapter!.resolveReference(piece.entity, 1)!,
    source = cs2RoadControlPoint(center(road, reference.t));
  source.originalEntity = piece.entity;
  source.curvePosition = 1;
  const stored = { position: { ...source.position }, source, reference },
    next = placeCS2RoadLabPoint({
      ...base,
      raw: v(120, 40),
      previous: [stored],
    }),
    rebound = next.adapter!.referenceForRoad(road.id, reference.t)!;
  expect(next.source!.controlPoints[0].originalEntity).toBe(rebound.entity);
  expect(reference.end).toBeUndefined();
});
it("keeps extended references as physical continuation points with no native join identity", () => {
  const road = makeRoad(v(), v(200, 0), { id: "extended" }),
    base = input([road]),
    adapter = placeCS2RoadLabPoint(base).adapter!,
    reference = adapter.resolveReference(road.id, 1.2)!,
    source = cs2RoadControlPoint(v(240, 0));
  source.originalEntity = road.id;
  source.curvePosition = 1.2;
  source.direction = { x: 1, y: 0 };
  const previous = { position: { ...source.position }, source, reference },
    next = placeCS2RoadLabPoint({
      ...base,
      raw: v(279, 1),
      previous: [previous],
    });
  expect(next.source!.controlPoints[0].originalEntity).toBeNull();
  expect(next.source!.controlPoints[0].curvePosition).toBe(0);
  expect(next.source!.controlPoints[0].position).toEqual(source.position);
  expect(next.source!.controlPoints[0].direction).toEqual(source.direction);
});
it("returns physical and editable positions separately for aligned proposed roads", () => {
  const draw = makeRoad(v(), v(100, 0), {
      lanesStart: 2,
      lanesEnd: 3,
      align: "left",
      width: 3.5,
    }),
    first = placeCS2RoadLabPoint({ ...input([]), proposedRoad: draw }),
    next = placeCS2RoadLabPoint({
      ...input([], v(80, 0)),
      proposedRoad: draw,
      previous: [first.point],
    });
  expect(next.point.source.position).toEqual(next.source!.best.position);
  expect(next.point.position).toEqual(
    next.adapter!.editablePosition(next.source!.best.position, 1),
  );
  expect(next.point.position.z).not.toBe(next.point.source.position.z);
});
it("respects the edit exclusion and does not mutate input or alias diagnostic best state", () => {
  const { base, first, road } = firstPoint(),
    request = {
      ...base,
      raw: v(-30, 1),
      previous: [first.point],
      excludeRoad: road.id,
    },
    before = structuredClone(request),
    result = placeCS2RoadLabPoint(request);
  expect(result.point.reference).toBeUndefined();
  expect(request).toEqual(before);
  const x = result.source!.best.position.x;
  result.point.source.position.x += 10;
  expect(result.source!.best.position.x).toBe(x);
});
