/** Pure RoadLab placement state around the original road-snapping stages. */
import type { Project, Road, V } from "./types";
import { cs2RoadCurvePosition } from "./cs2-net-geometry";
import {
  cs2RoadControlPoint,
  cs2SnapRoad,
  CS2_ROAD_SNAP,
  type CS2RoadControlPoint,
  type CS2RoadSnapOutput,
} from "./cs2-road-snapping";
import {
  createCS2RoadLabSnapWorld,
  type CS2RoadLabResolvedSnapReference,
  type CS2RoadLabSnapWorld,
} from "./cs2-road-snap-world";

export type CS2RoadLabPlacementPoint = {
  /** Editable spline anchor; distinct from the physical source control point. */
  position: V;
  source: CS2RoadControlPoint;
  reference?: CS2RoadLabResolvedSnapReference;
};
export type CS2RoadLabPlacementInput = {
  project: Pick<Project, "roads">;
  proposedRoad: Road;
  assetId: string;
  raw: V;
  previous: readonly CS2RoadLabPlacementPoint[];
  mode: 0 | 1;
  snap: boolean;
  grid: boolean;
  excludeRoad?: string;
  /** Actual scene raycast metadata; never a replacement candidate-ranking step. */
  hit?: { road: string; t: number };
};
export type CS2RoadLabPlacementOutput = {
  point: CS2RoadLabPlacementPoint;
  source?: CS2RoadSnapOutput;
  adapter?: CS2RoadLabSnapWorld;
};
const cloneSource = (p: CS2RoadControlPoint): CS2RoadControlPoint => ({
  ...p,
  position: { ...p.position },
  hitPosition: { ...p.hitPosition },
  direction: { ...p.direction },
  hitDirection: { ...p.hitDirection },
  rotation: { ...p.rotation },
  snapPriority: { ...p.snapPriority },
  elementIndex: { ...p.elementIndex },
});

/** Only identity/parameter fields are rebound; the clicked physical point,
 * direction, priority and elevation retain their source state. */
function rebindPoint(
  point: CS2RoadLabPlacementPoint,
  adapter: CS2RoadLabSnapWorld,
) {
  const source = cloneSource(point.source),
    reference = point.reference;
  const rebound =
    reference && !reference.extended
      ? adapter.referenceForRoad(reference.road, reference.t)
      : undefined;
  if (rebound) {
    source.originalEntity =
      reference!.end !== undefined && rebound.node
        ? rebound.node
        : rebound.entity;
    source.curvePosition = rebound.curvePosition;
  } else {
    source.originalEntity = null;
    source.curvePosition = 0;
  }
  return source;
}

export function placeCS2RoadLabPoint(
  input: CS2RoadLabPlacementInput,
): CS2RoadLabPlacementOutput {
  const current = cs2RoadControlPoint(input.raw);
  // The original NetTool caller assigns m_Elevation before SnapJob. In this
  // actual flat-ground world, construction elevation is raw absolute Y.
  current.elevation = Math.fround(input.raw.y);
  if (!input.snap)
    return { point: { position: { ...input.raw }, source: current } };
  const adapter = createCS2RoadLabSnapWorld(input.project, input.proposedRoad, {
    assetId: input.assetId,
    excludeRoad: input.excludeRoad,
  });
  if (input.hit) {
    const native = adapter.referenceForRoad(input.hit.road, input.hit.t);
    if (native && native.curvePosition >= 0 && native.curvePosition <= 1) {
      if (native.node) {
        current.originalEntity = native.node;
        current.curvePosition = 0;
        current.position = {
          ...adapter.world.nodes.get(native.node)!.position,
        };
      } else {
        current.originalEntity = native.entity;
        current.curvePosition = Math.fround(native.curvePosition);
        current.position = cs2RoadCurvePosition(
          adapter.world.curves.get(native.entity)!.bezier,
          native.curvePosition,
        );
      }
    }
  }
  const previous = input.previous.map((point) => rebindPoint(point, adapter)),
    snap =
      CS2_ROAD_SNAP.existingGeometry |
      CS2_ROAD_SNAP.nearbyGeometry |
      CS2_ROAD_SNAP.guideLines |
      CS2_ROAD_SNAP.straightDirection |
      (input.grid ? CS2_ROAD_SNAP.cellLength : 0),
    source = cs2SnapRoad(adapter.world, {
      prefab: adapter.prefab,
      controlPoints: [...previous, current],
      mode: input.mode,
      snap,
      elevation: input.raw.y,
    }),
    reference = adapter.resolveReference(
      source.best.originalEntity,
      source.best.curvePosition,
      source.best.direction,
    ),
    point: CS2RoadLabPlacementPoint = {
      position: adapter.editablePosition(
        source.best.position,
        input.previous.length ? 1 : 0,
      ),
      source: cloneSource(source.best),
      ...(reference ? { reference: { ...reference } } : {}),
    };
  return { point, source, adapter };
}
