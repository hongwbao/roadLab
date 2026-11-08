import { expect, it } from "vitest";
import { example, makeRoad } from "../src/core/model";
import { center, v } from "../src/core/math";
import {
  roadForks,
  forkPavement,
  forkEdgePaths,
  forkSurfaces,
} from "../src/core/road-forks";
const area = (a: number[]) => {
  let total = 0;
  for (let i = 0; i < a.length; i += 9)
    total +=
      Math.abs(
        (a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) -
          (a[i + 5] - a[i + 2]) * (a[i + 6] - a[i]),
      ) / 2;
  return total;
};
it("removes duplicate coplanar fork pavement and internal edge paint without cutting through lanes", () => {
  const trunk = makeRoad(v(0, 0), v(100, 0), { id: "trunk", width: 4 });
  const ref = makeRoad(v(-40, 0), v(), { id: "ref", width: 4 });
  const branch = makeRoad(
    v(0, 2),
    v(100, 25),
    {
      id: "branch",
      width: 4,
      lanesStart: 1,
      lanesEnd: 1,
      attachments: {
        start: { road: "ref", end: 1, lanes: [1], ownLanes: [0] },
      },
    },
    v(35, 2),
    v(70, 8),
  );
  const groups = roadForks([trunk, ref, branch]);
  expect(
    groups
      .get("branch")
      ?.pavement.map((r) => r.id)
      .sort(),
  ).toEqual(["ref", "trunk"]);
  expect(groups.get("trunk")?.pavement).toEqual([]);
  const cut = forkPavement(branch, { start: 0, end: 1 }, forkSurfaces([trunk]));
  const uncut = forkPavement(branch, { start: 0, end: 1 }, []);
  expect(area(cut)).toBeLessThan(area(uncut) * 0.9);
  expect(area(cut)).toBeGreaterThan(area(uncut) * 0.3);
  expect(
    forkEdgePaths([v(0, 3.88), v(100, 3.88)], forkSurfaces([branch]))[0][0].x,
  ).toBeGreaterThan(1);
  const bridge = structuredClone(trunk);
  for (const k of bridge.knots)
    for (const key of ["p", "incoming", "outgoing"] as const) k[key].y = 12;
  expect(
    area(forkPavement(branch, { start: 0, end: 1 }, forkSurfaces([bridge]))),
  ).toBeCloseTo(area(uncut), 7);
});
it("gives each cloverleaf ramp level shared-surface collars while retaining separated through roads", () => {
  const p = example("elevated"),
    groups = roadForks(p.roads);
  for (const ramp of p.roads.filter((r) => r.kind === "ramp")) {
    expect(groups.get(ramp.id)?.pavement.length).toBeGreaterThan(0);
    const start = center(ramp, 0),
      end = center(ramp, 1);
    const flat = ramp.id.endsWith("right") ? 0.105 : 0.095;
    expect(center(ramp, flat).y).toBeCloseTo(start.y, 8);
    expect(center(ramp, 1 - flat).y).toBeCloseTo(end.y, 8);
  }
  for (const road of p.roads.filter((r) => r.id.endsWith("main")))
    expect(
      groups.get(road.id)?.pavement.some((r) => r.kind === "ramp") ?? false,
    ).toBe(false);
});
