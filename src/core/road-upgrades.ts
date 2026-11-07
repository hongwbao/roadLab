import { backwardStart, backwardEnd, laneCount } from "./math";
import { setRoadMedian } from "./road-median";
import type { RoadSide } from "./road-sections";
import type { Project, Road, RoadSection } from "./types";

export const roadSectionKeys = [
  "name",
  "lanesStart",
  "lanesEnd",
  "backwardLanesStart",
  "backwardLanesEnd",
  "sectionOffset",
  "transitionMode",
  "median",
  "twoWay",
  "width",
  "speed",
  "align",
  "kind",
  "highwayRules",
  "transitionStart",
  "transitionEnd",
  "profile",
  "widthOrigin",
] as const;
const section = (road: Road): RoadSection =>
  structuredClone(
    Object.fromEntries(
      roadSectionKeys
        .filter((key) => road[key] !== undefined)
        .map((key) => [key, road[key]]),
    ),
  ) as RoadSection;

export function replaceRoadSection(
  project: Project,
  id: string,
  options: Partial<Road>,
  name: string,
) {
  const road = project.roads.find((r) => r.id === id);
  if (!road) throw new Error("道路已不存在。");
  const before = section(road),
    next = { ...road, ...options, name, transitionMode: "direct" as const };
  delete next.backwardLanesStart;
  delete next.backwardLanesEnd;
  delete next.sectionOffset;
  Object.assign(next, options);
  delete next.profile;
  delete next.widthOrigin;
  delete next.autoTaper;
  if (!next.twoWay) delete next.median;
  if (JSON.stringify(before) === JSON.stringify(section(next))) return;
  next.replacedSection = before;
  Object.assign(road, next);
  // Object.assign cannot remove optional section properties from the old road.
  for (const key of roadSectionKeys)
    if (next[key] === undefined) delete road[key];
  delete road.autoTaper;
}

export function removeRoadsideLanes(
  project: Project,
  id: string,
  side: RoadSide,
  count = 1,
) {
  const road = project.roads.find((r) => r.id === id);
  if (!road) throw new Error("道路已不存在。");
  if (!Number.isInteger(count) || count < 1 || count > 6)
    throw new Error("请选择1–6条车道。");
  if (
    road.profile ||
    road.lanesStart !== road.lanesEnd ||
    backwardStart(road) !== backwardEnd(road)
  )
    throw new Error("渐变道路请先替换为等宽道路，再减少车道。");
  const reverse = road.twoWay && side === "left";
  if ((reverse ? backwardStart(road) : road.lanesStart) - count < 1)
    throw new Error("每个方向至少保留1条车道。");
  const total = laneCount(road),
    left = side === "left";
  const map = (lane: number) =>
    left
      ? lane < count
        ? null
        : lane - count
      : lane >= total - count
        ? null
        : lane;
  if (reverse)
    road.backwardLanesStart = road.backwardLanesEnd =
      backwardStart(road) - count;
  else {
    if (road.twoWay) {
      road.backwardLanesStart = backwardStart(road);
      road.backwardLanesEnd = backwardEnd(road);
    } else
      road.sectionOffset =
        (road.sectionOffset ?? 0) - ((left ? -1 : 1) * count * road.width) / 2;
    road.lanesStart -= count;
    road.lanesEnd -= count;
  }
  if (road.widthOrigin !== undefined) road.widthOrigin -= count;
  road.transitionMode = "direct";
  delete road.autoTaper;
  if (road.turns)
    road.turns = Object.fromEntries(
      Object.entries(road.turns).flatMap(([lane, turns]) => {
        const next = map(Number(lane));
        return next === null ? [] : [[next, turns]];
      }),
    );
  for (const owner of project.roads)
    for (const [end, attachment] of Object.entries(owner.attachments ?? {})) {
      if (!attachment) continue;
      const pairs = attachment.lanes
        .map((lane, index) => [
          attachment.road === id ? map(lane) : lane,
          owner.id === id
            ? map(attachment.ownLanes[index])
            : attachment.ownLanes[index],
        ])
        .filter((pair): pair is number[] =>
          pair.every((lane) => lane !== null),
        );
      if (!pairs.length) delete owner.attachments![end as "start" | "end"];
      else {
        attachment.lanes = pairs.map(([lane]) => lane);
        attachment.ownLanes = pairs.map(([, own]) => own);
      }
    }
  const remap = (ref: { road: string; lane: number }) => {
    if (ref.road !== id) return true;
    const lane = map(ref.lane);
    if (lane === null) return false;
    ref.lane = lane;
    return true;
  };
  project.connections = project.connections.filter(
    (link) => remap(link.from) && remap(link.to),
  );
  if (project.junctionLaneConnections)
    project.junctionLaneConnections = project.junctionLaneConnections.filter(
      (rule) => {
        if (!remap(rule.from)) return false;
        rule.to = rule.to.filter(remap);
        return true;
      },
    );
  road.name = road.twoWay
    ? `双向 ${backwardStart(road)}＋${road.lanesStart} 车道`
    : `单向 ${road.lanesStart} 车道`;
}

export type RoadUpgradeMode =
  "replace" | "widen" | "median" | "smooth" | "direct";
export function revertRoadUpgrade(
  project: Project,
  id: string,
  mode: RoadUpgradeMode,
  side: RoadSide = "right",
  count = 1,
) {
  const road = project.roads.find((r) => r.id === id);
  if (!road) throw new Error("道路已不存在。");
  if (mode === "median") setRoadMedian(project, id, null);
  else if (mode === "widen") removeRoadsideLanes(project, id, side, count);
  else if (mode === "smooth" || mode === "direct") {
    road.transitionMode = mode === "smooth" ? "direct" : "smooth";
    delete road.autoTaper;
  } else {
    if (!road.replacedSection)
      throw new Error("此路段没有可恢复的道路替换记录。");
    const before = structuredClone(road.replacedSection);
    for (const key of roadSectionKeys) delete road[key];
    Object.assign(road, before);
    delete road.replacedSection;
    delete road.autoTaper;
  }
}
