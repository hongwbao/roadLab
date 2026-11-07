import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2UpdateLaneData,
  type CS2LaneDataComponents,
  type CS2LaneDataInput,
  type CS2LaneDataWorld,
} from "../src/simulation/cs2-lane-data";

type E = string | null;
type JSONComponents = Omit<CS2LaneDataComponents, "lane"> & {
  lane?: [string, string, string];
};
interface WorldDTO {
  entities: { id: E; index: number; data: JSONComponents }[];
  prefabCars: { id: E; roadTypes: number }[];
  prefabBuildings: { id: E; flags: number }[];
  prefabGeometry: { id: E; flags: number }[];
  netCompositions: {
    id: E;
    flags: { general: number; left: number; right: number };
  }[];
}
interface Case {
  name: string;
  world: WorldDTO;
  input: CS2LaneDataInput;
  output: { entities: WorldDTO["entities"]; ran: boolean; commands: never[] };
}
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-data-oracle.json", import.meta.url),
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
const packed = (value: bigint) => value.toString(16).padStart(16, "0");
function worldDTO(raw: WorldDTO): CS2LaneDataWorld {
  return {
    entities: new Map(
      raw.entities.map(({ id, data }) => [
        id,
        {
          ...data,
          ...(data.lane && {
            lane: data.lane.map((value) => BigInt(`0x${value}`)),
          }),
        } as CS2LaneDataComponents,
      ]),
    ),
    prefabCars: new Map(
      raw.prefabCars.map(({ id, roadTypes }) => [id, { roadTypes }]),
    ),
    prefabBuildings: new Map(
      raw.prefabBuildings.map(({ id, flags }) => [id, { flags }]),
    ),
    prefabGeometry: new Map(
      raw.prefabGeometry.map(({ id, flags }) => [id, { flags }]),
    ),
    netCompositions: new Map(
      raw.netCompositions.map(({ id, flags }) => [id, { flags }]),
    ),
  };
}
function run(c: Case) {
  const result = cs2UpdateLaneData(worldDTO(c.world), c.input);
  return {
    entities: c.world.entities.map((row) => {
      const data = result.world.entities.get(row.id)!;
      return {
        ...row,
        data: { ...data, ...(data.lane && { lane: data.lane.map(packed) }) },
      };
    }),
    ran: result.ran,
    commands: result.commands,
  };
}
const named = (name: string) => fixture.cases.find((row) => row.name === name)!;

describe("complete CS2 LaneDataSystem two-job source-world oracle", () => {
  it("pins original source, DLL identity and complete source extraction", () => {
    expect(fixture.provenance.gameVersion).toBe("1.6.0f1");
    expect(fixture.provenance.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(fixture.provenance.gameMvid).toBe(
      "36b776ac-5007-4e06-81b3-242b2abfd5b6",
    );
    expect(fixture.provenance.source).toBe("Game.Pathfind.LaneDataSystem");
    expect(Object.keys(fixture.provenance.bodySha256)).toHaveLength(12);
    expect(fixture.provenance.bodySha256).toMatchObject({
      UpdateLaneDataJob:
        "29c79d591e5bc9b3b7e26c143f6c5663e708e61142524c7c30d8270ba6dc80a4",
      UpdateLaneData2Job:
        "2f31c7483fd0d1aa684e2c5704e5e14c2e70b4b383410c7a4a45e7a91ddad348",
      "private Entity GetAccessRestriction(":
        "51dd11e41a08b6b78d509a8d59e57785151f490596c2fa3f80e0fedc754d8dbc",
      "private Entity GetTopLevelOwner(":
        "865ed0910c6fe8f77db052d27fb925e26737fdce8fa4e2dc5ab900417d583d7f",
      "private bool IsSecured(":
        "ab62fe6d140bc02826632587497c12557f866b9667dfc37f61f123212c2c030b",
      "private Entity FindAccidentSite(":
        "0c87fcf2146646987b7b58d17bd60fd07ee0111691ad4f6aa077e7a384ebbb62",
      "private void AddOptionData(ref Game.Net.CarLane carLane, Game.City.City city)":
        "8974c58a3f73b9f0d270dc9925d2d1cb265e005ea2039a2da9123eb32e0f18bb",
      "private void AddOptionData(ref Game.Net.CarLane carLane, Owner owner,":
        "faf9b0385483a7397c98ab3df03bb9ec3e6247e6a453426607d1692413aff9d7",
      "private Bounds1 CheckBlockage(":
        "bd60b1e63e4924656ba147d09d3d2191b93a6ff69b1114aa1ed66d156a1398c5",
      "private void AddBlockageData(":
        "9decef86d40f596f1786ea525492b93e9256a5070b2a5ad4d765366b3976eaf0",
      "public static void ApplyModifier(ref float value, DynamicBuffer<DistrictModifier>":
        "8d662a5bbc9a367e5e942f8c37412bde0fb64a6944e19c5eeb73314973967e1a",
      "public static bool CheckOption(BorderDistrict":
        "7a124d89e9ee2fc824b1e4943737d6967c6be3726b4889bfc69a0c39d61bd53a",
    });
    expect(fixture.provenance.originalMethods.map((row) => row.token)).toEqual([
      100678844, 100678845, 100678846, 100678847, 100678848, 100678849,
      100678850, 100678851, 100678852, 100678854,
    ]);
    expect(fixture.provenance.classification).toContain(
      "Complete two source Execute bodies and all eight",
    );
    expect(fixture.provenance.classification).toContain(
      "separate ParkingLaneDataSystem not included",
    );
    expect(fixture.cases).toHaveLength(652);
  });
  for (const c of fixture.cases)
    it(c.name, () => expect(run(c)).toEqual(c.output));
  it("does not mutate the source world or query input", () => {
    const c = named("blockage-11");
    const world = worldDTO(c.world);
    const input = structuredClone(c.input);
    const originalWorld = structuredClone(world),
      originalInput = structuredClone(input);
    cs2UpdateLaneData(world, input);
    expect(world).toEqual(originalWorld);
    expect(input).toEqual(originalInput);
  });
  it("keeps unknown required car prefab data explicit", () => {
    const c = structuredClone(named("options-1"));
    c.world.prefabCars = [];
    expect(() => run(c)).toThrow("CarLaneData");
  });
  it("requires actual City data when CitySystem.City names an entity", () => {
    const c = structuredClone(named("options-1"));
    delete c.world.entities.find((row) => row.id === "city")!.data.city;
    expect(() => run(c)).toThrow("City");
  });
  it("does not read City data for pedestrian/track/connection-only chunks", () => {
    expect(() => run(named("noncar-1"))).not.toThrow();
  });
  it("requires actual building data rather than assuming public access", () => {
    const c = structuredClone(named("access-1"));
    c.world.prefabBuildings = [];
    expect(() => run(c)).toThrow("BuildingData");
  });
  it("does not run the caution pass if RequireForUpdate main query is empty", () => {
    const result = run(named("query-8"));
    expect(result.ran).toBe(false);
    expect(result.entities).toEqual(named("query-8").world.entities);
    expect(result.commands).toEqual([]);
  });
  it("rejects mixed source component profiles in a chunk", () => {
    const c = structuredClone(named("options-1"));
    delete c.world.entities.find((row) => row.id === "lane0")!.data.edgeLane;
    expect(() => run(c)).toThrow("chunk mixes source archetype");
  });
  it("rejects invalid main query members instead of updating deleted/garage lanes", () => {
    const c = structuredClone(named("query-1"));
    c.world.entities.find((row) => row.id === "lane")!.data.deleted = true;
    expect(() => run(c)).toThrow("main query violates source filters");
  });
  it("surfaces a cyclic host Owner world instead of hanging", () => {
    const c = structuredClone(named("access-1"));
    c.world.entities.find((row) => row.id === "owner")!.data.owner = "owner";
    expect(() => run(c)).toThrow("cyclic Owner dependency");
  });
  it("initializes real creation-style zero speed in an explicit empty-city world", () => {
    const c = named("empty-world-1");
    const inputCar = c.world.entities.find((row) => row.id === "lane")!.data
      .car!;
    const outputCar = run(c).entities.find((row) => row.id === "lane")!.data
      .car!;
    expect(inputCar.speedLimit).toBe(0);
    expect(outputCar.speedLimit).toBe(inputCar.defaultSpeedLimit);
    expect([
      outputCar.blockageStart,
      outputCar.blockageEnd,
      outputCar.cautionStart,
      outputCar.cautionEnd,
    ]).toEqual([255, 0, 255, 0]);
    expect(outputCar.accessRestriction).toBeNull();
  });
  it("preserves the source master-without-owner city-option branch", () => {
    const out = run(named("master-0")).entities.find(
      (row) => row.id === "master",
    )!.data.car!;
    expect(out.speedLimit).toBe(out.defaultSpeedLimit);
    const normal = run(named("options-11")).entities.find(
      (row) => row.id === "lane0",
    )!.data.car!;
    expect(normal.speedLimit).toBe(Math.fround(111.111115));
  });
  it("uses Master.HasBikeOnlyLane to suppress the shared-lane bicycle ban", () => {
    const withoutBike = run(named("master-bike-0")).entities.find(
      (row) => row.id === "master",
    )!.data.car!;
    const withBike = run(named("master-bike-1")).entities.find(
      (row) => row.id === "master",
    )!.data.car!;
    expect(withoutBike.flags & 0x4000).toBe(0x4000);
    expect(withBike.flags & 0x4000).toBe(0);
  });
});
