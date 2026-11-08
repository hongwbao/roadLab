import { buildJunctions, convexHull, type Junction } from "./junctions";
import {
  add,
  arcParameter,
  arcTable,
  center,
  dist,
  laneCount,
  laneExitT,
  lanePoint,
  laneWidth,
  mul,
  nodePoint,
  normal,
  pavementWidth,
  tangent,
} from "./math";
import type { Project, Road } from "./types";
import { signalForJunction, signalStopOffset } from "./traffic-signals";
import { attachmentAllows, attachmentAt } from "./lane-rules";

/** Logical editing nodes do not add intersection pavement or traffic controls. */
export type LaneJunction = Junction & {
  kind?: "attachment" | "continuation";
};
export const isLaneJunctionEditable = (node: LaneJunction) =>
  new Set(node.arms.map((arm) => arm.road)).size >= 2;
type LaneProject = Pick<
  Project,
  "roads" | "junctionLaneConnections" | "signals"
>;
type End = { road: Road; end: 0 | 1; key: string };
const key = (road: string, end: number) => JSON.stringify([road, end]);
const cache = new WeakMap<
  object,
  { signature: string; nodes: LaneJunction[] }
>();
export function buildLaneJunctions(
  project: Pick<Project, "roads">,
): LaneJunction[] {
  const signature = JSON.stringify(project.roads),
    saved = cache.get(project);
  if (saved?.signature === signature) return saved.nodes;
  const ends: End[] = project.roads.flatMap((road) =>
    ([0, 1] as const).map((end) => ({ road, end, key: key(road.id, end) })),
  );
  const index = new Map(ends.map((v, i) => [v.key, i])),
    parent = ends.map((_, i) => i),
    special = new Set<number>();
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]));
  const join = (a: number, b: number, offset = false) => {
    parent[root(b)] = root(a);
    if (offset) {
      special.add(a);
      special.add(b);
    }
  };
  // Shared reference endpoints join the continuing carriageway into the same
  // component as its laterally attached ramp. Never join two ends along a road.
  const nodes = new Map<string, number[]>();
  for (let i = 0; i < ends.length; i++) {
    const p = nodePoint(ends[i].road, ends[i].end),
      cx = Math.floor(p.x),
      cz = Math.floor(p.z);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let z = cz - 1; z <= cz + 1; z++)
        for (const j of nodes.get(`${x}:${z}`) ?? [])
          if (
            ends[i].road.id !== ends[j].road.id &&
            Math.abs(p.y - nodePoint(ends[j].road, ends[j].end).y) <= 0.5 &&
            dist(p, nodePoint(ends[j].road, ends[j].end)) < 0.65
          )
            join(i, j);
    const cell = `${cx}:${cz}`,
      list = nodes.get(cell) ?? [];
    list.push(i);
    nodes.set(cell, list);
  }
  // Physical lane contacts also recover older maps which predate attachment
  // metadata. Merely parallel or grade-separated roads are not contacts.
  const contacts = new Map<
      string,
      { index: number; lane: number; inbound: boolean }[]
    >(),
    contactRadius = Math.ceil(
      Math.max(0, ...project.roads.map((r) => r.width)) * 0.7,
    );
  for (let i = 0; i < ends.length; i++) {
    const { road, end } = ends[i];
    for (let lane = 0; lane < laneCount(road); lane++) {
      if (laneWidth(road, lane, end) <= road.width * 0.7) continue;
      const p = lanePoint(road, lane, end),
        cx = Math.floor(p.x),
        cz = Math.floor(p.z),
        inbound = laneExitT(road, lane) === end;
      for (let x = cx - contactRadius; x <= cx + contactRadius; x++)
        for (let z = cz - contactRadius; z <= cz + contactRadius; z++)
          for (const other of contacts.get(`${x}:${z}`) ?? []) {
            const b = ends[other.index];
            if (other.inbound === inbound || b.road.id === road.id) continue;
            const aDir = mul(
              tangent(road, end),
              inbound ? (end === 1 ? 1 : -1) : end === 0 ? 1 : -1,
            );
            const bDir = mul(
              tangent(b.road, b.end),
              other.inbound ? (b.end === 1 ? 1 : -1) : b.end === 0 ? 1 : -1,
            );
            if (aDir.x * bDir.x + aDir.z * bDir.z < 0.94) continue;
            const q = lanePoint(b.road, other.lane, b.end),
              distance = dist(p, q),
              legacyContact = distance <= 0.35;
            if (!legacyContact) {
              const dx = q.x - p.x,
                dz = q.z - p.z,
                aLength = Math.hypot(aDir.x, aDir.z),
                bLength = Math.hypot(bDir.x, bDir.z),
                halfWidths =
                  (laneWidth(road, lane, end) +
                    laneWidth(b.road, other.lane, b.end)) /
                  2;
              // Recover the live model's close lane ends, while requiring a
              // real longitudinal seam and overlapping lateral lane surfaces.
              // Parallel road interiors, gaps and opposite travel stay apart.
              if (
                Math.abs(p.y - q.y) > 0.5 ||
                distance >= Math.max(road.width, b.road.width) * 0.7 ||
                Math.abs(dx * aDir.x + dz * aDir.z) / aLength > 0.65 ||
                Math.abs(dx * bDir.x + dz * bDir.z) / bLength > 0.65 ||
                Math.abs(dx * aDir.z - dz * aDir.x) / aLength > halfWidths ||
                Math.abs(dx * bDir.z - dz * bDir.x) / bLength > halfWidths
              )
                continue;
              const aa = attachmentAt(road, end),
                ba = attachmentAt(b.road, b.end),
                directA = aa?.road === b.road.id && aa.end === b.end,
                directB = ba?.road === road.id && ba.end === end;
              if (directA || directB) {
                if (
                  (directA &&
                    !attachmentAllows(aa, lane, b.road, b.end, other.lane)) ||
                  (directB &&
                    !attachmentAllows(ba, other.lane, road, end, lane))
                )
                  continue;
              } else if (
                aa?.ownLanes.includes(lane) ||
                ba?.ownLanes.includes(other.lane)
              )
                continue;
            }
            join(
              i,
              other.index,
              legacyContact &&
                dist(nodePoint(road, end), nodePoint(b.road, b.end)) >= 0.65,
            );
          }
      const cell = `${cx}:${cz}`,
        list = contacts.get(cell) ?? [];
      list.push({ index: i, lane, inbound });
      contacts.set(cell, list);
    }
  }
  const roads = new Map(project.roads.map((r) => [r.id, r]));
  for (let i = 0; i < ends.length; i++) {
    const { road, end } = ends[i],
      attachment = road.attachments?.[end === 0 ? "start" : "end"];
    if (!attachment) continue;
    const ref = roads.get(attachment.road),
      j = index.get(key(attachment.road, attachment.end));
    if (!ref || j === undefined || road.id === ref.id) continue;
    const valid = attachment.ownLanes.some((own, n) => {
      const lane = attachment.lanes[n];
      return (
        own >= 0 &&
        own < laneCount(road) &&
        lane >= 0 &&
        lane < laneCount(ref) &&
        (laneExitT(road, own) === end) !==
          (laneExitT(ref, lane) === attachment.end) &&
        dist(lanePoint(road, own, end), lanePoint(ref, lane, attachment.end)) <
          0.65
      );
    });
    if (valid) join(i, j, true);
  }
  const marked = new Set([...special].map(root)),
    groups = new Map<number, End[]>();
  for (let i = 0; i < ends.length; i++) {
    const list = groups.get(root(i)) ?? [];
    list.push(ends[i]);
    groups.set(root(i), list);
  }
  // Physical pavement uses a broader 0.65m 3D tolerance. Editing follows the
  // actual endpoint topology and its 0.5m height contract instead; a pavement
  // polygon must not join otherwise disconnected decks into one editor node.
  const physical = buildJunctions(project as Project).flatMap((node) => {
    const parts = new Map<number, typeof node.arms>();
    for (const arm of node.arms) {
      const i = index.get(key(arm.road, arm.end));
      if (i === undefined) continue;
      const arms = parts.get(root(i)) ?? [];
      arms.push(arm);
      parts.set(root(i), arms);
    }
    return [...parts.values()]
      .filter((arms) => new Set(arms.map((a) => a.road)).size >= 2)
      .map((arms) => ({
        ...node,
        arms,
        id:
          arms.length === node.arms.length
            ? node.id
            : `${node.id}:${JSON.stringify(arms.map((a) => key(a.road, a.end)).sort())}`,
      }));
  });
  const consumed = new Set<string>(),
    offsets: LaneJunction[] = [];
  for (const [groupRoot, group] of groups) {
    if (new Set(group.map((a) => a.road.id)).size < 2) continue;
    group.sort((a, b) => a.key.localeCompare(b.key));
    const keys = new Set(group.map((a) => a.key)),
      existing = physical.filter((j) =>
        j.arms.some((a) => keys.has(key(a.road, a.end))),
      ),
      attachment = marked.has(groupRoot);
    // A logical component wholly inside a physical intersection keeps the
    // original pavement, trims, identity and attachment policy.
    if (
      existing.length === 1 &&
      existing[0].arms.length === group.length &&
      existing[0].arms.every((a) => keys.has(key(a.road, a.end)))
    )
      continue;
    existing.forEach((j) => consumed.add(j.id));
    const arms = group.map(({ road, end }, i) => {
      const table = arcTable(road),
        length = table.at(-1)!.s;
      const old = existing
        .flatMap((j) => j.arms)
        .find((a) => a.road === road.id && a.end === end);
      // These are editing insets for continuations; laneJunctionTrims never
      // applies them to ordinary road geometry. They separate coincident dots.
      const trim = Math.min(
        length * 0.32,
        Math.max(old?.trim ?? 0, 14 + i * 8),
      );
      const t = arcParameter(table, end === 0 ? trim : length - trim);
      return {
        road: road.id,
        end,
        direction: mul(tangent(road, end), end === 0 ? 1 : -1),
        halfWidth: pavementWidth(road, t) / 2 + 0.35,
        trim,
        t,
      };
    });
    const position =
      existing[0]?.position ??
      mul(
        group.reduce((sum, a) => add(sum, center(a.road, a.end)), {
          x: 0,
          y: 0,
          z: 0,
        }),
        1 / group.length,
      );
    const polygon = convexHull(
      arms.flatMap((a) => {
        const road = roads.get(a.road)!,
          c = center(road, a.t),
          n = normal(road, a.t);
        return [-1, 1].map((sign) => add(c, mul(n, a.halfWidth * sign)));
      }),
    );
    offsets.push({
      id:
        existing[0]?.id ??
        `${attachment ? "offset" : "node"}:${JSON.stringify(group.map((a) => a.key))}`,
      kind: attachment ? "attachment" : "continuation",
      position,
      arms,
      radius: Math.max(
        6,
        ...group.map(
          (a) =>
            dist(position, center(a.road, a.end)) +
            pavementWidth(a.road, a.end) / 2,
        ),
      ),
      polygon,
      crosswalks: false,
    });
  }
  const result = [...physical.filter((j) => !consumed.has(j.id)), ...offsets];
  cache.set(project, { signature, nodes: result });
  return result;
}

/** Only authored offset-node movements need a connector span. Ordinary automatic
 * traffic keeps its existing geometry, trims and intersection controls. */
export function laneJunctionTrims(
  project: LaneProject,
  base: ReadonlyMap<string, { start: number; end: number }>,
) {
  if (!project.junctionLaneConnections?.length) return base;
  const result = new Map([...base].map(([id, v]) => [id, { ...v }]));
  for (const node of buildLaneJunctions(project)) {
    if (
      node.kind !== "attachment" ||
      !project.junctionLaneConnections.some((rule) =>
        node.arms.some(
          (a) => a.road === rule.from.road && a.end === rule.from.end,
        ),
      )
    )
      continue;
    for (const a of node.arms) {
      const trim = result.get(a.road);
      if (trim)
        trim[a.end === 0 ? "start" : "end"] = Math.max(
          trim[a.end === 0 ? "start" : "end"],
          a.trim +
            (signalForJunction(project.signals, node)
              ? signalStopOffset(a)
              : 0),
        );
    }
  }
  return result;
}
