import { expect, it } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import {
  dist,
  lanePoint,
  maxGrade,
  roadLength,
  tangent,
} from "../src/core/math";
import {
  connections,
  example,
  parseProject,
  validate,
} from "../src/core/model";
import { findRoute } from "../src/simulation/simulation";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import type { Road } from "../src/core/types";

const directions = ["east", "south", "west", "north"];

const isMain = (road: Road) => road.name.startsWith("单向两车道");
const direction = (road: Road, end: number) => {
  const d = tangent(road, end);
  return Math.abs(d.x) > Math.abs(d.z)
    ? d.x > 0
      ? "east"
      : "west"
    : d.z > 0
      ? "south"
      : "north";
};

it("preserves the improved 120-segment map, two-lane through roads, collectors and eight ramp families", () => {
  const project = example("elevated");
  expect(project.roads).toHaveLength(120);
  expect(project.roads.every((r) => !r.twoWay && r.width === 4)).toBe(true);
  const main = project.roads.filter(isMain),
    collectors = project.roads.filter((r) => r.name.includes("辅道"));
  expect(main).toHaveLength(32);
  expect(
    main.every(
      (r) =>
        r.kind === "road" &&
        r.lanesStart === 2 &&
        r.lanesEnd === 2 &&
        r.speed === 120,
    ),
  ).toBe(true);
  expect(collectors).toHaveLength(16);
  expect(collectors.every((r) => r.lanesStart === 2 && r.lanesEnd === 2)).toBe(
    true,
  );
  const ramps = project.roads.filter((r) => r.kind === "ramp");
  expect(ramps).toHaveLength(56);
  expect(
    ramps.every(
      (r) => r.lanesStart === 1 && r.lanesEnd === 1 && r.speed === 100,
    ),
  ).toBe(true);
  for (const key of directions)
    for (const turn of ["left", "right"])
      expect(ramps.some((r) => r.id === `cloverleaf-${key}-${turn}`)).toBe(
        true,
      );
  expect(project.roads.every((r) => roadLength(r) <= 120 + 1e-6)).toBe(true);
  expect(
    project.roads.every(
      (r) =>
        r.speed === (isMain(r) || r.name.includes("（4车道）") ? 120 : 100),
    ),
  ).toBe(true);
  expect(
    Math.max(...project.roads.flatMap((r) => r.knots.map((k) => k.p.y))),
  ).toBe(8);
  expect(
    Math.min(...project.roads.flatMap((r) => r.knots.map((k) => k.p.y))),
  ).toBe(0);
  expect(project.junctionLaneConnections).toHaveLength(8);
  expect(project.ports.filter((p) => p.type === "source")).toHaveLength(4);
  expect(project.ports.filter((p) => p.type === "sink")).toHaveLength(4);
  expect(parseProject(JSON.stringify(project))).toEqual(project);
});

it("routes all twelve principal movements through the correct through road or collector ramp", () => {
  const project = example("elevated"),
    links = connections(project),
    roadMap = new Map(project.roads.map((r) => [r.id, r]));
  for (let from = 0; from < 4; from++) {
    const key = directions[from];
    for (const turn of [0, 1, 3]) {
      const to = (from + turn) % 4;
      const source = project.ports.find(
        (p) =>
          p.type === "source" &&
          direction(roadMap.get(p.road)!, p.end === "start" ? 0 : 1) === key,
      )!;
      const sink = project.ports.find(
        (p) =>
          p.type === "sink" &&
          direction(roadMap.get(p.road)!, p.end === "start" ? 0 : 1) ===
            directions[to],
      )!;
      expect(source).toBeDefined();
      expect(sink).toBeDefined();
      const path = findRoute(project, source, sink, links);
      expect(path, `${key} to ${directions[to]}`).toBeDefined();
      const roads = path!.map((step) => step.road);
      if (turn === 0) {
        expect(roads.some((id) => isMain(roadMap.get(id)!))).toBe(true);
        expect(roads.every((id) => roadMap.get(id)!.kind === "road")).toBe(
          true,
        );
      } else {
        expect(roads).toContain(
          `cloverleaf-${key}-${turn === 1 ? "right" : "left"}`,
        );
        expect(roads.some((id) => isMain(roadMap.get(id)!))).toBe(false);
      }
    }
  }
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  expect(sim.routeCount).toBeGreaterThanOrEqual(12);
  sim.dispose();
});

it("joins every ramp smoothly to a collector lane and keeps the central crossing grade separated", () => {
  const project = example("elevated");
  const roads = new Map(project.roads.map((road) => [road.id, road])),
    links = connections(project);
  let attachedEnds = 0;
  for (const ramp of project.roads.filter((road) => road.kind === "ramp")) {
    expect(maxGrade(ramp)).toBeLessThan(9);
    for (const end of [0, 1]) {
      const touching = links
        .filter((c) =>
          end === 1 ? c.from.road === ramp.id : c.to.road === ramp.id,
        )
        .filter((c) => {
          const ref = end === 1 ? c.to : c.from,
            road = roads.get(ref.road)!,
            at = end === 1 ? 0 : 1,
            a = tangent(ramp, end),
            b = tangent(road, at);
          return (
            dist(lanePoint(ramp, 0, end), lanePoint(road, ref.lane, at)) <
              1e-7 && a.x * b.x + a.y * b.y + a.z * b.z > 1 - 1e-7
          );
        });
      expect(
        touching.length,
        `${ramp.id}:${end} real smooth connection`,
      ).toBeGreaterThan(0);
    }
    for (const [end, attachment] of Object.entries(ramp.attachments!)) {
      if (!attachment) continue;
      attachedEnds++;
      const at = end === "start" ? 0 : 1;
      const collector = roads.get(attachment!.road)!;
      expect(collector.name).toContain("辅道");
      expect(
        dist(lanePoint(ramp, 0, at), lanePoint(collector, 1, attachment!.end)),
      ).toBeLessThan(1e-7);
      const a = tangent(ramp, at),
        b = tangent(collector, attachment!.end);
      expect(a.x * b.x + a.z * b.z).toBeCloseTo(1, 7);
      expect(a.y).toBeCloseTo(0, 7);
    }
  }
  expect(attachedEnds).toBe(16);
  expect(buildJunctions(project)).toHaveLength(0);
  expect(
    validate(project).filter((issue) => issue.severity === "error"),
  ).toEqual([]);
});
