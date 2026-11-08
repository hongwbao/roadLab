import { expect, it } from "vitest";
import {
  add,
  center,
  dist,
  laneDirection,
  laneExitT,
  lanePoint,
  laneWidth,
  mul,
  point,
  sub,
  tangent,
  v,
} from "../src/core/math";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import { endpointAnchors, laneAnchors } from "../src/core/snapping";
import { attachLanes } from "../src/core/lane-rules";
const source = () =>
  makeRoad(v(-80, 0), v(0, 0), { lanesStart: 3, lanesEnd: 3, width: 3.6 });
it("offsets a two-lane continuation so the first two lane paths match a three-lane approach", () => {
  const r = source(),
    n = makeRoad(v(0, 0), v(80, 0), { lanesStart: 2, lanesEnd: 2, width: 3.6 });
  const a = endpointAnchors(r, 1, n, 0, "left")[0];
  expect(a.offset).toBeCloseTo(-1.8);
  const road = makeRoad(a.position, add(a.position, v(80, 0)), {
    lanesStart: 2,
    lanesEnd: 2,
    width: 3.6,
  });
  for (let lane = 0; lane < 2; lane++)
    expect(dist(lanePoint(r, lane, 1), lanePoint(road, lane, 0))).toBeLessThan(
      1e-8,
    );
});
it("aligns a one-lane exit to the outer lane and derives its connection automatically", () => {
  const r = source(),
    n = makeRoad(v(0, 0), v(80, 0), { lanesStart: 1, lanesEnd: 1, width: 3.6 });
  const a = endpointAnchors(r, 1, n, 0, "right")[0];
  expect(a.offset).toBeCloseTo(3.6);
  const road = makeRoad(a.position, add(a.position, v(80, 0)), {
    lanesStart: 1,
    lanesEnd: 1,
    width: 3.6,
  });
  expect(dist(lanePoint(r, 2, 1), lanePoint(road, 0, 0))).toBeLessThan(1e-8);
  const p = emptyProject();
  p.roads = [r, road];
  expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([[2, 0]]);
});
it("compensates the editable axis when the physical centre shifts along a widening", () => {
  const old = makeRoad(v(80, 0), v(150, 0), {
    lanesStart: 3,
    lanesEnd: 3,
    width: 3.6,
  });
  const proposed = makeRoad(v(0, 0), v(80, 0), {
    lanesStart: 2,
    lanesEnd: 3,
    width: 3.6,
    align: "left",
  });
  const a = endpointAnchors(old, 0, proposed, 1, "center")[0];
  expect(a.position.z).toBeCloseTo(-1.8);
  const delta = sub(a.position, point(proposed, 1));
  for (const k of proposed.knots)
    for (const key of ["p", "incoming", "outgoing"] as const)
      k[key] = add(k[key], delta);
  expect(dist(center(proposed, 1), a.contact)).toBeLessThan(1e-8);
});
it("rotates offset anchors with the road instead of world-grid axes", () => {
  const r = makeRoad(v(-60, -60), v(0, 0), {
      lanesStart: 3,
      lanesEnd: 3,
      width: 3.6,
    }),
    n = makeRoad(v(0, 0), v(60, 60), {
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.6,
    });
  const a = endpointAnchors(r, 1, n, 0, "right")[0],
    road = makeRoad(a.position, add(a.position, v(60, 60)), {
      lanesStart: 1,
      lanesEnd: 1,
      width: 3.6,
    });
  expect(dist(lanePoint(r, 2, 1), lanePoint(road, 0, 0))).toBeLessThan(1e-8);
});
it("keeps perpendicular connections on the shared centre node", () => {
  const r = source();
  for (const proposed of [
    makeRoad(v(0, 0), v(0, 80)),
    makeRoad(v(0, 0), v(0, 80), { twoWay: true }),
  ]) {
    const as = endpointAnchors(r, 1, proposed, 0);
    expect(as).toHaveLength(1);
    expect(as[0].alignment).toBe("center");
  }
});

it("offers physical edge alignment for parallel bidirectional sections", () => {
  const reference = makeRoad(v(-80, 0), v(), {
      twoWay: true,
      lanesStart: 2,
      lanesEnd: 2,
      median: { kind: "concrete", width: 2 },
      width: 4,
    }),
    proposed = makeRoad(v(), v(80, 0), {
      twoWay: true,
      lanesStart: 3,
      lanesEnd: 3,
      backwardLanesStart: 2,
      backwardLanesEnd: 2,
      sectionOffset: 3,
      width: 4,
    });
  const anchors = endpointAnchors(reference, 1, proposed, 0);
  expect(anchors.map((a) => a.alignment)).toEqual(["center", "left", "right"]);
  for (const anchor of anchors) {
    const aligned = structuredClone(proposed),
      delta = sub(anchor.position, point(aligned, 0));
    for (const knot of aligned.knots)
      for (const key of ["p", "incoming", "outgoing"] as const)
        knot[key] = add(knot[key], delta);
    expect(dist(center(aligned, 0), anchor.contact)).toBeLessThan(1e-8);
  }
});

const endpointCases = ([0, 1] as const).flatMap((referenceEnd) =>
  ([0, 1] as const).flatMap((ownEnd) =>
    [0, Math.PI / 4, Math.PI / 2].flatMap((angle) =>
      [0, 2].map((median) => ({ referenceEnd, ownEnd, angle, median })),
    ),
  ),
);
it.each(endpointCases)(
  "matches physical 4m lanes at both rotated curved/asymmetric endpoints ($referenceEnd/$ownEnd, angle=$angle, median=$median)",
  ({ referenceEnd, ownEnd, angle, median }) => {
    const rotate = (p: ReturnType<typeof v>) =>
        v(
          p.x * Math.cos(angle) - p.z * Math.sin(angle),
          p.x * Math.sin(angle) + p.z * Math.cos(angle),
          p.y,
        ),
      reference = makeRoad(
        rotate(v(-70, -10)),
        rotate(v()),
        {
          twoWay: true,
          lanesStart: 3,
          lanesEnd: 3,
          backwardLanesStart: 2,
          backwardLanesEnd: 2,
          width: 4,
          sectionOffset: 7,
          median: { kind: "concrete", width: median },
        },
        rotate(v(-55, -25)),
        rotate(v(-15, 12)),
      ),
      direction = mul(
        tangent(reference, referenceEnd),
        ownEnd === referenceEnd ? -1 : 1,
      ),
      skew = v(
        direction.x * Math.cos(0.3) - direction.z * Math.sin(0.3),
        direction.x * Math.sin(0.3) + direction.z * Math.cos(0.3),
      ),
      end = add(point(reference, referenceEnd), v(3, -4)),
      far = add(end, mul(skew, ownEnd === 0 ? 70 : -70)),
      proposed = makeRoad(ownEnd === 0 ? end : far, ownEnd === 0 ? far : end, {
        twoWay: true,
        lanesStart: 2,
        lanesEnd: 2,
        backwardLanesStart: 1,
        backwardLanesEnd: 1,
        width: 4,
        sectionOffset: -3,
        median: { kind: "concrete", width: median },
      }),
      anchors = laneAnchors(reference, referenceEnd, proposed, ownEnd);
    expect(anchors.length).toBeGreaterThan(1);
    expect(
      new Set(anchors.map((a) => laneDirection(proposed, a.ownLanes[0]))).size,
    ).toBe(2);
    for (const anchor of anchors) {
      const aligned = structuredClone(proposed);
      attachLanes(
        aligned,
        ownEnd,
        reference,
        referenceEnd,
        anchor.lanes,
        anchor.ownLanes,
      );
      expect(dist(point(aligned, ownEnd), anchor.position)).toBeLessThan(1e-8);
      for (let i = 0; i < anchor.lanes.length; i++) {
        const ownLane = anchor.ownLanes[i],
          lane = anchor.lanes[i],
          from = mul(tangent(aligned, ownEnd), laneDirection(aligned, ownLane)),
          to = mul(
            tangent(reference, referenceEnd),
            laneDirection(reference, lane),
          );
        expect(
          dist(
            lanePoint(aligned, ownLane, ownEnd),
            lanePoint(reference, lane, referenceEnd),
          ),
        ).toBeLessThan(1e-8);
        expect(laneWidth(aligned, ownLane, ownEnd)).toBe(4);
        expect(
          (laneExitT(aligned, ownLane) === ownEnd) !==
            (laneExitT(reference, lane) === referenceEnd),
        ).toBe(true);
        expect(from.x * to.x + from.z * to.z).toBeCloseTo(1);
      }
      const committed = structuredClone(aligned);
      attachLanes(
        committed,
        ownEnd,
        reference,
        referenceEnd,
        anchor.lanes,
        anchor.ownLanes,
      );
      for (let i = 0; i < committed.knots.length; i++)
        for (const key of ["p", "incoming", "outgoing"] as const)
          expect(
            dist(committed.knots[i][key], aligned.knots[i][key]),
          ).toBeLessThan(1e-8);
      expect(committed.autoTaper).toBeUndefined();
      expect(committed.transitionMode).toBe("direct");
    }
  },
);

it("rejects a nearby endpoint approached from the wrong side instead of reversing its spline", () => {
  const reference = makeRoad(v(-80, 0), v(), { twoWay: true }),
    proposed = makeRoad(v(-60, 0), v(), { twoWay: true });
  expect(laneAnchors(reference, 1, proposed, 1)).toEqual([]);
  expect(() => attachLanes(proposed, 1, reference, 1, [2], [2])).toThrow(
    /方向/,
  );
});
