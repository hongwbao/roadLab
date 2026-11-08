import { expect, it } from "vitest";
import { connections, example, makeRoad } from "../src/core/model";
import {
  arcParameter,
  arcTable,
  center,
  dist,
  lanePoint,
  tangent,
  v,
} from "../src/core/math";
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
    groups = roadForks(p.roads),
    links = connections(p),
    roads = new Map(p.roads.map((r) => [r.id, r])),
    ramps = p.roads.filter((r) => r.kind === "ramp");
  expect(ramps).toHaveLength(56);
  let collars = 0,
    internalEnds = 0;
  for (const ramp of ramps) {
    for (const end of [0, 1] as const) {
      const attachment = ramp.attachments?.[end === 0 ? "start" : "end"];
      if (attachment) {
        collars++;
        // Only the family's outer ends share pavement with a wider collector.
        expect(groups.get(ramp.id)?.pavement.length).toBeGreaterThan(0);
        expect(roads.get(attachment.road)!.name).toContain("辅道");
        const flat = ramp.name.includes("右转") ? 0.105 : 0.095,
          table = arcTable(ramp),
          length = table.at(-1)!.s,
          t = arcParameter(table, end === 0 ? 12 : length - 12);
        expect(center(ramp, end === 0 ? flat : 1 - flat).y).toBeCloseTo(
          center(ramp, end).y,
          8,
        );
        expect(center(ramp, t).y).toBeCloseTo(center(ramp, end).y, 8);
        expect(tangent(ramp, end).y).toBeCloseTo(0, 8);
      } else {
        internalEnds++;
        // An automatic piece boundary follows the ramp's actual grade and
        // needs a smooth continuation, rather than another horizontal collar.
        const touching = links
          .filter((link) =>
            end === 0 ? link.to.road === ramp.id : link.from.road === ramp.id,
          )
          .filter((link) => {
            const ref = end === 0 ? link.from : link.to,
              next = roads.get(ref.road)!,
              at = end === 0 ? 1 : 0,
              a = tangent(ramp, end),
              b = tangent(next, at);
            return (
              dist(lanePoint(ramp, 0, end), lanePoint(next, ref.lane, at)) <
                1e-7 && a.x * b.x + a.y * b.y + a.z * b.z > 1 - 1e-7
            );
          });
        expect(
          touching.length,
          `${ramp.id}:${end} continuation`,
        ).toBeGreaterThan(0);
      }
    }
  }
  expect(collars).toBe(16);
  expect(internalEnds).toBe(96);
  const main = p.roads.filter((r) => r.name.startsWith("单向两车道"));
  expect(main).toHaveLength(32);
  for (const road of main)
    expect(
      groups.get(road.id)?.pavement.some((r) => r.kind === "ramp") ?? false,
    ).toBe(false);
});
