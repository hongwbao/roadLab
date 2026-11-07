import {
  arcParameter,
  arcTable,
  baseCountAt,
  baseBackwardCountAt,
  backwardStart,
  backwardEnd,
  backwardLaneCount,
  boundaryPoint,
  medianWidth,
  pavementWidth,
  nodePoint,
  center,
  dist,
  lanePoint,
  mul,
  normal,
  sub,
  tangent,
} from "./math";
import type { AutomaticTaper, Project, Road, V } from "./types";

type End = {
  index: number;
  eligible: boolean;
  halfWidth: number;
  road: Road;
  end: 0 | 1;
  position: V;
  direction: V;
  neighbours: End[];
};
export function automaticTransitionPreview(project: Project, incoming: Road[]) {
  const preview = {
    ...project,
    roads: structuredClone([...project.roads, ...incoming]),
  };
  updateAutomaticTransitions(preview);
  const previous = new Map(project.roads.map((road) => [road.id, road]));
  const roads = preview.roads.filter(
    (road) =>
      !previous.has(road.id) ||
      JSON.stringify(road.autoTaper) !==
        JSON.stringify(previous.get(road.id)!.autoTaper),
  );
  return {
    roads,
    replaces: roads
      .filter((road) => previous.has(road.id))
      .map((road) => road.id),
    hasTransitions: roads.some((road) => !!road.autoTaper),
  };
}
/** Derived collars live on the wider road; nominal assets and spline controls stay intact. */
export function updateAutomaticTransitions(project: Project) {
  for (const road of project.roads) delete road.autoTaper;
  if (!project.roads.some((r) => r.transitionMode === "smooth")) return;
  const ends: End[] = [];
  for (const road of project.roads) {
    for (const end of [0, 1] as const)
      ends.push({
        index: ends.length,
        eligible:
          road.lanesStart === road.lanesEnd &&
          backwardStart(road) === backwardEnd(road) &&
          !road.profile,
        halfWidth: pavementWidth(road, end) / 2,
        road,
        end,
        position: nodePoint(road, end),
        direction: tangent(road, end),
        neighbours: [],
      });
  }
  const cells = new Map<string, End[]>(),
    cellSize = 32;
  for (const end of ends) {
    const key = `${Math.floor(end.position.x / cellSize)}:${Math.floor(end.position.z / cellSize)}`;
    const cell = cells.get(key) ?? [];
    cell.push(end);
    cells.set(key, cell);
  }
  const nearby = (position: V, radius: number) => {
    const result: End[] = [];
    for (
      let x = Math.floor((position.x - radius) / cellSize);
      x <= Math.floor((position.x + radius) / cellSize);
      x++
    )
      for (
        let z = Math.floor((position.z - radius) / cellSize);
        z <= Math.floor((position.z + radius) / cellSize);
        z++
      )
        result.push(...(cells.get(`${x}:${z}`) ?? []));
    return result;
  };
  const maximumHalfWidth = Math.max(0, ...ends.map((end) => end.halfWidth));
  for (const a of ends) {
    if (!a.eligible) continue;
    for (const b of nearby(a.position, a.halfWidth + maximumHalfWidth + 1)) {
      if (b.index <= a.index || !b.eligible) continue;
      if (
        a.road.id === b.road.id ||
        a.road.twoWay !== b.road.twoWay ||
        Math.abs(a.position.y - b.position.y) > 0.5
      )
        continue;
      if (!a.road.twoWay && a.end === b.end) continue;
      const sign = a.end === b.end ? -1 : 1;
      if (
        (a.direction.x * b.direction.x + a.direction.z * b.direction.z) * sign <
        0.94
      )
        continue;
      const delta = sub(b.position, a.position),
        n = normal(a.road, a.end);
      if (Math.abs(delta.x * a.direction.x + delta.z * a.direction.z) > 0.65)
        continue;
      const lateral = Math.abs(delta.x * n.x + delta.z * n.z);
      const halfA = a.halfWidth,
        halfB = b.halfWidth;
      if (
        lateral >=
        halfA + halfB - Math.min(a.road.width, b.road.width) * 0.45
      )
        continue;
      a.neighbours.push(b);
      b.neighbours.push(a);
    }
  }
  const reference = (end: End) =>
    end.road.twoWay
      ? boundaryPoint(end.road, backwardLaneCount(end.road), end.end)
      : center(end.road, end.end);
  const apply = (
    wide: End,
    count: number,
    back: number,
    divider: number,
    target: V,
  ) => {
    const maximum = baseCountAt(wide.road, wide.end),
      wideBack = baseBackwardCountAt(wide.road, wide.end),
      n = normal(wide.road, wide.end),
      own = reference(wide),
      delta = sub(target, own),
      offset = delta.x * n.x + delta.z * n.z;
    if (
      count === maximum &&
      back === wideBack &&
      Math.abs(divider - medianWidth(wide.road)) < 0.01 &&
      Math.abs(offset) < 0.01
    )
      return;
    let firstLane = 0,
      best = Infinity;
    if (!wide.road.twoWay)
      for (let first = 0; first + count <= maximum; first++) {
        const a = lanePoint(wide.road, first, wide.end),
          b = lanePoint(wide.road, first + count - 1, wide.end),
          distance = dist(
            mul({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }, 0.5),
            target,
          );
        if (distance < best - 1e-6) {
          best = distance;
          firstLane = first;
        }
      }
    const taper: AutomaticTaper = {
      lanes: count,
      ...(wide.road.twoWay ? { backwardLanes: back } : {}),
      ...(wide.road.twoWay && Math.abs(divider - medianWidth(wide.road)) > 0.01
        ? { medianWidth: divider }
        : {}),
      firstLane,
      offset,
      span: 0.5,
    };
    wide.road.autoTaper ??= {};
    wide.road.autoTaper[wide.end === 0 ? "start" : "end"] = taper;
  };
  for (const a of ends) {
    if (a.neighbours.length !== 1) continue;
    const b = a.neighbours[0];
    if (
      b.index <= a.index ||
      b.neighbours.length !== 1 ||
      (a.road.transitionMode !== "smooth" &&
        b.road.transitionMode !== "smooth") ||
      Math.abs(a.road.width - b.road.width) > 0.2
    )
      continue;
    // A real multi-arm junction keeps its full approach sections.
    if (
      [...nearby(a.position, 0.7), ...nearby(b.position, 0.7)].some(
        (other) =>
          other.road.id !== a.road.id &&
          other.road.id !== b.road.id &&
          (dist(other.position, a.position) < 0.7 ||
            dist(other.position, b.position) < 0.7),
      )
    )
      continue;
    const af = baseCountAt(a.road, a.end),
      ab = baseBackwardCountAt(a.road, a.end),
      bf0 = baseCountAt(b.road, b.end),
      bb0 = baseBackwardCountAt(b.road, b.end),
      reversed = a.road.twoWay && a.end === b.end,
      bf = reversed ? bb0 : bf0,
      bb = reversed ? bf0 : bb0,
      am = medianWidth(a.road),
      bm = medianWidth(b.road),
      aContains = af >= bf && ab >= bb,
      bContains = bf >= af && bb >= ab;
    if (!aContains && !bContains) {
      // E.g.2+3 ->3+2: both collars meet at the common2+2 section.
      const ar = reference(a),
        br = reference(b),
        target = mul({ x: ar.x + br.x, y: ar.y + br.y, z: ar.z + br.z }, 0.5),
        f = Math.min(af, bf),
        back = Math.min(ab, bb),
        m = Math.min(am, bm);
      apply(a, f, back, m, target);
      apply(b, reversed ? back : f, reversed ? f : back, m, target);
    } else {
      let chooseA = aContains && !bContains;
      if (aContains && bContains) {
        chooseA =
          Math.abs(am - bm) > 0.01
            ? am > bm
            : a.road.transitionMode !== b.road.transitionMode
              ? a.road.transitionMode === "smooth"
              : a.road.id < b.road.id;
      }
      if (chooseA) apply(a, bf, bb, bm, reference(b));
      else apply(b, reversed ? ab : af, reversed ? af : ab, am, reference(a));
    }
  }
  for (const road of project.roads) {
    if (!road.autoTaper) continue;
    const table = arcTable(road),
      length = table.at(-1)!.s;
    const both = !!road.autoTaper.start && !!road.autoTaper.end;
    for (const end of ["start", "end"] as const) {
      const taper = road.autoTaper[end];
      if (!taper) continue;
      const desired = Math.max(
        24,
        Math.max(
          road.lanesStart - taper.lanes,
          backwardStart(road) - (taper.backwardLanes ?? 0),
        ) *
          12 +
          (road.speed / 3.6) * 1.2,
        (Math.abs(taper.offset) +
          Math.abs(
            (taper.medianWidth ?? medianWidth(road)) - medianWidth(road),
          ) /
            2) *
          12 +
          (road.speed / 3.6) * 1.2,
      );
      const available = Math.min(desired, length * (both ? 0.42 : 0.8));
      taper.span = Math.max(
        0.001,
        end === "start"
          ? arcParameter(table, available)
          : 1 - arcParameter(table, length - available),
      );
    }
  }
}
