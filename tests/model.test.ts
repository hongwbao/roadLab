import { describe, expect, it } from "vitest";
import {
  center,
  dist,
  laneCount,
  lanePoint,
  laneWidth,
  point,
  tangent,
  totalAt,
  v,
} from "../src/core/math";
import {
  autoJunction,
  connections,
  emptyProject,
  example,
  History,
  insertKnot,
  makeBranch,
  makeRoad,
  mirrorRoads,
  parseProject,
  reconnectIntersections,
  reverseRoad,
  setHeight,
  splitRoad,
  validate,
} from "../src/core/model";
import { copy } from "../src/core/types";
import { findRoute, Simulation } from "../src/simulation/simulation";

describe("2 → 3 → 2+1 physically continuous interchange", () => {
  it("retains the original two lane centerlines during right widening", () => {
    const r = example().roads[1];
    for (const t of [0, 0.1, 0.4, 0.8, 1]) {
      expect(lanePoint(r, 0, t).z).toBeCloseTo(-1.8, 7);
      expect(lanePoint(r, 1, t).z).toBeCloseTo(1.8, 7);
    }
    expect(laneWidth(r, 2, 0)).toBe(0);
    expect(laneWidth(r, 2, 1)).toBeCloseTo(3.6);
  });
  it("retains the existing right-side lanes when adding a lane on the left", () => {
    const r = example().roads[1];
    r.align = "right";
    for (const t of [0, 0.2, 0.5, 0.9, 1]) {
      expect(lanePoint(r, 1, t).z).toBeCloseTo(-1.8, 7);
      expect(lanePoint(r, 2, t).z).toBeCloseTo(1.8, 7);
    }
    expect(laneWidth(r, 0, 0)).toBe(0);
  });
  it("matches road surfaces and lane trajectories at every splice", () => {
    const [a, b, c, d, e] = example().roads;
    for (const [from, to] of [
      [a, b],
      [b, c],
    ])
      for (let l = 0; l < 2; l++)
        expect(dist(lanePoint(from, l, 1), lanePoint(to, l, 0))).toBeLessThan(
          1e-8,
        );
    for (let l = 0; l < 2; l++)
      expect(dist(lanePoint(c, l, 1), lanePoint(d, l, 0))).toBeLessThan(1e-8);
    expect(dist(lanePoint(c, 2, 1), lanePoint(e, 0, 0))).toBeLessThan(1e-8);
    expect(tangent(c, 1).x).toBeCloseTo(tangent(e, 0).x, 7);
  });
  it("connects exactly the two main lanes and the exit lane at the split", () => {
    const p = example(),
      c = p.roads[2],
      d = p.roads[3],
      e = p.roads[4],
      out = connections(p).filter((x) => x.from.road === c.id);
    expect(
      out
        .filter((x) => x.to.road === d.id)
        .map((x) => [x.from.lane, x.to.lane]),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(
      out
        .filter((x) => x.to.road === e.id)
        .map((x) => [x.from.lane, x.to.lane]),
    ).toEqual([[2, 0]]);
  });
  it("smoothly creates both split and merge connections from editor actions", () => {
    const p = emptyProject(),
      r = makeRoad(v(0, 0), v(50, 0), { lanesStart: 3, lanesEnd: 3 });
    p.roads.push(r);
    const id = makeBranch(p, r.id);
    expect(
      connections(p).some((c) => c.from.lane === 2 && c.to.road === id),
    ).toBe(true);
    const p2 = emptyProject(),
      r2 = copy(r);
    p2.roads.push(r2);
    const mid = makeBranch(p2, r2.id, true);
    expect(
      connections(p2).some(
        (c) => c.from.road === mid && c.to.road === r2.id && c.to.lane === 2,
      ),
    ).toBe(true);
  });
});
describe("editable geometry and topology", () => {
  it("mirrors a one-way interchange while preserving exact internal lane splices and routes", () => {
    const p = example();
    p.connections = connections(p);
    mirrorRoads(p, new Set(p.roads.map((r) => r.id)));
    for (const c of connections(p).filter((c) => c.enabled)) {
      const a = p.roads.find((r) => r.id === c.from.road)!,
        b = p.roads.find((r) => r.id === c.to.road)!;
      expect(
        dist(lanePoint(a, c.from.lane, 1), lanePoint(b, c.to.lane, 0)),
      ).toBeLessThan(1e-7);
    }
    expect(findRoute(p, p.ports[0], p.ports[1])).toBeDefined();
    expect(findRoute(p, p.ports[0], p.ports[2])).toBeDefined();
  });
  it("repeated knot insertion stays serializable and can split at an existing knot", () => {
    const p = example(),
      r = p.roads[1],
      before = copy(r);
    for (let i = 0; i < 6; i++) insertKnot(r, 0.5);
    expect(r.knots).toHaveLength(8);
    expect(parseProject(JSON.stringify(p))).toEqual(p);
    splitRoad(p, r.id, 0.5);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20,
        q = t <= 0.5 ? p.roads[1] : p.roads[2],
        u = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
      expect(dist(center(q, u), center(before, t))).toBeLessThan(1e-6);
    }
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
  it("keeps aligned lane splices one-to-one instead of inventing lane jumps", () => {
    const p = example();
    autoJunction(p);
    const a = p.roads[0],
      b = p.roads[1],
      cs = connections(p).filter(
        (c) => c.from.road === a.id && c.to.road === b.id,
      );
    expect(cs.map((c) => [c.from.lane, c.to.lane])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
  it("splits curved roads without changing their shape and preserves sources/sinks", () => {
    const p = emptyProject(),
      r = makeRoad(v(0, 0), v(100, 50), {}, v(30, 0), v(60, 50));
    p.roads = [r];
    p.ports = [{ road: r.id, end: "end", type: "sink", rate: 1 }];
    const original = copy(r),
      id = splitRoad(p, r.id, 0.4)!;
    expect(p.roads).toHaveLength(2);
    for (const t of [0.1, 0.3, 0.6, 0.9]) {
      const q =
        t <= 0.4
          ? point(p.roads[0], t / 0.4)
          : point(p.roads[1], (t - 0.4) / 0.6);
      expect(dist(q, point(original, t))).toBeLessThan(1e-8);
    }
    expect(p.ports[0].road).toBe(id);
    expect(connections(p).length).toBeGreaterThan(0);
  });
  it("inserts an editable knot without changing a cubic curve", () => {
    const r = makeRoad(v(0, 0), v(80, 40), {}, v(40, 0), v(40, 40)),
      before = copy(r);
    insertKnot(r, 0.5);
    expect(r.knots).toHaveLength(3);
    for (let i = 0; i <= 20; i++)
      expect(dist(point(r, i / 20), point(before, i / 20))).toBeLessThan(1e-7);
  });
  it("splits a widening zone without a jump in surface width or lane trajectories", () => {
    const p = example(),
      r = p.roads[1],
      before = copy(r);
    splitRoad(p, r.id, 0.5);
    const a = p.roads.find((x) => x.id === r.id)!,
      b = p.roads[p.roads.indexOf(a) + 1];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20,
        part = t <= 0.5 ? a : b,
        u = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
      expect(totalAt(part, u)).toBeCloseTo(totalAt(before, t), 7);
      for (let l = 0; l < 3; l++)
        expect(
          dist(lanePoint(part, l, u), lanePoint(before, l, t)),
        ).toBeLessThan(1e-7);
    }
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
  it("preserves a multi-knot transition through non-midpoint insertions and splitting", () => {
    const p = example(),
      r = p.roads[1],
      before = copy(r);
    insertKnot(r, 0.3);
    insertKnot(r, 0.7);
    splitRoad(p, r.id, 0.6);
    const a = p.roads[1],
      b = p.roads[2];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30,
        q = t <= 0.6 ? a : b,
        u = t <= 0.6 ? t / 0.6 : (t - 0.6) / 0.4;
      expect(dist(center(q, u), center(before, t))).toBeLessThan(1e-7);
      expect(totalAt(q, u)).toBeCloseTo(totalAt(before, t), 7);
    }
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
  it("reverses a transition without moving its surface or lane paths", () => {
    const r = example().roads[1],
      before = copy(r);
    reverseRoad(r);
    for (let i = 0; i <= 20; i++)
      for (let l = 0; l < 3; l++)
        expect(
          dist(lanePoint(r, l, i / 20), lanePoint(before, 2 - l, 1 - i / 20)),
        ).toBeLessThan(1e-7);
  });
  it("supports a left exit with two ramp lanes and non-default lane widths", () => {
    const p = emptyProject(),
      r = makeRoad(v(0, 0), v(70, 0), { lanesStart: 3, lanesEnd: 3, width: 4 });
    p.roads = [r];
    const id = makeBranch(p, r.id, false, {
      side: "left",
      lanes: 2,
      length: 120,
    });
    const ramp = p.roads.find((r) => r.id === id)!;
    expect(ramp.width).toBe(4);
    expect(ramp.lanesStart).toBe(2);
    const out = connections(p).filter(
      (c) => c.from.road === r.id && c.to.road === id,
    );
    expect(out.map((c) => c.from.lane)).toEqual([0, 1]);
  });
  it("creates an elevated smooth ramp with horizontal endpoint tangents", () => {
    const r = makeRoad(v(0, 0), v(100, 20));
    setHeight(r, 0, 16);
    expect(point(r, 0).y).toBe(0);
    expect(point(r, 1).y).toBe(16);
    expect(tangent(r, 0).y).toBeCloseTo(0);
    expect(tangent(r, 1).y).toBeCloseTo(0);
    expect(point(r, 0.5).y).toBeCloseTo(8);
  });
  it("connects a same-height crossing and keeps elevated crossings independent", () => {
    const p = emptyProject();
    p.roads = [makeRoad(v(-30, 0), v(30, 0)), makeRoad(v(0, -30), v(0, 30))];
    expect(reconnectIntersections(p)).toBe(1);
    expect(p.roads.length).toBe(4);
    expect(connections(p).length).toBeGreaterThan(4);
    const q = emptyProject();
    q.roads = [
      makeRoad(v(-30, 0), v(30, 0)),
      makeRoad(v(0, -30, 8), v(0, 30, 8)),
    ];
    expect(reconnectIntersections(q)).toBe(0);
    expect(connections(q)).toHaveLength(0);
  });
  it("supports right-hand reverse lanes on two-way roads", () => {
    const r = makeRoad(v(0, 0), v(40, 0), {
      twoWay: true,
      lanesStart: 2,
      lanesEnd: 2,
    });
    expect(laneCount(r)).toBe(4);
    expect(lanePoint(r, 0, 0.5).z).toBeLessThan(0);
    expect(lanePoint(r, 3, 0.5).z).toBeGreaterThan(0);
  });
});
describe("persistence and reversible editing", () => {
  it("round-trips geometry and templates while migrating retired manual lane overrides", () => {
    const p = example();
    const c = connections(p)[0];
    p.connections.push({ ...c, enabled: false, manual: true });
    p.templates.push({
      id: "test-template",
      name: "模板",
      roads: copy(p.roads),
      connections: copy(p.connections),
    });
    const loaded = parseProject(JSON.stringify(p));
    expect(loaded.roads).toEqual(p.roads);
    expect(loaded.templates).toEqual(p.templates);
    expect(loaded.connections).toEqual([]);
    expect(connections(loaded)).toEqual(connections(p));
  });
  it("rejects corrupt files before they replace the current map", () => {
    const p = example();
    (p.roads[0].knots[0].p as any).x = "bad";
    expect(() => parseProject(JSON.stringify(p))).toThrow();
    const q = example();
    q.roads[1].transitionEnd = -1;
    expect(() => parseProject(JSON.stringify(q))).toThrow();
    expect(() => parseProject('{"version":999}')).toThrow();
  });
  it("restores a compound operation with undo and redo", () => {
    const h = new History(),
      p = example(),
      before = copy(p);
    h.commit(p);
    makeBranch(p, p.roads[2].id);
    const after = copy(p),
      restored = h.undo(p)!;
    expect(restored).toEqual(before);
    expect(h.redo(restored)).toEqual(after);
  });
});
describe("traffic uses actual lane connections", () => {
  it("scales requested arrivals proportionally, including demand above the old spawn tick limit", () => {
    for (const multiplier of [0, 1, 4]) {
      const p = example();
      p.ports[0].rate = 240;
      p.trafficMultiplier = multiplier;
      const sim = new Simulation();
      sim.configure(p);
      sim.running = true;
      for (let i = 0; i < 400; i++) sim.update(0.05);
      expect(sim.generated).toBeCloseTo(80 * multiplier, 0);
      expect(sim.entered + sim.waiting).toBe(sim.generated);
      if (multiplier === 4) expect(sim.waiting).toBeGreaterThan(0);
    }
  });
  it("zero flow stops new cars while existing cars keep moving", () => {
    const p = example(),
      sim = new Simulation();
    sim.configure(p);
    sim.running = true;
    for (let i = 0; i < 120; i++) sim.update(0.05);
    const car = sim.vehicles[0],
      id = car.id,
      previousStep = car.step,
      previous = car.s,
      entered = sim.entered,
      generated = sim.generated;
    p.trafficMultiplier = 0;
    for (let i = 0; i < 40; i++) sim.update(0.05);
    expect(sim.entered).toBe(entered);
    expect(sim.generated).toBe(generated);
    const advanced = sim.vehicles.find((c) => c.id === id)!;
    expect(
      advanced.step > previousStep ||
        (advanced.step === previousStep && advanced.s > previous),
    ).toBe(true);
    expect(sim.running).toBe(true);
  });
  it("changing an inlet rate live preserves vehicles and simulation statistics", () => {
    const p = example(),
      sim = new Simulation();
    sim.configure(p);
    sim.running = true;
    for (let i = 0; i < 120; i++) sim.update(0.05);
    const car = sim.vehicles[0],
      elapsed = sim.elapsed,
      generated = sim.generated;
    p.ports[0].rate = 120;
    for (let i = 0; i < 80; i++) sim.update(0.05);
    expect(sim.generated - generated).toBe(8);
    expect(sim.elapsed).toBeGreaterThan(elapsed);
    expect(sim.vehicles.some((c) => c.id === car.id)).toBe(true);
  });
  it("persists traffic intensity and accepts older maps without the optional setting", () => {
    const p = example();
    p.trafficMultiplier = 2.5;
    expect(parseProject(JSON.stringify(p)).trafficMultiplier).toBe(2.5);
    delete p.trafficMultiplier;
    const old = parseProject(JSON.stringify(p)),
      sim = new Simulation();
    sim.configure(old);
    sim.running = true;
    for (let i = 0; i < 200; i++) sim.update(0.05);
    expect(sim.generated).toBe(4);
  });
  it("rejects invalid imported traffic intensity", () => {
    for (const invalid of [-1, 4.01, "2", null]) {
      const p = example();
      (p as any).trafficMultiplier = invalid;
      expect(() => parseProject(JSON.stringify(p))).toThrow("车流强度");
    }
  });
  it("finds both destinations using automatic links despite retired overrides", () => {
    const p = example(),
      source = p.ports[0];
    expect(findRoute(p, source, p.ports[1])).toBeDefined();
    const rampRoute = findRoute(p, source, p.ports[2])!;
    expect(rampRoute.at(-2)!.outLane).toBe(2);
    const out = connections(p).filter((c) => c.to.road === p.roads[4].id);
    p.connections.push(...out.map((c) => ({ ...c, enabled: false })));
    expect(findRoute(p, source, p.ports[2])).toBeDefined();
  });
  it("disconnects automatic routing when an endpoint moves to another elevation", () => {
    const p = example(),
      c = connections(p).find((c) => c.to.road === p.roads[4].id)!;
    p.connections.push({ ...c, manual: true });
    setHeight(p.roads[4], 8, 8);
    expect(findRoute(p, p.ports[0], p.ports[2])).toBeUndefined();
    expect(connections(p).some((x) => x.to.road === p.roads[4].id)).toBe(false);
  });
  it("runs vehicles through the widening and split, completing actual trips", () => {
    const p = example(),
      sim = new Simulation();
    sim.configure(p);
    expect(sim.routeCount).toBe(2);
    sim.running = true;
    let maximum = 0;
    for (let i = 0; i < 3600; i++) {
      sim.update(0.05);
      maximum = Math.max(maximum, sim.vehicles.length);
      for (const car of sim.vehicles) {
        expect(Number.isFinite(car.position.x)).toBe(true);
        expect(car.lane).toBeGreaterThanOrEqual(0);
      }
    }
    expect(maximum).toBeGreaterThan(3);
    expect(sim.completed).toBeGreaterThan(5);
    expect(sim.average).toBeGreaterThan(0);
  });
  it("has no structural errors in either supplied example", () => {
    for (const kind of ["transition", "elevated"])
      expect(
        validate(example(kind)).filter((x) => x.severity === "error"),
      ).toHaveLength(0);
  });
  it("can complete a trip that ends after a three-to-two-lane narrowing", () => {
    const p = emptyProject(),
      r = makeRoad(v(0, 0), v(120, 0), {
        lanesStart: 3,
        lanesEnd: 2,
        align: "left",
      });
    p.roads = [r];
    p.ports = [
      { road: r.id, end: "start", type: "source", rate: 35 },
      { road: r.id, end: "end", type: "sink", rate: 1 },
    ];
    const route = findRoute(p, p.ports[0], p.ports[1], connections(p), 2)!;
    expect(route[0].outLane).toBeLessThan(2);
    const sim = new Simulation();
    sim.configure(p);
    sim.running = true;
    for (let i = 0; i < 2000; i++) sim.update(0.05);
    expect(sim.completed).toBeGreaterThan(3);
  });
});
