import * as T from "three";
import {
  add,
  arcParameter,
  arcTable,
  backwardLaneCount,
  boundaryPoint,
  medianWidth,
  medianExtent,
  mul,
  normal,
  smooth,
} from "../core/math";
import { roadMedianRange } from "../core/road-median";
import type { Project, Road } from "../core/types";
import type { Junction } from "../core/junctions";

/** A closed raised curb with tapered noses, following the real divider curve. */
export function renderRoadMedian(
  project: Pick<Project, "roads">,
  road: Road,
  junctions: readonly Junction[],
  group: T.Group,
  material: T.Material,
  clip?: { start: number; end: number },
) {
  const width = medianExtent(road),
    range = width && roadMedianRange(project, road, junctions);
  if (!range) return;
  const table = arcTable(road);
  if (clip) {
    const distanceAt = (t: number) => {
      const i = Math.min(table.length - 2, Math.floor(t * (table.length - 1))),
        a = table[i],
        b = table[i + 1];
      return a.s + ((b.s - a.s) * (t - a.t)) / Math.max(1e-8, b.t - a.t);
    };
    const start = distanceAt(clip.start),
      end = distanceAt(clip.end);
    if (start > range.startDistance) {
      range.startDistance = start;
      range.noseStart = true;
    }
    if (end < range.endDistance) {
      range.endDistance = end;
      range.noseEnd = true;
    }
    if (range.endDistance <= range.startDistance) return;
  }
  const span = range.endDistance - range.startDistance,
    n = Math.max(24, Math.min(256, Math.ceil(span / 2))),
    tip = Math.min(width * 1.5 + 1, span / 4),
    positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= n; i++) {
    const distance = range.startDistance + (span * i) / n,
      t = arcParameter(table, distance),
      c = boundaryPoint(road, backwardLaneCount(road), t),
      normalAt = normal(road, t);
    const weight = Math.min(
        range.noseStart ? smooth((distance - range.startDistance) / tip) : 1,
        range.noseEnd ? smooth((range.endDistance - distance) / tip) : 1,
      ),
      actualWidth = medianWidth(road, t),
      half = (actualWidth * weight) / 2,
      topHalf = Math.max(0, half - 0.12 * weight),
      height = 0.28 * weight * Math.min(1, actualWidth / 0.5);
    for (const [offset, y] of [
      [-half, 0.03],
      [half, 0.03],
      [-topHalf, height + 0.03],
      [topHalf, height + 0.03],
    ]) {
      const p = add(c, mul(normalAt, offset));
      positions.push(p.x, p.y + y, p.z);
    }
    if (i < n) {
      const j = i * 4;
      indices.push(
        j + 2,
        j + 6,
        j + 3,
        j + 3,
        j + 6,
        j + 7,
        j,
        j + 4,
        j + 2,
        j + 2,
        j + 4,
        j + 6,
        j + 1,
        j + 3,
        j + 5,
        j + 3,
        j + 7,
        j + 5,
      );
    }
  }
  const last = n * 4;
  indices.push(
    0,
    2,
    1,
    1,
    2,
    3,
    last,
    last + 1,
    last + 2,
    last + 1,
    last + 3,
    last + 2,
  );
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new T.Mesh(geometry, material);
  mesh.userData = { road: road.id, median: road.id };
  group.add(mesh);
}
