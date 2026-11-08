import { expect, it } from "vitest";
import { coordinateLaneMerges } from "../src/simulation/lane-merge-coordination";
it("opens gaps in intervening lanes together without slowing the priority requester", () => {
  const request = {
    id: 1,
    position: 100,
    speed: 15,
    distance: 450,
    target: "lane1",
    corridor: ["lane1", "lane2", "lane3"],
  };
  const result = coordinateLaneMerges(
    [request],
    new Map(
      ["lane1", "lane2", "lane3"].map((key, i) => [
        key,
        [{ id: i + 2, s: 100, speed: 15 }],
      ]),
    ),
  );
  expect(result.allowed.has(1)).toBe(false);
  expect(result.speedCaps.has(1)).toBe(false);
  for (const id of [2, 3, 4]) expect(result.speedCaps.get(id)).toBe(12);
});
it("arbitrates reciprocal requests deterministically instead of braking both cars into a deadlock", () => {
  const a = {
      id: 1,
      position: 100,
      speed: 15,
      distance: 300,
      target: "b",
      corridor: ["b"],
    },
    b = { ...a, id: 2, target: "a", corridor: ["a"] };
  const cars = new Map([
    ["a", [{ id: 1, s: 100, speed: 15 }]],
    ["b", [{ id: 2, s: 100, speed: 15 }]],
  ]);
  const one = coordinateLaneMerges([a, b], cars),
    two = coordinateLaneMerges([b, a], cars);
  expect([...one.speedCaps]).toEqual([...two.speedCaps]);
  expect(one.speedCaps.has(1)).toBe(false);
  expect(one.speedCaps.get(2)).toBeLessThan(15);
});
it("reserves an empty target slot for only one converging car", () => {
  const first = {
    id: 1,
    position: 100,
    speed: 15,
    distance: 300,
    target: "middle",
    corridor: ["middle"],
  };
  const result = coordinateLaneMerges([first, { ...first, id: 2 }], new Map());
  expect([...result.allowed]).toEqual([1]);
  expect(result.speedCaps.get(2)).toBeLessThan(15);
});

it("delays an ordinary balancing move without slowing either lane to force a gap", () => {
  const request = {
    id: 1,
    position: 100,
    speed: 15,
    distance: 500,
    target: "next",
    corridor: ["next"],
    mandatory: false,
  };
  const result = coordinateLaneMerges(
    [request],
    new Map([
      [
        "next",
        [
          { id: 2, s: 100, speed: 15 },
          { id: 3, s: 110, speed: 15 },
        ],
      ],
    ]),
  );
  expect(result.allowed.size).toBe(0);
  expect(result.speedCaps.size).toBe(0);
});

it("arbitrates ordinary moves to one slot without a lane-change speed penalty", () => {
  const request = {
    id: 1,
    position: 100,
    speed: 15,
    distance: 500,
    target: "middle",
    corridor: ["middle"],
    mandatory: false,
  };
  const result = coordinateLaneMerges(
    [request, { ...request, id: 2 }],
    new Map(),
  );
  expect([...result.allowed]).toEqual([1]);
  expect(result.speedCaps.size).toBe(0);
});
