import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2_BASE_CAR,
  CS2_NAVIGATION_TIMESTEP,
  cs2BrakingDistance,
  cs2CurveCurviness,
  cs2FollowingSpeed,
  cs2LowSpeedDistanceOffset,
  cs2MaxBrakingSpeed,
  cs2MaxDriveSpeed,
  cs2NavigateSpeed,
  cs2SafetyTime,
  cs2SpeedRange,
  type CS2CarData,
} from "../src/simulation/cs2-driving";

type Oracle = {
  source: { sha256: string; mvid: string; generator: string };
  parameters: CS2CarData;
  records: { method: string; input: number[]; output: number | number[] }[];
};
const oracle: Oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-driving-oracle.json", import.meta.url),
    "utf8",
  ),
);

describe("direct original Game.dll scalar comparison", () => {
  it("retains source identity and independent oracle provenance", () => {
    expect(oracle.source.sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.source.generator).toContain("original Game.dll");
    expect(oracle.records).toHaveLength(384);
    for (const key of Object.keys(oracle.parameters) as (keyof CS2CarData)[])
      expect(CS2_BASE_CAR[key]).toBe(Math.fround(oracle.parameters[key]));
  });

  for (const method of [
    "GetMaxDriveSpeed",
    "GetMaxBrakingSpeed",
    "GetBrakingDistance",
    "CalculateSpeedRange",
    "GetDrivingStyle",
    "CalculateCurviness",
  ]) {
    it(`matches original ${method} vectors within float32 tolerance`, () => {
      const rows = oracle.records.filter((r) => r.method === method);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const p = row.input;
        let actual: number | number[];
        switch (method) {
          case "GetMaxDriveSpeed":
            actual = cs2MaxDriveSpeed(oracle.parameters, p[0], p[1]);
            break;
          case "GetMaxBrakingSpeed":
            actual = cs2MaxBrakingSpeed(
              oracle.parameters,
              p[0],
              p[p.length - 1],
              p.length === 3 ? p[1] : 0,
            );
            break;
          case "GetBrakingDistance":
            actual = cs2BrakingDistance(oracle.parameters, p[0], p[1]);
            break;
          case "CalculateSpeedRange": {
            const range = cs2SpeedRange(oracle.parameters, p[0], p[1]);
            actual = [range.min, range.max];
            break;
          }
          case "CalculateCurviness":
            actual = cs2CurveCurviness(
              [
                { x: p[0], y: p[1], z: p[2] },
                { x: p[3], y: p[4], z: p[5] },
                { x: p[6], y: p[7], z: p[8] },
                { x: p[9], y: p[10], z: p[11] },
              ],
              p[12],
              p[13],
            );
            break;
          default:
            actual = cs2SafetyTime(p[0], p[1], p[2] === 1);
        }
        const values = Array.isArray(actual) ? actual : [actual],
          expected = Array.isArray(row.output) ? row.output : [row.output];
        values.forEach((value, i) =>
          expect(
            Math.abs(value - expected[i]),
            `${row.method}(${row.input.join(", ")}) component ${i}`,
          ).toBeLessThan(0.00004),
        );
      }
    });
  }
});

it("uses the source safety-time period and distinct driver seeds", () => {
  expect(cs2SafetyTime(10, 71)).toBe(cs2SafetyTime(10 + 4096, 71));
  expect(cs2SafetyTime(10, 71)).not.toBe(cs2SafetyTime(10, 72));
  for (let frame = 0; frame < 4096; frame += 31) {
    expect(cs2SafetyTime(frame, 71)).toBeGreaterThanOrEqual(0.099999);
    expect(cs2SafetyTime(frame, 71)).toBeLessThanOrEqual(0.500001);
  }
});

it("accounts for the leader's braking ability and two navigation steps", () => {
  const leader = { gap: 22, speed: 20, braking: 10 };
  const strongFollower = cs2FollowingSpeed(CS2_BASE_CAR, leader, 4 / 15, 0.6);
  const weakFollower = cs2FollowingSpeed(
    { ...CS2_BASE_CAR, braking: 4 },
    leader,
    4 / 15,
    0.6,
  );
  expect(weakFollower).toBeLessThan(strongFollower);
  expect(
    cs2FollowingSpeed(CS2_BASE_CAR, { ...leader, speed: 0 }, 4 / 15, 0.6),
  ).toBeLessThan(strongFollower);
});

it("adapts a source navigation decision to the existing short integration step", () => {
  const input = {
    speed: 0,
    speedLimit: 25,
    simulationFrame: 0,
    seed: 71,
    timeStep: 0.025,
  };
  const decision = cs2NavigateSpeed(input);
  expect(decision.maxSpeed).toBeCloseTo(5 * CS2_NAVIGATION_TIMESTEP, 5);
  expect(decision.acceleration).toBeCloseTo(5, 5);
  expect(decision.nextSpeed).toBeCloseTo(0.125, 5);
  expect(cs2NavigateSpeed({ ...input, timeStep: 0 }).nextSpeed).toBe(0);
});

it("brakes for a real stop target and resumes after it is removed", () => {
  let speed = 15,
    distance = 60,
    minimumDistance = distance;
  for (let i = 0; i < 2400; i++) {
    const result = cs2NavigateSpeed({
      speed,
      speedLimit: 25,
      stopDistance: distance,
      simulationFrame: Math.floor(i * 0.025 * 60),
      seed: 71,
      timeStep: 0.025,
    });
    distance -= ((speed + result.nextSpeed) / 2) * 0.025;
    speed = result.nextSpeed;
    minimumDistance = Math.min(minimumDistance, distance);
  }
  expect(minimumDistance).toBeGreaterThan(0);
  expect(distance).toBeCloseTo(0.5, 2);
  expect(speed).toBeLessThan(0.001);
  expect(
    cs2NavigateSpeed({ speed, speedLimit: 25, timeStep: 0.025 }).nextSpeed,
  ).toBeGreaterThan(speed);
  expect(cs2LowSpeedDistanceOffset(0)).toBe(-0.5);
  expect(cs2LowSpeedDistanceOffset(1.5)).toBe(0);
});

it("does not overshoot the supplied target speed under normal integration", () => {
  let speed = 0;
  for (let i = 0; i < 3000; i++) {
    speed = cs2NavigateSpeed({
      speed,
      speedLimit: 13.888889,
      timeStep: 0.025,
    }).nextSpeed;
  }
  expect(speed).toBeCloseTo(13.888889, 4);
});
