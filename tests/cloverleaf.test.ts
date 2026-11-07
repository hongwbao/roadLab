import { expect, it } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import { dist, lanePoint, maxGrade, tangent } from "../src/core/math";
import {
  connections,
  example,
  parseProject,
  validate,
} from "../src/core/model";
import { findRoute } from "../src/simulation/simulation";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";

const directions = ["east", "south", "west", "north"];

it("provides independent two-lane through roads, two-lane collectors and eight ramps", () => {
  const project = example("elevated");
  expect(project.roads).toHaveLength(40);
  expect(project.roads.every((r) => !r.twoWay && r.width === 4)).toBe(true);
  expect(project.roads.filter((r) => r.id.endsWith("-main"))).toHaveLength(4);
  const collectors = project.roads.filter((r) => r.id.includes("-collector-"));
  expect(collectors).toHaveLength(20);
  expect(collectors.every((r) => r.lanesStart === 2 && r.lanesEnd === 2)).toBe(
    true,
  );
  expect(project.roads.filter((r) => r.kind === "ramp")).toHaveLength(8);
  expect(project.ports.filter((p) => p.type === "source")).toHaveLength(4);
  expect(project.ports.filter((p) => p.type === "sink")).toHaveLength(4);
  expect(parseProject(JSON.stringify(project))).toEqual(project);
});

it("routes all twelve principal movements through the correct through road or collector ramp", () => {
  const project = example("elevated"),
    links = connections(project);
  for (let from = 0; from < 4; from++) {
    const key = directions[from];
    for (const turn of [0, 1, 3]) {
      const to = (from + turn) % 4;
      const source = project.ports.find(
        (p) => p.road === `cloverleaf-${key}-in`,
      )!;
      const sink = project.ports.find(
        (p) => p.road === `cloverleaf-${directions[to]}-out`,
      )!;
      const path = findRoute(project, source, sink, links);
      expect(path, `${key} to ${directions[to]}`).toBeDefined();
      const roads = path!.map((step) => step.road);
      expect(roads).toContain(
        `cloverleaf-${key}-${turn === 0 ? "main" : turn === 1 ? "right" : "left"}`,
      );
      if (turn !== 0)
        expect(roads.some((id) => id.endsWith("-main"))).toBe(false);
    }
  }
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(project);
  expect(sim.routeCount).toBeGreaterThanOrEqual(12);
});

it("joins every ramp smoothly to a collector lane and keeps the central crossing grade separated", () => {
  const project = example("elevated");
  const roads = new Map(project.roads.map((road) => [road.id, road]));
  for (const ramp of project.roads.filter((road) => road.kind === "ramp")) {
    expect(maxGrade(ramp)).toBeLessThan(9);
    for (const [end, attachment] of Object.entries(ramp.attachments!)) {
      const at = end === "start" ? 0 : 1;
      const collector = roads.get(attachment!.road)!;
      expect(collector.id).toContain("-collector-");
      expect(
        dist(lanePoint(ramp, 0, at), lanePoint(collector, 1, attachment!.end)),
      ).toBeLessThan(1e-7);
      const a = tangent(ramp, at),
        b = tangent(collector, attachment!.end);
      expect(a.x * b.x + a.z * b.z).toBeCloseTo(1, 7);
      expect(a.y).toBeCloseTo(0, 7);
    }
  }
  expect(buildJunctions(project)).toHaveLength(0);
  expect(
    validate(project).filter((issue) => issue.severity === "error"),
  ).toEqual([]);
});
