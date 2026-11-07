import type { Project, Road, RoadSection } from "./types";

/** All editor road assets use the same lane width, in metres. */
export const LANE_WIDTH = 4;

/** Upgrade loaded maps and their templates without changing lane identities. */
export function standardizeLaneWidths(project: Project): boolean {
  let changed = false;
  const normalize = (road: Road | RoadSection) => {
    if (road.width === LANE_WIDTH) return;
    const scale = LANE_WIDTH / road.width;
    if (road.sectionOffset !== undefined) road.sectionOffset *= scale;
    for (const taper of Object.values(
      "autoTaper" in road ? (road.autoTaper ?? {}) : {},
    ))
      if (taper) taper.offset *= scale;
    road.width = LANE_WIDTH;
    changed = true;
  };
  for (const roads of [project.roads, ...project.templates.map((t) => t.roads)])
    for (const road of roads) {
      normalize(road);
      if (road.replacedSection) normalize(road.replacedSection);
    }
  return changed;
}
