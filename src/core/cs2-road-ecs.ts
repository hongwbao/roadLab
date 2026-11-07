/** Structural host for original road construction jobs; source/barrier boundaries are explicit. */
import type { V } from "./types";
import type { CS2RoadCurve } from "./cs2-net-geometry";
import type {
  CS2RoadBounds,
  CS2RoadTerrainReader,
} from "./cs2-road-intersections";
import type { CS2RoadCoursePos } from "./cs2-road-courses";
export type CS2RoadApplyRecord = Record<string, any>;
export type CS2RoadApplyComponents = ReadonlyMap<
  string,
  ReadonlyMap<string, CS2RoadApplyRecord>
>;
export type CS2RoadApplyBuffers = ReadonlyMap<
  string,
  ReadonlyMap<string, readonly CS2RoadApplyRecord[]>
>;
export type CS2RoadApplyNode = {
  position: V;
  rotation: CS2RoadCoursePos["rotation"];
};
export type CS2RoadApplyEdge = { start: string | null; end: string | null };
export type CS2RoadApplyCurve = { bezier: CS2RoadCurve; length: number };
export type CS2RoadApplyTemp = {
  original: string | null;
  curvePosition: number;
  value: number;
  cost: number;
  flags: number;
};
export type CS2RoadApplyArchetype = {
  components: ReadonlyMap<string, CS2RoadApplyRecord>;
  buffers: ReadonlyMap<string, readonly CS2RoadApplyRecord[]>;
};
export type CS2RoadApplyTreeNode = {
  bounds: CS2RoadBounds;
  entity?: string | null;
  children?: readonly CS2RoadApplyTreeNode[];
};
export type CS2RoadApplyWorld = {
  components: CS2RoadApplyComponents;
  buffers: CS2RoadApplyBuffers;
  enabled: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
  entityOrder: readonly string[];
  entitySerial?: number;
  archetypes: ReadonlyMap<string, CS2RoadApplyArchetype>;
  reusedOwners: readonly {
    definition: {
      prefab: string | null;
      position: V;
      rotation: CS2RoadCoursePos["rotation"];
    };
    entity: string;
  }[];
  terrainBounds?: CS2RoadBounds;
  terrain?: CS2RoadTerrainReader;
  searchTree?: readonly CS2RoadApplyTreeNode[];
};
export function createCS2RoadApplyWorld(
  input: Partial<CS2RoadApplyWorld> = {},
): CS2RoadApplyWorld {
  const components = input.components ?? new Map(),
    buffers = input.buffers ?? new Map();
  const entityOrder = input.entityOrder ?? [
    ...new Set(
      [...components.values(), ...buffers.values()].flatMap((map) => [
        ...map.keys(),
      ]),
    ),
  ];
  return {
    components,
    buffers,
    enabled: new Map(),
    entityOrder,
    archetypes: new Map(),
    reusedOwners: [],
    ...input,
  };
}
export type CS2RoadApplyBarrier =
  "ModificationBarrier1" | "ModificationBarrier2" | "ToolOutputBarrier";
export type CS2RoadApplyCommand = (
  | { kind: "create-entity"; entity: string; archetype: string }
  | { kind: "destroy-entity"; entity: string }
  | {
      kind: "add-component" | "set-component";
      entity: string;
      component: string;
      value: CS2RoadApplyRecord;
    }
  | { kind: "remove-component"; entity: string; component: string }
  | {
      kind: "add-buffer" | "set-buffer";
      entity: string;
      component: string;
      value: CS2RoadApplyRecord[];
    }
) & { jobIndex: number };
export type CS2RoadApplyChunk = {
  entities: readonly string[];
  components: ReadonlySet<string>;
  buffers: ReadonlySet<string>;
};
/** Dictionary ECS storage. It publishes structural commands only at named source barriers. */
export class CS2RoadApplyECS {
  readonly components: Map<string, Map<string, CS2RoadApplyRecord>>;
  readonly buffers: Map<string, Map<string, CS2RoadApplyRecord[]>>;
  readonly enabled: Map<string, Map<string, boolean>>;
  readonly entityOrder: string[];
  entitySerial: number;
  constructor(readonly input: CS2RoadApplyWorld) {
    this.components = new Map(
      [...input.components].map(([name, map]) => [
        name,
        new Map([...map].map(([id, value]) => [id, structuredClone(value)])),
      ]),
    );
    this.buffers = new Map(
      [...input.buffers].map(([name, map]) => [
        name,
        new Map(
          [...map].map(([id, value]) => [id, structuredClone([...value])]),
        ),
      ]),
    );
    this.enabled = new Map(
      [...input.enabled].map(([name, map]) => [name, new Map(map)]),
    );
    this.entityOrder = [...input.entityOrder];
    this.entitySerial = input.entitySerial ?? 0;
  }
  has(component: string, entity: string | null) {
    return (
      entity !== null &&
      (this.components.get(component)?.has(entity) === true ||
        this.buffers.get(component)?.has(entity) === true)
    );
  }
  hasBuffer(component: string, entity: string | null) {
    return entity !== null && this.buffers.get(component)?.has(entity) === true;
  }
  get<T = CS2RoadApplyRecord>(component: string, entity: string | null): T {
    const value =
      entity === null ? undefined : this.components.get(component)?.get(entity);
    if (value === undefined)
      throw new Error(`Missing source ${component}: ${entity}`);
    return structuredClone(value) as T;
  }
  tryGet<T = CS2RoadApplyRecord>(
    component: string,
    entity: string | null,
  ): T | undefined {
    const value =
      entity === null ? undefined : this.components.get(component)?.get(entity);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }
  buffer(component: string, entity: string | null) {
    const value =
      entity === null ? undefined : this.buffers.get(component)?.get(entity);
    if (value === undefined)
      throw new Error(`Missing source buffer ${component}: ${entity}`);
    return value;
  }
  isEnabled(component: string, entity: string | null) {
    if (!this.has(component, entity))
      throw new Error(
        `Missing source enabled component ${component}: ${entity}`,
      );
    return this.enabled.get(component)?.get(entity!) ?? true;
  }
  chunks(query: {
    all?: readonly string[];
    any?: readonly string[];
    none?: readonly string[];
  }): CS2RoadApplyChunk[] {
    const groups = new Map<
      string,
      { entities: string[]; components: Set<string>; buffers: Set<string> }
    >();
    for (const entity of this.entityOrder) {
      if (this.has("Disabled", entity) || this.has("Prefab", entity)) continue;
      if (
        !query.all?.every((name) => this.has(name, entity)) &&
        query.all !== undefined
      )
        continue;
      if (
        query.any !== undefined &&
        !query.any.some((name) => this.has(name, entity))
      )
        continue;
      if (query.none?.some((name) => this.has(name, entity))) continue;
      const components = new Set(
          [...this.components]
            .filter(([, map]) => map.has(entity))
            .map(([name]) => name),
        ),
        buffers = new Set(
          [...this.buffers]
            .filter(([, map]) => map.has(entity))
            .map(([name]) => name),
        );
      if (components.size + buffers.size === 0) continue;
      const key = JSON.stringify([[...components].sort(), [...buffers].sort()]);
      let chunk = groups.get(key);
      if (!chunk) {
        chunk = { entities: [], components, buffers };
        groups.set(key, chunk);
      }
      chunk.entities.push(entity);
    }
    return [...groups.values()];
  }
  set(component: string, entity: string, value: CS2RoadApplyRecord) {
    if (!this.components.has(component))
      this.components.set(component, new Map());
    this.components.get(component)!.set(entity, structuredClone(value));
  }
  setBuffer(
    component: string,
    entity: string,
    value: readonly CS2RoadApplyRecord[],
  ) {
    if (!this.buffers.has(component)) this.buffers.set(component, new Map());
    this.buffers.get(component)!.set(entity, structuredClone([...value]));
  }
  publish(commands: readonly CS2RoadApplyCommand[]) {
    for (const command of commands) {
      const entity = command.entity;
      switch (command.kind) {
        case "create-entity": {
          if (this.entityOrder.includes(entity))
            throw new Error(`Duplicate source temporary entity: ${entity}`);
          const archetype = this.input.archetypes.get(command.archetype);
          if (!archetype)
            throw new Error(
              `Missing source NetData archetype: ${command.archetype}`,
            );
          this.entityOrder.push(entity);
          for (const [name, value] of archetype.components)
            this.set(name, entity, value);
          for (const [name, value] of archetype.buffers)
            this.setBuffer(name, entity, value);
          break;
        }
        case "destroy-entity":
          for (const map of [
            ...this.components.values(),
            ...this.buffers.values(),
            ...this.enabled.values(),
          ])
            map.delete(entity);
          {
            const index = this.entityOrder.indexOf(entity);
            if (index >= 0) this.entityOrder.splice(index, 1);
          }
          break;
        case "set-component":
          if (!this.components.get(command.component)?.has(entity))
            throw new Error(
              `Source SetComponent missing archetype component ${command.component}: ${entity}`,
            );
          this.set(command.component, entity, command.value);
          break;
        case "add-component":
          this.set(command.component, entity, command.value);
          break;
        case "remove-component":
          this.components.get(command.component)?.delete(entity);
          this.buffers.get(command.component)?.delete(entity);
          this.enabled.get(command.component)?.delete(entity);
          break;
        case "add-buffer":
        case "set-buffer":
          this.setBuffer(command.component, entity, command.value);
          break;
      }
    }
  }
  snapshot(): CS2RoadApplyWorld {
    return {
      ...this.input,
      components: new Map(
        [...this.components].map(([key, map]) => [
          key,
          new Map(
            [...map].map(([entity, value]) => [entity, structuredClone(value)]),
          ),
        ]),
      ),
      buffers: new Map(
        [...this.buffers].map(([key, map]) => [
          key,
          new Map(
            [...map].map(([entity, value]) => [entity, structuredClone(value)]),
          ),
        ]),
      ),
      enabled: new Map(
        [...this.enabled].map(([key, map]) => [key, new Map(map)]),
      ),
      entityOrder: [...this.entityOrder],
      entitySerial: this.entitySerial,
    };
  }
}
/** Full buffer contents remain attached to their deferred Set/AddBuffer command. */
export class CS2RoadApplyCommandWriter {
  readonly commands: CS2RoadApplyCommand[] = [];
  private next = 0;
  constructor(
    readonly phase: CS2RoadApplyBarrier,
    readonly ecs?: CS2RoadApplyECS,
  ) {}
  create(archetype: string, jobIndex = 0) {
    let entity: string;
    do {
      entity = `$${this.phase}:${this.ecs ? this.ecs.entitySerial++ : this.next++}`;
    } while (this.ecs?.entityOrder.includes(entity));
    this.commands.push({ kind: "create-entity", entity, archetype, jobIndex });
    return entity;
  }
  set(
    entity: string,
    component: string,
    value: CS2RoadApplyRecord,
    jobIndex = 0,
  ) {
    this.commands.push({
      kind: "set-component",
      entity,
      component,
      value: structuredClone(value),
      jobIndex,
    });
  }
  add(
    entity: string,
    component: string,
    value: CS2RoadApplyRecord = {},
    jobIndex = 0,
  ) {
    this.commands.push({
      kind: "add-component",
      entity,
      component,
      value: structuredClone(value),
      jobIndex,
    });
  }
  remove(entity: string, component: string, jobIndex = 0) {
    this.commands.push({
      kind: "remove-component",
      entity,
      component,
      jobIndex,
    });
  }
  buffer(entity: string, component: string, set = false, jobIndex = 0) {
    const value: CS2RoadApplyRecord[] = [];
    this.commands.push({
      kind: set ? "set-buffer" : "add-buffer",
      entity,
      component,
      value,
      jobIndex,
    });
    return value;
  }
}
