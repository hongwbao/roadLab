import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cs2AlignRoadNodes } from "../src/core/cs2-road-node-align";
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
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-node-align-oracle.json", import.meta.url),
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
    input: Snapshot;
    output: { status: "complete"; world: Snapshot };
  }[];
};
function world(input: Snapshot) {
  const maps = <T>(values: Record<string, Record<string, T>>) =>
    new Map(
      Object.entries(values).map(([key, entries]) => [
        key,
        new Map(Object.entries(entries)),
      ]),
    );
  return createCS2RoadApplyWorld({
    ...input,
    components: maps(input.components),
    buffers: maps(input.buffers),
    enabled: maps(input.enabled),
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
function close(actual: unknown, expected: unknown, path = "world") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
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
describe("complete original NodeAlign world transactions", () => {
  it("retains original source and assembly identity", () => {
    expect(oracle.provenance.classification).toContain(
      "complete original NodeAlign",
    );
    expect(oracle.provenance.gameSHA256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.provenance.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.provenance.source.source_block_sha256).toHaveLength(2);
    expect(
      oracle.provenance.source.methods.some((m) => m.name === "Execute"),
    ).toBe(true);
    for (const method of oracle.provenance.source.methods) {
      expect(method.token).toBeGreaterThan(0);
      expect(method.ilSha256).toHaveLength(64);
    }
    expect(oracle.provenance.executedAssembly.sha256).toBe(
      oracle.provenance.gameSHA256,
    );
    expect(oracle.provenance.executedAssembly.mvid).toBe(
      oracle.provenance.mvid,
    );
    expect(oracle.provenance.executedAssembly.methods).toEqual(
      oracle.provenance.source.methods.map(({ token, ilSha256 }) => ({
        token,
        ilSha256,
      })),
    );
  });
  for (const row of oracle.cases)
    it(row.name, () => {
      const input = world(row.input),
        before = structuredClone(input),
        result = cs2AlignRoadNodes(input);
      expect(result.status).toBe("complete");
      close(snapshot(result.world), row.output.world);
      expect(input).toEqual(before);
    });
});
