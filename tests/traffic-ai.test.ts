import { expect, it } from "vitest";
import { arcParameter, arcTable, lanePoint, v } from "../src/core/math";
import {
  connections,
  emptyProject,
  example,
  makeRoad,
} from "../src/core/model";
import { buildJunctions } from "../src/core/junctions";
import type { Road } from "../src/core/types";
import { bodiesOverlap } from "../src/simulation/collision";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import {
  advanceVehicle,
  DEFAULT_DRIVER,
  driverProfile,
  followingAcceleration,
  laneChangeIncentive,
} from "../src/simulation/driving";
import {
  IntersectionController,
  movementsConflict,
  type JunctionRequest,
  type Movement,
} from "../src/simulation/intersections";
import { LaneTraffic } from "../src/simulation/lane-traffic";
import {
  findRoute,
  Simulation,
  type Vehicle,
} from "../src/simulation/simulation";

function car(
  road: Road,
  id: number,
  s: number,
  lane: number,
  speed: number,
): Vehicle {
  return {
    id,
    route: [{ road: road.id, direction: 1, inLane: lane, outLane: lane }],
    step: 0,
    s,
    lane,
    speed,
    driver: { ...DEFAULT_DRIVER },
    age: 0,
    color: 0,
    position: lanePoint(road, lane, arcParameter(arcTable(road), s)),
    heading: 0,
    pitch: 0,
  };
}
function roadTest(model: Simulation["trafficModel"] = "cs2-derived") {
  const project = emptyProject();
  const road = makeRoad(v(0, 0), v(2000, 0), {
    lanesStart: 2,
    lanesEnd: 2,
    speed: 100,
  });
  project.roads = [road];
  const sim = new Simulation();
  sim.trafficModel = model;
  sim.configure(project);
  sim.running = true;
  return { road, sim };
}
function movement(
  id: string,
  z: number,
  overrides: Partial<Movement> = {},
): Movement {
  return {
    id,
    junction: "crossroads",
    from: id + ":in",
    to: id + ":out",
    points: [v(-10, z), v(10, z)],
    priority: 1,
    turn: "straight",
    ...overrides,
  };
}
const request = (id: number, m: Movement, space = true): JunctionRequest => ({
  id,
  movement: m,
  eta: 0,
  space,
});

it("reacts to closing speed before the same-distance cruising leader", () => {
  const cruise = followingAcceleration(20, 28, DEFAULT_DRIVER, {
    gap: 45,
    speed: 20,
  });
  const closing = followingAcceleration(20, 28, DEFAULT_DRIVER, {
    gap: 45,
    speed: 5,
  });
  expect(cruise).toBeGreaterThan(0);
  expect(closing).toBeLessThan(-2);
  expect(followingAcceleration(5, 28)).toBeGreaterThan(0);
  expect(followingAcceleration(30, 28)).toBeLessThan(0);
});

it("stops behind a queue, keeps its bumper gap and accelerates when it clears", () => {
  let s = 0,
    speed = 20,
    minGap = Infinity;
  for (let i = 0; i < 1600; i++) {
    const gap = 100 - s;
    minGap = Math.min(minGap, gap);
    const a = followingAcceleration(speed, 25, DEFAULT_DRIVER, {
      gap,
      speed: 0,
    });
    const next = advanceVehicle(speed, a, 0.025);
    s += next.distance;
    speed = next.speed;
  }
  expect(minGap).toBeGreaterThan(1.6);
  expect(speed).toBeLessThan(0.01);
  for (let i = 0; i < 200; i++) {
    const next = advanceVehicle(speed, followingAcceleration(speed, 25), 0.025);
    s += next.distance;
    speed = next.speed;
  }
  expect(speed).toBeGreaterThan(10);
});

it("integrates stopping distance without reversing or moving after a full stop", () => {
  expect(advanceVehicle(1, -8, 0.5)).toEqual({ speed: 0, distance: 0.0625 });
  expect(advanceVehicle(0, -8, 0.025)).toEqual({ speed: 0, distance: 0 });
});

it("makes repeatable drivers with different desired speeds and headways", () => {
  expect(driverProfile(71)).toEqual(driverProfile(71));
  expect(driverProfile(71)).not.toEqual(driverProfile(72));
  const profiles = Array.from({ length: 100 }, (_, i) => driverProfile(i));
  expect(new Set(profiles.map((p) => p.headway)).size).toBe(100);
  expect(
    profiles.every((p) => p.speedFactor >= 0.9 && p.speedFactor <= 1),
  ).toBe(true);
});

it("rejects a lane change that forces excessive braking on its new follower", () => {
  const input = {
    before: -3,
    after: 2,
    followerBefore: 1,
    followerAfter: -5,
    driver: DEFAULT_DRIVER,
    bias: 10,
  };
  expect(laneChangeIncentive(input)).toBe(-Infinity);
  expect(
    laneChangeIncentive({ ...input, followerAfter: -1, bias: 0 }),
  ).toBeGreaterThan(0);
});

it("counts the cost to both old and new followers when deciding to change lanes", () => {
  const input = {
    before: 0,
    after: 1,
    followerBefore: 0,
    followerAfter: -2,
    driver: DEFAULT_DRIVER,
  };
  expect(laneChangeIncentive(input)).toBeCloseTo(0.5);
  expect(
    laneChangeIncentive({
      ...input,
      oldFollowerBefore: -2,
      oldFollowerAfter: 0,
    }),
  ).toBeCloseTo(1);
});

it("reserves both lanes during a change and keeps the lane snapshot immutable", () => {
  const { road } = roadTest();
  const changing = car(road, 1, 50, 0.2, 15);
  changing.laneChange = { from: 0, to: 1, start: 40, length: 40 };
  const lanes = new LaneTraffic([changing, car(road, 2, 20, 1, 20)]);
  changing.s = 500;
  expect(lanes.neighbours(road.id, 1, 0, 0, 99).leader?.s).toBe(50);
  expect(lanes.neighbours(road.id, 1, 1, 25, 99).leader?.id).toBe(1);
  expect(lanes.neighbours(road.id, 1, 1, 25, 99).follower?.id).toBe(2);
  expect(lanes.neighbours(road.id, -1, 1, 25, 99).leader).toBeUndefined();
});

it("legacy MOBIL overtakes a slower leader and returns to the right after passing", () => {
  const { road, sim } = roadTest("legacy");
  const slow = car(road, 901, 130, 1, 8);
  slow.driver = { ...DEFAULT_DRIVER, speedFactor: 0.32 };
  slow.nextLaneDecision = Infinity;
  const fast = car(road, 902, 80, 1, 22);
  sim.vehicles = [slow, fast];
  let overtook = false,
    left = false,
    returned = false,
    changes = 0;
  let changing = false;
  for (let i = 0; i < 1600; i++) {
    sim.update(0.05);
    expect(bodiesOverlap(slow, fast, 0)).toBe(false);
    if (fast.laneChange && !changing) changes++;
    changing = !!fast.laneChange;
    if (fast.lane < 0.1) left = true;
    if (fast.s > slow.s + 6) overtook = true;
    if (overtook && fast.lane > 0.99 && !fast.laneChange) returned = true;
  }
  expect(left).toBe(true);
  expect(overtook).toBe(true);
  expect(returned).toBe(true);
  expect(changes).toBe(2);
});

it("waits for a fast rear vehicle rather than cutting into its braking distance", () => {
  const { road, sim } = roadTest();
  const slow = car(road, 911, 140, 1, 8);
  slow.driver = { ...DEFAULT_DRIVER, speedFactor: 0.32 };
  slow.nextLaneDecision = Infinity;
  const fast = car(road, 912, 100, 1, 20);
  const rear = car(road, 913, 85, 0, 27);
  rear.nextLaneDecision = Infinity;
  sim.vehicles = [slow, fast, rear];
  for (let i = 0; i < 10; i++) sim.update(0.05);
  expect(fast.laneChange).toBeUndefined();
  expect(fast.lane).toBe(1);
  expect(rear.speed).toBeGreaterThan(25);
});

it("follows a nearby car without invoking the opposing lane-swap yield rule", () => {
  const { road, sim } = roadTest();
  const leader = car(road, 914, 120, 1, 5);
  const follower = car(road, 915, 110, 1, 5);
  leader.driver = { ...DEFAULT_DRIVER, speedFactor: 0.2 };
  follower.driver = { ...DEFAULT_DRIVER, speedFactor: 0.2 };
  leader.nextLaneDecision = follower.nextLaneDecision = Infinity;
  sim.vehicles = [leader, follower];
  for (let i = 0; i < 10; i++) sim.update(0.05);
  expect(follower.speed).toBeGreaterThan(3);
  expect(bodiesOverlap(leader, follower, 0)).toBe(false);
});

it("legacy selection uses adjacent changes across a short two-lane exit approach", () => {
  const project = example("transition");
  project.ports = [];
  const approach = project.roads[2],
    ramp = project.roads[4];
  const sim = new Simulation();
  sim.trafficModel = "legacy";
  sim.configure(project);
  sim.running = true;
  const c = car(approach, 921, 0, 0, 12);
  c.position = lanePoint(approach, 0, 0);
  c.route = [
    { road: approach.id, direction: 1, inLane: 0, outLane: 2 },
    { road: ramp.id, direction: 1, inLane: 0, outLane: 0 },
  ];
  sim.vehicles = [c];
  let changes = 0,
    lastStart = -1;
  for (let i = 0; i < 1200; i++) {
    sim.update(0.05);
    if (c.laneChange) {
      expect(Math.abs(c.laneChange.to - c.laneChange.from)).toBe(1);
      if (c.laneChange.start !== lastStart) {
        changes++;
        lastStart = c.laneChange.start;
      }
    }
  }
  expect(changes).toBe(2);
  expect(sim.completed).toBe(1);
});

it("allows opposing straight paths but detects crossing and shared exits", () => {
  const east = movement("east", -1.75);
  const west = movement("west", 1.75, { points: [v(10, 1.75), v(-10, 1.75)] });
  const north = movement("north", 0, { points: [v(0, -10), v(0, 10)] });
  expect(movementsConflict(east, west)).toBe(false);
  expect(movementsConflict(east, north)).toBe(true);
  expect(movementsConflict(east, { ...west, to: east.to })).toBe(true);
  expect(movementsConflict(east, { ...north, junction: "other" })).toBe(false);
  expect(
    movementsConflict(east, { ...north, points: [v(0, -10, 8), v(0, 10, 8)] }),
  ).toBe(false);
});

it("admits compatible streams concurrently and holds crossing traffic until release", () => {
  const control = new IntersectionController();
  const east = movement("east", -1.75),
    west = movement("west", 1.75);
  const north = movement("north", 0, { points: [v(0, -10), v(0, 10)] });
  expect([
    ...control.plan([request(1, east), request(2, west), request(3, north)], 0),
  ]).toEqual([1, 2]);
  control.enter(1, east);
  control.enter(2, west);
  expect(control.plan([request(3, north)], 1).size).toBe(0);
  control.leave(1);
  expect(control.canEnter(3, north)).toBe(false);
  control.leave(2);
  expect(control.plan([request(3, north)], 2).has(3)).toBe(true);
});

it("keeps blocked exits out of the intersection and serves an aged minor approach", () => {
  const control = new IntersectionController();
  const main = movement("main", 0, { priority: 3 });
  const minor = movement("minor", 0, { priority: 0 });
  expect(control.plan([request(1, main, false)], 0).size).toBe(0);
  control.plan([request(2, minor)], 0);
  expect([...control.plan([request(1, main), request(2, minor)], 10)]).toEqual([
    2,
  ]);
});

it("gives free-flow priority to the main road and alternates queued merge approaches", () => {
  const control = new IntersectionController();
  const main = movement("main", 0, { priority: 3, to: "shared", merge: true });
  const ramp = movement("ramp", 0, { priority: 0, to: "shared", merge: true });
  expect([...control.plan([request(1, main), request(2, ramp)], 0)]).toEqual([
    1,
  ]);
  control.enter(1, main);
  control.leave(1);
  const queued = (id: number, m: Movement) => ({
    ...request(id, m),
    queued: true,
  });
  expect([...control.plan([queued(3, main), queued(2, ramp)], 1)]).toEqual([2]);
  control.enter(2, ramp);
  control.leave(2);
  expect([...control.plan([queued(3, main), queued(4, ramp)], 2)]).toEqual([3]);
  control.clear();
  expect([...control.plan([request(5, main), request(6, ramp)], 3)]).toEqual([
    5,
  ]);
});

it("replays the same demand, driver decisions and trajectories after resetting", () => {
  const project = example("transition");
  const sim = new Simulation();
  const run = () => {
    sim.configure(project);
    sim.running = true;
    for (let i = 0; i < 1200; i++) sim.update(0.05);
    return {
      completed: sim.completed,
      generated: sim.generated,
      statistics: { ...sim.statistics },
      cars: sim.vehicles.map((c) => ({
        id: c.id,
        s: c.s,
        lane: c.lane,
        speed: c.speed,
        position: { ...c.position },
      })),
    };
  };
  expect(run()).toEqual(run());
});

function crossroads() {
  const project = example("junction");
  project.ports = [];
  const west = project.roads.find((r) => r.knots[0].p.x < -90)!;
  const east = project.roads.find((r) => r.knots.at(-1)!.p.x > 90)!;
  const junction = buildJunctions(project)[0];
  const westEnd = 95 - junction.arms.find((a) => a.road === west.id)!.trim;
  const eastEntry = junction.arms.find((a) => a.road === east.id)!.trim;
  const sim = new Simulation();
  sim.configure(project);
  sim.running = true;
  return { sim, west, east, westEnd, eastEntry };
}

it("actually runs opposing straight vehicles through one intersection together", () => {
  const { sim, west, east, westEnd } = crossroads();
  const a = car(west, 101, westEnd - 10, 1, 10);
  a.route.push({ road: east.id, direction: 1, inLane: 1, outLane: 1 });
  const b = car(east, 102, westEnd - 10, 0, 10);
  b.route = [
    { road: east.id, direction: -1, inLane: 0, outLane: 0 },
    { road: west.id, direction: -1, inLane: 0, outLane: 0 },
  ];
  b.position = lanePoint(east, 0, 1 - b.s / 95);
  b.heading = Math.PI;
  sim.vehicles = [a, b];
  for (let i = 0; i < 500; i++) {
    sim.update(0.05);
    if (sim.vehicles.length === 2) expect(bodiesOverlap(a, b, 0)).toBe(false);
  }
  expect(sim.statistics.simultaneousJunctions).toBe(2);
  expect(sim.statistics.junctionEntries).toBe(2);
  expect(sim.statistics.safetyStops).toBe(0);
  expect(sim.completed).toBe(2);
});

it("waits outside a real intersection until its downstream exit has room", () => {
  const { sim, west, east, westEnd, eastEntry } = crossroads();
  const approach = car(west, 111, westEnd - 5, 1, 0);
  approach.route.push({ road: east.id, direction: 1, inLane: 1, outLane: 1 });
  const blocked = car(east, 112, eastEntry + 4, 1, 0);
  blocked.driver = { ...DEFAULT_DRIVER, speedFactor: 0.001 };
  blocked.cs2Car = { ...CS2_BASE_CAR, maxSpeed: 0.001 };
  sim.vehicles = [approach, blocked];
  for (let i = 0; i < 80; i++) sim.update(0.05);
  expect(approach.step).toBe(0);
  expect(approach.connector).toBeUndefined();
  expect(approach.s).toBeLessThan(westEnd - 1.8);
  expect(sim.statistics.junctionEntries).toBe(0);
  sim.vehicles = [approach];
  for (let i = 0; i < 600; i++) sim.update(0.05);
  expect(sim.completed).toBe(1);
});

it("serves the physical queue head even when the following car has an older id", () => {
  const { sim, west, east, westEnd } = crossroads();
  const front = car(west, 500, westEnd - 0.5, 1, 0);
  const back = car(west, 100, westEnd - 6.5, 1, 0);
  for (const c of [front, back])
    c.route.push({ road: east.id, direction: 1, inLane: 1, outLane: 1 });
  sim.vehicles = [back, front];
  for (let i = 0; i < 800; i++) sim.update(0.05);
  expect(sim.completed).toBe(2);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("legacy queue-delay routing keeps its decision through the cooldown", () => {
  const p = emptyProject();
  const opts = { lanesStart: 1, lanesEnd: 1, speed: 60 };
  const start = makeRoad(v(-160, 0), v(0, 0), opts);
  const fast = makeRoad(v(0, 0), v(240, 0), { ...opts, speed: 80 });
  const bypass = makeRoad(v(0, 0), v(240, 0), opts, v(60, 80), v(180, 80));
  const end = makeRoad(v(240, 0), v(400, 0), opts);
  p.roads = [start, fast, bypass, end];
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
  const route = findRoute(p, source, sink, connections(p))!;
  expect(route[1].road).toBe(fast.id);
  const waiting = car(start, 201, 10, 0, 0);
  waiting.route = route;
  // A slow queue covers enough of the fast road to make the bypass worthwhile.
  const queue = Array.from({ length: 24 }, (_, i) => {
    const c = car(fast, 300 + i, 20 + i * 7, 0, 0);
    c.driver = { ...DEFAULT_DRIVER, speedFactor: 0.001 };
    return c;
  });
  const sim = new Simulation();
  sim.trafficModel = "legacy";
  sim.configure(p);
  sim.running = true;
  sim.vehicles = [waiting, ...queue];
  for (let i = 0; i < 300; i++) sim.update(0.05);
  expect(waiting.route.some((s) => s.road === bypass.id)).toBe(true);
  expect(waiting.lastRerouteAt).toBeGreaterThan(0);
  const changedAt = waiting.lastRerouteAt;
  sim.vehicles = [waiting];
  for (let i = 0; i < 100; i++) sim.update(0.05);
  expect(waiting.lastRerouteAt).toBe(changedAt);
  expect(waiting.route.some((s) => s.road === bypass.id)).toBe(true);
});
