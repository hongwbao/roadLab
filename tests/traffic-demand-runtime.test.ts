import { expect, it } from "vitest";
import { emptyProject, makeRoad } from "../src/core/model";
import { v } from "../src/core/math";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import type { Project } from "../src/core/types";
function fixture() {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(), v(3000, 0), {
      id: "in",
      lanesStart: 4,
      lanesEnd: 4,
      speed: 60,
    }),
    ...["a", "b", "c", "d"].map((id, i) =>
      makeRoad(v(3000, 0), v(3300, (i - 1.5) * 180), {
        id,
        lanesStart: 1,
        lanesEnd: 1,
        speed: 40,
      }),
    ),
  ];
  p.ports = [
    {
      road: "in",
      end: "start",
      type: "source",
      rate: 100,
      destinations: [
        { road: "a", end: "end", weight: 20 },
        { road: "b", end: "end", weight: 30 },
        { road: "c", end: "end", weight: 50 },
        { road: "d", end: "end", weight: 0 },
      ],
    },
    ...["a", "b", "c", "d"].map((road) => ({
      road,
      end: "end" as const,
      type: "sink" as const,
      rate: 1,
    })),
  ];
  return p;
}
function observe(p: Project) {
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    deterministicSeed: 8421,
  });
  sim.configure(p);
  sim.running = true;
  const internals = sim as any,
    rows: { id: number; lane: number; sink: string; source: string }[] = [],
    add = sim.runtime!.addVehicle.bind(sim.runtime!);
  sim.runtime!.addVehicle = ((input: any) => {
    const lane = internals.network.lanes.get(input.current.laneId),
      trip = internals.trips.get(Number(input.id));
    rows.push({
      id: Number(input.id),
      lane: lane.lane,
      sink: trip.sink.road,
      source: trip.source.road,
    });
    return add(input);
  }) as typeof add;
  return { sim, rows };
}
it("splits one entry budget evenly among four real source lanes and independently samples weighted destinations", () => {
  const { sim, rows } = observe(fixture());
  for (let i = 0; i < 2400; i++) sim.update(0.05);
  expect(sim.generated).toBe(200);
  expect(rows.length).toBeGreaterThan(190);
  const lanes = [0, 1, 2, 3].map(
    (lane) => rows.filter((r) => r.lane === lane).length,
  );
  expect(Math.max(...lanes) - Math.min(...lanes)).toBeLessThanOrEqual(1);
  expect(rows.filter((r) => r.sink === "d")).toHaveLength(0);
  for (const [sink, ratio] of [
    ["a", 0.2],
    ["b", 0.3],
    ["c", 0.5],
  ] as const) {
    const r = rows.filter((r) => r.sink === sink);
    expect(r.length / rows.length).toBeCloseTo(ratio, 1);
    expect(new Set(r.map((r) => r.lane)).size).toBe(4);
  }
  expect(sim.failed).toBe(0);
  sim.dispose();
}, 30000);
it("four100% entries generate200 total vehicles/minute, not200 per lane", () => {
  const p = fixture();
  p.roads = [0, 1, 2, 3].flatMap((i) => [
    makeRoad(v(0, i * 60), v(1200, i * 60), {
      id: `in${i}`,
      lanesStart: 4,
      lanesEnd: 4,
      speed: 60,
    }),
    makeRoad(v(1200, i * 60), v(2200, i * 60), {
      id: `out${i}`,
      lanesStart: 4,
      lanesEnd: 4,
      speed: 60,
    }),
  ]);
  p.ports = [0, 1, 2, 3].flatMap((i) => [
    {
      road: `in${i}`,
      end: "start" as const,
      type: "source" as const,
      rate: 50,
      destinations: [{ road: `out${i}`, end: "end" as const, weight: 100 }],
    },
    { road: `out${i}`, end: "end" as const, type: "sink" as const, rate: 1 },
  ]);
  const { sim, rows } = observe(p);
  for (let i = 0; i < 1200; i++) sim.update(0.05);
  expect(sim.generated).toBe(200);
  for (const i of [0, 1, 2, 3])
    expect(
      rows.filter((r) => r.source === `in${i}`).length,
    ).toBeGreaterThanOrEqual(48);
  sim.dispose();
});
it("live changes preserve runtime, cars and routes; future requests honor zero shares and pause", () => {
  const p = fixture(),
    { sim, rows } = observe(p);
  for (let i = 0; i < 200; i++) sim.update(0.05);
  const runtime = sim.runtime,
    ids = sim.vehicles.map((c) => c.id),
    before = rows.length,
    elapsed = sim.elapsed;
  p.ports[0].destinations = [{ road: "b", end: "end", weight: 100 }];
  sim.syncDemand(p.ports, 2);
  expect(sim.runtime).toBe(runtime);
  expect(sim.elapsed).toBe(elapsed);
  expect(sim.vehicles.map((c) => c.id)).toEqual(ids);
  for (let i = 0; i < 400; i++) sim.update(0.05);
  expect(rows.slice(before + 4).every((r) => r.sink === "b")).toBe(true);
  expect(rows.length).toBeGreaterThan(before + 20);
  sim.syncDemand(p.ports, 0);
  const generated = sim.generated;
  for (let i = 0; i < 100; i++) sim.update(0.05);
  expect(sim.generated).toBe(generated);
  sim.dispose();
});
