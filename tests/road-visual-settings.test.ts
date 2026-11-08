import { describe, expect, it } from "vitest";
import { buildLaneJunctions } from "../src/core/lane-junctions";
import { connections, parseProject } from "../src/core/model";
import {
  initializeRoadVisuals,
  isNodeSmooth,
  logicalProjectSignature,
  logicalRoadSignature,
  nodeVisualKey,
  remapRoadVisuals,
  setNodeSmooth,
  validateRoadVisuals,
} from "../src/core/road-visual-settings";
import type {
  Blueprint,
  Project,
  Road,
  RoadVisualArm,
  RoadVisualSettings,
} from "../src/core/types";

function road(
  id: string,
  start: number,
  end: number,
  options: Partial<Road> = {},
): Road {
  const p = (x: number) => ({ x, y: 0, z: 0 });
  return {
    id,
    name: id,
    knots: [
      {
        p: p(start),
        incoming: p(start),
        outgoing: p(start + (end - start) / 3),
      },
      { p: p(end), incoming: p(end - (end - start) / 3), outgoing: p(end) },
    ],
    lanesStart: 3,
    lanesEnd: 3,
    twoWay: false,
    width: 4,
    speed: 60,
    align: "center",
    kind: "road",
    transitionStart: 0,
    transitionEnd: 1,
    transitionMode: "direct",
    ...options,
  };
}
function project(roads = [road("a", -120, 0), road("b", 0, 120)]): Project {
  return {
    version: 1,
    name: "节点视觉设置",
    roads,
    connections: [],
    ports: [],
    templates: [],
  };
}
const join = (a = "a", b = "b"): { arms: RoadVisualArm[] } => ({
  arms: [
    { road: a, end: 1 },
    { road: b, end: 0 },
  ],
});
const visualSettings = (node = join()): RoadVisualSettings => ({
  version: 1,
  nodes: [
    { arms: node.arms.map(({ road, end }) => ({ road, end })), smooth: true },
  ],
});
function blueprint(id: string, roads: Road[]): Blueprint {
  return { id, name: id, roads, connections: [] };
}

describe("node visual metadata", () => {
  it("keys complete arm sets without coordinates, ordering, aliases or mutation", () => {
    const node = {
        arms: [
          { road: "z:0", end: 0 as const },
          { road: "a", end: 1 as const },
        ],
        position: { x: 18, y: 0, z: 7 },
      },
      before = structuredClone(node);
    expect(nodeVisualKey(node)).toBe(
      nodeVisualKey({ arms: [...node.arms].reverse() }),
    );
    expect(nodeVisualKey(node)).not.toBe(
      nodeVisualKey({
        arms: [
          { road: "z", end: 0 },
          { road: "a:0", end: 1 },
        ],
      }),
    );
    expect(nodeVisualKey(node)).not.toBe(
      nodeVisualKey({ arms: [...node.arms, { road: "c", end: 0 }] }),
    );
    expect(node).toEqual(before);
  });

  it("queries frozen legacy projects without migrating or creating settings", () => {
    const p = project();
    p.roads[1].transitionMode = "smooth";
    const before = structuredClone(p);
    Object.freeze(p);
    expect(isNodeSmooth(p, join())).toBe(false);
    expect(p).toEqual(before);
    expect(p.roadVisuals).toBeUndefined();
  });

  it("changes only visual metadata and makes apply/cancel idempotent", () => {
    const p = project();
    p.junctionLaneConnections = [
      { from: { road: "a", lane: 2, end: 1 }, to: [] },
    ];
    const before = structuredClone(p),
      node = join();
    expect(setNodeSmooth(p, node, false)).toBe(false);
    expect(p).toEqual(before);
    expect(setNodeSmooth(p, node, true)).toBe(true);
    const applied = structuredClone(p);
    expect(setNodeSmooth(p, { arms: [...node.arms].reverse() }, true)).toBe(
      false,
    );
    expect(p).toEqual(applied);
    expect(isNodeSmooth(p, node)).toBe(true);
    expect({ ...p, roadVisuals: undefined }).toEqual({
      ...before,
      roadVisuals: undefined,
    });
    expect(setNodeSmooth(p, node, false)).toBe(true);
    expect(setNodeSmooth(p, node, false)).toBe(false);
    expect(p.roadVisuals).toEqual({ version: 1, nodes: [] });
    expect(p.junctionLaneConnections![0].to).toEqual([]);
  });

  it("keeps the two nodes of one road independent and saves only arm references", () => {
    const p = project([
        road("a", -120, 0),
        road("b", 0, 120),
        road("c", 120, 240),
      ]),
      [left, right] = buildLaneJunctions(p);
    expect(left.arms.some((arm) => "trim" in arm)).toBe(true);
    setNodeSmooth(p, left, true);
    expect(isNodeSmooth(p, left)).toBe(true);
    expect(isNodeSmooth(p, right)).toBe(false);
    setNodeSmooth(p, right, true);
    setNodeSmooth(p, left, false);
    expect(isNodeSmooth(p, left)).toBe(false);
    expect(isNodeSmooth(p, right)).toBe(true);
    expect(p.roadVisuals!.nodes).toEqual([
      { arms: join("b", "c").arms, smooth: true },
    ]);
  });

  it("does not create a smooth target for an isolated end or one road's loop", () => {
    const p = project();
    expect(setNodeSmooth(p, { arms: [{ road: "a", end: 1 }] }, true)).toBe(
      false,
    );
    expect(
      setNodeSmooth(
        p,
        {
          arms: [
            { road: "a", end: 0 },
            { road: "a", end: 1 },
          ],
        },
        true,
      ),
    ).toBe(false);
    expect(p.roadVisuals).toBeUndefined();
  });
});

describe("legacy road visual migration", () => {
  it("round-trips direct projects and templates without adding visual metadata", () => {
    const p = project();
    p.templates = [
      blueprint("template", [road("ta", -120, 0), road("tb", 0, 120)]),
    ];
    const text = JSON.stringify(p),
      loaded = parseProject(text);
    expect(loaded).toEqual(p);
    expect(Object.hasOwn(loaded, "roadVisuals")).toBe(false);
    expect(Object.hasOwn(loaded.templates[0], "roadVisuals")).toBe(false);
    initializeRoadVisuals(loaded);
    expect(JSON.stringify(loaded)).toBe(text);
  });

  it("retains a migration marker for legacy visual intent with no connected target", () => {
    const p = project([road("a", 0, 120, { transitionMode: "smooth" })]);
    initializeRoadVisuals(p);
    expect(p.roadVisuals).toEqual({ version: 1, nodes: [] });
    expect(p.roads[0].transitionMode).toBe("direct");
  });

  it("migrates requested roads to actual connected nodes on the direct baseline", () => {
    const p = project([
      road("a", -120, 0),
      road("b", 0, 120, {
        lanesStart: 5,
        lanesEnd: 5,
        transitionMode: "smooth",
        autoTaper: { start: { lanes: 3, firstLane: 1, offset: 40, span: 0.5 } },
      }),
      road("c", 120, 240),
      road("isolated", 500, 620, { transitionMode: "smooth" }),
    ]);
    p.junctionLaneConnections = [
      { from: { road: "a", lane: 1, end: 1 }, to: [] },
    ];
    const baseline = logicalProjectSignature(p),
      roads = p.roads;
    initializeRoadVisuals(p);
    expect(p.roadVisuals!.nodes.map(nodeVisualKey)).toEqual([
      nodeVisualKey(join()),
      nodeVisualKey(join("b", "c")),
    ]);
    expect(p.roads).toBe(roads);
    expect(
      p.roads.every(
        (r) => r.transitionMode === "direct" && r.autoTaper === undefined,
      ),
    ).toBe(true);
    expect(logicalProjectSignature(p)).toBe(baseline);
    expect(p.junctionLaneConnections![0].to).toEqual([]);
    const after = structuredClone(p);
    initializeRoadVisuals(p);
    expect(p).toEqual(after);
    expect(() => validateRoadVisuals(p)).not.toThrow();
  });

  it("uses old autoTaper only when there is no explicit transition mode", () => {
    for (const mode of [undefined, "direct"] as const) {
      const p = project();
      p.roads[1].transitionMode = mode;
      p.roads[1].autoTaper = {
        start: { lanes: 2, firstLane: 0, offset: 0, span: 0.4 },
      };
      initializeRoadVisuals(p);
      expect(isNodeSmooth(p, join())).toBe(mode === undefined);
      expect(p.roads[1].autoTaper).toBeUndefined();
    }
  });

  it("never reopens a cancelled migrated setting from stale road or replacement flags", () => {
    const p = project();
    p.roadVisuals = { version: 1, nodes: [] };
    p.roads[1].transitionMode = "smooth";
    p.roads[1].replacedSection = { ...p.roads[1] };
    const settings = p.roadVisuals;
    initializeRoadVisuals(p);
    expect(p.roadVisuals).toBe(settings);
    expect(isNodeSmooth(p, join())).toBe(false);
    expect(p.roads[1].transitionMode).toBe("direct");
    expect(p.roads[1].replacedSection!.transitionMode).toBe("direct");
  });

  it("migrates templates independently and does not overwrite their existing settings", () => {
    const p = project();
    p.roadVisuals = { version: 1, nodes: [] };
    const legacy = blueprint("legacy", [
        road("ta", -120, 0),
        road("tb", 0, 120, { transitionMode: "smooth" }),
      ]),
      migrated = blueprint("migrated", [
        road("ma", -120, 0),
        road("mb", 0, 120, { transitionMode: "smooth" }),
      ]);
    migrated.roadVisuals = { version: 1, nodes: [] };
    p.templates = [legacy, migrated];
    initializeRoadVisuals(p);
    expect(isNodeSmooth(p, join())).toBe(false);
    expect(isNodeSmooth(legacy, join("ta", "tb"))).toBe(true);
    expect(isNodeSmooth(migrated, join("ma", "mb"))).toBe(false);
    expect(() => validateRoadVisuals(p)).not.toThrow();
  });

  it("preserves real profiles, offsets, medians, directions, knots, rules and demand", () => {
    const p = project();
    Object.assign(p.roads[1], {
      transitionMode: "smooth",
      lanesEnd: 5,
      twoWay: true,
      backwardLanesStart: 2,
      backwardLanesEnd: 2,
      sectionOffset: 3,
      median: { kind: "concrete", width: 2 },
      widthOrigin: 5,
      profile: {
        from: 3,
        to: 5,
        fromBackward: 2,
        toBackward: 2,
        start: 0,
        end: 1,
        transitionStart: 0.2,
        transitionEnd: 0.8,
      },
    });
    p.ports = [
      {
        road: "a",
        end: "start",
        type: "source",
        rate: 30,
        destinations: [{ road: "b", end: "end", weight: 7 }],
      },
    ];
    p.junctionLaneConnections = [
      { from: { road: "a", lane: 0, end: 1 }, to: [] },
    ];
    const before = structuredClone(p);
    initializeRoadVisuals(p);
    const expected = structuredClone(before);
    for (const r of expected.roads) r.transitionMode = "direct";
    expect({ ...p, roadVisuals: undefined }).toEqual({
      ...expected,
      roadVisuals: undefined,
    });
  });
});

describe("visual metadata at structural boundaries", () => {
  function branch() {
    const next = road("c", 0, 120);
    for (const knot of next.knots)
      for (const part of ["p", "incoming", "outgoing"] as const) {
        const position = knot[part];
        knot[part] = { x: 0, y: position.y, z: position.x };
      }
    return next;
  }

  it("extends a saved node to the full current arm set without changing its logical graph", () => {
    const p = project();
    setNodeSmooth(p, join(), true);
    p.roads.push(branch());
    p.junctionLaneConnections = [
      { from: { road: "a", lane: 1, end: 1 }, to: [] },
    ];
    const signature = logicalProjectSignature(p),
      links = connections(p),
      roads = structuredClone(p.roads),
      [node] = buildLaneJunctions(p);
    expect(node.arms).toHaveLength(3);
    expect(isNodeSmooth(p, node)).toBe(false);
    initializeRoadVisuals(p);
    expect(isNodeSmooth(p, node)).toBe(true);
    expect(p.roadVisuals).toEqual(visualSettings(node));
    expect(p.roads).toEqual(roads);
    expect(logicalProjectSignature(p)).toBe(signature);
    expect(connections(p)).toEqual(links);
    expect(p.junctionLaneConnections[0].to).toEqual([]);
    const after = structuredClone(p);
    initializeRoadVisuals(p);
    expect(p).toEqual(after);
  });

  it("drops separated arms instead of passing the effect through one arm to a new branch", () => {
    const p = project();
    setNodeSmooth(p, join(), true);
    p.roads.push(branch());
    for (const knot of p.roads[1].knots)
      for (const part of ["p", "incoming", "outgoing"] as const)
        knot[part].z += 40;
    const signature = logicalProjectSignature(p),
      [node] = buildLaneJunctions(p);
    expect(node.arms.map((arm) => arm.road).sort()).toEqual(["a", "c"]);
    initializeRoadVisuals(p);
    expect(p.roadVisuals).toEqual({ version: 1, nodes: [] });
    expect(isNodeSmooth(p, node)).toBe(false);
    expect(logicalProjectSignature(p)).toBe(signature);
  });

  it("keeps an explicitly direct marker closed despite branch creation and stale flags", () => {
    const p = project();
    setNodeSmooth(p, join(), true);
    setNodeSmooth(p, join(), false);
    const marker = p.roadVisuals;
    p.roads.push(branch());
    p.roads[1].transitionMode = "smooth";
    p.roads[1].autoTaper = {
      start: { lanes: 2, firstLane: 0, offset: 2, span: 0.4 },
    };
    initializeRoadVisuals(p);
    expect(p.roadVisuals).toBe(marker);
    expect(p.roadVisuals).toEqual({ version: 1, nodes: [] });
    expect(buildLaneJunctions(p).every((node) => !isNodeSmooth(p, node))).toBe(
      true,
    );
    expect(p.roads[1].transitionMode).toBe("direct");
    expect(p.roads[1].autoTaper).toBeUndefined();
  });

  it("deduplicates two old targets when their arms join the same current node", () => {
    const p = project([
      road("a", -120, 0),
      road("b", 0, 120),
      road("c", 80, 200),
      road("d", 200, 320),
    ]);
    setNodeSmooth(p, join(), true);
    setNodeSmooth(p, join("c", "d"), true);
    for (const next of p.roads.slice(2))
      for (const knot of next.knots)
        for (const part of ["p", "incoming", "outgoing"] as const)
          knot[part].x -= 200;
    const node = buildLaneJunctions(p).find(
      (candidate) => candidate.arms.length === 4,
    )!;
    expect(node).toBeDefined();
    initializeRoadVisuals(p);
    expect(p.roadVisuals).toEqual(visualSettings(node));
    expect(() => validateRoadVisuals(p)).not.toThrow();
  });
});

describe("saved road visual validation", () => {
  it("accepts optional/empty settings and leaves valid settings untouched", () => {
    const p = project();
    expect(() => validateRoadVisuals(p)).not.toThrow();
    p.roadVisuals = { version: 1, nodes: [] };
    expect(() => validateRoadVisuals(p)).not.toThrow();
    p.roadVisuals = visualSettings();
    const before = structuredClone(p);
    validateRoadVisuals(p);
    expect(p).toEqual(before);
  });

  it.each([
    null,
    [],
    { version: 2, nodes: [] },
    { version: 1, nodes: {} },
    { version: 1, nodes: [null] },
    { version: 1, nodes: [{ arms: join().arms, smooth: false }] },
    { version: 1, nodes: [{ arms: [{ road: "a", end: 1 }], smooth: true }] },
    {
      version: 1,
      nodes: [{ arms: [{ road: "a", end: 1 }, null], smooth: true }],
    },
    {
      version: 1,
      nodes: [
        {
          arms: [
            { road: "a", end: 1 },
            { road: "b", end: 2 },
          ],
          smooth: true,
        },
      ],
    },
    {
      version: 1,
      nodes: [
        {
          arms: [
            { road: "a", end: 1 },
            { road: "missing", end: 0 },
          ],
          smooth: true,
        },
      ],
    },
    {
      version: 1,
      nodes: [
        {
          arms: [
            { road: "a", end: 1 },
            { road: "a", end: 1 },
          ],
          smooth: true,
        },
      ],
    },
    {
      version: 1,
      nodes: [
        {
          arms: [
            { road: "a", end: 0 },
            { road: "a", end: 1 },
          ],
          smooth: true,
        },
      ],
    },
  ])(
    "rejects malformed metadata %# without rewriting the project",
    (settings) => {
      const p = project();
      p.roadVisuals = settings as RoadVisualSettings;
      const before = structuredClone(p);
      expect(() => validateRoadVisuals(p)).toThrow();
      expect(p).toEqual(before);
    },
  );

  it("rejects duplicate node sets even in different arm orders", () => {
    const p = project();
    p.roadVisuals = visualSettings();
    p.roadVisuals.nodes.push({
      arms: [...join().arms].reverse(),
      smooth: true,
    });
    expect(() => validateRoadVisuals(p)).toThrow("重复");
  });

  it("rejects a reused arm across different node targets", () => {
    const p = project([
      road("a", -120, 0),
      road("b", 0, 120),
      road("c", 0, 240),
    ]);
    p.roadVisuals = visualSettings();
    p.roadVisuals.nodes.push({ arms: join("a", "c").arms, smooth: true });
    expect(() => validateRoadVisuals(p)).toThrow("多个");
  });

  it("checks blueprint references within the blueprint instead of the main road table", () => {
    const p = project();
    p.templates = [
      blueprint("template", [road("ta", -120, 0), road("tb", 0, 120)]),
    ];
    p.templates[0].roadVisuals = visualSettings();
    expect(() => validateRoadVisuals(p)).toThrow("引用");
  });
});

describe("visual reference maintenance", () => {
  it("remaps split/reversed endpoints without touching source arrays or logical data", () => {
    const p = project();
    p.roadVisuals = visualSettings();
    const before = structuredClone(p),
      oldArms = p.roadVisuals.nodes[0].arms;
    remapRoadVisuals(p, (arm) => {
      if (arm.road === "a" && arm.end === 1) arm.road = "a-back";
      if (arm.road === "b") arm.end = arm.end === 0 ? 1 : 0;
      return arm;
    });
    expect(oldArms).toEqual(before.roadVisuals!.nodes[0].arms);
    expect(p.roadVisuals.nodes).toEqual([
      {
        arms: [
          { road: "a-back", end: 1 },
          { road: "b", end: 1 },
        ],
        smooth: true,
      },
    ]);
    expect({ ...p, roadVisuals: undefined }).toEqual({
      ...before,
      roadVisuals: undefined,
    });
  });

  it("prunes deleted arms while retaining valid two-road nodes and the migration marker", () => {
    const p = project();
    p.roadVisuals = visualSettings({
      arms: [...join().arms, { road: "c", end: 0 }],
    });
    remapRoadVisuals(p, (arm) => (arm.road === "c" ? undefined : arm));
    expect(p.roadVisuals).toEqual(visualSettings());
    remapRoadVisuals(p, (arm) => (arm.road === "a" ? undefined : arm));
    expect(p.roadVisuals).toEqual({ version: 1, nodes: [] });
  });

  it("deduplicates collapsed node sets and arms during copies or merges", () => {
    const p = project();
    p.roadVisuals = {
      version: 1,
      nodes: [
        { arms: [...join().arms, { road: "b-copy", end: 0 }], smooth: true },
        { arms: join("a-copy", "b-copy").arms, smooth: true },
      ],
    };
    remapRoadVisuals(p, (arm) => ({
      ...arm,
      road: arm.road.replace("-copy", ""),
    }));
    expect(p.roadVisuals).toEqual(visualSettings());
  });

  it("does not create settings for an unmigrated project", () => {
    const p = project(),
      before = structuredClone(p);
    remapRoadVisuals(p, (arm) => arm);
    expect(p).toEqual(before);
  });
});

describe("logical cache and history signatures", () => {
  it("ignores project/template display metadata and all legacy road visual fields", () => {
    const p = project();
    p.templates = [
      blueprint("template", [road("ta", -120, 0), road("tb", 0, 120)]),
    ];
    p.roads[0].replacedSection = { ...p.roads[0] };
    const before = logicalProjectSignature(p),
      roadBefore = logicalRoadSignature(p.roads);
    setNodeSmooth(p, join(), true);
    setNodeSmooth(p.templates[0], join("ta", "tb"), true);
    p.roads[0].transitionMode = "smooth";
    p.roads[0].autoTaper = {
      end: { lanes: 2, firstLane: 0, offset: 2, span: 0.4 },
    };
    p.roads[0].replacedSection!.transitionMode = "smooth";
    p.templates[0].roads[0].transitionMode = "smooth";
    p.templates[0].roads[0].autoTaper = p.roads[0].autoTaper;
    expect(logicalProjectSignature(p)).toBe(before);
    expect(logicalRoadSignature(p.roads)).toBe(roadBefore);
  });

  it.each([
    (p: Project) => {
      p.name += "改";
    },
    (p: Project) => {
      p.roads[0].knots[0].p.x += 1;
    },
    (p: Project) => {
      p.roads[0].speed += 10;
    },
    (p: Project) => {
      p.roads[0].lanesStart += 1;
    },
    (p: Project) => {
      p.roads[0].sectionOffset = 2;
    },
    (p: Project) => {
      p.roads[0].twoWay = true;
      p.roads[0].backwardLanesStart = 2;
    },
    (p: Project) => {
      p.roads[0].median = { kind: "concrete", width: 2 };
    },
    (p: Project) => {
      p.roads[0].profile = {
        from: 3,
        to: 5,
        start: 0,
        end: 1,
        transitionStart: 0.1,
        transitionEnd: 0.9,
      };
    },
    (p: Project) => {
      p.junctionLaneConnections = [
        { from: { road: "a", lane: 0, end: 1 }, to: [] },
      ];
    },
    (p: Project) => {
      p.connections = [
        {
          id: "custom",
          from: { road: "a", lane: 0 },
          to: { road: "b", lane: 2 },
          enabled: true,
        },
      ];
    },
    (p: Project) => {
      p.trafficBaseRate = 25;
    },
    (p: Project) => {
      p.laneLookahead = 250;
    },
    (p: Project) => {
      p.ports = [
        {
          road: "a",
          end: "start",
          type: "source",
          rate: 25,
          destinations: [{ road: "b", end: "end", weight: 2 }],
        },
      ];
    },
    (p: Project) => {
      p.templates[0].roads[0].speed += 5;
    },
  ])("retains meaningful authored changes in signatures %#", (change) => {
    const p = project();
    p.templates = [
      blueprint("template", [road("ta", -120, 0), road("tb", 0, 120)]),
    ];
    const before = logicalProjectSignature(p);
    change(p);
    expect(logicalProjectSignature(p)).not.toBe(before);
  });

  it("does not mutate frozen snapshots while producing either signature", () => {
    const p = project();
    p.roadVisuals = visualSettings();
    const before = structuredClone(p);
    Object.freeze(p);
    p.roads.forEach(Object.freeze);
    expect(logicalProjectSignature(p)).toBeTypeOf("string");
    expect(logicalRoadSignature(p.roads)).toBeTypeOf("string");
    expect(p).toEqual(before);
  });
});
