import { describe, expect, it } from "vitest";
import {
  transitionMarkings,
  separatorPaths,
} from "../src/core/transition-markings";
import { previewRoadMarkings } from "../src/render/road-markings";
import { updateAutomaticTransitions } from "../src/core/auto-transitions";
import { buildJunctions, roadRange } from "../src/core/junctions";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import {
  arcTable,
  boundaryPoint,
  dist,
  lanePoint,
  medianWidth,
  v,
} from "../src/core/math";
import type { Connection, Project } from "../src/core/types";

function pair(lanes = 3, target = lanes, twoWay = false) {
  const project = emptyProject();
  project.roads = [
    makeRoad(v(-100), v(), {
      id: "a",
      lanesStart: lanes,
      lanesEnd: lanes,
      twoWay,
      transitionMode: "smooth",
    }),
    makeRoad(v(), v(100), {
      id: "b",
      lanesStart: target,
      lanesEnd: target,
      twoWay,
      transitionMode: "smooth",
    }),
  ];
  updateAutomaticTransitions(project);
  return project;
}
function links(project: Project, pairs: number[][]): Connection[] {
  return pairs.map(([from, to]) => ({
    id: `a:${from}>b:${to}`,
    from: { road: project.roads[0].id, lane: from },
    to: { road: project.roads[1].id, lane: to },
    enabled: true,
    manual: true,
  }));
}

describe("routing-aware smooth separators", () => {
  it("withdraws shifted-route separators rather than drawing across actual driving centres", () => {
    const p = pair(),
      [a, b] = p.roads;
    const automatic = transitionMarkings(p, connections(p)),
      custom = transitionMarkings(
        p,
        links(p, [
          [0, 1],
          [1, 2],
        ]),
      );
    expect(automatic.get("a")![1][0].continuous).toBe(true);
    expect(custom.get("a")![1][0].continuous).toBe(false);
    expect(custom.get("b")![2][0].continuous).toBe(false);
    const from = separatorPaths(a, 1, undefined, custom.get("a"))[0],
      to = separatorPaths(b, 2, undefined, custom.get("b"))[0];
    expect(from.at(-1)!.x).toBeCloseTo(-24, 6);
    expect(to[0].x).toBeCloseTo(24, 6);
    for (const p of from) {
      const t = (p.x + 100) / 100;
      expect(dist(p, boundaryPoint(a, 1, t))).toBeLessThan(1e-7);
      expect(p.z).toBeGreaterThan(lanePoint(a, 0, t).z);
      expect(p.z).toBeLessThan(lanePoint(a, 1, t).z);
    }
    // The rejected old midpoint would be on lane1's actual centre at seam.
    expect(lanePoint(a, 1, 1).z).toBe(0);
    expect(from.every((p) => p.z === -2)).toBe(true);
  });

  it("keeps a physically supported authored partition while removing only its closed neighbour", () => {
    const p = pair(),
      a = p.roads[0],
      custom = transitionMarkings(
        p,
        links(p, [
          [0, 0],
          [1, 1],
        ]),
      );
    expect(custom.get("a")![1][0].continuous).toBe(true);
    expect(custom.get("a")![2][0].continuous).toBe(false);
    expect(separatorPaths(a, 1, undefined, custom.get("a"))[0].at(-1)).toEqual(
      boundaryPoint(a, 1, 1),
    );
    expect(
      separatorPaths(a, 2, undefined, custom.get("a"))[0].at(-1)!.x,
    ).toBeCloseTo(-24, 6);
  });

  it("a four-lane merge removes only two conflicting partitions and preserves the third", () => {
    const p = pair(4),
      a = p.roads[0],
      custom = transitionMarkings(
        p,
        links(p, [
          [0, 1],
          [1, 1],
          [2, 2],
          [3, 3],
        ]),
      );
    for (const index of [1, 2]) {
      expect(custom.get("a")![index][0].continuous).toBe(false);
      expect(
        separatorPaths(a, index, undefined, custom.get("a"))[0].at(-1)!.x,
      ).toBeCloseTo(-24, 6);
    }
    expect(custom.get("a")![3][0].continuous).toBe(true);
    expect(separatorPaths(a, 3, undefined, custom.get("a"))[0].at(-1)).toEqual(
      boundaryPoint(a, 3, 1),
    );
  });

  it.each([
    [
      "many-to-one",
      [
        [0, 0],
        [1, 0],
        [2, 2],
      ],
    ],
    [
      "one-to-many",
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [2, 2],
      ],
    ],
    [
      "crossing",
      [
        [0, 1],
        [1, 0],
        [2, 2],
      ],
    ],
    [
      "closed active lane",
      [
        [0, 0],
        [2, 2],
      ],
    ],
  ])(
    "leaves a conflicting %s collar unmarked without drawing route guides",
    (_, pairs) => {
      const p = pair(),
        a = p.roads[0],
        paint = transitionMarkings(p, links(p, pairs as number[][]));
      expect(paint.get("a")![1][0].continuous).toBe(false);
      const paths = separatorPaths(a, 1, undefined, paint.get("a"));
      expect(paths).toHaveLength(1);
      expect(paths[0].at(-1)!.x).toBeCloseTo(-24, 6);
      expect(paths[0].every((point) => point.z === -2)).toBe(true);
    },
  );

  it("uses 2→3 physical vanishing widths and keeps only genuine end ports", () => {
    const p = pair(2, 3),
      paint = transitionMarkings(p, connections(p)),
      b = p.roads[1];
    expect(b.autoTaper?.start).toBeDefined();
    expect(paint.get("b")?.[2]).toBeUndefined();
    const path = separatorPaths(b, 2, undefined, paint.get("b"))[0];
    expect(path[0].x).toBeGreaterThan(0);
    expect(path.every((point) => Number.isFinite(point.z))).toBe(true);
    expect(path.at(-1)).toEqual(boundaryPoint(b, 2, 1));
  });

  it.each([0, 2])(
    "preserves physical median changes for asymmetric 2+2→2+3 with a %im divider",
    (width) => {
      const p = pair(2, 3, true),
        [a, b] = p.roads;
      b.backwardLanesStart = b.backwardLanesEnd = 2;
      if (width) a.median = { kind: "concrete", width };
      updateAutomaticTransitions(p);
      const paint = transitionMarkings(p, connections(p));
      expect(paint.get("a")?.[2]).toBeUndefined();
      expect(paint.get("b")?.[2]).toBeUndefined();
      expect(medianWidth(a, 1)).toBe(medianWidth(b, 0));
      expect(dist(lanePoint(a, 2, 1), lanePoint(b, 2, 0))).toBeLessThan(1e-8);
      const preview = previewRoadMarkings(b);
      expect(preview.median.length).toBe(width ? 2 : 1);
    },
  );

  it("uses actual offset endpoint geometry and keeps the boundary seam continuous", () => {
    const p = pair(2),
      [a, b] = p.roads;
    for (const knot of b.knots)
      for (const point of [knot.p, knot.incoming, knot.outgoing]) point.z += 3;
    updateAutomaticTransitions(p);
    const paint = transitionMarkings(p, connections(p)),
      from = separatorPaths(a, 1, undefined, paint.get("a"))[0],
      to = separatorPaths(b, 1, undefined, paint.get("b"))[0];
    expect(dist(from.at(-1)!, to[0])).toBeLessThan(1e-8);
    expect(from.at(-1)!.z).toBe(3);
  });

  it("never turns a 3→2+1 fork mapping into crossing boundaries", () => {
    const p = pair(),
      a = p.roads[0];
    p.roads[1].lanesStart = p.roads[1].lanesEnd = 2;
    p.roads.push(
      makeRoad(v(0, 4), v(100, 20), {
        id: "branch",
        lanesStart: 1,
        lanesEnd: 1,
      }),
    );
    const mapping = [
        ...links(p, [
          [0, 0],
          [1, 1],
        ]),
        {
          id: "a:2>branch:0",
          from: { road: "a", lane: 2 },
          to: { road: "branch", lane: 0 },
          enabled: true,
        },
      ],
      paint = transitionMarkings(p, mapping);
    for (const index of [1, 2]) {
      expect(paint.get(a.id)![index][0].continuous).toBe(false);
      expect(
        separatorPaths(a, index, undefined, paint.get(a.id))[0].at(-1)!.x,
      ).toBeCloseTo(-24, 6);
    }
  });

  it("does not paint a real junction interior or consume editing-only insets", () => {
    const p = pair(2);
    p.roads.push(makeRoad(v(), v(0, 100), { id: "cross", twoWay: true }));
    const junctions = buildJunctions(p),
      paint = transitionMarkings(p, connections(p), junctions);
    expect(junctions).toHaveLength(1);
    expect(paint.size).toBe(0);
    const range = roadRange(p.roads[0], junctions),
      path = separatorPaths(p.roads[0], 1, range)[0];
    expect(path.at(-1)!.x).toBeLessThan(-1);
    expect(junctions[0].crosswalks).toBe(true);
  });

  it("removes all collar overrides after smooth is cancelled and never enables direct nodes", () => {
    const p = pair(),
      cs = links(p, [
        [0, 1],
        [1, 2],
      ]);
    expect(transitionMarkings(p, cs).size).toBe(2);
    p.roads.forEach((road) => {
      road.transitionMode = "direct";
    });
    updateAutomaticTransitions(p);
    const before = JSON.stringify(p);
    expect(transitionMarkings(p, cs).size).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
    expect(p.roads.every((road) => !road.autoTaper)).toBe(true);
    expect(separatorPaths(p.roads[0], 1)[0].at(-1)!.z).toBe(-2);
  });

  it("ignores disabled and malformed edges, and has no effect on unrelated roads", () => {
    const p = pair();
    const good = links(p, [
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
      initial = transitionMarkings(p, good);
    p.roads.push(makeRoad(v(-100, 80), v(100, 80), { id: "unrelated" }));
    const after = transitionMarkings(p, [
      ...good,
      { ...good[0], enabled: false, to: { road: "b", lane: 1 } },
      { ...good[0], to: { road: "missing", lane: 999 } },
    ]);
    expect(after.get("a")).toEqual(initial.get("a"));
    expect(after.has("unrelated")).toBe(false);
  });
});

describe("readable construction geometry", () => {
  it("shows actual boundaries rather than lane centres, including raised divider edges", () => {
    const road = pair(2, 2, true).roads[0];
    road.median = { kind: "concrete", width: 2 };
    const preview = previewRoadMarkings(road);
    expect(preview.edges).toHaveLength(2);
    expect(preview.lanes).toHaveLength(2);
    expect(preview.median).toHaveLength(2);
    expect(preview.lanes[0][0]).toEqual(boundaryPoint(road, 1, 0));
    expect(preview.edges[0][0].z).toBe(-9.35);
    expect(preview.median[0][0].y).toBeGreaterThan(0.28);
  });

  it("repeats sparse one-way arrows by curve arc length with a readable short-road arrow", () => {
    const short = makeRoad(v(), v(5), { lanesStart: 1, lanesEnd: 1 }),
      curved = makeRoad(v(), v(240, 80), { lanesStart: 1, lanesEnd: 1 });
    curved.knots[0].outgoing = v(5, 160);
    curved.knots[1].incoming = v(180, -80);
    const small = previewRoadMarkings(short),
      large = previewRoadMarkings(curved),
      table = arcTable(curved);
    expect(small.arrows).toHaveLength(1);
    expect(
      dist(small.arrows[0].path[0], small.arrows[0].path[1]),
    ).toBeGreaterThan(1);
    expect(large.arrows.length).toBeGreaterThan(5);
    const distances = large.arrows.map(
        (a) => table.find((row) => row.t >= a.t)!.s,
      ),
      gaps = distances.slice(1).map((s, i) => s - distances[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(3);
    expect(large.arrows[0].t).toBeLessThan(0.2);
    expect(large.arrows.at(-1)!.t).toBeGreaterThan(0.8);
  });
});
