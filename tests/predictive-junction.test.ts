import { expect, it } from "vitest";
import { v } from "../src/core/math";
import { DEFAULT_DRIVER } from "../src/simulation/driving";
import {
  PredictiveJunctionController,
  type PredictionAgent,
  type PredictionPath,
} from "../src/simulation/predictive-junction";

function path(id: string, angle = 0, offset = 0, height = 0): PredictionPath {
  return {
    id,
    junction: "test",
    from: id + ":in",
    to: id + ":out",
    length: 20,
    points: Array.from({ length: 201 }, (_, i) => {
      const s = i * 0.5 - 60;
      return {
        s,
        position: v(
          Math.cos(angle) * s - Math.sin(angle) * offset,
          Math.sin(angle) * s + Math.cos(angle) * offset,
          height,
        ),
        heading: angle,
      };
    }),
  };
}
function agent(
  id: number,
  p: PredictionPath,
  s = -25,
  speed = 10,
): PredictionAgent {
  return {
    id,
    path: p,
    s,
    speed,
    driver: { ...DEFAULT_DRIVER },
    freeSpeed: 15,
    turnSpeed: 15,
    exitSpeed: 15,
    canExit: true,
  };
}
it("assigns one stable yielding car when crossing bodies would arrive together", () => {
  const control = new PredictiveJunctionController(),
    a = agent(1, path("a")),
    b = agent(2, path("b", Math.PI / 2));
  const first = control.plan([a, b], 0);
  expect(first.size).toBe(1);
  expect(first.get(2)?.winner).toBe(1);
  expect(first.get(2)!.stopS).toBeLessThan(0);
  const second = control.plan(
    [
      { ...b, speed: 0 },
      { ...a, s: -23 },
    ],
    0.1,
  );
  expect(second.get(2)?.winner).toBe(1);
  expect(second.has(1)).toBe(false);
});
it("does not stop parallel opposing lanes, different bridge levels, or a lone car", () => {
  const control = new PredictiveJunctionController();
  const a = agent(1, path("a", 0, -1.75));
  const b = agent(2, path("b", Math.PI, -1.75));
  expect(control.plan([a, b], 0).size).toBe(0);
  expect(
    control.plan([a, agent(3, path("bridge", Math.PI / 2, 0, 8))], 0.1).size,
  ).toBe(0);
  expect(control.plan([a], 0.2).size).toBe(0);
});
it("permits paths that cross at different times and releases a cleared conflict", () => {
  const control = new PredictiveJunctionController();
  const a = agent(1, path("a"), -8),
    b = agent(2, path("b", Math.PI / 2), -55);
  expect(control.plan([a, b], 0).size).toBe(0);
  const together = control.plan(
    [
      { ...a, s: -25 },
      { ...b, s: -25 },
    ],
    0.1,
  );
  expect(together.size).toBe(1);
  expect(
    control.plan(
      [
        { ...a, s: 15 },
        { ...b, s: -20, speed: 0 },
      ],
      1,
    ).size,
  ).toBe(0);
});
it("does not replace normal longitudinal following on the same movement", () => {
  const control = new PredictiveJunctionController(),
    p = path("same");
  expect(
    control.plan([agent(1, p, -10, 5), agent(2, p, -30, 10)], 0).size,
  ).toBe(0);
});
it("keeps conflict priority independent of the input array order", () => {
  const a = agent(1, path("a")),
    b = agent(2, path("b", Math.PI / 2));
  const first = new PredictiveJunctionController().plan([a, b], 0);
  const second = new PredictiveJunctionController().plan([b, a], 0);
  expect([...first]).toEqual([...second]);
});
