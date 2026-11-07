import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arcTable, bezier, dist, lanePoint, v } from "../src/core/math";
import { emptyProject, makeRoad } from "../src/core/model";
import type { Connection, Project, Road } from "../src/core/types";
import {
  compileCs2Network,
  cs2NetworkPathSpecification,
  cs2PackPathNode,
  cs2ReadPathNode,
  cs2RoadLaneKey,
  cs2StripPathNodeCurve,
  type Cs2CompiledNetwork,
  type Cs2NetworkConnectionGeometry,
} from "../src/simulation/cs2-network";
import { searchCs2Path } from "../src/simulation/cs2-path-search";
import { CS2_ROAD_LANE_FLAGS as F } from "../src/simulation/cs2-road-rules";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-network-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: { kind: string; sha256: string; mvid: string };
  pathNodeCases: {
    input: Parameters<typeof cs2PackPathNode>[0];
    expected: {
      packed: string;
      owner: number;
      lane: number;
      curvePosition: number;
      secondary: boolean;
      stripped: string;
    };
  }[];
  specificationCases: {
    curve: Parameters<typeof cs2NetworkPathSpecification>[0];
    maxSpeed: number;
    input: Parameters<typeof cs2NetworkPathSpecification>[2];
    expected: ReturnType<typeof cs2NetworkPathSpecification>;
  }[];
};
const road = (
  id: string,
  x: number,
  end: number,
  options: Partial<Road> = {},
) =>
  makeRoad(v(x, 0), v(end, 0), { id, lanesStart: 2, lanesEnd: 2, ...options });
const project = (...roads: Road[]): Project => ({ ...emptyProject(), roads });
const connect = (
  id: string,
  from: string,
  lane: number,
  to: string,
  target = lane,
): Connection => ({
  id,
  from: { road: from, lane },
  to: { road: to, lane: target },
  enabled: true,
});
const physical = (network: Cs2CompiledNetwork) =>
  [...network.lanes.values()].filter((lane) => lane.role !== "master");
function search(network: Cs2CompiledNetwork, from: string, to: string) {
  return searchCs2Path(network.graph, {
    requestId: 1,
    revision: network.revision,
    seed: 1948,
    start: network.targetsForRoad(from, 1),
    end: network.targetsForRoad(to, 90),
    parameters: {
      maxSpeed: [40, 40],
      walkSpeed: [1, 1],
      weights: [1, 1, 1, 1],
      methods: 2,
      pathfindFlags: 1,
    },
  });
}

describe("direct original Game.dll network primitives", () => {
  it("retains direct-DLL provenance and exact 64-bit PathNode keys", () => {
    expect(oracle.provenance.kind).toContain("direct original DLL execution");
    expect(oracle.provenance.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.pathNodeCases).toHaveLength(320);
    for (const row of oracle.pathNodeCases) {
      const packed = cs2PackPathNode(row.input);
      expect(packed.toString(16).padStart(16, "0")).toBe(row.expected.packed);
      const { packed: _, stripped, ...expected } = row.expected;
      expect(cs2ReadPathNode(packed)).toEqual({
        ...expected,
        curvePosition: Math.fround(expected.curvePosition),
      });
      expect(cs2StripPathNodeCurve(packed).toString(16).padStart(16, "0")).toBe(
        stripped,
      );
    }
  });
  it("matches 192 actual GetCarDriveSpecification calls, including rules and flags", () => {
    expect(oracle.specificationCases).toHaveLength(192);
    for (const row of oracle.specificationCases) {
      const actual = cs2NetworkPathSpecification(
        row.curve,
        row.maxSpeed,
        row.input,
      );
      for (const property of [
        "length",
        "maxSpeed",
        "flowOffset",
        "methods",
        "flags",
        "rules",
        "accessRequirement",
        "blockageStart",
        "blockageEnd",
      ] as const)
        expect(actual[property]).toBe(row.expected[property]);
      expect(actual.density).toBeCloseTo(row.expected.density, 6);
      actual.costs.forEach((cost, i) =>
        expect(cost).toBe(Math.fround(row.expected.costs[i])),
      );
    }
  });
});

describe("one shared physical/master lane network", () => {
  it("exports masters globally, physical slaves locally, and dense search IDs", () => {
    const network = compileCs2Network({
      project: project(road("a", 0, 100)),
      connections: [],
      revision: 3,
    });
    expect(network.graph.edges).toHaveLength(1);
    expect(physical(network)).toHaveLength(2);
    const group = [...network.groups.values()][0];
    expect(network.graph.edges[0].owner).toBe(group.master);
    expect(network.lanes.get(group.master)?.role).toBe("master");
    expect(
      group.members.every((id) => network.lanes.get(id)?.role === "slave"),
    ).toBe(true);
    expect(network.graph.edges.map((edge) => edge.id)).toEqual([0]);
    expect(
      group.members.map((id) => network.curves.get(id)!.points[0].z),
    ).toEqual([-2, 2]);
    expect(network.graph.heuristicCosts.road).toEqual([0, 0, 0.01, 0]);
  });
  it("uses an actual single lane as standalone and keeps road speed in m/s", () => {
    const network = compileCs2Network({
      project: project(
        road("single", 0, 100, { lanesStart: 1, lanesEnd: 1, speed: 72 }),
      ),
      connections: [],
      revision: 1,
    });
    expect(network.lanes.size).toBe(1);
    expect(physical(network)[0].role).toBe("standalone");
    expect(network.graph.edges[0].specification.maxSpeed).toBe(20);
    expect(network.graph.edges[0].specification.flags).toBe(5);
  });
  it("treats the two directions as distinct travel-oriented lanes, not shared Twoway", () => {
    const r = road("two", 0, 100, { twoWay: true }),
      network = compileCs2Network({
        project: project(r),
        connections: [],
        revision: 1,
      });
    expect(network.graph.edges).toHaveLength(2);
    expect(physical(network)).toHaveLength(4);
    const reverse = network.lanes.get(
      network.roadLaneIds.get(cs2RoadLaneKey("two", 0))![0],
    )!;
    expect(reverse.curve.points[0].x).toBeCloseTo(100);
    expect(reverse.curve.points[3].x).toBeCloseTo(0);
    expect(network.locateRoadLane("two", 0, 25)?.curveT).toBeCloseTo(0.25);
    expect(network.locateRoadLane("two", 2, 25)?.curveT).toBeCloseTo(0.25);
    expect(
      network.graph.edges.every((edge) => edge.specification.flags === 5),
    ).toBe(true);
    expect([...network.curves.values()].every((curve) => !curve.twoway)).toBe(
      true,
    );
  });
  it("preserves lane-centre geometry on curves, elevation and nonuniform knot parameters", () => {
    const r = makeRoad(
      v(0, 0),
      v(100, 100, 12),
      { id: "curve", lanesStart: 3, lanesEnd: 3 },
      v(75, 0, 4),
      v(25, 100, 8),
    );
    const network = compileCs2Network({
      project: project(r),
      connections: [],
      revision: 1,
    });
    expect(network.warnings).toEqual([]);
    for (const lane of physical(network)) {
      const [a, b] = lane.roadInterval!;
      for (const u of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])
        expect(
          dist(
            bezier(...lane.curve.points, u),
            lanePoint(r, lane.lane!, a + (b - a) * u),
          ),
        ).toBeLessThan(0.05);
      expect(lane.curve.length).toBeGreaterThan(0);
    }
    const curved = structuredClone(r);
    curved.knots = [
      r.knots[0],
      {
        p: v(50, 40, 5),
        incoming: v(40, 30, 4),
        outgoing: v(65, 60, 6),
        at: 0.2,
      },
      r.knots[1],
    ];
    const split = compileCs2Network({
      project: project(curved),
      connections: [],
      revision: 2,
    });
    expect(
      physical(split).some((lane) => lane.roadInterval?.includes(0.2)),
    ).toBe(true);
  });
  it("honours centreline trim metres and returns no physical position beyond trimmed ends", () => {
    const network = compileCs2Network({
      project: project(road("trim", 0, 100)),
      connections: [],
      revision: 1,
      roadTrims: new Map([["trim", { start: 8, end: 12 }]]),
    });
    expect(network.locateRoadLane("trim", 0, 7)).toBeUndefined();
    expect(network.locateRoadLane("trim", 0, 8)?.curveT).toBeCloseTo(0);
    expect(network.locateRoadLane("trim", 0, 88)?.curveT).toBeCloseTo(1);
    expect(network.locateRoadLane("trim", 0, 89)).toBeUndefined();
  });
  it("uses actual enabled connections, respects forbidden turns, and never invents disconnected links", () => {
    const a = road("a", 0, 100),
      b = road("b", 110, 210),
      c = road("c", 110, 210),
      links = [
        connect("ab0", "a", 0, "b"),
        connect("ab1", "a", 1, "b"),
        { ...connect("ac", "a", 1, "c"), enabled: false },
      ],
      p = project(a, b, c);
    p.connections = [connect("hidden", "a", 0, "c")];
    const network = compileCs2Network({
      project: p,
      connections: links,
      revision: 1,
    });
    expect(network.connectionLaneIds.size).toBe(2);
    expect(search(network, "a", "b").status).toBe("found");
    expect(search(network, "a", "c").status).toBe("unreachable");
    expect(network.graph.edges.length).toBe(network.groups.size);
    expect(
      network.graph.edges.filter(
        (edge) => network.lanes.get(edge.owner)!.kind === "connection",
      ),
    ).toHaveLength(1);
  });
  it("shares the same physical Connection among path DP and motion continuation", () => {
    const network = compileCs2Network({
      project: project(road("a", 0, 100), road("b", 110, 210)),
      connections: [connect("ab0", "a", 0, "b"), connect("ab1", "a", 1, "b")],
      revision: 4,
    });
    const result = search(network, "a", "b");
    expect(result.status).toBe("found");
    const groups = network.groupsForPath(result.steps);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.laneIds.length)).toEqual([2, 2, 2]);
    expect(groups[0].navigation.lanes.map((lane) => lane.next)).toEqual([
      [0],
      [1],
    ]);
    expect(groups[1].navigation.lanes.map((lane) => lane.next)).toEqual([
      [0],
      [1],
    ]);
    const old = groups[0].laneIds[0],
      requested = groups[1].laneIds[1],
      continuing = groups[1].laneIds[0];
    expect(network.nextLane(old, requested)).toBe(continuing);
    expect(network.nextLane(old, groups[2].laneIds[0])).toBeNull();
    expect(groups[1].navigation.allowChange).toBe(false);
    expect(groups[1].navigation.fixed).toBeUndefined();
  });
  it("accepts the exact caller connector and original Net flags without confusing vehicle flags", () => {
    const p = project(road("a", 0, 100), road("b", 110, 210)),
      c = connect("ab", "a", 0, "b"),
      points = [v(100, -2), v(103, -2), v(107, -2), v(110, -2)] as const,
      geometry: Cs2NetworkConnectionGeometry = {
        points,
        length: 10,
        width: 3.2,
        widthOffset: [0.4, 0.2],
        laneFlags: F.unsafe | F.forbidPassing | F.highway,
        junction: "j",
      },
      network = compileCs2Network({
        project: p,
        connections: [c],
        revision: 1,
        connectionGeometry: new Map([["ab", geometry]]),
      }),
      lane = network.lanes.get(network.connectionLaneIds.get("ab")!)!;
    expect(lane.curve.points).toEqual(points);
    expect(lane.curve.widthOffset).toEqual([0.4, 0.2]);
    expect(lane.junction).toBe("j");
    expect(lane.laneFlags).toBe(F.unsafe | F.forbidPassing | F.highway);
    const edge = network.graph.edges.find((edge) => edge.owner === lane.id)!;
    expect(edge.specification.flags).toBe(1);
    expect(edge.specification.rules & 32).toBe(32);
    expect(network.warnings).toEqual([]);
  });
  it("supports 2→3 lanes and an actual outer-lane 2+1 ramp split", () => {
    const a = road("a", 0, 150, { lanesEnd: 3 }),
      b = road("b", 165, 265),
      ramp = makeRoad(v(165, 7), v(265, 70), {
        id: "ramp",
        lanesStart: 1,
        lanesEnd: 1,
        kind: "ramp",
        highwayRules: true,
      }),
      network = compileCs2Network({
        project: project(a, b, ramp),
        connections: [
          connect("main0", "a", 0, "b"),
          connect("main1", "a", 1, "b"),
          connect("off", "a", 2, "ramp", 0),
        ],
        revision: 1,
      });
    expect(network.locateRoadLane("a", 2, 1)).toBeUndefined();
    expect(network.locateRoadLane("a", 2, 149)).toBeDefined();
    expect(network.connectionLaneIds.has("off")).toBe(true);
    expect(search(network, "a", "ramp").status).toBe("found");
    for (const lane of physical(network).filter((lane) => lane.road === "a"))
      expect(
        lane.curve.width + Math.min(...lane.curve.widthOffset!),
      ).toBeGreaterThanOrEqual(a.width * 0.8 - 0.000001);
    const rampLane = network.lanes.get(network.connectionLaneIds.get("off")!)!;
    expect(rampLane.to).toEqual({ road: "ramp", lane: 0 });
    expect(rampLane.curve.twoway).toBeUndefined();
  });
  it("gives deterministic persistent lane IDs across reload, input ordering and revisions", () => {
    const a = road("a", 0, 100),
      b = road("b", 110, 210),
      links = [connect("1", "a", 0, "b"), connect("2", "a", 1, "b")],
      one = compileCs2Network({
        project: project(a, b),
        connections: links,
        revision: 2,
      }),
      two = compileCs2Network({
        project: project(structuredClone(b), structuredClone(a)),
        connections: [...links].reverse(),
        revision: 9,
      });
    expect([...one.lanes.keys()]).toEqual([...two.lanes.keys()]);
    expect(one.graph.edges).toEqual(two.graph.edges);
    expect(() =>
      two.groupsForPath([{ edge: 0, owner: "outdated-id", delta: [0, 1] }]),
    ).toThrow("Stale");
  });
  it("does not connect a lane that disappears before a road endpoint", () => {
    const a = road("a", 0, 100, { lanesStart: 3, lanesEnd: 2 }),
      b = road("b", 110, 210),
      network = compileCs2Network({
        project: project(a, b),
        connections: [connect("invalid", "a", 2, "b", 0)],
        revision: 1,
      });
    expect(network.connectionLaneIds.size).toBe(0);
    expect(
      network.warnings.some((warning) =>
        warning.includes("fades before endpoint"),
      ),
    ).toBe(true);
    expect(search(network, "a", "b").status).toBe("unreachable");
  });
  it("converts travel distance with the same centreline arc table used by the existing model", () => {
    const r = road("dist", 0, 100),
      network = compileCs2Network({
        project: project(r),
        connections: [],
        revision: 1,
      });
    expect(
      network.locateRoadLane("dist", 0, arcTable(r).at(-1)!.s)?.roadT,
    ).toBeCloseTo(1);
    expect(network.targetsForRoad("dist", 50)).toHaveLength(1);
    expect(network.targetsForRoad("dist", 50, 1)[0].target).toBe(
      network.locateRoadLane("dist", 1, 50)!.laneId,
    );
  });
  it("reads automatic taper widths/offsets and orders node slaves by physical lanes rather than IDs", () => {
    const a = road("a", 0, 100, {
        autoTaper: {
          start: { lanes: 1, firstLane: 1, offset: 1.8, span: 0.25 },
        },
      }),
      b = road("b", 110, 210),
      network = compileCs2Network({
        project: project(a, b),
        connections: [
          connect("z-physical-first", "a", 0, "b"),
          connect("a-physical-second", "a", 1, "b"),
        ],
        revision: 1,
      });
    expect(network.locateRoadLane("a", 0, 1)).toBeUndefined();
    expect(network.locateRoadLane("a", 1, 1)).toBeDefined();
    expect(network.locateRoadLane("a", 0, 99)).toBeDefined();
    const node = [...network.groups.values()].find(
      (group) => group.kind === "connection",
    )!;
    expect(node.members.map((id) => network.lanes.get(id)!.from!.lane)).toEqual(
      [0, 1],
    );
    expect(search(network, "a", "b").status).toBe("found");
    expect(
      (network.curves.get(node.master) as { isMaster?: boolean }).isMaster,
    ).toBe(true);
  });
});
