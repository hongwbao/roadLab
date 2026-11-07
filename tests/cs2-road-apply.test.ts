import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2ApplyRoadNetwork,
  cs2GenerateRoadNodes,
  cs2RoadRefundAmount,
} from "../src/core/cs2-road-apply";
import {
  createCS2RoadApplyWorld,
  type CS2RoadApplyRecord,
  type CS2RoadApplyWorld,
} from "../src/core/cs2-road-ecs";

type Snapshot = {
  components: Record<string, Record<string, CS2RoadApplyRecord>>;
  buffers: Record<string, Record<string, readonly CS2RoadApplyRecord[]>>;
  enabled: Record<string, Record<string, boolean>>;
  entityOrder: string[];
  entitySerial: number;
};
type Input = Snapshot & {
  archetypes: Record<
    string,
    {
      components: Record<string, CS2RoadApplyRecord>;
      buffers: Record<string, readonly CS2RoadApplyRecord[]>;
    }
  >;
  terrainBounds: CS2RoadApplyWorld["terrainBounds"];
  searchTree: CS2RoadApplyWorld["searchTree"];
  reusedOwners?: CS2RoadApplyWorld["reusedOwners"];
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-apply-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    classification: string;
    gameSHA256: string;
    mvid: string;
    executedAssembly: {
      sha256: string;
      mvid: string;
      methods: { token: number; ilSha256: string }[];
    };
    source: {
      source_block_sha256: string[];
      methods: { name: string; token: number; ilSha256: string }[];
    };
  };
  cases: {
    name: string;
    input: Input;
    operation: "apply" | "nodes-apply";
    options: { simulationFrame?: number };
    output: {
      status: "complete";
      world: Snapshot;
      commands: unknown[];
      barrier: "ToolOutputBarrier";
      triggers: unknown[];
    };
  }[];
  refundCases: {
    name: string;
    recent: Parameters<typeof cs2RoadRefundAmount>[0];
    frame: number;
    economy: Parameters<typeof cs2RoadRefundAmount>[2];
    expected: number;
  }[];
};
function world(input: Input) {
  const maps = <T>(rows: Record<string, Record<string, T>>) =>
    new Map(
      Object.entries(rows).map(([key, value]) => [
        key,
        new Map(Object.entries(value)),
      ]),
    );
  return createCS2RoadApplyWorld({
    ...input,
    components: maps(input.components),
    buffers: maps(input.buffers),
    enabled: maps(input.enabled),
    archetypes: new Map(
      Object.entries(input.archetypes).map(([key, value]) => [
        key,
        {
          components: new Map(Object.entries(value.components)),
          buffers: new Map(Object.entries(value.buffers)),
        },
      ]),
    ),
  });
}
function snapshot(value: CS2RoadApplyWorld): Snapshot {
  const records = <T>(maps: ReadonlyMap<string, ReadonlyMap<string, T>>) =>
    Object.fromEntries(
      [...maps].map(([key, entries]) => [key, Object.fromEntries(entries)]),
    );
  return {
    components: records(value.components),
    buffers: records(value.buffers),
    enabled: records(value.enabled),
    entityOrder: [...value.entityOrder],
    entitySerial: value.entitySerial ?? 0,
  };
}
function close(actual: unknown, expected: unknown, path = "result") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    if (
      /\.(flags|general|left|right|seed|randomSeed|index|fixedIndex|parentMesh|entitySerial|jobIndex|groupIndex|probability|prefabSubIndex|modificationFrame|modificationCost|triggerType|state|signalGroupCount|currentSignalGroup|nextSignalGroup)$/.test(
        path,
      )
    )
      expect(actual, path).toBe(expected);
    else
      expect(
        Math.abs(Number(actual) - Math.fround(expected)),
        path,
      ).toBeLessThanOrEqual(2e-6 + Math.abs(expected) * 4e-7);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((value, i) =>
      close((actual as unknown[])[i], value, `${path}[${i}]`),
    );
  } else if (expected && typeof expected === "object") {
    expect(Object.keys(actual as object).sort(), path).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, value] of Object.entries(expected))
      close((actual as CS2RoadApplyRecord)[key], value, `${path}.${key}`);
  } else expect(actual, path).toEqual(expected);
}
describe("complete original ApplyNet world transactions", () => {
  it("retains executed original assembly, IL and complete source identity", () => {
    const p = oracle.provenance;
    expect(p.classification).toContain("Complete extracted original ApplyNet");
    expect(p.gameSHA256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(p.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(p.executedAssembly.sha256).toBe(p.gameSHA256);
    expect(p.executedAssembly.mvid).toBe(p.mvid);
    expect(p.source.source_block_sha256.length).toBeGreaterThanOrEqual(3);
    for (const method of p.source.methods) {
      expect(
        p.executedAssembly.methods.find((m) => m.token === method.token)
          ?.ilSha256,
      ).toBe(method.ilSha256);
      expect(method.ilSha256).toHaveLength(64);
    }
  });
  for (const row of oracle.cases)
    it(row.name, () => {
      const input = world(row.input),
        before = structuredClone(input),
        result = cs2ApplyRoadNetwork(
          row.operation === "nodes-apply"
            ? cs2GenerateRoadNodes(input).world
            : input,
          row.options,
        );
      close({ ...result, world: snapshot(result.world) }, row.output);
      expect(input).toEqual(before);
    });
  for (const row of oracle.refundCases)
    it(row.name, () => {
      expect(cs2RoadRefundAmount(row.recent, row.frame, row.economy)).toBe(
        row.expected,
      );
    });
  it("rejects missing required economy data without publishing structural changes", () => {
    const input = world(oracle.cases[0].input);
    const components = new Map(input.components);
    components.delete("EconomyParameterData");
    const invalid = { ...input, components },
      before = structuredClone(invalid);
    expect(() => cs2ApplyRoadNetwork(invalid)).toThrow(
      "Missing unique source EconomyParameterData",
    );
    expect(invalid).toEqual(before);
  });
  it("preserves existing road flow statistics while applying the preview's road flags", () => {
    const row = oracle.cases.find(
      (c) => c.name === "prefab-enabled-Edge-True",
    )!;
    const result = cs2ApplyRoadNetwork(world(row.input), row.options);
    const road = result.world.components.get("Road")!.get("original")!;
    expect(road.flags).toBe(2);
    expect(road.trafficFlowDistance0).toEqual(
      row.input.components.Road.original.trafficFlowDistance0,
    );
  });
});
