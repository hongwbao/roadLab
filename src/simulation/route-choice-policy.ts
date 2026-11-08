import { cs2PersonalCarFallbackParameters } from "./cs2-path-policy";

/** RoadLab's time-first departure policy. Legal topology and measured flow
 * remain active; native routing helpers and subsequent fixed trips are intact. */
export function roadLabRouteParameters(maxSpeed: number) {
  const parameters = cs2PersonalCarFallbackParameters(maxSpeed);
  return {
    ...parameters,
    weights: [1, 0, 0, 0] as const,
    pathfindFlags: parameters.pathfindFlags | 1,
    stable: true,
  };
}
