import { expect, it } from "vitest";
import { roadLabRouteParameters } from "../src/simulation/route-choice-policy";
import { calculateCs2PathCost } from "../src/simulation/cs2-routing";
import { cs2PersonalCarFallbackParameters } from "../src/simulation/cs2-path-policy";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import { emptyProject, makeRoad } from "../src/core/model";
import { roadLength, v } from "../src/core/math";

it("prefers the faster long road rather than the short slow road when distance costs disagree with time", () => {
  const short = {
      length: 1000,
      maxSpeed: 25 / 3.6,
      flowOffset: 0,
      methods: 2,
      costs: [0, 0, 10, 0] as const,
    },
    long = {
      length: 4000,
      maxSpeed: 120 / 3.6,
      flowOffset: 0,
      methods: 2,
      costs: [0, 0, 40, 0] as const,
    };
  const old = { ...cs2PersonalCarFallbackParameters(200 / 3.6), methods: 2 },
    now = { ...roadLabRouteParameters(200 / 3.6), methods: 2 };
  expect(calculateCs2PathCost(short, old)).toBeLessThan(
    calculateCs2PathCost(long, old),
  );
  expect(calculateCs2PathCost(long, now)).toBeLessThan(
    calculateCs2PathCost(short, now),
  );
});
function network() {
  const p = emptyProject();
  const entry = makeRoad(v(-200, 0), v(), {
    id: "entry",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 60,
  });
  const short = makeRoad(v(), v(1000, 0), {
    id: "short-slow",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 25,
  });
  const fast = makeRoad(
    v(),
    v(1000, 0),
    { id: "long-fast", lanesStart: 1, lanesEnd: 1, speed: 120 },
    v(0, 2400),
    v(1000, 2400),
  );
  const exit = makeRoad(v(1000, 0), v(1200, 0), {
    id: "exit",
    lanesStart: 1,
    lanesEnd: 1,
    speed: 60,
  });
  p.roads = [entry, short, fast, exit];
  p.ports = [
    { road: entry.id, end: "start", type: "source", rate: 0 },
    { road: exit.id, end: "end", type: "sink", rate: 1 },
  ];
  return { p, short, fast };
}
async function plan(p: ReturnType<typeof network>["p"], seed: number) {
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    deterministicSeed: seed,
  });
  sim.configure(p);
  const id = (await sim.spawnTrip(p.ports[0], p.ports[1]))!;
  sim.running = true;
  sim.update(0.1);
  return { sim, roads: (sim as any).trips.get(id).fixedRoads as string[] };
}
it("uses speed limits in actual departure routes for all seeds and respects a later limit edit", async () => {
  const { p, short, fast } = network();
  expect(roadLength(fast)).toBeGreaterThan(roadLength(short) * 3);
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { sim, roads } = await plan(p, seed);
    expect(roads).toContain("long-fast");
    expect(roads).not.toContain("short-slow");
    sim.dispose();
  }
  fast.speed = 10;
  const { sim, roads } = await plan(p, 17);
  expect(roads).toContain("short-slow");
  expect(roads).not.toContain("long-fast");
  sim.dispose();
});
it("keeps vehicle maximum speed and measured flow active in the time estimate", () => {
  const params = { ...roadLabRouteParameters(10), methods: 2 },
    road = {
      length: 1000,
      maxSpeed: 100,
      flowOffset: 0,
      methods: 2,
      costs: [0, 0, 0, 0] as const,
    };
  expect(calculateCs2PathCost(road, params)).toBeCloseTo(100);
  expect(calculateCs2PathCost({ ...road, maxSpeed: 5 }, params)).toBeCloseTo(
    200,
  );
  expect(
    calculateCs2PathCost({ ...road, flowOffset: 128 }, params),
  ).toBeCloseTo(200);
});
it("continues to enforce authored lane connections under the time-first departure policy", async () => {
  const { p } = network();
  p.junctionLaneConnections = [
    {
      from: { road: "entry", end: 1, lane: 0 },
      to: [{ road: "short-slow", end: 0, lane: 0 }],
    },
  ];
  const { sim, roads } = await plan(p, 33);
  expect(roads).toContain("short-slow");
  expect(roads).not.toContain("long-fast");
  expect(sim.failed).toBe(0);
  sim.dispose();
});
