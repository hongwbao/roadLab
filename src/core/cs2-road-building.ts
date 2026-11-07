/** RoadLab world adapter for the complete source NetTool course transaction. */
import { center } from "./math";
import { makeRoad } from "./model";
import {
  createCS2RoadCourseWorld,
  cs2CreateRoadCourses,
  cs2RoadCourseControlPoint,
  type CS2RoadCourseControlPoint,
  type CS2RoadCoursesOutput,
} from "./cs2-road-courses";
import type { Project, Road, V } from "./types";

export type CS2RoadLabSnapReference = { road?: string; t?: number };
export type CS2RoadLabCourseInput = {
  project: Pick<Project, "roads">;
  asset: string;
  options: Partial<Road>;
  points: readonly [V, V] | readonly [V, V, V];
  start?: CS2RoadLabSnapReference;
  end?: CS2RoadLabSnapReference;
  /** Complete snap metadata, with entities mapped into the whole-Road course world. */
  controlPoints?: readonly (CS2RoadCourseControlPoint | undefined)[];
  batchSeed?: number;
};

/** These are this game's explicit assets, not recovered Skylines prefab values. */
export const CS2_ROADLAB_CONSTRUCTION_POLICY = {
  elevationRange: [0, 80] as const,
  maxSlopeSteepness: 0.15,
  geometryFlags: 0,
  placementFlags: 0,
};

export function createCS2RoadLabCourseWorld(
  project: Pick<Project, "roads">,
  asset: string,
  template: Road,
) {
  const nodes = new Set<string>(),
    edges = new Map<string, { start: string; end: string }>();
  const node = (road: Road, end: 0 | 1) => {
    const p = center(road, end),
      key = `roadlab:node:${JSON.stringify([Math.fround(p.x), Math.fround(p.y), Math.fround(p.z)])}`;
    nodes.add(key);
    return key;
  };
  for (const road of project.roads)
    edges.set(road.id, { start: node(road, 0), end: node(road, 1) });
  const policy = CS2_ROADLAB_CONSTRUCTION_POLICY;
  return createCS2RoadCourseWorld({
    nodes,
    edges,
    geometryNets: new Map([
      [
        asset,
        {
          defaultWidth:
            Math.max(template.lanesStart, template.lanesEnd) *
            template.width *
            (template.twoWay ? 2 : 1),
          maxSlopeSteepness: policy.maxSlopeSteepness,
          flags: policy.geometryFlags,
        },
      ],
    ]),
    placeableNets: new Map([
      [
        asset,
        {
          elevationRange: policy.elevationRange,
          placementFlags: policy.placementFlags,
        },
      ],
    ]),
  });
}

export function buildCS2RoadLabCourse(input: CS2RoadLabCourseInput): {
  road: Road;
  source: CS2RoadCoursesOutput;
} {
  const points = input.points,
    road = makeRoad(points[0], points.at(-1)!, input.options),
    world = createCS2RoadLabCourseWorld(input.project, input.asset, road);
  const controlPoint = (
    position: V,
    snap?: CS2RoadLabSnapReference,
    source?: CS2RoadCourseControlPoint,
  ): CS2RoadCourseControlPoint =>
    cs2RoadCourseControlPoint(position, {
      ...(source && structuredClone(source)),
      // RoadLab's editable baseline may differ from the physical snap center.
      position: { ...position },
      elevation: source?.elevation ?? position.y,
      originalEntity: source
        ? source.originalEntity &&
          (world.edges.has(source.originalEntity) ||
            world.nodes.has(source.originalEntity))
          ? source.originalEntity
          : null
        : snap?.road && world.edges.has(snap.road)
          ? snap.road
          : null,
      curvePosition: source?.curvePosition ?? snap?.t ?? 0,
    });
  const result = cs2CreateRoadCourses(world, {
    prefab: input.asset,
    mode: points.length === 3 ? "simple" : "straight",
    controlPoints: points.map((point, i) =>
      controlPoint(
        point,
        i === 0 ? input.start : i === points.length - 1 ? input.end : undefined,
        input.controlPoints?.[i],
      ),
    ),
    // Source seed affects definition metadata; these custom assets have no props.
    batchSeed: input.batchSeed ?? 1,
    editorMode: false,
    parallelCount: [0, 0],
  });
  if (result.status === "pending")
    throw new Error(
      `Unresolved source road construction: ${result.request.kind}`,
    );
  if (result.courses.length !== 1)
    throw new Error(
      "A straight or simple road must produce exactly one course",
    );
  const [a, b, c, d] = result.courses[0].curve;
  road.knots = [
    { p: { ...a }, incoming: { ...a }, outgoing: { ...b }, at: 0 },
    { p: { ...d }, incoming: { ...c }, outgoing: { ...d }, at: 1 },
  ];
  return { road, source: result };
}
