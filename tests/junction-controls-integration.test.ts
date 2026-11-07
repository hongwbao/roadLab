import { describe, expect, it } from "vitest";
import {
  autoJunction,
  connections,
  emptyProject,
  makeRoad,
  parseProject,
  removeRoads,
  splitRoad,
  History,
} from "../src/core/model";
import { v } from "../src/core/math";
import { compileCs2Network } from "../src/simulation/cs2-network";
import { cloneJunctionLaneRules } from "../src/core/junction-lane-connections";
import { makeTrafficSignal } from "../src/core/traffic-signals";
import { buildJunctions } from "../src/core/junctions";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import { Cs2LaneSignal } from "../src/simulation/cs2-junctions";
function crossing() {
  const p = emptyProject();
  const opts = { twoWay: true, lanesStart: 2, lanesEnd: 2, speed: 60 };
  p.roads = [
    makeRoad(v(-160, 0), v(0, 0), { ...opts, id: "west" }),
    makeRoad(v(0, 0), v(160, 0), { ...opts, id: "east" }),
    makeRoad(v(0, -160), v(0, 0), { ...opts, id: "north" }),
    makeRoad(v(0, 0), v(0, 160), { ...opts, id: "south" }),
  ];
  p.ports = [];
  return p;
}
const from = { road: "west", lane: 2, end: 1 as const },
  to = { road: "east", lane: 3, end: 0 as const };
describe("integrated junction controls", () => {
  it("a custom lane pair absent from automatic mapping reaches the physical path network", () => {
    const p = crossing(),
      before = connections(p);
    expect(
      before.some(
        (c) =>
          c.from.road === from.road &&
          c.from.lane === from.lane &&
          c.to.road === to.road &&
          c.to.lane === to.lane,
      ),
    ).toBe(false);
    p.roads[0].turns = { 2: ["left"] };
    p.junctionLaneConnections = [{ from: { ...from }, to: [{ ...to }] }];
    autoJunction(p);
    const links = connections(p),
      out = links.filter((c) => c.from.road === "west" && c.from.lane === 2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      from: { road: "west", lane: 2 },
      to: { road: "east", lane: 3 },
      manual: true,
    });
    const network = compileCs2Network({
      project: p,
      connections: links,
      revision: 1,
    });
    expect(network.connectionLaneIds.has(out[0].id)).toBe(true);
    const physical = network.lanes.get(
      network.connectionLaneIds.get(out[0].id)!,
    )!;
    expect(physical.to).toEqual({ road: "east", lane: 3 });
    expect(network.successors.get(physical.id)!.length).toBeGreaterThan(0);
  });
  it("map save/reload and undo/redo retain explicit closed lanes", () => {
    let p = crossing();
    const history = new History();
    history.commit(p);
    p.junctionLaneConnections = [{ from: { ...from }, to: [] }];
    autoJunction(p);
    expect(
      connections(p).some((c) => c.from.road === "west" && c.from.lane === 2),
    ).toBe(false);
    const loaded = parseProject(JSON.stringify(p));
    expect(loaded.junctionLaneConnections).toEqual(p.junctionLaneConnections);
    expect(
      connections(loaded).some(
        (c) => c.from.road === "west" && c.from.lane === 2,
      ),
    ).toBe(false);
    p = history.undo(p)!;
    expect(
      connections(p).some((c) => c.from.road === "west" && c.from.lane === 2),
    ).toBe(true);
    p = history.redo(p)!;
    expect(p.junctionLaneConnections![0].to).toEqual([]);
  });
  it("splitting or deleting a referenced road preserves valid source restrictions", () => {
    const p = crossing();
    p.junctionLaneConnections = [{ from: { ...from }, to: [{ ...to }] }];
    const segment = splitRoad(p, "west", 0.5)!;
    expect(p.junctionLaneConnections![0].from).toEqual({
      ...from,
      road: segment,
    });
    expect(
      connections(p).some(
        (c) =>
          c.from.road === segment && c.to.road === "east" && c.to.lane === 3,
      ),
    ).toBe(true);
    removeRoads(p, new Set(["east"]));
    autoJunction(p);
    expect(p.junctionLaneConnections![0].to).toEqual([]);
    expect(
      connections(p).some((c) => c.from.road === segment && c.from.lane === 2),
    ).toBe(false);
  });
  it("road templates parse and clone the new rules independently of retired overrides", () => {
    const p = crossing();
    p.junctionLaneConnections = [{ from: { ...from }, to: [{ ...to }] }];
    p.templates = [
      {
        id: "template",
        name: "指定车道",
        roads: structuredClone(p.roads),
        connections: [],
        junctionLaneConnections: structuredClone(p.junctionLaneConnections),
      },
    ];
    const loaded = parseProject(JSON.stringify(p));
    expect(loaded.templates[0].junctionLaneConnections).toEqual(
      p.junctionLaneConnections,
    );
    const ids = new Map(p.roads.map((r) => [r.id, "copy-" + r.id]));
    const rules = cloneJunctionLaneRules(
      loaded.templates[0].junctionLaneConnections,
      ids,
    );
    expect(rules[0]).toEqual({
      from: { ...from, road: "copy-west" },
      to: [{ ...to, road: "copy-east" }],
    });
    expect(loaded.connections).toEqual([]);
  });
  it("the real engine uses all four custom phases with right turns and exact movement permissions", () => {
    const p = crossing();
    p.signals = [makeTrafficSignal(buildJunctions(p)[0])];
    expect(p.signals[0].mode).toBe("custom");
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(p);
    const controller = sim.trafficLights,
      state = controller.states[0];
    expect(state.phases).toHaveLength(4);
    const links = connections(p);
    const roads = new Map(p.roads.map((r) => [r.id, r]));
    const classify = (id: string) => {
      const link = links.find((c) => c.id === id)!;
      const source = link.from.road,
        target = link.to.road;
      const pair = `${source}>${target}`;
      const right = [
        "west>south",
        "east>north",
        "north>west",
        "south>east",
      ].includes(pair);
      const straight = [
        "west>east",
        "east>west",
        "north>south",
        "south>north",
      ].includes(pair);
      expect(roads.has(source) && roads.has(target)).toBe(true);
      return { source, turn: right ? "right" : straight ? "straight" : "left" };
    };
    for (let phase = 0; phase < 4; phase++) {
      const current = controller.states[0];
      expect(current.phase).toBe(phase);
      expect(current.stage).toBe("green");
      for (const link of links) {
        const m = classify(link.id),
          ew = m.source === "west" || m.source === "east";
        const allowed =
          m.turn === "right" ||
          (ew === phase < 2 &&
            m.turn === (phase % 2 === 0 ? "straight" : "left"));
        expect(controller.laneSignal(link.id), `${phase}: ${link.id}`).toBe(
          allowed ? Cs2LaneSignal.Go : Cs2LaneSignal.Stop,
        );
      }
      controller.update(
        current.remaining + p.signals[0].yellow + p.signals[0].allRed,
      );
    }
    sim.dispose();
  });
});
