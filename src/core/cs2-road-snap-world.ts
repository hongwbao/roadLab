/** Explicit RoadLab geometry/assets -> source road-snapping world adapter. */
import {
  center,
  knotAt,
  normal,
  point,
  sub,
  medianWidth,
  pavementWidth as roadPavementWidth,
} from "./math";
import type { Project, Road, V } from "./types";
import {
  cs2RoadCurveLength,
  cs2RoadCurvePosition,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
import {
  createCS2RoadSnapWorld,
  type CS2RoadDirection,
  type CS2RoadSnapBounds,
  type CS2RoadSnapGeometry,
  type CS2RoadSnapPlaceable,
  type CS2RoadSnapSegment,
  type CS2RoadSnapWorld,
} from "./cs2-road-snapping";

/** These values describe this project's renderer/tools, not recovered CS2 assets. */
export const CS2_ROADLAB_SNAP_WORLD_POLICY = {
  roadLayer: 1,
  shoulderWidth: 0.35,
  deckDepth: 0.45,
  snapDistance: 8,
  fitTolerance: 0.02,
  widthTolerance: 0.125,
  maxFitDepth: 12,
  sampleCount: 16,
  elevationRange: { min: 0, max: 80 },
} as const;
export type CS2RoadLabSnapWorldOptions = {
  assetId: string;
  snapDistance?: number;
  excludeRoad?: string;
  /** Explicit adapter approximation controls; never change source snap epsilons. */
  fitTolerance?: number;
  widthTolerance?: number;
  maxFitDepth?: number;
};
export type CS2RoadLabSnapPiece = {
  entity: string;
  road: string;
  from: number;
  to: number;
  curve: CS2RoadCurve;
  left: CS2RoadCurve;
  right: CS2RoadCurve;
  exactCenter: boolean;
  maxCenterError: number;
  maxBoundaryError: number;
  maxWidthError: number;
  compositionWidth: number;
};
export type CS2RoadLabResolvedSnapReference = {
  road: string;
  /** Raw global parameter, including source ExtendedCurve extrapolation. */
  t: number;
  end?: 0 | 1;
  nativeEntity: string;
  nativeT: number;
  extended: boolean;
  artificialSeam: boolean;
};
export type CS2RoadLabNativeSnapReference = {
  entity: string;
  curvePosition: number;
  road: string;
  t: number;
  node?: string;
};
export type CS2RoadLabSnapWorld = {
  world: CS2RoadSnapWorld;
  prefab: string;
  pieces: readonly CS2RoadLabSnapPiece[];
  resolveReference: (
    entity: string | null,
    nativeT: number,
    direction?: CS2RoadDirection,
  ) => CS2RoadLabResolvedSnapReference | undefined;
  referenceForRoad: (
    road: string,
    t: number,
  ) => CS2RoadLabNativeSnapReference | undefined;
  editablePosition: (physical: V, end: 0 | 1) => V;
  diagnostics: {
    fitTolerance: number;
    widthTolerance: number;
    maxCenterError: number;
    maxBoundaryError: number;
    maxWidthError: number;
    artificialNodeCount: number;
    logicalNodeCount: number;
    pieceCount: number;
  };
};

const f = Math.fround;
const vector = (v: V): V => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
const plus = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const times = (a: V, t: number): V => ({ x: a.x * t, y: a.y * t, z: a.z * t });
const lerp = (a: V, b: V, t: number): V => plus(times(a, 1 - t), times(b, t));
const distance = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const tuple = (a: readonly V[]): CS2RoadCurve =>
  a.map(vector) as unknown as CS2RoadCurve;
const nominalWidth = (r: Road) =>
  (Math.max(r.lanesStart, r.lanesEnd) +
    (r.twoWay
      ? Math.max(
          r.backwardLanesStart ?? r.lanesStart,
          r.backwardLanesEnd ?? r.lanesEnd,
        )
      : 0)) *
    r.width +
  medianWidth(r);
const pavementWidth = (r: Road, t: number) =>
  roadPavementWidth(r, t) + CS2_ROADLAB_SNAP_WORLD_POLICY.shoulderWidth * 2;

export function cs2RoadLabSnapNodeId(position: V) {
  return `roadlab:node:${JSON.stringify([f(position.x), f(position.y), f(position.z)])}`;
}
function splitBezier(
  c: CS2RoadCurve,
  t: number,
): readonly [CS2RoadCurve, CS2RoadCurve] {
  const ab = lerp(c[0], c[1], t),
    bc = lerp(c[1], c[2], t),
    cd = lerp(c[2], c[3], t),
    abc = lerp(ab, bc, t),
    bcd = lerp(bc, cd, t),
    m = lerp(abc, bcd, t);
  return [tuple([c[0], ab, abc, m]), tuple([m, bcd, cd, c[3]])];
}
function cutBezier(c: CS2RoadCurve, begin: number, end: number): CS2RoadCurve {
  if (begin === 0 && end === 1) return tuple(c);
  const prefix = end === 1 ? c : splitBezier(c, end)[0];
  return begin === 0 ? tuple(prefix) : splitBezier(prefix, begin / end)[1];
}
function interpolatedCurve(
  sample: (t: number) => V,
  from: number,
  to: number,
): CS2RoadCurve {
  const a = sample(from),
    b = sample(from + (to - from) / 3),
    c = sample(from + ((to - from) * 2) / 3),
    d = sample(to),
    first = plus(
      plus(times(b, 3), times(c, -1.5)),
      plus(times(a, -5 / 6), times(d, 1 / 3)),
    ),
    second = plus(
      plus(times(c, 3), times(b, -1.5)),
      plus(times(a, 1 / 3), times(d, -5 / 6)),
    );
  return tuple([a, first, second, d]);
}
function roadBoundary(road: Road, t: number, side: 1 | -1) {
  return plus(
    center(road, t),
    times(normal(road, t), pavementWidth(road, t) * 0.5 * side),
  );
}
function rawBezier(road: Road, from: number, to: number): CS2RoadCurve {
  const middle = (from + to) / 2;
  let index = 0;
  while (index < road.knots.length - 2 && knotAt(road, index + 1) < middle)
    index++;
  const begin = knotAt(road, index),
    end = knotAt(road, index + 1),
    a = road.knots[index],
    b = road.knots[index + 1];
  return cutBezier(
    tuple([a.p, a.outgoing, b.incoming, b.p]),
    (from - begin) / (end - begin),
    (to - begin) / (end - begin),
  );
}
function centerHasNoOffset(road: Road) {
  return (
    road.align === "center" &&
    !road.sectionOffset &&
    (!road.twoWay ||
      ((road.backwardLanesStart ?? road.lanesStart) === road.lanesStart &&
        (road.backwardLanesEnd ?? road.lanesEnd) === road.lanesEnd)) &&
    !(road.autoTaper?.start?.offset || road.autoTaper?.end?.offset)
  );
}
function breakpoints(road: Road) {
  const points = new Set<number>([0, 1]);
  for (let i = 1; i < road.knots.length - 1; i++) points.add(knotAt(road, i));
  const profile = road.profile;
  if (
    profile &&
    (profile.from !== profile.to || profile.fromBackward !== profile.toBackward)
  ) {
    const span = profile.end - profile.start;
    if (span !== 0)
      for (const t of [profile.transitionStart, profile.transitionEnd])
        points.add((t - profile.start) / span);
  } else if (
    !profile &&
    (road.lanesStart !== road.lanesEnd ||
      road.backwardLanesStart !== road.backwardLanesEnd)
  ) {
    points.add(road.transitionStart);
    points.add(road.transitionEnd);
  }
  if (road.autoTaper?.start) points.add(road.autoTaper.start.span);
  if (road.autoTaper?.end) points.add(1 - road.autoTaper.end.span);
  return [...points]
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= 1)
    .sort((a, b) => a - b);
}
type GeometryPiece = Omit<CS2RoadLabSnapPiece, "entity" | "road">;
const fittedRoadCache = new WeakMap<
  Road,
  { key: string; pieces: GeometryPiece[] }
>();
function fitRoad(
  road: Road,
  fitTolerance: number,
  widthTolerance: number,
  maxDepth: number,
): GeometryPiece[] {
  if (road.knots.length < 2)
    throw new Error(`Road has no usable curve: ${road.id}`);
  const result: GeometryPiece[] = [],
    boundaries = breakpoints(road),
    exact = centerHasNoOffset(road),
    rendererSamples = Math.max(60, road.knots.length * 35);
  const interval = (from: number, to: number, depth: number) => {
    const curve = exact
        ? rawBezier(road, from, to)
        : interpolatedCurve((t) => center(road, t), from, to),
      left = interpolatedCurve((t) => roadBoundary(road, t, 1), from, to),
      right = interpolatedCurve((t) => roadBoundary(road, t, -1), from, to),
      compositionWidth = f(pavementWidth(road, (from + to) / 2)),
      samples = new Set<number>();
    for (let i = 0; i <= CS2_ROADLAB_SNAP_WORLD_POLICY.sampleCount; i++)
      samples.add(i / CS2_ROADLAB_SNAP_WORLD_POLICY.sampleCount);
    for (
      let i = Math.ceil(from * rendererSamples);
      i <= Math.floor(to * rendererSamples);
      i++
    )
      samples.add((i / rendererSamples - from) / (to - from));
    let maxCenterError = 0,
      maxBoundaryError = 0,
      maxWidthError = 0;
    for (const u of samples) {
      const t = from + (to - from) * u;
      maxCenterError = Math.max(
        maxCenterError,
        distance(center(road, t), cs2RoadCurvePosition(curve, u)),
      );
      maxBoundaryError = Math.max(
        maxBoundaryError,
        distance(roadBoundary(road, t, 1), cs2RoadCurvePosition(left, u)),
        distance(roadBoundary(road, t, -1), cs2RoadCurvePosition(right, u)),
      );
      maxWidthError = Math.max(
        maxWidthError,
        Math.abs(pavementWidth(road, t) - compositionWidth),
      );
    }
    if (
      maxCenterError > fitTolerance ||
      maxBoundaryError > fitTolerance ||
      maxWidthError > widthTolerance
    ) {
      if (depth >= maxDepth)
        throw new Error(
          `RoadLab visible geometry cannot fit source cubic snapshot: ${road.id}, t=${from}..${to}, center=${maxCenterError}, boundary=${maxBoundaryError}, width=${maxWidthError}`,
        );
      const middle = (from + to) / 2;
      interval(from, middle, depth + 1);
      interval(middle, to, depth + 1);
    } else
      result.push({
        from,
        to,
        curve,
        left,
        right,
        exactCenter: exact,
        maxCenterError,
        maxBoundaryError,
        maxWidthError,
        compositionWidth,
      });
  };
  for (let i = 0; i + 1 < boundaries.length; i++)
    if (boundaries[i + 1] > boundaries[i])
      interval(boundaries[i], boundaries[i + 1], 0);
  return result;
}
function roadSnapshot(
  road: Road,
  fitTolerance: number,
  widthTolerance: number,
  maxDepth: number,
) {
  const key = JSON.stringify([
    road.knots,
    road.lanesStart,
    road.lanesEnd,
    road.backwardLanesStart,
    road.backwardLanesEnd,
    road.sectionOffset,
    road.median,
    road.twoWay,
    road.width,
    road.align,
    road.widthOrigin,
    road.profile,
    road.transitionStart,
    road.transitionEnd,
    road.autoTaper,
    fitTolerance,
    widthTolerance,
    maxDepth,
  ]);
  let cached = fittedRoadCache.get(road);
  if (!cached || cached.key !== key) {
    cached = {
      key,
      pieces: fitRoad(road, fitTolerance, widthTolerance, maxDepth),
    };
    fittedRoadCache.set(road, cached);
  }
  // World snapshots expose their own component values; neither source callers
  // nor later edits can mutate another world's cached curves.
  return cached.pieces.map((p) => ({
    ...p,
    curve: tuple(p.curve),
    left: tuple(p.left),
    right: tuple(p.right),
  }));
}
function curveBounds(piece: GeometryPiece, padding: number): CS2RoadSnapBounds {
  const points = [...piece.curve, ...piece.left, ...piece.right],
    deck = CS2_ROADLAB_SNAP_WORLD_POLICY.deckDepth;
  return {
    min: {
      x: Math.min(...points.map((p) => p.x)) - padding,
      y: Math.min(...points.map((p) => p.y)) - deck - padding,
      z: Math.min(...points.map((p) => p.z)) - padding,
    },
    max: {
      x: Math.max(...points.map((p) => p.x)) + padding,
      y: Math.max(...points.map((p) => p.y)) + padding,
      z: Math.max(...points.map((p) => p.z)) + padding,
    },
  };
}
function segment(
  curveLeft: CS2RoadCurve,
  curveRight: CS2RoadCurve,
  begin: number,
  end: number,
): CS2RoadSnapSegment {
  return {
    left: cutBezier(curveLeft, begin, end),
    right: cutBezier(curveRight, begin, end),
  };
}
const sameDirection = (
  curve: CS2RoadCurve,
  t: number,
  direction: CS2RoadDirection,
) => {
  const a = t === 0 ? sub(curve[1], curve[0]) : sub(curve[3], curve[2]),
    length = Math.hypot(a.x, a.z);
  return length === 0
    ? 0
    : Math.abs((a.x * direction.x + a.z * direction.y) / length);
};

export function createCS2RoadLabSnapWorld(
  project: Pick<Project, "roads">,
  proposedRoad: Road,
  options: CS2RoadLabSnapWorldOptions,
): CS2RoadLabSnapWorld {
  const policy = CS2_ROADLAB_SNAP_WORLD_POLICY,
    fitTolerance = options.fitTolerance ?? policy.fitTolerance,
    widthTolerance = options.widthTolerance ?? policy.widthTolerance,
    maxDepth = options.maxFitDepth ?? policy.maxFitDepth,
    snapDistance = options.snapDistance ?? policy.snapDistance;
  if (
    !(fitTolerance > 0) ||
    !(widthTolerance > 0) ||
    !Number.isInteger(maxDepth) ||
    maxDepth < 0 ||
    !(snapDistance > 0)
  )
    throw new Error("Invalid RoadLab snap-world adapter policy");
  const nodes = new Map<string, { position: V; rotation: V & { w: number } }>(),
    edges = new Map<string, { start: string; end: string }>(),
    curves = new Map<string, { bezier: CS2RoadCurve; length: number }>(),
    connectedEdges = new Map<string, string[]>(),
    prefabRefs = new Map<string, string | null>(),
    netData = new Map<
      string,
      { requiredLayers: number; connectLayers: number }
    >(),
    geometryData = new Map<string, CS2RoadSnapGeometry>(),
    placeableData = new Map<string, CS2RoadSnapPlaceable>(),
    compositions = new Map<string, { edge: string }>(),
    compositionData = new Map<string, { width: number }>(),
    edgeGeometry: Map<
      string,
      { start: CS2RoadSnapSegment; end: CS2RoadSnapSegment }
    > = new Map(),
    compositionAreas = new Map<string, readonly []>(),
    roadCompositions = new Map<string, { flags: number }>(),
    roads = new Map<string, { flags: number }>(),
    candidates: { entity: string; bounds: CS2RoadSnapBounds }[] = [],
    pieces: CS2RoadLabSnapPiece[] = [],
    piecesByRoad = new Map<string, CS2RoadLabSnapPiece[]>(),
    pieceByEntity = new Map<string, CS2RoadLabSnapPiece>(),
    realNodes = new Map<
      string,
      { road: string; end: 0 | 1; piece: string }[]
    >(),
    artificialNodes = new Map<
      string,
      { road: string; t: number; piece: string }[]
    >();
  const asset = (prefab: string, road: Road) => {
    netData.set(prefab, {
      requiredLayers: policy.roadLayer,
      connectLayers: policy.roadLayer,
    });
    geometryData.set(prefab, {
      flags: 0,
      defaultWidth: f(nominalWidth(road)),
      defaultHeightRange: { min: -policy.deckDepth, max: 0 },
      mergeLayers: policy.roadLayer,
    });
    placeableData.set(prefab, {
      snapDistance: f(snapDistance),
      placementFlags: 0,
      minWaterElevation: 0,
      elevationRange: { ...policy.elevationRange },
    });
  };
  const prefab = options.assetId;
  asset(prefab, proposedRoad);
  for (const road of project.roads) {
    if (road.id === options.excludeRoad) continue;
    const roadPrefab = `roadlab:snap-prefab:${JSON.stringify(road.id)}`;
    asset(roadPrefab, road);
    const geometry = roadSnapshot(road, fitTolerance, widthTolerance, maxDepth),
      roadPieces: CS2RoadLabSnapPiece[] = [];
    const node = (t: number, piece: string) => {
      const real = t === 0 || t === 1,
        id = real
          ? cs2RoadLabSnapNodeId(center(road, t))
          : `roadlab:snap-seam:${JSON.stringify([road.id, t])}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          position: vector(center(road, t)),
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        });
        prefabRefs.set(id, roadPrefab);
        connectedEdges.set(id, []);
      }
      connectedEdges.get(id)!.push(piece);
      if (real) {
        const entries = realNodes.get(id) ?? [];
        entries.push({ road: road.id, end: t as 0 | 1, piece });
        realNodes.set(id, entries);
      } else {
        const entries = artificialNodes.get(id) ?? [];
        entries.push({ road: road.id, t, piece });
        artificialNodes.set(id, entries);
      }
      return id;
    };
    for (const [index, shape] of geometry.entries()) {
      const entity =
          geometry.length === 1
            ? road.id
            : `roadlab:snap-edge:${JSON.stringify([road.id, index])}`,
        piece: CS2RoadLabSnapPiece = { ...shape, entity, road: road.id },
        composition = `roadlab:snap-composition:${JSON.stringify([road.id, index])}`;
      edges.set(entity, {
        start: node(shape.from, entity),
        end: node(shape.to, entity),
      });
      curves.set(entity, {
        bezier: shape.curve,
        length: cs2RoadCurveLength(shape.curve),
      });
      prefabRefs.set(entity, roadPrefab);
      compositions.set(entity, { edge: composition });
      compositionData.set(composition, { width: shape.compositionWidth });
      roadCompositions.set(composition, { flags: 0 });
      roads.set(entity, { flags: 0 });
      compositionAreas.set(composition, []);
      edgeGeometry.set(entity, {
        start: segment(shape.left, shape.right, 0, 0.5),
        end: segment(shape.left, shape.right, 0.5, 1),
      });
      candidates.push({ entity, bounds: curveBounds(shape, fitTolerance) });
      pieces.push(piece);
      roadPieces.push(piece);
      pieceByEntity.set(entity, piece);
    }
    piecesByRoad.set(road.id, roadPieces);
  }
  const world = createCS2RoadSnapWorld({
    candidates,
    nodes,
    edges,
    curves,
    connectedEdges,
    prefabRefs,
    netData,
    geometryData,
    placeableData,
    compositions,
    compositionData,
    edgeGeometry,
    compositionAreas,
    roadCompositions,
    roads,
    sampleTerrain: () => 0,
    sampleSurface: () => ({ height: 0, depth: 0 }),
  });
  const resolveReference = (
    entity: string | null,
    nativeT: number,
    direction?: CS2RoadDirection,
  ): CS2RoadLabResolvedSnapReference | undefined => {
    if (entity === null) return undefined;
    const piece = pieceByEntity.get(entity);
    if (piece) {
      const t = piece.from + (piece.to - piece.from) * nativeT,
        end = t === 0 || t === 1 ? (t as 0 | 1) : undefined;
      return {
        road: piece.road,
        t,
        ...(end !== undefined ? { end } : {}),
        nativeEntity: entity,
        nativeT,
        extended: nativeT < 0 || nativeT > 1,
        artificialSeam: end === undefined && (nativeT === 0 || nativeT === 1),
      };
    }
    const ends = realNodes.get(entity);
    if (ends?.length) {
      let selected = ends[0];
      if (direction)
        for (const end of ends) {
          const currentPiece = pieceByEntity.get(selected.piece)!,
            candidatePiece = pieceByEntity.get(end.piece)!;
          if (
            sameDirection(candidatePiece.curve, end.end, direction) >
            sameDirection(currentPiece.curve, selected.end, direction)
          )
            selected = end;
        }
      return {
        road: selected.road,
        t: selected.end,
        end: selected.end,
        nativeEntity: entity,
        nativeT,
        extended: false,
        artificialSeam: false,
      };
    }
    const seam = artificialNodes.get(entity)?.[0];
    return seam
      ? {
          road: seam.road,
          t: seam.t,
          nativeEntity: entity,
          nativeT,
          extended: false,
          artificialSeam: true,
        }
      : undefined;
  };
  const referenceForRoad = (
    road: string,
    t: number,
  ): CS2RoadLabNativeSnapReference | undefined => {
    const row = piecesByRoad.get(road);
    if (!row?.length) return undefined;
    const piece =
      t <= row[0].from
        ? row[0]
        : t >= row.at(-1)!.to
          ? row.at(-1)!
          : row.find((p) => t <= p.to)!;
    const node =
      t === 0
        ? world.edges.get(piece.entity)!.start
        : t === 1
          ? world.edges.get(piece.entity)!.end
          : undefined;
    return {
      entity: piece.entity,
      curvePosition: (t - piece.from) / (piece.to - piece.from),
      road,
      t,
      ...(node ? { node } : {}),
    };
  };
  const editableShifts = [
    sub(center(proposedRoad, 0), point(proposedRoad, 0)),
    sub(center(proposedRoad, 1), point(proposedRoad, 1)),
  ];
  const editablePosition = (physical: V, end: 0 | 1) =>
    sub(physical, editableShifts[end]);
  return {
    world,
    prefab,
    pieces,
    resolveReference,
    referenceForRoad,
    editablePosition,
    diagnostics: {
      fitTolerance,
      widthTolerance,
      maxCenterError: Math.max(0, ...pieces.map((p) => p.maxCenterError)),
      maxBoundaryError: Math.max(0, ...pieces.map((p) => p.maxBoundaryError)),
      maxWidthError: Math.max(0, ...pieces.map((p) => p.maxWidthError)),
      artificialNodeCount: artificialNodes.size,
      logicalNodeCount: realNodes.size,
      pieceCount: pieces.length,
    },
  };
}
