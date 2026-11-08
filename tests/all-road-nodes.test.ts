import { describe, expect, it } from "vitest";
import {
  buildLaneJunctions,
  isLaneJunctionEditable,
  laneJunctionTrims,
} from "../src/core/lane-junctions";
import { buildJunctions } from "../src/core/junctions";
import {
  junctionLaneCandidates,
  junctionLaneLayout,
  junctionLanePorts,
  normalizeJunctionLaneRules,
  remapReverseJunctionLaneRules,
  restoreJunctionLaneRule,
  setJunctionLaneRule,
} from "../src/core/junction-lane-connections";
import {
  autoJunction,
  connections,
  emptyProject,
  History,
  makeRoad,
  parseProject,
  reverseRoad,
  splitRoad,
} from "../src/core/model";
import {
  dist,
  laneCount,
  laneDirection,
  laneEntryT,
  laneExitT,
  lanePoint,
  laneWidth,
  mul,
  tangent,
  v,
} from "../src/core/math";
import { segmentRoads } from "../src/core/road-segments";
import { addRoadsideLanes } from "../src/core/road-sections";
import { removeRoadsideLanes } from "../src/core/road-upgrades";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import type { Road } from "../src/core/types";

const ref = (road: string, lane: number, end: 0 | 1) => ({ road, lane, end });
function seam(a: Partial<Road> = {}, b: Partial<Road> = {}) {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-120, 0), v(), { id: "a", width: 4, ...a }),
    makeRoad(v(), v(120, 0), { id: "b", width: 4, ...b }),
  ];
  return p;
}

describe("all connected road nodes", () => {
  it.each([
    ["ordinary", {}, {}],
    ["2 to 3", {}, { lanesStart: 3, lanesEnd: 3 }],
    ["two-way", { twoWay: true }, { twoWay: true }],
    [
      "asymmetric median and offset",
      { twoWay: true, backwardLanesStart: 3, backwardLanesEnd: 3 },
      {
        twoWay: true,
        lanesStart: 3,
        lanesEnd: 3,
        backwardLanesStart: 2,
        backwardLanesEnd: 2,
        sectionOffset: 2,
        median: { kind: "concrete", width: 2 },
      },
    ],
  ] as const)(
    "exposes %s seams without creating physical junctions",
    (_, a, b) => {
      const p = seam(a, b),
        [node] = buildLaneJunctions(p);
      expect(buildLaneJunctions(p)).toHaveLength(1);
      expect(node.kind).toBe("continuation");
      expect(isLaneJunctionEditable(node)).toBe(true);
      expect(buildJunctions(p)).toEqual([]);
      const ports = junctionLanePorts(p, node),
        candidates = junctionLaneCandidates(p, node);
      expect(ports).toHaveLength(laneCount(p.roads[0]) + laneCount(p.roads[1]));
      expect(candidates.length).toBeGreaterThan(0);
      for (const port of ports) {
        const road = p.roads.find((r) => r.id === port.road)!;
        expect(
          port.kind === "in"
            ? laneExitT(road, port.lane)
            : laneEntryT(road, port.lane),
        ).toBe(port.end);
      }
      for (const link of candidates) {
        expect(link.from.kind).toBe("in");
        expect(link.to.kind).toBe("out");
        expect(link.from.road).not.toBe(link.to.road);
        expect(link.from.end === 1).toBe(link.to.end === 0);
      }
      expect(new Set(ports.map((port) => port.name)).size).toBe(ports.length);
      expect(
        Math.min(
          ...ports
            .filter((port) => port.road === "a")
            .flatMap((a) =>
              ports
                .filter((port) => port.road === "b")
                .map((b) => dist(a.position, b.position)),
            ),
        ),
      ).toBeGreaterThan(5);
      const base = new Map(p.roads.map((r) => [r.id, { start: 0, end: 0 }]));
      setJunctionLaneRule(p, candidates[0].from, [candidates[0].to]);
      expect(laneJunctionTrims(p, base)).toEqual(base);
      expect(buildJunctions(p)).toEqual([]);
    },
  );

  it("includes physical two-arm corners and respects both driving directions", () => {
    const p = seam({ twoWay: true }, { twoWay: true });
    p.roads[1] = makeRoad(v(), v(0, 120), { id: "b", width: 4, twoWay: true });
    const [node] = buildLaneJunctions(p);
    expect(node.kind).toBeUndefined();
    expect(node.arms).toHaveLength(2);
    expect(isLaneJunctionEditable(node)).toBe(true);
    const candidates = junctionLaneCandidates(p, node);
    expect(candidates).toHaveLength(8);
    setJunctionLaneRule(p, ref("a", 2, 1), [ref("b", 3, 0)]);
    setJunctionLaneRule(p, ref("b", 0, 0), [ref("a", 1, 1)]);
    expect(
      connections(p)
        .filter((c) => c.manual)
        .map((c) => c.id),
    ).toEqual(["a:2>b:3", "b:0>a:1"]);
  });

  it.each([
    [1, 0],
    [0.8, 0.49],
  ])(
    "recovers real offset lane ends at lateral %sm and height %sm, even when every source is closed",
    (offset, height) => {
      const p = seam();
      p.roads[1] = makeRoad(v(0, offset, height), v(120, offset, height), {
        id: "b",
        width: 4,
      });
      const automatic = connections(p);
      expect(automatic.map((c) => c.id)).toEqual(["a:0>b:0", "a:1>b:1"]);
      const [node] = buildLaneJunctions(p),
        base = new Map(p.roads.map((r) => [r.id, { start: 0, end: 0 }]));
      expect(buildLaneJunctions(p)).toHaveLength(1);
      expect(node.kind).toBe("continuation");
      expect(buildJunctions(p)).toEqual([]);
      expect(junctionLaneCandidates(p, node)).toHaveLength(4);
      for (const from of junctionLanePorts(p, node).filter(
        (p) => p.kind === "in",
      ))
        setJunctionLaneRule(p, from, []);
      expect(connections(p)).toEqual([]);
      expect(buildLaneJunctions(p)[0].id).toBe(node.id);
      expect(laneJunctionTrims(p, base)).toEqual(base);
      restoreJunctionLaneRule(p, ref("a", 0, 1));
      expect(connections(p).map((c) => c.id)).toEqual(["a:0>b:0"]);
      setJunctionLaneRule(p, ref("a", 0, 1), [ref("b", 1, 0)]);
      const saved = parseProject(JSON.stringify(p));
      expect(saved.junctionLaneConnections).toEqual(p.junctionLaneConnections);
      expect(laneJunctionTrims(saved, base)).toEqual(base);
      const sim = new Cs2TrafficSimulation({
        synchronousPathsOnlyForTests: true,
      });
      sim.configure(saved);
      expect([...sim.network!.connectionLaneIds.keys()]).toEqual(["a:0>b:1"]);
      expect(sim.junctions).toEqual([]);
      sim.dispose();
    },
  );

  it.each([
    ["parallel road interiors", v(-80, 1), v(0, 1)],
    ["longitudinal gap", v(1, 1), v(81, 1)],
    ["different height", v(0, 0.8, 0.51), v(80, 0.8, 0.51)],
    ["opposite travel", v(0, 1), v(-80, 1)],
    ["disjoint pavement", v(0, 11), v(80, 11)],
  ] as const)("does not recover %s as a lateral seam", (_, start, end) => {
    const p = emptyProject();
    p.roads = [
      makeRoad(v(-80, 0), v(), { id: "a", width: 4 }),
      makeRoad(start, end, { id: "b", width: 4 }),
    ];
    expect(buildLaneJunctions(p)).toEqual([]);
  });

  it.each([0.49, 0.51, 0.6])(
    "uses the live 0.5m height boundary at %sm, including a short graded arm",
    (height) => {
      const p = seam();
      p.roads[1] = makeRoad(v(0, 0, height), v(0, 6, height + 1.5), {
        id: "b",
        width: 4,
      });
      // Pavement's independent 0.65m grouping remains unchanged.
      expect(buildJunctions(p)).toHaveLength(1);
      if (height <= 0.5) {
        const [node] = buildLaneJunctions(p);
        expect(buildLaneJunctions(p)).toHaveLength(1);
        expect(junctionLaneCandidates(p, node).length).toBeGreaterThan(0);
        expect(connections(p).length).toBeGreaterThan(0);
        setJunctionLaneRule(p, ref("a", 0, 1), [ref("b", 1, 0)]);
        expect(connections(p).some((c) => c.id === "a:0>b:1" && c.manual)).toBe(
          true,
        );
      } else {
        expect(buildLaneJunctions(p)).toEqual([]);
        expect(connections(p)).toEqual([]);
        expect(() => setJunctionLaneRule(p, ref("a", 0, 1), [])).toThrow(
          "失效",
        );
      }
    },
  );

  it("excludes elevated crossings, nearby endpoints, road interiors and isolated loop ends", () => {
    const p = seam();
    p.roads[1] = makeRoad(v(0, 0, 8), v(120, 0, 8), { id: "b", width: 4 });
    p.roads.push(makeRoad(v(-60, -60), v(-60, 60), { id: "cross", width: 4 }));
    expect(buildLaneJunctions(p)).toEqual([]);
    p.roads[1] = makeRoad(v(1, 0), v(120, 0), { id: "b", width: 4 });
    expect(buildLaneJunctions(p)).toEqual([]);
    p.roads = [
      makeRoad(v(), v(), { id: "loop", width: 4 }, v(80, -80), v(-80, -80)),
    ];
    expect(buildLaneJunctions(p)).toEqual([]);
    expect(() => setJunctionLaneRule(p, ref("loop", 0, 1), [])).toThrow("失效");
  });

  it("edits every automatic split and preserves rules at both original ends", () => {
    const p = seam({ twoWay: true }, { twoWay: true });
    p.roads[0] = makeRoad(v(-480, 0), v(), { id: "a", width: 4, twoWay: true });
    setJunctionLaneRule(p, ref("a", 2, 1), [ref("b", 3, 0)]);
    setJunctionLaneRule(p, ref("b", 0, 0), [ref("a", 1, 1)]);
    const ids = segmentRoads(p, new Set(["a"])).get("a")!;
    expect(ids).toHaveLength(4);
    expect(buildJunctions(p)).toEqual([]);
    const nodes = buildLaneJunctions(p);
    expect(nodes).toHaveLength(4);
    expect(nodes.every((n) => n.kind === "continuation")).toBe(true);
    expect(p.junctionLaneConnections).toEqual([
      { from: ref(ids[3], 2, 1), to: [ref("b", 3, 0)] },
      { from: ref("b", 0, 0), to: [ref(ids[3], 1, 1)] },
    ]);
    for (let i = 0; i < ids.length - 1; i++) {
      setJunctionLaneRule(p, ref(ids[i], 2, 1), [ref(ids[i + 1], 3, 0)]);
      expect(
        connections(p).some(
          (c) => c.id === `${ids[i]}:2>${ids[i + 1]}:3` && c.manual,
        ),
      ).toBe(true);
    }
    normalizeJunctionLaneRules(p);
    expect(p.junctionLaneConnections).toHaveLength(5);
  });

  it("allows one-to-many, many-to-one, closure, save/reload and undo/redo on an ordinary seam", () => {
    const p = seam({}, { lanesStart: 3, lanesEnd: 3 }),
      original = connections(p),
      history = new History();
    history.commit(p);
    setJunctionLaneRule(p, ref("a", 0, 1), [ref("b", 1, 0), ref("b", 2, 0)]);
    setJunctionLaneRule(p, ref("a", 1, 1), [ref("b", 1, 0)]);
    expect(connections(p).filter((c) => c.manual)).toHaveLength(3);
    const beforeSplit = parseProject(JSON.stringify(p));
    expect(connections(beforeSplit)).toEqual(connections(p));
    const undo = history.undo(p)!;
    expect(connections(undo)).toEqual(original);
    expect(history.redo(undo)!.junctionLaneConnections).toEqual(
      p.junctionLaneConnections,
    );
    const end = splitRoad(p, "b", 0.5)!;
    expect(end).toBeTruthy();
    expect(p.junctionLaneConnections).toEqual(
      beforeSplit.junctionLaneConnections,
    );
    setJunctionLaneRule(p, ref("a", 0, 1), []);
    const restored = parseProject(JSON.stringify(p));
    expect(restored.junctionLaneConnections![0].to).toEqual([]);
    expect(
      connections(restored).filter(
        (c) => c.from.road === "a" && c.from.lane === 0,
      ),
    ).toEqual([]);
    restoreJunctionLaneRule(restored, ref("a", 0, 1));
    expect(
      connections(restored).some(
        (c) => c.from.road === "a" && c.from.lane === 0,
      ),
    ).toBe(true);
  });

  it("rejects incoming targets and remote/grade-separated sources without changing rules", () => {
    const p = seam({ twoWay: true }, { twoWay: true });
    p.roads.push(
      makeRoad(v(0, 0, 8), v(120, 0, 8), {
        id: "bridge",
        width: 4,
        twoWay: true,
      }),
    );
    expect(() =>
      setJunctionLaneRule(p, ref("a", 2, 1), [ref("b", 0, 0)]),
    ).toThrow("无法");
    expect(() =>
      setJunctionLaneRule(p, ref("a", 2, 1), [ref("bridge", 2, 0)]),
    ).toThrow("无法");
    expect(() => setJunctionLaneRule(p, ref("bridge", 2, 1), [])).toThrow(
      "失效",
    );
    expect(p.junctionLaneConnections).toBeUndefined();
  });

  it("compiles an ordinary authored lane pair and closure into actual network successors without physical junctions", () => {
    const p = seam(),
      [node] = buildLaneJunctions(p);
    setJunctionLaneRule(p, ref("a", 0, 1), [ref("b", 1, 0)]);
    setJunctionLaneRule(p, ref("a", 1, 1), []);
    const layout = junctionLaneLayout(p, node, connections(p));
    expect(layout.links.map((l) => l.id)).toEqual(["a:0>b:1"]);
    const sim = new Cs2TrafficSimulation({
      synchronousPathsOnlyForTests: true,
    });
    sim.configure(p);
    expect(sim.junctions).toEqual([]);
    expect([...sim.network!.connectionLaneIds.keys()]).toEqual(["a:0>b:1"]);
    const id = sim.network!.connectionLaneIds.get("a:0>b:1")!;
    expect(
      [...sim.network!.successors.values()].some((rows) => rows.includes(id)),
    ).toBe(true);
    expect(
      sim.network!.warnings.filter((w) => w.includes("endpoint mismatch")),
    ).toEqual([]);
    sim.dispose();
  });
});

describe("ordinary seam rule identity during road edits", () => {
  const options: Partial<Road> = {
    width: 4,
    twoWay: true,
    lanesStart: 3,
    lanesEnd: 3,
    backwardLanesStart: 2,
    backwardLanesEnd: 2,
    median: { kind: "concrete", width: 2 },
    sectionOffset: 1,
  };
  it.each([[[0]], [[1]], [[0, 1]]] as const)(
    "preserves physical lanes when reversing road indices %j",
    (indices) => {
      const p = seam(options, options);
      setJunctionLaneRule(p, ref("a", 2, 1), [ref("b", 4, 0)]);
      setJunctionLaneRule(p, ref("b", 0, 0), [ref("a", 1, 1)]);
      setJunctionLaneRule(p, ref("a", 3, 1), []);
      const selected = indices.map((i) => p.roads[i]),
        before = p
          .junctionLaneConnections!.flatMap((r) => [r.from, ...r.to])
          .map((r) => {
            const road = p.roads.find((road) => road.id === r.road)!;
            return {
              point: lanePoint(road, r.lane, r.end),
              dir: mul(tangent(road, r.end), laneDirection(road, r.lane)),
            };
          });
      remapReverseJunctionLaneRules(p, selected);
      selected.forEach(reverseRoad);
      autoJunction(p);
      expect(p.junctionLaneConnections).toHaveLength(3);
      expect(p.junctionLaneConnections![2].to).toEqual([]);
      p.junctionLaneConnections!.flatMap((r) => [r.from, ...r.to]).forEach(
        (ref, i) => {
          const road = p.roads.find((r) => r.id === ref.road)!;
          expect(
            dist(lanePoint(road, ref.lane, ref.end), before[i].point),
          ).toBeLessThan(1e-6);
          const dir = mul(
            tangent(road, ref.end),
            laneDirection(road, ref.lane),
          );
          expect(dist(dir, before[i].dir)).toBeLessThan(1e-6);
          expect(laneWidth(road, ref.lane, ref.end)).toBe(4);
        },
      );
      expect(connections(p).filter((c) => c.manual)).toHaveLength(2);
    },
  );

  it("cleans invalidated one-way reversal references while preserving an intentional closed source", () => {
    const p = seam();
    setJunctionLaneRule(p, ref("a", 0, 1), [ref("b", 1, 0)]);
    remapReverseJunctionLaneRules(p, [p.roads[1]]);
    reverseRoad(p.roads[1]);
    autoJunction(p);
    expect(p.junctionLaneConnections).toEqual([
      { from: ref("a", 0, 1), to: [] },
    ]);
    remapReverseJunctionLaneRules(p, [p.roads[0]]);
    reverseRoad(p.roads[0]);
    autoJunction(p);
    expect(p.junctionLaneConnections).toBeUndefined();
  });

  it("retains physical lane identity through roadside expansion and removal", () => {
    const p = seam(options, options);
    setJunctionLaneRule(p, ref("a", 2, 1), [ref("b", 4, 0)]);
    setJunctionLaneRule(p, ref("b", 0, 0), []);
    const original = structuredClone(p.junctionLaneConnections),
      source = lanePoint(p.roads[0], 2, 1),
      target = lanePoint(p.roads[1], 4, 0);
    addRoadsideLanes(p, "a", "left");
    addRoadsideLanes(p, "b", "right");
    autoJunction(p);
    expect(p.junctionLaneConnections![0]).toEqual({
      from: ref("a", 3, 1),
      to: [ref("b", 4, 0)],
    });
    expect(dist(lanePoint(p.roads[0], 3, 1), source)).toBeLessThan(1e-6);
    expect(dist(lanePoint(p.roads[1], 4, 0), target)).toBeLessThan(1e-6);
    expect(connections(p).find((c) => c.id === "a:3>b:4")?.manual).toBe(true);
    removeRoadsideLanes(p, "a", "left");
    removeRoadsideLanes(p, "b", "right");
    autoJunction(p);
    expect(p.junctionLaneConnections).toEqual(original);
  });
});
