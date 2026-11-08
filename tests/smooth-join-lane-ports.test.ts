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
import {
  isJunctionLane,
  physicalLaneEndpointT,
} from "../src/core/junction-lane-geometry";
import {
  autoJunction,
  connections,
  emptyProject,
  History,
  makeRoad,
  parseProject,
} from "../src/core/model";
import { dist, lanePoint, laneWidth, v } from "../src/core/math";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";

function seam(from: number, to: number, smooth = true) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-120, 0), v(), { id: "a", lanesStart: from, lanesEnd: from }),
    makeRoad(v(), v(120, 0), {
      id: "b",
      lanesStart: to,
      lanesEnd: to,
      transitionMode: smooth ? "smooth" : "direct",
    }),
  ];
  autoJunction(p);
  return p;
}
const source = { road: "a", lane: 2, end: 1 as const },
  fourth = { road: "b", lane: 3, end: 0 as const };

describe("smooth collars preserve logical junction lanes", () => {
  it.each([
    [3, 4],
    [4, 3],
    [2, 3],
  ])(
    "retains %i incoming and %i outgoing ports with smoothing on and off",
    (from, to) => {
      for (const smooth of [false, true]) {
        const p = seam(from, to, smooth),
          before = structuredClone(p),
          [node] = buildLaneJunctions(p),
          ports = junctionLanePorts(p, node);
        expect(ports.filter((p) => p.kind === "in").map((p) => p.lane)).toEqual(
          Array.from({ length: from }, (_, i) => i),
        );
        expect(
          ports.filter((p) => p.kind === "out").map((p) => p.lane),
        ).toEqual(Array.from({ length: to }, (_, i) => i));
        expect(junctionLaneCandidates(p, node)).toHaveLength(from * to);
        for (const port of ports) {
          expect(port.number).toBe(port.lane + 1);
          expect(port.name).not.toContain("0 车道");
        }
        expect(p).toEqual(before);
        expect(p.roads).toHaveLength(2);
        expect(p.roads.map((r) => r.knots.length)).toEqual([2, 2]);
      }
    },
  );

  it("uses the real growing lane curve and keeps the physical taper intact", () => {
    const p = seam(3, 4),
      road = p.roads[1],
      [node] = buildLaneJunctions(p),
      ports = junctionLanePorts(p, node),
      outs = ports.filter((p) => p.kind === "out"),
      t = physicalLaneEndpointT(road, 3, 0)!;
    expect(laneWidth(road, 3, 0)).toBe(0);
    expect(isJunctionLane(road, 3, 0)).toBe(true);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(road.autoTaper!.start!.span);
    expect(laneWidth(road, 3, t) + 1e-7).toBeCloseTo(road.width * 0.8, 7);
    expect(laneWidth(road, 3, t - 1e-6) + 1e-7).toBeLessThan(road.width * 0.8);
    const arm = node.arms.find((a) => a.road === "b")!;
    expect(
      dist(outs[3].position, lanePoint(road, 3, Math.max(t, arm.t))),
    ).toBeLessThan(1e-8);
    for (let i = 0; i < outs.length; i++)
      for (let j = i + 1; j < outs.length; j++)
        expect(dist(outs[i].position, outs[j].position)).toBeGreaterThan(2);
    // Default traffic keeps its existing automatic mapping and road trims.
    expect(connections(p).map((c) => c.id)).toEqual([
      "a:0>b:0",
      "a:1>b:1",
      "a:2>b:2",
    ]);
    const base = new Map(p.roads.map((r) => [r.id, { start: 0, end: 0 }]));
    expect(laneJunctionTrims(p, base)).toBe(base);
  });

  it("finds the real disappearing source lane before a 4 to 3 seam", () => {
    const p = seam(4, 3),
      road = p.roads[0],
      t = physicalLaneEndpointT(road, 3, 1)!;
    expect(laneWidth(road, 3, 1)).toBe(0);
    expect(t).toBeLessThan(1);
    expect(t).toBeGreaterThan(1 - road.autoTaper!.end!.span);
    expect(laneWidth(road, 3, t) + 1e-7).toBeCloseTo(road.width * 0.8, 7);
    expect(laneWidth(road, 3, t + 1e-6) + 1e-7).toBeLessThan(road.width * 0.8);
    setJunctionLaneRule(p, { road: "a", lane: 3, end: 1 }, [
      { road: "b", lane: 2, end: 0 },
    ]);
    expect(connections(p).find((c) => c.id === "a:3>b:2")?.manual).toBe(true);
  });

  it("preserves the fourth destination and explicit closures through toggles, history and reload", () => {
    let p = seam(3, 4, false);
    setJunctionLaneRule(p, source, [fourth]);
    setJunctionLaneRule(p, { road: "a", lane: 0, end: 1 }, []);
    const rules = structuredClone(p.junctionLaneConnections),
      history = new History();
    history.commit(p);
    p.roads[1].transitionMode = "smooth";
    autoJunction(p);
    expect(p.junctionLaneConnections).toEqual(rules);
    expect(
      connections(p)
        .filter((c) => c.from.lane === 2)
        .map((c) => c.to),
    ).toEqual([{ road: "b", lane: 3 }]);
    expect(
      connections(p).filter((c) => c.from.road === "a" && c.from.lane === 0),
    ).toEqual([]);
    p = parseProject(JSON.stringify(p));
    expect(p.junctionLaneConnections).toEqual(rules);
    const direct = history.undo(p)!;
    expect(direct.junctionLaneConnections).toEqual(rules);
    p = history.redo(direct)!;
    expect(p.junctionLaneConnections).toEqual(rules);
    p.roads[1].transitionMode = "direct";
    autoJunction(p);
    expect(p.junctionLaneConnections).toEqual(rules);
    expect(p.roads[1].autoTaper).toBeUndefined();
  });

  it("does not reinterpret an existing empty rule as an accidentally lost destination", () => {
    const p = seam(3, 4);
    setJunctionLaneRule(p, source, []);
    for (const mode of ["direct", "smooth", "direct"] as const) {
      p.roads[1].transitionMode = mode;
      autoJunction(p);
      expect(p.junctionLaneConnections).toEqual([{ from: source, to: [] }]);
      expect(connections(p).some((c) => c.from.lane === 2)).toBe(false);
    }
  });

  it("keeps reverse lanes separate on asymmetric two-way roads with a median", () => {
    const p = seam(2, 3);
    for (const road of p.roads) {
      road.twoWay = true;
      road.backwardLanesStart = road.backwardLanesEnd = 2;
      road.median = { kind: "concrete", width: 2 };
    }
    autoJunction(p);
    const [node] = buildLaneJunctions(p),
      ports = junctionLanePorts(p, node),
      aIn = ports.filter((p) => p.road === "a" && p.kind === "in"),
      aOut = ports.filter((p) => p.road === "a" && p.kind === "out"),
      bIn = ports.filter((p) => p.road === "b" && p.kind === "in"),
      bOut = ports.filter((p) => p.road === "b" && p.kind === "out");
    expect([aIn.length, aOut.length, bIn.length, bOut.length]).toEqual([
      2, 2, 2, 3,
    ]);
    expect(aIn.map((p) => p.lane)).toEqual([2, 3]);
    expect(bOut.map((p) => p.lane)).toEqual([2, 3, 4]);
    for (const c of junctionLaneCandidates(p, node)) {
      expect(c.from.kind).toBe("in");
      expect(c.to.kind).toBe("out");
    }
    expect(() =>
      setJunctionLaneRule(p, { road: "a", lane: 2, end: 1 }, [
        { road: "b", lane: 1, end: 0 },
      ]),
    ).toThrow();
  });

  it("does not create a semantic lane for a true profile which ends before the junction", () => {
    const road = makeRoad(v(), v(120, 0), { lanesStart: 4, lanesEnd: 3 });
    expect(isJunctionLane(road, 3, 0)).toBe(true);
    expect(isJunctionLane(road, 3, 1)).toBe(false);
    expect(physicalLaneEndpointT(road, 3, 1)).toBeUndefined();
    expect(isJunctionLane(road, 4, 0)).toBe(false);
  });
});

describe("smooth lane connections use real compiled vehicle paths", () => {
  it.each([
    [3, 4, 2, 3],
    [4, 3, 3, 2],
  ])(
    "drives %i to %i through authored source%d / target%d",
    (from, to, inLane, outLane) => {
      const p = seam(from, to);
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
            (w) => w.includes(id) && /fades|mismatch/.test(w),
          ),
        ).toEqual([]);
        let traversed = false,
          enteredTarget = false;
        sim.running = true;
        for (let i = 0; i < 1200; i++) {
          sim.update(0.05);
          for (const car of sim.vehicles) {
            traversed ||= car.connector?.id === id;
            enteredTarget ||=
              !car.connector &&
              car.route[car.step]?.road === "b" &&
              car.lane === outLane;
          }
        }
        expect(traversed).toBe(true);
        expect(enteredTarget).toBe(true);
        expect(sim.completed).toBeGreaterThan(0);
      } finally {
        sim.dispose();
      }
    },
  );
});
