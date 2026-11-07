import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cs2-navigation-paths-oracle.json";
import {
  createCS2NavigationPathsWorld,
  cs2ClearNavigationForPathfind,
  cs2FindTrailerNavigationLane,
  cs2NavigationPathIsContinuous,
  cs2UpdateNavigationPaths,
  type CS2NavigationFindLaneReply,
  type CS2NavigationFindLaneRequest,
  type CS2NavigationPathsInput,
  type CS2NavigationPathsWorld,
} from "../src/simulation/cs2-navigation-paths";
import type {
  CS2LaneSelectLane,
  CS2LaneSelectObject,
} from "../src/simulation/cs2-lane-select";

type RawWorld = Omit<
  CS2NavigationPathsWorld,
  | "selection"
  | "entities"
  | "pedestrianLanes"
  | "parkingLanes"
  | "connectionLanes"
  | "transforms"
  | "positions"
  | "prefabRefs"
  | "buildings"
  | "owners"
  | "propertyRenters"
> & {
  selection: {
    lanes: Record<
      string,
      Omit<CS2LaneSelectLane, "nodes"> & {
        nodes?: { start: string; middle: string; end: string };
      }
    >;
    owners: Record<string, { laneId: string; pathMethods: number }[]>;
    objects: Record<string, CS2LaneSelectObject>;
  };
  entities: string[];
  pedestrianLanes: string[];
  parkingLanes: Record<string, { flags: number }>;
  connectionLanes: Record<string, { flags: number }>;
  transforms: Record<
    string,
    CS2NavigationPathsWorld["transforms"] extends ReadonlyMap<string, infer T>
      ? T
      : never
  >;
  positions: Record<
    string,
    CS2NavigationPathsWorld["positions"] extends ReadonlyMap<string, infer T>
      ? T
      : never
  >;
  prefabRefs: Record<string, string | null>;
  buildings: Record<string, { lotDepth: number }>;
  owners: Record<string, string | null>;
  propertyRenters: Record<string, string | null>;
};
type Case = {
  id: string;
  mode: "update" | "clear-pathfind" | "trailer-find";
  world: RawWorld;
  input: CS2NavigationPathsInput & { findReply?: CS2NavigationFindLaneReply };
  expected: Record<string, unknown>;
};
const cases = fixture.cases as unknown as Case[];
function hydrate(raw: RawWorld): CS2NavigationPathsWorld {
  return createCS2NavigationPathsWorld({
    selection: {
      lanes: new Map(
        Object.entries(raw.selection.lanes).map(([key, lane]) => [
          key,
          {
            ...lane,
            ...(lane.nodes
              ? {
                  nodes: {
                    start: BigInt(lane.nodes.start),
                    middle: BigInt(lane.nodes.middle),
                    end: BigInt(lane.nodes.end),
                  },
                }
              : {}),
          } as CS2LaneSelectLane,
        ]),
      ),
      owners: new Map(Object.entries(raw.selection.owners)),
      objects: new Map(Object.entries(raw.selection.objects)),
    },
    entities: new Set(raw.entities),
    pedestrianLanes: new Set(raw.pedestrianLanes),
    parkingLanes: new Map(Object.entries(raw.parkingLanes)),
    connectionLanes: new Map(Object.entries(raw.connectionLanes)),
    transforms: new Map(Object.entries(raw.transforms)),
    positions: new Map(Object.entries(raw.positions)),
    prefabRefs: new Map(Object.entries(raw.prefabRefs)),
    buildings: new Map(Object.entries(raw.buildings)),
    owners: new Map(Object.entries(raw.owners)),
    propertyRenters: new Map(Object.entries(raw.propertyRenters)),
  });
}
function compare(actual: unknown, expected: unknown, path = "result") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    // Flags, identities and RNG are exact; f32 geometry may differ by a few ULPs
    // after source JSON float formatting and cross-language expression evaluation.
    if (/\.(flags|randomState|elementIndex|carType)$/.test(path))
      expect(actual, path).toBe(expected);
    else
      expect(Math.abs((actual as number) - expected), path).toBeLessThanOrEqual(
        Math.max(1e-6, Math.abs(expected) * 5e-7),
      );
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((v, index) =>
      compare((actual as unknown[])[index], v, `${path}[${index}]`),
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

describe("complete source navigation path lifecycle", () => {
  it("keeps source method and assembly provenance distinct from spatial search adapters", () => {
    expect(fixture.provenance.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(fixture.provenance.mvid).toBe(
      "36b776ac-5007-4e06-81b3-242b2abfd5b6",
    );
    expect(
      fixture.provenance.originalMethods.some(
        (m) => m.name === "FillNavigationPaths",
      ),
    ).toBe(true);
    expect(fixture.provenance.classification).toContain(
      "explicit supplied FindLane query response",
    );
  });
  for (const row of cases)
    it(row.id, () => {
      const world = hydrate(row.world),
        input = structuredClone(row.input),
        before = structuredClone(input);
      let request: CS2NavigationFindLaneRequest | null = null;
      if (row.mode === "trailer-find") {
        const output = cs2FindTrailerNavigationLane(world, input, {
          findCurrentLane: (query) => {
            request = query;
            return input.findReply;
          },
        });
        expect(output.status).toBe("complete");
        compare({ ...output, request }, row.expected);
      } else if (row.mode === "clear-pathfind") {
        const output = cs2ClearNavigationForPathfind({ world, ...input });
        compare({ ...input, ...output, request }, row.expected);
      } else {
        const output = cs2UpdateNavigationPaths(world, input, {
          findCurrentLane: (query) => {
            request = query;
            return input.findReply;
          },
        });
        expect(output.status).toBe("complete");
        if (output.status !== "complete")
          throw new Error("Unexpected unresolved spatial query");
        compare({ ...output, request }, row.expected);
      }
      expect(input).toEqual(before);
    });

  it("pauses missing-current spatial lookup and resumes at the original query without restarting RNG", () => {
    const row = cases.find(
      (c) => c.id === "find-current-owner32-foundFalse-obsoleteFalse",
    )!;
    const input = structuredClone(row.input),
      before = structuredClone(input);
    const result = cs2UpdateNavigationPaths(hydrate(row.world), input);
    expect(result.status).toBe("pending");
    if (result.status !== "pending")
      throw new Error("Expected explicit spatial query");
    expect(result.request.scopes).toEqual(["net", "static-objects", "areas"]);
    expect(result.request.accessRestrictionOwner).toBe("house");
    expect(() => result.transaction.advance()).toThrow("explicit reply");
    const completed = result.transaction.advance(input.findReply!);
    expect(completed.status).toBe("complete");
    compare({ ...completed, request: result.request }, row.expected);
    expect(input).toEqual(before);
    expect(() => result.transaction.advance(input.findReply!)).toThrow(
      "already complete",
    );
  });
  it("uses original master identity for PathStart same-lane continuation", () => {
    const world = hydrate(cases[0].world);
    expect(
      cs2NavigationPathIsContinuous(
        world.selection,
        "g0l1",
        0.45,
        "master0",
        0.45,
      ),
    ).toEqual({ continuous: true, sameLane: true });
    expect(
      cs2NavigationPathIsContinuous(
        world.selection,
        "g0l1",
        0.45,
        "master0",
        0.5,
      ),
    ).toEqual({ continuous: false, sameLane: false });
  });
});
