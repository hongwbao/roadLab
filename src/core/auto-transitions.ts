/**
 * Legacy import bridge. Automatic collars no longer alter road geometry.
 * Runtime decoration uses roadVisuals and render/road-visual-geometry instead.
 */
import { initializeRoadVisuals } from "./road-visual-settings";
import type { Project, Road } from "./types";

/** @deprecated Import old road-level display preferences once, without a taper. */
export const updateAutomaticTransitions = initializeRoadVisuals;

/** @deprecated Structural previews keep their real lane sections unchanged. */
export function automaticTransitionPreview(project: Project, incoming: Road[]) {
  const preview = structuredClone({
    ...project,
    roads: [...project.roads, ...incoming],
  });
  initializeRoadVisuals(preview);
  const ids = new Set(incoming.map((road) => road.id));
  return {
    roads: preview.roads.filter((road) => ids.has(road.id)),
    replaces: [] as string[],
    hasTransitions: !!preview.roadVisuals?.nodes.length,
  };
}
