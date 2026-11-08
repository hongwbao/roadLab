import {
  add,
  center,
  dist,
  lanePoint,
  mul,
  normal,
  point,
  sub,
  tangent,
  pavementWidth,
} from "./math";
import { attachLanes, endpointLaneGroups } from "./lane-rules";
import { copy, type Road, type V } from "./types";
export type Alignment = "auto" | "center" | "left" | "right";
export type EndpointAnchor = {
  position: V;
  contact: V;
  reference: V;
  alignment: Exclude<Alignment, "auto">;
  offset: number;
};
export function laneAnchors(
  reference: Road,
  end: number,
  proposed: Road,
  proposedEnd: 0 | 1,
) {
  const flowEnd = end === 0 || end === 1 ? end : proposedEnd === 0 ? 1 : 0;
  const direction = mul(
      tangent(reference, end),
      proposedEnd === flowEnd ? -1 : 1,
    ),
    approach = tangent(proposed, proposedEnd);
  if (approach.x * direction.x + approach.z * direction.z < 0.7) return [];
  return endpointLaneGroups(reference, end, proposed, proposedEnd).flatMap(
    (group) => {
      const aligned = copy(proposed);
      attachLanes(
        aligned,
        proposedEnd,
        reference,
        end,
        group.lanes,
        group.ownLanes,
      );
      const contact = mul(
        group.lanes.reduce(
          (p, lane) => add(p, lanePoint(reference, lane, end)),
          { x: 0, y: 0, z: 0 },
        ),
        1 / group.lanes.length,
      );
      // The committed attachment changes the endpoint tangent first. Compute
      // the editable anchor from that same geometry, including median/offset.
      if (
        group.lanes.some(
          (lane, i) =>
            dist(
              lanePoint(aligned, group.ownLanes[i], proposedEnd),
              lanePoint(reference, lane, end),
            ) > 1e-5,
        )
      )
        return [];
      return [
        {
          ...group,
          contact,
          position: point(aligned, proposedEnd),
          direction,
        },
      ];
    },
  );
}
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
    referenceNormal = normal(reference, end),
    shift = sub(center(proposed, proposedEnd), point(proposed, proposedEnd));
  const rd = tangent(reference, end),
    nd = tangent(proposed, proposedEnd);
  // At the destination, a gently angled approach can bend to match the
  // reference road's tangent. The source preview has no final direction yet.
  const parallel =
    Math.abs(rd.x * nd.x + rd.z * nd.z) > (proposedEnd === 1 ? 0.75 : 0.94);
  const canOffset = parallel;
  const difference =
    (pavementWidth(proposed, proposedEnd) - pavementWidth(reference, end)) / 2;
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
      contact = add(
        c,
        mul(
          referenceNormal,
          offset *
            (n.x * referenceNormal.x + n.z * referenceNormal.z >= 0 ? 1 : -1),
        ),
      );
    return {
      position: sub(contact, shift),
      contact,
      reference: c,
      alignment,
      offset,
    };
  });
}
