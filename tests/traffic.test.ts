import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildJunctions, roadRange } from "../src/core/junctions";
import { center, dist, lanePoint, nearest, v } from "../src/core/math";
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
import { isSink, isSource, type Connection } from "../src/core/types";
import { bodiesOverlap, TrafficIndex } from "../src/simulation/collision";
import {
  findRoute,
  Simulation,
  type Vehicle,
} from "../src/simulation/simulation";

it("legacy rolling entry policy waits for a safe entry gap", () => {
  const p = emptyProject(),
    road = makeRoad(v(0, 0), v(140, 0), {
      lanesStart: 1,
      lanesEnd: 1,
      speed: 50,
    });
  p.roads = [road];
  p.ports = [
    { road: road.id, end: "start", type: "source", rate: 60 },
    { road: road.id, end: "end", type: "sink", rate: 1 },
  ];
  const free = new Simulation();
  free.trafficModel = "legacy";
  free.configure(p);
  free.running = true;
  for (let i = 0; i < 20; i++) free.update(0.05);
  expect(free.entered).toBe(1);
  expect(free.vehicles[0].speed).toBeGreaterThan(4);

  const busy = new Simulation();
  busy.trafficModel = "legacy";
  busy.configure(p);
  busy.running = true;
  busy.vehicles = [
    {
      id: 999,
      route: [{ road: road.id, direction: 1, inLane: 0, outLane: 0 }],
      step: 0,
      s: 6,
      lane: 0,
      speed: 0,
      age: 0,
      color: 0,
      position: lanePoint(road, 0, 6 / 140),
      heading: 0,
      pitch: 0,
    },
  ];
  for (let i = 0; i < 20; i++) busy.update(0.05);
  expect(busy.entered).toBe(0);
  expect(busy.waiting).toBe(1);
  busy.vehicles = [];
  for (let i = 0; i < 4; i++) busy.update(0.05);
  expect(busy.entered).toBe(1);
  expect(busy.vehicles[0].speed).toBeGreaterThan(4);
});

it("chooses a drivable lane before a short node and avoids a congested route", () => {
  const p = emptyProject(),
    start = makeRoad(v(0, 0), v(50, 0), { lanesStart: 1, lanesEnd: 1 }),
    fast = makeRoad(v(50, 0), v(150, 0), {
      lanesStart: 1,
      lanesEnd: 1,
      speed: 80,
    }),
    slow = makeRoad(v(50, 0), v(150, 0), {
      lanesStart: 1,
      lanesEnd: 1,
      speed: 20,
    }),
    end = makeRoad(v(150, 0), v(200, 0), {
      lanesStart: 1,
      lanesEnd: 1,
    });
  p.roads = [start, fast, slow, end];
  const source = {
      road: start.id,
      end: "start",
      type: "source",
      rate: 1,
    } as const,
    sink = { road: end.id, end: "end", type: "sink", rate: 1 } as const,
    cs: Connection[] = [
      [start, fast],
      [start, slow],
      [fast, end],
      [slow, end],
    ].map(([a, b]) => ({
      id: `${a.id}>${b.id}`,
      from: { road: a.id, lane: 0 },
      to: { road: b.id, lane: 0 },
      enabled: true,
    }));
  expect(findRoute(p, source, sink, cs)![1].road).toBe(fast.id);
  expect(
    findRoute(
      p,
      source,
      sink,
      cs,
      undefined,
      new Map([[`${fast.id}:1:0`, 50]]),
      0,
      undefined,
      {
        changes: new Map(),
        links: new Map(),
        flowOffsets: new Map([[`${fast.id}:1:0`, 240]]),
      },
    )![1].road,
  ).toBe(slow.id);

  const short = makeRoad(v(0, 0), v(20, 0), {
      lanesStart: 2,
      lanesEnd: 2,
    }),
    next = makeRoad(v(20, 0), v(70, 0), {
      lanesStart: 1,
      lanesEnd: 1,
    });
  p.roads = [short, next];
  const onlyLaneOne: Connection[] = [
    {
      id: "lane-one",
      from: { road: short.id, lane: 1 },
      to: { road: next.id, lane: 0 },
      enabled: true,
    },
  ];
  const route = findRoute(
    p,
    { ...source, road: short.id },
    { ...sink, road: next.id },
    onlyLaneOne,
    0,
  )!;
  expect(route[0].inLane).toBe(1);
  expect(route[0].outLane).toBe(1);
  expect(
    findRoute(
      p,
      { ...source, road: short.id },
      { ...sink, road: next.id },
      onlyLaneOne,
      0,
      undefined,
      15,
    ),
  ).toBeUndefined();
});

for (const initialS of [100, 132, 136])
  it(`resolves two adjacent cars that need to exchange lanes from ${initialS} m`, () => {
    const p = emptyProject(),
      first = makeRoad(v(0, 0), v(140, 0), {
        lanesStart: 2,
        lanesEnd: 2,
      }),
      second = makeRoad(v(140, 0), v(280, 0), {
        lanesStart: 2,
        lanesEnd: 2,
      });
    p.roads = [first, second];
    const sim = new Simulation();
    sim.configure(p);
    sim.running = true;
    sim.vehicles = [0, 1].map((lane): Vehicle => ({
      id: lane + 1,
      route: [
        {
          road: first.id,
          direction: 1,
          inLane: lane,
          outLane: 1 - lane,
        },
        {
          road: second.id,
          direction: 1,
          inLane: 1 - lane,
          outLane: 1 - lane,
        },
      ],
      step: 0,
      s: initialS,
      lane,
      speed: 0,
      age: 0,
      color: 0,
      position: lanePoint(first, lane, initialS / 140),
      heading: 0,
      pitch: 0,
    }));
    for (let i = 0; i < 2400 && sim.completed < 2; i++) {
      sim.update(0.05);
      if (sim.vehicles.length === 2)
        expect(bodiesOverlap(sim.vehicles[0], sim.vehicles[1], 0)).toBe(false);
    }
    expect(sim.completed).toBe(2);
  });
it("legacy lane selection changes early with a gradual heading and yields to faster traffic", () => {
  const p = emptyProject(),
    first = makeRoad(v(0, 0), v(140, 0), {
      lanesStart: 2,
      lanesEnd: 2,
    }),
    second = makeRoad(v(140, 0), v(280, 0), {
      lanesStart: 2,
      lanesEnd: 2,
    });
  p.roads = [first, second];
  const sim = new Simulation();
  sim.trafficModel = "legacy";
  sim.configure(p);
  sim.running = true;
  sim.vehicles = [
    {
      id: 1,
      route: [
        { road: first.id, direction: 1, inLane: 0, outLane: 1 },
        { road: second.id, direction: 1, inLane: 1, outLane: 1 },
      ],
      step: 0,
      s: 20,
      lane: 0,
      speed: 9,
      age: 0,
      color: 0,
      position: lanePoint(first, 0, 20 / 140),
      heading: 0,
      pitch: 0,
    },
    {
      id: 2,
      route: [
        { road: first.id, direction: 1, inLane: 1, outLane: 1 },
        { road: second.id, direction: 1, inLane: 1, outLane: 1 },
      ],
      step: 0,
      s: 14,
      lane: 1,
      speed: 15,
      age: 0,
      color: 0,
      position: lanePoint(first, 1, 14 / 140),
      heading: 0,
      pitch: 0,
    },
  ];
  sim.update(0.05);
  expect(sim.vehicles[0].laneChange).toBeUndefined();
  let changedAt = Infinity,
    completedAt = Infinity,
    maxTurn = 0,
    previousHeading = sim.vehicles[0].heading;
  for (let i = 0; i < 1000 && sim.completed < 2; i++) {
    sim.update(0.05);
    const changing = sim.vehicles.find((c) => c.id === 1);
    if (!changing) continue;
    if (changing.step === 0 && changing.laneChange)
      changedAt = Math.min(changedAt, changing.laneChange.start);
    if (changing.step === 0 && changing.lane > 0.99)
      completedAt = Math.min(completedAt, changing.s);
    maxTurn = Math.max(maxTurn, Math.abs(changing.heading - previousHeading));
    previousHeading = changing.heading;
    if (sim.vehicles.length === 2)
      expect(bodiesOverlap(sim.vehicles[0], sim.vehicles[1], 0)).toBe(false);
  }
  expect(changedAt).toBeLessThan(55);
  expect(completedAt).toBeLessThan(110);
  expect(maxTurn).toBeLessThan(0.2);
  expect(sim.completed).toBe(2);
});
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
  const p = example();
  const twoWay = makeRoad(v(200, 100), v(280, 100), { twoWay: true });
  p.roads.push(twoWay);
  p.ports.push(
    { road: twoWay.id, end: "start", type: "source", rate: 12 },
    { road: twoWay.id, end: "end", type: "sink", rate: 1 },
  );
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
  it(`keeps all vehicle bodies separate under sustained ${kind} demand`, () => {
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
    const checkpoints: number[] = [];
    for (let i = 0; i < 7200; i++) {
      s.update(0.05);
      if (i % 2400 === 2399) checkpoints.push(s.completed);
      // Native groups hold transforms at different future update times. The
      // actual displayed bodies use a common interpolation clock and exclude
      // the source's not-yet-spawned entities.
      const displayed = s.renderVehicles(),
        index = new TrafficIndex<Vehicle>(0);
      for (const c of displayed) {
        for (const other of index.near(c.position))
          if (bodiesOverlap(c, other, 0)) overlaps++;
        index.add(c);
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
        displayed.map((c) => [c.id, { p: { ...c.position }, h: c.heading }]),
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
      checkpoints,
    };
    writeFileSync(
      `artifacts/traffic-${kind}-metrics.json`,
      JSON.stringify(metrics, null, 2),
    );
    expect(overlaps).toBe(0);
    if (kind === "junction") {
      // At 400% demand, an unsignalized junction is allowed to jam. Its entry
      // rule checks destination space; it does not arbitrate crossing traffic.
      expect(s.entered).toBeGreaterThan(10);
      expect(s.queued).toBeGreaterThan(0);
    } else {
      expect(s.completed).toBeGreaterThan(kind === "transition" ? 35 : 10);
      expect(checkpoints[1] - checkpoints[0]).toBeGreaterThan(30);
      expect(checkpoints[2] - checkpoints[1]).toBeGreaterThan(30);
    }
    if (kind === "merge") expect(s.queued).toBeLessThan(20);
    expect(maxMove).toBeLessThan(2);
    expect(maxAngle).toBeLessThan(0.5);
    if (kind === "junction") expect(turns).toBeGreaterThan(20);
  }, 30_000);
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
