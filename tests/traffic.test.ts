import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildJunctions, roadRange } from "../src/core/junctions";
import { center, dist, nearest, v } from "../src/core/math";
import {
  autoBoundaries,
  connections,
  emptyProject,
  example,
  makeBranch,
  makeRoad,
  normalizePorts,
  parseProject,
  reconnectIntersections,
  removeBoundary,
  setBoundary,
  setHeight,
} from "../src/core/model";
import { isSink, isSource } from "../src/core/types";
import { bodiesOverlap } from "../src/simulation/collision";
import { Simulation } from "../src/simulation/simulation";
it("creates a four-arm shared junction with road cuts and zebra crossings", () => {
  const p = example("junction"),
    js = buildJunctions(p);
  expect(p.roads).toHaveLength(4);
  expect(js).toHaveLength(1);
  expect(js[0].arms).toHaveLength(4);
  expect(js[0].crosswalks).toBe(true);
  expect(js[0].polygon.length).toBeGreaterThanOrEqual(4);
  for (const r of p.roads) {
    const range = roadRange(r, js);
    expect(range.start > 0 || range.end < 1).toBe(true);
  }
  expect(connections(p)).toHaveLength(12);
  const sim = new Simulation();
  sim.configure(p);
  expect(sim.routeCount).toBe(12);
});
it("creates a T junction from snapped centerline endpoints without manual tools", () => {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-80, 0), v(80, 0), { twoWay: true, lanesStart: 1, lanesEnd: 1 }),
    makeRoad(v(0, -60), v(0, 0), { twoWay: true, lanesStart: 1, lanesEnd: 1 }),
  ];
  reconnectIntersections(p);
  expect(buildJunctions(p)[0].arms).toHaveLength(3);
});
it("does not add intersections or crosswalks at elevated crossings", () => {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-60, 0), v(60, 0)),
    makeRoad(v(0, -60, 8), v(0, 60, 8)),
  ];
  expect(reconnectIntersections(p)).toBe(0);
  expect(buildJunctions(p)).toHaveLength(0);
  expect(connections(p)).toHaveLength(0);
});
it("makes both ends of a two-way road bidirectional and removable without duplicates", () => {
  const p = emptyProject(),
    r = makeRoad(v(-60, 0), v(60, 0), {
      twoWay: true,
      lanesStart: 1,
      lanesEnd: 1,
    });
  p.roads = [r];
  expect(autoBoundaries(p)).toBe(2);
  expect(autoBoundaries(p)).toBe(0);
  expect(p.ports.every((x) => isSource(x) && isSink(x))).toBe(true);
  const s = new Simulation();
  s.configure(p);
  expect(s.routeCount).toBe(2);
  expect(setBoundary(p, r.id, "start")).toBe(false);
  removeBoundary(p, r.id, "start");
  s.configure(p);
  expect(s.routeCount).toBe(0);
  expect(parseProject(JSON.stringify(p)).ports).toHaveLength(1);
});
it("migrates old two-way ports and derives one-way port roles from direction", () => {
  const p = example("elevated");
  normalizePorts(p);
  expect(p.ports.filter((x) => x.type === "both")).toHaveLength(2);
  const r = p.roads[0];
  setBoundary(p, r.id, "end");
  expect(p.ports.find((x) => x.road === r.id && x.end === "end")!.type).toBe(
    "sink",
  );
});
it("refines curved road snapping instead of leaving coarse sample errors", () => {
  const r = makeRoad(v(-80, 0), v(80, 60), {}, v(-30, -60), v(25, 100));
  for (const t of [0.074, 0.3137, 0.7832])
    expect(dist(nearest(r, center(r, t)).point, center(r, t))).toBeLessThan(
      0.001,
    );
});
it("detects rotated bodies and respects vertical separation", () => {
  const a = { id: 1, position: v(0, 0), heading: 0 },
    b = { id: 2, position: v(2, 0), heading: Math.PI / 2 };
  expect(bodiesOverlap(a, b)).toBe(true);
  b.position = v(0, 0, 8);
  expect(bodiesOverlap(a, b)).toBe(false);
  b.position = v(8, 0);
  expect(bodiesOverlap(a, b)).toBe(false);
});
for (const kind of ["transition", "junction", "merge"])
  it(`keeps all vehicle bodies separate under sustained ${kind} demand and completes trips`, () => {
    const p = kind === "merge" ? emptyProject() : example(kind);
    if (kind === "merge") {
      const r = makeRoad(v(0, 0), v(140, 0), {
        lanesStart: 3,
        lanesEnd: 2,
        align: "left",
      });
      p.roads = [r];
      makeBranch(p, r.id, true);
      autoBoundaries(p);
    }
    p.trafficMultiplier = 4;
    for (const port of p.ports.filter(isSource)) port.rate = 60;
    const s = new Simulation();
    s.configure(p);
    s.running = true;
    let overlaps = 0,
      maxMove = 0,
      maxAngle = 0,
      turns = 0,
      previous = new Map<number, { p: any; h: number }>();
    for (let i = 0; i < 2400; i++) {
      s.update(0.05);
      for (let a = 0; a < s.vehicles.length; a++) {
        const c = s.vehicles[a];
        for (let b = a + 1; b < s.vehicles.length; b++)
          if (bodiesOverlap(c, s.vehicles[b], 0)) overlaps++;
        const old = previous.get(c.id);
        if (old) {
          maxMove = Math.max(maxMove, dist(c.position, old.p));
          maxAngle = Math.max(
            maxAngle,
            Math.abs(
              Math.atan2(
                Math.sin(c.heading - old.h),
                Math.cos(c.heading - old.h),
              ),
            ),
          );
        }
        if (c.connector?.junction) turns++;
      }
      previous = new Map(
        s.vehicles.map((c) => [c.id, { p: { ...c.position }, h: c.heading }]),
      );
    }
    mkdirSync("artifacts", { recursive: true });
    const metrics = {
      completed: s.completed,
      active: s.vehicles.length,
      overlaps,
      maxMove,
      maxAngle,
      turns,
    };
    writeFileSync(
      `artifacts/traffic-${kind}-metrics.json`,
      JSON.stringify(metrics, null, 2),
    );
    expect(overlaps).toBe(0);
    expect(s.completed).toBeGreaterThan(10);
    expect(maxMove).toBeLessThan(2);
    expect(maxAngle).toBeLessThan(0.5);
    if (kind === "junction") expect(turns).toBeGreaterThan(20);
  });
it("aligns vehicle pitch with elevated road geometry", () => {
  const p = emptyProject(),
    r = makeRoad(v(-90, 0), v(90, 0), { lanesStart: 1, lanesEnd: 1 });
  setHeight(r, 0, 12);
  p.roads = [r];
  autoBoundaries(p);
  const s = new Simulation();
  s.configure(p);
  s.running = true;
  let maxPitch = 0;
  for (let i = 0; i < 600; i++) {
    s.update(0.05);
    for (const c of s.vehicles)
      maxPitch = Math.max(maxPitch, Math.abs(c.pitch));
  }
  expect(maxPitch).toBeGreaterThan(0.04);
  expect(s.completed).toBeGreaterThan(0);
});
