import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  createCS2RoadResultWorld,
  cs2ProcessRoadIntersectionResults,
  CS2RoadCourseHeightData,
  createCS2RoadIntersectionWorld,
  cs2CollectRoadCourses,
  cs2FindRoadCourseOverlaps,
  cs2CheckRoadCourseIntersections,
  cs2QuadRoadIntersection,
  cs2CircleRoadIntersection,
  cs2GetRoadAuxiliaryCourse,
  cs2GetRoadAuxiliaryDefinition,
  type CS2RoadIntersectionWorld,
} from "../src/core/cs2-road-intersections";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-intersections-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: any;
  heightProvenance: any;
  resultsProvenance: any;
  cases: { name: string; input: any; expected: any }[];
};
function world(input: Record<string, any> = {}) {
  const w: Record<string, any> = {};
  for (const [key, value] of Object.entries(input))
    w[key] = [
      "deleted",
      "buildings",
      "fixed",
      "serviceUpgrades",
      "prefabBuildingExtensions",
      "prefabServiceUpgrades",
    ].includes(key)
      ? new Set(value)
      : new Map(Object.entries(value));
  return createCS2RoadIntersectionWorld(w as Partial<CS2RoadIntersectionWorld>);
}
function compare(actual: any, expected: any, path = "result") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    if (
      /\.(flags|general|left|right|randomSeed|parentMesh|fixedIndex|courseIndex|auxIndex)$/.test(
        path,
      )
    )
      expect(actual, path).toBe(expected);
    else
      expect(
        Math.abs(actual - Math.fround(expected)),
        path + ` actual=${actual} expected=${expected}`,
      ).toBeLessThanOrEqual(Math.max(3e-6, Math.abs(expected) * 1.5e-6));
  } else if (
    expected === "NaN" ||
    expected === "Infinity" ||
    expected === "-Infinity"
  )
    expect(String(actual), path).toBe(expected);
  else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect(actual.length, path).toBe(expected.length);
    for (let i = 0; i < expected.length; i++)
      compare(actual[i], expected[i], `${path}[${i}]`);
  } else if (expected !== null && typeof expected === "object") {
    expect(Object.keys(actual).sort(), path).toEqual(
      Object.keys(expected).sort(),
    );
    for (const key of Object.keys(expected))
      compare(actual[key], expected[key], `${path}.${key}`);
  } else expect(actual, path).toEqual(expected);
}
function terrainReader(t: any) {
  const f = Math.fround,
    add = (a: number, b: number) => f(f(a) + f(b)),
    mul = (a: number, b: number) => f(f(a) * f(b)),
    ground = (p: any) =>
      add(
        add(add(t.base, mul(p.x, t.x)), mul(p.z, t.z)),
        mul(t.amplitude, f(Math.sin(mul(add(p.x, p.z), t.frequency)))),
      );
  return {
    terrainHeight: ground,
    waterDepth: () => t.depth,
    sampleHeight: (p: any) => ({
      terrainHeight: ground(p),
      waterHeight: t.water,
      waterDepth: t.depth,
    }),
  };
}
function run(input: any): any {
  if (input.op === "results" || input.op === "complete") {
    const wire = input.world,
      w: any = world(
        Object.fromEntries(
          Object.entries(wire).filter(([key]) => key !== "terrain"),
        ),
      );
    for (const key of [
      "fixed",
      "serviceUpgrades",
      "prefabBuildingExtensions",
      "prefabServiceUpgrades",
    ])
      if (wire[key] !== undefined) w[key] = new Set(wire[key]);
    const full = createCS2RoadResultWorld({
        ...w,
        terrain: terrainReader(wire.terrain),
      }),
      intersections =
        input.op === "complete"
          ? cs2CheckRoadCourseIntersections(
              full,
              input.courses,
              input.overlaps,
              new Map(Object.entries(input.deletedEntities ?? {})),
            ).intersections
          : input.intersections;
    return cs2ProcessRoadIntersectionResults(
      full,
      input.courses,
      intersections,
      {
        deletedEntities: new Map(Object.entries(input.deletedEntities ?? {})),
        editorMode: input.editorMode,
        leftHandTraffic: input.leftHandTraffic,
      },
    );
  }

  if (input.op === "height") {
    const terrain = terrainReader(input.terrain),
      data = new CS2RoadCourseHeightData(
        input.course,
        input.geometry,
        input.sampleTerrain,
        terrain,
      );
    const snapshot = () =>
      structuredClone({
        sampleRange: data.sampleRange,
        sampleFactor: data.sampleFactor,
        samples: data.samples,
      });
    const results = input.operations.map((op: any) => {
      switch (op.kind) {
        case "initialize": {
          const p = structuredClone(op.position);
          data.initializeCoursePos(p);
          return p;
        }
        case "limit":
          data.applyLimitRange(
            op.position,
            op.minimum,
            op.maximum,
            op.shrink,
            op.forceElevated,
          );
          return snapshot();
        case "straighten":
          data.straightenElevation(op.first, op.last);
          return snapshot();
        case "sample":
          return data.sampleHeight(op.delta);
        case "course":
          return data.sampleCourseHeight(op.course);
        case "range":
          return data.getHeightRange(
            op.position,
            input.geometry,
            op.canUseElevated,
          );
      }
    });
    return { snapshot: snapshot(), results };
  }

  const w = world(input.world);
  switch (input.op) {
    case "quad":
      return cs2QuadRoadIntersection(input.first, input.second);
    case "circle":
      return cs2CircleRoadIntersection(
        input.position,
        input.radius,
        input.quad,
      );
    case "aux":
      return {
        ...cs2GetRoadAuxiliaryCourse(
          input.course.course,
          input.aux,
          input.invert,
        ),
        creation: cs2GetRoadAuxiliaryDefinition(
          input.course.creation,
          input.aux,
        ),
      };
    case "collect": {
      const result = cs2CollectRoadCourses(w, input.chunks);
      return {
        ...result,
        deletedEntities: Object.fromEntries(result.deletedEntities),
      };
    }
    case "overlaps":
      return cs2FindRoadCourseOverlaps(w, input.courses, input.tree);
    case "intersections": {
      const result = cs2CheckRoadCourseIntersections(
        w,
        input.courses,
        input.overlaps,
        new Map(Object.entries(input.deletedEntities ?? {})),
      );
      expect(result.missingGeometry).toEqual([]);
      return { intersections: result.intersections };
    }
    default:
      throw new Error(`Unknown oracle operation ${input.op}`);
  }
}
describe("source CourseSplit intersection jobs", () => {
  it("records complete recovered job bodies and direct original private geometry calls", () => {
    expect(fixture.provenance.game_sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(fixture.provenance.source_block_sha256).toHaveLength(8);
    expect(fixture.provenance.methods).toHaveLength(21);
    expect(fixture.provenance.changes.join(" ")).toContain(
      "all executable method bodies unchanged",
    );
  });
  it("records the entire height and Results jobs rather than a narrowed merger", () => {
    expect(fixture.heightProvenance.methods).toHaveLength(9);
    expect(fixture.resultsProvenance.methods).toHaveLength(31);
    expect(fixture.resultsProvenance.methods.map((m: any) => m.name)).toEqual(
      expect.arrayContaining([
        "Execute",
        "MergePositions",
        "MergeAuxPositions",
        "CheckHeightRange",
        "TryAddCoursePhase2",
        "FindOriginalEdge",
        "MatchingOwner",
        "CanReplace",
      ]),
    );
  });
  it("requires an actual terrain/water reader for an unowned course", () => {
    const row = fixture.cases.find(
      (r) => r.name === "complete-intersections-0",
    )!;
    const w: any = world(
      Object.fromEntries(
        Object.entries(row.input.world).filter(([key]) => key !== "terrain"),
      ),
    );
    expect(() =>
      cs2ProcessRoadIntersectionResults(
        createCS2RoadResultWorld(w),
        row.input.courses,
        [],
      ),
    ).toThrow("TerrainHeightData/WaterSurfaceData");
  });
  it("preserves the source owned-course branch without fabricating a terrain reader", () => {
    const row = fixture.cases.find(
      (r) => r.name === "results-original-edge-1",
    )!;
    const w: any = world(
      Object.fromEntries(
        Object.entries(row.input.world).filter(([key]) => key !== "terrain"),
      ),
    );
    compare(
      cs2ProcessRoadIntersectionResults(
        createCS2RoadResultWorld(w),
        row.input.courses,
        [],
      ),
      row.expected,
    );
  });
  it("returns a deferred ToolReadyBarrier transaction without mutating the supplied world or inputs", () => {
    const row = fixture.cases.find(
      (r) => r.name === "complete-intersections-0",
    )!;
    const before = structuredClone(row.input);
    const result = run(row.input);
    expect(result.barrier).toBe("ToolReadyBarrier");
    expect(
      result.commands.some(
        (c: any) => c.kind === "set-component" && c.component === "NetCourse",
      ),
    ).toBe(true);
    expect(row.input).toEqual(before);
  });
  it("retains the original endpoint node identity through the entire result transaction", () => {
    const row = fixture.cases.find(
      (r) => r.name === "complete-node-endpoint-identity-0",
    )!;
    const result = run(row.input),
      courses = result.commands.filter((c: any) => c.component === "NetCourse");
    expect(courses.at(-1).value.end.entity).toBe("start");
    compare(result, row.expected);
  });
  for (const row of fixture.cases)
    it(row.name, () => compare(run(row.input), row.expected));
  it("reports missing actual EdgeGeometry instead of replacing it with a centerline", () => {
    const row = fixture.cases.find(
      (r) => r.name === "full-angle-height-width-0",
    )!;
    const w = world(row.input.world);
    const result = cs2CheckRoadCourseIntersections(
      { ...w, edgeGeometry: new Map() },
      row.input.courses,
      row.input.overlaps,
    );
    expect(result).toEqual({
      intersections: [],
      missingGeometry: [
        { entity: "edge", courseIndex: 0, component: "EdgeGeometry" },
      ],
    });
  });
  it("requires source geometry and composition components after the original EdgeGeometry guard", () => {
    const row = fixture.cases.find(
      (r) => r.name === "full-angle-height-width-0",
    )!;
    const w = world(row.input.world);
    expect(() =>
      cs2CheckRoadCourseIntersections(
        { ...w, startNodeGeometry: new Map() },
        row.input.courses,
        row.input.overlaps,
      ),
    ).toThrow("StartNodeGeometry");
  });
  it("preserves high XZ crossings for the downstream height classification job", () => {
    const row = fixture.cases.find(
      (r) => r.name === "full-angle-height-width-76",
    )!;
    const result = run(row.input);
    expect(result.intersections.length).toBeGreaterThan(0);
    expect(result.intersections[0].coursePos.position.y).toBe(-20);
    expect(result.intersections[0].edgeHeightRangeMin[1]).toBeLessThan(5);
  });
});
