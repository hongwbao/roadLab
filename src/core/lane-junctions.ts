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

/** A lane-editing node can be an offset attachment without a paved intersection. */
export type LaneJunction = Junction & { kind?: "attachment" };
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
  const physical = buildJunctions(project as Project);
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
          if (dist(p, nodePoint(ends[j].road, ends[j].end)) < 0.65) join(i, j);
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
  >();
  for (let i = 0; i < ends.length; i++) {
    const { road, end } = ends[i];
    for (let lane = 0; lane < laneCount(road); lane++) {
      if (laneWidth(road, lane, end) <= road.width * 0.7) continue;
      const p = lanePoint(road, lane, end),
        cx = Math.floor(p.x),
        cz = Math.floor(p.z),
        inbound = laneExitT(road, lane) === end;
      for (let x = cx - 1; x <= cx + 1; x++)
        for (let z = cz - 1; z <= cz + 1; z++)
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
            if (
              aDir.x * bDir.x + aDir.z * bDir.z < 0.94 ||
              dist(p, lanePoint(b.road, other.lane, b.end)) > 0.35
            )
              continue;
            join(
              i,
              other.index,
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
  for (let i = 0; i < ends.length; i++)
    if (marked.has(root(i))) {
      const list = groups.get(root(i)) ?? [];
      list.push(ends[i]);
      groups.set(root(i), list);
    }
  const consumed = new Set<string>(),
    offsets: LaneJunction[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.key.localeCompare(b.key));
    const keys = new Set(group.map((a) => a.key)),
      existing = physical.filter((j) =>
        j.arms.some((a) => keys.has(key(a.road, a.end))),
      );
    // An attachment wholly inside an existing physical intersection does not
    // create a second node or override that intersection's attachment policy.
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
      // Stagger close parallel branches along their real lane curves, so two
      // outgoing dots do not coincide inside the shared fork pavement.
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
        existing[0]?.id ?? `offset:${JSON.stringify(group.map((a) => a.key))}`,
      kind: "attachment",
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
