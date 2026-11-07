import {
  backwardStart,
  backwardEnd,
  laneCount,
  nearest,
  center,
  normal,
} from "./math";
import type { Project, Road, V } from "./types";

export type RoadSide = "left" | "right";
export function roadSideAt(road: Road, position: V): RoadSide {
  const { t } = nearest(road, position),
    c = center(road, t),
    n = normal(road, t);
  return (position.x - c.x) * n.x + (position.z - c.z) * n.z < 0
    ? "left"
    : "right";
}
export function expandedRoad(road: Road, side: RoadSide, count = 1): Road {
  if (!Number.isInteger(count) || count < 1 || count > 6)
    throw new Error("请选择1–6条车道。");
  if (
    road.profile ||
    road.lanesStart !== road.lanesEnd ||
    backwardStart(road) !== backwardEnd(road)
  )
    throw new Error("渐变道路请先升级为等宽道路，再添加车道。");
  const r = structuredClone(road);
  if (r.twoWay && side === "left") {
    const n = backwardStart(r) + count;
    if (n > 6) throw new Error("每个方向最多6条车道。");
    r.backwardLanesStart = r.backwardLanesEnd = n;
  } else {
    // Capture reverse counts before changing the legacy symmetric defaults.
    if (r.twoWay) {
      r.backwardLanesStart = backwardStart(r);
      r.backwardLanesEnd = backwardEnd(r);
    }
    if (r.lanesStart + count > 6) throw new Error("每个方向最多6条车道。");
    r.lanesStart += count;
    r.lanesEnd += count;
    if (!r.twoWay)
      r.sectionOffset =
        (r.sectionOffset ?? 0) +
        ((side === "left" ? -1 : 1) * count * r.width) / 2;
  }
  if (r.widthOrigin !== undefined) r.widthOrigin += count;
  r.transitionMode = "direct";
  delete r.autoTaper;
  r.name = r.twoWay
    ? `双向 ${backwardStart(r)}＋${r.lanesStart} 车道`
    : `单向 ${r.lanesStart} 车道`;
  return r;
}
/** Keep all existing lane identities, including other roads' attachments and saved rules. */
export function addRoadsideLanes(
  project: Project,
  id: string,
  side: RoadSide,
  count = 1,
) {
  const index = project.roads.findIndex((r) => r.id === id);
  if (index < 0) throw new Error("道路已不存在。");
  const old = project.roads[index],
    next = expandedRoad(old, side, count);
  const shift = side === "left" ? count : 0;
  const remap = (ref: { road: string; lane: number }) => {
    if (ref.road === id) ref.lane += shift;
  };
  if (shift) {
    if (next.turns)
      next.turns = Object.fromEntries(
        Object.entries(next.turns).map(([lane, turns]) => [
          Number(lane) + shift,
          turns,
        ]),
      );
    for (const attachment of Object.values(next.attachments ?? {}))
      if (attachment)
        attachment.ownLanes = attachment.ownLanes.map((l) => l + shift);
    for (const road of project.roads)
      if (road.id !== id)
        for (const a of Object.values(road.attachments ?? {}))
          if (a?.road === id) a.lanes = a.lanes.map((l) => l + shift);
    for (const rule of project.junctionLaneConnections ?? []) {
      remap(rule.from);
      rule.to.forEach(remap);
    }
    for (const link of project.connections) {
      remap(link.from);
      remap(link.to);
    }
  }
  project.roads[index] = next;
  return {
    road: next,
    added: Array.from({ length: count }, (_, i) =>
      side === "left" ? i : laneCount(next) - count + i,
    ),
  };
}
