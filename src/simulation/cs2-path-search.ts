import type { V } from "../core/types";
import {
  calculateCs2EdgeCost,
  calculateCs2PathSpeed,
  type Cs2CostVector,
  type Cs2PathParameters,
  type Cs2PathSpecification,
} from "./cs2-routing";

/** Serialized normal-road projection of Game.Pathfind.Edge/PathSpecification. */
export type Cs2SearchEdge = {
  /** Dense zero-based edge index, preserving the source connection order. */
  id: number;
  owner: string;
  start: number;
  end: number;
  middle?: number;
  startCurvePos?: number;
  endCurvePos?: number;
  location: readonly [V, V];
  specification: Cs2PathSpecification & {
    flags: number;
    rules: number;
    accessRequirement?: number;
    blockageStart?: number;
    blockageEnd?: number;
    density?: number;
  };
};
export type Cs2SearchGraph = {
  revision: number;
  edges: readonly Cs2SearchEdge[];
  heuristicCosts: { road: Cs2CostVector };
};
export type Cs2SearchTarget = {
  edge: number;
  delta: number;
  cost?: number;
  target?: string;
  /** Source PathTarget default EdgeFlags.DefaultMask = 0xfeff. */
  flags?: number;
};
export type Cs2SearchParameters = Cs2PathParameters & {
  pathfindFlags?: number;
  maxCost?: number;
  ignoredRules?: number;
  authorizations?: readonly number[];
};
export type Cs2SearchQuery = {
  requestId: number;
  revision: number;
  start: readonly Cs2SearchTarget[];
  end: readonly Cs2SearchTarget[];
  parameters: Cs2SearchParameters;
  /** Game.Common.RandomSeed's batch seed, before worker action-index mixing. */
  seed: number;
  actionIndex?: number;
};
export type Cs2SearchStep = {
  edge: number;
  owner: string;
  delta: readonly [from: number, to: number];
};
export type Cs2SearchResult = {
  requestId: number;
  revision: number;
  status:
    | "found"
    | "unreachable"
    | "max-cost"
    | "cancelled"
    | "stale"
    | "unsupported";
  steps: Cs2SearchStep[];
  cost: number;
  distance: number;
  duration: number;
  expanded: number;
  graphTraversal: number;
  randomState: number;
  inverted: boolean;
  origin?: string;
  destination?: string;
  reason?: string;
};

const f = Math.fround;
const bits = new DataView(new ArrayBuffer(4));

/** RandomSeed.GetRandom(index), followed by Random's constructor advance. */
export function deriveCs2WorkerSeed(batchSeed: number, actionIndex = 0) {
  const seed = (batchSeed ^ Math.imul(370248451, actionIndex)) >>> 0;
  return seed || 1851936439;
}

/** Original Unity.Mathematics.Random xorshift32 and float-bit construction. */
export class SourceRandom32 {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
    this.nextState();
  }
  private nextState() {
    const value = this.state;
    let state = value ^ (value << 13);
    state ^= state >>> 17;
    state ^= state << 5;
    this.state = state >>> 0;
    return value;
  }
  nextUInt() {
    return (this.nextState() - 1) >>> 0;
  }
  nextFloat(min = 0, max = 1) {
    bits.setUint32(0, 0x3f800000 | (this.nextState() >>> 9), true);
    const unit = f(bits.getFloat32(0, true) - 1);
    return f(f(unit * f(max - min)) + min);
  }
}

type HeapEntry = { cost: number; node: number };
/** Source four-ary heap. Equal costs retain its comparison-tree behavior. */
export class Cs2SourceHeap {
  private buffer: HeapEntry[] = [];
  get length() {
    return this.buffer.length;
  }
  insert(item: HeapEntry) {
    this.buffer.push(item);
    let index = this.buffer.length - 1;
    if (index <= 0) return;
    let parent = (index - 1) >> 2;
    while (item.cost < this.buffer[parent].cost) {
      this.buffer[index] = this.buffer[parent];
      index = parent;
      if (parent === 0) break;
      parent = (parent - 1) >> 2;
    }
    this.buffer[index] = item;
  }
  extract() {
    const result = this.buffer[0];
    if (!result) return undefined;
    const last = this.buffer.pop()!;
    if (this.buffer.length) this.buffer[0] = last;
    if (this.buffer.length <= 1) return result;
    const value = this.buffer[0];
    let index = 0;
    let minimum = this.findMin(1);
    while (this.buffer[minimum].cost < value.cost) {
      this.buffer[index] = this.buffer[minimum];
      index = minimum;
      minimum <<= 2;
      if (minimum + 1 >= this.buffer.length) break;
      minimum = this.findMin(minimum + 1);
    }
    this.buffer[index] = value;
    return result;
  }
  private findMin(first: number) {
    const last = this.buffer.length - 1;
    let a = Math.min(first, last),
      b = Math.min(first + 2, last);
    const c = Math.min(first + 1, last),
      d = Math.min(first + 3, last);
    if (this.buffer[c].cost < this.buffer[a].cost) a = c;
    if (this.buffer[d].cost < this.buffer[b].cost) b = d;
    return this.buffer[b].cost < this.buffer[a].cost ? b : a;
  }
}

type Connection = { edge: number; access: number };
const EDGE = {
  forward: 1,
  backward: 2,
  middle: 4,
  single: 8,
  freeForward: 64,
  freeBackward: 128,
  secondary: 256,
  enter: 512,
  exit: 1024,
  authorization: 16384,
  outside: 32768,
};
const ITEM = {
  end: 1,
  single: 2,
  nextEdge: 4,
  reduced: 8,
  forbidExit: 16,
  reducedAccess: 32,
  forward: 64,
  backward: 128,
};
const FLAG = {
  stable: 1,
  ignoreFlow: 2,
  forceForward: 4,
  forceBackward: 8,
  noHeuristics: 16,
  parkingReset: 32,
  multipleOrigins: 128,
  multipleDestinations: 256,
  ignoreStartAccess: 512,
  ignoreEndAccess: 1024,
  skip: 4096,
};
const FLOAT_MAX = 3.4028234663852886e38;
const START_INDEX = 2147483647;
type FullNode = { node: number; pos: number };
type NodeData = {
  pathNode: FullNode;
  nextNode: number;
  source: number;
  total: number;
  base: number;
  access: number;
  edge: number;
  nextEdge: number;
  delta: [number, number];
  flags: number;
  methods: number;
};
type Bounds = { min: V; max: V };

function point(edge: Cs2SearchEdge, t: number): V {
  const [a, b] = edge.location;
  return {
    x: f(a.x + f(f(b.x - a.x) * t)),
    y: f(a.y + f(f(b.y - a.y) * t)),
    z: f(a.z + f(f(b.z - a.z) * t)),
  };
}
function squared(v: V) {
  return f(f(f(v.x * v.x) + f(v.y * v.y)) + f(v.z * v.z));
}
function fullKey(node: FullNode) {
  return `${node.node}:${node.pos}`;
}
function sameNode(a: FullNode, b: FullNode) {
  return a.node === b.node && a.pos === b.pos;
}
function targetNode(edge: number, pos: number): FullNode {
  return { node: -4 - (edge << 2), pos: f(pos) };
}

/** Installed once per revision; per-query execution shares these immutable edges. */
export class Cs2CompiledPathGraph {
  readonly revision: number;
  readonly edges: Cs2SearchEdge[];
  readonly heuristicCosts: Cs2SearchGraph["heuristicCosts"];
  private forward = new Map<number, Connection[]>();
  private backward = new Map<number, Connection[]>();
  constructor(graph: Cs2SearchGraph) {
    this.revision = graph.revision;
    this.heuristicCosts = {
      road: graph.heuristicCosts.road.map(f) as unknown as Cs2CostVector,
    };
    this.edges = graph.edges.map((edge, index) => {
      if (edge.id !== index)
        throw new Error("CS2 search edge IDs must be dense array indices");
      return {
        ...edge,
        startCurvePos: f(edge.startCurvePos ?? 0),
        endCurvePos: f(edge.endCurvePos ?? 0),
        location: edge.location.map((v) => ({
          x: f(v.x),
          y: f(v.y),
          z: f(v.z),
        })) as [V, V],
        specification: {
          ...edge.specification,
          length: f(edge.specification.length),
          maxSpeed: f(edge.specification.maxSpeed),
          costs: edge.specification.costs.map(f) as unknown as Cs2CostVector,
          accessRequirement: edge.specification.accessRequirement ?? -1,
          secondary: !!(edge.specification.flags & EDGE.secondary),
        },
      };
    });
    const add = (
      table: Map<number, Connection[]>,
      node: number | undefined,
      edge: Cs2SearchEdge,
    ) => {
      if (node === undefined || node < 0) return;
      const list = table.get(node) ?? [];
      list.push({
        edge: edge.id,
        access:
          edge.specification.flags & EDGE.enter
            ? -1
            : edge.specification.accessRequirement!,
      });
      table.set(node, list);
    };
    for (const edge of this.edges) {
      const flags = edge.specification.flags;
      if (flags & EDGE.forward) {
        add(this.forward, edge.start, edge);
        add(this.backward, edge.end, edge);
      }
      if (flags & EDGE.middle) {
        add(this.forward, edge.middle, edge);
        add(this.backward, edge.middle, edge);
      }
      if (flags & EDGE.backward) {
        add(this.forward, edge.end, edge);
        add(this.backward, edge.start, edge);
      }
    }
  }
  connections(node: number, inverted: boolean) {
    return (inverted ? this.backward : this.forward).get(node) ?? [];
  }
}

/** Literal normal-road projection of PathfindExecutor. It preserves source
 * edge-position targets, closed-state signs, connection order and RNG timing.
 * step() only pauses between heap pops; it never restarts or changes a query.
 */
export class Cs2PathSearch {
  readonly graph: Cs2CompiledPathGraph;
  readonly query: Cs2SearchQuery;
  readonly random: SourceRandom32;
  private parameters: Cs2SearchParameters;
  private nodes: NodeData[] = [];
  private buckets = new Map<number, number>();
  private heap = new Cs2SourceHeap();
  private starts = new Map<string, { cost: number; target: string }>();
  private ends = new Map<string, { cost: number; target: string }>();
  private endBounds: Bounds = {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  };
  private heuristic = 0;
  private offset = 0;
  private maximum = FLOAT_MAX;
  private access = [-1, -1, -1];
  private forward = EDGE.forward;
  private backward = EDGE.backward;
  private freeForward = EDGE.freeForward;
  private freeBackward = EDGE.freeBackward;
  private inverted = false;
  private expanded = 0;
  private initialTraversal = 0;
  private outcome?: Cs2SearchResult;

  constructor(
    graph: Cs2SearchGraph | Cs2CompiledPathGraph,
    query: Cs2SearchQuery,
  ) {
    this.graph =
      graph instanceof Cs2CompiledPathGraph
        ? graph
        : new Cs2CompiledPathGraph(graph);
    this.query = query;
    this.parameters = {
      ...query.parameters,
      ignoreFlow: !!((query.parameters.pathfindFlags ?? 0) & FLAG.ignoreFlow),
      maxSpeed: query.parameters.maxSpeed.map(f) as [number, number],
      walkSpeed: query.parameters.walkSpeed.map(f) as [number, number],
      weights: query.parameters.weights.map(f) as unknown as Cs2CostVector,
    };
    this.random = new SourceRandom32(
      deriveCs2WorkerSeed(query.seed, query.actionIndex),
    );
    if (query.revision !== this.graph.revision) {
      this.finish("stale");
      return;
    }
    if (!query.start.length || !query.end.length) {
      this.finish("unreachable");
      return;
    }
    if (
      !(this.parameters.methods & 8194) ||
      this.parameters.methods & ~8194 ||
      this.searchFlags & FLAG.parkingReset
    ) {
      this.finish(
        "unsupported",
        "This executor projection supports Road/MediumRoad without parking reset",
      );
      return;
    }
    if (this.searchFlags & FLAG.skip) {
      this.finish("found");
      this.outcome!.cost = f(
        (query.start[0].cost ?? 0) + (query.end[0].cost ?? 0),
      );
      this.outcome!.distance = 0;
      this.outcome!.duration = 0;
      this.outcome!.graphTraversal = 1;
      this.outcome!.origin = this.graph.edges[query.start[0].edge]?.owner;
      this.outcome!.destination = this.graph.edges[query.end[0].edge]?.owner;
      return;
    }
    if (!(this.searchFlags & FLAG.noHeuristics)) {
      const values = [...this.graph.heuristicCosts.road];
      values[0] = f(
        values[0] + f(1 / Math.max(f(0.01), this.parameters.maxSpeed[0])),
      );
      this.heuristic = Math.min(
        1000000,
        this.dot(values as unknown as Cs2CostVector, this.parameters.weights),
      );
      if (!(this.searchFlags & FLAG.stable))
        this.heuristic = f(this.heuristic * 2);
    }
    this.addTargets();
    this.initialTraversal = this.nodes.length;
  }
  get result() {
    return this.outcome;
  }
  private get searchFlags() {
    return this.parameters.pathfindFlags ?? 0;
  }
  private dot(a: Cs2CostVector, b: Cs2CostVector) {
    return f(
      f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2])) + f(a[3] * b[3]),
    );
  }
  private blank(
    status: Cs2SearchResult["status"],
    reason?: string,
  ): Cs2SearchResult {
    return {
      requestId: this.query.requestId,
      revision: this.query.revision,
      status,
      steps: [],
      cost: -1,
      distance: -1,
      duration: -1,
      expanded: this.expanded,
      graphTraversal: this.nodes.length,
      randomState: this.random.state,
      inverted: this.inverted,
      ...(reason ? { reason } : {}),
    };
  }
  private finish(status: Cs2SearchResult["status"], reason?: string) {
    this.outcome = this.blank(status, reason);
  }
  cancel() {
    if (!this.outcome) this.finish("cancelled");
    return this.outcome!;
  }
  run() {
    while (!this.outcome) this.step(65536);
    return this.outcome;
  }

  private bounds(targets: readonly Cs2SearchTarget[]) {
    const bounds: Bounds = {
      min: { x: FLOAT_MAX, y: FLOAT_MAX, z: FLOAT_MAX },
      max: { x: -FLOAT_MAX, y: -FLOAT_MAX, z: -FLOAT_MAX },
    };
    let minimum = FLOAT_MAX,
      access = -1,
      multiple = false;
    for (const target of targets) {
      const edge = this.graph.edges[target.edge];
      if (!edge) continue;
      const location = point(edge, f(target.delta));
      for (const axis of ["x", "y", "z"] as const) {
        bounds.min[axis] = Math.min(bounds.min[axis], location[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], location[axis]);
      }
      minimum = Math.min(minimum, f(target.cost ?? 0));
      const requirement = edge.specification.accessRequirement!;
      if (
        requirement !== -1 &&
        requirement !== access &&
        (edge.specification.flags & (EDGE.enter | EDGE.exit)) !== EDGE.enter
      ) {
        multiple = access !== -1;
        if (!multiple) access = requirement;
      }
    }
    return { bounds, minimum, access, multiple };
  }
  private addTargets() {
    let start = this.query.start,
      end = this.query.end;
    let a = this.bounds(start),
      b = this.bounds(end);
    if (a.minimum === FLOAT_MAX || b.minimum === FLOAT_MAX) {
      this.finish("unreachable");
      return;
    }
    let multipleA = a.multiple,
      multipleB = b.multiple;
    if (multipleA && multipleB) {
      multipleA =
        (this.searchFlags & (FLAG.ignoreStartAccess | FLAG.ignoreEndAccess)) !==
        FLAG.ignoreStartAccess;
      multipleB = !(this.searchFlags & FLAG.ignoreEndAccess);
    }
    if (this.searchFlags & FLAG.forceForward) this.inverted = false;
    else if (this.searchFlags & FLAG.forceBackward) this.inverted = true;
    else if (this.searchFlags & FLAG.multipleDestinations)
      this.inverted = false;
    else if (this.searchFlags & FLAG.multipleOrigins) this.inverted = true;
    else if (multipleA) this.inverted = false;
    else if (multipleB) this.inverted = true;
    else {
      const size = (v: Bounds) => ({
        x: f(v.max.x - v.min.x),
        y: f(v.max.y - v.min.y),
        z: f(v.max.z - v.min.z),
      });
      this.inverted = squared(size(a.bounds)) < squared(size(b.bounds));
    }
    if (this.inverted) {
      [start, end] = [end, start];
      [a, b] = [b, a];
      [multipleA, multipleB] = [multipleB, multipleA];
      this.forward = EDGE.backward;
      this.backward = EDGE.forward;
      this.freeForward = EDGE.freeBackward;
      this.freeBackward = EDGE.freeForward;
    }
    if (multipleB) {
      this.finish("unsupported", "TooManyEndAccessRequirements");
      return;
    }
    if (
      (this.searchFlags & FLAG.multipleDestinations && this.inverted) ||
      (this.searchFlags & FLAG.multipleOrigins && !this.inverted)
    ) {
      this.finish("unsupported", "MultipleStartResults");
      return;
    }
    this.endBounds = b.bounds;
    this.access[2] = b.access;
    for (const target of end) {
      const edge = this.graph.edges[target.edge];
      if (!edge) continue;
      const node = targetNode(edge.id, target.delta),
        key = fullKey(node),
        cost = f((target.cost ?? 0) - b.minimum);
      if (!this.ends.has(key) || cost < this.ends.get(key)!.cost)
        this.ends.set(key, { cost, target: target.target ?? edge.owner });
      const found = this.getOrAdd(node);
      if (!found.exists) {
        let flags = ITEM.end;
        if ((target.flags ?? 0xfeff) & this.forward) flags |= ITEM.forward;
        if ((target.flags ?? 0xfeff) & this.backward) flags |= ITEM.backward;
        this.nodes.push(
          this.data(
            -1,
            FLOAT_MAX,
            cost,
            -1,
            edge.id,
            0,
            [f(target.delta), f(target.delta)],
            node,
            flags,
            0,
          ),
        );
      }
    }
    for (const target of start) {
      const edge = this.graph.edges[target.edge];
      if (!edge) continue;
      const key = fullKey(targetNode(edge.id, target.delta)),
        cost = f((target.cost ?? 0) - a.minimum);
      if (!this.starts.has(key) || cost < this.starts.get(key)!.cost)
        this.starts.set(key, { cost, target: target.target ?? edge.owner });
      const flags = edge.specification.flags & (target.flags ?? 0xfeff),
        delta = f(target.delta);
      this.addConnections(
        START_INDEX,
        edge,
        flags,
        edge.specification.rules & (~(this.parameters.ignoredRules ?? 0) & 255),
        cost,
        delta,
        [
          !!(flags & this.forward) || (delta === 1 && edge.end >= 0),
          !!(flags & EDGE.middle),
          !!(flags & this.backward) || (delta === 0 && edge.start >= 0),
        ],
        false,
        edge.specification.accessRequirement !== -1 &&
          (edge.specification.flags & (EDGE.enter | EDGE.exit)) === EDGE.enter,
      );
    }
    this.offset = f(a.minimum + b.minimum);
    this.maximum = this.parameters.maxCost
      ? f(this.parameters.maxCost - this.offset)
      : FLOAT_MAX;
  }
  private data(
    source: number,
    total: number,
    base: number,
    access: number,
    edge: number,
    nextEdge: number,
    delta: [number, number],
    pathNode: FullNode,
    flags: number,
    methods: number,
  ): NodeData {
    return {
      source,
      total,
      base,
      access,
      edge,
      nextEdge,
      delta,
      pathNode,
      flags,
      methods,
      nextNode: -1,
    };
  }
  private getOrAdd(node: FullNode): { exists: boolean; index: number } {
    const bucket = Math.abs(node.node) >> 4;
    const first = this.buckets.get(bucket);
    if (first !== undefined) {
      let index: number = first;
      while (true) {
        const value: NodeData = this.nodes[index];
        if (sameNode(value.pathNode, node)) return { exists: true, index };
        if (value.nextNode === -1) break;
        index = value.nextNode;
      }
      this.nodes[index].nextNode = this.nodes.length;
    } else this.buckets.set(bucket, this.nodes.length);
    return { exists: false, index: this.nodes.length };
  }
  private first(node: FullNode) {
    return this.buckets.get(Math.abs(node.node) >> 4);
  }
  private valid(edge: Cs2SearchEdge, rules: number, delta: [number, number]) {
    return (
      !(rules & 1) ||
      Math.min(...delta) >
        f((edge.specification.blockageEnd ?? 0) * f(0.003921569)) ||
      Math.max(...delta) <
        f((edge.specification.blockageStart ?? 0) * f(0.003921569))
    );
  }
  private cost(
    edge: Cs2SearchEdge,
    flags: number,
    rules: number,
    delta: [number, number],
  ) {
    const authorized = (this.parameters.authorizations ?? []).includes(
      edge.specification.accessRequirement!,
    );
    return calculateCs2EdgeCost(edge.specification, this.parameters, {
      delta,
      trafficRulePenalty: !!(rules & 62),
      avoidBicycles: !!(rules & 64),
      requireAuthorization: !!(flags & EDGE.authorization),
      authorized,
      freeForward: !!(flags & this.freeForward),
      freeBackward: !!(flags & this.freeBackward),
    });
  }
  private total(edge: Cs2SearchEdge, base: number, delta: number) {
    const p = point(edge, delta),
      offset = {
        x: Math.max(
          0,
          f(this.endBounds.min.x - p.x),
          f(p.x - this.endBounds.max.x),
        ),
        y: Math.max(
          0,
          f(this.endBounds.min.y - p.y),
          f(p.y - this.endBounds.max.y),
        ),
        z: Math.max(
          0,
          f(this.endBounds.min.z - p.z),
          f(p.z - this.endBounds.max.z),
        ),
      };
    return f(base + f(f(Math.sqrt(squared(offset))) * this.heuristic));
  }
  private addHeap(
    source: number,
    edge: Cs2SearchEdge,
    flags: number,
    rules: number,
    base: number,
    factor: number,
    node: FullNode,
    delta: [number, number],
    itemFlags: number,
    nextEdge?: number,
  ) {
    const found = this.getOrAdd(node);
    const add = () => {
      const nextBase = f(
        base + f(this.cost(edge, flags, rules, delta) * factor),
      );
      return this.data(
        (-1 - source) | 0,
        this.total(edge, nextBase, delta[1]),
        nextBase,
        edge.specification.accessRequirement!,
        edge.id,
        nextEdge ?? 0,
        delta,
        node,
        itemFlags | (nextEdge !== undefined ? ITEM.nextEdge : 0),
        edge.specification.methods,
      );
    };
    if (found.exists) {
      const old = this.nodes[found.index];
      if (old.source < 0) {
        const value = add();
        if (value.total < old.total) {
          this.nodes[found.index] = value;
          this.heap.insert({ cost: value.total, node: found.index });
        } else if (nextEdge !== undefined && nextEdge !== old.nextEdge) {
          old.nextEdge = 0;
          old.flags &= ~ITEM.nextEdge;
        }
      }
    } else {
      const value = add();
      this.nodes.push(value);
      this.heap.insert({ cost: value.total, node: found.index });
    }
  }
  private addConnections(
    source: number,
    edge: Cs2SearchEdge,
    flags: number,
    rules: number,
    base: number,
    start: number,
    directions: [boolean, boolean, boolean],
    forbidExit: boolean,
    reducedAccess: boolean,
  ) {
    let itemFlags =
      (flags & EDGE.single ? ITEM.single : 0) |
      (forbidExit ? ITEM.forbidExit : 0) |
      (reducedAccess ? ITEM.reducedAccess : 0);
    const sample = this.random.nextFloat(0.5, 1),
      factor = this.searchFlags & FLAG.stable ? 1 : sample;
    if (directions[0] && this.valid(edge, rules, [start, 1]))
      this.addHeap(
        source,
        edge,
        flags,
        rules,
        base,
        factor,
        { node: edge.end, pos: edge.endCurvePos! },
        [start, 1],
        itemFlags,
      );
    if (directions[1]) {
      for (const connection of this.graph.connections(
        edge.middle ?? -1,
        this.inverted,
      )) {
        if (
          connection.edge === edge.id ||
          ![
            ...this.access,
            reducedAccess ? -1 : edge.specification.accessRequirement!,
          ].includes(connection.access)
        )
          continue;
        const other = this.graph.edges[connection.edge];
        if (
          !(other.specification.methods & this.parameters.methods) ||
          (itemFlags & ITEM.single && other.specification.flags & EDGE.single)
        )
          continue;
        const changed =
          other.specification.accessRequirement !==
          edge.specification.accessRequirement;
        if (forbidExit && changed) continue;
        let nextFlags = itemFlags;
        if (changed && other.specification.accessRequirement !== -1)
          nextFlags |= ITEM.forbidExit | ITEM.reducedAccess;
        if (other.specification.flags & EDGE.exit)
          nextFlags &= ~ITEM.forbidExit;
        if (!(other.specification.flags & EDGE.enter))
          nextFlags &= ~ITEM.reducedAccess;
        for (const [id, position, direction] of [
          [other.start, other.startCurvePos!, this.forward],
          [other.end, other.endCurvePos!, this.backward],
        ]) {
          if (edge.middle !== id || !(other.specification.flags & direction))
            continue;
          if (
            (directions[0] && position >= start) ||
            (directions[2] && position <= start)
          ) {
            const delta: [number, number] = [start, position];
            if (this.valid(edge, rules, delta))
              this.addHeap(
                source,
                edge,
                flags,
                rules,
                base,
                factor,
                { node: id, pos: position },
                delta,
                nextFlags,
                other.id,
              );
          }
        }
      }
    }
    if (directions[2] && this.valid(edge, rules, [start, 0]))
      this.addHeap(
        source,
        edge,
        flags,
        rules,
        base,
        factor,
        { node: edge.start, pos: edge.startCurvePos! },
        [start, 0],
        itemFlags,
      );
    const synthetic = targetNode(edge.id, 0);
    let index = this.first(synthetic);
    while (index !== undefined && index !== -1) {
      let value = this.nodes[index];
      if (
        value.pathNode.node === synthetic.node &&
        value.source < 0 &&
        ((directions[0] &&
          value.flags & ITEM.forward &&
          value.delta[1] >= start) ||
          (directions[2] &&
            value.flags & ITEM.backward &&
            value.delta[1] <= start))
      ) {
        const delta: [number, number] = [start, value.delta[1]];
        if (this.valid(edge, rules, delta)) {
          const node = targetNode(edge.id, value.delta[1]);
          const targetCost =
            value.total < FLOAT_MAX
              ? this.ends.get(fullKey(node))!.cost
              : value.base;
          const nextBase = f(
              base + f(this.cost(edge, flags, rules, delta) * factor),
            ),
            total = f(nextBase + targetCost);
          if (total < value.total) {
            value = this.data(
              (-1 - source) | 0,
              total,
              nextBase,
              edge.specification.accessRequirement!,
              edge.id,
              0,
              delta,
              node,
              itemFlags |
                (value.flags & (ITEM.end | ITEM.forward | ITEM.backward)),
              edge.specification.methods,
            );
            this.nodes[index] = value;
            this.heap.insert({ cost: total, node: index });
          }
        }
      }
      index = value.nextNode;
    }
  }
  private checkNext(
    source: number,
    edge: Cs2SearchEdge,
    node: FullNode,
    base: number,
    itemFlags: number,
  ) {
    const flags = edge.specification.flags,
      rules =
        edge.specification.rules & (~(this.parameters.ignoredRules ?? 0) & 255);
    let start: number, directions: [boolean, boolean, boolean];
    if (sameNode(node, { node: edge.start, pos: edge.startCurvePos! })) {
      start = 0;
      directions = [
        !!(flags & this.forward),
        (flags & (this.forward | EDGE.middle)) === (this.forward | EDGE.middle),
        false,
      ];
    } else if (sameNode(node, { node: edge.end, pos: edge.endCurvePos! })) {
      start = 1;
      directions = [
        false,
        (flags & (this.backward | EDGE.middle)) ===
          (this.backward | EDGE.middle),
        !!(flags & this.backward),
      ];
    } else if (node.node === edge.middle) {
      start = node.pos;
      directions = [
        !!(flags & this.forward),
        !!(flags & EDGE.middle),
        !!(flags & this.backward),
      ];
    } else return;
    this.addConnections(
      source,
      edge,
      flags,
      rules,
      base,
      start,
      directions,
      !!(itemFlags & ITEM.forbidExit),
      !!(itemFlags & ITEM.reducedAccess),
    );
  }
  step(maximumPops = 512): Cs2SearchResult | undefined {
    if (this.outcome) return this.outcome;
    for (let pop = 0; pop < Math.max(1, maximumPops); pop++) {
      const entry = this.heap.extract();
      if (!entry) {
        this.finish("unreachable");
        this.outcome!.graphTraversal = this.initialTraversal;
        return this.outcome;
      }
      const value = this.nodes[entry.node];
      if (value.source >= 0) continue;
      value.source = (-1 - value.source) | 0;
      this.expanded++;
      if (entry.cost > this.maximum) {
        this.finish("max-cost");
        this.outcome!.cost = FLOAT_MAX;
        return this.outcome;
      }
      if (value.flags & ITEM.end) {
        this.createPath(entry.node, f(entry.cost + this.offset));
        return this.outcome;
      }
      if (value.flags & ITEM.nextEdge) {
        this.checkNext(
          entry.node,
          this.graph.edges[value.nextEdge],
          value.pathNode,
          value.base,
          value.flags,
        );
        continue;
      }
      const mask = [
        ...this.access,
        value.flags & ITEM.reducedAccess ? -1 : value.access,
      ];
      // Snapshot fields before AddConnections may append or replace node rows.
      const {
        pathNode,
        base,
        edge: previousEdge,
        flags: previousFlags,
      } = value;
      for (const connection of this.graph.connections(
        pathNode.node,
        this.inverted,
      )) {
        if (
          previousEdge === connection.edge ||
          !mask.includes(connection.access)
        )
          continue;
        const edge = this.graph.edges[connection.edge],
          edgeFlags = edge.specification.flags;
        if (
          !(edge.specification.methods & this.parameters.methods) ||
          (previousFlags & ITEM.single && edgeFlags & EDGE.single)
        )
          continue;
        const changed = edge.specification.accessRequirement !== value.access;
        if (previousFlags & ITEM.forbidExit && changed) continue;
        let itemFlags = previousFlags;
        if (changed && edge.specification.accessRequirement !== -1)
          itemFlags |= ITEM.forbidExit | ITEM.reducedAccess;
        if (edgeFlags & EDGE.exit) itemFlags &= ~ITEM.forbidExit;
        if (!(edgeFlags & EDGE.enter)) itemFlags &= ~ITEM.reducedAccess;
        this.checkNext(entry.node, edge, pathNode, base, itemFlags);
      }
    }
    return undefined;
  }
  private createPath(index: number, cost: number) {
    const end = this.nodes[index],
      target = this.ends.get(fullKey(end.pathNode));
    const steps: Cs2SearchStep[] = [];
    let distance = 0,
      duration = 0,
      node = end;
    // Source reporting keeps the raised outside-connection speed for earlier rows.
    let parameters = { ...this.parameters };
    for (let guard = 0; guard <= this.nodes.length; guard++) {
      const edge = this.graph.edges[node.edge];
      if (edge.specification.flags & EDGE.outside)
        parameters = {
          ...parameters,
          maxSpeed: [f(277.77777), f(277.77777)],
          walkSpeed: [f(277.77777), f(277.77777)],
        };
      const length = f(
        edge.specification.length * Math.abs(f(node.delta[1] - node.delta[0])),
      );
      distance = f(distance + length);
      duration = f(
        duration +
          f(length / calculateCs2PathSpeed(edge.specification, parameters)),
      );
      steps.push({ edge: edge.id, owner: edge.owner, delta: [...node.delta] });
      if (node.source === START_INDEX) break;
      node = this.nodes[node.source];
    }
    let origin = this.starts.get(
        fullKey(targetNode(node.edge, node.delta[0])),
      )?.target,
      destination = target?.target;
    if (this.inverted) {
      [origin, destination] = [destination, origin];
      for (const step of steps) step.delta = [step.delta[1], step.delta[0]];
    } else steps.reverse();
    this.outcome = {
      ...this.blank("found"),
      steps,
      cost,
      distance,
      duration,
      origin,
      destination,
    };
  }
}

export function searchCs2Path(
  graph: Cs2SearchGraph | Cs2CompiledPathGraph,
  query: Cs2SearchQuery,
) {
  return new Cs2PathSearch(graph, query).run();
}
