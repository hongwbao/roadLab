import { expect, it } from "vitest";
import {
  arcParameter,
  arcTable,
  laneDirection,
  lanePoint,
  mul,
  tangent,
  v,
} from "../src/core/math";
import { buildJunctions } from "../src/core/junctions";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import type { Connection, Project } from "../src/core/types";
import { bodiesOverlap } from "../src/simulation/collision";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import { DEFAULT_DRIVER } from "../src/simulation/driving";
import { LaneTraffic } from "../src/simulation/lane-traffic";
import {
  findRoute,
  Simulation,
  type Vehicle,
} from "../src/simulation/simulation";

function crossing() {
  const p = emptyProject();
  const options = {
    twoWay: true,
    lanesStart: 3,
    lanesEnd: 3,
    speed: 60,
    width: 3.5,
  };
  p.roads = [
    makeRoad(v(-145, 0), v(0, 0), options),
    makeRoad(v(0, 0), v(153, 0), options),
    makeRoad(v(0, -170), v(0, 0), options),
    makeRoad(v(0, 0), v(0, 156.5), options),
  ];
  const sim = new Simulation();
  sim.configure(p);
  sim.running = true;
  return { p, sim };
}
function vehicle(
  p: Project,
  c: Connection,
  id: number,
  behind = 0.01,
): Vehicle {
  const road = p.roads.find((r) => r.id === c.from.road)!;
  const next = p.roads.find((r) => r.id === c.to.road)!;
  const direction = laneDirection(road, c.from.lane);
  const arc = arcTable(road),
    length = arc.at(-1)!.s;
  const trim = buildJunctions(p)[0].arms.find((a) => a.road === road.id)!.trim;
  const s = length - trim - behind;
  const t = arcParameter(arc, direction === 1 ? s : length - s);
  const heading = mul(tangent(road, t), direction);
  return {
    id,
    s,
    speed: 5,
    lane: c.from.lane,
    step: 0,
    age: 0,
    color: 0,
    position: lanePoint(road, c.from.lane, t),
    heading: Math.atan2(heading.z, heading.x),
    pitch: 0,
    driver: { ...DEFAULT_DRIVER },
    nextLaneDecision: Infinity,
    route: [
      { road: road.id, direction, inLane: c.from.lane, outLane: c.from.lane },
      {
        road: next.id,
        direction: laneDirection(next, c.to.lane),
        inLane: c.to.lane,
        outLane: c.to.lane,
      },
    ],
  };
}
function noOverlaps(sim: Simulation) {
  const displayed = sim.renderVehicles();
  for (let i = 0; i < displayed.length; i++)
    for (let j = i + 1; j < displayed.length; j++)
      expect(bodiesOverlap(displayed[i], displayed[j], 0)).toBe(false);
}

it("admits transverse streams at an unsignalized junction when their destination lanes are free", () => {
  const { p, sim } = crossing();
  const links = connections(p);
  const horizontal = links.find(
    (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[1].id,
  )!;
  const vertical = links.find(
    (c) => c.from.road === p.roads[2].id && c.to.road === p.roads[3].id,
  )!;
  sim.vehicles = [vehicle(p, horizontal, 101), vehicle(p, vertical, 102)];
  sim.update(0.05);
  expect(sim.vehicles.every((c) => c.step === 1 && c.connector)).toBe(true);
  expect(sim.statistics.junctionEntries).toBe(2);
  noOverlaps(sim);
});

it("runs all six opposing straight lanes concurrently without a junction-wide lock", () => {
  const { p, sim } = crossing();
  const [west, east] = p.roads;
  const links = connections(p).filter(
    (c) =>
      (c.from.road === west.id && c.to.road === east.id) ||
      (c.from.road === east.id && c.to.road === west.id),
  );
  expect(links).toHaveLength(6);
  sim.vehicles = links.map((c, i) => vehicle(p, c, i + 101));
  // Each source vehicle advances once per 16 frames; give every group a turn.
  sim.update(16 / 60);
  expect(sim.vehicles.every((c) => c.connector)).toBe(true);
  expect(sim.statistics.simultaneousJunctions).toBe(6);
  for (let i = 0; i < 600; i++) {
    sim.update(0.05);
    noOverlaps(sim);
  }
  expect(sim.completed).toBe(6);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("predicts perpendicular arrivals early enough to pass without physical collision stops", () => {
  const { p, sim } = crossing();
  const links = connections(p);
  const horizontal = links.find(
    (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[1].id,
  )!;
  const vertical = links.find(
    (c) => c.from.road === p.roads[2].id && c.to.road === p.roads[3].id,
  )!;
  const a = vehicle(p, horizontal, 111, 70),
    b = vehicle(p, vertical, 112, 70);
  a.speed = b.speed = 12;
  sim.vehicles = [a, b];
  let yielded = false;
  for (let i = 0; i < 1000 && sim.completed < 2; i++) {
    sim.update(0.05);
    noOverlaps(sim);
    if (a.yieldingFor || b.yieldingFor) yielded = true;
  }
  expect(yielded).toBe(true);
  expect(sim.completed).toBe(2);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("keeps a three-stream combination of turning and straight vehicles progressing", () => {
  const { p, sim } = crossing(),
    links = connections(p);
  const movements = [
    links.find(
      (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[2].id,
    )!,
    links.find(
      (c) => c.from.road === p.roads[2].id && c.to.road === p.roads[3].id,
    )!,
    links.find(
      (c) => c.from.road === p.roads[1].id && c.to.road === p.roads[0].id,
    )!,
  ];
  sim.vehicles = movements.map((m, i) => {
    const c = vehicle(p, m, 121 + i, 65);
    c.speed = 12;
    return c;
  });
  for (let i = 0; i < 1400 && sim.completed < 3; i++) {
    sim.update(0.05);
    noOverlaps(sim);
  }
  expect(sim.completed).toBe(3);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("keeps an oversaturated three-lane crossing progressing while preserving queues", () => {
  const { p, sim } = crossing();
  p.trafficMultiplier = 4;
  p.ports = p.roads.map((r, i) => ({
    road: r.id,
    end: i === 0 || i === 2 ? "start" : "end",
    type: "both",
    rate: 30,
  }));
  sim.configure(p);
  sim.running = true;
  const checkpoints: number[] = [];
  let overlaps = 0;
  for (let i = 0; i < 4800; i++) {
    sim.update(0.05);
    if (i % 1200 === 1199) checkpoints.push(sim.completed);
    if (i % 20 === 0) {
      const displayed = sim.renderVehicles();
      for (let a = 0; a < displayed.length; a++)
        for (let b = a + 1; b < displayed.length; b++)
          if (bodiesOverlap(displayed[a], displayed[b], 0)) overlaps++;
    }
  }
  expect(checkpoints[2] - checkpoints[1]).toBeGreaterThan(10);
  expect(checkpoints[3] - checkpoints[2]).toBeGreaterThan(10);
  expect(sim.queued).toBeGreaterThan(0);
  expect(sim.renderVehicles().length).toBeGreaterThan(10);
  expect(overlaps).toBe(0);
  // Protective movement rejections are allowed; actual overlap or an exit
  // stuck indefinitely is not. Small crossing cases above additionally
  // require no hard collision stops at all.
  for (const road of p.roads)
    expect(sim.completedByExit.get(road.id) ?? 0).toBeGreaterThan(10);
}, 90_000);

it("admits the four independent right turns together", () => {
  const { p, sim } = crossing();
  const links = connections(p).filter((c) => {
    const from = p.roads.find((r) => r.id === c.from.road)!;
    const to = p.roads.find((r) => r.id === c.to.road)!;
    const fd = laneDirection(from, c.from.lane),
      td = laneDirection(to, c.to.lane);
    const a = mul(tangent(from, fd === 1 ? 1 : 0), fd);
    const b = mul(tangent(to, td === 1 ? 0 : 1), td);
    return a.x * b.z - a.z * b.x > 0.9;
  });
  expect(links).toHaveLength(4);
  sim.vehicles = links.map((c, i) => vehicle(p, c, i + 201));
  sim.update(16 / 60);
  expect(sim.vehicles.every((c) => c.connector)).toBe(true);
  for (let i = 0; i < 600; i++) {
    sim.update(0.05);
    noOverlaps(sim);
  }
  expect(sim.completed).toBe(4);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("lets a following car enter the same connector before its leader has exited", () => {
  const { p, sim } = crossing();
  const link = connections(p).find(
    (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[1].id,
  )!;
  sim.vehicles = [vehicle(p, link, 301), vehicle(p, link, 302, 8)];
  let concurrent = false;
  for (let i = 0; i < 600; i++) {
    sim.update(0.05);
    if (sim.vehicles.filter((c) => c.connector).length === 2) concurrent = true;
    noOverlaps(sim);
  }
  expect(concurrent).toBe(true);
  expect(sim.completed).toBe(2);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("keeps an unobstructed straight vehicle moving at speed through both crosswalks", () => {
  const { p, sim } = crossing();
  const link = connections(p).find(
    (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[1].id,
  )!;
  const c = vehicle(p, link, 351, 70);
  c.speed = 15;
  sim.vehicles = [c];
  let entered = false,
    exited = false;
  for (let i = 0; i < 300 && !exited; i++) {
    sim.update(0.05);
    expect(c.speed).toBeGreaterThanOrEqual(15);
    if (c.connector) entered = true;
    if (entered && !c.connector) exited = true;
  }
  expect(entered).toBe(true);
  expect(exited).toBe(true);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("legacy scalar integration preserves distance across both connector boundaries", () => {
  const { p, sim } = crossing();
  sim.trafficModel = "legacy";
  sim.configure(p);
  const link = connections(p).find(
    (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[1].id,
  )!;
  const c = vehicle(p, link, 352, 0.1);
  c.speed = 15;
  sim.vehicles = [c];
  let entered = false,
    exited = false;
  for (let i = 0; i < 150 && !exited; i++) {
    const before = { ...c.position },
      speed = c.speed;
    sim.update(0.05);
    const travelled = Math.hypot(
      c.position.x - before.x,
      c.position.z - before.z,
    );
    const expected = (speed + c.speed) * 0.5 * 0.05;
    expect(Math.abs(travelled - expected)).toBeLessThan(0.01);
    if (c.connector) entered = true;
    if (entered && !c.connector) exited = true;
  }
  expect(entered).toBe(true);
  expect(exited).toBe(true);
});

for (const gap of [0, 0.1])
  it(`legacy scalar integration preserves distance through a ${gap} m road connection`, () => {
    const p = emptyProject();
    const options = { lanesStart: 1, lanesEnd: 1, speed: 60 };
    const a = makeRoad(v(0, 0), v(100, 0), options);
    const b = makeRoad(v(100 + gap, 0), v(200 + gap, 0), options);
    p.roads = [a, b];
    const sim = new Simulation();
    sim.trafficModel = "legacy";
    sim.configure(p);
    sim.running = true;
    const c: Vehicle = {
      id: 353,
      s: 99.9,
      speed: 15,
      lane: 0,
      step: 0,
      age: 0,
      color: 0,
      position: lanePoint(a, 0, 0.999),
      heading: 0,
      pitch: 0,
      driver: { ...DEFAULT_DRIVER },
      nextLaneDecision: Infinity,
      route: [
        { road: a.id, direction: 1, inLane: 0, outLane: 0 },
        { road: b.id, direction: 1, inLane: 0, outLane: 0 },
      ],
    };
    sim.vehicles = [c];
    const before = { ...c.position },
      speed = c.speed;
    sim.update(0.05);
    const travelled = Math.hypot(
      c.position.x - before.x,
      c.position.z - before.z,
    );
    expect(Math.abs(travelled - (speed + c.speed) * 0.5 * 0.05)).toBeLessThan(
      0.01,
    );
    expect(c.step).toBe(1);
    expect(c.speed).toBeGreaterThanOrEqual(15);
  });

it("does not admit a vehicle when its actual destination lane has no room", () => {
  const { p, sim } = crossing();
  const link = connections(p).find(
    (c) => c.from.road === p.roads[0].id && c.to.road === p.roads[1].id,
  )!;
  const incoming = vehicle(p, link, 401, 5);
  incoming.speed = 0;
  const target = p.roads[1];
  const entry = buildJunctions(p)[0].arms.find(
    (a) => a.road === target.id,
  )!.trim;
  const blocker: Vehicle = {
    ...incoming,
    id: 402,
    s: entry + 4,
    lane: link.to.lane,
    route: [incoming.route[1]],
    position: lanePoint(target, link.to.lane, (entry + 4) / 153),
    driver: { ...DEFAULT_DRIVER, speedFactor: 0.001 },
    cs2Car: { ...CS2_BASE_CAR, maxSpeed: 0.001 },
  };
  sim.vehicles = [incoming, blocker];
  for (let i = 0; i < 40; i++) sim.update(0.05);
  expect(incoming.step).toBe(0);
  expect(incoming.connector).toBeUndefined();
  noOverlaps(sim);
});

it("tracks connector followers along the curve instead of placing them at the destination entry", () => {
  const snapshot = new LaneTraffic([
    {
      id: 1,
      s: 14,
      speed: 5,
      lane: 0,
      step: 0,
      route: [{ road: "exit", direction: 1 }],
      connector: { id: "curve", length: 30, progress: 0.5 },
    },
  ]);
  expect(snapshot.neighbours("exit", 1, 0, 13.999, 99).leader).toBeUndefined();
  expect(snapshot.onConnector("curve", 0, 99).leader?.s).toBe(15);
});

it("includes the unavoidable exit queue in the cost instead of choosing a free lane to cut into it", () => {
  const p = emptyProject();
  const start = makeRoad(v(0, 0), v(200, 0), { lanesStart: 2, lanesEnd: 2 });
  const end = makeRoad(v(200, 0), v(300, 0), { lanesStart: 1, lanesEnd: 1 });
  p.roads = [start, end];
  const links: Connection[] = [
    {
      id: "only-exit",
      from: { road: start.id, lane: 1 },
      to: { road: end.id, lane: 0 },
      enabled: true,
    },
  ];
  const source = {
    road: start.id,
    end: "start" as const,
    type: "source" as const,
    rate: 0,
  };
  const sink = {
    road: end.id,
    end: "end" as const,
    type: "sink" as const,
    rate: 0,
  };
  const congestion = new Map([[`${start.id}:1:1`, 90]]);
  expect(findRoute(p, source, sink, links, 0, congestion)?.[0].inLane).toBe(1);
  expect(findRoute(p, source, sink, links, 0, congestion, 20)?.[0].inLane).toBe(
    0,
  );
});

it("does not count the interior of a junction as usable lane-change distance", () => {
  const { p } = crossing();
  const source = {
    road: p.roads[0].id,
    end: "start" as const,
    type: "source" as const,
    rate: 0,
  };
  const sink = {
    road: p.roads[2].id,
    end: "start" as const,
    type: "sink" as const,
    rate: 0,
  };
  const trim = buildJunctions(p)[0].arms.find(
    (a) => a.road === source.road,
  )!.trim;
  expect(
    findRoute(p, source, sink, connections(p), 4, undefined, 145 - trim - 20),
  ).toBeUndefined();
});
