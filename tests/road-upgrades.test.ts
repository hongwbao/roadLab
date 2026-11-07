import { expect, it } from "vitest";
import { getAsset } from "../src/core/assets";
import { dist, lanePoint, v } from "../src/core/math";
import { emptyProject, makeRoad, parseProject } from "../src/core/model";
import { addRoadsideLanes } from "../src/core/road-sections";
import {
  replaceRoadSection,
  revertRoadUpgrade,
} from "../src/core/road-upgrades";

it("restores the last asset section after saving without moving the road or losing its median", () => {
  const project = emptyProject();
  project.roads = [
    makeRoad(v(), v(80, 0), {
      twoWay: true,
      median: { kind: "concrete", width: 2 },
    }),
  ];
  const before = structuredClone(project.roads[0]);
  replaceRoadSection(
    project,
    before.id,
    getAsset("city-6").options,
    "升级后道路",
  );
  expect(project.roads[0].lanesStart).toBe(3);
  const loaded = parseProject(JSON.stringify(project));
  revertRoadUpgrade(loaded, before.id, "replace");
  expect(loaded.roads[0]).toEqual(before);
  expect(() => revertRoadUpgrade(loaded, before.id, "replace")).toThrow(
    "没有可恢复",
  );
});

it("reduces lanes on the selected side and remaps surviving foreign attachments and lane rules", () => {
  const project = emptyProject(),
    road = makeRoad(v(), v(80, 0), { twoWay: true });
  project.roads = [road];
  const original = structuredClone(road);
  addRoadsideLanes(project, road.id, "left");
  const other = makeRoad(v(80, 0), v(160, 0), {
    lanesStart: 3,
    lanesEnd: 3,
    attachments: {
      start: { road: road.id, end: 1, lanes: [0, 1, 2], ownLanes: [0, 1, 2] },
    },
  });
  project.roads.push(other);
  project.junctionLaneConnections = [
    {
      from: { road: road.id, end: 1, lane: 0 },
      to: [{ road: other.id, end: 0, lane: 0 }],
    },
    {
      from: { road: other.id, end: 1, lane: 2 },
      to: [
        { road: road.id, end: 1, lane: 0 },
        { road: road.id, end: 1, lane: 1 },
        { road: road.id, end: 0, lane: 4 },
      ],
    },
  ];
  revertRoadUpgrade(project, road.id, "widen", "left");
  const restored = project.roads[0];
  for (let lane = 0; lane < 4; lane++)
    expect(
      dist(lanePoint(original, lane, 0.5), lanePoint(restored, lane, 0.5)),
    ).toBeLessThan(1e-8);
  expect(other.attachments!.start).toEqual({
    road: road.id,
    end: 1,
    lanes: [0, 1],
    ownLanes: [1, 2],
  });
  expect(project.junctionLaneConnections).toEqual([
    {
      from: { road: other.id, end: 1, lane: 2 },
      to: [
        { road: road.id, end: 1, lane: 0 },
        { road: road.id, end: 0, lane: 3 },
      ],
    },
  ]);
});

it("removes only the selected feature, reverses transition modes and refuses to remove a direction's last lane", () => {
  const project = emptyProject(),
    road = makeRoad(v(), v(80, 0), {
      lanesStart: 1,
      lanesEnd: 1,
      twoWay: true,
      median: { kind: "concrete", width: 2 },
      transitionMode: "smooth",
    });
  project.roads = [road];
  revertRoadUpgrade(project, road.id, "median");
  expect(project.roads[0].median).toBeUndefined();
  expect(project.roads[0].transitionMode).toBe("smooth");
  revertRoadUpgrade(project, road.id, "smooth");
  expect(project.roads[0].transitionMode).toBe("direct");
  revertRoadUpgrade(project, road.id, "direct");
  expect(project.roads[0].transitionMode).toBe("smooth");
  const before = structuredClone(project);
  expect(() => revertRoadUpgrade(project, road.id, "widen", "right")).toThrow(
    "至少保留1",
  );
  expect(project).toEqual(before);
});

it("rejects malformed or nested road-section restore records", () => {
  const project = emptyProject();
  project.roads = [makeRoad(v(), v(80, 0))];
  for (const snapshot of [
    { width: 4 },
    { replacedSection: {} },
    { width: NaN },
    [],
  ]) {
    (project.roads[0] as any).replacedSection = snapshot;
    expect(() => parseProject(JSON.stringify(project))).toThrow();
  }
});
