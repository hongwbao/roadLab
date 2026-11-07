import { expect, it } from "vitest";
import { buildJunctions, roadRange } from "../src/core/junctions";
import {
  center,
  normal,
  mul,
  add,
  pavementWidth,
  dist,
  v,
} from "../src/core/math";
import {
  roadCrosswalkQuads,
  roadSurfaceTriangles,
} from "../src/core/junction-crosswalks";
import { signalStopOffset } from "../src/core/traffic-signals";
import { emptyProject, makeRoad } from "../src/core/model";
import { addRoadsideLanes } from "../src/core/road-sections";
import type { V } from "../src/core/types";

/** Independent polygon clipping, rather than the placement algorithm's SAT test. */
function intersectionArea(subject: V[], clip: V[]) {
  let points = subject;
  const cross = (a: V, b: V, c: V) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length],
      output: V[] = [];
    for (let j = 0; j < points.length; j++) {
      const p = points[j],
        q = points[(j + 1) % points.length],
        cp = cross(a, b, p),
        cq = cross(a, b, q);
      if (cp >= 0) output.push(p);
      if (cp >= 0 !== cq >= 0) {
        const t = cp / (cp - cq);
        output.push({
          x: p.x + (q.x - p.x) * t,
          y: 0,
          z: p.z + (q.z - p.z) * t,
        });
      }
    }
    points = output;
  }
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const q = points[(i + 1) % points.length];
        return sum + p.x * q.z - p.z * q.x;
      }, 0),
    ) / 2
  );
}
export function skewFixture(angle = 30, length = 100) {
  const p = emptyProject(),
    opts = { twoWay: true, lanesStart: 2, lanesEnd: 2, width: 3.5, speed: 50 };
  p.roads = [
    makeRoad(v(-length, 0), v(), opts),
    makeRoad(v(), v(length, 0), opts),
    makeRoad(
      v(),
      v(
        length * Math.cos((angle * Math.PI) / 180),
        length * Math.sin((angle * Math.PI) / 180),
      ),
      opts,
    ),
  ];
  addRoadsideLanes(p, p.roads[1].id, "right");
  return p;
}
function verify(
  angle: number,
  side: "left" | "right" = "right",
  median = false,
  curved = false,
) {
  const p = skewFixture(angle, angle < 30 ? 250 : 100);
  if (side === "left") {
    p.roads[1] = makeRoad(v(), v(100, 0), {
      twoWay: true,
      lanesStart: 2,
      lanesEnd: 2,
      width: 3.5,
      speed: 50,
    });
    addRoadsideLanes(p, p.roads[1].id, "left");
  }
  if (median)
    for (const road of p.roads) road.median = { kind: "concrete", width: 2 };
  if (curved) p.roads[2].knots[1].incoming = v(45, 75);
  const j = buildJunctions(p)[0];
  expect(j.arms).toHaveLength(3);
  for (const arm of j.arms) {
    const road = p.roads.find((r) => r.id === arm.road)!;
    expect(arm.crosswalkT).toBeDefined();
    for (const quad of roadCrosswalkQuads(road, arm.crosswalkT!)) {
      expect(intersectionArea(quad, j.polygon)).toBeLessThan(1e-8);
      for (const other of p.roads)
        if (other.id !== road.id)
          for (const surface of roadSurfaceTriangles(
            other,
            roadRange(other, [j]),
          ))
            expect(intersectionArea(quad, surface.polygon)).toBeLessThan(1e-8);
    }
    expect(arm.trim + signalStopOffset(arm)).toBeGreaterThanOrEqual(
      arm.crosswalkDistance! + 2.5 - 1e-8,
    );
    for (const side of [-1, 1])
      expect(j.radius).toBeGreaterThan(
        dist(
          j.position,
          add(
            center(road, arm.end),
            mul(
              normal(road, arm.end),
              (side * pavementWidth(road, arm.end)) / 2,
            ),
          ),
        ),
      );
  }
  return { p, j };
}
it("keeps every zebra stripe outside the30degree junction after unilateral2+2to2+3 widening", () => {
  verify(30);
});
it.each([15, 25, 45, 60, 90, 120, 150])(
  "clears the junction surface at %i degrees",
  (angle) => {
    verify(angle);
  },
);
it.each(["left", "right"] as const)(
  "handles %s-side additions with a concrete median",
  (side) => {
    verify(30, side, true);
  },
);
it("clears a curved approach as well as straight skew approaches", () => {
  verify(30, "right", true, true);
});
it("leaves no zebra paint on the central median", () => {
  const { p, j } = verify(30, "right", true);
  for (const arm of j.arms) {
    const road = p.roads.find((r) => r.id === arm.road)!,
      n = normal(road, arm.crosswalkT!),
      c = center(road, arm.crosswalkT!);
    const divider = road.knots[0].p.z; // East-west expanded road divider remains its editable reference.
    if (road.id !== p.roads[1].id) continue;
    for (const quad of roadCrosswalkQuads(road, arm.crosswalkT!)) {
      const z = quad.map((p) => p.z - divider);
      expect(Math.min(...z) >= 1 - 1e-8 || Math.max(...z) <= -1 + 1e-8).toBe(
        true,
      );
    }
    expect(c.x).toBeGreaterThan(0);
    expect(n.z).toBeCloseTo(1);
  }
});

it("omits a crossing where a very short acute approach has no physically clear space", () => {
  const p = skewFixture(15);
  for (const arm of buildJunctions(p)[0].arms)
    if (arm.crosswalkT !== undefined) {
      const j = buildJunctions(p)[0],
        road = p.roads.find((r) => r.id === arm.road)!;
      for (const quad of roadCrosswalkQuads(road, arm.crosswalkT))
        for (const other of p.roads)
          if (other.id !== road.id)
            for (const surface of roadSurfaceTriangles(
              other,
              roadRange(other, [j]),
            ))
              expect(intersectionArea(quad, surface.polygon)).toBeLessThan(
                1e-8,
              );
    }
});
