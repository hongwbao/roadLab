import { cs2NativeSort } from "../core/cs2-native-sort";
import { cs2StripPathNodeCurve } from "../core/cs2-path-node";

export type CS2LaneReferencesEntity = string | null;
type E = CS2LaneReferencesEntity;
export type CS2ReferencedLaneNodes = readonly [bigint, bigint, bigint];

export interface CS2ReferencedSubLane {
  lane: E;
  pathMethods: number;
}

export interface CS2ReferencedMasterLane {
  flags: number;
  group: number;
  minIndex: number;
  maxIndex: number;
}

export interface CS2ReferencedSlaveLane extends CS2ReferencedMasterLane {
  subIndex: number;
  masterIndex: number;
}

/** Presence of a component is distinct from its default value or an empty buffer. */
export interface CS2LaneReferencesComponents {
  owner?: E;
  lane?: CS2ReferencedLaneNodes;
  prefab?: E;
  subLanes?: readonly CS2ReferencedSubLane[];
  connectedEdges?: readonly E[];
  edge?: { start: E; end: E };
  edgeLane?: { delta: readonly [number, number] };
  master?: CS2ReferencedMasterLane;
  slave?: CS2ReferencedSlaveLane;
  parking?: { flags: number };
  connection?: { flags: number; roadTypes: number };
  created?: boolean;
  deleted?: boolean;
  updated?: boolean;
  temp?: boolean;
  pedestrian?: boolean;
  car?: boolean;
  track?: boolean;
  secondary?: boolean;
  node?: boolean;
  road?: boolean;
  tramTrack?: boolean;
  trainTrack?: boolean;
}

export interface CS2LaneReferencesWorld {
  entities: ReadonlyMap<E, CS2LaneReferencesComponents>;
  /** Original Entity.Index, including sign; PathNode owner identity ignores Version. */
  entityIndices: ReadonlyMap<E, number>;
  prefabCars: ReadonlyMap<E, { roadTypes: number }>;
  prefabParking: ReadonlyMap<E, { roadTypes: number }>;
  prefabTracks: ReadonlyMap<E, { trackTypes: number }>;
}

export interface CS2LaneReferencesChunk {
  /** Original unfilteredChunkIndex, retained in deferred command sort keys. */
  index: number;
  entities: readonly E[];
}

export interface CS2LaneReferencesInput {
  /** Lane + Owner, any Created/Deleted, no SecondaryLane; actual archetype chunks. */
  laneChunks: readonly CS2LaneReferencesChunk[];
  /** SubLane + Updated, used by skipped-lane repair even after loading. */
  updatedOwnerChunks: readonly CS2LaneReferencesChunk[];
  /** SubLane; required when loaded is true. */
  allOwnerChunks?: readonly CS2LaneReferencesChunk[];
  loaded: boolean;
  /** undefined = queue not allocated. [] still runs edge endpoint repair. */
  skippedLanes?: readonly CS2ReferencedLaneNodes[];
}

export interface CS2LaneReferenceCommand {
  kind: "add" | "remove";
  jobIndex: number;
  entity: E;
  component: "PathfindUpdated" | "TramTrack" | "TrainTrack";
}

export interface CS2LaneReferencesResult {
  world: CS2LaneReferencesWorld;
  commands: CS2LaneReferenceCommand[];
  /** Consuming OnGameLoaded's one-shot flag is part of OnUpdate. */
  loaded: false;
  /** First inserted mapping wins; no transitive closure is performed. */
  pathNodeMap: ReadonlyMap<bigint, bigint>;
}

const PED = 1;
const ROAD = 2;
const PARKING = 4;
const TRACK = 16;
const BOARDING = 0x400;
const SPECIAL_PARKING = 0x1000;
const BICYCLE = 0x4000;
const BICYCLE_PARKING = 0x8000;
const BIKE_ROAD_TYPE = 16;
const secondary = (node: bigint, enabled: boolean) =>
  enabled ? node | 0x80000000n : node & 0xffffffff7fffffffn;

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined)
    throw new Error(`LaneReferences missing ${description}`);
  return value;
}

function cloneComponents(
  row: CS2LaneReferencesComponents,
): CS2LaneReferencesComponents {
  return {
    ...row,
    ...(row.lane && { lane: [...row.lane] as CS2ReferencedLaneNodes }),
    ...(row.subLanes && {
      subLanes: row.subLanes.map((entry) => ({ ...entry })),
    }),
    ...(row.connectedEdges && { connectedEdges: [...row.connectedEdges] }),
    ...(row.edge && { edge: { ...row.edge } }),
    ...(row.edgeLane && { edgeLane: { delta: [...row.edgeLane.delta] } }),
    ...(row.master && { master: { ...row.master } }),
    ...(row.slave && { slave: { ...row.slave } }),
    ...(row.parking && { parking: { ...row.parking } }),
    ...(row.connection && { connection: { ...row.connection } }),
  };
}

function profile(row: CS2LaneReferencesComponents, owner: boolean) {
  return owner
    ? [
        !!row.node,
        !!row.road,
        !!row.tramTrack,
        !!row.trainTrack,
        !!row.temp,
        row.connectedEdges !== undefined,
      ].join(",")
    : [
        !!row.deleted,
        !!row.pedestrian,
        !!row.car,
        !!row.track,
        row.parking !== undefined,
        row.connection !== undefined,
        row.prefab !== undefined,
      ].join(",");
}

interface SubLaneOrder {
  subLane: CS2ReferencedSubLane;
  group: number;
  index: number;
  fullLane: boolean;
  mergeLane: boolean;
}

/** Full LaneReferencesSystem job sequence; component writes precede deferred ECB playback. */
export function cs2UpdateLaneReferences(
  source: CS2LaneReferencesWorld,
  input: CS2LaneReferencesInput,
): CS2LaneReferencesResult {
  const entities = new Map<E, CS2LaneReferencesComponents>(
    [...source.entities].map(([id, row]) => [id, cloneComponents(row)]),
  );
  const world = { ...source, entities };
  const commands: CS2LaneReferenceCommand[] = [];
  const pathNodeMap = new Map<bigint, bigint>();
  const get = (id: E) => required(entities.get(id), `entity ${String(id)}`);
  const lanes = (id: E) =>
    required(get(id).subLanes, `SubLane on ${String(id)}`);
  const nodes = (id: E) => required(get(id).lane, `Lane on ${String(id)}`);
  const emit = (
    kind: CS2LaneReferenceCommand["kind"],
    chunk: number,
    entity: E,
    component: CS2LaneReferenceCommand["component"],
  ) => commands.push({ kind, jobIndex: chunk, entity, component });
  const chunkRows = (chunk: CS2LaneReferencesChunk, owner: boolean) => {
    const rows = chunk.entities.map(get);
    if (
      rows.length &&
      rows.some((row) => profile(row, owner) !== profile(rows[0], owner))
    )
      throw new Error(
        "LaneReferences chunk mixes source archetype component profiles",
      );
    return rows;
  };

  // UpdateLaneReferencesJob: existing membership compares only Entity, never methods.
  for (const chunk of input.laneChunks) {
    const rows = chunkRows(chunk, false);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      required(row.lane, "Lane in lanes query");
      const owner = required(row.owner, "Owner in lanes query");
      if (row.secondary || (!row.created && !row.deleted))
        throw new Error(
          "LaneReferences lane query violates source Created/Deleted/Secondary filters",
        );
      const id = chunk.entities[i];
      if (row.deleted) {
        const target = entities.get(owner)?.subLanes;
        if (target) {
          const at = target.findIndex((value) => value.lane === id);
          if (at !== -1)
            get(owner).subLanes = target.filter((_, j) => j !== at);
        }
        continue;
      }
      const target = lanes(owner);
      let methods = (row.pedestrian ? PED : 0) | (row.track ? TRACK : 0);
      if (row.car) {
        const data = source.prefabCars.get(
          required(row.prefab, "CarLane PrefabRef"),
        );
        if (data) {
          if ((data.roadTypes & ~BIKE_ROAD_TYPE) !== 0) methods |= ROAD;
          if ((data.roadTypes & BIKE_ROAD_TYPE) !== 0) methods |= BICYCLE;
        }
      }
      if (row.parking) {
        const data = source.prefabParking.get(
          required(row.prefab, "ParkingLane PrefabRef"),
        );
        if (data) {
          if ((data.roadTypes & ~BIKE_ROAD_TYPE) !== 0)
            methods |=
              row.parking.flags & 0x10000
                ? BOARDING | SPECIAL_PARKING
                : PARKING | BOARDING;
          if ((data.roadTypes & BIKE_ROAD_TYPE) !== 0)
            methods |= BICYCLE_PARKING;
        }
      }
      if (row.connection) {
        const { flags, roadTypes } = row.connection;
        if (flags & 0x80) methods |= PED;
        if (flags & 0x20) methods |= ROAD;
        if (flags & 0x40) methods |= TRACK;
        if (flags & 0x100) {
          if ((roadTypes & ~BIKE_ROAD_TYPE) !== 0)
            methods |= PARKING | BOARDING;
          if ((roadTypes & BIKE_ROAD_TYPE) !== 0) methods |= BICYCLE_PARKING;
        }
      }
      if (!target.some((value) => value.lane === id))
        get(owner).subLanes = [...target, { lane: id, pathMethods: methods }];
    }
  }

  if (input.skippedLanes !== undefined) {
    // FillNodeMapJob: input queue order is observable when endpoints collide.
    for (const lane of input.skippedLanes) {
      const target = secondary(lane[1], false);
      for (const node of lane)
        if (!pathNodeMap.has(node)) pathNodeMap.set(node, target);
    }
    // FixSkippedLanesJob always queries Updated owners, including the load pass.
    for (const chunk of input.updatedOwnerChunks) {
      const rows = chunkRows(chunk, true);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.updated)
          throw new Error(
            "LaneReferences updated-owner query requires Updated",
          );
        if (row.connectedEdges === undefined) continue;
        const owner = chunk.entities[i];
        const isTemp = !!row.temp;
        for (const subLane of lanes(owner)) {
          if ((subLane.pathMethods & (PED | ROAD | BICYCLE)) === 0) continue;
          const lane = [...nodes(subLane.lane)] as [bigint, bigint, bigint];
          for (const at of [0, 2]) {
            const target = pathNodeMap.get(
              secondary(cs2StripPathNodeCurve(lane[at]), isTemp),
            );
            if (target !== undefined) lane[at] = target;
          }
          get(subLane.lane).lane = lane;
        }
        for (const edgeId of row.connectedEdges) {
          const edgeOwner = entities.get(edgeId);
          if (edgeOwner?.subLanes === undefined) continue;
          const edge = required(edgeOwner.edge, "Edge on connected owner");
          if (edge.start !== owner && edge.end !== owner) continue;
          const delta = edge.end === owner ? 1 : 0;
          const segment = edge.end === owner ? 4 : 0;
          for (const subLane of edgeOwner.subLanes) {
            const data = get(subLane.lane);
            if (
              (subLane.pathMethods & (PED | ROAD | TRACK | BICYCLE)) === 0 ||
              !data.edgeLane
            )
              continue;
            const matchStart = Math.fround(data.edgeLane.delta[0]) === delta;
            const matchEnd = Math.fround(data.edgeLane.delta[1]) === delta;
            if (!matchStart && !matchEnd) continue;
            const lane = [...nodes(subLane.lane)] as [bigint, bigint, bigint];
            const at = matchStart ? 0 : 2;
            const old = lane[at];
            let candidate = old;
            if (
              Number(BigInt.asIntN(32, old >> 32n)) ===
              (required(source.entityIndices.get(owner), "owner Entity.Index") |
                0)
            )
              candidate =
                (lane[1] & 0xffffffffffff00ffn) | (BigInt(segment) << 8n);
            const target =
              pathNodeMap.get(secondary(candidate, isTemp)) ?? candidate;
            if (old !== target) {
              lane[at] = target;
              data.lane = lane;
              if (!edgeOwner.updated)
                emit("add", chunk.index, subLane.lane, "PathfindUpdated");
            }
          }
        }
      }
    }
  }

  // UpdateLaneIndicesJob runs once; loaded selects all owners for this job only.
  const ownerChunks = input.loaded
    ? required(input.allOwnerChunks, "all-owner query after loading")
    : input.updatedOwnerChunks;
  for (const chunk of ownerChunks) {
    const rows = chunkRows(chunk, true);
    for (let ownerAt = 0; ownerAt < rows.length; ownerAt++) {
      const owner = chunk.entities[ownerAt];
      const row = rows[ownerAt];
      if (!input.loaded && !row.updated)
        throw new Error("LaneReferences updated-owner query requires Updated");
      const isRoadNode = !!row.node && !!row.road;
      const oldTrackTypes = isRoadNode
        ? (row.tramTrack ? 2 : 0) | (row.trainTrack ? 1 : 0)
        : 0;
      let trackTypes = 0;
      const list: SubLaneOrder[] = lanes(owner).map((subLane, j) => {
        const data = get(subLane.lane);
        if (isRoadNode && subLane.pathMethods & TRACK) {
          const prefab = required(data.prefab, "TrackLane PrefabRef");
          trackTypes |= source.prefabTracks.get(prefab)?.trackTypes ?? 0;
        }
        if (data.master)
          return {
            subLane,
            group: data.master.group >>> 0,
            index: -1,
            fullLane: false,
            mergeLane: false,
          };
        if (data.slave)
          return {
            subLane,
            group: data.slave.group >>> 0,
            index: (data.slave.subIndex << 16) | j,
            fullLane: !(data.slave.flags & 6),
            mergeLane: !!(data.slave.flags & 16),
          };
        return {
          subLane,
          group: data.secondary ? 0xffffffff : 0xfffffffe,
          index: j,
          fullLane: false,
          mergeLane: false,
        };
      });
      cs2NativeSort(list, (a, b) =>
        a.group === b.group
          ? (a.index - b.index) | 0
          : a.group < b.group
            ? -1
            : 1,
      );
      const output: CS2ReferencedSubLane[] = [];
      let at = 0;
      while (at < list.length) {
        const first = list[at];
        if (first.group >= 0xfffffffe) {
          output[at++] = first.subLane;
          continue;
        }
        let min = at;
        let end = at + 1;
        let fullLanes = first.fullLane ? 1 : 0;
        let bikeOnly = false;
        while (end < list.length && list[end].group === first.group) {
          const next = list[end++];
          const bike =
            (next.subLane.pathMethods & (ROAD | BICYCLE)) === BICYCLE;
          if (next.fullLane && !bike) fullLanes++;
          bikeOnly ||= bike;
        }
        let masterIndex = -1;
        if (first.index === -1) {
          min++;
          const master = required(
            get(first.subLane.lane).master,
            "group MasterLane",
          );
          master.flags = (master.flags & ~1) | (bikeOnly ? 1 : 0);
          master.minIndex = min & 65535;
          master.maxIndex = (end - 1) & 65535;
          masterIndex = at;
          output[at++] = first.subLane;
        }
        let previous: CS2ReferencedLaneNodes = [0n, 0n, 0n];
        let next: CS2ReferencedLaneNodes =
          at < end ? nodes(list[at].subLane.lane) : [0n, 0n, 0n];
        let previousMerge = false;
        while (at < end) {
          const current = list[at];
          const slave = required(
            get(current.subLane.lane).slave,
            "group SlaveLane",
          );
          slave.flags &= ~(8 | 32 | 64 | 128 | 256);
          const lane = next;
          if (at > min && current.mergeLane === previousMerge) {
            if (previous[0] !== lane[0]) slave.flags |= 32;
            if (previous[2] !== lane[2]) slave.flags |= 128;
          }
          if (at + 1 < end) {
            const following = list[at + 1];
            next = nodes(following.subLane.lane);
            if (current.mergeLane === following.mergeLane) {
              if (next[0] !== lane[0]) slave.flags |= 64;
              if (next[2] !== lane[2]) slave.flags |= 256;
            }
          }
          previous = lane;
          previousMerge = current.mergeLane;
          slave.minIndex = min & 65535;
          slave.maxIndex = (end - 1) & 65535;
          slave.subIndex = at & 65535;
          slave.masterIndex = (masterIndex === -1 ? at : masterIndex) & 65535;
          if (fullLanes >= 2) slave.flags |= 8;
          output[at++] = current.subLane;
        }
      }
      row.subLanes = output;
      if (oldTrackTypes !== trackTypes) {
        if (oldTrackTypes & ~trackTypes & 2)
          emit("remove", chunk.index, owner, "TramTrack");
        if (trackTypes & ~oldTrackTypes & 2)
          emit("add", chunk.index, owner, "TramTrack");
        if (oldTrackTypes & ~trackTypes & 1)
          emit("remove", chunk.index, owner, "TrainTrack");
        if (trackTypes & ~oldTrackTypes & 1)
          emit("add", chunk.index, owner, "TrainTrack");
      }
    }
  }
  return { world, commands, loaded: false, pathNodeMap };
}
