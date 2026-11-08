import {
  arcParameter,
  arcTable,
  backwardLaneCount,
  boundaryPoint,
  dist,
  laneCount,
  laneDirection,
  laneEntryT,
  laneExitT,
  lanePoint,
  laneWidth,
  normal,
  sub,
} from "./math";
import type { Junction } from "./junctions";
import { buildLaneJunctions, type LaneJunction } from "./lane-junctions";
import { isNodeSmooth } from "./road-visual-settings";
import type { Connection, Project, Road, V } from "./types";

export type MarkingRange = { start: number; end: number };
export type SeparatorEnd = {
  end: 0 | 1;
  span: number;
  /** Only a physically coincident, exclusive ordered partition continues. */
  continuous: boolean;
};
export type TransitionMarkings = Record<number, SeparatorEnd[]>;
type Port = { road: Road; lane: number; end: 0 | 1 };
const key = (port: Port) => `${port.road.id}:${port.end}:${port.lane}`;
const endKey = (road: string, end: number) => `${road}:${end}`;
const dot = (a: V, b: V) => a.x * b.x + a.z * b.z;

/**
 * Paint consumes the final routing relation, including authored/closed lanes.
 * Only adjacent, exclusive and laterally ordered pairs admit a separator.
 * Splits, merges, crossing links and missing active lanes leave the affected
 * collar unmarked: a route guide is not a physical lane boundary.
 * Neither this function nor the sampler changes a road's transition setting.
 */
export function transitionMarkings(
  project: Pick<Project, "roads" | "junctionLaneConnections" | "roadVisuals">,
  connections: readonly Connection[],
  junctions: readonly Junction[] = [],
  nodes: readonly LaneJunction[] = buildLaneJunctions(project),
): Map<string, TransitionMarkings> {
  const roads = new Map(project.roads.map((road) => [road.id, road])),
    incidence = new Map<string, Port[]>(),
    smoothEnds = new Set(
      nodes
        .filter((node) => isNodeSmooth(project, node))
        .flatMap((node) => node.arms.map((arm) => endKey(arm.road, arm.end))),
    ),
    physical = new Set(
      junctions.flatMap((j) => j.arms.map((a) => endKey(a.road, a.end))),
    );
  const insert = (a: Port, b: Port) => {
    const list = incidence.get(key(a)) ?? [];
    if (!list.some((other) => key(other) === key(b))) list.push(b);
    incidence.set(key(a), list);
  };
  for (const connection of connections) {
    if (!connection.enabled) continue;
    const a = roads.get(connection.from.road),
      b = roads.get(connection.to.road),
      al = connection.from.lane,
      bl = connection.to.lane;
    if (
      !a ||
      !b ||
      a.id === b.id ||
      !Number.isInteger(al) ||
      !Number.isInteger(bl) ||
      al < 0 ||
      al >= laneCount(a) ||
      bl < 0 ||
      bl >= laneCount(b)
    )
      continue;
    const from: Port = { road: a, lane: al, end: laneExitT(a, al) as 0 | 1 },
      to: Port = { road: b, lane: bl, end: laneEntryT(b, bl) as 0 | 1 };
    if (
      laneWidth(a, al, from.end) < a.width * 0.7 ||
      laneWidth(b, bl, to.end) < b.width * 0.7 ||
      Math.abs(lanePoint(a, al, from.end).y - lanePoint(b, bl, to.end).y) > 0.5
    )
      continue;
    insert(from, to);
    insert(to, from);
  }
  const result = new Map<string, TransitionMarkings>();
  for (const road of project.roads) {
    const boundaries: TransitionMarkings = {};
    for (const end of [0, 1] as const) {
      if (
        !smoothEnds.has(endKey(road.id, end)) ||
        physical.has(endKey(road.id, end))
      )
        continue;
      const table = arcTable(road),
        length = table.at(-1)!.s,
        span = Math.min(
          0.42,
          end === 0
            ? arcParameter(table, Math.min(24, length * 0.42))
            : 1 - arcParameter(table, length - Math.min(24, length * 0.42)),
        );
      for (let index = 1; index < laneCount(road); index++) {
        if (road.twoWay && index === backwardLaneCount(road)) continue;
        // A physically vanishing lane has no port. Its normal taper boundary
        // ends at the width threshold rather than inventing a destination.
        if (
          [index - 1, index].some(
            (lane) => laneWidth(road, lane, end) < road.width * 0.7,
          )
        )
          continue;
        const a: Port = { road, lane: index - 1, end },
          b: Port = { road, lane: index, end },
          aa = incidence.get(key(a)) ?? [],
          bb = incidence.get(key(b)) ?? [];
        let continuous = false;
        if (
          aa.length === 1 &&
          bb.length === 1 &&
          aa[0].road.id === bb[0].road.id &&
          aa[0].end === bb[0].end &&
          Math.abs(aa[0].lane - bb[0].lane) === 1 &&
          laneDirection(aa[0].road, aa[0].lane) ===
            laneDirection(bb[0].road, bb[0].lane) &&
          incidence.get(key(aa[0]))?.length === 1 &&
          incidence.get(key(bb[0]))?.length === 1
        ) {
          const other = aa[0].road,
            at = aa[0].end,
            n = normal(road, end),
            left = lanePoint(other, aa[0].lane, at),
            right = lanePoint(other, bb[0].lane, at),
            target = boundaryPoint(other, Math.max(aa[0].lane, bb[0].lane), at),
            own = boundaryPoint(road, index, end);
          // Every other live link must stay on its side of this partition.
          // Checking the whole incidence also catches a remote lane crossing it.
          const ordered =
            dot(sub(right, left), n) > 0.1 &&
            Array.from({ length: laneCount(road) }, (_, lane) => lane)
              .filter(
                (lane) =>
                  laneDirection(road, lane) === laneDirection(road, index),
              )
              .every((lane) =>
                (incidence.get(key({ road, lane, end })) ?? []).every(
                  (port) =>
                    port.road.id === other.id &&
                    port.end === at &&
                    dot(
                      sub(lanePoint(port.road, port.lane, port.end), target),
                      n,
                    ) *
                      (lane < index ? -1 : 1) >
                      0.05,
                ),
              );
          if (ordered) {
            // Editing insets do not create a physical connector span. Never
            // move paint away from the road's actual lanePoint trajectories.
            // A shifted route with no coincident separator must stay unmarked.
            continuous =
              dist(own, target) < 0.1 &&
              dist(lanePoint(road, index - 1, end), left) < 0.1 &&
              dist(lanePoint(road, index, end), right) < 0.1;
          }
        }
        (boundaries[index] ??= []).push({
          end,
          span,
          continuous,
        });
      }
    }
    if (Object.keys(boundaries).length) result.set(road.id, boundaries);
  }
  return result;
}

/** Boundary paths retain metre distances; renderers must not normalize dashes. */
export function separatorPaths(
  road: Road,
  index: number,
  range: MarkingRange = { start: 0, end: 1 },
  markings: TransitionMarkings = {},
): V[][] {
  const paths: V[][] = [],
    table = arcTable(road),
    length = table.at(-1)!.s,
    count = Math.min(4096, Math.max(100, Math.ceil(length / 1.5))),
    ts = new Set(
      Array.from(
        { length: count + 1 },
        (_, i) => range.start + ((range.end - range.start) * i) / count,
      ),
    );
  // Include collar boundaries exactly so a closed lane does not leave a sliver.
  for (const collar of markings[index] ?? []) {
    const t = collar.end === 0 ? collar.span : 1 - collar.span;
    if (t >= range.start && t <= range.end) ts.add(t);
  }
  let path: V[] = [];
  const flush = () => {
    if (path.length > 1) paths.push(path);
    path = [];
  };
  for (const t of [...ts].sort((a, b) => a - b)) {
    let visible =
      laneWidth(road, index - 1, t) >= 0.15 &&
      laneWidth(road, index, t) >= 0.15;
    for (const collar of markings[index] ?? []) {
      const distance = collar.end === 0 ? t : 1 - t;
      if (distance >= collar.span - 1e-9) continue;
      if (!collar.continuous) visible = false;
    }
    if (!visible) {
      flush();
      continue;
    }
    path.push(boundaryPoint(road, index, t));
  }
  flush();
  return paths;
}
