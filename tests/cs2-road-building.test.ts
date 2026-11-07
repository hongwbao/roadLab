import { expect, it } from "vitest";
import { emptyProject, makeRoad } from "../src/core/model";
import { v } from "../src/core/math";
import { cs2RoadCourseControlPoint } from "../src/core/cs2-road-courses";
import {
  buildCS2RoadLabCourse,
  createCS2RoadLabCourseWorld,
} from "../src/core/cs2-road-building";

it("maps the full simple course transaction to a circular road and preserves its commands", () => {
  const project = emptyProject(),
    before = structuredClone(project),
    points = [v(0, 0), v(0, 60), v(60, 60)] as const;
  const { road, source } = buildCS2RoadLabCourse({
    project,
    asset: "city-2",
    points,
    options: { twoWay: true, lanesStart: 1, lanesEnd: 1, width: 3.5 },
  });
  expect(road.knots[0].outgoing.z).toBeCloseTo(33.13709, 4);
  expect(road.knots[1].incoming.x).toBeCloseTo(26.86291, 4);
  expect(source.courses[0].length).toBeGreaterThan(94);
  expect(source.courses[0].length).toBeLessThan(95);
  expect(
    source.commands.map((c) =>
      c.kind === "add-component" ? c.component : c.kind,
    ),
  ).toEqual(["create-entity", "CreationDefinition", "Updated", "NetCourse"]);
  expect(project).toEqual(before);
  expect(points).toEqual([v(0, 0), v(0, 60), v(60, 60)]);
});

it("uses actual edge/node identities and preserves the chosen mid-road parameter", () => {
  const a = makeRoad(v(-100, 0), v(0, 0), { id: "a" }),
    b = makeRoad(v(0, 0), v(100, 0), { id: "b" }),
    project = { ...emptyProject(), roads: [a, b] },
    world = createCS2RoadLabCourseWorld(project, "asset", a);
  expect(world.edges.get("a")!.end).toBe(world.edges.get("b")!.start);
  const { source } = buildCS2RoadLabCourse({
    project,
    asset: "asset",
    options: {},
    points: [v(-50, 0), v(-50, 50)],
    start: { road: "a", t: 0.5 },
  });
  expect(source.courses[0].start.entity).toBe("a");
  expect(source.courses[0].start.splitPosition).toBe(0.5);
});

it("linearizes the grade in the full simple builder and keeps the prototype road fields", () => {
  const { road } = buildCS2RoadLabCourse({
    project: emptyProject(),
    asset: "ramp",
    options: {
      kind: "ramp",
      lanesStart: 3,
      lanesEnd: 2,
      align: "right",
      width: 3.5,
    },
    points: [v(0, 0, 0), v(0, 60, 30), v(60, 60, 12)],
  });
  expect(road.knots[0].outgoing.y).toBe(4);
  expect(road.knots[1].incoming.y).toBe(8);
  expect(road).toMatchObject({
    kind: "ramp",
    lanesStart: 3,
    lanesEnd: 2,
    align: "right",
    width: 3.5,
  });
});

it("carries original snap node, elevation and quantized parameter into the course transaction", () => {
  const road = makeRoad(v(), v(100, 0), { id: "existing" }),
    project = { roads: [road] },
    world = createCS2RoadLabCourseWorld(project, "asset", road),
    node = world.edges.get(road.id)!.end!,
    start = cs2RoadCourseControlPoint(v(100, 0), {
      originalEntity: node,
      direction: { x: 1, y: 0 },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      elevation: 7,
      curvePosition: 1,
      snapPriority: { x: 2, y: 0.9 },
    }),
    end = cs2RoadCourseControlPoint(v(42, 20), {
      originalEntity: road.id,
      curvePosition: 0.4,
    }),
    before = structuredClone([start, end]),
    { source } = buildCS2RoadLabCourse({
      project,
      asset: "asset",
      options: {},
      points: [v(100, 0), v(42, 20)],
      controlPoints: [start, end],
    });
  expect(source.courses[0].start.entity).toBe(node);
  expect(source.courses[0].start.elevation).toEqual([7, 7]);
  expect(source.courses[0].end.entity).toBe(road.id);
  expect(source.courses[0].end.splitPosition).toBe(Math.fround(0.4));
  expect(source.courses[0].curve[3]).toEqual(v(42, 20));
  expect([start, end]).toEqual(before);
});
