import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2CheckNodeLanePrefab,
  cs2ModifyNodeLaneCurveHeight,
  cs2DeriveCreatedNodeCarLane,
  cs2AllocateCreatedNodeLaneNodes,
  cs2SelectCreatedNodeLanePrefab,
  cs2CreateNodeLaneWidthOffsets,
  cs2BuildCreatedNodeLaneGeometry,
  cs2CreateNodeLaneMembership,
  cs2CommitCreatedNodeLane,
  cs2CreatedNodeLaneKey,
  cs2CreateNodeLane,
  type CS2NodeLaneCommitWorld,
  type CS2NodeLaneCreationWorld,
  type CS2NodeLaneCreationInput,
  type CS2CreatedNodeMiddleConnection,
  type CS2NodePrefabWorld,
  type CS2NodeLanePrefabSelectionWorld,
} from "../src/simulation/cs2-node-lane-creation";

type PrefabCase = {
  name: string;
  world: {
    editorMode: boolean;
    defaultTheme: string | null;
    placeholders: { id: string | null; objects: (string | null)[] }[];
    requirements: {
      id: string | null;
      entries: { group: number; requirement: string | null }[];
    }[];
    spawnables: {
      id: string | null;
      data: { randomizationGroup: string | null; probability: number };
    }[];
  };
  input: {
    prefab: string | null;
    randomState: number;
    selectedSpawnables: { id: string | null; randomState: number }[];
  };
  output: {
    accepted: boolean;
    prefab: string | null;
    randomState: number;
    outRandomState: number;
    selectedSpawnables: { id: string | null; randomState: number }[];
  };
};
type HeightParameters = Parameters<typeof cs2ModifyNodeLaneCurveHeight>;
type HeightCase = {
  name: string;
  input: {
    curve: HeightParameters[0];
    source: HeightParameters[1];
    target: HeightParameters[2];
  };
  output: ReturnType<typeof cs2ModifyNodeLaneCurveHeight>;
};
type CarCase = {
  name: string;
  input: Parameters<typeof cs2DeriveCreatedNodeCarLane>[0];
  output: ReturnType<typeof cs2DeriveCreatedNodeCarLane>;
};
type NodeCase = {
  name: string;
  input: Parameters<typeof cs2AllocateCreatedNodeLaneNodes>[0];
  output: { nodes: string[]; nodeLaneIndex: number };
};
type MapValue<T> = T extends ReadonlyMap<string | null, infer V> ? V : never;
type ChoiceCase = {
  name: string;
  input: Parameters<typeof cs2SelectCreatedNodeLanePrefab>[1];
  world: {
    [K in keyof CS2NodeLanePrefabSelectionWorld]: {
      id: string | null;
      data: MapValue<CS2NodeLanePrefabSelectionWorld[K]>;
    }[];
  };
  output: ReturnType<typeof cs2SelectCreatedNodeLanePrefab>;
};
type WidthCase = {
  name: string;
  input: Parameters<typeof cs2CreateNodeLaneWidthOffsets>[0];
  output: ReturnType<typeof cs2CreateNodeLaneWidthOffsets>;
};
type GeometryCase = {
  name: string;
  input: Parameters<typeof cs2BuildCreatedNodeLaneGeometry>[0];
  output: ReturnType<typeof cs2BuildCreatedNodeLaneGeometry>;
};
type MembershipCase = {
  name: string;
  input: Parameters<typeof cs2CreateNodeLaneMembership>[0];
  output: {
    master: ReturnType<typeof cs2CreateNodeLaneMembership>["master"] | null;
    slave: ReturnType<typeof cs2CreateNodeLaneMembership>["slave"] | null;
  };
};
type CommitInput = Parameters<typeof cs2CommitCreatedNodeLane>[2];
type CommitCase = {
  name: string;
  input: Omit<CommitInput, "nodes"> & { nodes: string[] };
  world: {
    entityIndices: { id: string | null; index: number }[];
    temp: {
      id: string | null;
      data: { original: string | null; flags: number };
    }[];
    edges: (string | null)[];
    pseudoRandomSeeds: { id: string | null; seed: number }[];
    laneSignals: (string | null)[];
    archetypes: {
      id: string | null;
      data: { node: string; slave: string; master: string };
    }[];
  };
  buffers: {
    oldLanes: { key: string; entity: string }[];
    originalLanes: { key: string; entity: string }[];
    updates: string[];
  };
  createdEntity: string;
  output: unknown;
};
type FullMapRow<K extends keyof CS2NodeLaneCreationWorld> = {
  id: string | null;
  data: MapValue<CS2NodeLaneCreationWorld[K]>;
};
type FullWorldDTO = Pick<
  PrefabCase["world"],
  "editorMode" | "defaultTheme" | "placeholders" | "requirements" | "spawnables"
> &
  Pick<
    CommitCase["world"],
    | "entityIndices"
    | "temp"
    | "edges"
    | "pseudoRandomSeeds"
    | "laneSignals"
    | "archetypes"
  > & {
    compositions: FullMapRow<"compositions">[];
    netLanes: FullMapRow<"netLanes">[];
    carLanes: FullMapRow<"carLanes">[];
    trackLanes: FullMapRow<"trackLanes">[];
    pedestrianLanes: FullMapRow<"pedestrianLanes">[];
    utilityLanes: FullMapRow<"utilityLanes">[];
    nodeEndGeometries: FullMapRow<"nodeEndGeometries">[];
    auxiliaryLanes: {
      id: string | null;
      lanes: MapValue<CS2NodeLaneCreationWorld["auxiliaryLanes"]>;
    }[];
    compositionPieces: {
      id: string | null;
      pieces: MapValue<CS2NodeLaneCreationWorld["compositionPieces"]>;
    }[];
  };
type FullInputDTO = Omit<
  CS2NodeLaneCreationInput,
  "buffers" | "middleConnections"
> & {
  buffers: CommitCase["buffers"] & {
    selectedSpawnables: { id: string | null; randomState: number }[];
  };
  middleConnections: (Omit<CS2CreatedNodeMiddleConnection, "targetNode"> & {
    targetNode: string;
  })[];
};
type FullCase = {
  name: string;
  input: FullInputDTO;
  world: FullWorldDTO;
  createdEntity: string;
  output: unknown;
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-node-lane-creation-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  source: {
    gameSha256: string;
    mvid: string;
    extraction: {
      methods: { signature: string; sha256: string; complete: boolean }[];
      classification: string;
      fullCreation: {
        sourceBodySha256: string;
        auxiliaryOffsetBodySha256: string;
        classification: string;
      };
    };
  };
  prefabCases: PrefabCase[];
  heightCases: HeightCase[];
  carCases: CarCase[];
  nodeCases: NodeCase[];
  choiceCases: ChoiceCase[];
  widthCases: WidthCase[];
  geometryCases: GeometryCase[];
  membershipCases: MembershipCase[];
  commitCases: CommitCase[];
  fullCases: FullCase[];
};
function prefabWorld(w: PrefabCase["world"]): CS2NodePrefabWorld {
  return {
    ...w,
    placeholders: new Map(w.placeholders.map((v) => [v.id, v.objects])),
    requirements: new Map(w.requirements.map((v) => [v.id, v.entries])),
    spawnables: new Map(w.spawnables.map((v) => [v.id, v.data])),
  };
}
function runPrefab(c: PrefabCase) {
  const out = cs2CheckNodeLanePrefab(prefabWorld(c.world), {
    ...c.input,
    selectedSpawnables: new Map(
      c.input.selectedSpawnables.map((v) => [v.id, v.randomState]),
    ),
  });
  return {
    ...out,
    selectedSpawnables: [...out.selectedSpawnables].map(
      ([id, randomState]) => ({ id, randomState }),
    ),
  };
}
function quantizeComponent(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isInteger(value) ? value : Math.fround(value);
  if (Array.isArray(value)) return value.map(quantizeComponent);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, quantizeComponent(v)]),
    );
  return value;
}
function hydrateCommit(c: CommitCase) {
  const world: CS2NodeLaneCommitWorld = {
    entityIndices: new Map(c.world.entityIndices.map((v) => [v.id, v.index])),
    temp: new Map(c.world.temp.map((v) => [v.id, v.data])),
    edges: new Set(c.world.edges),
    pseudoRandomSeeds: new Map(
      c.world.pseudoRandomSeeds.map((v) => [v.id, v.seed]),
    ),
    laneSignals: new Set(c.world.laneSignals),
    archetypes: new Map(c.world.archetypes.map((v) => [v.id, v.data])),
  };
  const input = {
    ...c.input,
    nodes: c.input.nodes.map(BigInt) as [bigint, bigint, bigint],
  };
  for (const field of [
    "nodeLane",
    "curve",
    "carLane",
    "trackLane",
    "utilityLane",
    "hangingLane",
  ] as const)
    input[field] = quantizeComponent(input[field]);
  const buffers = {
    oldLanes: new Map(c.buffers.oldLanes.map((v) => [v.key, v.entity])),
    originalLanes: new Map(
      c.buffers.originalLanes.map((v) => [v.key, v.entity]),
    ),
    updates: c.buffers.updates,
  };
  return { world, input, buffers };
}
function runCommit(c: CommitCase) {
  const { world, input, buffers } = hydrateCommit(c);
  const out = cs2CommitCreatedNodeLane(
    world,
    buffers,
    input,
    () => c.createdEntity,
  );
  const result = {
    ...out,
    buffers: {
      oldLanes: [...out.buffers.oldLanes].map(([key, entity]) => ({
        key,
        entity,
      })),
      originalLanes: [...out.buffers.originalLanes].map(([key, entity]) => ({
        key,
        entity,
      })),
      updates: out.buffers.updates,
    },
    entity: out.entity ?? null,
    skippedLane: out.skippedLane ?? null,
  };
  return JSON.parse(
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  ) as unknown;
}
function hydrateFull(c: FullCase) {
  const w = quantizeComponent(c.world) as FullWorldDTO,
    i = quantizeComponent(c.input) as FullInputDTO;
  const map = <V>(rows: readonly { id: string | null; data: V }[]) =>
    new Map(rows.map((v) => [v.id, v.data] as const));
  const world: CS2NodeLaneCreationWorld = {
    editorMode: w.editorMode,
    defaultTheme: w.defaultTheme,
    placeholders: new Map(w.placeholders.map((v) => [v.id, v.objects])),
    requirements: new Map(w.requirements.map((v) => [v.id, v.entries])),
    spawnables: map(w.spawnables),
    compositions: map(w.compositions),
    netLanes: map(w.netLanes),
    carLanes: map(w.carLanes),
    trackLanes: map(w.trackLanes),
    pedestrianLanes: map(w.pedestrianLanes),
    utilityLanes: map(w.utilityLanes),
    nodeEndGeometries: map(w.nodeEndGeometries),
    auxiliaryLanes: new Map(w.auxiliaryLanes.map((v) => [v.id, v.lanes])),
    compositionPieces: new Map(
      w.compositionPieces.map((v) => [v.id, v.pieces]),
    ),
    entityIndices: new Map(w.entityIndices.map((v) => [v.id, v.index])),
    temp: map(w.temp),
    edges: new Set(w.edges),
    pseudoRandomSeeds: new Map(w.pseudoRandomSeeds.map((v) => [v.id, v.seed])),
    laneSignals: new Set(w.laneSignals),
    archetypes: map(w.archetypes),
  };
  const input: CS2NodeLaneCreationInput = {
    ...i,
    buffers: {
      oldLanes: new Map(i.buffers.oldLanes.map((v) => [v.key, v.entity])),
      originalLanes: new Map(
        i.buffers.originalLanes.map((v) => [v.key, v.entity]),
      ),
      updates: i.buffers.updates,
      selectedSpawnables: new Map(
        i.buffers.selectedSpawnables.map((v) => [v.id, v.randomState]),
      ),
    },
    middleConnections: i.middleConnections.map((v) => ({
      ...v,
      targetNode: BigInt(v.targetNode),
    })),
  };
  return { world, input };
}
function runFull(c: FullCase) {
  const { world, input } = hydrateFull(c);
  let next = Number(c.createdEntity.slice(1));
  const out = cs2CreateNodeLane(world, input, () => `e${next++}`);
  const result = {
    ...out,
    buffers: {
      oldLanes: [...out.buffers.oldLanes].map(([key, entity]) => ({
        key,
        entity,
      })),
      originalLanes: [...out.buffers.originalLanes].map(([key, entity]) => ({
        key,
        entity,
      })),
      updates: out.buffers.updates,
      selectedSpawnables: [...out.buffers.selectedSpawnables].map(
        ([id, randomState]) => ({ id, randomState }),
      ),
    },
  };
  return JSON.parse(
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
  ) as unknown;
}
function compare(actual: unknown, expected: unknown, path = "result") {
  if (typeof actual === "number" && typeof expected === "number") {
    if (
      [
        "x",
        "y",
        "z",
        "defaultSpeedLimit",
        "speedLimit",
        "length",
        "distance",
        "targetCurvePos",
        "order",
        "priority",
        "baseHeight",
        "elevation",
        "curvePosition",
      ].includes(path.split(".").at(-1)!)
    )
      expect(actual, path).toBe(Math.fround(expected));
    else if (path.endsWith(".curviness"))
      expect(actual, path).toBe(Math.fround(expected));
    else expect(actual, path).toBe(expected);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const a = actual as unknown[];
    expect(a.length, path).toBe(expected.length);
    for (let i = 0; i < expected.length; i++)
      compare(a[i], expected[i], `${path}.${i}`);
  } else if (expected !== null && typeof expected === "object") {
    expect(actual, path).toBeTypeOf("object");
    const a = actual as Record<string, unknown>;
    expect(Object.keys(a).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected))
      compare(a[k], v, `${path}.${k}`);
  } else expect(actual, path).toBe(expected);
}
describe("source node-lane creation stages", () => {
  it("records source identity and distinguishes complete helpers from a conditional creation block", () => {
    expect(oracle.source.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(
      oracle.source.extraction.methods.filter((v) => v.complete),
    ).toHaveLength(2);
    expect(
      oracle.source.extraction.methods.find((v) => !v.complete)?.signature,
    ).toContain("CarLane conditional block");
    expect(oracle.source.extraction.classification).toContain(
      "does not prove the entire CreateNodeLane",
    );
    expect(oracle.source.extraction.fullCreation.classification).toContain(
      "Complete CreateNodeLane",
    );
    expect(oracle.source.extraction.fullCreation.sourceBodySha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(oracle.fullCases.length).toBeGreaterThanOrEqual(112);
  });
  for (const c of oracle.prefabCases)
    it(c.name, () => compare(runPrefab(c), c.output));
  for (const c of oracle.heightCases)
    it(c.name, () =>
      compare(
        cs2ModifyNodeLaneCurveHeight(
          c.input.curve,
          c.input.source,
          c.input.target,
        ),
        c.output,
      ),
    );
  for (const c of oracle.carCases)
    it(c.name, () => compare(cs2DeriveCreatedNodeCarLane(c.input), c.output));
  for (const c of oracle.nodeCases)
    it(c.name, () => {
      const result = cs2AllocateCreatedNodeLaneNodes(c.input);
      compare({ ...result, nodes: result.nodes.map(String) }, c.output);
    });
  for (const c of oracle.choiceCases)
    it(c.name, () => {
      const world: CS2NodeLanePrefabSelectionWorld = {
        compositions: new Map(c.world.compositions.map((v) => [v.id, v.data])),
        carLanes: new Map(c.world.carLanes.map((v) => [v.id, v.data])),
        trackLanes: new Map(c.world.trackLanes.map((v) => [v.id, v.data])),
        pedestrianLanes: new Map(
          c.world.pedestrianLanes.map((v) => [v.id, v.data]),
        ),
      };
      compare(cs2SelectCreatedNodeLanePrefab(world, c.input), c.output);
    });
  for (const c of oracle.widthCases)
    it(c.name, () => compare(cs2CreateNodeLaneWidthOffsets(c.input), c.output));
  for (const c of oracle.geometryCases)
    it(c.name, () =>
      compare(cs2BuildCreatedNodeLaneGeometry(c.input), c.output),
    );
  for (const c of oracle.membershipCases)
    it(c.name, () => {
      const out = cs2CreateNodeLaneMembership(c.input);
      compare(
        { master: out.master ?? null, slave: out.slave ?? null },
        c.output,
      );
    });
  for (const c of oracle.commitCases)
    it(c.name, () => compare(runCommit(c), c.output));
  for (const c of oracle.fullCases)
    it(c.name, () => compare(runFull(c), c.output));
  it("plans full creation without mutating component world or input buffers", () => {
    const c = oracle.fullCases.find(
      (v) =>
        v.input.middleConnections.length > 0 &&
        (v.output as { commands: unknown[] }).commands.length > 20,
    )!;
    const { world, input } = hydrateFull(c),
      beforeWorld = structuredClone(world),
      beforeInput = structuredClone(input);
    let index = 9000;
    const out = cs2CreateNodeLane(world, input, () => `e${index++}`);
    expect(out.commands.length).toBeGreaterThan(20);
    expect(world).toEqual(beforeWorld);
    expect(input).toEqual(beforeInput);
  });
  it("captures component values for deferred playback independently of later caller edits", () => {
    const c = oracle.commitCases.find(
      (v) => !(v.input.laneFlags & 4) && !v.input.skipCandidate,
    )!;
    const { world, input, buffers } = hydrateCommit(c),
      out = cs2CommitCreatedNodeLane(
        world,
        buffers,
        input,
        () => c.createdEntity,
      );
    const before = structuredClone(out.commands);
    (input.curve as { length: number }).length = 999;
    (input.carLane as { flags: number }).flags = 0xffffffff;
    expect(out.commands).toEqual(before);
  });
  it("requires real prefab data before building a complete lane", () => {
    const c = oracle.fullCases.find(
      (v) =>
        (v.output as { created: boolean; commands: unknown[] }).created &&
        (v.output as { commands: unknown[] }).commands.length > 0,
    )!;
    const { world, input } = hydrateFull(c);
    world.netLanes = new Map();
    expect(() =>
      cs2CreateNodeLane(world, input, () => {
        throw new Error("unexpected allocation");
      }),
    ).toThrow("Missing NetLaneData");
  });
  it("uses only source Master/Slave role bits in lane reuse identity", () => {
    const nodes = [1n, 2n, 3n] as const;
    expect(cs2CreatedNodeLaneKey(nodes, "prefab", 8 | 2 | 0x4000)).toBe(
      cs2CreatedNodeLaneKey(nodes, "prefab", 2),
    );
    expect(cs2CreatedNodeLaneKey(nodes, "prefab", 2)).not.toBe(
      cs2CreatedNodeLaneKey(nodes, "prefab", 4),
    );
  });
  it("keeps buffers and selected prefab RNG cache immutable", () => {
    const c = oracle.prefabCases[2];
    const before = structuredClone(c);
    runPrefab(c);
    expect(c).toEqual(before);
  });
  it("requires actual curve input when the source asks to calculate curviness", () => {
    const c = structuredClone(oracle.carCases[0].input);
    c.curviness = -1;
    delete c.curve;
    expect(() => cs2DeriveCreatedNodeCarLane(c)).toThrow(
      "Missing curve geometry",
    );
  });
});
