/** Source NetUtils curve construction; original-DLL evidence: CS2_NET_GEOMETRY.md. */
import type { V } from "./types";

export type CS2RoadCurve = readonly [V, V, V, V];
export type CS2RoadLine = readonly [V, V];
const f = Math.fround;
const plus = (a: number, b: number) => f(f(a) + f(b));
const minus = (a: number, b: number) => f(f(a) - f(b));
const times = (a: number, b: number) => f(f(a) * f(b));
const divide = (a: number, b: number) => f(f(a) / f(b));
const vec = (v: V): V => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
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
const mul = (v: V, n: number): V => ({
  x: times(v.x, n),
  y: times(v.y, n),
  z: times(v.z, n),
});
const div = (v: V, n: number): V => ({
  x: divide(v.x, n),
  y: divide(v.y, n),
  z: divide(v.z, n),
});
const lerp = (a: V, b: V, t: number) => add(a, mul(sub(b, a), t));
const dotXZ = (a: V, b: V) => plus(times(a.x, b.x), times(a.z, b.z));
const lengthXZ = (v: V) => f(Math.sqrt(dotXZ(v, v)));
const distanceXZ = (a: V, b: V) => lengthXZ(sub(a, b));
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Colossal.MathUtils.Position, preserving the original float operation order. */
export function cs2RoadCurvePosition(curve: CS2RoadCurve, t: number): V {
  t = f(t);
  const u = minus(1, t),
    threeT = times(3, t);
  const weights = [
    times(times(u, u), u),
    times(times(threeT, u), u),
    times(times(threeT, t), u),
    times(times(t, t), t),
  ];
  return add(
    add(
      add(mul(curve[0], weights[0]), mul(curve[1], weights[1])),
      mul(curve[2], weights[2]),
    ),
    mul(curve[3], weights[3]),
  );
}
export function cs2RoadCurveTangent(curve: CS2RoadCurve, t: number): V {
  t = f(t);
  const u = minus(1, t),
    threeT = times(3, t);
  const weights = [
    times(times(u, minus(-1, -t)), 3),
    times(times(u, minus(1, threeT)), 3),
    times(times(t, minus(2, threeT)), 3),
    times(times(t, t), 3),
  ];
  return add(
    add(
      add(mul(curve[0], weights[0]), mul(curve[1], weights[1])),
      mul(curve[2], weights[2]),
    ),
    mul(curve[3], weights[3]),
  );
}
/** Original 16-interval MathUtils.Length, not a configurable fitting tolerance. */
export function cs2RoadCurveLength(curve: CS2RoadCurve) {
  let previous = vec(curve[0]),
    length = 0;
  for (let i = 1; i <= 16; i++) {
    const current = cs2RoadCurvePosition(curve, times(i, f(1 / 16))),
      delta = sub(current, previous);
    length = plus(
      length,
      f(
        Math.sqrt(
          plus(
            plus(times(delta.x, delta.x), times(delta.y, delta.y)),
            times(delta.z, delta.z),
          ),
        ),
      ),
    );
    previous = current;
  }
  return length;
}
export function cs2StraightRoadCurve(start: V, end: V): CS2RoadCurve {
  const a = vec(start),
    d = vec(end);
  return [a, lerp(a, d, f(1 / 3)), lerp(a, d, f(2 / 3)), d];
}
/** NetUtils.FitCurve(Line3.Segment, Line3.Segment). Both lines point inward. */
export function cs2FitRoadCurveFromLines(
  startLine: CS2RoadLine,
  endLine: CS2RoadLine,
): CS2RoadCurve {
  const a = vec(startLine[0]),
    b = vec(startLine[1]),
    d = vec(endLine[0]),
    c = vec(endLine[1]);
  let start = sub(b, a),
    end = sub(c, d),
    firstLength = lengthXZ(start),
    lastLength = lengthXZ(end);
  if (firstLength !== 0) start = div(start, firstLength);
  else {
    start.x = minus(c.x, a.x);
    start.z = minus(c.z, a.z);
    firstLength = lengthXZ(start);
    if (firstLength !== 0) start = div(start, firstLength);
  }
  if (lastLength !== 0) end = div(end, lastLength);
  else {
    end.x = minus(b.x, d.x);
    end.z = minus(b.z, d.z);
    lastLength = lengthXZ(end);
    if (lastLength !== 0) end = div(end, lastLength);
  }
  start.y = clamp(start.y, -1, 1);
  end.y = clamp(end.y, -1, 1);
  const angle = f(Math.acos(clamp(-dotXZ(start, end), 0, 1))),
    tangent = f(Math.tan(divide(angle, 2)));
  let handle = times(plus(firstLength, lastLength), f(1 / 6));
  handle =
    tangent >= f(0.0001)
      ? times(handle, divide(times(4, f(Math.tan(divide(angle, 4)))), tangent))
      : times(handle, 2);
  return [
    a,
    add(a, mul(start, Math.min(firstLength, handle))),
    add(d, mul(end, Math.min(lastLength, handle))),
    d,
  ];
}
/** NetUtils.FitCurve's four-vector overload. endTangent points along travel. */
export function cs2FitRoadCurve(
  startPosition: V,
  startTangent: V,
  endTangent: V,
  endPosition: V,
): CS2RoadCurve {
  const a = vec(startPosition),
    d = vec(endPosition),
    ta = vec(startTangent),
    td = vec(endTangent);
  const b = add(a, ta),
    c = sub(d, td),
    u = sub(b, a),
    v = sub(c, d),
    w = sub(a, d);
  const denominator = minus(times(u.x, v.z), times(u.z, v.x)),
    distance = distanceXZ(a, d);
  let x: number, y: number;
  if (denominator !== 0) {
    x = clamp(
      divide(minus(times(w.z, v.x), times(w.x, v.z)), denominator),
      times(distance, 0.01),
      distance,
    );
    y = clamp(
      divide(minus(times(w.z, u.x), times(w.x, u.z)), denominator),
      times(distance, 0.01),
      distance,
    );
  } else x = y = times(distance, 0.75);
  const dot = dotXZ(ta, td);
  if (dot > 0) {
    const amount = Math.min(1, times(dot, dot)),
      target = divide(distance, f(Math.sqrt(plus(times(2, dot), 2))));
    x = plus(x, times(minus(target, x), amount));
    y = plus(y, times(minus(target, y), amount));
  } else if (dot < 0) {
    const amount = Math.min(1, times(dot, dot)),
      target = times(distance, f(1.2071068));
    x = plus(x, times(minus(target, x), amount));
    y = plus(y, times(minus(target, y), amount));
  }
  return cs2FitRoadCurveFromLines([a, lerp(a, b, x)], [d, lerp(d, c, y)]);
}
export function cs2FitRoadCurveThrough(
  start: V,
  startTangent: V,
  middle: V,
  endTangent: V,
  end: V,
): CS2RoadCurve {
  const curve = cs2FitRoadCurve(start, startTangent, endTangent, end),
    delta = sub(vec(middle), cs2RoadCurvePosition(curve, 0.5));
  let x = dotXZ(vec(startTangent), delta),
    y = dotXZ(vec(endTangent), delta);
  const dot = dotXZ(vec(startTangent), vec(endTangent)),
    crossX = times(x, dot),
    crossY = times(y, dot);
  x = times(
    x,
    divide(
      Math.abs(x),
      Math.max(f(1e-6), times(0.375, plus(Math.abs(x), Math.abs(crossY)))),
    ),
  );
  y = times(
    y,
    divide(
      Math.abs(y),
      Math.max(f(1e-6), times(0.375, plus(Math.abs(y), Math.abs(crossX)))),
    ),
  );
  return [
    curve[0],
    add(
      curve[1],
      mul(
        vec(startTangent),
        Math.max(x, Math.min(0, minus(1, distanceXZ(curve[0], curve[1])))),
      ),
    ),
    add(
      curve[2],
      mul(
        vec(endTangent),
        Math.min(y, Math.max(0, minus(distanceXZ(curve[3], curve[2]), 1))),
      ),
    ),
    curve[3],
  ];
}
export function cs2OffsetRoadCurveLeftSmooth(
  input: CS2RoadCurve,
  offset: readonly [number, number],
): CS2RoadCurve {
  const curve = input.map(vec) as unknown as CS2RoadCurve;
  const normalize = (v: V) => {
    const square = dotXZ(v, v);
    return square > f(1.1754944e-38)
      ? mul(v, f(1 / f(Math.sqrt(square))))
      : { x: 0, y: 0, z: 0 };
  };
  const start = normalize(sub(curve[1], curve[0])),
    middleTangent = normalize(cs2RoadCurveTangent(curve, 0.5)),
    end = normalize(sub(curve[3], curve[2]));
  start.y = clamp(start.y, -1, 1);
  end.y = clamp(end.y, -1, 1);
  const move = (p: V, direction: V, amount: number): V => ({
    x: minus(p.x, times(direction.z, amount)),
    y: p.y,
    z: plus(p.z, times(direction.x, amount)),
  });
  return cs2FitRoadCurveThrough(
    move(curve[0], start, f(offset[0])),
    start,
    move(
      cs2RoadCurvePosition(curve, 0.5),
      middleTangent,
      times(plus(offset[0], offset[1]), 0.5),
    ),
    end,
    move(curve[3], end, f(offset[1])),
  );
}
/** NetToolSystem.CreateDefinitionsJob.LinearizeElevation single-curve overload. */
export function cs2LinearizeRoadElevation(curve: CS2RoadCurve): CS2RoadCurve {
  const out = curve.map(vec) as [V, V, V, V],
    dy = minus(out[3].y, out[0].y);
  out[1].y = plus(out[0].y, times(dy, f(1 / 3)));
  out[2].y = plus(out[0].y, times(dy, f(2 / 3)));
  return out;
}
