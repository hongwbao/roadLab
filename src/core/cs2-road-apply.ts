/** Original ApplyNetSystem: preview references, buffer repair and ToolOutputBarrier. */
import {
  CS2RoadApplyECS,
  CS2RoadApplyCommandWriter,
  type CS2RoadApplyChunk,
  type CS2RoadApplyRecord,
  type CS2RoadApplyWorld,
  type CS2RoadApplyTemp as Temp,
  type CS2RoadApplyEdge as Edge,
} from "./cs2-road-ecs";
export * from "./cs2-road-ecs";
export { cs2AlignRoadNodes } from "./cs2-road-node-align";
export { cs2GenerateRoadNodes } from "./cs2-road-node-generation";

type Entity = string | null;
type Recent = { modificationFrame: number; modificationCost: number };
type Economy = {
  roadRefundTimeRange: { x: number; y: number; z: number };
  roadRefundPercentage: { x: number; y: number; z: number };
};
export type CS2RoadApplyTrigger = {
  triggerType: number;
  triggerPrefab: Entity;
  primaryTarget: Entity;
  secondaryTarget: Entity;
  value: number;
};
const f = Math.fround,
  plus = (a: number, b: number) => f(f(a) + f(b)),
  times = (a: number, b: number) => f(f(a) * f(b));
const defaults: Record<string, CS2RoadApplyRecord> = {
  LocalConnect: {},
  TrafficLights: {
    state: 0,
    flags: 0,
    signalGroupCount: 0,
    currentSignalGroup: 0,
    nextSignalGroup: 0,
    timer: 0,
  },
  Orphan: { composition: null },
  Native: {},
  Standalone: {},
  LandValue: { landValue: 0, weight: 0 },
  TramTrack: {},
  TrainTrack: {},
  Waterway: {},
  Pollution: { pollution: [0, 0], accumulation: [0, 0] },
  Marker: {},
};
/** Original NetUtils.GetRefundAmount, including uint-to-float conversion and strict time boundaries. */
export function cs2RoadRefundAmount(
  recent: Recent,
  frame: number,
  economy: Economy,
) {
  for (const axis of ["x", "y", "z"] as const)
    if (
      f(frame >>> 0) <
      plus(
        f(recent.modificationFrame >>> 0),
        times(262144, economy.roadRefundTimeRange[axis]),
      )
    ) {
      const amount = times(
        f(recent.modificationCost),
        economy.roadRefundPercentage[axis],
      );
      return Number.isFinite(amount) &&
        amount >= -2147483648 &&
        amount < 2147483648
        ? Math.trunc(amount) | 0
        : -2147483648;
    }
  return 0;
}
class RoadApplication {
  readonly ecs: CS2RoadApplyECS;
  readonly commands: CS2RoadApplyCommandWriter;
  readonly triggers: CS2RoadApplyTrigger[] = [];
  constructor(
    world: CS2RoadApplyWorld,
    readonly frame: number,
  ) {
    this.ecs = new CS2RoadApplyECS(world);
    this.commands = new CS2RoadApplyCommandWriter(
      "ToolOutputBarrier",
      this.ecs,
    );
  }
  get<T = CS2RoadApplyRecord>(name: string, id: Entity) {
    return this.ecs.get<T>(name, id);
  }
  has(name: string, id: Entity) {
    return this.ecs.has(name, id);
  }
  edges(id: Entity) {
    return this.ecs.buffer("ConnectedEdge", id);
  }
  nodes(id: Entity) {
    return this.ecs.buffer("ConnectedNode", id);
  }
  remove(buffer: CS2RoadApplyRecord[], key: string, id: Entity) {
    const index = buffer.findIndex((row) => row[key] === id);
    if (index >= 0) buffer.splice(index, 1);
  }
  unique(buffer: CS2RoadApplyRecord[], key: string, row: CS2RoadApplyRecord) {
    if (!buffer.some((value) => value[key] === row[key]))
      buffer.push(structuredClone(row));
  }
  resolveNode(id: Entity) {
    const t = this.ecs.tryGet<Temp>("Temp", id);
    return t && t.original !== null && !(t.flags & (2 | 256)) ? t.original : id;
  }
  patch(chunks: readonly CS2RoadApplyChunk[]) {
    for (const chunk of chunks) {
      if (chunk.components.has("Edge"))
        for (const id of chunk.entities) {
          const edge = this.get<Edge>("Edge", id),
            temp = this.get<Temp>("Temp", id);
          if (temp.flags & 2) continue;
          if (temp.original !== null && !(temp.flags & (256 | 4096))) {
            // These endpoints must be preview nodes in the original job.
            this.get<Temp>("Temp", edge.start);
            this.get<Temp>("Temp", edge.end);
            edge.start = this.resolveNode(edge.start);
            edge.end = this.resolveNode(edge.end);
            const target = this.nodes(temp.original),
              source = this.nodes(id);
            for (const row of target)
              this.remove(this.edges(row.node), "edge", temp.original);
            target.length = 0;
            for (const row of source) {
              const value = structuredClone(row);
              value.node = this.resolveNode(value.node);
              this.unique(target, "node", value);
              this.unique(this.edges(value.node), "edge", {
                edge: temp.original,
              });
            }
          } else {
            for (const endpoint of ["start", "end"] as const) {
              this.get<Temp>("Temp", edge[endpoint]);
              const resolved = this.resolveNode(edge[endpoint]);
              if (resolved !== edge[endpoint]) {
                this.remove(this.edges(edge[endpoint]), "edge", id);
                edge[endpoint] = resolved;
                this.unique(this.edges(resolved), "edge", { edge: id });
              }
            }
            const source = this.nodes(id);
            for (let i = 0; i < source.length; i++) {
              const value = structuredClone(source[i]),
                resolved = this.resolveNode(value.node);
              if (resolved !== value.node) {
                value.node = resolved;
                source[i] = value;
              }
              this.unique(this.edges(value.node), "edge", { edge: id });
            }
          }
          this.ecs.set("Edge", id, edge);
        }
      if (!chunk.components.has("Node") && !chunk.components.has("Edge"))
        continue;
      for (let id of chunk.entities) {
        const temp = this.get<Temp>("Temp", id);
        let before: Entity = null,
          after: Entity = null,
          previewOwner = false;
        if (this.has("Owner", id)) {
          before = after = this.get<{ owner: Entity }>("Owner", id).owner;
          const ownerTemp = this.ecs.tryGet<Temp>("Temp", after);
          if (ownerTemp) {
            if (
              ownerTemp.original !== null &&
              !(ownerTemp.flags & (256 | 4096))
            ) {
              previewOwner = true;
              after = ownerTemp.original;
              this.ecs.set("Owner", id, { owner: after });
            } else if (!(ownerTemp.flags & (2 | 32768))) previewOwner = true;
          }
        }
        if (temp.original !== null && !(temp.flags & (2 | 256))) {
          if (previewOwner && this.ecs.hasBuffer("SubNet", before))
            this.remove(this.ecs.buffer("SubNet", before), "subNet", id);
          id = temp.original;
          before =
            this.ecs.tryGet<{ owner: Entity }>("Owner", id)?.owner ?? null;
        }
        if (before !== after) {
          if (this.ecs.hasBuffer("SubNet", before))
            this.remove(this.ecs.buffer("SubNet", before), "subNet", id);
          if (this.ecs.hasBuffer("SubNet", after))
            this.unique(this.ecs.buffer("SubNet", after), "subNet", {
              subNet: id,
            });
        }
      }
    }
  }
  fix(chunk: CS2RoadApplyChunk) {
    if (!chunk.components.has("Node")) return;
    for (const id of chunk.entities) {
      const t = this.get<Temp>("Temp", id);
      if (
        t.original === null ||
        t.flags & (2 | 256) ||
        !this.ecs.hasBuffer("ConnectedEdge", t.original)
      )
        continue;
      const b = this.edges(t.original);
      for (let i = b.length - 1; i >= 0; i--) {
        const edge = this.get<Edge>("Edge", b[i].edge);
        if (edge.start === t.original || edge.end === t.original) continue;
        if (
          this.ecs.hasBuffer("ConnectedNode", b[i].edge) &&
          this.nodes(b[i].edge).some((row) => row.node === t.original)
        )
          continue;
        b.splice(i, 1);
      }
    }
  }
  component(
    type: string,
    id: string,
    original: string,
    updateValue: boolean,
    job: number,
  ) {
    if (this.has(type, id)) {
      if (this.has(type, original)) {
        if (updateValue)
          this.commands.set(original, type, this.get(type, id), job);
      } else
        this.commands.add(
          original,
          type,
          updateValue ? this.get(type, id) : this.default(type),
          job,
        );
    } else if (this.has(type, original))
      this.commands.remove(original, type, job);
  }
  default(type: string) {
    const value = defaults[type];
    if (value === undefined)
      throw new Error("Missing source default component: " + type);
    return value;
  }
  updateBuffer(
    type: string,
    id: string,
    original: string,
    updateValue: boolean,
    job: number,
  ) {
    if (this.ecs.hasBuffer(type, id)) {
      if (this.ecs.hasBuffer(type, original)) {
        if (updateValue)
          this.commands
            .buffer(original, type, true, job)
            .push(...structuredClone(this.ecs.buffer(type, id)));
      } else {
        const b = this.commands.buffer(original, type, false, job);
        if (updateValue) b.push(...structuredClone(this.ecs.buffer(type, id)));
      }
      return;
    }
    if (this.ecs.hasBuffer(type, original)) {
      const old = structuredClone(this.ecs.buffer(type, original));
      this.commands.remove(original, type, job);
      return old;
    }
  }
  road(id: string, original: string, job: number) {
    if (this.has("Road", id)) {
      if (this.has("Road", original)) {
        const value = this.get("Road", original);
        value.flags = this.get("Road", id).flags;
        this.commands.set(original, "Road", value, job);
      } else this.commands.add(original, "Road", this.get("Road", id), job);
    } else if (this.has("Road", original))
      this.commands.remove(original, "Road", job);
  }
  tags(id: string, names: readonly string[], job: number) {
    for (const name of names) this.commands.add(id, name, {}, job);
  }
  cancel(id: string, t: Temp, job: number) {
    if (this.has("Hidden", t.original)) {
      this.commands.add(t.original!, "BatchesUpdated", {}, job);
      this.commands.remove(t.original!, "Hidden", job);
    }
    this.commands.add(id, "Deleted", {}, job);
  }
  delete(id: string, t: Temp, job: number) {
    if (t.original !== null) this.commands.add(t.original, "Deleted", {}, job);
    this.commands.add(id, "Deleted", {}, job);
  }
  create(id: string, t: Temp, job: number) {
    this.commands.remove(id, "Temp", job);
    if (t.cost > 0)
      this.commands.add(
        id,
        "Recent",
        { modificationFrame: this.frame, modificationCost: t.cost },
        job,
      );
    this.tags(id, ["Applied", "Created", "Updated"], job);
  }
  update(id: string, t: Temp, job: number, economy: Economy) {
    const original = t.original!;
    if (this.has("Hidden", original))
      this.commands.remove(original, "Hidden", job);
    if (t.cost !== 0) {
      const recent: Recent = {
          modificationFrame: this.frame,
          modificationCost: t.cost,
        },
        old = this.ecs.tryGet<Recent>("Recent", original);
      if (old) {
        recent.modificationCost =
          (recent.modificationCost + old.modificationCost) | 0;
        recent.modificationCost =
          (recent.modificationCost +
            cs2RoadRefundAmount(old, this.frame, economy)) |
          0;
        old.modificationFrame = this.frame;
        recent.modificationCost =
          (recent.modificationCost -
            cs2RoadRefundAmount(old, this.frame, economy)) |
          0;
        recent.modificationCost = Math.min(recent.modificationCost, t.value);
        if (recent.modificationCost > 0)
          this.commands.set(original, "Recent", recent, job);
        else this.commands.remove(original, "Recent", job);
      } else if (recent.modificationCost > 0)
        this.commands.add(original, "Recent", recent, job);
    }
    const upgrade = this.ecs.tryGet("Upgraded", id),
      oldUpgrade = this.ecs.tryGet("Upgraded", original);
    if (
      upgrade &&
      (upgrade.flags.left | upgrade.flags.right) & 0x20000000 &&
      (!oldUpgrade ||
        !(oldUpgrade.flags.left & 0x20000000) ||
        !(oldUpgrade.flags.right & 0x20000000))
    )
      this.triggers.push({
        triggerType: 91,
        triggerPrefab: null,
        primaryTarget: null,
        secondaryTarget: null,
        value: 0,
      });
    this.tags(original, ["Applied", "Updated"], job);
    this.commands.add(id, "Deleted", {}, job);
  }
  enabled(id: string) {
    return this.ecs.isEnabled(
      "PrefabData",
      this.get<{ prefab: Entity }>("PrefabRef", id).prefab,
    );
  }
  handle(chunk: CS2RoadApplyChunk, job: number, economy: Economy) {
    for (const id of chunk.entities) {
      const t = this.get<Temp>("Temp", id),
        original = t.original;
      if (chunk.components.has("Node")) {
        if (t.flags & 2) this.delete(id, t, job);
        else if (t.flags & 256) {
          if (original !== null)
            this.commands.add(original, "Deleted", {}, job);
          this.create(id, t, job);
        } else if (original !== null) {
          this.commands.set(original, "Node", this.get("Node", id), job);
          for (const [type, value] of [
            ["Owner", true],
            ["PrefabRef", true],
            ["Upgraded", true],
            ["LocalConnect", false],
            ["TrafficLights", false],
            ["Orphan", false],
            ["EditorContainer", true],
            ["Native", false],
            ["Standalone", false],
          ] as const)
            this.component(type, id, original, value, job);
          if (this.enabled(id)) {
            for (const type of [
              "LandValue",
              "TramTrack",
              "TrainTrack",
              "Waterway",
            ])
              this.component(type, id, original, false, job);
            this.road(id, original, job);
            this.component("Pollution", id, original, false, job);
            this.component("Marker", id, original, false, job);
          }
          this.update(id, t, job, economy);
        } else this.create(id, t, job);
      } else if (chunk.components.has("Edge")) {
        const aggregate = this.ecs.tryGet<{ aggregate: Entity }>(
          "Aggregated",
          id,
        );
        if (aggregate && this.has("Temp", aggregate.aggregate))
          this.commands.set(id, "Aggregated", { aggregate: null }, job);
        if (t.flags & 2) this.delete(id, t, job);
        else if (t.flags & (256 | 4096)) {
          if (original === null)
            throw new Error("Source Replace/Combine edge requires original");
          this.commands.add(original, "Deleted", {}, job);
          this.create(id, t, job);
        } else if (original !== null) {
          for (const type of ["Owner", "PrefabRef", "Elevation", "Upgraded"])
            this.component(type, id, original, true, job);
          this.updateBuffer("SubReplacement", id, original, true, job);
          for (const type of ["Curve", "Edge", "EditorContainer"])
            this.component(type, id, original, true, job);
          this.component("Native", id, original, false, job);
          if (this.enabled(id)) {
            this.road(id, original, job);
            for (const type of ["Pollution", "TramTrack", "LandValue"])
              this.component(type, id, original, false, job);
          }
          this.update(id, t, job, economy);
        } else this.create(id, t, job);
      } else if (chunk.components.has("Lane")) {
        if (t.flags & 32768) {
          this.cancel(id, t, job);
          continue;
        }
        if (t.flags & 2) {
          this.delete(id, t, job);
          continue;
        }
        if (t.flags & 256) {
          if (original === null)
            throw new Error("Source Replace lane requires original");
          this.commands.add(original, "Deleted", {}, job);
          this.create(id, t, job);
          continue;
        }
        const owner = this.ecs.tryGet<{ owner: Entity }>("Owner", id),
          ownerTemp = owner
            ? this.ecs.tryGet<Temp>("Temp", owner.owner)
            : undefined;
        if (original !== null) {
          if (
            ownerTemp &&
            ownerTemp.original !== null &&
            !!(ownerTemp.flags & (256 | 4096))
          ) {
            this.commands.add(original, "Deleted", {}, job);
            this.create(id, t, job);
          } else this.update(id, t, job, economy);
          continue;
        }
        if (
          ownerTemp &&
          ownerTemp.original !== null &&
          !(ownerTemp.flags & (256 | 4096))
        ) {
          this.tags(
            id,
            ownerTemp.flags & 512 ? ["Applied", "Deleted"] : ["Deleted"],
            job,
          );
          continue;
        }
        this.create(id, t, job);
      } else {
        if (!(t.flags & 2) && original !== null && this.has("Hidden", original))
          this.commands.remove(original, "Hidden", job);
        this.commands.add(id, "Deleted", {}, job);
      }
    }
  }
  run() {
    const chunks = this.ecs.chunks({
      all: ["Temp"],
      any: ["Node", "Edge", "Lane", "Aggregate"],
    });
    const economies = this.ecs
      .chunks({ all: ["EconomyParameterData"] })
      .flatMap((c) => c.entities);
    if (chunks.length && economies.length !== 1)
      throw new Error("Missing unique source EconomyParameterData");
    const economy = economies.length
      ? this.get<Economy>("EconomyParameterData", economies[0])
      : {
          roadRefundTimeRange: { x: 0, y: 0, z: 0 },
          roadRefundPercentage: { x: 0, y: 0, z: 0 },
        };
    this.patch(chunks);
    chunks.forEach((chunk, i) => {
      this.fix(chunk);
      this.handle(chunk, i, economy);
    });
    this.ecs.publish(this.commands.commands);
    return {
      status: "complete" as const,
      world: this.ecs.snapshot(),
      commands: this.commands.commands,
      barrier: "ToolOutputBarrier" as const,
      triggers: this.triggers,
    };
  }
}
/** Apply the complete original preview transaction to permanent network entities. */
export function cs2ApplyRoadNetwork(
  world: CS2RoadApplyWorld,
  options: { simulationFrame?: number } = {},
) {
  return new RoadApplication(world, (options.simulationFrame ?? 0) >>> 0).run();
}
