import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCS2RoadCourseWorld,
  cs2CreateRoadCourses,
  cs2GetRoadCoursePos,
  cs2GetRoadCutPosition,
  cs2CutRoadCourseCurve,
  type CS2RoadCourseControlPoint,
  type CS2RoadCoursesInput,
  type CS2RoadCoursesCallbacks,
  type CS2RoadCourseOwner,
} from "../src/core/cs2-road-courses";
import type { CS2RoadCurve } from "../src/core/cs2-net-geometry";

type WireInput = Omit<CS2RoadCoursesInput, "ownerDefinitions"> & {
  ownerDefinitions?: {
    entity: string | null;
    definition: CS2RoadCourseOwner;
  }[];
  curve: CS2RoadCurve;
  point: CS2RoadCourseControlPoint;
  courseDelta: number;
  range: readonly [number, number];
  geometryFlags: number;
  length: number;
  t: number;
};
type Row = {
  name: string;
  operation: string;
  input: WireInput;
  world: Record<string, any[]>;
  replies?: { kind: string; reply: Record<string, any> }[];
  output: any;
  requests: any[];
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-courses-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  source: {
    gameSha256: string;
    mvid: string;
    extraction: {
      classification: string;
      method_body_sha256: string[];
      methods: { name: string; token: number; ilSha256: string }[];
    };
  };
  cases: Row[];
};
function world(row: Row) {
  const w = row.world,
    map = <T>(key: string, convert: (value: any) => T) =>
      new Map((w[key] ?? []).map((r) => [r.entity as string, convert(r)]));
  return createCS2RoadCourseWorld({
    geometryNets: map("geometryNets", (r) => ({
      defaultWidth: r.defaultWidth,
      maxSlopeSteepness: r.maxSlopeSteepness,
      flags: r.flags,
    })),
    placeableNets: map("placeableNets", (r) => ({
      elevationRange: r.elevationRange,
      placementFlags: r.placementFlags,
    })),
    edges: map("edges", (r) => ({ start: r.start, end: r.end })),
    nodes: new Set(w.nodes ?? []),
    owners: map("owners", (r) => r.owner),
    buildings: new Set(w.buildings ?? []),
    extensions: new Set(w.extensions ?? []),
    temporary: map("temporary", (r) => ({ original: r.original })),
    localTransforms: map("localTransforms", (r) => ({
      parentMesh: r.parentMesh,
    })),
    transforms: map("transforms", (r) => ({
      position: r.position,
      rotation: r.rotation,
    })),
    curves: map("curves", (r) => r.curve),
    prefabRefs: map("prefabRefs", (r) => r.prefab),
    attachments: map("attachments", (r) => r.attached),
    installedUpgrades: map("installedUpgrades", (r) => r.upgrades),
    subNets: new Set(w.subNets ?? []),
    prefabSubObjects: map("prefabSubObjects", (r) => r.objects),
  });
}
function input(row: Row): CS2RoadCoursesInput {
  return {
    ...row.input,
    ownerDefinitions:
      row.input.ownerDefinitions === undefined
        ? undefined
        : new Map(
            row.input.ownerDefinitions.map((r) => [r.entity, r.definition]),
          ),
  };
}
function compare(actual: unknown, expected: unknown, path = "result") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    if (
      /\.(flags|randomSeed|randomState|parentMesh|fixedIndex|index)$/.test(path)
    )
      expect(actual, path).toBe(expected);
    else
      expect(
        Math.abs((actual as number) - Math.fround(expected)),
        path,
      ).toBeLessThanOrEqual(Math.max(2e-6, Math.abs(expected) * 8e-7));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((v, i) =>
      compare((actual as unknown[])[i], v, `${path}[${i}]`),
    );
  } else if (expected && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object", path).toBe(true);
    expect(Object.keys(actual as object).sort(), path + ".keys").toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, value] of Object.entries(expected))
      compare(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
  } else expect(actual, path).toBe(expected);
}
describe("full source NetTool course transactions", () => {
  it("records automatically extracted original methods and true DLL numeric dependencies", () => {
    expect(oracle.source.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.source.extraction.classification).toContain(
      "entire source CreateDefinitionsJob course methods",
    );
    expect(oracle.source.extraction.method_body_sha256).toHaveLength(13);
    for (const name of [
      "CreateStraightLine",
      "CreateSimpleCurve",
      "CreateComplexCurve",
      "CreateContinuousCurve",
      "GetCoursePos",
      "FixElevation",
      "LinearizeElevation",
      "GetCutPosition",
      "InvertCourse",
      "GetOwnerDefinition",
      "GetLocalCurve",
    ])
      expect(
        oracle.source.extraction.methods.some(
          (m) => m.name === name && m.token > 0 && m.ilSha256.length === 64,
        ),
        name,
      ).toBe(true);
  });
  for (const row of oracle.cases)
    it(row.name, () => {
      const before = structuredClone(row),
        w = world(row);
      let actual: unknown;
      if (row.operation === "course") {
        let index = 0;
        const requests: unknown[] = [],
          callbacks: CS2RoadCoursesCallbacks = {};
        for (const kind of [
          "water-inverse-weight",
          "update-owner-object",
          "create-course-object",
          "parallel-courses",
        ] as const)
          callbacks[kind] = (request) => {
            requests.push(structuredClone(request));
            const reply = row.replies?.[index];
            if (!reply) return undefined;
            expect(reply.kind).toBe(kind);
            index++;
            return reply.reply;
          };
        const result = cs2CreateRoadCourses(w, input(row), callbacks);
        actual =
          result.status === "pending"
            ? { status: result.status, request: result.request }
            : result;
        compare(requests, row.requests, row.name + ".requests");
      } else if (row.operation === "position")
        actual = cs2GetRoadCoursePos(
          w,
          row.input.curve,
          row.input.point,
          row.input.courseDelta,
        );
      else if (row.operation === "cut")
        actual = cs2CutRoadCourseCurve(row.input.curve, row.input.range);
      else
        actual = cs2GetRoadCutPosition(
          row.input.geometryFlags,
          row.input.length,
          row.input.t,
        );
      compare(actual, row.output, row.name);
      expect(row).toEqual(before);
    });
  it("resumes an asset owner dependency without resampling or duplicating the command prefix", () => {
    const pending = oracle.cases.find(
        (r) => r.name === "native-owner-pending-False",
      )!,
      complete = oracle.cases.find(
        (r) => r.name === "native-owner-complete-False",
      )!;
    const result = cs2CreateRoadCourses(world(pending), input(pending));
    expect(result.status).toBe("pending");
    if (result.status !== "pending")
      throw new Error("Expected owner asset dependency");
    expect(() => result.transaction.advance()).toThrow("explicit reply");
    const resumed = result.transaction.advance({});
    compare(resumed, complete.output);
    expect(() => result.transaction.advance({})).toThrow("already complete");
  });
});
