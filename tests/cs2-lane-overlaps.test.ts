import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2FindLaneOverlapRange,
  cs2CalculateLaneOverlapParallelism,
  cs2UpdateLaneOverlaps,
  cs2CreateLaneOverlapWorld,
  cs2FinalizeNodeLaneOverlaps,
  type CS2OverlapCubic,
  type CS2OverlapRange,
  type CS2OverlapLane,
  type CS2OverlapOwner,
  type CS2LaneOverlapWorld,
} from "../src/simulation/cs2-lane-overlaps";
import {
  compileCs2Network,
  cs2PackPathNode,
  cs2ReadPathNode,
  type Cs2NetworkConnectionGeometry,
} from "../src/simulation/cs2-network";
import { emptyProject, makeRoad } from "../src/core/model";
import { v } from "../src/core/math";
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-lane-overlaps-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  source: {
    kind: string;
    gameSha256: string;
    mvid: string;
    methods: { name: string; token: string; ilSha256: string }[];
  };
  endpointCases: {
    input: {
      edgeOwner: number;
      lane: number;
      segment: number;
      targetOwner: number;
      junctionOwner: number;
      middleIndex: number;
    };
    output: {
      edgeEnd: string;
      nodeStart: string;
      nodeMiddle: string;
      nodeEnd: string;
      edgeEndEqualsNodeStart: boolean;
      edgeEndOwnerEqualsJunction: boolean;
      nodeEndOwnerEqualsMiddle: boolean;
      internalEndOwnerEqualsMiddle: boolean;
    };
  }[];
  cases: {
    input: {
      name: string;
      curve1: number[][];
      curve2: number[][];
      radius1: [number, number];
      radius2: [number, number];
      angle1: number;
      angle2: number;
    };
    output: { overlap: boolean; range: CS2OverlapRange; parallelism: number };
  }[];
  worldCases: {
    input: WorldInput;
    output: {
      overlaps: Record<string, unknown>;
      nodes: Record<string, unknown>;
      rawNodes: Record<string, unknown>;
      laneCrossCounts: Record<string, number>;
      extra: unknown[];
      updatedOwners: string[];
    };
  }[];
};
type WorldInput = {
  name: string;
  lanes: {
    id: string;
    points: number[][];
    length: number;
    nodes: string[];
    prefabWidth: number;
    prefabFlags: number;
    carFlags: number;
    pedestrianFlags: number;
    masterMembers: string[] | null;
    node: {
      widthOffset: [number, number];
      sharedStartCount: number;
      sharedEndCount: number;
    } | null;
    parking: { flags: number; slotAngle: number | null } | null;
    trackTypes: number | null;
    hasOverlapBuffer: boolean;
    secondary: boolean;
  }[];
  owners: (CS2OverlapOwner & { id: string; connectedEdges: string[] })[];
  initialOwners: string[];
  updateAll: boolean;
  leftHandTraffic: boolean;
};
const cubic = (p: number[][]) =>
  p.map((p) => ({
    x: Math.fround(p[0]),
    y: Math.fround(p[1]),
  })) as unknown as CS2OverlapCubic;
it("matches direct original PathNode constructors for inherited edge endpoints and junction-only middle nodes", () => {
  expect(oracle.endpointCases).toHaveLength(27);
  for (const row of oracle.endpointCases) {
    const input = row.input,
      expected = row.output;
    const edgeEnd = cs2PackPathNode({
      owner: input.edgeOwner,
      lane: input.lane,
      segment: input.segment,
    });
    const middle = cs2PackPathNode({
      owner: input.junctionOwner,
      lane: input.middleIndex,
    });
    const end = cs2PackPathNode({
      owner: input.targetOwner,
      lane: input.lane,
      segment: 0,
    });
    expect(edgeEnd.toString()).toBe(expected.edgeEnd);
    expect(edgeEnd.toString()).toBe(expected.nodeStart);
    expect(middle.toString()).toBe(expected.nodeMiddle);
    expect(end.toString()).toBe(expected.nodeEnd);
    expect(expected.edgeEndEqualsNodeStart).toBe(true);
    expect(
      cs2ReadPathNode(edgeEnd).owner === cs2ReadPathNode(middle).owner,
    ).toBe(expected.edgeEndOwnerEqualsJunction);
    expect(cs2ReadPathNode(end).owner === cs2ReadPathNode(middle).owner).toBe(
      expected.nodeEndOwnerEqualsMiddle,
    );
    expect(expected.internalEndOwnerEqualsMiddle).toBe(true);
  }
});
describe("original DLL lane-overlap geometry", () => {
  it("records actual private-method execution and assembly identity", () => {
    expect(oracle.source.kind).toContain("actual original Game.dll");
    expect(oracle.source.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    for (const method of oracle.source.methods)
      expect(method.ilSha256).toHaveLength(64);
  });
  for (const row of oracle.cases)
    it(`matches source ribbon intersection: ${row.input.name}`, () => {
      const input = {
        ...row.input,
        curve1: cubic(row.input.curve1),
        curve2: cubic(row.input.curve2),
        radius1: row.input.radius1.map(Math.fround) as [number, number],
        radius2: row.input.radius2.map(Math.fround) as [number, number],
        angle1: Math.fround(row.input.angle1),
        angle2: Math.fround(row.input.angle2),
      };
      const actual = cs2FindLaneOverlapRange(input);
      expect(actual.overlap).toBe(row.output.overlap);
      for (let i = 0; i < 4; i++)
        expect(
          Math.abs(actual.range[i] - Math.fround(row.output.range[i])),
          `range[${i}]`,
        ).toBeLessThanOrEqual(1e-6);
      if (actual.overlap)
        expect(
          Math.abs(
            cs2CalculateLaneOverlapParallelism(
              input.curve1,
              input.curve2,
              actual.range,
            ) - Math.fround(row.output.parallelism),
          ),
        ).toBeLessThanOrEqual(1e-6);
    });
});
it("uses one junction owner across different connection groups and shares actual physical endpoint identities", () => {
  const roads = [
    makeRoad(v(-50, 0), v(-10, 0), { id: "a", lanesStart: 2, lanesEnd: 2 }),
    makeRoad(v(10, 0), v(50, 0), { id: "b", lanesStart: 2, lanesEnd: 2 }),
    makeRoad(v(0, -50), v(0, -10), { id: "c", lanesStart: 2, lanesEnd: 2 }),
    makeRoad(v(0, 10), v(0, 50), { id: "d", lanesStart: 2, lanesEnd: 2 }),
  ];
  const connections = [
    {
      id: "ab",
      from: { road: "a", lane: 0 },
      to: { road: "b", lane: 0 },
      enabled: true,
    },
    {
      id: "ad",
      from: { road: "a", lane: 0 },
      to: { road: "d", lane: 0 },
      enabled: true,
    },
    {
      id: "cd",
      from: { road: "c", lane: 0 },
      to: { road: "d", lane: 0 },
      enabled: true,
    },
  ];
  const line = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ): Cs2NetworkConnectionGeometry => ({
    junction: "J",
    points: [
      a,
      { x: (a.x * 2 + b.x) / 3, y: 0, z: (a.z * 2 + b.z) / 3 },
      { x: (a.x + b.x * 2) / 3, y: 0, z: (a.z + b.z * 2) / 3 },
      b,
    ],
  });
  const geometry = new Map([
    ["ab", line(v(-10, -1.75), v(10, -1.75))],
    ["ad", line(v(-10, -1.75), v(1.75, 10))],
    ["cd", line(v(1.75, -10), v(1.75, 10))],
  ]);
  const network = compileCs2Network({
    project: { ...emptyProject(), roads },
    connections,
    revision: 1,
    connectionGeometry: geometry,
  });
  const world = cs2CreateLaneOverlapWorld(network),
    a = network.connectionLaneIds.get("ab")!,
    b = network.connectionLaneIds.get("ad")!,
    c = network.connectionLaneIds.get("cd")!;
  expect(world.lanes.get(a)!.nodes.start).toBe(world.lanes.get(b)!.nodes.start);
  expect(world.lanes.get(b)!.nodes.end).toBe(world.lanes.get(c)!.nodes.end);
  const owner = [...world.owners.values()].find((o) => o.lanes.includes(a))!;
  const roadOwner = (id: string) =>
    world.owners.get(JSON.stringify(["road", id]))!;
  expect(cs2ReadPathNode(world.lanes.get(a)!.nodes.start).owner).toBe(
    roadOwner("a").entityIndex,
  );
  expect(cs2ReadPathNode(world.lanes.get(a)!.nodes.end).owner).toBe(
    roadOwner("b").entityIndex,
  );
  expect(cs2ReadPathNode(world.lanes.get(a)!.nodes.middle).owner).toBe(
    owner.entityIndex,
  );
  expect(owner.lanes).toContain(b);
  expect(owner.lanes).toContain(c);
  expect(
    [...world.lanes.keys()].some(
      (id) => network.lanes.get(id)?.role === "master",
    ),
  ).toBe(false);
  const result = cs2UpdateLaneOverlaps(world, { updateAll: true });
  expect(
    result.overlaps.get(a)?.find((overlap) => overlap.other === c),
  ).toMatchObject({ flags: 0x80 | 4 | 8 });
  const roundaboutWorld = cs2CreateLaneOverlapWorld(network, {
    carFlags: (lane) => (lane.kind === "connection" ? 0x400000 : 0),
  });
  const roundabout = cs2UpdateLaneOverlaps(roundaboutWorld, {
    updateAll: true,
  });
  const finalized = cs2FinalizeNodeLaneOverlaps(roundaboutWorld, roundabout, {
    collectedLanes: [],
  });
  for (const id of [a, b, c]) {
    expect(finalized.nodes.get(id)?.sharedStartCount).not.toBe(255);
    expect(finalized.nodes.get(id)?.sharedEndCount).not.toBe(255);
  }
  const trimmed = compileCs2Network({
    project: { ...emptyProject(), roads },
    connections,
    revision: 2,
    connectionGeometry: geometry,
    roadTrims: new Map(roads.map((r) => [r.id, { start: 4, end: 4 }])),
  });
  const trimmedWorld = cs2CreateLaneOverlapWorld(trimmed);
  expect(
    trimmedWorld.owners.get(JSON.stringify(["road", "a"]))?.edge?.endOwner,
  ).toBe(JSON.stringify(["junction", "J"]));
  expect(
    trimmedWorld.owners.get(JSON.stringify(["road", "d"]))?.edge?.startOwner,
  ).toBe(JSON.stringify(["junction", "J"]));
  expect(() =>
    cs2CreateLaneOverlapWorld(network, {
      junctionForLane: (lane) => (lane.id === c ? "other" : "J"),
    }),
  ).toThrow("different junction owners");
});
function hydrate(input: WorldInput): CS2LaneOverlapWorld {
  return {
    lanes: new Map(
      input.lanes.map((l) => [
        l.id,
        {
          curve: {
            id: l.id,
            points: l.points.map((p) => ({
              x: Math.fround(p[0]),
              y: Math.fround(p[1]),
              z: Math.fround(p[2]),
            })) as unknown as CS2OverlapLane["curve"]["points"],
            length: Math.fround(l.length),
            width: Math.fround(l.prefabWidth),
          },
          nodes: {
            start: BigInt(l.nodes[0]),
            middle: BigInt(l.nodes[1]),
            end: BigInt(l.nodes[2]),
          },
          prefab: { width: Math.fround(l.prefabWidth), flags: l.prefabFlags },
          carFlags: l.carFlags,
          pedestrianFlags: l.pedestrianFlags,
          node: l.node
            ? {
                ...l.node,
                widthOffset: l.node.widthOffset.map(Math.fround) as [
                  number,
                  number,
                ],
              }
            : undefined,
          parking: l.parking
            ? {
                flags: l.parking.flags,
                slotAngle:
                  l.parking.slotAngle === null
                    ? undefined
                    : Math.fround(l.parking.slotAngle),
              }
            : undefined,
          trackTypes: l.trackTypes ?? undefined,
          hasOverlapBuffer: l.hasOverlapBuffer,
          secondary: l.secondary,
          masterMembers: l.masterMembers ?? undefined,
        },
      ]),
    ),
    owners: new Map(
      input.owners.map((o) => [o.id, { ...o, edge: o.edge ?? undefined }]),
    ),
  };
}
describe("full source-extracted component/owner overlap update", () => {
  for (const row of oracle.worldCases)
    it(`matches both byte buffers, priorities, shared counts and extra queue: ${row.input.name}`, () => {
      const world = hydrate(row.input),
        actual = cs2UpdateLaneOverlaps(world, {
          owners: row.input.initialOwners,
          updateAll: row.input.updateAll,
          leftHandTraffic: row.input.leftHandTraffic,
        });
      expect(Object.fromEntries(actual.overlaps)).toEqual(row.output.overlaps);
      const expectedNodes = Object.fromEntries(
        Object.entries(row.output.rawNodes).map(([id, n]) => {
          const node = n as {
            widthOffset: number[];
            sharedStartCount: number;
            sharedEndCount: number;
          };
          return [
            id,
            { ...node, widthOffset: node.widthOffset.map(Math.fround) },
          ];
        }),
      );
      expect(Object.fromEntries(actual.nodes)).toEqual(expectedNodes);
      const extra = actual.extra.map((e) => ({
        ...e,
        overlap: e.overlap ?? null,
      }));
      expect(extra).toEqual(row.output.extra);
      expect(actual.updatedOwners).toEqual(row.output.updatedOwners);
      const finalized = cs2FinalizeNodeLaneOverlaps(world, actual);
      expect(Object.fromEntries(finalized.laneCrossCounts)).toEqual(
        row.output.laneCrossCounts,
      );
      expect(Object.fromEntries(finalized.nodes)).toEqual(
        Object.fromEntries(
          Object.entries(row.output.nodes).map(([id, n]) => {
            const node = n as {
              widthOffset: number[];
              sharedStartCount: number;
              sharedEndCount: number;
            };
            return [
              id,
              { ...node, widthOffset: node.widthOffset.map(Math.fround) },
            ];
          }),
        ),
      );
    });
});
