/** Full source NetToolSystem course definitions; native asset dependencies remain explicit. */
import type { V } from "./types";
import {
  cs2FitRoadCurve,
  cs2FitRoadCurveFromLines,
  cs2LinearizeRoadElevation,
  cs2RoadCurveLength,
  cs2RoadCurvePosition,
  cs2RoadCurveTangent,
  cs2StraightRoadCurve,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
import { cs2LookRotationSafe } from "../simulation/cs2-motion";
import {
  SourceRandom32,
  deriveCs2WorkerSeed,
} from "../simulation/cs2-path-search";

type Q = { x: number; y: number; z: number; w: number };
type V2 = { x: number; y: number };
export type CS2RoadCourseControlPoint = {
  position: V;
  hitPosition: V;
  direction: V2;
  hitDirection: V;
  rotation: Q;
  originalEntity: string | null;
  snapPriority: V2;
  elementIndex: V2;
  curvePosition: number;
  elevation: number;
};
/** RoadLab raycast adapter; ordinary canvas hits have no asset mesh or original entity. */
export function cs2RoadCourseControlPoint(
  position: V,
  overrides: Partial<CS2RoadCourseControlPoint> = {},
): CS2RoadCourseControlPoint {
  return {
    position: { ...position },
    hitPosition: { ...position },
    direction: { x: 0, y: 0 },
    hitDirection: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    originalEntity: null,
    snapPriority: { x: 0, y: 0 },
    elementIndex: { x: -1, y: -1 },
    curvePosition: 0,
    elevation: 0,
    ...overrides,
  };
}
export type CS2RoadCoursePos = {
  entity: string | null;
  position: V;
  rotation: Q;
  elevation: [number, number];
  courseDelta: number;
  splitPosition: number;
  flags: number;
  parentMesh: number;
};
export type CS2RoadCourse = {
  start: CS2RoadCoursePos;
  end: CS2RoadCoursePos;
  curve: CS2RoadCurve;
  elevation: [number, number];
  length: number;
  fixedIndex: number;
};
export type CS2RoadCourseOwner = {
  prefab: string | null;
  position: V;
  rotation: Q;
};
export type CS2RoadCreationDefinition = {
  prefab: string | null;
  subPrefab: string | null;
  original: string | null;
  owner: string | null;
  attached: string | null;
  flags: number;
  randomSeed: number;
};
export type CS2RoadCourseCommand =
  | { kind: "create-entity"; entity: string }
  | {
      kind: "add-component";
      entity: string;
      component: string;
      value: Record<string, unknown>;
    };
export type CS2RoadCourseWorld = {
  geometryNets: ReadonlyMap<
    string,
    { defaultWidth: number; maxSlopeSteepness: number; flags: number }
  >;
  placeableNets: ReadonlyMap<
    string,
    { elevationRange: readonly [number, number]; placementFlags: number }
  >;
  edges: ReadonlyMap<string, { start: string | null; end: string | null }>;
  nodes: ReadonlySet<string>;
  owners: ReadonlyMap<string, string | null>;
  buildings: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
  temporary: ReadonlyMap<string, { original: string | null }>;
  localTransforms: ReadonlyMap<string, { parentMesh: number }>;
  transforms: ReadonlyMap<string, { position: V; rotation: Q }>;
  curves: ReadonlyMap<string, CS2RoadCurve>;
  prefabRefs: ReadonlyMap<string, string | null>;
  attachments: ReadonlyMap<string, string | null>;
  installedUpgrades: ReadonlyMap<string, readonly (string | null)[]>;
  subNets: ReadonlySet<string>;
  prefabSubObjects: ReadonlyMap<
    string,
    readonly {
      prefab: string | null;
      position: V;
      rotation: Q;
      flags: number;
    }[]
  >;
};
export function createCS2RoadCourseWorld(
  input: Partial<CS2RoadCourseWorld> = {},
): CS2RoadCourseWorld {
  return {
    geometryNets: new Map(),
    placeableNets: new Map(),
    edges: new Map(),
    nodes: new Set(),
    owners: new Map(),
    buildings: new Set(),
    extensions: new Set(),
    temporary: new Map(),
    localTransforms: new Map(),
    transforms: new Map(),
    curves: new Map(),
    prefabRefs: new Map(),
    attachments: new Map(),
    installedUpgrades: new Map(),
    subNets: new Set(),
    prefabSubObjects: new Map(),
    ...input,
  };
}
export type CS2RoadCoursesInput = {
  mode: "straight" | "simple" | "complex" | "continuous";
  controlPoints: readonly CS2RoadCourseControlPoint[];
  prefab: string;
  lanePrefab?: string | null;
  batchSeed: number;
  middleIndex?: number;
  straightIndices?: readonly [number, number];
  editorMode?: boolean;
  parallelCount?: readonly [number, number];
  parallelOffset?: number;
  serviceUpgradeOwner?: string | null;
  ownerDefinitions?: ReadonlyMap<string | null, CS2RoadCourseOwner>;
};
export type CS2RoadCourseNativeRequest = {
  kind:
    | "water-inverse-weight"
    | "update-owner-object"
    | "create-course-object"
    | "parallel-courses";
  input: Record<string, unknown>;
};
export type CS2RoadCourseNativeReply = {
  commands?: readonly CS2RoadCourseCommand[];
  weight?: number;
  selectedSpawnables?: readonly { entity: string | null; index: number }[];
  nodeMap?: readonly {
    key: readonly [number, number, number, number];
    position: V;
  }[];
};
export type CS2RoadCoursesCallbacks = Partial<
  Record<
    CS2RoadCourseNativeRequest["kind"],
    (
      request: CS2RoadCourseNativeRequest,
    ) => CS2RoadCourseNativeReply | undefined
  >
>;
export type CS2RoadCoursesOutput = {
  courses: CS2RoadCourse[];
  commands: CS2RoadCourseCommand[];
  randomState: number | null;
  ownerDefinitions: { entity: string | null; definition: CS2RoadCourseOwner }[];
  ownerDefinitionsCreated: boolean;
};
export type CS2RoadCoursesAdvance =
  | ({ status: "complete" } & CS2RoadCoursesOutput)
  | {
      status: "pending";
      request: CS2RoadCourseNativeRequest;
      transaction: CS2RoadCoursesTransaction;
    };
export const CS2_ROAD_COURSE_FLAGS = {
  isFirst: 1,
  isLast: 2,
  isRight: 0x10,
  isLeft: 0x20,
  freeHeight: 0x80,
} as const;
const F = CS2_ROAD_COURSE_FLAGS,
  f = Math.fround;
const plus = (a: number, b: number) => f(f(a) + f(b));
const minus = (a: number, b: number) => f(f(a) - f(b));
const times = (a: number, b: number) => f(f(a) * f(b));
const divide = (a: number, b: number) => f(f(a) / f(b));
const vec = (a: V): V => ({ x: f(a.x), y: f(a.y), z: f(a.z) });
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
const mul = (a: V, b: number): V => ({
  x: times(a.x, b),
  y: times(a.y, b),
  z: times(a.z, b),
});
const lerp = (a: V, b: V, t: number) => add(a, mul(sub(b, a), t));
const dotXZ = (a: V, b: V) => plus(times(a.x, b.x), times(a.z, b.z));
const lenXZ = (a: V) => f(Math.sqrt(dotXZ(a, a)));
const sameV = (a: V, b: V) => a.x === b.x && a.y === b.y && a.z === b.z;
const emptyOwner = (): CS2RoadCourseOwner => ({
  prefab: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 0 },
});
const copyPoint = (
  p: CS2RoadCourseControlPoint,
): CS2RoadCourseControlPoint => ({
  ...structuredClone(p),
  position: vec(p.position),
  elevation: f(p.elevation),
  curvePosition: f(p.curvePosition),
  direction: { x: f(p.direction.x), y: f(p.direction.y) },
});
const quatMul = (a: Q, b: Q): Q => ({
  x: plus(
    plus(times(a.w, b.x), times(a.x, b.w)),
    minus(times(a.y, b.z), times(a.z, b.y)),
  ),
  y: plus(
    plus(times(a.w, b.y), times(a.y, b.w)),
    minus(times(a.z, b.x), times(a.x, b.z)),
  ),
  z: plus(
    plus(times(a.w, b.z), times(a.z, b.w)),
    minus(times(a.x, b.y), times(a.y, b.x)),
  ),
  w: minus(
    minus(minus(times(a.w, b.w), times(a.x, b.x)), times(a.y, b.y)),
    times(a.z, b.z),
  ),
});
const rotate = (q: Q, v: V) => {
  const cross = (a: V, b: V): V => ({
    x: minus(times(a.y, b.z), times(a.z, b.y)),
    y: minus(times(a.z, b.x), times(a.x, b.z)),
    z: minus(times(a.x, b.y), times(a.y, b.x)),
  });
  const t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q.w)), cross(q, t));
};
const inverseTransform = (position: V, rotation: Q, world: V) => {
  const square = plus(
      plus(times(rotation.x, rotation.x), times(rotation.y, rotation.y)),
      plus(times(rotation.z, rotation.z), times(rotation.w, rotation.w)),
    ),
    inverse = f(1 / square);
  return rotate(
    {
      x: times(-rotation.x, inverse),
      y: times(-rotation.y, inverse),
      z: times(-rotation.z, inverse),
      w: times(rotation.w, inverse),
    },
    sub(world, position),
  );
};
function nodeRotation(tangent: V): Q {
  const horizontal = { x: f(tangent.x), y: 0, z: f(tangent.z) },
    square = dotXZ(horizontal, horizontal);
  if (!(square > f(1.1754944e-38))) return { x: 0, y: 0, z: 0, w: 1 };
  return cs2LookRotationSafe(mul(horizontal, f(1 / f(Math.sqrt(square)))), {
    x: 0,
    y: 1,
    z: 0,
  });
}
function distanceLineXZ(a: V, b: V, p: V) {
  const line = sub(b, a),
    offset = sub(p, a),
    square = dotXZ(line, line),
    t =
      square !== 0
        ? Math.max(0, Math.min(1, divide(dotXZ(line, offset), square)))
        : 0;
  return { t, distance: lenXZ(sub(mul(line, t), offset)) };
}
export function cs2GetRoadCoursePos(
  world: CS2RoadCourseWorld,
  curve: CS2RoadCurve,
  point: CS2RoadCourseControlPoint,
  courseDelta: number,
): CS2RoadCoursePos {
  const p = copyPoint(point),
    edge =
      p.originalEntity === null ? undefined : world.edges.get(p.originalEntity);
  let entity: string | null = null,
    splitPosition = 0;
  if (p.originalEntity !== null) {
    if (edge) {
      entity =
        p.curvePosition <= 0
          ? edge.start
          : p.curvePosition >= 1
            ? edge.end
            : p.originalEntity;
      splitPosition =
        p.curvePosition <= 0 ? 0 : p.curvePosition >= 1 ? 1 : p.curvePosition;
    } else if (world.nodes.has(p.originalEntity)) {
      entity = p.originalEntity;
      splitPosition = p.curvePosition;
    }
  }
  let parentMesh = p.elementIndex.x,
    owner = p.originalEntity;
  while (
    owner !== null &&
    world.owners.has(owner) &&
    !world.buildings.has(owner) &&
    !world.extensions.has(owner)
  ) {
    const local = world.localTransforms.get(owner),
      ownerEdge = world.edges.get(owner);
    if (local) parentMesh = local.parentMesh;
    else if (ownerEdge) {
      const a =
          ownerEdge.start === null
            ? undefined
            : world.localTransforms.get(ownerEdge.start),
        b =
          ownerEdge.end === null
            ? undefined
            : world.localTransforms.get(ownerEdge.end);
      if (a && b)
        parentMesh = a.parentMesh === b.parentMesh ? a.parentMesh : -1;
    }
    owner = world.owners.get(owner) ?? null;
  }
  return {
    entity,
    position: vec(p.position),
    rotation: nodeRotation(cs2RoadCurveTangent(curve, courseDelta)),
    elevation: [p.elevation, p.elevation],
    courseDelta: f(courseDelta),
    splitPosition: f(splitPosition),
    flags: 0,
    parentMesh,
  };
}
/** NetToolSystem.GetCutPosition: 8m grid snap with source even rounding. */
export function cs2GetRoadCutPosition(
  geometryFlags: number,
  length: number,
  t: number,
) {
  if (!(geometryFlags & 4)) return f(t);
  const n = divide(plus(times(length, t), 0.16), 8),
    floor = Math.floor(n),
    part = n - floor,
    round =
      part < 0.5
        ? floor
        : part > 0.5
          ? floor + 1
          : floor % 2 === 0
            ? floor
            : floor + 1;
  const ratio = divide(times(round, 8), length);
  // Unity math.min/max select the other operand for NaN. In particular,
  // saturate(0 / 0) is 1; JS Math.min would propagate NaN here.
  const upper = ratio < 1 ? ratio : 1;
  return upper > 0 ? upper : 0;
}
/** Source MathUtils.Divide. */
function divideCurve(
  curve: CS2RoadCurve,
  t: number,
): [CS2RoadCurve, CS2RoadCurve] {
  const middle = lerp(curve[1], curve[2], t),
    b = lerp(curve[0], curve[1], t),
    c = lerp(curve[2], curve[3], t),
    p = lerp(b, middle, t),
    q = lerp(middle, c, t),
    end = lerp(p, q, t);
  return [
    [vec(curve[0]), b, p, end],
    [{ ...end }, q, c, vec(curve[3])],
  ];
}
export { divideCurve as cs2DivideRoadCourseCurve };
/** Source MathUtils.Cut polynomial, including reversed/partial ranges. */
export function cs2CutRoadCourseCurve(
  curve: CS2RoadCurve,
  range: readonly [number, number],
): CS2RoadCurve {
  const [a, b] = range.map(f),
    s = [a, a, a, b],
    t = [a, a, b, b],
    u = [a, b, b, b],
    inv = (n: number) => minus(1, n);
  return [0, 1, 2, 3].map((i) => {
    const w0 = times(times(inv(s[i]), inv(t[i])), inv(u[i])),
      w1 = plus(
        plus(
          times(times(s[i], inv(t[i])), inv(u[i])),
          times(times(inv(s[i]), t[i]), inv(u[i])),
        ),
        times(times(inv(s[i]), inv(t[i])), u[i]),
      ),
      w2 = plus(
        plus(
          times(times(s[i], t[i]), inv(u[i])),
          times(times(inv(s[i]), t[i]), u[i]),
        ),
        times(times(s[i], inv(t[i])), u[i]),
      ),
      w3 = times(times(s[i], t[i]), u[i]);
    return add(
      add(add(mul(curve[0], w0), mul(curve[1], w1)), mul(curve[2], w2)),
      mul(curve[3], w3),
    );
  }) as unknown as CS2RoadCurve;
}

export class CS2RoadCoursesTransaction {
  private commands: CS2RoadCourseCommand[] = [];
  private courses: CS2RoadCourse[] = [];
  private ownerDefinitions: Map<string | null, CS2RoadCourseOwner>;
  private ownerDefinitionsCreated: boolean;
  private random?: SourceRandom32;
  private nextEntity = 0;
  private steps: Generator<
    CS2RoadCourseNativeRequest,
    void,
    CS2RoadCourseNativeReply
  >;
  private waiting = false;
  private done = false;
  constructor(
    readonly world: CS2RoadCourseWorld,
    readonly input: CS2RoadCoursesInput,
  ) {
    this.ownerDefinitions = new Map(
      [...(input.ownerDefinitions ?? [])].map(([entity, definition]) => [
        entity,
        structuredClone(definition),
      ]),
    );
    this.ownerDefinitionsCreated = input.ownerDefinitions !== undefined;
    this.steps = this.execute();
  }
  advance(reply?: CS2RoadCourseNativeReply): CS2RoadCoursesAdvance {
    if (this.done) throw new Error("Course transaction already complete");
    if (this.waiting && reply === undefined)
      throw new Error("Native road dependency needs an explicit reply");
    if (!this.waiting && reply !== undefined)
      throw new Error("No pending native road dependency");
    const step = this.steps.next(reply as CS2RoadCourseNativeReply);
    this.waiting = !step.done;
    if (!step.done)
      return { status: "pending", request: step.value, transaction: this };
    this.done = true;
    return {
      status: "complete",
      courses: this.courses,
      commands: this.commands,
      randomState: this.random?.state ?? null,
      ownerDefinitions: [...this.ownerDefinitions].map(
        ([entity, definition]) => ({ entity, definition }),
      ),
      ownerDefinitionsCreated: this.ownerDefinitionsCreated,
    };
  }
  private *native(
    kind: CS2RoadCourseNativeRequest["kind"],
    input: Record<string, unknown>,
  ): Generator<
    CS2RoadCourseNativeRequest,
    CS2RoadCourseNativeReply,
    CS2RoadCourseNativeReply
  > {
    const reply = yield { kind, input };
    if (reply.commands) this.commands.push(...structuredClone(reply.commands));
    return reply;
  }
  private rng() {
    return (this.random = new SourceRandom32(
      deriveCs2WorkerSeed(this.input.batchSeed, 0),
    ));
  }
  private seed(random: SourceRandom32) {
    return (((random.nextUInt() + 1) >>> 0) ^ 0x80000000) | 0;
  }
  private createEntity() {
    const entity = `created:${this.nextEntity++}`;
    this.commands.push({ kind: "create-entity", entity });
    return entity;
  }
  private component(entity: string, component: string, value: object = {}) {
    this.commands.push({
      kind: "add-component",
      entity,
      component,
      value: structuredClone(value) as Record<string, unknown>,
    });
  }
  private point(index: number) {
    const p = this.input.controlPoints[index];
    if (!p) throw new RangeError(`Missing source control point ${index}`);
    return copyPoint(p);
  }
  private fixElevation(point: CS2RoadCourseControlPoint) {
    const limits = this.world.placeableNets.get(
      this.input.prefab,
    )?.elevationRange;
    if (!limits) return;
    if (point.elevation < f(limits[0])) {
      point.position.y = plus(
        point.position.y,
        minus(limits[0], point.elevation),
      );
      point.elevation = f(limits[0]);
      point.originalEntity = null;
    } else if (point.elevation > f(limits[1])) {
      point.position.y = plus(
        point.position.y,
        minus(limits[1], point.elevation),
      );
      point.elevation = f(limits[1]);
      point.originalEntity = null;
    }
  }
  private flatten(
    a: CS2RoadCourseControlPoint,
    ...others: CS2RoadCourseControlPoint[]
  ) {
    const geometry = this.world.geometryNets.get(this.input.prefab);
    if (geometry && f(geometry.maxSlopeSteepness) === 0)
      for (const p of others) p.position.y = a.position.y;
  }
  private course(
    curve: CS2RoadCurve,
    a: CS2RoadCourseControlPoint,
    b: CS2RoadCourseControlPoint,
    first = true,
    last = true,
  ): CS2RoadCourse {
    const start = cs2GetRoadCoursePos(this.world, curve, a, 0),
      end = cs2GetRoadCoursePos(this.world, curve, b, 1),
      parallel = this.input.parallelCount ?? [0, 0];
    if (first) start.flags |= F.isFirst;
    if (last) end.flags |= F.isLast;
    if (
      first &&
      last &&
      sameV(start.position, end.position) &&
      start.entity === end.entity
    ) {
      start.flags |= F.isLast;
      end.flags |= F.isFirst;
    }
    if (!(parallel[0] > 0)) {
      start.flags |= F.isLeft;
      end.flags |= F.isLeft;
    }
    if (!(parallel[1] > 0)) {
      start.flags |= F.isRight;
      end.flags |= F.isRight;
    }
    return {
      start,
      end,
      curve,
      elevation: [0, 0],
      length: cs2RoadCurveLength(curve),
      fixedIndex: -1,
    };
  }
  private definition(seed: number): CS2RoadCreationDefinition {
    return {
      prefab: this.input.prefab,
      subPrefab: this.input.lanePrefab ?? null,
      original: null,
      owner: null,
      attached: null,
      flags: 0x10000,
      randomSeed: seed,
    };
  }
  private *inverseWeight(course: CS2RoadCourse) {
    const flags =
      this.world.placeableNets.get(this.input.prefab)?.placementFlags ?? 0;
    if (!(flags & (64 | 128))) return 0;
    const reply = yield* this.native("water-inverse-weight", {
      course: structuredClone(course),
      placementFlags: flags,
    });
    if (reply.weight === undefined)
      throw new Error("Water inverse weight needs a number");
    return f(reply.weight);
  }
  private invert(course: CS2RoadCourse) {
    course.curve = [...course.curve].reverse() as unknown as CS2RoadCurve;
    const a = course.start,
      b = course.end,
      previous = structuredClone(a);
    for (const key of [
      "position",
      "rotation",
      "elevation",
      "flags",
      "parentMesh",
    ] as const) {
      Object.assign(a, { [key]: structuredClone(b[key]) });
      Object.assign(b, { [key]: structuredClone(previous[key]) });
    }
    const angle = times(f(Math.PI), 0.5),
      q = { x: 0, y: f(Math.sin(angle)), z: 0, w: f(Math.cos(angle)) };
    for (const p of [a, b]) {
      p.rotation = quatMul(q, p.rotation);
      if ((p.flags & (F.isLeft | F.isRight)) === F.isLeft)
        p.flags = (p.flags & ~F.isLeft) | F.isRight;
      else if ((p.flags & (F.isLeft | F.isRight)) === F.isRight)
        p.flags = (p.flags & ~F.isRight) | F.isLeft;
    }
  }
  private *owner(
    start: CS2RoadCoursePos,
    end: CS2RoadCoursePos,
  ): Generator<
    CS2RoadCourseNativeRequest,
    CS2RoadCourseOwner,
    CS2RoadCourseNativeReply
  > {
    let entity: string | null = null,
      definition = emptyOwner();
    if (this.input.editorMode) {
      for (const control of this.input.controlPoints) {
        let candidate = control.originalEntity;
        if (candidate !== null && this.world.nodes.has(candidate))
          candidate = null;
        while (
          candidate !== null &&
          this.world.owners.has(candidate) &&
          !this.world.buildings.has(candidate)
        ) {
          candidate = this.world.owners.get(candidate) ?? null;
          const temp =
            candidate === null
              ? undefined
              : this.world.temporary.get(candidate);
          if (temp?.original !== null && temp?.original !== undefined)
            candidate = temp.original;
        }
        const upgrades =
          candidate === null
            ? undefined
            : this.world.installedUpgrades.get(candidate);
        if (upgrades?.length) candidate = upgrades[0];
        if (
          candidate !== null &&
          this.world.transforms.has(candidate) &&
          this.world.subNets.has(candidate)
        ) {
          entity = candidate;
          break;
        }
      }
    } else entity = this.input.serviceUpgradeOwner ?? null;
    const cached = this.ownerDefinitionsCreated
        ? this.ownerDefinitions.get(entity)
        : undefined,
      transform =
        entity === null ? undefined : this.world.transforms.get(entity),
      curve = entity === null ? undefined : this.world.curves.get(entity);
    if (cached) definition = structuredClone(cached);
    else if (transform) {
      yield* this.native("update-owner-object", {
        owner: this.world.owners.get(entity!) ?? null,
        original: entity,
        attachedParent: null,
        position: vec(transform.position),
        rotation: structuredClone(transform.rotation),
      });
      if (!this.world.prefabRefs.has(entity!))
        throw new Error(`Missing PrefabRef: ${entity}`);
      definition = {
        prefab: this.world.prefabRefs.get(entity!) ?? null,
        position: vec(transform.position),
        rotation: structuredClone(transform.rotation),
      };
      const attached = this.world.attachments.get(entity!),
        parent =
          attached === null || attached === undefined
            ? undefined
            : this.world.transforms.get(attached);
      if (parent)
        yield* this.native("update-owner-object", {
          owner: null,
          original: attached,
          attachedParent: entity,
          position: vec(parent.position),
          rotation: structuredClone(parent.rotation),
        });
      this.ownerDefinitionsCreated = true;
      this.ownerDefinitions.set(entity, structuredClone(definition));
    } else if (curve) {
      if (!this.world.prefabRefs.has(entity!))
        throw new Error(`Missing PrefabRef: ${entity}`);
      definition = {
        prefab: this.world.prefabRefs.get(entity!) ?? null,
        position: vec(curve[0]),
        rotation: { ...vec(curve[3]), w: 0 },
      };
    }
    const objects = this.world.prefabSubObjects.get(this.input.prefab);
    if ((start.flags & end.flags & 3) !== 3 && objects) {
      let selected: readonly { entity: string | null; index: number }[] = [];
      let selectedCreated = false;
      const place = function (object: NonNullable<typeof objects>[number]) {
        const p = object.flags & 0x20000 ? start : end;
        return {
          position: add(p.position, rotate(p.rotation, object.position)),
          rotation: quatMul(p.rotation, object.rotation),
        };
      };
      for (const object of objects)
        if (object.flags & 0x100000) {
          const t = place(object),
            reply = yield* this.native("create-course-object", {
              prefab: object.prefab,
              ...t,
              owner: structuredClone(definition),
              selectedSpawnables: selected,
              selectedSpawnablesCreated: selectedCreated,
            });
          selected = reply.selectedSpawnables ?? selected;
          if (reply.selectedSpawnables !== undefined) selectedCreated = true;
          definition = { prefab: object.prefab, ...t };
          break;
        }
      for (const object of objects)
        if ((object.flags & (0x8000 | 0x100000)) === 0x8000) {
          const reply = yield* this.native("create-course-object", {
            prefab: object.prefab,
            ...place(object),
            owner: structuredClone(definition),
            selectedSpawnables: selected,
            selectedSpawnablesCreated: selectedCreated,
          });
          selected = reply.selectedSpawnables ?? selected;
          if (reply.selectedSpawnables !== undefined) selectedCreated = true;
        }
    }
    return definition;
  }
  private *finish(
    courses: CS2RoadCourse[],
    seeds: number[],
  ): Generator<CS2RoadCourseNativeRequest, void, CS2RoadCourseNativeReply> {
    let weight = 0;
    for (const course of courses)
      weight = plus(weight, yield* this.inverseWeight(course));
    if (weight < 0) for (const course of courses) this.invert(course);
    const entities = courses.map(() => this.createEntity()),
      definitions = seeds.map((seed) => this.definition(seed));
    for (let i = 0; i < entities.length; i++)
      this.component(entities[i], "CreationDefinition", definitions[i]);
    for (const entity of entities) this.component(entity, "Updated");
    const owner = yield* this.owner(
      courses[0].start,
      courses[courses.length - 1].end,
    );
    if (owner.prefab !== null) {
      for (const entity of entities)
        this.component(entity, "OwnerDefinition", owner);
      if (this.input.editorMode)
        for (let i = 0; i < entities.length; i++)
          this.component(entities[i], "LocalCurveCache", {
            curve: courses[i].curve.map((p) =>
              inverseTransform(owner.position, owner.rotation, p),
            ),
          });
    } else
      for (const course of courses) {
        course.start.parentMesh = -1;
        course.end.parentMesh = -1;
      }
    for (let i = 0; i < entities.length; i++)
      this.component(entities[i], "NetCourse", courses[i]);
    if ((this.input.parallelCount ?? [0, 0]).some((n) => n > 0)) {
      let nodeMap: readonly {
        key: readonly [number, number, number, number];
        position: V;
      }[] = [];
      // Original split-continuous branch passes the definition after its second seed assignment.
      const definition = definitions[definitions.length - 1];
      for (const course of courses) {
        const reply = yield* this.native("parallel-courses", {
          definition,
          owner: structuredClone(owner),
          course: structuredClone(course),
          parallelCount: [...(this.input.parallelCount ?? [0, 0])],
          parallelOffset: f(this.input.parallelOffset ?? 0),
          nodeMap,
        });
        nodeMap = reply.nodeMap ?? nodeMap;
      }
    }
    this.courses.push(...courses);
  }
  private width() {
    return f(
      this.world.geometryNets.get(this.input.prefab)?.defaultWidth ?? 0.02,
    );
  }
  private narrow(
    a: CS2RoadCourseControlPoint,
    m: CS2RoadCourseControlPoint,
    b: CS2RoadCourseControlPoint,
  ) {
    const first = distanceLineXZ(a.position, m.position, b.position),
      last = distanceLineXZ(b.position, m.position, a.position),
      width = this.width();
    if (
      first.distance <= times(width, 0.75) &&
      first.distance <= last.distance
    ) {
      const t = times(
        first.t,
        plus(0.5, times(divide(first.distance, width), f(2 / 3))),
      );
      m.position = lerp(a.position, m.position, t);
    } else if (last.distance <= times(width, 0.75)) {
      const t = times(
        last.t,
        plus(0.5, times(divide(last.distance, width), f(2 / 3))),
      );
      m.position = lerp(b.position, m.position, t);
    }
  }
  private *straight() {
    const indices = this.input.straightIndices ?? [0, 1],
      a = this.point(indices[0]),
      b = this.point(indices[1]);
    this.fixElevation(a);
    this.flatten(a, b);
    const random = this.rng(),
      seed = this.seed(random);
    yield* this.finish(
      [this.course(cs2StraightRoadCurve(a.position, b.position), a, b)],
      [seed],
    );
  }
  private *simple(middleIndex = this.input.middleIndex ?? 1) {
    const a = this.point(0),
      m = this.point(middleIndex),
      b = this.point(this.input.controlPoints.length - 1);
    this.fixElevation(a);
    this.fixElevation(m);
    this.flatten(a, m, b);
    this.narrow(a, m, b);
    const random = this.rng(),
      seed = this.seed(random),
      curve = cs2LinearizeRoadElevation(
        cs2FitRoadCurveFromLines(
          [a.position, m.position],
          [b.position, m.position],
        ),
      );
    yield* this.finish([this.course(curve, a, b)], [seed]);
  }
  private *execute(): Generator<
    CS2RoadCourseNativeRequest,
    void,
    CS2RoadCourseNativeReply
  > {
    if (this.input.mode === "straight") yield* this.straight();
    else if (this.input.mode === "simple") yield* this.simple();
    else if (this.input.mode === "complex") yield* this.complex();
    else yield* this.continuous();
  }
  private *complex(): Generator<
    CS2RoadCourseNativeRequest,
    void,
    CS2RoadCourseNativeReply
  > {
    const n = this.input.controlPoints.length,
      a = this.point(0),
      m = this.point(n - 3),
      p = this.point(n - 2),
      d = this.point(n - 1);
    this.fixElevation(a);
    this.fixElevation(m);
    this.fixElevation(p);
    this.flatten(a, m, p, d);
    this.narrow(a, m, p);
    let first = sub(m.position, a.position),
      last = sub(p.position, d.position),
      firstLength = lenXZ(first),
      lastLength = lenXZ(last);
    if (!(dotXZ(first, first) > f(1.1754944e-38))) {
      yield* this.simple(2);
      return;
    }
    if (!(dotXZ(last, last) > f(1.1754944e-38))) {
      yield* this.simple(1);
      return;
    }
    const start = mul(first, f(1 / firstLength));
    let end = mul(last, f(1 / lastLength));
    const middle = lerp(m.position, p.position, 0.5),
      line = distanceLineXZ(m.position, p.position, d.position),
      width = this.width();
    if (line.distance <= times(width, 0.75)) {
      const t = times(
        line.t,
        plus(0.5, times(divide(line.distance, width), f(2 / 3))),
      );
      p.position = lerp(m.position, p.position, t);
      last = sub(p.position, d.position);
      lastLength = lenXZ(last);
      if (!(dotXZ(last, last) > f(1.1754944e-38))) {
        yield* this.simple(1);
        return;
      }
      end = mul(last, f(1 / lastLength));
    }
    let curve: CS2RoadCurve = [a.position, m.position, p.position, d.position];
    const delta = sub(middle, cs2RoadCurvePosition(curve, 0.5)),
      dot = dotXZ(start, end);
    let x: number, y: number;
    if (Math.abs(dot) < f(0.999)) {
      const cross = minus(times(end.z, start.x), times(end.x, start.z)),
        denominator = times(cross, 0.375);
      x = times(
        divide(
          minus(times(end.z, delta.x), times(end.x, delta.z)),
          denominator,
        ),
        Math.abs(dot),
      );
      y = times(
        divide(
          minus(times(delta.z, start.x), times(delta.x, start.z)),
          denominator,
        ),
        Math.abs(dot),
      );
    } else if (dot > 0) {
      const total = times(plus(firstLength, lastLength), 0.375);
      x = times(dotXZ(delta, start), divide(firstLength, total));
      y = times(dotXZ(delta, end), divide(lastLength, total));
    } else {
      x = divide(firstLength, 3);
      y = divide(lastLength, 3);
    }
    // Original changes XZ handles only; height is then linearized.
    curve = [
      curve[0],
      {
        ...curve[1],
        x: plus(curve[1].x, times(start.x, x)),
        z: plus(curve[1].z, times(start.z, x)),
      },
      {
        ...curve[2],
        x: plus(curve[2].x, times(end.x, y)),
        z: plus(curve[2].z, times(end.z, y)),
      },
      curve[3],
    ];
    const random = this.rng(),
      seed = this.seed(random);
    yield* this.finish(
      [this.course(cs2LinearizeRoadElevation(curve), a, d)],
      [seed],
    );
  }
  private *continuous(): Generator<
    CS2RoadCourseNativeRequest,
    void,
    CS2RoadCourseNativeReply
  > {
    const a = this.point(0),
      m = this.point(this.input.controlPoints.length - 2),
      d = this.point(this.input.controlPoints.length - 1);
    this.fixElevation(a);
    this.fixElevation(m);
    this.flatten(a, m, d);
    const noSplit = !!(
        (this.world.geometryNets.get(this.input.prefab)?.flags ?? 0) & 0x800000
      ),
      random = this.rng(),
      start = { x: m.direction.x, y: 0, z: m.direction.y },
      end = { x: d.direction.x, y: 0, z: d.direction.y },
      delta = sub(d.position, a.position),
      square = dotXZ(delta, delta),
      normal =
        square > f(1.1754944e-38)
          ? mul(delta, f(1 / f(Math.sqrt(square))))
          : { x: 0, y: 0, z: 0 },
      dot = dotXZ(normal, start);
    if (Math.abs(dot) < f(0.01) && !noSplit) {
      const seeds = [this.seed(random), this.seed(random)],
        length = lenXZ(sub(m.position, a.position));
      m.direction = { x: m.direction.y, y: -m.direction.x };
      if (
        plus(times(delta.x, m.direction.x), times(delta.z, m.direction.y)) < 0
      )
        m.direction = { x: -m.direction.x, y: -m.direction.y };
      const middleTangent = { x: m.direction.x, y: 0, z: m.direction.y };
      m.originalEntity = null;
      m.position = add(m.position, mul(middleTangent, length));
      let first = cs2FitRoadCurve(a.position, start, middleTangent, m.position),
        last = cs2FitRoadCurve(m.position, middleTangent, end, d.position);
      const [firstDirect, lastDirect] = divideCurve(
          cs2FitRoadCurve(a.position, start, end, d.position),
          0.5,
        ),
        t = times(Math.abs(dot), 100);
      first = first.map((p, i) =>
        lerp(p, firstDirect[i], t),
      ) as unknown as CS2RoadCurve;
      last = last.map((p, i) =>
        lerp(p, lastDirect[i], t),
      ) as unknown as CS2RoadCurve;
      const y = plus(first[0].y, times(minus(last[3].y, first[0].y), 0.5));
      first = [first[0], first[1], first[2], { ...first[3], y }];
      last = [{ ...last[0], y }, last[1], last[2], last[3]];
      first = cs2LinearizeRoadElevation(first);
      last = cs2LinearizeRoadElevation(last);
      m.position = vec(first[3]);
      m.elevation = plus(
        a.elevation,
        times(minus(d.elevation, a.elevation), 0.5),
      );
      const one = this.course(first, a, m, true, false),
        two = this.course(last, m, d, false, true);
      one.end.flags |= F.freeHeight;
      two.start.flags |= F.freeHeight;
      yield* this.finish([one, two], seeds);
      return;
    }
    const seed = this.seed(random);
    let curve: CS2RoadCurve;
    if (dot < 0) {
      const extended = add(d.position, mul(end, dot));
      const fitted = cs2FitRoadCurve(a.position, start, end, extended);
      curve = [fitted[0], fitted[1], fitted[2], d.position];
    } else curve = cs2FitRoadCurve(a.position, start, end, d.position);
    yield* this.finish(
      [this.course(cs2LinearizeRoadElevation(curve), a, d)],
      [seed],
    );
  }
}
export function cs2CreateRoadCourses(
  world: CS2RoadCourseWorld,
  input: CS2RoadCoursesInput,
  callbacks: CS2RoadCoursesCallbacks = {},
): CS2RoadCoursesAdvance {
  let result = new CS2RoadCoursesTransaction(world, input).advance();
  while (result.status === "pending") {
    const reply = callbacks[result.request.kind]?.(result.request);
    if (reply === undefined) return result;
    result = result.transaction.advance(reply);
  }
  return result;
}
