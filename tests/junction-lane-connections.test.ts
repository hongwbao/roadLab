import { describe, expect, it } from "vitest";
import { buildJunctions } from "../src/core/junctions";
import { add, dist, mul, v } from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  History,
  makeRoad,
  parseProject,
  removeRoads,
  splitRoad,
} from "../src/core/model";
import { makeTrafficSignal } from "../src/core/traffic-signals";
import {
  applyJunctionLaneRules,
  cloneJunctionLaneRules,
  junctionLaneCandidates,
  junctionLaneKey,
  junctionLaneLayout,
  junctionLanePorts,
  mirrorJunctionLaneRules,
  normalizeJunctionLaneRules,
  restoreJunctionLaneRule,
  restoreJunctionLaneRules,
  setJunctionLaneRule,
  validateJunctionLaneRules,
  type JunctionLaneEndpoint,
} from "../src/core/junction-lane-connections";
import type { Project } from "../src/core/types";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";

const ref = (road: string, lane: number, end: 0 | 1): JunctionLaneEndpoint => ({
  road,
  lane,
  end,
});
const from = ref("west", 2, 1),
  straight = ref("east", 3, 0),
  left = ref("north", 0, 1),
  right = ref("south", 3, 0);
function crossing(): Project {
  const p = emptyProject(),
    options = { lanesStart: 2, lanesEnd: 2, twoWay: true, width: 3.6 };
  p.roads = [
    makeRoad(v(-120, 0), v(), { ...options, id: "west" }),
    makeRoad(v(), v(120, 0), { ...options, id: "east" }),
    makeRoad(v(0, -120), v(), { ...options, id: "north" }),
    makeRoad(v(), v(0, 120), { ...options, id: "south" }),
  ];
  p.ports = [];
  return p;
}
const sourceLinks = (p: Project) =>
  connections(p).filter(
    (c) => c.from.road === from.road && c.from.lane === from.lane,
  );
describe("junction lane destination rules", () => {
  it("does no extra topology work for an ordinary map with no overrides", () => {
    const p = crossing(),
      automatic = connections(p);
    expect(applyJunctionLaneRules(p, automatic)).toBe(automatic);
  });
  it("enumerates every legal lane pair rather than only the automatic closest lane", () => {
    const p = crossing(),
      junction = buildJunctions(p)[0],
      ports = junctionLanePorts(p, junction),
      candidates = junctionLaneCandidates(p, junction);
    expect(ports.filter((p) => p.kind === "in")).toHaveLength(8);
    expect(ports.filter((p) => p.kind === "out")).toHaveLength(8);
    expect(candidates).toHaveLength(48);
    expect(candidates.some((c) => c.id === "west:2>east:3")).toBe(true);
    expect(connections(p).some((c) => c.id === "west:2>east:3")).toBe(false);
    expect(candidates.every((c) => c.from.road !== c.to.road)).toBe(true);
  });
  it("replaces all automatic destinations for one source and preserves every other source", () => {
    const p = crossing(),
      automatic = connections(p),
      other = automatic.filter(
        (c) => !(c.from.road === "west" && c.from.lane === 2),
      );
    setJunctionLaneRule(p, from, [straight]);
    expect(sourceLinks(p)).toEqual([
      {
        id: "west:2>east:3",
        from: { road: "west", lane: 2 },
        to: { road: "east", lane: 3 },
        enabled: true,
        manual: true,
      },
    ]);
    expect(
      connections(p).filter(
        (c) => !(c.from.road === "west" && c.from.lane === 2),
      ),
    ).toEqual(other);
  });
  it("supports several exits from one lane and canonicalizes duplicate target clicks", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, [straight, left, right, straight]);
    expect(sourceLinks(p).map((c) => c.to)).toEqual([
      { road: "east", lane: 3 },
      { road: "north", lane: 0 },
      { road: "south", lane: 3 },
    ]);
    expect(p.junctionLaneConnections![0].to).toHaveLength(3);
  });
  it("keeps an explicit empty allowlist closed after save, reload and normalization", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, []);
    autoJunction(p);
    expect(sourceLinks(p)).toHaveLength(0);
    const restored = parseProject(JSON.stringify(p));
    expect(restored.junctionLaneConnections).toEqual([{ from, to: [] }]);
    expect(sourceLinks(restored)).toHaveLength(0);
  });
  it("manual target selection overrides the previous broad turn-direction rule", () => {
    const p = crossing();
    p.roads[0].turns = { 2: ["left"] };
    expect(sourceLinks(p).every((c) => c.to.road === "north")).toBe(true);
    setJunctionLaneRule(p, from, [straight]);
    expect(sourceLinks(p).map((c) => c.to.road)).toEqual(["east"]);
  });
  it("restores only the selected lane or all selected-junction sources", () => {
    const p = crossing(),
      automatic = connections(p);
    setJunctionLaneRule(p, from, []);
    setJunctionLaneRule(p, ref("west", 3, 1), []);
    restoreJunctionLaneRule(p, from);
    expect(sourceLinks(p)).toEqual(
      automatic.filter((c) => c.from.road === "west" && c.from.lane === 2),
    );
    expect(
      connections(p).some((c) => c.from.road === "west" && c.from.lane === 3),
    ).toBe(false);
    restoreJunctionLaneRules(p, buildJunctions(p)[0]);
    expect(p.junctionLaneConnections).toBeUndefined();
    expect(connections(p)).toEqual(automatic);
  });
  it("rejects a same-road U turn and an incoming target without mutating rules", () => {
    const p = crossing();
    expect(() => setJunctionLaneRule(p, from, [ref("west", 0, 1)])).toThrow(
      /无法.*连接/,
    );
    expect(() => setJunctionLaneRule(p, from, [ref("north", 2, 1)])).toThrow(
      /无法.*连接/,
    );
    expect(p.junctionLaneConnections).toBeUndefined();
  });
  it("does not connect a valid endpoint at another junction", () => {
    const p = crossing();
    p.roads.push(
      makeRoad(v(500, 0), v(600, 0), {
        id: "remote",
        lanesStart: 1,
        lanesEnd: 1,
      }),
    );
    expect(() => setJunctionLaneRule(p, from, [ref("remote", 0, 0)])).toThrow(
      /无法.*连接/,
    );
  });
  it("honours physical lane attachments instead of creating unreachable cross-group links", () => {
    const p = crossing();
    p.roads[0].attachments = {
      end: { road: "east", end: 0, ownLanes: [2], lanes: [2] },
    };
    const candidates = junctionLaneCandidates(p, buildJunctions(p)[0]).filter(
      (c) => c.from.road === "west" && c.from.lane === 2,
    );
    expect(candidates.map((c) => c.to.lane)).toEqual([2]);
    expect(() => setJunctionLaneRule(p, from, [straight])).toThrow(
      /无法.*连接/,
    );
  });
  it("keeps rules through original end-preserving automatic splits", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, [straight]);
    const endRoad = splitRoad(p, "west", 0.5)!;
    expect(endRoad).toBeTruthy();
    expect(p.junctionLaneConnections![0].from).toEqual({
      ...from,
      road: endRoad,
    });
    expect(
      connections(p).some(
        (c) =>
          c.from.road === endRoad &&
          c.from.lane === 2 &&
          c.to.road === "east" &&
          c.to.lane === 3,
      ),
    ).toBe(true);
  });
  it("removes deleted road references while retaining an intentional closed source", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, [straight, left]);
    removeRoads(p, new Set(["east"]));
    autoJunction(p);
    expect(p.junctionLaneConnections![0].to).toEqual([left]);
    expect(sourceLinks(p).map((c) => c.to)).toEqual([
      { road: "north", lane: 0 },
    ]);
    removeRoads(p, new Set(["west"]));
    autoJunction(p);
    expect(p.junctionLaneConnections).toBeUndefined();
  });
  it("cleans rules whose source lane vanishes on a road upgrade", () => {
    const p = crossing();
    setJunctionLaneRule(p, ref("west", 3, 1), [straight]);
    p.roads[0].lanesStart = p.roads[0].lanesEnd = 1;
    normalizeJunctionLaneRules(p);
    expect(p.junctionLaneConnections).toBeUndefined();
  });
  it("cleans targets that no longer belong to the source junction", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, [straight, left]);
    for (const knot of p.roads[1].knots)
      for (const key of ["p", "incoming", "outgoing"] as const)
        knot[key].x += 200;
    normalizeJunctionLaneRules(p);
    expect(p.junctionLaneConnections![0].to).toEqual([left]);
  });
  it("clones complete rules with new road IDs and excludes external references", () => {
    const rules = [
      { from, to: [straight, left] },
      { from: ref("south", 0, 1), to: [] },
    ];
    const ids = new Map([
      ["west", "w2"],
      ["east", "e2"],
      ["north", "n2"],
      ["south", "s2"],
    ]);
    const cloned = cloneJunctionLaneRules(rules, ids);
    expect(cloned[0]).toEqual({
      from: ref("w2", 2, 1),
      to: [ref("e2", 3, 0), ref("n2", 0, 1)],
    });
    expect(cloned[1].to).toEqual([]);
    expect(cloneJunctionLaneRules(rules, new Map([["west", "w2"]]))).toEqual(
      [],
    );
    cloned[0].to[0].lane = 0;
    expect(rules[0].to[0].lane).toBe(3);
  });
  it("mirrors only selected single-direction lane indices", () => {
    const p = crossing();
    p.roads.push(
      makeRoad(v(500, 0), v(600, 0), {
        id: "oneway",
        lanesStart: 3,
        lanesEnd: 3,
      }),
    );
    p.junctionLaneConnections = [
      { from: ref("oneway", 0, 1), to: [straight] },
      { from, to: [] },
    ];
    mirrorJunctionLaneRules(p, [p.roads[4], p.roads[0]]);
    expect(p.junctionLaneConnections[0].from.lane).toBe(2);
    expect(p.junctionLaneConnections[1].from.lane).toBe(2);
  });
  it("retains rules in undo and redo snapshots", () => {
    const p = crossing(),
      history = new History();
    history.commit(p);
    setJunctionLaneRule(p, from, [straight]);
    const previous = history.undo(p)!;
    expect(previous.junctionLaneConnections).toBeUndefined();
    expect(history.redo(previous)!.junctionLaneConnections).toEqual([
      { from, to: [straight] },
    ]);
  });
  it.each([NaN, -1, 99, 1.5])(
    "rejects invalid lane index %s in imported rules",
    (lane) => {
      const p = crossing();
      p.junctionLaneConnections = [{ from: { ...from, lane }, to: [straight] }];
      expect(() => validateJunctionLaneRules(p)).toThrow();
    },
  );
  it("rejects duplicate or wrong-direction sources and destinations", () => {
    const p = crossing();
    p.junctionLaneConnections = [{ from, to: [straight, straight] }];
    expect(() => validateJunctionLaneRules(p)).toThrow("重复");
    p.junctionLaneConnections = [
      { from, to: [] },
      { from, to: [] },
    ];
    expect(() => validateJunctionLaneRules(p)).toThrow("重复");
    p.junctionLaneConnections = [{ from: { ...from, end: 0 }, to: [] }];
    expect(() => validateJunctionLaneRules(p)).toThrow("不合法");
  });
  it("old maps still load without manual rules or changes to automatic routing", () => {
    const p = crossing(),
      restored = parseProject(JSON.stringify(p));
    expect(restored.junctionLaneConnections).toBeUndefined();
    expect(connections(restored)).toEqual(connections(p));
  });
});
describe("smooth lane overlay and actual source simulation topology", () => {
  it("uses continuous tangent-aligned cubic curves at the junction trim", () => {
    const p = crossing(),
      layout = junctionLaneLayout(p, buildJunctions(p)[0], connections(p));
    for (const link of layout.links) {
      expect(link.samples[0]).toEqual(link.from.position);
      expect(link.samples.at(-1)).toEqual(link.to.position);
      const span = dist(link.from.position, link.to.position) * 0.45;
      expect(link.points[1]).toEqual(
        add(link.from.position, mul(link.from.direction, span)),
      );
      expect(link.points[2]).toEqual(
        add(link.to.position, mul(link.to.direction, -span)),
      );
      expect(link.samples).toHaveLength(49);
    }
  });
  it("moves lane connection endpoints to the real signal stop-line trim", () => {
    const p = crossing(),
      junction = buildJunctions(p)[0],
      before = junctionLanePorts(p, junction);
    p.signals = [makeTrafficSignal(junction)];
    const after = junctionLanePorts(p, junction);
    for (let i = 0; i < before.length; i++)
      expect(dist(before[i].position, after[i].position)).toBeCloseTo(4.5, 7);
  });
  it("compiles a previously unavailable target lane into the actual driving/pathfinding network", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, [straight]);
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(p);
    expect(sim.network!.connectionLaneIds.has("west:2>east:3")).toBe(true);
    expect(sim.network!.connectionLaneIds.has("west:2>east:2")).toBe(false);
    const lane = sim.network!.lanes.get(
        sim.network!.connectionLaneIds.get("west:2>east:3")!,
      )!,
      link = junctionLaneCandidates(p, buildJunctions(p)[0]).find(
        (c) => c.id === "west:2>east:3",
      )!;
    for (let i = 0; i < 4; i++)
      for (const axis of ["x", "y", "z"] as const)
        expect(lane.curve.points[i][axis]).toBeCloseTo(link.points[i][axis], 4);
    sim.dispose();
  });
  it("a closed source creates no phantom connection lanes in the real simulation", () => {
    const p = crossing();
    setJunctionLaneRule(p, from, []);
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(p);
    expect(
      [...sim.network!.connectionLaneIds.keys()].filter((id) =>
        id.startsWith("west:2>"),
      ),
    ).toEqual([]);
    expect(
      [...sim.network!.connectionLaneIds.keys()].some((id) =>
        id.startsWith("west:3>"),
      ),
    ).toBe(true);
    sim.dispose();
  });
  it("screen port keys distinguish both directions at the same road endpoint", () => {
    const p = crossing(),
      ports = junctionLanePorts(p, buildJunctions(p)[0]);
    expect(new Set(ports.map((p) => p.key)).size).toBe(ports.length);
    expect(
      ports.some((p) => p.key === junctionLaneKey(from) && p.kind === "in"),
    ).toBe(true);
    expect(
      ports.some((p) => p.road === "west" && p.end === 1 && p.kind === "out"),
    ).toBe(true);
  });
});
