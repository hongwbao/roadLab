import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2UpdateLaneReferences,
  type CS2LaneReferencesComponents,
  type CS2LaneReferencesEntity,
  type CS2LaneReferencesInput,
  type CS2LaneReferencesWorld,
  type CS2ReferencedLaneNodes,
} from "../src/simulation/cs2-lane-references";

type E = CS2LaneReferencesEntity;
type JSONComponents = Omit<CS2LaneReferencesComponents, "lane"> & {
  lane?: [string, string, string];
};
interface WorldDTO {
  entities: { id: E; index: number; version?: number; data: JSONComponents }[];
  prefabCars: { id: E; roadTypes: number }[];
  prefabParking: { id: E; roadTypes: number }[];
  prefabTracks: { id: E; trackTypes: number }[];
}
interface Case {
  name: string;
  world: WorldDTO;
  input: Omit<CS2LaneReferencesInput, "skippedLanes"> & {
    skippedLanes?: [string, string, string][];
  };
  output: unknown;
}
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-references-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    gameVersion: string;
    gameSha256: string;
    gameMvid: string;
    source: string;
    bodySha256: Record<string, string>;
    originalMethods: { token: number; ilSha256: string }[];
    classification: string;
  };
  cases: Case[];
};
const nodes = (values: readonly string[]) =>
  values.map((value) =>
    BigInt(`0x${value}`),
  ) as unknown as CS2ReferencedLaneNodes;
const packed = (value: bigint) => value.toString(16).padStart(16, "0");
function worldDTO(raw: WorldDTO): CS2LaneReferencesWorld {
  return {
    entities: new Map(
      raw.entities.map(({ id, data }) => [
        id,
        {
          ...data,
          ...(data.lane && { lane: nodes(data.lane) }),
        } as CS2LaneReferencesComponents,
      ]),
    ),
    entityIndices: new Map(raw.entities.map(({ id, index }) => [id, index])),
    prefabCars: new Map(
      raw.prefabCars.map(({ id, roadTypes }) => [id, { roadTypes }]),
    ),
    prefabParking: new Map(
      raw.prefabParking.map(({ id, roadTypes }) => [id, { roadTypes }]),
    ),
    prefabTracks: new Map(
      raw.prefabTracks.map(({ id, trackTypes }) => [id, { trackTypes }]),
    ),
  };
}
function inputDTO(raw: Case["input"]): CS2LaneReferencesInput {
  return {
    ...raw,
    ...(raw.skippedLanes && { skippedLanes: raw.skippedLanes.map(nodes) }),
  } as CS2LaneReferencesInput;
}
function run(c: Case) {
  const result = cs2UpdateLaneReferences(worldDTO(c.world), inputDTO(c.input));
  return {
    entities: c.world.entities.map((row) => {
      const data = result.world.entities.get(row.id)!;
      return {
        ...row,
        data: { ...data, ...(data.lane && { lane: data.lane.map(packed) }) },
      };
    }),
    commands: result.commands,
    loaded: result.loaded,
    pathNodeMap: [...result.pathNodeMap].map(([from, to]) => [
      packed(from),
      packed(to),
    ]),
  };
}

describe("CS2 complete LaneReferencesSystem source-world oracle", () => {
  it("pins supplied source and actual Game.dll value operations", () => {
    expect(fixture.provenance.gameVersion).toBe("1.6.0f1");
    expect(fixture.provenance.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(fixture.provenance.gameMvid).toBe(
      "36b776ac-5007-4e06-81b3-242b2abfd5b6",
    );
    expect(fixture.provenance.source).toBe("Game.Net.LaneReferencesSystem");
    expect(fixture.provenance.bodySha256).toEqual({
      UpdateLaneReferencesJob:
        "5633638d5470152837ecfc551f881859c74f98e831c3a1f1a6395b12b52fd6c1",
      FillNodeMapJob:
        "f1088537e82a00c5efea83e5a6e54fe54b18334f4de6b328d2ed84fe72e93263",
      FixSkippedLanesJob:
        "e98ca7c8c30fe43ec77b4a25620fc90e4aa2edabf519fe60a8d104bfb9b82f2d",
      UpdateLaneIndicesJob:
        "41578cc95872a1edffb6c46242f65a81cecce93043182ddc8d5c82c91c5c3f1d",
      "private void UpdatePathNode(ref PathNode pathNode, bool isTemp)":
        "ab56cc9b1c993cf5bec0216addad9333ffb21988e1b1885f1eeb012fa5e91d5c",
      "private bool UpdatePathNode(ref PathNode pathNode, PathNode middleNode, int segmentIndex, Entity ownerNode, bool isTemp)":
        "b16519580c78b1cc3d65f1443938c2dc0ff0a9418de753193d7dd6a4811255a7",
      SubLaneOrder:
        "38057d7273841c222f02a7b8791d47de5c1e5ea3b764270558d9cdf455892e62",
    });
    expect(fixture.provenance.originalMethods.map((row) => row.token)).toEqual([
      100679929, 100679931, 100679932, 100679933, 100679934, 100679936,
      100679938,
    ]);
    expect(fixture.provenance.classification).toContain(
      "Complete four source Execute bodies",
    );
    expect(fixture.provenance.classification).toContain(
      "No private Unity World runtime claim",
    );
    expect(fixture.cases).toHaveLength(464);
  });
  for (const c of fixture.cases)
    it(c.name, () => expect(run(c)).toEqual(c.output));

  it("does not mutate source component/buffer snapshots or the skip queue", () => {
    const c = fixture.cases.find((row) => row.name === "integration-3")!;
    const source = worldDTO(c.world);
    const input = inputDTO(c.input);
    const beforeWorld = structuredClone(source);
    const beforeInput = structuredClone(input);
    cs2UpdateLaneReferences(source, input);
    expect(source).toEqual(beforeWorld);
    expect(input).toEqual(beforeInput);
  });
  it("keeps a preexisting SubLane method value when adding the same Entity", () => {
    const c = fixture.cases.find((row) => row.name === "membership-0")!;
    const out = cs2UpdateLaneReferences(worldDTO(c.world), inputDTO(c.input));
    expect(
      out.world.entities
        .get("owner")!
        .subLanes!.filter((row) => row.lane === "new1"),
    ).toEqual([
      { lane: "new1", pathMethods: 1234 },
      { lane: "new1", pathMethods: 65535 },
    ]);
  });
  it("removes only the first equal entity and preserves remaining buffer order", () => {
    const c = fixture.cases.find((row) => row.name === "membership-1")!;
    const out = cs2UpdateLaneReferences(worldDTO(c.world), inputDTO(c.input));
    expect(out.world.entities.get("owner")!.subLanes!.slice(0, 2)).toEqual([
      { lane: "survive", pathMethods: 2 },
      { lane: "delete", pathMethods: 16384 },
    ]);
  });
  it("rejects missing source-required data instead of inventing prefab methods", () => {
    const c = structuredClone(
      fixture.cases.find((row) => row.name === "membership-1")!,
    );
    for (const row of c.world.entities)
      if (row.id?.startsWith("new")) delete row.data.prefab;
    expect(() => run(c)).toThrow("CarLane PrefabRef");
  });
  it("rejects mixed source archetype profiles in one supplied chunk", () => {
    const c = structuredClone(
      fixture.cases.find((row) => row.name === "membership-1")!,
    );
    c.world.entities.find((row) => row.id === "new0")!.data.pedestrian = true;
    expect(() => run(c)).toThrow("chunk mixes source archetype");
  });
  it("requires the actual all-owner query on the loading pass", () => {
    const c = structuredClone(
      fixture.cases.find((row) => row.name === "load-0")!,
    );
    delete c.input.allOwnerChunks;
    expect(() => run(c)).toThrow("all-owner query after loading");
  });
  it("repairs junction-owned edge endpoints when an allocated skip queue is empty", () => {
    const c = fixture.cases.find((row) => row.name === "skips-1")!;
    const allocated = cs2UpdateLaneReferences(
      worldDTO(c.world),
      inputDTO(c.input),
    );
    const unallocatedInput = inputDTO(c.input);
    delete unallocatedInput.skippedLanes;
    const unallocated = cs2UpdateLaneReferences(
      worldDTO(c.world),
      unallocatedInput,
    );
    expect(
      allocated.commands.some((row) => row.component === "PathfindUpdated"),
    ).toBe(true);
    expect(
      unallocated.commands.some((row) => row.component === "PathfindUpdated"),
    ).toBe(false);
    expect(allocated.world.entities.get("edge0lane0")!.lane).not.toEqual(
      unallocated.world.entities.get("edge0lane0")!.lane,
    );
  });
  it("retains the source first-bike full-lane counting asymmetry without a master", () => {
    const c = fixture.cases.find((row) => row.name === "boundary-0")!;
    const result = cs2UpdateLaneReferences(
      worldDTO(c.world),
      inputDTO(c.input),
    );
    expect(result.world.entities.get("s0")!.slave!.flags & 8).toBe(8);
    expect(result.world.entities.get("s1")!.slave!.masterIndex).toBe(1);
  });
  it("uses Entity.Version for owner equality while PathNode owner checks use Index", () => {
    const absent = fixture.cases.find(
      (row) => row.name === "entity-version-0",
    )!;
    const present = fixture.cases.find(
      (row) => row.name === "entity-version-1",
    )!;
    expect(
      cs2UpdateLaneReferences(worldDTO(absent.world), inputDTO(absent.input))
        .commands,
    ).toHaveLength(0);
    expect(
      cs2UpdateLaneReferences(worldDTO(present.world), inputDTO(present.input))
        .commands,
    ).toEqual([
      {
        kind: "add",
        jobIndex: 101,
        entity: "lane",
        component: "PathfindUpdated",
      },
    ]);
  });
});
