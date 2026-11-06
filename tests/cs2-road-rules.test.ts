import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2_ROAD_LANE_FLAGS as F,
  cs2CalculateYieldOffset,
  cs2IsTurn,
  cs2MiddleConnectionFlags,
  cs2NodeLaneFlags,
  cs2RoadCompositionPriority,
  type Cs2RoadRuleArm,
  type Cs2TurnClassification,
  type Cs2TurnEndpoint,
} from "../src/simulation/cs2-road-rules";

type Oracle = {
  provenance: {
    sha256: string;
    mvid: string;
    yield: { ilSha256: string; adapterChanges: string[] };
  };
  coverage: { turnCases: string; yieldCases: string };
  turnCases: {
    source: Cs2TurnEndpoint;
    target: Cs2TurnEndpoint;
    expected: Cs2TurnClassification;
  }[];
  priorityCases: {
    input: Parameters<typeof cs2RoadCompositionPriority>[0];
    expected: number;
  }[];
  yieldCases: {
    id: string;
    input: Parameters<typeof cs2CalculateYieldOffset>[0];
    expected: number;
  }[];
  flagCases: {
    input: Parameters<typeof cs2NodeLaneFlags>[0];
    expected: number;
  }[];
};
const oracle: Oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-rules-oracle.json", import.meta.url),
    "utf8",
  ),
);
const arm = (
  owner: string,
  priority = 10,
  highway = false,
): Cs2RoadRuleArm => ({
  owner,
  priority,
  highway,
  position: { x: -10, z: 0 },
  tangent: { x: 1, z: 0 },
});

describe("original road-rule evidence and snapshot oracle", () => {
  it("retains the actual DLL identity and distinguishes source extraction", () => {
    expect(oracle.provenance.sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.provenance.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.provenance.yield.ilSha256).toBe(
      "23820b81657b503dc78c97e3658166604c065c9d92abafb85b93d16f06cb1308",
    );
    expect(oracle.provenance.yield.adapterChanges).toHaveLength(5);
    expect(oracle.coverage.turnCases).toContain("direct original Game.dll");
    expect(oracle.coverage.yieldCases).toContain("source-extracted");
  });

  it("matches original NetUtils.IsTurn calls and every out flag", () => {
    expect(oracle.turnCases).toHaveLength(512);
    for (const row of oracle.turnCases)
      expect(cs2IsTurn(row.source, row.target)).toEqual(row.expected);
  });

  it("matches the extracted road-composition priority region", () => {
    expect(oracle.priorityCases).toHaveLength(108);
    for (const row of oracle.priorityCases)
      expect(cs2RoadCompositionPriority(row.input)).toBeCloseTo(
        row.expected,
        5,
      );
  });

  it("matches the mechanically adapted full CalculateYieldOffset body", () => {
    expect(oracle.yieldCases).toHaveLength(265);
    for (const row of oracle.yieldCases)
      expect(cs2CalculateYieldOffset(row.input), row.id).toBe(row.expected);
  });

  it("matches the extracted CreateNodeLane flag-write branches", () => {
    expect(oracle.flagCases).toHaveLength(256);
    for (const row of oracle.flagCases)
      expect(cs2NodeLaneFlags(row.input)).toBe(row.expected);
    for (const bit of [
      F.forward,
      F.turnLeft,
      F.turnRight,
      F.gentleTurnLeft,
      F.gentleTurnRight,
      F.uTurnLeft,
      F.uTurnRight,
    ])
      expect(oracle.flagCases.some((row) => (row.expected & bit) !== 0)).toBe(
        true,
      );
  });
});

describe("road priorities, owners and geometric turn classification", () => {
  it("expects metres per second and counts ordinary versus highway lanes", () => {
    const x = {
      speedLimit: 100 / 3.6,
      forwardLanes: 4,
      backwardLanes: 0,
      highwayRules: false,
    };
    expect(cs2RoadCompositionPriority(x)).toBeCloseTo(100 / 3.6 + 3, 5);
    expect(
      cs2RoadCompositionPriority({ ...x, highwayRules: true }),
    ).toBeCloseTo(100 / 3.6 + 4, 5);
    expect(cs2RoadCompositionPriority({ ...x, gravel: true })).toBeCloseTo(
      100 / 3.6 + 3 - 1.25,
      5,
    );
  });

  it("uses inward target tangents for a straight connector", () => {
    const source = arm("west"),
      target = { position: { x: 10, z: 0 }, tangent: { x: -1, z: 0 } };
    expect(cs2IsTurn(source, target).isTurn).toBe(false);
    expect(
      cs2IsTurn(source, { ...target, tangent: { x: 1, z: 0 } }).uturn,
    ).toBe(true);
  });

  it("does not double count lanes or the same incoming/outgoing owner", () => {
    const source = arm("side"),
      main = arm("main", 20);
    const x = {
      source,
      incoming: [source, main, { ...main }],
      outgoing: [{ ...main }],
    };
    expect(cs2CalculateYieldOffset(x)).toBe(0);
    expect(
      cs2CalculateYieldOffset({ ...x, outgoing: [arm("other-main", 20)] }),
    ).toBe(1);
    expect(
      cs2CalculateYieldOffset({
        ...x,
        incoming: [source, main, arm("other-main", 20)],
        outgoing: [],
      }),
    ).toBe(1);
  });

  it("prioritizes AllWayStop and disables automatic yield with traffic lights", () => {
    const source = arm("side"),
      x = {
        source,
        incoming: [source, arm("a", 20), arm("b", 20)],
        outgoing: [],
      };
    expect(cs2CalculateYieldOffset(x)).toBe(1);
    expect(cs2CalculateYieldOffset({ ...x, trafficLights: true })).toBe(0);
    expect(
      cs2CalculateYieldOffset({ ...x, allWayStop: true, trafficLights: true }),
    ).toBe(2);
  });

  it("only auto-yields a highway branch when another approach can go through", () => {
    const source = arm("west", 10, true),
      south = {
        ...arm("south"),
        position: { x: 0, z: -10 },
        tangent: { x: 0, z: 1 },
      },
      north = {
        ...arm("north"),
        position: { x: 0, z: 10 },
        tangent: { x: 0, z: -1 },
      },
      east = {
        ...arm("east"),
        position: { x: 10, z: 0 },
        tangent: { x: -1, z: 0 },
      };
    expect(
      cs2CalculateYieldOffset({
        source,
        incoming: [source, south],
        outgoing: [north],
      }),
    ).toBe(1);
    expect(
      cs2CalculateYieldOffset({
        source,
        incoming: [source, south],
        outgoing: [north, east],
      }),
    ).toBe(0);
    expect(
      cs2CalculateYieldOffset({
        source: { ...source, highway: false },
        incoming: [source, south],
        outgoing: [north],
      }),
    ).toBe(0);
  });
});

describe("faithful lane flags after source-compatible connection selection", () => {
  it("does not equate an ordinary left turn with an unsafe connection", () => {
    const flags = cs2NodeLaneFlags({
      sourceHighway: false,
      targetHighway: false,
      yieldOffset: 0,
      isIntersection: true,
      turn: { isTurn: true, right: false, gentle: false, uturn: false },
    });
    expect(flags & F.turnLeft).toBe(F.turnLeft);
    expect(flags & F.forbidPassing).toBe(F.forbidPassing);
    expect(flags & F.unsafe).toBe(0);
    expect(flags & F.approach).toBe(0);
  });

  it("sets highway only when both connection ends have the explicit rule", () => {
    const input = { sourceHighway: true, targetHighway: false, yieldOffset: 1 };
    expect(cs2NodeLaneFlags(input) & F.highway).toBe(0);
    expect(
      cs2NodeLaneFlags({ ...input, targetHighway: true }) & F.highway,
    ).toBe(F.highway);
    expect(cs2NodeLaneFlags(input) & F.yield).toBe(F.yield);
  });

  it("keeps MiddleConnection's unsafe and source-yield rules separate", () => {
    const source = cs2MiddleConnectionFlags({
      source: true,
      highway: true,
      turnRight: true,
    });
    expect(
      source &
        (F.unsafe | F.sideConnection | F.yield | F.highway | F.turnRight),
    ).toBe(F.unsafe | F.sideConnection | F.yield | F.highway | F.turnRight);
    expect(
      cs2MiddleConnectionFlags({
        source: false,
        highway: false,
        turnRight: false,
      }) & F.yield,
    ).toBe(0);
  });
});
