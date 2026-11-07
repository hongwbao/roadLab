/** Original NodeAlignSystem stage; original-source world evidence: CS2_ROAD_NODE_ALIGN.md. */
import type { V } from "./types";
import { cs2NativeSort } from "./cs2-native-sort";
import { cs2LookRotationSafe } from "../simulation/cs2-motion";
import type { CS2RoadCoursePos } from "./cs2-road-courses";
import {
  CS2RoadApplyECS,
  type CS2RoadApplyWorld,
  type CS2RoadApplyNode,
  type CS2RoadApplyEdge,
  type CS2RoadApplyCurve,
  type CS2RoadApplyTemp,
} from "./cs2-road-ecs";
type Entity = string | null;
type Q = CS2RoadCoursePos["rotation"];
const f = Math.fround,
  addN = (a: number, b: number) => f(f(a) + f(b)),
  subN = (a: number, b: number) => f(f(a) - f(b)),
  mulN = (a: number, b: number) => f(f(a) * f(b)),
  divN = (a: number, b: number) => f(f(a) / f(b));
const min = (a: number, b: number) => (Number.isNaN(b) || a < b ? a : b),
  max = (a: number, b: number) => (Number.isNaN(b) || a > b ? a : b),
  clamp = (n: number, a: number, b: number) => max(a, min(b, n)),
  sat = (n: number) => clamp(n, 0, 1);
const zero = (): V => ({ x: 0, y: 0, z: 0 }),
  add = (a: V, b: V): V => ({
    x: addN(a.x, b.x),
    y: addN(a.y, b.y),
    z: addN(a.z, b.z),
  }),
  sub = (a: V, b: V): V => ({
    x: subN(a.x, b.x),
    y: subN(a.y, b.y),
    z: subN(a.z, b.z),
  }),
  mul = (a: V, n: number): V => ({
    x: mulN(a.x, n),
    y: mulN(a.y, n),
    z: mulN(a.z, n),
  }),
  dot2 = (a: V, b: V) => addN(mulN(a.x, b.x), mulN(a.z, b.z)),
  dot = (a: V, b: V) =>
    addN(addN(mulN(a.x, b.x), mulN(a.y, b.y)), mulN(a.z, b.z)),
  xz = (p: V): V => ({ x: f(p.x), y: 0, z: f(p.z) }),
  length = (a: V, d2 = false) => f(Math.sqrt(d2 ? dot2(a, a) : dot(a, a))),
  distance = (a: V, b: V, d2 = false) => length(sub(a, b), d2),
  mix = (a: V, b: V, t: number) => add(a, mul(sub(b, a), t));
const normalize = (p: V, d2 = false) => {
  const square = d2 ? dot2(p, p) : dot(p, p);
  return square > f(1.1754944e-38)
    ? mul(p, divN(1, f(Math.sqrt(square))))
    : zero();
};
function segmentPoint(a: V, b: V, p: V) {
  const line = sub(b, a),
    offset = sub(p, a),
    squared = dot2(line, line),
    t = squared !== 0 ? sat(divN(dot2(line, offset), squared)) : 0;
  return { t, distance: distance(mul(line, t), offset, true) };
}
function segmentPair(a: V, b: V, c: V, d: V) {
  const first = sub(b, a),
    second = sub(d, c),
    offset = sub(a, c),
    denom = subN(mulN(first.x, second.z), mulN(first.z, second.x));
  if (denom === 0) {
    let p = segmentPoint(c, d, a),
      result = { first: 0, second: p.t, distance: p.distance };
    p = segmentPoint(c, d, b);
    if (p.distance < result.distance)
      result = { first: 1, second: p.t, distance: p.distance };
    p = segmentPoint(a, b, c);
    if (p.distance < result.distance)
      result = { first: p.t, second: 0, distance: p.distance };
    p = segmentPoint(a, b, d);
    if (p.distance < result.distance)
      result = { first: p.t, second: 1, distance: p.distance };
    return result;
  }
  let x = sat(
      divN(subN(mulN(offset.z, second.x), mulN(offset.x, second.z)), denom),
    ),
    y = sat(
      divN(subN(mulN(offset.z, first.x), mulN(offset.x, first.z)), denom),
    ),
    dist = 0;
  let p;
  if (x === 0) {
    p = segmentPoint(c, d, a);
    y = p.t;
    dist = p.distance;
  } else if (x === 1) {
    p = segmentPoint(c, d, b);
    y = p.t;
    dist = p.distance;
  } else if (y === 0) {
    p = segmentPoint(a, b, c);
    x = p.t;
    dist = p.distance;
  } else if (y === 1) {
    p = segmentPoint(a, b, d);
    x = p.t;
    dist = p.distance;
  }
  return { first: x, second: y, distance: dist };
}
function rotate(q: Q, p: V) {
  const cross = (a: V, b: V): V => ({
      x: subN(mulN(a.y, b.z), mulN(a.z, b.y)),
      y: subN(mulN(a.z, b.x), mulN(a.x, b.z)),
      z: subN(mulN(a.x, b.y), mulN(a.y, b.x)),
    }),
    t = mul(cross(q, p), 2);
  return add(add(p, mul(t, q.w)), cross(q, t));
}
const rotateY = (angle: number): Q => {
  const half = mulN(angle, 0.5);
  return { x: 0, y: f(Math.sin(half)), z: 0, w: f(Math.cos(half)) };
};
/** Complete source EdgeIterator.GetNext behavior used by NodeAlign. */
function* nodeEdges(
  ecs: CS2RoadApplyECS,
  inputNode: string,
  inputEdge: Entity = null,
  middles = false,
): Generator<{ edge: string; end: boolean; middle: boolean }> {
  let node: Entity = inputNode,
    buffer = ecs.buffer("ConnectedEdge", node),
    index = 0;
  const permanent = !ecs.has("Temp", node),
    edgeTemp = ecs.tryGet<CS2RoadApplyTemp>("Temp", inputEdge),
    originalEdge = edgeTemp?.original ?? null,
    deleted =
      inputEdge !== null
        ? !!(edgeTemp?.flags && edgeTemp.flags & 2)
        : !permanent && !!(ecs.get<CS2RoadApplyTemp>("Temp", node).flags & 2);
  while (true) {
    while (index < buffer.length) {
      const id = buffer[index++].edge as string,
        edge = ecs.get<CS2RoadApplyEdge>("Edge", id);
      let allow: boolean;
      if (permanent) allow = true;
      else if (deleted)
        allow =
          id === inputEdge || (ecs.has("Hidden", id) && id !== originalEdge);
      else
        allow =
          !ecs.has("Hidden", id) &&
          !(ecs.tryGet<CS2RoadApplyTemp>("Temp", id)?.flags! & 2);
      if (!allow) continue;
      const end = edge.end === node;
      if (end || edge.start === node) yield { edge: id, end, middle: false };
      else if (middles) yield { edge: id, end, middle: true };
    }
    const temp: CS2RoadApplyTemp | undefined = ecs.tryGet<CS2RoadApplyTemp>(
      "Temp",
      node,
    );
    if (!temp) break;
    node = temp.original;
    if (!ecs.hasBuffer("ConnectedEdge", node)) break;
    buffer = ecs.buffer("ConnectedEdge", node);
    index = 0;
  }
}
/** Entire source NodeAlignSystem.UpdateNodeRotationsJob and LineComparer. */
export function cs2AlignRoadNodes(world: CS2RoadApplyWorld) {
  const ecs = new CS2RoadApplyECS(world);
  for (const chunk of ecs.chunks({ all: ["Node", "Updated"] })) {
    const standalone = chunk.components.has("Standalone");
    for (const entity of chunk.entities) {
      const node = ecs.get<CS2RoadApplyNode>("Node", entity),
        prefab = ecs.get("PrefabRef", entity).prefab,
        net = ecs.tryGet("NetData", prefab) ?? { requiredLayers: 0 },
        position = structuredClone(node.position),
        angles: number[] = [],
        lines: { a: V; b: V }[] = [];
      let axis = zero(),
        sum = zero(),
        count = 0;
      for (const item of nodeEdges(ecs, entity)) {
        const curve = ecs.get<CS2RoadApplyCurve>("Curve", item.edge).bezier,
          p = ecs.get("PrefabRef", item.edge).prefab,
          other = ecs.tryGet("NetData", p) ?? { requiredLayers: 0 };
        if (!(net.requiredLayers & other.requiredLayers)) continue;
        let offset: V, tangent: V;
        if (item.end) {
          offset = sub(curve[3], position);
          tangent = mul(xz(sub(curve[3], curve[2])), -1);
          axis = sub(axis, tangent);
        } else {
          offset = sub(curve[0], position);
          tangent = xz(sub(curve[1], curve[0]));
          axis = add(axis, tangent);
        }
        sum = add(sum, offset);
        count++;
        const n = normalize(tangent, true);
        if (dot2(n, n) === 0) continue;
        let angle = addN(
          mulN(f(Math.atan2(n.x, -n.z)), f(1 / (2 * Math.PI))),
          1.25,
        );
        angles.push(subN(angle, f(Math.floor(angle))));
        angle = addN(angle, 0.5);
        angles.push(subN(angle, f(Math.floor(angle))));
        lines.push({ a: xz(offset), b: n });
      }
      if (!standalone) {
        if (count > 0) {
          node.position = add(position, mul(sum, divN(1, count)));
          sum = zero();
          count = 0;
        }
        if (lines.length >= 2) {
          cs2NativeSort(lines, (a, b) => {
            const first = [a.a.x, a.a.z, a.b.x, a.b.z],
              second = [b.a.x, b.a.z, b.b.x, b.b.z];
            let value = 0;
            for (let i = 0; i < 4; i++)
              if (first[i] !== second[i])
                value +=
                  first[i] > second[i] ? [8, 4, 2, 1][i] : [-8, -4, -2, -1][i];
            return value;
          });
          for (let i = 1; i < lines.length; i++) {
            const a = lines[i];
            for (let j = 0; j < i; j++) {
              const b = lines[j],
                projection = dot2(a.b, b.b),
                absolute = Math.abs(projection);
              let pair: V;
              if (absolute > f(0.999))
                pair = { x: addN(a.a.x, b.a.x), y: addN(a.a.z, b.a.z), z: 2 };
              else {
                const dist = distance(a.a, b.a, true),
                  lo = mulN(dist, subN(absolute, 1)),
                  hi = mulN(dist, subN(1, absolute)),
                  first: [V, V] = [
                    sub(a.a, mul(a.b, lo)),
                    sub(a.a, mul(a.b, hi)),
                  ],
                  second: [V, V] = [
                    sub(b.a, mul(b.b, lo)),
                    sub(b.a, mul(b.b, hi)),
                  ],
                  t = segmentPair(...first, ...second),
                  p = add(mix(...first, t.first), mix(...second, t.second));
                pair = { x: p.x, y: p.z, z: 2 };
              }
              sum = add(sum, mul(pair, subN(1.01, absolute)));
              count++;
            }
          }
          if (count > 0) {
            node.position.x = addN(position.x, divN(sum.x, sum.z));
            node.position.z = addN(position.z, divN(sum.y, sum.z));
          }
        }
      }
      if (angles.length === 0) {
        if (ecs.has("OutsideConnection", entity)) {
          const x = Math.abs(node.position.x),
            z = Math.abs(node.position.z);
          if (x > z)
            node.rotation = cs2LookRotationSafe(
              { x: -Math.sign(node.position.x), y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            );
          else if (z > x)
            node.rotation = cs2LookRotationSafe(
              { x: 0, y: 0, z: -Math.sign(node.position.z) },
              { x: 0, y: 1, z: 0 },
            );
        }
        ecs.set("Node", entity, node);
        continue;
      }
      let angle: number;
      if (angles.length === 2) angle = addN(angles[0], 0.75);
      else {
        cs2NativeSort(angles, (a, b) => (a < b ? -1 : a > b ? 1 : 0));
        let previous = angles[angles.length - 1],
          next = angles[0],
          largest = subN(addN(next, 1), previous);
        angle = mulN(addN(previous, next), 0.5);
        for (let i = 1; i < angles.length; i++) {
          previous = angles[i - 1];
          next = angles[i];
          const gap = subN(next, previous);
          if (gap > largest) {
            largest = gap;
            angle = mulN(addN(previous, next), 0.5);
          }
        }
      }
      node.rotation = rotateY(mulN(angle, f(Math.PI * -2)));
      if (dot2(xz(rotate(node.rotation, { x: 0, y: 0, z: 1 })), axis) < 0)
        node.rotation = rotateY(subN(f(Math.PI), mulN(angle, f(Math.PI * 2))));
      ecs.set("Node", entity, node);
    }
  }
  return { status: "complete" as const, world: ecs.snapshot() };
}
