import { expect, it } from "vitest";
import {
  emptyProject,
  makeRoad,
  normalizePorts,
  parseProject,
  setBoundary,
} from "../src/core/model";
import { v } from "../src/core/math";
import {
  chooseDestination,
  destinationShares,
  entryPercent,
  setDestinationPercent,
  setTrafficBaseRate,
  sourceDemandRate,
  sourceLanes,
  trafficBaseRate,
} from "../src/core/traffic-demand";
function fixture() {
  const p = emptyProject();
  p.roads = [
    makeRoad(v(), v(200, 0), { id: "in", lanesStart: 4, lanesEnd: 4 }),
    ...["a", "b", "c", "d"].map((id, i) =>
      makeRoad(v(200, 0), v(400, (i - 1) * 100), { id }),
    ),
  ];
  p.ports = [
    { road: "in", end: "start", type: "source", rate: 50 },
    ...["a", "b", "c", "d"].map((road) => ({
      road,
      end: "end" as const,
      type: "sink" as const,
      rate: 1,
    })),
  ];
  return p;
}
it("defines100% as50 total per entry, independent of its four lanes", () => {
  const p = fixture(),
    s = p.ports[0];
  expect(trafficBaseRate(p)).toBe(50);
  expect(entryPercent(p, s)).toBe(100);
  expect(sourceDemandRate(p, s)).toBe(50);
  expect(sourceLanes(p, s)).toEqual([0, 1, 2, 3]);
  expect(destinationShares(p, s).map((d) => d.percent)).toEqual([
    25, 25, 25, 25,
  ]);
  p.trafficMultiplier = 2;
  expect(sourceDemandRate(p, s)).toBe(100);
  s.rate = 25;
  expect(sourceDemandRate(p, s)).toBe(50);
});
it("locks the edited percentage and proportionally redistributes all others", () => {
  const p = fixture(),
    s = p.ports[0];
  setDestinationPercent(p, s, p.ports[1], 70);
  expect(destinationShares(p, s).map((d) => d.percent)).toEqual([
    70, 10, 10, 10,
  ]);
  setDestinationPercent(p, s, p.ports[2], 40);
  const d = destinationShares(p, s);
  expect(d[1].percent).toBeCloseTo(40);
  expect(d[0].percent / d[2].percent).toBeCloseTo(7);
  expect(d.reduce((n, d) => n + d.percent, 0)).toBeCloseTo(100);
});
it("chooses destinations by weight with zero shares excluded and no source self-loop", () => {
  const p = fixture(),
    s = p.ports[0];
  s.type = "both";
  setDestinationPercent(p, s, p.ports[1], 100);
  for (const random of [0, 0.1, 0.5, 0.999999, 1])
    expect(chooseDestination(p, s, random)?.road).toBe("a");
  expect(destinationShares(p, s)).toHaveLength(4);
  s.destinations = [];
  expect(chooseDestination(p, s, 0.5)).toBeUndefined();
  expect(sourceDemandRate(p, s)).toBe(0);
});
it("changes the100% base while retaining each entry ratio and legacy actual rates on load", () => {
  const p = fixture(),
    s = p.ports[0];
  s.rate = 25;
  setTrafficBaseRate(p, 80);
  expect(s.rate).toBe(40);
  expect(entryPercent(p, s)).toBe(50);
  delete p.trafficBaseRate;
  s.rate = 24;
  const old = parseProject(JSON.stringify(p));
  expect(old.ports[0].rate).toBe(24);
  expect(trafficBaseRate(old)).toBe(50);
});
it("validates profile JSON and preserves explicit zero and saved shares", () => {
  const p = fixture(),
    s = p.ports[0];
  setDestinationPercent(p, s, p.ports[1], 0);
  expect(parseProject(JSON.stringify(p)).ports[0].destinations).toEqual(
    s.destinations,
  );
  for (const destinations of [
    [{ road: "a", end: "end", weight: -1 }],
    [{ road: "a", end: "end", weight: 101 }],
    [{ road: "missing", end: "end", weight: 50 }],
    [
      { road: "a", end: "end", weight: 50 },
      { road: "a", end: "end", weight: 50 },
    ],
    {},
  ])
    expect(() =>
      parseProject(
        JSON.stringify({
          ...p,
          ports: [{ ...s, destinations }, ...p.ports.slice(1)],
        }),
      ),
    ).toThrow();
});
it("new boundary portals use100%, and removing exits prunes authored destinations", () => {
  const p = fixture();
  p.ports = [];
  setBoundary(p, "in", "start");
  expect(p.ports[0].rate).toBe(50);
  setBoundary(p, "a", "end");
  setBoundary(p, "b", "end");
  setDestinationPercent(p, p.ports[0], p.ports[1], 60);
  p.ports = p.ports.filter((d) => d.road !== "a");
  normalizePorts(p);
  expect(p.ports[0].destinations).toHaveLength(1);
  expect(destinationShares(p, p.ports[0])[0].percent).toBe(100);
});
