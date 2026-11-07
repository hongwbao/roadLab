import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cs2GenerateRoadNodes } from "../src/core/cs2-road-node-generation";
import { cs2GenerateRoadEdges } from "../src/core/cs2-road-edge-generation";
import { cs2UpdateRoadReferencesAndReduce } from "../src/core/cs2-road-references";
import { cs2AlignRoadNodes } from "../src/core/cs2-road-node-align";
import { cs2ApplyRoadNetwork } from "../src/core/cs2-road-apply";
import {
  createCS2RoadApplyWorld,
  CS2RoadApplyECS,
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
  terrain: {
    base: number;
    x: number;
    z: number;
    amplitude: number;
    frequency: number;
    water: number;
    depth: number;
  };
  terrainBounds: CS2RoadApplyWorld["terrainBounds"];
  searchTree: CS2RoadApplyWorld["searchTree"];
  reusedOwners?: CS2RoadApplyWorld["reusedOwners"];
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-edge-generation-oracle.json", import.meta.url),
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
    operation: "nodes-edges" | "edges";
    input: Input;
    options: { editorMode?: boolean; buildOrder?: number };
    output: {
      status: "complete";
      world: Snapshot;
      commands: unknown[];
      barrier: "ModificationBarrier2";
      buildOrder: number;
    };
  }[];
};
function height(t: Input["terrain"], p: { x: number; y: number; z: number }) {
  const f = Math.fround,
    add = (a: number, b: number) => f(f(a) + f(b)),
    mul = (a: number, b: number) => f(f(a) * f(b));
  return add(
    add(add(t.base, mul(p.x, t.x)), mul(p.z, t.z)),
    mul(t.amplitude, f(Math.sin(mul(add(p.x, p.z), t.frequency)))),
  );
}
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
    terrain: {
      terrainHeight: (p) => height(input.terrain, p),
      waterDepth: () => Math.fround(input.terrain.depth),
      sampleHeight: (p) => ({
        terrainHeight: height(input.terrain, p),
        waterHeight: Math.fround(input.terrain.water),
        waterDepth: Math.fround(input.terrain.depth),
      }),
    },
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
      /\.(flags|general|left|right|seed|randomSeed|index|fixedIndex|parentMesh|entitySerial|jobIndex|groupIndex|probability|prefabSubIndex|buildOrder)$/.test(
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
describe("complete original GenerateEdges world transactions", () => {
  it("retains executed original assembly, IL and complete source identity", () => {
    const p = oracle.provenance;
    expect(p.classification).toContain(
      "Complete extracted original GenerateEdges",
    );
    expect(p.gameSHA256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(p.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(p.executedAssembly.sha256).toBe(p.gameSHA256);
    expect(p.executedAssembly.mvid).toBe(p.mvid);
    expect(p.source.source_block_sha256.length).toBeGreaterThanOrEqual(4);
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
        before = structuredClone({ ...input, terrain: undefined }),
        result = cs2GenerateRoadEdges(
          row.operation === "edges"
            ? input
            : cs2GenerateRoadNodes(input, row.options).world,
          row.options,
        );
      close({ ...result, world: snapshot(result.world) }, row.output);
      expect({ ...input, terrain: undefined }).toEqual(before);
    });
  it("constructs a real ordinary road edge from source node output", () => {
    const row = oracle.cases.find((c) => c.name === "source-course-straight")!;
    const nodes = cs2GenerateRoadNodes(world(row.input), row.options);
    const result = cs2GenerateRoadEdges(nodes.world, row.options);
    expect(result.world.components.get("Edge")!.size).toBe(1);
    const edge = [...result.world.components.get("Edge")!.values()][0];
    expect(edge.start).not.toBe(edge.end);
    expect(result.world.components.get("Node")!.has(edge.start)).toBe(true);
    expect(result.world.components.get("Node")!.has(edge.end)).toBe(true);
  });
  it("reuses deleted preview nodes and the matching preview edge", () => {
    const row = oracle.cases.find(
      (c) => c.name === "preview-reuse-source-course-straight",
    )!;
    const input = world(row.input),
      nodes = cs2GenerateRoadNodes(input, row.options);
    const result = cs2GenerateRoadEdges(nodes.world, row.options);
    expect(result.commands.some((c) => c.kind === "create-entity")).toBe(false);
    expect(result.world.entitySerial).toBe(input.entitySerial);
    expect([...result.world.components.get("Edge")!.keys()]).toEqual(
      Object.keys(row.input.components.Edge),
    );
  });
  it("passes native entities through references, reduction, alignment and application", () => {
    // Entity-stage interoperability only: composition, surface geometry and lanes follow separately.
    const row = oracle.cases.find((c) => c.name === "source-course-straight")!;
    const input = world(row.input),
      nodes = cs2GenerateRoadNodes(input, row.options);
    const edges = cs2GenerateRoadEdges(nodes.world, row.options);
    const references = cs2UpdateRoadReferencesAndReduce(edges.world);
    expect(references.status).toBe("complete");
    if (references.status !== "complete")
      throw new Error(JSON.stringify(references));
    const aligned = cs2AlignRoadNodes(references.world);
    const host = new CS2RoadApplyECS(aligned.world);
    host.set("EconomyParameterData", "economy", {
      roadRefundTimeRange: { x: 0, y: 0, z: 0 },
      roadRefundPercentage: { x: 0, y: 0, z: 0 },
    });
    host.entityOrder.push("economy");
    const result = cs2ApplyRoadNetwork(host.snapshot());
    const entries = [...result.world.components.get("Edge")!];
    expect(entries).toHaveLength(1);
    const [id, edge] = entries[0];
    expect(result.world.components.get("Temp")?.has(id)).toBe(false);
    for (const node of [edge.start, edge.end]) {
      expect(result.world.components.get("Node")?.has(node)).toBe(true);
      expect(result.world.components.get("Temp")?.has(node)).toBe(false);
      expect(
        result.world.buffers.get("ConnectedEdge")?.get(node),
      ).toContainEqual({ edge: id });
    }
  });
  it("rejects missing terrain without publishing node-world changes", () => {
    const row = oracle.cases.find((c) => c.name === "source-course-straight")!;
    const nodes = cs2GenerateRoadNodes(world(row.input), row.options);
    const input = { ...nodes.world, terrain: undefined },
      before = structuredClone(input);
    expect(() => cs2GenerateRoadEdges(input, row.options)).toThrow(
      "Missing source terrain/water reader",
    );
    expect(input).toEqual(before);
  });
});
