import { describe, expect, it } from "vitest";
import { dist, lanePoint, tangent, v } from "../src/core/math";
import { attachLanes, endpointLaneGroups } from "../src/core/lane-rules";
import { laneAnchors } from "../src/core/snapping";
import {
  connections,
  emptyProject,
  makeBranch,
  makeRoad,
  parseProject,
  removeRoads,
  splitRoad,
} from "../src/core/model";
import { Simulation } from "../src/simulation/simulation";

const options = (lanes: number) => ({
  lanesStart: lanes,
  lanesEnd: lanes,
  width: 3.5,
  twoWay: false,
});

describe("persistent lane-level road attachment", () => {
  it.each([0, 1, 2, 3])(
    "attaches a single lane to lane %i of a four-lane approach",
    (lane) => {
      const reference = makeRoad(v(-80, 0), v(0, 0), options(4));
      const road = makeRoad(v(0, 0), v(80, 15), options(1));
      attachLanes(road, 0, reference, 1, [lane], [0]);
      const p = emptyProject();
      p.roads = [reference, road];
      expect(
        dist(lanePoint(reference, lane, 1), lanePoint(road, 0, 0)),
      ).toBeLessThan(1e-8);
      expect(tangent(road, 0)).toEqual(tangent(reference, 1));
      expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
        [lane, 0],
      ]);
      expect(connections(parseProject(JSON.stringify(p)))).toEqual(
        connections(p),
      );
    },
  );
  it.each([0, 1, 2])(
    "aligns a contiguous two-lane group starting at %i",
    (lane) => {
      const reference = makeRoad(v(0, 0), v(80, 0), options(4));
      const road = makeRoad(v(-80, 15), v(0, 0), options(2));
      const anchors = laneAnchors(reference, 0, road, 1);
      expect(anchors).toHaveLength(3);
      attachLanes(road, 1, reference, 0, [lane, lane + 1], [0, 1]);
      const p = emptyProject();
      p.roads = [reference, road];
      expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
        [0, lane],
        [1, lane + 1],
      ]);
      for (let i = 0; i < 2; i++)
        expect(
          dist(lanePoint(road, i, 1), lanePoint(reference, lane + i, 0)),
        ).toBeLessThan(1e-8);
    },
  );
  it("selects reverse-direction lanes at the start of a two-way road", () => {
    const reference = makeRoad(v(0, 0), v(80, 0), {
      ...options(3),
      twoWay: true,
    });
    const road = makeRoad(v(0, 0), v(-60, 0), options(1));
    const groups = endpointLaneGroups(reference, 0, road, 0);
    expect(groups.map((g) => g.lanes)).toEqual([[2], [1], [0]]);
    attachLanes(road, 0, reference, 0, [1], [0]);
    const p = emptyProject();
    p.roads = [reference, road];
    expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
      [1, 0],
    ]);
    expect(tangent(road, 0).x).toBeCloseTo(-1);
  });
  it("keeps lane references valid through automatic splits and removes deleted references", () => {
    const p = emptyProject(),
      reference = makeRoad(v(-100, 0), v(0, 0), options(4)),
      road = makeRoad(v(0, 0), v(80, 0), options(1));
    attachLanes(road, 0, reference, 1, [2], [0]);
    p.roads = [reference, road];
    const second = splitRoad(p, reference.id, 0.5)!;
    expect(road.attachments?.start?.road).toBe(second);
    expect(
      connections(p).some(
        (c) =>
          c.from.road === second && c.to.road === road.id && c.from.lane === 2,
      ),
    ).toBe(true);
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    removeRoads(p, new Set([second]));
    expect(road.attachments?.start).toBeUndefined();
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
  });
  it.each(["left", "right"] as const)(
    "builds a smooth generic 4 → 2+2 split on the %s",
    (side) => {
      const p = emptyProject(),
        road = makeRoad(v(-100, 0), v(0, 0), options(4));
      p.roads = [road];
      const rampId = makeBranch(p, road.id, false, {
        lanes: 2,
        side,
        length: 100,
        offset: 35,
      });
      const ramp = p.roads.find((r) => r.id === rampId)!;
      const outgoing = connections(p).filter((c) => c.from.road === road.id);
      expect(outgoing).toHaveLength(4);
      expect(
        outgoing.filter((c) => c.to.road === ramp.id).map((c) => c.from.lane),
      ).toEqual(side === "left" ? [0, 1] : [2, 3]);
      for (const c of outgoing) {
        const target = p.roads.find((r) => r.id === c.to.road)!;
        expect(
          dist(
            lanePoint(road, c.from.lane, 1),
            lanePoint(target, c.to.lane, 0),
          ),
        ).toBeLessThan(1e-8);
        expect(tangent(target, 0).x).toBeCloseTo(1);
      }
      expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    },
  );
});

it("lane turn restrictions affect reachable routes and survive save/load", () => {
  const p = emptyProject(),
    o = { ...options(3), twoWay: true };
  const west = makeRoad(v(-100, 0), v(0, 0), o),
    east = makeRoad(v(0, 0), v(100, 0), o),
    north = makeRoad(v(0, -100), v(0, 0), o),
    south = makeRoad(v(0, 0), v(0, 100), o);
  p.roads = [west, east, north, south];
  p.ports = [
    { road: west.id, end: "start", type: "both", rate: 30 },
    { road: north.id, end: "start", type: "both", rate: 30 },
  ];
  const before = connections(p).filter((c) => c.from.road === west.id);
  expect(before.some((c) => c.to.road === north.id)).toBe(true);
  west.turns = { 3: ["straight"], 4: ["left"], 5: ["right"] };
  const after = connections(p).filter((c) => c.from.road === west.id);
  expect(
    after.filter((c) => c.to.road === north.id).map((c) => c.from.lane),
  ).toEqual([4]);
  expect(
    after.filter((c) => c.to.road === east.id).map((c) => c.from.lane),
  ).toEqual([3]);
  west.turns[4] = [];
  expect(
    connections(p).some(
      (c) => c.from.road === west.id && c.to.road === north.id,
    ),
  ).toBe(false);
  const sim = new Simulation();
  sim.configure(p);
  expect(sim.routeCount).toBe(1); // Return journey remains, restricted outward journey is unreachable.
  expect(connections(parseProject(JSON.stringify(p)))).toEqual(connections(p));
});

it("rejects corrupt lane references and turn data when importing", () => {
  const p = emptyProject(),
    road = makeRoad(v(0, 0), v(80, 0), options(4));
  p.roads = [road];
  road.turns = { 4: ["left"] };
  expect(() => parseProject(JSON.stringify(p))).toThrow(/转向/);
  delete road.turns;
  road.attachments = {
    start: { road: "missing", end: 1, lanes: [1], ownLanes: [0] },
  };
  expect(() => parseProject(JSON.stringify(p))).toThrow(/吸附/);
});

it("traffic actually enters the chosen inner lane and completes its journey", () => {
  const p = emptyProject(),
    target = makeRoad(v(0, 0), v(100, 0), options(4)),
    source = makeRoad(v(-100, -1.75), v(0, -1.75), options(1));
  attachLanes(source, 1, target, 0, [1], [0]);
  p.roads = [source, target];
  p.ports = [
    { road: source.id, end: "start", type: "source", rate: 12 },
    { road: target.id, end: "end", type: "sink", rate: 0 },
  ];
  const sim = new Simulation();
  sim.configure(p);
  sim.running = true;
  let observedEntry = false;
  for (let i = 0; i < 1600; i++) {
    sim.update(0.05);
    if (
      sim.vehicles.some(
        (car) => car.route[1]?.road === target.id && car.route[1].inLane === 1,
      )
    )
      observedEntry = true;
  }
  expect(observedEntry).toBe(true);
  expect(sim.completed).toBeGreaterThan(5);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("permits a new explicit lane attachment to a road that already has another incoming attachment", () => {
  const p = emptyProject(),
    previous = makeRoad(v(-100, 0), v(0, 0), options(4)),
    target = makeRoad(v(0, 0), v(100, 0), options(4)),
    ramp = makeRoad(v(-80, 25), v(0, 0), options(1));
  attachLanes(target, 0, previous, 1, [0, 1, 2, 3], [0, 1, 2, 3]);
  attachLanes(ramp, 1, target, 0, [2], [0]);
  p.roads = [previous, target, ramp];
  const links = connections(p);
  expect(
    links.filter((c) => c.from.road === previous.id && c.to.road === target.id),
  ).toHaveLength(4);
  expect(
    links
      .filter((c) => c.from.road === ramp.id && c.to.road === target.id)
      .map((c) => c.to.lane),
  ).toEqual([2]);
  expect(connections(parseProject(JSON.stringify(p)))).toEqual(links);
});
