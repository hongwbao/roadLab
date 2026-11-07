import { expect, it } from "vitest";
import { emptyProject, makeRoad } from "../src/core/model";
import { v } from "../src/core/math";
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
