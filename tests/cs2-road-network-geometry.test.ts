import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cs2-road-network-geometry-oracle.json";
import {
  createCS2NetworkGeometryWorld,
  cs2InitializeNetworkNodeGeometry,
  cs2FlattenNetworkNodeGeometry,
  cs2FinishNetworkEdgeGeometry,
  cs2UpdateNetworkNodeGeometry,
  cs2CalculateNetworkNodeGeometry,
  cs2CalculateNetworkIntersectionGeometry,
  cs2GenerateRoadNetworkGeometry,
  cs2NetworkGeometryHeightKey,
  cs2NetworkGeometryEdges,
  type CS2NetworkComposition,
  type CS2NetworkPrefabGeometry,
  type CS2NetworkNodeGeometry,
  type CS2NetworkEdgeNodeGeometry,
} from "../src/core/cs2-road-network-geometry";
import type {
  CS2RoadEdgeGeometry,
  CS2RoadBounds,
} from "../src/core/cs2-road-intersections";
import type { V } from "../src/core/types";
import type { CS2RoadCurve } from "../src/core/cs2-net-geometry";
type Row = [string, Record<string, unknown>];
type Input = {
  nodes: string[];
  edges: string[];
  components: Record<string, Row[]>;
  buffers?: Record<string, [string, unknown[]][]>;
  loaded?: boolean;
  op?: string;
  terrain?: { constant: number; x: number; z: number };
  heightMap?: [string, 0 | 1, [number, number, number, number]][];
};
type Output = {
  NodeGeometry: [string, CS2NetworkNodeGeometry][];
  EdgeGeometry: [string, CS2RoadEdgeGeometry][];
  StartNodeGeometry: [string, { geometry: CS2NetworkEdgeNodeGeometry }][];
  EndNodeGeometry: [string, { geometry: CS2NetworkEdgeNodeGeometry }][];
  heightMap: [string, 0 | 1, [number, number, number, number]][];
};
const cases = fixture.cases as unknown as {
  name: string;
  input: Input;
  output: Output;
}[];
const zero = (): V => ({ x: 0, y: 0, z: 0 }),
  bounds = (): CS2RoadBounds => ({ min: zero(), max: zero() }),
  range = (x: unknown): [number, number] => {
    const a = x as { min: number; max: number } | undefined;
    return [a?.min ?? 0, a?.max ?? 0];
  };
function world(input: Input) {
  input = structuredClone(input);
  const w = createCS2NetworkGeometryWorld(),
    c = input.components;
  const entries = <T>(
    name: string,
    convert: (value: Record<string, unknown>) => T,
  ) => new Map((c[name] ?? []).map(([e, x]) => [e, convert(x)]));
  w.nodes = entries("Node", (x) => x.position as V);
  w.edges = entries("Edge", (x) => x as { start: string; end: string });
  w.curves = entries(
    "Curve",
    (x) => x as { bezier: CS2RoadCurve; length: number },
  );
  w.prefabRefs = entries("PrefabRef", (x) => x.prefab as string);
  w.compositions = entries(
    "Composition",
    (x) => x as { edge: string; startNode: string; endNode: string },
  );
  w.updated = new Set((c.Updated ?? []).map((x) => x[0]));
  w.hidden = new Set((c.Hidden ?? []).map((x) => x[0]));
  w.owners = entries("Owner", (x) => x.owner as string);
  w.orphans = entries("Orphan", (x) => x.composition as string);
  w.temps = entries("Temp", (x) => ({
    original: (x.original ?? null) as string | null,
    flags: (x.flags ?? 0) as number,
  }));
  w.prefabGeometry = entries(
    "NetGeometryData",
    (x) =>
      ({
        defaultWidth: 0,
        mergeLayers: 0,
        intersectLayers: 0,
        flags: 0,
        maxSlopeSteepness: 0,
        minNodeOffset: 0,
        ...x,
        defaultHeightRange: range(x.defaultHeightRange),
        edgeLengthRange: range(x.edgeLengthRange),
      }) as CS2NetworkPrefabGeometry,
  );
  w.prefabComposition = entries(
    "NetCompositionData",
    (x) =>
      ({
        width: 0,
        middleOffset: 0,
        widthOffset: 0,
        nodeOffset: 0,
        state: 0,
        flags: { general: 0, left: 0, right: 0 },
        edgeHeights: [0, 0, 0, 0],
        sideConnectionOffset: [0, 0],
        syncVertexOffsetsLeft: [0, 0, 0, 0],
        syncVertexOffsetsRight: [0, 0, 0, 0],
        ...x,
        heightRange: range(x.heightRange),
        surfaceHeight: range(x.surfaceHeight),
      }) as CS2NetworkComposition,
  );
  w.nodeGeometry = entries(
    "NodeGeometry",
    (x) =>
      ({
        bounds: bounds(),
        position: 0,
        flatness: 0,
        offset: 0,
        ...x,
      }) as CS2NetworkNodeGeometry,
  );
  w.edgeGeometry = entries("EdgeGeometry", (x) => x as CS2RoadEdgeGeometry);
  w.startNodeGeometry = entries(
    "StartNodeGeometry",
    (x) => x.geometry as CS2NetworkEdgeNodeGeometry,
  );
  w.endNodeGeometry = entries(
    "EndNodeGeometry",
    (x) => x.geometry as CS2NetworkEdgeNodeGeometry,
  );
  w.prefabCompositionLanes = new Map(
    (input.buffers?.NetCompositionLane ?? []).map(([e, b]) => [
      e,
      b.map((x) => ({
        lane: null,
        position: zero(),
        flags: 0,
        carriageway: 0,
        ...(x as object),
      })),
    ]),
  );
  w.prefabCompositionCrosswalks = new Map(
    (input.buffers?.NetCompositionCrosswalk ?? []).map(([e, b]) => [
      e,
      b.map((x) => ({ start: zero(), end: zero(), ...(x as object) })),
    ]),
  );
  w.prefabLaneWidths = entries("NetLaneData", (x) => x.width as number);
  w.prefabPlacementFlags = entries(
    "PlaceableNetData",
    (x) => (x.placementFlags ?? 0) as number,
  );
  w.outsideConnections = new Set((c.OutsideConnection ?? []).map((x) => x[0]));
  w.connectedEdges = new Map(
    (input.buffers?.ConnectedEdge ?? []).map(([e, b]) => [
      e,
      b.map((x) => (x as { edge: string }).edge),
    ]),
  );
  w.heightMap = new Map(
    (input.heightMap ?? []).map(([e, end, x]) => [
      cs2NetworkGeometryHeightKey(e, end),
      x,
    ]),
  );
  const t = input.terrain ?? { constant: 0, x: 0, z: 0 };
  w.sampleTerrain = (p) =>
    Math.fround(
      Math.fround(
        Math.fround(t.constant) + Math.fround(Math.fround(t.x) * p.x),
      ) + Math.fround(Math.fround(t.z) * p.z),
    );
  return w;
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
describe("original GeometrySystem complete independent stages", () => {
  it("records original Game.dll identity and every full pipeline job source body", () => {
    expect(fixture.provenance.mvid).toBe(
      "36b776ac-5007-4e06-81b3-242b2abfd5b6",
    );
    expect(Object.keys(fixture.provenance.bodies)).toHaveLength(10);
    expect(
      fixture.provenance.methods.CalculateEdgeGeometryJob.some(
        (x) => x.name === "CalculateCornerOffset",
      ),
    ).toBe(true);
  });
  for (const test of cases)
    it(test.name, () => {
      let w = world(test.input);
      switch (test.input.op) {
        case "initialize":
          cs2InitializeNetworkNodeGeometry(
            w,
            test.input.nodes,
            test.input.loaded,
          );
          break;
        case "flatten":
          cs2FlattenNetworkNodeGeometry(w, test.input.nodes);
          break;
        case "finish":
          cs2FinishNetworkEdgeGeometry(w, test.input.edges);
          break;
        case "update":
          cs2UpdateNetworkNodeGeometry(w, test.input.nodes);
          break;
        case "node":
          cs2CalculateNetworkNodeGeometry(w, test.input.edges, 0);
          cs2CalculateNetworkNodeGeometry(w, test.input.edges, 1);
          break;
        case "intersection":
          cs2CalculateNetworkIntersectionGeometry(w, test.input.edges);
          break;
        case undefined: {
          const result = cs2GenerateRoadNetworkGeometry(w, test.input);
          expect(result.status).toBe("complete");
          if (result.status === "complete") w = result.world;
          break;
        }
        default:
          throw new Error("Unknown stage");
      }
      close([...w.nodeGeometry], test.output.NodeGeometry, "NodeGeometry");
      if (test.input.op !== "initialize") {
        close([...w.edgeGeometry], test.output.EdgeGeometry, "EdgeGeometry");
        close(
          [...w.startNodeGeometry].map(([e, geometry]) => [e, { geometry }]),
          test.output.StartNodeGeometry,
          "StartNodeGeometry",
        );
        close(
          [...w.endNodeGeometry].map(([e, geometry]) => [e, { geometry }]),
          test.output.EndNodeGeometry,
          "EndNodeGeometry",
        );
      }
      close(
        [...w.heightMap].map(([key, value]) => [...JSON.parse(key), value]),
        test.output.heightMap,
        "heightMap",
      );
    });
  it("preserves permanent edge iteration order and actual middle membership", () => {
    const w = world(cases[0].input);
    w.connectedEdges.get("n0")!.push("mid");
    w.edges.set("mid", { start: "a", end: "b" });
    expect(cs2NetworkGeometryEdges(w, null, "n0")).toEqual([
      { edge: "e0", end: false, middle: false },
    ]);
    expect(cs2NetworkGeometryEdges(w, null, "n0", true)[1]).toEqual({
      edge: "mid",
      end: false,
      middle: true,
    });
  });
  it("requires actual input geometry and explicit terrain instead of fabricating success", () => {
    const w = createCS2NetworkGeometryWorld();
    expect(() => cs2FinishNetworkEdgeGeometry(w, ["missing"])).toThrow(
      "Missing GeometrySystem Composition",
    );
    expect(() => w.sampleTerrain(zero())).toThrow("explicit terrain");
  });
  it("publishes complete geometry transactionally and keeps true overpass node entities separate", () => {
    const test = cases.find((x) => x.name === "pipeline-44")!,
      input = world(test.input),
      before = structuredClone([...input.nodeGeometry]);
    const result = cs2GenerateRoadNetworkGeometry(input, test.input);
    expect(result.status).toBe("complete");
    expect([...input.nodeGeometry]).toEqual(before);
    if (result.status !== "complete")
      throw new Error("Expected original geometry");
    expect(result.world).not.toBe(input);
    expect(result.world.nodes.has("ground-n0")).toBe(true);
    expect(result.world.nodes.has("bridge-n0")).toBe(true);
    const ground = result.world.edgeGeometry.get("ground-e0")!,
      bridge = result.world.edgeGeometry.get("bridge-e0")!;
    expect(ground.bounds.max.y).toBeLessThan(bridge.bounds.min.y);
    expect(
      result.world.startNodeGeometry.get("ground-e0")!.left.left[3].x,
    ).not.toBe(0);
  });
  it("does not publish partial output when a genuine special branch needs its missing implementation", () => {
    const test = cases[0],
      input = world(test.input),
      c = input.prefabComposition.values().next().value!;
    c.flags.general |= 0x40;
    const before = structuredClone([...input.nodeGeometry]),
      result = cs2GenerateRoadNetworkGeometry(input, test.input);
    expect(result).toMatchObject({
      status: "pending",
      dependency: "roundabout/fixed-node asset geometry",
      entity: "n0",
    });
    expect([...input.nodeGeometry]).toEqual(before);
  });
  it("preserves mandatory component absence and recognizes LinkAuxOffsets instead of ignoring it", () => {
    const test = cases[0],
      input = world(test.input);
    input.prefabCompositionCrosswalks.clear();
    expect(() => cs2GenerateRoadNetworkGeometry(input, test.input)).toThrow(
      "NetCompositionCrosswalk",
    );
    const auxiliary = world(test.input);
    auxiliary.prefabPlacementFlags.set("p", 0x200);
    expect(cs2GenerateRoadNetworkGeometry(auxiliary, test.input)).toMatchObject(
      { status: "pending", dependency: "LinkAuxOffsets sub-network geometry" },
    );
  });
  it("keeps original node identity and source curve geometry independent at a phase-shifted or off-axis endpoint", () => {
    const test = cases.find((x) => x.name === "pipeline-48")!,
      input = world(test.input),
      result = cs2GenerateRoadNetworkGeometry(input, test.input);
    expect(result.status).toBe("complete");
    if (result.status !== "complete")
      throw new Error("Expected original geometry");
    const edge = result.world.edgeGeometry.get("e0")!,
      node = input.nodes.get("n0")!;
    const center = {
      x: Math.fround((edge.start.left[0].x + edge.start.right[0].x) * 0.5),
      z: Math.fround((edge.start.left[0].z + edge.start.right[0].z) * 0.5),
    };
    expect(result.world.edges.get("e0")!.start).toBe("n0");
    expect(center.x).toBe(Math.fround(-1.95));
    expect(center.x).not.toBe(node.x);
    expect(center.z).toBe(0);
    expect(center.z).not.toBe(node.z);
  });
});
