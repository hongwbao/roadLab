import { buildLaneJunctions, type LaneJunction } from "./lane-junctions";
import {
  add,
  arcParameter,
  arcTable,
  bezier,
  center,
  dist,
  laneCount,
  laneDirection,
  laneEntryT,
  laneExitT,
  lanePoint,
  laneWidth,
  mul,
  tangent,
} from "./math";
import {
  attachmentAllows,
  attachmentAt,
  laneNumber,
  turnOf,
} from "./lane-rules";
import { signalForJunction, signalStopOffset } from "./traffic-signals";
import type { Connection, Project, Road, Turn, V } from "./types";

export type JunctionLaneEndpoint = { road: string; lane: number; end: 0 | 1 };
/** An absent rule uses automatic routing; an explicit empty destination list closes this lane. */
export type JunctionLaneRule = {
  from: JunctionLaneEndpoint;
  to: JunctionLaneEndpoint[];
};
export type JunctionLaneProject = Pick<Project, "roads"> & {
  signals?: Project["signals"];
  junctionLaneConnections?: JunctionLaneRule[];
};
export type JunctionLanePort = JunctionLaneEndpoint & {
  key: string;
  kind: "in" | "out";
  position: V;
  direction: V;
  name: string;
  roadName: string;
  number: number;
};
export type JunctionLaneLink = {
  id: string;
  from: JunctionLanePort;
  to: JunctionLanePort;
  turn: Turn;
  points: readonly [V, V, V, V];
  samples: V[];
};
export type JunctionLaneLayout = {
  junction: LaneJunction;
  ports: JunctionLanePort[];
  candidates: JunctionLaneLink[];
  links: JunctionLaneLink[];
};
export const junctionLaneKey = (ref: JunctionLaneEndpoint) =>
  `${ref.road}:${ref.end}:${ref.lane}`;
export const junctionLaneConnectionId = (
  from: JunctionLaneEndpoint,
  to: JunctionLaneEndpoint,
) => `${from.road}:${from.lane}>${to.road}:${to.lane}`;
const sameRef = (a: JunctionLaneEndpoint, b: JunctionLaneEndpoint) =>
  a.road === b.road && a.end === b.end && a.lane === b.lane;
const copyRef = ({
  road,
  lane,
  end,
}: JunctionLaneEndpoint): JunctionLaneEndpoint => ({ road, lane, end });
const roadMap = (project: JunctionLaneProject) =>
  new Map(project.roads.map((road) => [road.id, road]));
const sideName = (direction: V) =>
  Math.abs(direction.x) > Math.abs(direction.z)
    ? direction.x > 0
      ? "东侧"
      : "西侧"
    : direction.z > 0
      ? "南侧"
      : "北侧";
const validRef = (
  ref: JunctionLaneEndpoint,
  roads: ReadonlyMap<string, Road>,
  kind: "in" | "out",
) => {
  const road = ref && roads.get(ref.road);
  return (
    !!road &&
    Number.isInteger(ref.lane) &&
    ref.lane >= 0 &&
    ref.lane < laneCount(road) &&
    (ref.end === 0 || ref.end === 1) &&
    (kind === "in" ? laneExitT(road, ref.lane) : laneEntryT(road, ref.lane)) ===
      ref.end &&
    laneWidth(road, ref.lane, ref.end) > road.width * 0.7
  );
};
export function junctionLanePorts(
  project: JunctionLaneProject,
  junction: LaneJunction,
): JunctionLanePort[] {
  const roads = roadMap(project),
    result: JunctionLanePort[] = [],
    signalized = !!signalForJunction(project.signals, junction);
  for (const [armIndex, arm] of junction.arms.entries()) {
    const road = roads.get(arm.road);
    if (!road) continue;
    const table = arcTable(road),
      total = table.at(-1)!.s,
      offset = arm.trim + (signalized ? signalStopOffset(arm) : 0),
      t = arcParameter(table, arm.end === 0 ? offset : total - offset);
    for (let lane = 0; lane < laneCount(road); lane++) {
      if (laneWidth(road, lane, arm.end) <= road.width * 0.7) continue;
      const kind = laneExitT(road, lane) === arm.end ? "in" : "out",
        ref = { road: road.id, lane, end: arm.end },
        number = laneNumber(road, lane, arm.end);
      result.push({
        ...ref,
        key: junctionLaneKey(ref),
        kind,
        position: lanePoint(road, lane, t),
        direction: mul(tangent(road, t), laneDirection(road, lane)),
        name:
          junction.kind === "attachment"
            ? `${kind === "in" ? "入口" : "出口"}${armIndex + 1} · ${road.name} · ${number} 车道`
            : `${sideName(arm.direction)} · ${kind === "in" ? "入" : "出"} ${number} 车道`,
        roadName: road.name,
        number,
      });
    }
  }
  return result;
}
function pairAllowed(
  roads: ReadonlyMap<string, Road>,
  from: JunctionLanePort,
  to: JunctionLanePort,
  junction: LaneJunction,
) {
  if (from.kind !== "in" || to.kind !== "out" || from.road === to.road)
    return false;
  const a = roads.get(from.road)!,
    b = roads.get(to.road)!;
  // A logical junction joins road centres; the trim points may lie at different heights on a grade.
  if (Math.abs(center(a, from.end).y - center(b, to.end).y) > 0.5) return false;
  const da = mul(tangent(a, from.end), laneDirection(a, from.lane)),
    db = mul(tangent(b, to.end), laneDirection(b, to.lane));
  if (da.x * db.x + da.z * db.z < -0.75) return false;
  // Attachments fix road placement. Authored links may choose any compatible
  // lane within this connected offset node, independently of its original pair.
  if (junction.kind === "attachment") return true;
  const aa = attachmentAt(a, from.end),
    ba = attachmentAt(b, to.end),
    directA = aa?.road === b.id && aa.end === to.end,
    directB = ba?.road === a.id && ba.end === from.end;
  if (directA || directB)
    return (
      (!directA || attachmentAllows(aa, from.lane, b, to.end, to.lane)) &&
      (!directB || attachmentAllows(ba, to.lane, a, from.end, from.lane))
    );
  return !aa && !ba;
}
/** Uses the same trimmed endpoints and 0.45-span tangent handles as the live simulation. */
export function junctionLaneLink(
  from: JunctionLanePort,
  to: JunctionLanePort,
): JunctionLaneLink {
  const span = dist(from.position, to.position) * 0.45,
    points: readonly [V, V, V, V] = [
      { ...from.position },
      add(from.position, mul(from.direction, span)),
      add(to.position, mul(to.direction, -span)),
      { ...to.position },
    ];
  return {
    id: junctionLaneConnectionId(from, to),
    from,
    to,
    turn: turnOf(from.direction, to.direction),
    points,
    samples: Array.from({ length: 49 }, (_, i) => bezier(...points, i / 48)),
  };
}
export function junctionLaneCandidates(
  project: JunctionLaneProject,
  junction: LaneJunction,
): JunctionLaneLink[] {
  const ports = junctionLanePorts(project, junction),
    roads = roadMap(project),
    result: JunctionLaneLink[] = [];
  for (const from of ports.filter((p) => p.kind === "in"))
    for (const to of ports.filter((p) => p.kind === "out"))
      if (pairAllowed(roads, from, to, junction))
        result.push(junctionLaneLink(from, to));
  return result;
}
export function junctionLaneLayout(
  project: JunctionLaneProject,
  junction: LaneJunction,
  connections: readonly Connection[],
): JunctionLaneLayout {
  const candidates = junctionLaneCandidates(project, junction),
    enabled = new Set(connections.filter((c) => c.enabled).map((c) => c.id));
  return {
    junction,
    ports: junctionLanePorts(project, junction),
    candidates,
    links: candidates.filter((link) => enabled.has(link.id)),
  };
}
type LaneCandidate = Pick<JunctionLaneLink, "id" | "from" | "to">;
const candidateCache = new WeakMap<
  JunctionLaneProject,
  {
    signature: string;
    index: Map<
      string,
      { ref: JunctionLaneEndpoint; links: Map<string, LaneCandidate> }
    >;
  }
>();
function candidateIndex(project: JunctionLaneProject) {
  // Routing validation needs endpoint pairs, not thousands of sampled curves.
  // Rules and phase timings cannot change their geometry; keep them out of the key.
  const signature = JSON.stringify([
    project.roads,
    project.signals?.map((s) => [s.id, s.arms]),
  ]);
  const cached = candidateCache.get(project);
  if (cached?.signature === signature) return cached.index;
  const sources = new Map<
      string,
      { ref: JunctionLaneEndpoint; links: Map<string, LaneCandidate> }
    >(),
    roads = roadMap(project);
  for (const junction of buildLaneJunctions(project)) {
    const ports = junctionLanePorts(project, junction),
      out = ports.filter((p) => p.kind === "out");
    for (const from of ports.filter((p) => p.kind === "in")) {
      const source = { ref: from, links: new Map<string, LaneCandidate>() };
      sources.set(from.key, source);
      for (const to of out)
        if (pairAllowed(roads, from, to, junction))
          source.links.set(to.key, {
            id: junctionLaneConnectionId(from, to),
            from,
            to,
          });
    }
  }
  candidateCache.set(project, { signature, index: sources });
  return sources;
}
export function junctionLaneRule(
  project: JunctionLaneProject,
  from: JunctionLaneEndpoint,
) {
  return project.junctionLaneConnections?.find((rule) =>
    sameRef(rule.from, from),
  );
}
/** Overrides a source lane's whole destination list, including pairs absent from automatic mapping. */
export function applyJunctionLaneRules(
  project: JunctionLaneProject,
  automatic: Connection[],
): Connection[] {
  if (!project.junctionLaneConnections?.length) return automatic;
  const index = candidateIndex(project),
    overridden = new Set<string>(),
    manual: Connection[] = [];
  for (const rule of project.junctionLaneConnections) {
    const source = index.get(junctionLaneKey(rule.from));
    if (!source) continue;
    overridden.add(`${rule.from.road}:${rule.from.lane}`);
    const seen = new Set<string>();
    for (const to of rule.to) {
      const link = source.links.get(junctionLaneKey(to));
      if (!link || seen.has(link.id)) continue;
      seen.add(link.id);
      manual.push({
        id: link.id,
        from: { road: link.from.road, lane: link.from.lane },
        to: { road: link.to.road, lane: link.to.lane },
        enabled: true,
        manual: true,
      });
    }
  }
  return [
    ...automatic.filter(
      (c) => !overridden.has(`${c.from.road}:${c.from.lane}`),
    ),
    ...manual,
  ];
}
export function setJunctionLaneRule(
  project: JunctionLaneProject,
  from: JunctionLaneEndpoint,
  to: readonly JunctionLaneEndpoint[],
) {
  const source = candidateIndex(project).get(junctionLaneKey(from));
  if (!source) throw new Error("入车道已失效，请重新选择路口。");
  const seen = new Set<string>(),
    destinations: JunctionLaneEndpoint[] = [];
  for (const ref of to) {
    const key = junctionLaneKey(ref);
    if (!source.links.has(key))
      throw new Error("此出车道无法与选中的入车道连接。");
    if (!seen.has(key)) {
      seen.add(key);
      destinations.push(copyRef(ref));
    }
  }
  project.junctionLaneConnections ??= [];
  const existing = project.junctionLaneConnections.find((rule) =>
    sameRef(rule.from, from),
  );
  if (existing) existing.to = destinations;
  else
    project.junctionLaneConnections.push({
      from: copyRef(from),
      to: destinations,
    });
}
export function restoreJunctionLaneRule(
  project: JunctionLaneProject,
  from: JunctionLaneEndpoint,
) {
  project.junctionLaneConnections = project.junctionLaneConnections?.filter(
    (rule) => !sameRef(rule.from, from),
  );
  if (!project.junctionLaneConnections?.length)
    delete project.junctionLaneConnections;
}
export function restoreJunctionLaneRules(
  project: JunctionLaneProject,
  junction: LaneJunction,
) {
  const sources = new Set(
    junctionLanePorts(project, junction)
      .filter((p) => p.kind === "in")
      .map((p) => p.key),
  );
  project.junctionLaneConnections = project.junctionLaneConnections?.filter(
    (rule) => !sources.has(junctionLaneKey(rule.from)),
  );
  if (!project.junctionLaneConnections?.length)
    delete project.junctionLaneConnections;
}
export function normalizeJunctionLaneRules(project: JunctionLaneProject): void {
  if (!project.junctionLaneConnections?.length) {
    delete project.junctionLaneConnections;
    return;
  }
  const index = candidateIndex(project),
    seen = new Set<string>(),
    result: JunctionLaneRule[] = [];
  for (const rule of project.junctionLaneConnections) {
    if (!rule?.from || !Array.isArray(rule.to)) continue;
    const key = junctionLaneKey(rule.from),
      source = index.get(key);
    if (!source || seen.has(key)) continue;
    seen.add(key);
    const targets = new Set<string>();
    result.push({
      from: copyRef(rule.from),
      to: rule.to
        .filter((ref) => {
          if (!ref) return false;
          const k = junctionLaneKey(ref);
          if (!source.links.has(k) || targets.has(k)) return false;
          targets.add(k);
          return true;
        })
        .map(copyRef),
    });
  }
  if (result.length) project.junctionLaneConnections = result;
  else delete project.junctionLaneConnections;
}
export function validateJunctionLaneRules(project: JunctionLaneProject): void {
  const rules = project.junctionLaneConnections;
  if (rules === undefined) return;
  if (!Array.isArray(rules) || rules.length > 12000)
    throw new Error("路口车道连线配置格式不正确。");
  const roads = roadMap(project),
    sources = new Set<string>();
  for (const rule of rules) {
    if (
      !rule ||
      !rule.from ||
      !validRef(rule.from, roads, "in") ||
      !Array.isArray(rule.to) ||
      rule.to.length > 600
    )
      throw new Error("路口入车道或出口列表不合法。");
    const source = junctionLaneKey(rule.from);
    if (sources.has(source)) throw new Error("同一入车道不能重复配置。");
    sources.add(source);
    const targets = new Set<string>();
    for (const to of rule.to) {
      if (
        !to ||
        !validRef(to, roads, "out") ||
        targets.has(junctionLaneKey(to))
      )
        throw new Error("路口出车道引用不合法或重复。");
      targets.add(junctionLaneKey(to));
    }
  }
}
export function cloneJunctionLaneRules(
  rules: readonly JunctionLaneRule[] | undefined,
  ids: ReadonlyMap<string, string>,
): JunctionLaneRule[] {
  return (rules ?? [])
    .filter((rule) => [rule.from, ...rule.to].every((ref) => ids.has(ref.road)))
    .map((rule) => ({
      from: { ...copyRef(rule.from), road: ids.get(rule.from.road)! },
      to: rule.to.map((ref) => ({ ...copyRef(ref), road: ids.get(ref.road)! })),
    }));
}
export function remapSplitJunctionLaneRules(
  project: JunctionLaneProject,
  originalRoad: string,
  newEndRoad: string,
): void {
  for (const rule of project.junctionLaneConnections ?? [])
    for (const ref of [rule.from, ...rule.to])
      if (ref.road === originalRoad && ref.end === 1) ref.road = newEndRoad;
}
export function removeJunctionLaneRulesForRoads(
  project: JunctionLaneProject,
  ids: ReadonlySet<string>,
): void {
  project.junctionLaneConnections = project.junctionLaneConnections
    ?.filter((rule) => !ids.has(rule.from.road))
    .map((rule) => ({
      ...rule,
      to: rule.to.filter((ref) => !ids.has(ref.road)),
    }));
  if (!project.junctionLaneConnections?.length)
    delete project.junctionLaneConnections;
}
export function mirrorJunctionLaneRules(
  project: JunctionLaneProject,
  roads: readonly Road[],
): void {
  const selected = new Map(
    roads.filter((road) => !road.twoWay).map((road) => [road.id, road]),
  );
  for (const rule of project.junctionLaneConnections ?? [])
    for (const ref of [rule.from, ...rule.to]) {
      const road = selected.get(ref.road);
      if (road) ref.lane = laneCount(road) - 1 - ref.lane;
    }
}
