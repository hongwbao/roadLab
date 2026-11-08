import { expect, it } from "vitest";
import {
  buildLaneJunctions,
  laneJunctionTrims,
} from "../src/core/lane-junctions";
import { buildJunctions } from "../src/core/junctions";
import {
  junctionLaneCandidates,
  junctionLanePorts,
  setJunctionLaneRule,
  restoreJunctionLaneRules,
  normalizeJunctionLaneRules,
} from "../src/core/junction-lane-connections";
import {
  emptyProject,
  makeRoad,
  connections,
  parseProject,
  autoJunction,
  example,
  History,
  removeRoads,
} from "../src/core/model";
import { v, dist } from "../src/core/math";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
export function splitFixture() {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(-120, 0), v(), { id: "up", width: 4 }),
    makeRoad(v(), v(140, 0), { id: "through", width: 4 }),
    makeRoad(
      v(0, 2),
      v(140, 50),
      {
        id: "ramp",
        width: 4,
        kind: "ramp",
        lanesStart: 1,
        lanesEnd: 1,
        attachments: {
          start: { road: "up", end: 1, lanes: [1], ownLanes: [0] },
        },
      },
      v(60, 2),
      v(100, 50),
    ),
  ];
  p.ports = [
    { road: "up", end: "start", type: "source", rate: 6 },
    { road: "through", end: "end", type: "sink", rate: 1 },
    { road: "ramp", end: "end", type: "sink", rate: 1 },
  ];
  return p;
}
const source = { road: "up", end: 1 as const, lane: 0 },
  target = { road: "ramp", end: 0 as const, lane: 0 };
it("recognizes offset forks and their continued carriageway as one selectable lane node", () => {
  const p = splitFixture();
  expect(buildJunctions(p)).toHaveLength(0);
  const [node] = buildLaneJunctions(p);
  expect(buildLaneJunctions(p)).toHaveLength(1);
  expect(node.kind).toBe("attachment");
  expect(node.arms).toHaveLength(3);
  const ports = junctionLanePorts(p, node);
  expect(ports.filter((p) => p.kind === "in")).toHaveLength(2);
  expect(ports.filter((p) => p.kind === "out")).toHaveLength(3);
  expect(new Set(ports.map((p) => p.name)).size).toBe(5);
  const outs = ports.filter((p) => p.kind === "out");
  for (let i = 0; i < outs.length; i++)
    for (let j = i + 1; j < outs.length; j++)
      expect(dist(outs[i].position, outs[j].position)).toBeGreaterThan(3);
  expect(junctionLaneCandidates(p, node)).toHaveLength(6);
  const auto = connections(p);
  expect(auto.some((c) => c.id === "up:0>ramp:0")).toBe(false);
  setJunctionLaneRule(p, source, [target]);
  autoJunction(p);
  expect(connections(p).find((c) => c.id === "up:0>ramp:0")?.manual).toBe(true);
  expect(p.roads[2].attachments?.start?.lanes).toEqual([1]);
  const saved = parseProject(JSON.stringify(p));
  normalizeJunctionLaneRules(saved);
  expect(saved.junctionLaneConnections).toEqual(p.junctionLaneConnections);
  restoreJunctionLaneRules(saved, buildLaneJunctions(saved)[0]);
  expect(connections(saved)).toEqual(auto);
});
it("recovers geometric offset contacts in legacy maps and excludes nearby or grade-separated roads", () => {
  const p = splitFixture();
  delete p.roads[2].attachments;
  expect(buildLaneJunctions(p)[0].arms).toHaveLength(3);
  for (const k of p.roads[2].knots)
    for (const part of ["p", "incoming", "outgoing"] as const) k[part].y += 12;
  expect(buildLaneJunctions(p)).toHaveLength(0);
  const other = makeRoad(v(0, 12), v(140, 12), { id: "parallel", width: 4 });
  p.roads.push(other);
  expect(buildLaneJunctions(p)).toHaveLength(0);
  p.roads[2].attachments = {
    start: { road: "up", end: 1, lanes: [1], ownLanes: [0] },
  };
  expect(buildLaneJunctions(p)).toHaveLength(0);
});
it("recognizes two-road offset joins, supports blocked exits and restores rules through history", () => {
  const p = splitFixture();
  p.roads.splice(1, 1);
  p.ports = p.ports.filter((v) => v.road !== "through");
  const original = structuredClone(p);
  const history = new History();
  history.commit(p);
  expect(buildLaneJunctions(p)[0].arms).toHaveLength(2);
  setJunctionLaneRule(p, source, []);
  autoJunction(p);
  expect(
    connections(p).filter((c) => c.from.road === "up" && c.from.lane === 0),
  ).toEqual([]);
  expect(history.undo(p)).toEqual(original);
  history.commit(p);
  setJunctionLaneRule(p, source, [target]);
  removeRoads(p, new Set(["ramp"]));
  autoJunction(p);
  expect(p.junctionLaneConnections).toBeUndefined();
});
it("supports the reverse merge with multiple incoming roads", () => {
  const p = splitFixture();
  p.roads[2] = makeRoad(
    v(-140, 50),
    v(0, 2),
    {
      id: "ramp",
      kind: "ramp",
      width: 4,
      lanesStart: 1,
      lanesEnd: 1,
      attachments: {
        end: { road: "through", end: 0, lanes: [1], ownLanes: [0] },
      },
    },
    v(-100, 50),
    v(-60, 2),
  );
  const [node] = buildLaneJunctions(p);
  expect(node.arms).toHaveLength(3);
  expect(
    junctionLanePorts(p, node).filter((p) => p.kind === "in"),
  ).toHaveLength(3);
  setJunctionLaneRule(p, { road: "ramp", lane: 0, end: 1 }, [
    { road: "through", lane: 0, end: 0 },
  ]);
  expect(connections(p).some((c) => c.id === "ramp:0>through:0")).toBe(true);
});
it("finds all cloverleaf split/merge contacts while retaining the physical pavement topology", () => {
  const p = example("elevated"),
    nodes = buildLaneJunctions(p);
  expect(nodes).toHaveLength(24);
  expect(buildJunctions(p)).toHaveLength(0);
  for (const ramp of p.roads.filter((r) => r.kind === "ramp"))
    for (const end of [0, 1])
      expect(
        nodes.some((n) =>
          n.arms.some((a) => a.road === ramp.id && a.end === end),
        ),
      ).toBe(true);
});
it("creates a smooth actual source-network connector for an authored offset movement, preserves defaults and completes traffic", () => {
  const p = splitFixture(),
    base = new Map(p.roads.map((r) => [r.id, { start: 0, end: 0 }]));
  expect(laneJunctionTrims(p, base)).toBe(base);
  const before = structuredClone(p.roads);
  setJunctionLaneRule(p, source, [target]);
  const trims = laneJunctionTrims(p, base);
  expect(trims.get("up")!.end).toBeGreaterThan(10);
  expect(p.roads).toEqual(before);
  // The only sink is the ramp, and every other source lane is closed. Any
  // completed trip must traverse the newly authored connector.
  p.ports = p.ports.filter((port) => port.road !== "through");
  setJunctionLaneRule(p, { road: "up", lane: 1, end: 1 }, []);
  const sim = new Cs2TrafficSimulation({ synchronousPathsOnlyForTests: true });
  sim.configure(p);
  const id = sim.network!.connectionLaneIds.get("up:0>ramp:0");
  expect(id).toBeDefined();
  const curve = sim.network!.lanes.get(id!)!.curve;
  expect(curve.points[0].x).toBeLessThan(-10);
  expect(curve.points[3].x).toBeGreaterThan(10);
  for (let i = 1; i < 4; i++)
    expect(curve.points[i].x).toBeGreaterThan(curve.points[i - 1].x);
  sim.running = true;
  for (let i = 0; i < 1600; i++) sim.update(0.05);
  expect(sim.completed).toBeGreaterThan(0);
  expect(
    sim.network!.warnings.filter((w) => w.includes("endpoint mismatch")),
  ).toEqual([]);
});

it("supports reverse-direction lanes on a median-separated road and stable node identity after reordering", () => {
  const p = emptyProject();
  const ref = makeRoad(v(), v(120, 0), {
    id: "reference",
    twoWay: true,
    width: 4,
    median: { kind: "concrete", width: 2 },
  });
  const previous = makeRoad(v(-120, 0), v(), {
    id: "previous",
    twoWay: true,
    width: 4,
    median: { kind: "concrete", width: 2 },
  });
  const ramp = makeRoad(
    v(0, -7),
    v(-120, -40),
    {
      id: "reverse-ramp",
      kind: "ramp",
      width: 4,
      lanesStart: 1,
      lanesEnd: 1,
      attachments: {
        start: { road: ref.id, end: 0, lanes: [0], ownLanes: [0] },
      },
    },
    v(-50, -7),
    v(-90, -40),
  );
  p.roads = [ref, previous, ramp];
  const node = buildLaneJunctions(p)[0];
  expect(node.arms).toHaveLength(3);
  setJunctionLaneRule(p, { road: ref.id, end: 0, lane: 1 }, [
    { road: ramp.id, end: 0, lane: 0 },
  ]);
  expect(
    connections(p).some((c) => c.id === "reference:1>reverse-ramp:0"),
  ).toBe(true);
  p.roads.reverse();
  expect(buildLaneJunctions(p)[0].id).toBe(node.id);
  const invalid = junctionLaneCandidates(p, buildLaneJunctions(p)[0]).find(
    (c) =>
      c.from.road === ref.id && c.to.road === previous.id && c.to.lane >= 2,
  );
  expect(invalid).toBeUndefined();
});
