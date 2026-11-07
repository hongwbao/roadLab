import { describe, it, expect } from "vitest";
import { addRoadsideLanes } from "../src/core/road-sections";
import {
  arcTable,
  backwardStart,
  backwardEnd,
  boundaryPoint,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  nodePoint,
  totalAt,
  v,
} from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  makeRoad,
  parseProject,
  splitRoad,
} from "../src/core/model";
import { attachLanes } from "../src/core/lane-rules";
import { Simulation } from "../src/simulation/simulation";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";

describe("roadside expansion and asymmetric sections", () => {
  it.each(
    [false, true].flatMap((twoWay) =>
      ["left", "right"].map((side) => ({
        twoWay,
        side: side as "left" | "right",
      })),
    ),
  )(
    "keeps existing lane positions when adding on $side, twoWay=$twoWay",
    ({ twoWay, side }) => {
      const p = emptyProject(),
        r = makeRoad(v(-80, 0), v(0, 0), {
          twoWay,
          lanesStart: 2,
          lanesEnd: 2,
        });
      p.roads = [r];
      const old = structuredClone(r),
        { road } = addRoadsideLanes(p, r.id, side);
      expect(laneCount(road)).toBe(laneCount(old) + 1);
      expect(backwardStart(road)).toBe(twoWay ? (side === "left" ? 3 : 2) : 0);
      expect(road.lanesStart).toBe(twoWay && side === "left" ? 2 : 3);
      for (const t of [0, 0.3, 0.7, 1]) {
        expect(dist(nodePoint(old, t), nodePoint(road, t))).toBeLessThan(1e-8);
        for (let i = 0; i < laneCount(old); i++) {
          const lane = i + (side === "left" ? 1 : 0);
          expect(
            dist(lanePoint(old, i, t), lanePoint(road, lane, t)),
          ).toBeLessThan(1e-8);
          expect(laneDirection(road, lane)).toBe(laneDirection(old, i));
        }
      }
      expect(road.autoTaper).toBeUndefined();
      expect(road.transitionMode).toBe("direct");
      expect(parseProject(JSON.stringify(p)).roads[0]).toEqual(road);
    },
  );
  it("remaps old lane rules and all cross-road attachment references after adding on the left", () => {
    const p = emptyProject(),
      r = makeRoad(v(-60, 0), v(0, 0)),
      next = makeRoad(v(0, 0), v(60, 0));
    p.roads = [r, next];
    attachLanes(next, 0, r, 1, [1], [0]);
    r.turns = { 1: ["right"] };
    p.junctionLaneConnections = [
      {
        from: { road: r.id, lane: 1, end: 1 },
        to: [{ road: next.id, lane: 0, end: 0 }],
      },
    ];
    addRoadsideLanes(p, r.id, "left");
    expect(next.attachments!.start!.lanes).toEqual([2]);
    expect(p.roads[0].turns).toEqual({ 2: ["right"] });
    expect(p.junctionLaneConnections[0].from.lane).toBe(2);
  });
  it("leaves the third lane available for an independent incoming road without an automatic taper", () => {
    const p = emptyProject(),
      main = makeRoad(v(-80, 0), v(0, 0)),
      wide = makeRoad(v(0, 0), v(80, 0), { lanesStart: 3, lanesEnd: 3 }),
      side = makeRoad(v(-70, 18), v(0, 0), { lanesStart: 1, lanesEnd: 1 });
    attachLanes(main, 1, wide, 0, [0, 1], [0, 1]);
    attachLanes(side, 1, wide, 0, [2], [0]);
    p.roads = [main, wide, side];
    autoJunction(p);
    expect(p.roads.every((r) => !r.autoTaper)).toBe(true);
    expect(totalAt(wide, 0)).toBe(3);
    const links = connections(p);
    expect(
      links
        .filter((c) => c.to.road === wide.id)
        .map((c) => c.to.lane)
        .sort(),
    ).toEqual([0, 1, 2]);
    const sim = new Cs2TrafficSimulation();
    sim.configure(p);
    for (const link of links)
      expect(sim.network!.connectionLaneIds.has(link.id)).toBe(true);
    sim.dispose();
  });
  it("only smooths an asymmetric join after the wide section is explicitly upgraded", () => {
    const p = emptyProject(),
      a = makeRoad(v(-80, 0), v(0, 0), { twoWay: true }),
      b = makeRoad(v(0, 0), v(80, 0), { twoWay: true });
    p.roads = [a, b];
    const { road } = addRoadsideLanes(p, b.id, "right");
    autoJunction(p);
    expect(totalAt(road, 0)).toBe(5);
    road.transitionMode = "smooth";
    autoJunction(p);
    expect(road.autoTaper!.start!.backwardLanes).toBe(2);
    expect(totalAt(road, 0)).toBe(4);
    expect(totalAt(road, 0.9)).toBe(5);
    expect(laneWidth(road, 4, 0)).toBe(0);
    for (const link of connections(p)) {
      const from = p.roads.find((r) => r.id === link.from.road)!,
        to = p.roads.find((r) => r.id === link.to.road)!;
      expect(
        dist(
          lanePoint(from, link.from.lane, from === a ? 1 : 0),
          lanePoint(to, link.to.lane, to.id === b.id ? 0 : 1),
        ),
      ).toBeLessThan(1e-8);
    }
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    road.transitionMode = "direct";
    autoJunction(p);
    expect(totalAt(road, 0)).toBe(5);
  });
  it("preserves asymmetric geometry and reverse counts through splits and map saves", () => {
    const p = emptyProject(),
      r = makeRoad(v(-80, 0), v(80, 0), {
        twoWay: true,
        lanesStart: 3,
        lanesEnd: 3,
        backwardLanesStart: 2,
        backwardLanesEnd: 2,
      });
    p.roads = [r];
    splitRoad(p, r.id, 0.4);
    const [a, b] = p.roads;
    expect(backwardStart(a)).toBe(2);
    expect(backwardEnd(b)).toBe(2);
    for (let lane = 0; lane < 5; lane++)
      expect(dist(lanePoint(a, lane, 1), lanePoint(b, lane, 0))).toBeLessThan(
        1e-8,
      );
    expect(dist(boundaryPoint(r, 0, 0.4), boundaryPoint(a, 0, 1))).toBeLessThan(
      1e-8,
    );
    expect(parseProject(JSON.stringify(p)).roads).toEqual(p.roads);
  });
  it("builds the latest edited runtime once when testing begins and serves the added lane", () => {
    const p = emptyProject(),
      r = makeRoad(v(-80, 0), v(80, 0));
    p.roads = [r];
    p.ports = [
      { road: r.id, end: "start", type: "source", rate: 30 },
      { road: r.id, end: "end", type: "sink", rate: 0 },
    ];
    const sim = new Simulation();
    sim.prepareForEditing(p);
    addRoadsideLanes(p, r.id, "right");
    sim.prepareForEditing(p);
    expect(sim.needsPreparation).toBe(true);
    expect(sim.vehicles).toHaveLength(0);
    sim.prepareForRun();
    expect(sim.needsPreparation).toBe(false);
    sim.running = true;
    for (let i = 0; i < 400; i++) sim.update(0.05);
    expect(sim.generated).toBeGreaterThan(0);
    expect(sim.completed).toBeGreaterThan(0);
    sim.dispose();
  });
  it("recomputes driving distance after dragging an existing curve handle", () => {
    const r = makeRoad(v(-50, 0), v(50, 0));
    const straight = arcTable(r).at(-1)!.s;
    r.knots[0].outgoing.z = 45;
    r.knots[1].incoming.z = 45;
    expect(arcTable(r).at(-1)!.s).toBeGreaterThan(straight + 10);
    r.knots[0].outgoing.z = 0;
    r.knots[1].incoming.z = 0;
    expect(arcTable(r).at(-1)!.s).toBeCloseTo(straight, 8);
  });
  it.each([NaN, 0, 7, 2.5])("rejects an invalid reverse lane count %s", (n) => {
    const p = emptyProject();
    p.roads = [
      makeRoad(v(), v(80, 0), { twoWay: true, backwardLanesStart: n }),
    ];
    expect(() => parseProject(JSON.stringify(p))).toThrow();
  });
});
