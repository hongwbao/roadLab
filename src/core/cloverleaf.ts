import saved from "./cloverleaf-improved";
import { segmentRoads } from "./road-segments";
import type { Project, Road, V } from "./types";

type RoadFactory = (
  start: V,
  end: V,
  options?: Partial<Road>,
  first?: V,
  second?: V,
) => Road;

/** The user's improved save, with highway speeds and standard road segments. */
export function cloverleafExample(_makeRoad: RoadFactory): Project {
  const project = structuredClone(saved);
  project.name = "苜蓿叶立交 · 2主线＋2辅道 改进版";
  for (const road of project.roads) {
    // The save replaces the old main roads with 32 two-lane authored segments.
    // Collector IDs remain explicit even where their asset/name was changed.
    const boundary = /^cloverleaf-(east|south|west|north)-(in|out)$/.test(road.id);
    const main = !road.id.startsWith("cloverleaf-") &&
      !road.twoWay && road.lanesStart === 2 && road.lanesEnd === 2;
    road.speed = boundary || main ? 120 : 100;
    if (!boundary) continue;

    // Extend only the free outer end; leave the inner junction and its handle
    // intact. These saved boundary roads are straight, level four-lane trunks.
    const start = road.id.endsWith("-in");
    const knot = start ? road.knots[0] : road.knots.at(-1)!;
    const inner = start ? road.knots.at(-1)!.p : road.knots[0].p;
    const dx = knot.p.x - inner.x, dz = knot.p.z - inner.z;
    const length = Math.hypot(dx, dz);
    for (const point of [knot.p, knot.incoming, knot.outgoing]) {
      point.x += dx / length * 40;
      point.z += dz / length * 40;
    }
  }
  // This also remaps lane rules, attachments, boundary ports and OD references.
  segmentRoads(project, new Set(project.roads.map((road) => road.id)));
  return project;
}
