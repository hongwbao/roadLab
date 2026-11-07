import type { Project, Road } from "./types";

/** All editor road assets use the same lane width, in metres. */
export const LANE_WIDTH = 4;

/** Upgrade loaded maps and their templates without changing lane identities. */
export function standardizeLaneWidths(project: Project): boolean {
  let changed = false;
  const normalize = (road: Road) => {
    if (road.width === LANE_WIDTH) return;
    const scale = LANE_WIDTH / road.width;
    if (road.sectionOffset !== undefined) road.sectionOffset *= scale;
    for (const taper of Object.values(road.autoTaper ?? {}))
      if (taper) taper.offset *= scale;
    road.width = LANE_WIDTH;
    changed = true;
  };
  project.roads.forEach(normalize);
  for (const template of project.templates) template.roads.forEach(normalize);
  return changed;
}
