import { describe, expect, it } from "vitest";
import type { V } from "../src/core/types";
import { CS2_BASE_CAR } from "../src/simulation/cs2-driving";
import {
  CS2OverlapController,
  type CS2OverlapAgent,
  type CS2OverlapMovement,
} from "../src/simulation/cs2-overlap-controller";

function straight(id: string, a: V, b: V): CS2OverlapMovement {
  return {
    id,
    junction: "junction",
    from: `${id}-in`,
    to: `${id}-out`,
    priority: 0,
    turn: "straight",
    points: Array.from({ length: 21 }, (_, i) => ({
      x: a.x + ((b.x - a.x) * i) / 20,
      y: a.y + ((b.y - a.y) * i) / 20,
      z: a.z + ((b.z - a.z) * i) / 20,
    })),
  };
}
const cross = () => [
  straight("east", { x: -20, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }),
  straight("north", { x: 0, y: 0, z: -20 }, { x: 0, y: 0, z: 20 }),
];
const agent = (
  id: number,
  movement: string,
  s: number,
  speed = 8,
): CS2OverlapAgent => ({
  id,
  movement,
  s,
  speed,
  length: 3.8,
  car: { ...CS2_BASE_CAR },
  freeSpeed: 15,
  canExit: true,
});

describe("CS2 source-derived overlap decisions with a polyline geometry adapter", () => {
  it("does not invent a stop line when a fractional free speed rounds to float32", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const car = { ...agent(1, "east", -30, 60 / 3.6), freeSpeed: 60 / 3.6 };
    const directive = c.plan([car], 0).get(1)!;
    expect(directive.maxSpeed).toBe(Math.fround(60 / 3.6));
    expect(directive.blockerType).toBe("none");
    expect(directive.stopS).toBeUndefined();
  });

  it("reads all lane objects while updating only the selected navigation group", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const cars = [agent(1, "east", -10), agent(2, "north", 10)];
    const first = c.plan(cars, 0, new Set([1]), new Set());
    expect(first.has(1)).toBe(true);
    expect(first.has(2)).toBe(false);
    const second = c.plan(cars, 1 / 60, new Set([2]), new Set());
    expect(second.has(2)).toBe(true);
    expect(second.has(1)).toBe(false);
  });

  it("keeps actual object blockers after entering a reservation window", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const result = c.plan(
      [agent(1, "east", 17.2, 0.1), agent(2, "north", 17.2, 0.1)],
      0,
    );
    expect(result.get(1)?.blocker).toBe(2);
    expect(result.get(2)?.blocker).toBeUndefined();
    expect(result.get(1)?.stuck).toBe(false);
  });

  it("creates local byte windows instead of claiming the whole junction", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const windows = c.windows("east");
    expect(windows).toHaveLength(1);
    expect(windows[0].data.thisStart).toBeGreaterThan(80);
    expect(windows[0].data.thisEnd).toBeLessThan(180);
    expect(windows[0].data.priorityDelta).toBe(
      -c.windows("north")[0].data.priorityDelta,
    );
  });

  it("allows opposing straight lanes and keeps grade-separated paths independent", () => {
    const c = new CS2OverlapController(),
      movements = [
        straight("east", { x: -20, y: 0, z: -1.75 }, { x: 20, y: 0, z: -1.75 }),
        straight("west", { x: 20, y: 0, z: 1.75 }, { x: -20, y: 0, z: 1.75 }),
        straight("bridge", { x: 0, y: 8, z: -20 }, { x: 0, y: 8, z: 20 }),
      ];
    c.configure(movements);
    for (const movement of movements)
      expect(c.windows(movement.id)).toHaveLength(0);
    const directives = c.plan([agent(1, "east", 10), agent(2, "west", 10)], 0);
    expect(directives.get(1)?.blockerType).toBe("none");
    expect(directives.get(2)?.blockerType).toBe("none");
  });

  it("does not stop an unrelated right-turn stream", () => {
    const c = new CS2OverlapController(),
      right = straight(
        "right",
        { x: -20, y: 0, z: -5 },
        { x: -5, y: 0, z: -20 },
      );
    right.turn = "right";
    c.configure([
      right,
      straight("west", { x: 20, y: 0, z: 1.75 }, { x: -20, y: 0, z: 1.75 }),
    ]);
    expect(c.windows("right")).toHaveLength(0);
    expect(
      c.plan([agent(1, "right", 0), agent(2, "west", 20)], 0).get(1)
        ?.blockerType,
    ).toBe("none");
  });

  it("yields before the crossing range and lets both streams eventually clear", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const agents = [agent(1, "east", -10), agent(2, "north", -10)];
    let yielded = false;
    for (let tick = 0; tick < 200; tick++) {
      const directives = c.plan(agents, tick * 0.1);
      for (const a of agents) {
        const d = directives.get(a.id)!;
        yielded ||= d.blockerType === "crossing";
        a.speed = Math.max(0, Math.min(d.maxSpeed, a.speed + 0.4));
        a.s += a.speed * 0.1;
      }
      // Axis-aligned 3.8 x 1.65 bodies on these two straight connectors.
      expect(
        Math.abs(agents[0].s - 20) >= 2.725 ||
          Math.abs(agents[1].s - 20) >= 2.725,
      ).toBe(true);
    }
    expect(yielded).toBe(true);
    expect(agents.every((a) => a.s > 45)).toBe(true);
  });

  it("a red approach does not reserve a conflict window in front of a green car", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const red = { ...agent(1, "east", -5, 0), signal: 1, navigationSpeed: 0 },
      green = { ...agent(2, "north", 10, 5), signal: 4 };
    for (let i = 0; i < 20; i++) {
      const d = c.plan([red, green], i * 0.1).get(green.id)!;
      expect(d.blockerType).toBe("none");
      green.s += 0.5;
    }
  });

  it("checks downstream storage without waiting for any crossing vehicle", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const a = { ...agent(1, "east", -4, 3), canExit: false, exitSpace: 0 },
      d = c.plan([a], 0).get(a.id)!;
    expect(d.blockerType).toBe("continuing");
    expect(d.stopS).toBeCloseTo(-2.8);
    expect(d.maxSpeed).toBeLessThan(a.speed);
    const inside = c.plan([{ ...a, s: 15 }], 0.1).get(a.id)!;
    expect(inside.blockerType).toBe("none");
  });

  it("follows the lead vehicle on one movement rather than reserving against itself", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const d = c
      .plan([agent(1, "east", 5, 6), agent(2, "east", 10, 0)], 0)
      .get(1)!;
    expect(d.blockerType).toBe("continuing");
    expect(d.blocker).toBe(2);
    expect(d.maxSpeed).toBeLessThan(6);
  });

  it("releases vanished approaches after the original two reservation buckets", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    c.plan([agent(1, "east", -1, 12)], 0);
    const a = agent(2, "north", 10, 2);
    const before = c.plan([a], 0.01).get(2)!;
    const after = c.plan([a], 2).get(2)!;
    expect(after.maxSpeed).toBeGreaterThanOrEqual(before.maxSpeed);
    expect(after.blockerType).toBe("none");
  });

  it("keeps long high-demand runs finite without a fixed five-second predictor", () => {
    const c = new CS2OverlapController();
    c.configure(cross());
    const agents = Array.from({ length: 60 }, (_, i) =>
      agent(i, i % 2 ? "east" : "north", -10 - Math.floor(i / 2) * 8, 4),
    );
    let completed = 0;
    for (let tick = 0; tick < 600; tick++) {
      const directives = c.plan(agents, tick * 0.1);
      for (const a of agents) {
        const d = directives.get(a.id)!;
        expect(Number.isFinite(d.maxSpeed)).toBe(true);
        a.speed = Math.max(0, Math.min(d.maxSpeed, a.speed + 0.3));
        const before = a.s;
        a.s += a.speed * 0.1;
        if (before <= 45 && a.s > 45) completed++;
      }
    }
    expect(completed).toBeGreaterThan(15);
    expect(c.statistics.plans).toBe(600);
    expect(c.statistics.windows).toBe(2);
  });
});
