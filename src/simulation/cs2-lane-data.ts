import type { CS2CreatedNodeCarLane } from "./cs2-node-lane-creation";
import type {
  CS2LaneReferencesComponents,
  CS2LaneReferencesChunk,
} from "./cs2-lane-references";

type E = string | null;
type Nodes = readonly [bigint, bigint, bigint];
type Bounds = { min: number; max: number };
const f = Math.fround;

export interface CS2LaneDataComponents extends Omit<
  CS2LaneReferencesComponents,
  "car" | "pedestrian" | "track" | "connection"
> {
  car?: CS2CreatedNodeCarLane;
  pedestrian?: { accessRestriction: E; flags: number };
  track?: {
    accessRestriction: E;
    flags: number;
    speedLimit: number;
    curviness: number;
  };
  connection?: {
    accessRestriction: E;
    flags: number;
    roadTypes: number;
    trackTypes: number;
  };
  pathfindUpdated?: boolean;
  garage?: boolean;
  gate?: boolean;
  building?: boolean;
  attachment?: { attached: E };
  composition?: { edge: E };
  city?: { optionMask: number };
  borderDistrict?: { left: E; right: E };
  district?: { optionMask: number };
  /** Buffer index is the original DistrictModifierType ordinal. */
  districtModifiers?: readonly (readonly [number, number])[];
  connectedNodes?: readonly E[];
  laneObjects?: readonly {
    object: E;
    curvePosition: readonly [number, number];
  }[];
  moving?: boolean;
  vehicleCar?: { flags: number };
  involvedInAccident?: { event: E };
  accidentSite?: { flags: number };
  targets?: readonly E[];
}

export interface CS2LaneDataWorld {
  entities: ReadonlyMap<E, CS2LaneDataComponents>;
  prefabCars: ReadonlyMap<E, { roadTypes: number }>;
  prefabBuildings: ReadonlyMap<E, { flags: number }>;
  prefabGeometry: ReadonlyMap<E, { flags: number }>;
  netCompositions: ReadonlyMap<
    E,
    { flags: { general: number; left: number; right: number } }
  >;
}

export interface CS2LaneDataInput {
  /** Explicit CitySystem.City; null is a real empty-city world. */
  city: E;
  laneChunks: readonly CS2LaneReferencesChunk[];
  cautionChunks: readonly CS2LaneReferencesChunk[];
}

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`LaneData missing ${label}`);
  return value;
};
const option = (mask: number, ordinal: number) => !!(mask & (1 << ordinal));
const endpointsMatch = (a: Nodes, b: Nodes) =>
  a[0] === b[0] || a[2] === b[0] || a[0] === b[2] || a[2] === b[2];
const profile = (row: CS2LaneDataComponents) =>
  [
    row.car !== undefined,
    row.pedestrian !== undefined,
    row.track !== undefined,
    row.connection !== undefined,
    row.edgeLane !== undefined,
    row.owner !== undefined,
    row.master !== undefined,
    row.slave !== undefined,
    row.prefab !== undefined,
    row.laneObjects !== undefined,
  ].join(",");

/** Complete LaneDataSystem's two jobs and all helpers, after reference/overlap playback. */
export function cs2UpdateLaneData(
  source: CS2LaneDataWorld,
  input: CS2LaneDataInput,
) {
  const entities = new Map<E, CS2LaneDataComponents>(
    [...source.entities].map(([id, row]) => [
      id,
      {
        ...row,
        ...(row.car && { car: { ...row.car } }),
        ...(row.pedestrian && { pedestrian: { ...row.pedestrian } }),
        ...(row.track && { track: { ...row.track } }),
        ...(row.connection && { connection: { ...row.connection } }),
      },
    ]),
  );
  const world: CS2LaneDataWorld = { ...source, entities };
  const get = (id: E) => required(entities.get(id), `entity ${String(id)}`);
  const data = (id: E) => entities.get(id);
  const nodes = (id: E) => required(get(id).lane, `Lane ${String(id)}`);
  const subLanes = (id: E) =>
    required(get(id).subLanes, `SubLane ${String(id)}`);
  const edges = (id: E) =>
    required(get(id).connectedEdges, `ConnectedEdge ${String(id)}`);
  const car = (id: E) => required(get(id).car, `CarLane ${String(id)}`);
  const chunkRows = (chunk: CS2LaneReferencesChunk) => {
    const rows = chunk.entities.map(get);
    if (rows.length && rows.some((row) => profile(row) !== profile(rows[0])))
      throw new Error(
        "LaneData chunk mixes source archetype component profiles",
      );
    return rows;
  };

  // GetTopLevelOwner: Attachment substitution happens once, after the Owner chain.
  const topLevelOwner = (id: E) => {
    let owner = id;
    let restrictionMask = 0x20 | 0x40 | 0x1000 | 0x2000;
    const seen = new Set<E>();
    while (data(owner)?.owner !== undefined) {
      if (seen.has(owner)) throw new Error("LaneData cyclic Owner dependency");
      seen.add(owner);
      const row = get(owner);
      if (row.building) {
        const prefab = required(row.prefab, "nested Building PrefabRef");
        restrictionMask &= required(
          source.prefabBuildings.get(prefab),
          "nested BuildingData",
        ).flags;
      }
      owner = required(row.owner, "Owner");
    }
    const attachment = data(owner)?.attachment;
    if (attachment && attachment.attached !== null) owner = attachment.attached;
    return { owner, restrictionMask };
  };

  // GetAccessRestriction, including both source side-connection graph walks.
  const access = (
    initialOwner: E,
    flag: number,
    isEdge: boolean,
    initialSide: boolean,
    noRestriction: boolean,
    roundabout: boolean,
    lane: Nodes,
  ) => {
    let owner = initialOwner;
    const isSide =
      initialSide || (!isEdge && data(owner)?.connectedNodes !== undefined);
    if (isSide) {
      const connected = data(owner)?.connectedNodes;
      if (connected !== undefined) {
        searchNodes: for (const node of connected) {
          for (const edge of edges(node)) {
            if (edge === owner || data(edge)?.subLanes === undefined) continue;
            for (const sub of subLanes(edge)) {
              if (!endpointsMatch(nodes(sub.lane), lane)) continue;
              owner = edge;
              break searchNodes;
            }
          }
        }
      } else {
        const connectedEdges = data(owner)?.connectedEdges;
        if (connectedEdges !== undefined) {
          searchEdges: for (const edge of connectedEdges) {
            const edgeData = required(get(edge).edge, "side-connection Edge");
            if (edgeData.start !== owner && edgeData.end !== owner) continue;
            for (const node of required(
              get(edge).connectedNodes,
              "side-connection ConnectedNode",
            )) {
              for (const linkedEdge of edges(node)) {
                if (
                  linkedEdge === edge ||
                  data(linkedEdge)?.subLanes === undefined
                )
                  continue;
                for (const sub of subLanes(linkedEdge)) {
                  if (!endpointsMatch(nodes(sub.lane), lane)) continue;
                  owner = linkedEdge;
                  break searchEdges;
                }
              }
            }
          }
        }
      }
    }
    const none = { owner: null as E, allowEnter: false, allowExit: false };
    const prefab = data(owner)?.prefab;
    if (
      prefab !== undefined &&
      (source.prefabGeometry.get(prefab)?.flags ?? 0) & 0x1000000
    )
      return none;
    const top = topLevelOwner(owner);
    if (!data(top.owner)?.building) return none;
    const buildingPrefab = required(
      get(top.owner).prefab,
      "Building PrefabRef",
    );
    let flags =
      required(source.prefabBuildings.get(buildingPrefab), "BuildingData")
        .flags & top.restrictionMask;
    if (noRestriction) flags &= ~flag;
    if (data(owner)?.road) flags &= ~(0x20 | 0x40);
    if (data(owner)?.gate) return none;
    const restricted = !!(flags & flag);
    const includesCar = !!(flag & 0x40);
    const includesPed = !!(flag & 0x20);
    if (!restricted && !includesCar && !includesPed) return none;
    const connected = data(owner)?.connectedEdges;
    if (!isEdge && !isSide && connected !== undefined) {
      let start = false;
      let end = false;
      for (const edge of connected) {
        const edgeData = required(get(edge).edge, "restriction Edge");
        if (edgeData.start !== owner && edgeData.end !== owner) continue;
        const children = data(edge)?.subLanes;
        if (data(edge)?.gate && children !== undefined) {
          for (const sub of children)
            if (endpointsMatch(nodes(sub.lane), lane)) return none;
        }
        const sameOwner = top.owner === topLevelOwner(edge).owner;
        if (roundabout) {
          if (sameOwner) {
            if (children !== undefined)
              for (const sub of children)
                start ||= endpointsMatch(nodes(sub.lane), lane);
          } else end = true;
        } else {
          if (sameOwner) continue;
          if (!includesCar) return none;
          if (children === undefined) continue;
          for (const sub of children) {
            const other = nodes(sub.lane);
            start ||= other[0] === lane[0] || other[2] === lane[0];
            end ||= other[0] === lane[2] || other[2] === lane[2];
            if (start && end) return none;
          }
        }
      }
      if (roundabout && !start && end) return none;
    }
    const allowEnter = !restricted;
    const allowExit =
      includesCar && includesPed
        ? !(flags & 0x1000)
        : includesPed
          ? allowEnter && !!(flags & 0x40)
          : false;
    return { owner: top.owner, allowEnter, allowExit };
  };

  const borderOption = (border: { left: E; right: E }, ordinal: number) => {
    let enabled = false;
    let disabled = false;
    for (const id of [border.left, border.right]) {
      const district = data(id)?.district;
      if (district) {
        if (option(district.optionMask, ordinal)) enabled = true;
        else disabled = true;
      }
    }
    return enabled && !disabled;
  };
  const cityOptions = (value: CS2CreatedNodeCarLane, mask: number) => {
    if (value.flags & 0x10000 && option(mask, 0))
      value.speedLimit = f(111.111115);
  };
  const ownerOptions = (
    value: CS2CreatedNodeCarLane,
    owner: E,
    edge: { delta: readonly [number, number] },
    masterFlags: number,
    roadTypes: number,
  ) => {
    const sharedBike =
      !!(roadTypes & 16) &&
      !!(roadTypes & ~16) &&
      !(masterFlags & 1) &&
      f(edge.delta[0]) !== f(edge.delta[1]);
    let forbidBike = false;
    const border = data(owner)?.borderDistrict;
    if (border) {
      const limits = [value.speedLimit, value.speedLimit];
      if (roadTypes & 1 && !(value.flags & 0x10000)) {
        for (let at = 0; at < 2; at++) {
          const modifiers = data(
            at === 0 ? border.left : border.right,
          )?.districtModifiers;
          if (modifiers !== undefined && modifiers.length > 9) {
            const delta = modifiers[9];
            limits[at] = f(limits[at] + f(delta[0]));
            limits[at] = f(limits[at] + f(limits[at] * f(delta[1])));
          }
        }
      }
      if (sharedBike) forbidBike = borderOption(border, 4);
      const max = Math.max(...limits),
        min = Math.min(...limits);
      value.speedLimit =
        max >= value.speedLimit
          ? Math.max(value.speedLimit, min)
          : Math.min(value.speedLimit, max);
    }
    if (sharedBike) {
      const composition = data(owner)?.composition;
      const flags =
        composition && source.netCompositions.get(composition.edge)?.flags;
      if (flags) {
        const left =
          f(edge.delta[1]) < f(edge.delta[0]) !== !!(flags.general & 4);
        forbidBike ||= !!((left ? flags.left : flags.right) & 0x20000000);
      }
      if (forbidBike) value.flags = (value.flags | 0x4000) >>> 0;
    }
  };
  const blockage = (
    objects: NonNullable<CS2LaneDataComponents["laneObjects"]>,
  ) => {
    const bounds = { min: 1, max: 0 };
    let emergency = false;
    let secured = false;
    for (const object of objects) {
      if (data(object.object)?.moving) continue;
      const a = f(object.curvePosition[0]),
        b = f(object.curvePosition[1]);
      bounds.min = Math.min(bounds.min, a, b);
      bounds.max = Math.max(bounds.max, a, b);
      const accident = data(object.object)?.involvedInAccident;
      if (accident) {
        const site = data(accident.event)?.targets?.find(
          (id) => data(id)?.accidentSite !== undefined,
        );
        secured ||=
          site === undefined ||
          site === null ||
          !!(required(get(site).accidentSite, "AccidentSite").flags & 2);
        emergency = true;
      } else
        emergency ||= !!((data(object.object)?.vehicleCar?.flags ?? 0) & 1);
    }
    return { bounds, emergency, secured };
  };
  const addBlockage = (
    value: CS2CreatedNodeCarLane,
    bounds: Bounds,
    caution: boolean,
  ) => {
    if (bounds.min <= bounds.max) {
      value.blockageStart = Math.max(0, Math.floor(f(bounds.min * 255))) & 255;
      value.blockageEnd = Math.min(255, Math.ceil(f(bounds.max * 255))) & 255;
      if (caution) {
        value.cautionStart = value.blockageStart;
        value.cautionEnd = value.blockageEnd;
      }
    }
  };
  const reset = (value: CS2CreatedNodeCarLane) => {
    value.accessRestriction = null;
    value.flags = (value.flags & ~(0x100 | 0x4000 | 0x80000000)) >>> 0;
    value.speedLimit = f(value.defaultSpeedLimit);
    value.blockageStart = value.cautionStart = 255;
    value.blockageEnd = value.cautionEnd = 0;
  };

  const ran = input.laneChunks.some((chunk) => chunk.entities.length !== 0);
  if (!ran) return { world, ran, commands: [] as never[] };
  for (const chunk of input.laneChunks) {
    const rows = chunkRows(chunk);
    for (const row of rows) {
      required(row.lane, "Lane query component");
      if (
        (!row.car && !row.pedestrian && !row.track && !row.connection) ||
        row.garage ||
        row.deleted ||
        (!row.updated && (!row.pathfindUpdated || row.temp))
      )
        throw new Error("LaneData main query violates source filters");
    }
    if (rows[0]?.car) {
      const cityMask =
        input.city === null
          ? 0
          : required(get(input.city).city, "City").optionMask;
      for (const row of rows) {
        const value = required(row.car, "CarLane");
        reset(value);
        if (!row.master) cityOptions(value, cityMask);
        if (row.owner !== undefined) {
          const owner = row.owner;
          const edge = row.edgeLane ?? { delta: [0, 0] };
          const bounds = { min: 1, max: 0 };
          if (row.master) {
            const children = subLanes(owner);
            let first = true;
            const end = Math.min(row.master.maxIndex, children.length - 1);
            for (let at = row.master.minIndex; at <= end; at++) {
              const objects = data(children[at].lane)?.laneObjects;
              if (objects === undefined) continue;
              const next = blockage(objects);
              if (first) {
                Object.assign(bounds, next.bounds);
                first = false;
              } else {
                bounds.min = Math.max(bounds.min, next.bounds.min);
                bounds.max = Math.min(bounds.max, next.bounds.max);
              }
              if (next.secured) value.flags = (value.flags | 0x100) >>> 0;
            }
          }
          const prefab = required(row.prefab, "CarLane PrefabRef");
          const roadTypes = required(
            source.prefabCars.get(prefab),
            "CarLaneData",
          ).roadTypes;
          const result = access(
            owner,
            roadTypes & (1 | 4 | 8 | 16) ? 0x40 : 0,
            row.edgeLane !== undefined,
            !!(value.flags & 8),
            false,
            !!(value.flags & 0x400000),
            row.lane!,
          );
          value.accessRestriction = result.owner;
          if (result.allowEnter) value.flags = (value.flags | 0x80000000) >>> 0;
          if (row.master) cityOptions(value, cityMask);
          ownerOptions(value, owner, edge, row.master?.flags ?? 0, roadTypes);
          if (row.master) addBlockage(value, bounds, false);
        }
        if (!row.master && row.laneObjects !== undefined) {
          const next = blockage(row.laneObjects);
          let caution = next.emergency;
          if (next.bounds.min <= next.bounds.max && !caution)
            caution = !row.slave || (row.slave.flags & 6) !== 6;
          addBlockage(value, next.bounds, caution);
          if (next.secured) value.flags = (value.flags | 0x100) >>> 0;
        }
      }
    }
    for (const row of rows) {
      const isEdge = row.edgeLane !== undefined;
      if (row.pedestrian) {
        const value = row.pedestrian;
        value.accessRestriction = null;
        value.flags &= ~(8 | 32 | 128);
        if (row.owner !== undefined) {
          const border = data(row.owner)?.borderDistrict;
          if (border && borderOption(border, 2)) value.flags |= 32;
          const result = access(
            row.owner,
            value.flags & 64 ? 0 : 0x20,
            isEdge,
            !!(value.flags & 16),
            false,
            false,
            row.lane!,
          );
          value.accessRestriction = result.owner;
          if (result.allowEnter) value.flags |= 8;
          if (result.allowExit) value.flags |= 128;
        }
      }
    }
    for (const row of rows)
      if (row.track) {
        row.track.accessRestriction =
          row.owner === undefined
            ? null
            : access(
                row.owner,
                row.track.flags & 0x800 ? 0x2000 : 0,
                isEdge(row),
                false,
                false,
                false,
                row.lane!,
              ).owner;
      }
    for (const row of rows)
      if (row.connection) {
        const value = row.connection;
        value.accessRestriction = null;
        value.flags &= ~(0x8000 | 0x10000);
        if (row.owner === undefined) continue;
        const unrestricted = !!(value.flags & 0x20000);
        let mask: number | undefined;
        let useEnter = false,
          useExit = false;
        if (value.flags & 0x80) {
          mask = 0x20;
          useEnter = useExit = true;
        } else if (value.flags & 0x20) {
          mask = value.roadTypes & (1 | 4 | 8 | 16) ? 0x40 : 0;
          useEnter = true;
        } else if (value.flags & 0x100) {
          mask = 0x20 | 0x40;
          useEnter = useExit = true;
        } else if (value.flags & 0x400) {
          mask = 0x40;
          useEnter = true;
        } else if (value.flags & 0x40) mask = 0x2000;
        if (mask !== undefined) {
          const result = access(
            row.owner,
            mask,
            isEdge(row),
            false,
            unrestricted,
            false,
            row.lane!,
          );
          value.accessRestriction = result.owner;
          if (useEnter && result.allowEnter) value.flags |= 0x8000;
          if (useExit && result.allowExit) value.flags |= 0x10000;
        }
      }
  }

  // UpdateLaneData2Job: original direct lookup read/write order; no deferred commands.
  for (const chunk of input.cautionChunks) {
    const rows = chunkRows(chunk);
    for (let at = 0; at < rows.length; at++) {
      const row = rows[at];
      required(row.lane, "Lane in caution query");
      const value = required(row.car, "CarLane in caution query");
      if (!row.updated && (!row.pathfindUpdated || row.deleted || row.temp))
        throw new Error("LaneData caution query violates source filters");
      if (row.owner === undefined) continue;
      for (const child of subLanes(row.owner)) {
        if (child.lane === chunk.entities[at] || !data(child.lane)?.car)
          continue;
        const other = car(child.lane);
        if (
          other.carriagewayGroup !== value.carriagewayGroup ||
          other.cautionEnd < other.cautionStart
        )
          continue;
        if ((value.flags ^ other.flags) & 4) {
          value.cautionStart = Math.min(
            value.cautionStart,
            255 - other.cautionEnd,
          );
          value.cautionEnd = Math.max(
            value.cautionEnd,
            255 - other.cautionStart,
          );
        } else {
          value.cautionStart = Math.min(value.cautionStart, other.cautionStart);
          value.cautionEnd = Math.max(value.cautionEnd, other.cautionEnd);
        }
        value.flags = (value.flags | (other.flags & 0x100)) >>> 0;
      }
    }
  }
  return { world, ran, commands: [] as never[] };
}

const isEdge = (row: CS2LaneDataComponents) => row.edgeLane !== undefined;
