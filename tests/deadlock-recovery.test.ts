import { expect, it } from "vitest";
import { v } from "../src/core/math";
import { bodiesOverlap } from "../src/simulation/collision";
import {
  chooseRetreat,
  waitCycles,
  type WaitingVehicle,
} from "../src/simulation/deadlock-recovery";
import {
  samplePredictionPath,
  type PredictionPath,
} from "../src/simulation/predictive-junction";

function path(id: string, reverse = false): PredictionPath {
  return {
    id,
    junction: "test",
    from: id,
    to: id + ":out",
    length: 20,
    points: Array.from({ length: 121 }, (_, i) => {
      const s = i * 0.25 - 10;
      return {
        s,
        position: v(reverse ? -s : s, 0),
        heading: reverse ? Math.PI : 0,
      };
    }),
  };
}
function stopped(
  id: number,
  p: PredictionPath,
  s: number,
  blockers: number[],
): WaitingVehicle {
  return { id, path: p, s, blockers };
}
it("detects circular waiting without labelling an ordinary exit queue as deadlocked", () => {
  const p = path("lane");
  expect(
    waitCycles([
      stopped(1, p, 0, [2]),
      stopped(2, p, 5, [3]),
      stopped(3, p, 10, []),
    ]),
  ).toEqual([]);
  const cycles = waitCycles([
    stopped(1, p, 0, [2]),
    stopped(2, p, 5, [3]),
    stopped(3, p, 10, [1]),
  ]);
  expect(cycles).toHaveLength(1);
  expect(cycles[0].sort()).toEqual([1, 2, 3]);
});
it("finds a collision-free bounded retreat which gives another car forward space", () => {
  const a = stopped(1, path("a"), -2.2, [2]),
    b = stopped(2, path("b", true), -2.2, [1]);
  const bodies = [a, b].map((c) => ({
    id: c.id,
    ...samplePredictionPath(c.path, c.s),
  }));
  const plan = chooseRetreat([1, 2], [a, b], bodies);
  expect(plan).toBeDefined();
  expect(plan!.fromS - plan!.toS).toBeLessThanOrEqual(1.8);
  const moved = {
    id: plan!.id,
    ...samplePredictionPath(plan!.path, plan!.toS),
  };
  expect(
    bodiesOverlap(
      moved,
      bodies.find((b) => b.id !== moved.id)!,
      0.18,
    ),
  ).toBe(false);
});
it("refuses to reverse through a rear vehicle when no safe retreat space exists", () => {
  const a = stopped(1, path("a"), -2.2, [2]),
    b = stopped(2, path("b", true), -2.2, [1]);
  const bodies = [a, b].map((c) => ({
    id: c.id,
    ...samplePredictionPath(c.path, c.s),
  }));
  bodies.push(
    { id: 3, position: v(-6.45, 0), heading: 0, s: 0 },
    { id: 4, position: v(6.45, 0), heading: Math.PI, s: 0 },
  );
  expect(chooseRetreat([1, 2], [a, b], bodies)).toBeUndefined();
});
