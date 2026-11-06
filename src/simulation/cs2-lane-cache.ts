/** Original CurrentLaneCache and LaneObject command application; see CS2_LANE_CACHE.md. */
import type { V } from "../core/types";
import type { CS2MotionQuaternion } from "./cs2-motion";
import type {
  CS2LaneSpeedGeometry,
  CS2LaneSpeedLaneObject,
} from "./cs2-lane-speed";
import { CS2_NAV_TARGET_FLAGS } from "./cs2-navigation-target";

export type CS2LaneCacheCurrent = {
  laneId: string | null;
  changeLaneId?: string | null;
  curvePosition: V;
  flags: number;
};
export type CS2BlockedLane = {
  lane: string;
  curvePosition: readonly [number, number];
};
export type CS2LaneCacheBounds = { min: V; max: V };
export type CS2LaneCacheBody = {
  position: V;
  rotation: CS2MotionQuaternion;
  velocity: V;
  targetPosition: V;
  maxSpeed: number;
  geometry: CS2LaneSpeedGeometry & { flags?: number };
};
export type CS2LaneCacheWorld = {
  entities: ReadonlySet<string>;
  laneObjects: ReadonlyMap<string, readonly CS2LaneSpeedLaneObject[]>;
  searchTree: ReadonlyMap<string, CS2LaneCacheBounds>;
};
export type CS2LaneCacheCommand =
  | {
      kind: "lane-add" | "lane-update";
      lane: string;
      object: string;
      curvePosition: readonly [number, number];
    }
  | { kind: "lane-remove"; lane: string; object: string }
  | {
      kind: "tree-add" | "tree-update";
      object: string;
      bounds: CS2LaneCacheBounds;
    }
  | { kind: "tree-remove"; object: string };

const f = Math.fround;
const plus = (a: number, b: number) => f(f(a) + f(b));
const minus = (a: number, b: number) => f(f(a) - f(b));
const times = (a: number, b: number) => f(f(a) * f(b));
const vector = (v: V): V => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
const add = (a: V, b: V): V => ({
  x: plus(a.x, b.x),
  y: plus(a.y, b.y),
  z: plus(a.z, b.z),
});
const sub = (a: V, b: V): V => ({
  x: minus(a.x, b.x),
  y: minus(a.y, b.y),
  z: minus(a.z, b.z),
});
const scale = (a: V, n: number): V => ({
  x: times(a.x, n),
  y: times(a.y, n),
  z: times(a.z, n),
});
const min = (a: V, b: V): V => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  z: Math.min(a.z, b.z),
});
const max = (a: V, b: V): V => ({
  x: Math.max(a.x, b.x),
  y: Math.max(a.y, b.y),
  z: Math.max(a.z, b.z),
});
const squared = (a: V) =>
  plus(plus(times(a.x, a.x), times(a.y, a.y)), times(a.z, a.z));
const length = (a: V) => f(Math.sqrt(squared(a)));
const normal = (a: V): V => {
  const n = squared(a);
  return n > f(1.1754944e-38)
    ? scale(a, f(1 / f(Math.sqrt(n))))
    : { x: 0, y: 0, z: 0 };
};
const zero = { x: 0, y: 0, z: 0 };
const pair = (p: readonly [number, number]): [number, number] => [
  f(p[0]),
  f(p[1]),
];
const currentPair = (current: CS2LaneCacheCurrent): [number, number] => [
  f(current.curvePosition.x),
  f(current.curvePosition.y),
];
const equal = (a: readonly [number, number], b: readonly [number, number]) =>
  f(a[0]) === f(b[0]) && f(a[1]) === f(b[1]);
const cross = (a: V, b: V): V => ({
  x: minus(times(a.y, b.z), times(a.z, b.y)),
  y: minus(times(a.z, b.x), times(a.x, b.z)),
  z: minus(times(a.x, b.y), times(a.y, b.x)),
});
const rotate = (q: CS2MotionQuaternion, v: V) => {
  const t = scale(cross(q, v), 2);
  return add(add(v, scale(t, q.w)), cross(q, t));
};

/** Original ObjectUtils.CalculateBounds, including its circular geometry branch. */
export function cs2LaneCacheObjectBounds(
  body: CS2LaneCacheBody,
): CS2LaneCacheBounds {
  const { position: p, geometry: g, rotation: q } = body;
  if ((g.flags ?? 0) & 1) {
    const radius = times(g.size.x, 0.5);
    return {
      min: add(p, { x: -radius, y: f(g.min.y), z: -radius }),
      max: add(p, { x: radius, y: f(g.max.y), z: radius }),
    };
  }
  const x = rotate(q, { x: 1, y: 0, z: 0 }),
    y = rotate(q, { x: 0, y: 1, z: 0 }),
    z = rotate(q, { x: 0, y: 0, z: 1 });
  return {
    min: add(
      add(
        add(p, min(scale(x, g.min.x), scale(x, g.max.x))),
        min(scale(y, g.min.y), scale(y, g.max.y)),
      ),
      min(scale(z, g.min.z), scale(z, g.max.z)),
    ),
    max: add(
      add(
        add(p, max(scale(x, g.min.x), scale(x, g.max.x))),
        max(scale(y, g.min.y), scale(y, g.max.y)),
      ),
      max(scale(z, g.min.z), scale(z, g.max.z)),
    ),
  };
}
export function cs2LaneCacheMinBounds(
  body: CS2LaneCacheBody,
): CS2LaneCacheBounds {
  const dt = f(4 / 15),
    x = scale(body.velocity, dt),
    y = scale(
      normal(sub(body.targetPosition, body.position)),
      Math.abs(times(body.maxSpeed, dt)),
    ),
    bounds = cs2LaneCacheObjectBounds(body);
  return {
    min: add(bounds.min, min(zero, min(x, y))),
    max: add(bounds.max, max(zero, max(x, y))),
  };
}
export function cs2LaneCacheMaxBounds(
  body: CS2LaneCacheBody,
): CS2LaneCacheBounds {
  const radius = times(length(body.geometry.size), 0.5),
    x = scale(body.velocity, f(-1.0666667)),
    x2 = scale(body.velocity, 2),
    y = scale(
      normal(sub(body.targetPosition, body.position)),
      Math.abs(times(body.maxSpeed, 2)),
    ),
    p = vector(body.position),
    r = { x: radius, y: radius, z: radius };
  p.y = plus(p.y, times(body.geometry.size.y, 0.5));
  return {
    min: add(sub(p, r), min(x, min(x2, y))),
    max: add(add(p, r), max(x, max(x2, y))),
  };
}

/** Capture BEFORE UpdateNavigationLanes/Target/Reserve; apply once afterwards. */
export class CS2CurrentLaneCache {
  private wasCurrent: string | null;
  private wasChange: string | null;
  private wasPosition: readonly [number, number];
  constructor(
    readonly world: CS2LaneCacheWorld,
    current: CS2LaneCacheCurrent,
    readonly blocked: CS2BlockedLane[],
  ) {
    if (!current.laneId || !world.entities.has(current.laneId))
      current.laneId = null;
    if (current.changeLaneId && !world.entities.has(current.changeLaneId)) {
      current.changeLaneId = null;
      current.flags =
        (current.flags &
          ~(CS2_NAV_TARGET_FLAGS.TurnLeft | CS2_NAV_TARGET_FLAGS.TurnRight)) >>>
        0;
    }
    this.wasCurrent = current.laneId;
    this.wasChange = current.changeLaneId ?? null;
    this.wasPosition = currentPair(current);
  }
  checkChanges(
    entity: string,
    current: CS2LaneCacheCurrent,
    body: CS2LaneCacheBody,
    newBlockedLanes?: CS2BlockedLane[],
  ): CS2LaneCacheCommand[] {
    const commands: CS2LaneCacheCommand[] = [],
      buffer = (id: string | null | undefined): id is string =>
        !!id && this.world.laneObjects.has(id),
      p = currentPair(current),
      laneAdd = (lane: string, position: readonly [number, number]) =>
        commands.push({
          kind: "lane-add",
          lane,
          object: entity,
          curvePosition: pair(position),
        }),
      laneUpdate = (lane: string, position: readonly [number, number]) =>
        commands.push({
          kind: "lane-update",
          lane,
          object: entity,
          curvePosition: pair(position),
        }),
      laneRemove = (lane: string) =>
        commands.push({ kind: "lane-remove", lane, object: entity }),
      treeAdd = () =>
        commands.push({
          kind: "tree-add",
          object: entity,
          bounds: cs2LaneCacheMaxBounds(body),
        }),
      treeRemove = () => commands.push({ kind: "tree-remove", object: entity }),
      treeRefresh = () => {
        const old = this.world.searchTree.get(entity);
        if (!old) return;
        const next = cs2LaneCacheMinBounds(body);
        if (
          next.min.x < old.min.x ||
          next.min.y < old.min.y ||
          next.min.z < old.min.z ||
          next.max.x > old.max.x ||
          next.max.y > old.max.y ||
          next.max.z > old.max.z
        )
          commands.push({
            kind: "tree-update",
            object: entity,
            bounds: cs2LaneCacheMaxBounds(body),
          });
      };
    if (newBlockedLanes?.length) {
      if (buffer(this.wasCurrent)) {
        this.blocked.push({
          lane: this.wasCurrent,
          curvePosition: pair(this.wasPosition),
        });
        treeAdd();
      } else treeRefresh();
      if (buffer(this.wasChange))
        this.blocked.push({
          lane: this.wasChange,
          curvePosition: pair(this.wasPosition),
        });
      let index = 0;
      while (index < this.blocked.length) {
        const before = this.blocked[index],
          match = newBlockedLanes.findIndex(
            (next) => next.lane === before.lane,
          );
        if (match >= 0) {
          const next = newBlockedLanes[match];
          if (!equal(next.curvePosition, before.curvePosition)) {
            this.blocked[index] = {
              lane: next.lane,
              curvePosition: pair(next.curvePosition),
            };
            laneUpdate(next.lane, next.curvePosition);
          }
          newBlockedLanes[match] = newBlockedLanes[newBlockedLanes.length - 1];
          newBlockedLanes.pop();
          index++;
        } else {
          this.blocked.splice(index, 1);
          laneRemove(before.lane);
        }
      }
      for (const next of newBlockedLanes) {
        this.blocked.push({
          lane: next.lane,
          curvePosition: pair(next.curvePosition),
        });
        laneAdd(next.lane, next.curvePosition);
      }
      return commands;
    }
    if (this.blocked.length) {
      for (const item of this.blocked)
        if (buffer(item.lane)) laneRemove(item.lane);
      this.blocked.length = 0;
      this.wasCurrent = null;
      this.wasChange = null;
    }
    if (current.laneId === this.wasChange) {
      if (buffer(this.wasCurrent)) {
        laneRemove(this.wasCurrent);
        if (buffer(current.laneId)) {
          if (!equal(this.wasPosition, p)) laneUpdate(current.laneId, p);
        } else treeAdd();
      } else if (buffer(current.laneId)) {
        treeRemove();
        if (!equal(this.wasPosition, p)) laneUpdate(current.laneId, p);
      } else treeRefresh();
      if (buffer(current.changeLaneId)) laneAdd(current.changeLaneId, p);
      return commands;
    }
    if (current.laneId !== this.wasCurrent) {
      if (buffer(this.wasCurrent)) laneRemove(this.wasCurrent);
      else treeRemove();
      if (buffer(current.laneId)) laneAdd(current.laneId, p);
      else treeAdd();
    } else if (buffer(this.wasCurrent)) {
      if (!equal(this.wasPosition, p)) laneUpdate(this.wasCurrent, p);
    } else treeRefresh();
    if ((current.changeLaneId ?? null) !== this.wasChange) {
      if (buffer(this.wasChange)) laneRemove(this.wasChange);
      if (buffer(current.changeLaneId)) laneAdd(current.changeLaneId, p);
    } else if (buffer(this.wasChange) && !equal(this.wasPosition, p))
      laneUpdate(this.wasChange, p);
    return commands;
  }
}

/** NetUtils.AddLaneObject: insert BEFORE an equal reservation-y, not a stable sort. */
export function cs2AddLaneObject(
  buffer: CS2LaneSpeedLaneObject[],
  object: string,
  curvePosition: readonly [number, number],
) {
  const value = { object, curvePosition: pair(curvePosition) };
  const index = buffer.findIndex(
    (entry) => f(entry.curvePosition[1]) >= value.curvePosition[1],
  );
  if (index < 0) buffer.push(value);
  else buffer.splice(index, 0, value);
}
/** NetUtils.UpdateLaneObject: preserve its exact relocation and missing-object behavior. */
export function cs2UpdateLaneObject(
  buffer: CS2LaneSpeedLaneObject[],
  object: string,
  curvePosition: readonly [number, number],
) {
  let replacement: CS2LaneSpeedLaneObject = {
    object,
    curvePosition: pair(curvePosition),
  };
  for (let i = 0; i < buffer.length; i++) {
    let entry = buffer[i];
    if (entry.object === object) {
      for (let j = i + 1; j < buffer.length; j++) {
        entry = buffer[j];
        if (f(entry.curvePosition[1]) >= replacement.curvePosition[1]) {
          buffer[j - 1] = replacement;
          return;
        }
        buffer[j - 1] = entry;
      }
      buffer[buffer.length - 1] = replacement;
      return;
    }
    if (f(entry.curvePosition[1]) < replacement.curvePosition[1]) continue;
    buffer[i] = replacement;
    replacement = entry;
    for (let k = i + 1; k < buffer.length; k++) {
      entry = buffer[k];
      buffer[k] = replacement;
      replacement = entry;
      if (replacement.object === object) return;
    }
    break;
  }
  buffer.push(replacement);
}
export function cs2RemoveLaneObject(
  buffer: CS2LaneSpeedLaneObject[],
  object: string,
) {
  const index = buffer.findIndex((entry) => entry.object === object);
  if (index >= 0) buffer.splice(index, 1);
}
/** Apply AFTER all decision jobs in the update batch, preserving command order. */
export function applyCS2LaneCacheCommands(
  commands: readonly CS2LaneCacheCommand[],
  laneObjects: Map<string, CS2LaneSpeedLaneObject[]>,
  searchTree: Map<string, CS2LaneCacheBounds>,
) {
  const warnings: string[] = [];
  for (const command of commands) {
    if (command.kind === "tree-add") {
      if (searchTree.has(command.object))
        warnings.push(`Entity already added to search tree: ${command.object}`);
      else searchTree.set(command.object, command.bounds);
    } else if (command.kind === "tree-update") {
      if (!searchTree.has(command.object))
        throw new Error("Item not found (NativeQuadTree.Update)!");
      searchTree.set(command.object, command.bounds);
    } else if (command.kind === "tree-remove")
      searchTree.delete(command.object);
    else if ("lane" in command) {
      const buffer = laneObjects.get(command.lane);
      if (!buffer) continue;
      if (command.kind === "lane-add")
        cs2AddLaneObject(buffer, command.object, command.curvePosition);
      else if (command.kind === "lane-update")
        cs2UpdateLaneObject(buffer, command.object, command.curvePosition);
      else cs2RemoveLaneObject(buffer, command.object);
    }
  }
  return warnings;
}
