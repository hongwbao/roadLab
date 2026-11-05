import { add, center, mul, normal, point, sub, tangent, totalAt } from "./math";
import type { Road, V } from "./types";
export type Alignment = "auto" | "center" | "left" | "right";
export type EndpointAnchor = {
  position: V;
  contact: V;
  reference: V;
  alignment: Exclude<Alignment, "auto">;
  offset: number;
};
/** Independently implemented section alignment, inspired by modular road interfaces.
 * position is the editable spline anchor; contact is the physical pavement centre.
 * Keeping these separate also handles an aligned widening's shifted centreline.
 */
export function endpointAnchors(
  reference: Road,
  end: 0 | 1,
  proposed: Road,
  proposedEnd: 0 | 1,
  mode: Alignment = "auto",
): EndpointAnchor[] {
  const c = center(reference, end),
    n = normal(proposed, proposedEnd),
    shift = sub(center(proposed, proposedEnd), point(proposed, proposedEnd));
  const rd = tangent(reference, end),
    nd = tangent(proposed, proposedEnd);
  const parallel = Math.abs(rd.x * nd.x + rd.z * nd.z) > 0.94;
  const canOffset = !reference.twoWay && !proposed.twoWay && parallel;
  const difference =
    (totalAt(proposed, proposedEnd) * proposed.width -
      totalAt(reference, end) * reference.width) /
    2;
  const types: Exclude<Alignment, "auto">[] =
    canOffset && Math.abs(difference) > 0.05
      ? mode === "auto"
        ? ["center", "left", "right"]
        : mode === "center"
          ? ["center"]
          : [mode]
      : ["center"];
  return types.map((alignment) => {
    const offset =
        alignment === "left"
          ? difference
          : alignment === "right"
            ? -difference
            : 0,
      contact = add(c, mul(n, offset));
    return {
      position: sub(contact, shift),
      contact,
      reference: c,
      alignment,
      offset,
    };
  });
}
