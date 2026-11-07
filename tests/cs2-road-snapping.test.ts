import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cs2-road-snapping-oracle.json";
import {
  createCS2RoadSnapWorld,
  cs2RoadControlPoint,
  cs2SnapRoad,
  cs2RoadCurveDistanceXZ,
  cs2ExtendedRoadCurveDistanceXZ,
  cs2ExtendedRoadCurveLengthXZ,
  cs2ClampExtendedRoadCurveLengthXZ,
  cs2ExtendedRoadCurvePositionAndTangent,
  type CS2RoadSnapInput,
  type CS2RoadSnapWorld,
  type CS2RoadSnapNetData,
} from "../src/core/cs2-road-snapping";
import type { CS2RoadCurve } from "../src/core/cs2-net-geometry";
import type { V } from "../src/core/types";

type Sample = {
  constant: number;
  slopeX: number;
  slopeZ: number;
  depth?: number;
};
type RawWorld = Record<string, unknown> & {
  netData: Record<string, CS2RoadSnapNetData>;
  samples: { terrain: Sample; surface: Sample };
  candidates: CS2RoadSnapWorld["candidates"];
};
const cases = fixture.cases as unknown as {
  id: string;
  world: RawWorld;
  input: CS2RoadSnapInput;
  expected: unknown;
}[];
const f = Math.fround;
const sampleHeight = (s: Sample, p: V) =>
  f(f(f(s.constant) + f(f(p.x) * f(s.slopeX))) + f(f(p.z) * f(s.slopeZ)));
function hydrate(raw: RawWorld) {
  const input = {
    netData: new Map(Object.entries(raw.netData)),
    candidates: raw.candidates,
    sampleTerrain: (p: V) => sampleHeight(raw.samples.terrain, p),
    sampleSurface: (p: V) => ({
      height: sampleHeight(raw.samples.surface, p),
      depth: f(raw.samples.surface.depth ?? 0),
    }),
  } as Partial<CS2RoadSnapWorld> & Pick<CS2RoadSnapWorld, "netData">;
  for (const key of [
    "nodes",
    "edges",
    "curves",
    "connectedEdges",
    "owners",
    "prefabRefs",
    "geometryData",
    "roadData",
    "placeableData",
    "localConnectData",
    "compositions",
    "compositionData",
    "roadCompositions",
    "roads",
    "edgeGeometry",
    "compositionAreas",
    "transforms",
    "subObjects",
    "objectGeometry",
  ])
    (input as Record<string, unknown>)[key] = new Map(
      Object.entries(raw[key] as Record<string, unknown>),
    );
  return createCS2RoadSnapWorld(input);
}
function compare(actual: unknown, expected: unknown, path = "result") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    if (/\.(flags|elementIndex\.[xy]|snapPriority\.x)$/.test(path))
      expect(actual, path).toBe(expected);
    else
      expect(
        Math.abs((actual as number) - expected),
        `${path} actual=${actual} expected=${expected}`,
      ).toBeLessThanOrEqual(Math.max(2e-5, Math.abs(expected) * 2e-6));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path}.length`).toBe(
      expected.length,
    );
    expected.forEach((value, index) =>
      compare((actual as unknown[])[index], value, `${path}[${index}]`),
    );
  } else if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object", path).toBe(true);
    for (const [key, value] of Object.entries(expected))
      compare(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
  } else expect(actual, path).toBe(expected);
}

describe("source complete road snapping candidates", () => {
  it("records full source bodies, true DLL helpers and explicit world boundaries", () => {
    expect(fixture.provenance.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(fixture.provenance.mvid).toBe(
      "36b776ac-5007-4e06-81b3-242b2abfd5b6",
    );
    expect(
      fixture.provenance.originalMethods.some((m) => m.name === "HandleCurve"),
    ).toBe(true);
    expect(
      fixture.provenance.originalMethods.some(
        (m) => m.name === "DirectionSnap",
      ),
    ).toBe(true);
    expect(fixture.provenance.classification).toContain(
      "explicit ordered candidate stream",
    );
  });
  for (const row of cases)
    it(row.id, () => {
      const raw = structuredClone(row.world),
        input = structuredClone(row.input),
        before = structuredClone(input);
      const result = cs2SnapRoad(hydrate(raw), input);
      compare(result, row.expected);
      expect(input).toEqual(before);
      expect(raw).toEqual(row.world);
    });
  it("requires real surface samples when the source requests height", () => {
    const world = createCS2RoadSnapWorld({
      netData: new Map([["selected", { requiredLayers: 1, connectLayers: 1 }]]),
    });
    const input = {
      prefab: "selected",
      controlPoints: [cs2RoadControlPoint({ x: 0, y: 0, z: 0 })],
      mode: 0,
      snap: 0,
      elevation: 0,
    };
    expect(() => cs2SnapRoad(world, input)).toThrow("surface sample required");
    expect(
      cs2SnapRoad(world, { ...input, adjustHeight: false }).best.position,
    ).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("true original DLL XZ curve operations", () => {
  for (const [index, row] of fixture.mathCases.entries())
    it(`curve ${index}`, () => {
      const curve = row.input.curve as unknown as CS2RoadCurve;
      compare(
        {
          ordinary: cs2RoadCurveDistanceXZ(curve, row.input.position),
          extended: cs2ExtendedRoadCurveDistanceXZ(curve, row.input.position),
          length: cs2ExtendedRoadCurveLengthXZ(curve, row.input.t),
          clamp: cs2ClampExtendedRoadCurveLengthXZ(curve, row.input.distance),
          pose: cs2ExtendedRoadCurvePositionAndTangent(curve, row.input.t),
        },
        row.expected,
      );
    });
});
