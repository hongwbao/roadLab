import type { V } from "./types";
import {
  cs2RoadCurvePosition,
  cs2RoadCurveTangent,
  type CS2RoadCurve,
} from "./cs2-net-geometry";
const f = Math.fround;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) =>
  f(f(a) + f(f(t) * f(f(b) - f(a))));
const plus = (a: number, b: number) => f(f(a) + f(b));
const minus = (a: number, b: number) => f(f(a) - f(b));
const times = (a: number, b: number) => f(f(a) * f(b));
const subtract = (a: V, b: V): V => ({
  x: minus(a.x, b.x),
  y: minus(a.y, b.y),
  z: minus(a.z, b.z),
});
const scaled = (v: V, n: number): V => ({
  x: times(v.x, n),
  y: times(v.y, n),
  z: times(v.z, n),
});
const dot = (a: V, b: V) =>
  plus(plus(times(a.x, b.x), times(a.y, b.y)), times(a.z, b.z));
const distance = (a: V, b: V) => {
  const d = subtract(a, b);
  return f(Math.sqrt(dot(d, d)));
};
/** Full NetUtils.CalculateCurviness with original point/tangent float ordering. */
export function cs2RoadCurveCurviness(
  points: CS2RoadCurve,
  length: number,
  width: number,
) {
  length = f(length);
  width = f(width);
  if (!(length > f(0.1))) return 0;
  const unit = (v: V) => {
    const squared = dot(v, v);
    return squared > f(1.1754944e-38)
      ? scaled(v, f(1 / f(Math.sqrt(squared))))
      : undefined;
  };
  const part = (a: V, ta: V, b: V, tb: V) => {
    const span = distance(a, b),
      ua = unit(ta),
      ub = unit(tb);
    if (!ua || !ub || span < f(1e-6)) return 0;
    const angle = f(Math.acos(Math.max(-1, Math.min(1, dot(ua, ub)))));
    return f(times(2, f(Math.sin(times(angle, 0.5)))) / span);
  };
  const positions = [
    points[0],
    cs2RoadCurvePosition(points, 0.25),
    cs2RoadCurvePosition(points, 0.5),
    cs2RoadCurvePosition(points, 0.75),
    points[3],
  ];
  const tangents = [
    subtract(points[1], points[0]),
    cs2RoadCurveTangent(points, 0.25),
    cs2RoadCurveTangent(points, 0.5),
    cs2RoadCurveTangent(points, 0.75),
    subtract(points[3], points[2]),
  ];
  let maximum = 0;
  for (let i = 0; i < 4; i++)
    maximum = Math.max(
      maximum,
      part(positions[i], tangents[i], positions[i + 1], tangents[i + 1]),
    );
  if (length < times(width, 2)) {
    const lo = times(width, 0.1),
      hi = times(width, 2),
      t = clamp01(f(minus(length, lo) / minus(hi, lo)));
    const smooth = times(times(t, t), minus(3, times(2, t)));
    maximum = lerp(
      Math.min(
        maximum,
        part(positions[0], tangents[0], positions[4], tangents[4]),
      ),
      maximum,
      smooth,
    );
  }
  return maximum;
}
