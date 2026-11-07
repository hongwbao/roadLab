import { expect, it } from "vitest";
import { ROAD_ASSETS } from "../src/core/assets";
import { add, dist, lanePoint, pavementWidth, v } from "../src/core/math";
import {
  emptyProject,
  example,
  makeRoad,
  parseProject,
} from "../src/core/model";
import { withRoadMedian } from "../src/core/road-median";
import { addRoadsideLanes } from "../src/core/road-sections";
import { LANE_WIDTH, standardizeLaneWidths } from "../src/core/road-standards";
import { laneAnchors } from "../src/core/snapping";

it("uses four-metre lanes in every asset and built-in map", () => {
  expect(LANE_WIDTH).toBe(4);
  for (const asset of ROAD_ASSETS)
    expect(asset.options.width, asset.id).toBe(4);
  for (const kind of ["transition", "junction", "elevated"])
    expect(example(kind).roads.every((road) => road.width === 4)).toBe(true);
});

it("normalizes legacy maps and templates once, preserving medians, lane identities and reference geometry", () => {
  const project = emptyProject();
  const road = makeRoad(v(), v(80, 0), {
    width: 3.5,
    sectionOffset: 1.75,
    lanesStart: 3,
    lanesEnd: 3,
  });
  const divided = withRoadMedian(
    makeRoad(v(0, 40), v(80, 40), { twoWay: true, width: 3.5 }),
    2,
  );
  project.roads = [road, divided];
  project.templates = [
    {
      id: "legacy-template",
      name: "旧模板",
      roads: [makeRoad(v(), v(40, 0), { width: 3.6, sectionOffset: 1.8 })],
      connections: [],
    },
  ];
  const loaded = parseProject(JSON.stringify(project));
  const knots = structuredClone(loaded.roads.map((r) => r.knots));
  expect(standardizeLaneWidths(loaded)).toBe(true);
  expect(loaded.roads.map((r) => [r.id, r.width])).toEqual([
    [road.id, 4],
    [divided.id, 4],
  ]);
  expect(loaded.roads[0].sectionOffset).toBe(2);
  expect(loaded.templates[0].roads[0].width).toBe(4);
  expect(loaded.templates[0].roads[0].sectionOffset).toBe(2);
  expect(loaded.roads[1].median).toEqual({ kind: "concrete", width: 2 });
  expect(loaded.roads.map((r) => r.knots)).toEqual(knots);
  expect(pavementWidth(loaded.roads[1], 0.5)).toBe(18);
  const expanded = addRoadsideLanes(loaded, road.id, "right").road;
  expect(expanded.width).toBe(4);
  expect(expanded.lanesStart).toBe(4);
  const before = structuredClone(loaded);
  expect(standardizeLaneWidths(loaded)).toBe(false);
  expect(loaded).toEqual(before);
});

it("aligns a four-metre one-way lane with the actual lane of a divided four-metre road", () => {
  const reference = withRoadMedian(
    makeRoad(v(-80, 0), v(), { twoWay: true }),
    2,
  );
  const proposed = makeRoad(v(), v(80, 0), { lanesStart: 1, lanesEnd: 1 });
  const anchors = laneAnchors(reference, 1, proposed, 0);
  expect(anchors.map((a) => a.contact.z)).toEqual([3, 7]);
  for (const anchor of anchors) {
    const continuation = makeRoad(
      anchor.position,
      add(anchor.position, v(80, 0)),
      {
        lanesStart: 1,
        lanesEnd: 1,
      },
    );
    expect(
      dist(
        lanePoint(reference, anchor.lanes[0], 1),
        lanePoint(continuation, 0, 0),
      ),
    ).toBeLessThan(1e-8);
  }
});
