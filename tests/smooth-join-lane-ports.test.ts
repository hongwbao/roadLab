import { describe, expect, it } from "vitest";
import {
  buildLaneJunctions,
  laneJunctionTrims,
} from "../src/core/lane-junctions";
import {
  junctionLaneCandidates,
  junctionLanePorts,
  setJunctionLaneRule,
} from "../src/core/junction-lane-connections";
import { isJunctionLane } from "../src/core/junction-lane-geometry";
import {
  autoJunction,
  connections,
  emptyProject,
  History,
  makeRoad,
  parseProject,
  reverseRoad,
} from "../src/core/model";
import {
  dist,
  lanePoint,
  laneWidth,
  normal,
  sub,
  tangent,
  v,
} from "../src/core/math";
import { isNodeSmooth, setNodeSmooth } from "../src/core/road-visual-settings";
import type { Project } from "../src/core/types";
import { compileCs2Network } from "../src/simulation/cs2-network";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import { bodiesOverlap } from "../src/simulation/collision";

function seam(from: number, to: number, smooth = false) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-120, 0), v(), { id: "a", lanesStart: from, lanesEnd: from }),
    makeRoad(v(), v(120, 0), { id: "b", lanesStart: to, lanesEnd: to }),
  ];
  autoJunction(p);
  if (smooth) setNodeSmooth(p, buildLaneJunctions(p)[0], true);
  return p;
}
const source = { road: "a", lane: 2, end: 1 as const },
  fourth = { road: "b", lane: 3, end: 0 as const },
  fifth = { road: "b", lane: 4, end: 0 as const };
function endpointState(p: Project) {
  return buildLaneJunctions(p).map((node) => ({
    node,
    ports: junctionLanePorts(p, node),
    candidates: junctionLaneCandidates(p, node),
  }));
}
function networkState(p: Project) {
  const network = compileCs2Network({
    project: p,
    connections: connections(p),
    revision: 1,
  });
  return {
    lanes: network.lanes,
    curves: network.curves,
    groups: network.groups,
    graph: network.graph,
    graphLaneIds: network.graphLaneIds,
    roadLaneIds: network.roadLaneIds,
    connectionLaneIds: network.connectionLaneIds,
    successors: network.successors,
    warnings: network.warnings,
  };
}

describe("node smoothing preserves the direct junction lane baseline", () => {
  it.each([
    [3, 4],
    [4, 3],
    [2, 3],
    [3, 5],
    [5, 3],
  ])(
    "keeps %i incoming and %i outgoing ports and every candidate fixed",
    (from, to) => {
      const p = seam(from, to),
        [node] = buildLaneJunctions(p),
        before = endpointState(p),
        roads = structuredClone(p.roads),
        baseline = connections(p);
      for (const smooth of [true, false, true]) {
        setNodeSmooth(p, node, smooth);
        expect(isNodeSmooth(p, node)).toBe(smooth);
        const ports = junctionLanePorts(p, node);
        expect(
          ports.filter((port) => port.kind === "in").map((port) => port.lane),
        ).toEqual(Array.from({ length: from }, (_, i) => i));
        expect(
          ports.filter((port) => port.kind === "out").map((port) => port.lane),
        ).toEqual(Array.from({ length: to }, (_, i) => i));
        expect(junctionLaneCandidates(p, node)).toHaveLength(from * to);
        for (const port of ports) {
          expect(port.number).toBe(port.lane + 1);
          expect(port.name).not.toContain("0 车道");
        }
        expect(endpointState(p)).toEqual(before);
        expect(connections(p)).toEqual(baseline);
        expect(p.roads).toEqual(roads);
        expect(p.roads.map((road) => road.knots.length)).toEqual([2, 2]);
      }
    },
  );

  it.each([
    [3, 5, "b"],
    [5, 3, "a"],
  ] as const)(
    "keeps all five %i to %i points on one unchanged arm section",
    (from, to, wideId) => {
      const p = seam(from, to),
        [node] = buildLaneJunctions(p),
        road = p.roads.find((road) => road.id === wideId)!,
        arm = node.arms.find((arm) => arm.road === wideId)!,
        baseline = junctionLanePorts(p, node).filter(
          (port) => port.road === wideId,
        ),
        frame = tangent(road, arm.t),
        across = normal(road, arm.t);
      expect(baseline).toHaveLength(5);
      for (const smooth of [true, false, true, false]) {
        setNodeSmooth(p, node, smooth);
        const ports = junctionLanePorts(p, buildLaneJunctions(p)[0]).filter(
          (port) => port.road === wideId,
        );
        expect(ports).toEqual(baseline);
        for (const port of ports) {
          expect(isJunctionLane(road, port.lane, arm.end)).toBe(true);
          expect(laneWidth(road, port.lane, arm.end)).toBe(road.width);
          expect(
            dist(port.position, lanePoint(road, port.lane, arm.t)),
          ).toBeLessThan(1e-8);
          const offset = sub(port.position, ports[0].position);
          expect(
            offset.x * frame.x + offset.y * frame.y + offset.z * frame.z,
          ).toBeCloseTo(0, 10);
        }
        for (let lane = 1; lane < ports.length; lane++) {
          const offset = sub(ports[lane].position, ports[lane - 1].position);
          expect(
            dist(ports[lane].position, ports[lane - 1].position),
          ).toBeCloseTo(road.width, 10);
          expect(offset.x * across.x + offset.z * across.z).toBeCloseTo(
            road.width,
            10,
          );
        }
      }
      const trims = new Map(
        p.roads.map((road) => [road.id, { start: 0, end: 0 }]),
      );
      expect(laneJunctionTrims(p, trims)).toBe(trims);
    },
  );

  it.each([fourth, fifth])(
    "retains target lane $lane and empty-to through toggle order, history and save",
    (target) => {
      for (const smoothFirst of [false, true]) {
        let p = seam(3, 5),
          [node] = buildLaneJunctions(p);
        if (smoothFirst) setNodeSmooth(p, node, true);
        setJunctionLaneRule(p, source, [target]);
        setJunctionLaneRule(p, { road: "a", lane: 0, end: 1 }, []);
        const rules = structuredClone(p.junctionLaneConnections),
          baseline = connections(p),
          endpoints = endpointState(p),
          history = new History();
        history.commit(p);
        setNodeSmooth(p, node, !smoothFirst);
        expect(p.junctionLaneConnections).toEqual(rules);
        expect(connections(p)).toEqual(baseline);
        expect(endpointState(p)).toEqual(endpoints);
        expect(
          connections(p)
            .filter((c) => c.from.lane === 2)
            .map((c) => c.to),
        ).toEqual([{ road: "b", lane: target.lane }]);
        expect(
          connections(p).filter(
            (c) => c.from.road === "a" && c.from.lane === 0,
          ),
        ).toEqual([]);
        p = parseProject(JSON.stringify(p));
        expect(p.junctionLaneConnections).toEqual(rules);
        expect(isNodeSmooth(p, node)).toBe(!smoothFirst);
        const undone = history.undo(p)!;
        expect(isNodeSmooth(undone, node)).toBe(smoothFirst);
        expect(undone.junctionLaneConnections).toEqual(rules);
        p = history.redo(undone)!;
        expect(isNodeSmooth(p, node)).toBe(!smoothFirst);
        expect(connections(p)).toEqual(baseline);
        setNodeSmooth(p, node, false);
        autoJunction(p);
        expect(p.junctionLaneConnections).toEqual(rules);
        expect(connections(p)).toEqual(baseline);
        expect(endpointState(p)).toEqual(endpoints);
        expect(p.roads.every((road) => !road.autoTaper)).toBe(true);
      }
    },
  );

  it("preserves an existing empty rule instead of guessing a lost destination", () => {
    const p = seam(3, 5),
      [node] = buildLaneJunctions(p);
    setJunctionLaneRule(p, source, []);
    for (const enabled of [true, false, true, false]) {
      setNodeSmooth(p, node, enabled);
      autoJunction(p);
      expect(p.junctionLaneConnections).toEqual([{ from: source, to: [] }]);
      expect(connections(p).some((c) => c.from.lane === 2)).toBe(false);
      expect(parseProject(JSON.stringify(p)).junctionLaneConnections).toEqual([
        { from: source, to: [] },
      ]);
    }
  });

  it.each([false, true])(
    "keeps asymmetric median direction limits with reversed target=%s",
    (reversed) => {
      const p = seam(2, 3);
      for (const road of p.roads) {
        road.twoWay = true;
        road.backwardLanesStart = road.backwardLanesEnd = 2;
        road.median = { kind: "concrete", width: 2 };
        road.sectionOffset = 1.5;
      }
      if (reversed) reverseRoad(p.roads[1]);
      autoJunction(p);
      const [node] = buildLaneJunctions(p),
        before = endpointState(p),
        baseline = connections(p),
        ports = junctionLanePorts(p, node),
        aIn = ports.filter((port) => port.road === "a" && port.kind === "in"),
        aOut = ports.filter((port) => port.road === "a" && port.kind === "out"),
        bIn = ports.filter((port) => port.road === "b" && port.kind === "in"),
        bOut = ports.filter((port) => port.road === "b" && port.kind === "out");
      expect([aIn.length, aOut.length, bIn.length, bOut.length]).toEqual([
        2, 2, 2, 3,
      ]);
      expect(aIn.map((port) => port.lane)).toEqual([2, 3]);
      expect(bOut.map((port) => port.lane)).toEqual(
        reversed ? [0, 1, 2] : [2, 3, 4],
      );
      expect(bOut.every((port) => port.end === (reversed ? 1 : 0))).toBe(true);
      for (const enabled of [true, false]) {
        setNodeSmooth(p, node, enabled);
        expect(endpointState(p)).toEqual(before);
        expect(connections(p)).toEqual(baseline);
        for (const candidate of junctionLaneCandidates(p, node)) {
          expect(candidate.from.kind).toBe("in");
          expect(candidate.to.kind).toBe("out");
        }
        expect(() => setJunctionLaneRule(p, aIn[0], [bIn[0]])).toThrow();
      }
    },
  );

  it("rejects a true disappearing profile lane at the junction in either visual mode", () => {
    const p = seam(4, 3),
      road = p.roads[0];
    road.lanesEnd = 3;
    road.profile = {
      from: 4,
      to: 3,
      start: 0,
      end: 1,
      transitionStart: 0.2,
      transitionEnd: 0.8,
    };
    autoJunction(p);
    const [node] = buildLaneJunctions(p),
      before = endpointState(p),
      baseline = networkState(p);
    expect(isJunctionLane(road, 3, 0)).toBe(true);
    expect(isJunctionLane(road, 3, 1)).toBe(false);
    expect(isJunctionLane(road, 4, 0)).toBe(false);
    expect(laneWidth(road, 3, 0.5)).toBeGreaterThan(0);
    expect(laneWidth(road, 3, 0.5)).toBeLessThan(road.width);
    for (const enabled of [true, false]) {
      setNodeSmooth(p, node, enabled);
      expect(endpointState(p)).toEqual(before);
      expect(
        junctionLanePorts(p, node).some(
          (port) => port.road === "a" && port.lane === 3,
        ),
      ).toBe(false);
      expect(() =>
        setJunctionLaneRule(p, { road: "a", lane: 3, end: 1 }, [
          { road: "b", lane: 2, end: 0 },
        ]),
      ).toThrow();
      expect(networkState(p)).toEqual(baseline);
    }
  });
});

describe("node visual settings preserve real compiled vehicle paths", () => {
  it.each([
    [3, 4, 2, 3],
    [4, 3, 3, 2],
    [3, 5, 2, 3],
    [3, 5, 2, 4],
    [5, 3, 4, 2],
  ])(
    "drives %i to %i through authored source%d / target%d",
    (from, to, inLane, outLane) => {
      const p = seam(from, to),
        [node] = buildLaneJunctions(p);
      for (let lane = 0; lane < from; lane++)
        setJunctionLaneRule(
          p,
          { road: "a", lane, end: 1 },
          lane === inLane ? [{ road: "b", lane: outLane, end: 0 }] : [],
        );
      p.ports = [
        { road: "a", end: "start", type: "source", rate: 12 },
        { road: "b", end: "end", type: "sink", rate: 1 },
      ];
      const baseline = networkState(p);
      setNodeSmooth(p, node, true);
      expect(networkState(p)).toEqual(baseline);
      const sim = new Cs2TrafficSimulation({
        synchronousPathsOnlyForTests: true,
      });
      try {
        sim.configure(p);
        const id = `a:${inLane}>b:${outLane}`,
          network = sim.network!,
          laneId = network.connectionLaneIds.get(id);
        expect(laneId).toBeDefined();
        const connection = network.lanes.get(laneId!)!;
        expect(connection.from).toEqual({ road: "a", lane: inLane });
        expect(connection.to).toEqual({ road: "b", lane: outLane });
        const successors = network.successors
          .get(laneId!)!
          .map((id) => network.lanes.get(id)!);
        expect(
          successors.some((lane) => lane.road === "b" && lane.lane === outLane),
        ).toBe(true);
        for (const lane of successors)
          expect(
            dist(connection.curve.points[3], lane.curve.points[0]),
          ).toBeLessThan(0.1);
        expect(
          network.warnings.filter(
            (warning) => warning.includes(id) && /fades|mismatch/.test(warning),
          ),
        ).toEqual([]);
        let traversed = false,
          enteredTarget = false;
        sim.running = true;
        for (let i = 0; i < 1200; i++) {
          // The same live engine/network continues while only node metadata changes.
          if (i === 200 || i === 400) {
            const active = sim.vehicles.map((car) => car.id);
            setNodeSmooth(p, node, i === 400);
            expect(sim.network).toBe(network);
            expect(sim.vehicles.map((car) => car.id)).toEqual(active);
            expect(networkState(p)).toEqual(baseline);
          }
          sim.update(0.05);
          if (i % 10 === 0)
            for (let a = 0; a < sim.vehicles.length; a++)
              for (let b = a + 1; b < sim.vehicles.length; b++)
                expect(bodiesOverlap(sim.vehicles[a], sim.vehicles[b], 0)).toBe(
                  false,
                );
          for (const car of sim.vehicles) {
            traversed ||= car.connector?.id === id;
            enteredTarget ||=
              !car.connector &&
              car.route[car.step]?.road === "b" &&
              car.lane === outLane;
          }
        }
        if (connection.curve.length > 1e-8) expect(traversed).toBe(true);
        else {
          // Aligned direct seams are zero-length graph edges: a fixed-dt
          // snapshot can skip the connector while the authored route passes.
          expect(connection.curve.points).toEqual([
            { x: 0, y: 0, z: 4 },
            { x: 0, y: 0, z: 4 },
            { x: 0, y: 0, z: 4 },
            { x: 0, y: 0, z: 4 },
          ]);
          expect(network.successors.get(laneId!)).toHaveLength(1);
        }
        expect(enteredTarget).toBe(true);
        expect(sim.completed).toBeGreaterThan(0);
      } finally {
        sim.dispose();
      }
    },
  );
});
