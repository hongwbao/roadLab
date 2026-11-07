import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cs2-road-references-oracle.json";
import {
  createCS2RoadApplyWorld,
  type CS2RoadApplyRecord,
  type CS2RoadApplyWorld,
} from "../src/core/cs2-road-ecs";
import {
  cs2UpdateRoadReferences,
  cs2ReduceRoadNodes,
  cs2UpdateRoadReferencesAndReduce,
} from "../src/core/cs2-road-references";
type Row = [string, CS2RoadApplyRecord];
type Input = {
  op: "both" | "references" | "reduction";
  entityOrder: string[];
  components: Record<string, Row[]>;
  buffers: Record<string, [string, CS2RoadApplyRecord[]][]>;
  editorMode?: boolean;
};
type Output = {
  components: Record<string, Row[]>;
  buffers: Record<string, [string, CS2RoadApplyRecord[]][]>;
};
const cases = fixture.cases as unknown as {
  name: string;
  input: Input;
  output: Output;
}[];
const zero = () => ({ x: 0, y: 0, z: 0 }),
  quat = () => ({ x: 0, y: 0, z: 0, w: 0 });
function world(input: Input) {
  const defaults: Record<string, () => CS2RoadApplyRecord> = {
    Node: () => ({ position: zero(), rotation: quat() }),
    Curve: () => ({ bezier: [zero(), zero(), zero(), zero()], length: 0 }),
    Temp: () => ({
      original: null,
      curvePosition: 0,
      value: 0,
      cost: 0,
      flags: 0,
    }),
    Road: () => ({
      flags: 0,
      trafficFlowDuration0: [0, 0, 0, 0],
      trafficFlowDuration1: [0, 0, 0, 0],
      trafficFlowDistance0: [0, 0, 0, 0],
      trafficFlowDistance1: [0, 0, 0, 0],
    }),
    BuildOrder: () => ({ start: 0, end: 0 }),
    NetGeometryData: () => ({
      flags: 0,
      defaultWidth: 0,
      elevationLimit: 0,
      elevatedLength: 0,
      edgeLengthRange: { min: 0, max: 0 },
    }),
    OwnerDefinition: () => ({
      prefab: null,
      position: zero(),
      rotation: quat(),
    }),
  };
  return createCS2RoadApplyWorld({
    components: new Map(
      Object.entries(input.components).map(([name, rows]) => [
        name,
        new Map(
          rows.map(([e, value]) => [
            e,
            { ...defaults[name]?.(), ...structuredClone(value) },
          ]),
        ),
      ]),
    ),
    buffers: new Map(
      Object.entries(input.buffers).map(([name, rows]) => [
        name,
        new Map(structuredClone(rows)),
      ]),
    ),
    entityOrder: input.entityOrder,
  });
}
function close(actual: unknown, expected: unknown, path = "root") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs((actual as number) - expected), path).toBeLessThanOrEqual(
      1e-4 + Math.abs(expected) * 2e-6,
    );
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((x, i) =>
      close((actual as unknown[])[i], x, `${path}[${i}]`),
    );
    return;
  }
  if (expected && typeof expected === "object") {
    for (const [k, x] of Object.entries(expected))
      close((actual as Record<string, unknown>)[k], x, `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}
function check(result: CS2RoadApplyWorld, expected: Output) {
  for (const [name, rows] of Object.entries(expected.components))
    close([...(result.components.get(name) ?? [])], rows, `components.${name}`);
  for (const [name, rows] of Object.entries(expected.buffers))
    close([...(result.buffers.get(name) ?? [])], rows, `buffers.${name}`);
}
describe("original complete ReferencesSystem and NodeReductionSystem", () => {
  it("records exact module identity and all seven original job bodies", () => {
    expect(fixture.provenance.mvid).toBe(
      "36b776ac-5007-4e06-81b3-242b2abfd5b6",
    );
    expect(Object.keys(fixture.provenance.bodies)).toHaveLength(9);
    expect(
      fixture.provenance.methods[
        "Game.Tools.NodeReductionSystem"
      ].NodeReductionJob.some((x) => x.name === "MoveConnectedNodes"),
    ).toBe(true);
  });
  for (const test of cases)
    it(test.name, () => {
      const input = world(test.input),
        result =
          test.input.op === "references"
            ? cs2UpdateRoadReferences(input)
            : test.input.op === "reduction"
              ? cs2ReduceRoadNodes(input, { editorMode: test.input.editorMode })
              : cs2UpdateRoadReferencesAndReduce(input, {
                  editorMode: test.input.editorMode,
                });
      expect(result.status).toBe("complete");
      if (result.status !== "complete") throw new Error(JSON.stringify(result));
      check(result.world, test.output);
    });
  it("generates real endpoint references from original empty buffers and publishes a new world", () => {
    const input = world(cases[0].input),
      before = structuredClone(input.buffers),
      result = cs2UpdateRoadReferences(input);
    if (result.status !== "complete") throw new Error(JSON.stringify(result));
    expect(result.world.buffers.get("ConnectedEdge")?.get("a")).toEqual([
      { edge: "e" },
    ]);
    expect(input.buffers).toEqual(before);
    expect(result.world).not.toBe(input);
  });
  it("requires actual ConnectedEdge buffers instead of silently inventing them", () => {
    const input = world(cases[0].input);
    input.buffers = new Map(input.buffers);
    (input.buffers as Map<string, unknown>).delete("ConnectedEdge");
    expect(() => cs2UpdateRoadReferences(input)).toThrow(
      "Missing source buffer ConnectedEdge",
    );
  });
});
