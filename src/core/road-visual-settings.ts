import { buildLaneJunctions, isLaneJunctionEditable } from "./lane-junctions";
import { logicalRoadSignature } from "./math";
import type { Project, Road, RoadVisualArm, RoadVisualSettings } from "./types";

export { logicalRoadSignature } from "./math";

type VisualProject = { roadVisuals?: RoadVisualSettings };
type VisualNode = { arms: readonly RoadVisualArm[] };
type VisualRoads = VisualProject & { roads: Road[] };

const armKey = (arm: RoadVisualArm) => JSON.stringify([arm.road, arm.end]);
const copyArm = ({ road, end }: RoadVisualArm): RoadVisualArm => ({
  road,
  end,
});
const compareArms = (a: RoadVisualArm, b: RoadVisualArm) =>
  a.road < b.road ? -1 : a.road > b.road ? 1 : a.end - b.end;
function orderedArms(arms: readonly RoadVisualArm[]): RoadVisualArm[] {
  return [
    ...new Map(arms.map((arm) => [armKey(arm), copyArm(arm)])).values(),
  ].sort(compareArms);
}
const isConnectedNode = (arms: readonly RoadVisualArm[]) =>
  new Set(arms.map((arm) => arm.road)).size >= 2;

/** Identity follows the complete arm set, independently of display coordinates. */
export function nodeVisualKey(node: VisualNode): string {
  return JSON.stringify(
    orderedArms(node.arms).map((arm) => [arm.road, arm.end]),
  );
}

/** A query never migrates legacy flags or creates a settings object. */
export function isNodeSmooth(
  project: VisualProject,
  node: VisualNode,
): boolean {
  const key = nodeVisualKey(node);
  return (
    project.roadVisuals?.nodes.some(
      (entry) => entry.smooth === true && nodeVisualKey(entry) === key,
    ) ?? false
  );
}

/** Only visual metadata changes. An empty settings object retains the migration marker. */
export function setNodeSmooth(
  project: VisualProject,
  node: VisualNode,
  enabled: boolean,
): boolean {
  const arms = orderedArms(node.arms);
  if (!isConnectedNode(arms)) return false;
  const key = nodeVisualKey({ arms }),
    settings = project.roadVisuals,
    index =
      settings?.nodes.findIndex((entry) => nodeVisualKey(entry) === key) ?? -1;
  if (enabled) {
    if (index >= 0 && settings!.nodes[index].smooth === true) return false;
    project.roadVisuals ??= { version: 1, nodes: [] };
    if (index >= 0) project.roadVisuals.nodes[index] = { arms, smooth: true };
    else project.roadVisuals.nodes.push({ arms, smooth: true });
    return true;
  }
  if (index < 0) return false;
  settings!.nodes = settings!.nodes.filter(
    (entry) => nodeVisualKey(entry) !== key,
  );
  return true;
}

function logicalVisualNodes(project: VisualRoads) {
  // Old decoration caches never participate in migration or structural upkeep.
  return buildLaneJunctions({
    roads: project.roads.map((road) => ({
      ...road,
      transitionMode: "direct" as const,
      autoTaper: undefined,
    })),
  }).filter(isLaneJunctionEditable);
}

function reconcileVisualNodes(project: VisualRoads) {
  const settings = project.roadVisuals!;
  const current = logicalVisualNodes(project),
    incidence = new Map<string, number[]>();
  current.forEach((node, index) => {
    for (const arm of orderedArms(node.arms)) {
      const key = armKey(arm),
        indices = incidence.get(key) ?? [];
      indices.push(index);
      incidence.set(key, indices);
    }
  });
  const seen = new Set<string>(),
    nodes: RoadVisualSettings["nodes"] = [];
  for (const previous of settings.nodes) {
    const matches = new Map<number, number>();
    for (const arm of orderedArms(previous.arms))
      for (const index of incidence.get(armKey(arm)) ?? [])
        matches.set(index, (matches.get(index) ?? 0) + 1);
    for (const [index, count] of matches) {
      if (count < 2) continue;
      const node = current[index],
        key = nodeVisualKey(node);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({ arms: orderedArms(node.arms), smooth: true });
    }
  }
  if (JSON.stringify(nodes) !== JSON.stringify(settings.nodes))
    settings.nodes = nodes;
}

function initializeVisualRoads(project: VisualRoads) {
  if (project.roadVisuals === undefined) {
    const requested = new Set(
      project.roads
        .filter(
          (road) =>
            road.transitionMode === "smooth" ||
            (road.transitionMode === undefined && !!road.autoTaper),
        )
        .map((road) => road.id),
    );
    if (requested.size) {
      project.roadVisuals = {
        version: 1,
        nodes: logicalVisualNodes(project)
          .filter((node) => node.arms.some((arm) => requested.has(arm.road)))
          .map((node) => ({ arms: orderedArms(node.arms), smooth: true })),
      };
    }
  } else if (project.roadVisuals.nodes.length) reconcileVisualNodes(project);
  for (const road of project.roads) {
    road.transitionMode = "direct";
    delete road.autoTaper;
    if (road.replacedSection) road.replacedSection.transitionMode = "direct";
  }
}

/** Migration and structural upkeep, including each blueprint; never a display query. */
export function initializeRoadVisuals(project: Project): void {
  initializeVisualRoads(project);
  for (const template of project.templates) initializeVisualRoads(template);
}

function validateVisualRoads(project: VisualRoads) {
  const settings = project.roadVisuals;
  if (settings === undefined) return;
  if (
    !settings ||
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    settings.version !== 1 ||
    !Array.isArray(settings.nodes) ||
    settings.nodes.length > 2000
  )
    throw new Error("节点显示配置格式不正确。");
  const roads = new Set(project.roads.map((road) => road.id)),
    nodes = new Set<string>(),
    usedArms = new Set<string>();
  for (const node of settings.nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      node.smooth !== true ||
      !Array.isArray(node.arms) ||
      node.arms.length < 2 ||
      node.arms.length > 2000
    )
      throw new Error("节点显示目标格式不正确。");
    const arms = new Set<string>();
    for (const arm of node.arms) {
      if (
        !arm ||
        typeof arm !== "object" ||
        Array.isArray(arm) ||
        typeof arm.road !== "string" ||
        !roads.has(arm.road) ||
        (arm.end !== 0 && arm.end !== 1)
      )
        throw new Error("节点显示目标的道路端点引用不合法。");
      const key = armKey(arm);
      if (arms.has(key)) throw new Error("节点显示目标不能重复引用道路端点。");
      arms.add(key);
    }
    if (!isConnectedNode(node.arms))
      throw new Error("节点显示目标须连接至少两条道路。");
    const key = nodeVisualKey(node);
    if (nodes.has(key)) throw new Error("同一节点不能重复配置显示效果。");
    nodes.add(key);
    for (const arm of arms) {
      if (usedArms.has(arm))
        throw new Error("同一道路端点不能属于多个节点显示目标。");
      usedArms.add(arm);
    }
  }
}

/** Validate saved metadata without normalizing roads, rules or the settings themselves. */
export function validateRoadVisuals(project: Project): void {
  validateVisualRoads(project);
  for (const template of project.templates) validateVisualRoads(template);
}

/** Existing structural operations supply their explicit road/end remap. */
export function remapRoadVisuals(
  project: VisualProject,
  remap: (arm: RoadVisualArm) => RoadVisualArm | undefined,
): void {
  const settings = project.roadVisuals;
  if (!settings) return;
  const seen = new Set<string>(),
    nodes: RoadVisualSettings["nodes"] = [];
  for (const node of settings.nodes) {
    const arms = orderedArms(
      node.arms.flatMap((arm) => {
        const next = remap(copyArm(arm));
        return next ? [copyArm(next)] : [];
      }),
    );
    if (!isConnectedNode(arms)) continue;
    const key = nodeVisualKey({ arms });
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push({ arms, smooth: true });
  }
  if (JSON.stringify(nodes) !== JSON.stringify(settings.nodes))
    settings.nodes = nodes;
}

/** Display state is excluded; all other authored project and blueprint data remains. */
export function logicalProjectSignature(project: Project): string {
  const logical = {
    ...project,
    roads: logicalRoadSignature(project.roads),
    templates: project.templates.map((template) => {
      const entry = {
        ...template,
        roads: logicalRoadSignature(template.roads),
      };
      delete entry.roadVisuals;
      return entry;
    }),
  };
  delete logical.roadVisuals;
  return JSON.stringify(logical);
}
