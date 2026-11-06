import {
  arcParameter,
  arcTable,
  baseCountAt,
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
  const ends: End[] = [];
  for (const road of project.roads) {
    for (const end of [0, 1] as const)
      ends.push({
        index: ends.length,
        eligible: road.lanesStart === road.lanesEnd && !road.profile,
        halfWidth:
          baseCountAt(road, end) * road.width * (road.twoWay ? 1 : 0.5),
        road,
        end,
        position: center(road, end),
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
  for (const wide of ends) {
    if (wide.neighbours.length !== 1) continue;
    const narrow = wide.neighbours[0];
    if (
      narrow.neighbours.length !== 1 ||
      wide.road.kind === "ramp" ||
      narrow.road.kind === "ramp"
    )
      continue;
    const count = baseCountAt(narrow.road, narrow.end),
      maximum = baseCountAt(wide.road, wide.end);
    if (count >= maximum || Math.abs(wide.road.width - narrow.road.width) > 0.2)
      continue;
    // An endpoint sharing a real junction must keep its full approach width.
    if (
      [...nearby(wide.position, 0.7), ...nearby(narrow.position, 0.7)].some(
        (other) =>
          other.road.id !== wide.road.id &&
          other.road.id !== narrow.road.id &&
          (dist(other.position, wide.position) < 0.7 ||
            dist(other.position, narrow.position) < 0.7),
      )
    )
      continue;
    const n = normal(wide.road, wide.end),
      delta = sub(narrow.position, wide.position),
      offset = delta.x * n.x + delta.z * n.z;
    let firstLane = 0,
      best = Infinity;
    if (!wide.road.twoWay) {
      for (let first = 0; first + count <= maximum; first++) {
        const a = lanePoint(wide.road, first, wide.end),
          b = lanePoint(wide.road, first + count - 1, wide.end);
        const distance = dist(
          mul({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }, 0.5),
          narrow.position,
        );
        if (distance < best - 1e-6) {
          best = distance;
          firstLane = first;
        }
      }
    }
    if (Math.abs(offset) > ((maximum - count) * wide.road.width) / 2 + 0.5)
      continue;
    const taper: AutomaticTaper = {
      lanes: count,
      firstLane,
      offset,
      span: 0.5,
    };
    wide.road.autoTaper ??= {};
    wide.road.autoTaper[wide.end === 0 ? "start" : "end"] = taper;
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
        (road.lanesStart - taper.lanes) * 12 + (road.speed / 3.6) * 1.2,
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
