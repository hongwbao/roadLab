import { describe, expect, it } from "vitest";
import {
  add,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  mul,
  tangent,
  v,
} from "../src/core/math";
import {
  attachmentAllows,
  attachLanes,
  endpointLaneGroups,
} from "../src/core/lane-rules";
import { laneAnchors } from "../src/core/snapping";
import {
  connections,
  emptyProject,
  makeBranch,
  makeRoad,
  parseProject,
  removeRoads,
  splitRoad,
} from "../src/core/model";
import { Simulation } from "../src/simulation/simulation";
import { setJunctionLaneRule } from "../src/core/junction-lane-connections";
import { Editor } from "../src/editor/editor";
import type { Road, V } from "../src/core/types";

const options = (lanes: number) => ({
  lanesStart: lanes,
  lanesEnd: lanes,
  width: 3.5,
  twoWay: false,
});

describe("persistent lane-level road attachment", () => {
  it.each([0, 1, 2, 3])(
    "attaches a single lane to lane %i of a four-lane approach",
    (lane) => {
      const reference = makeRoad(v(-80, 0), v(0, 0), options(4));
      const road = makeRoad(v(0, 0), v(80, 15), options(1));
      attachLanes(road, 0, reference, 1, [lane], [0]);
      const p = emptyProject();
      p.roads = [reference, road];
      expect(
        dist(lanePoint(reference, lane, 1), lanePoint(road, 0, 0)),
      ).toBeLessThan(1e-8);
      expect(tangent(road, 0)).toEqual(tangent(reference, 1));
      expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
        [lane, 0],
      ]);
      expect(connections(parseProject(JSON.stringify(p)))).toEqual(
        connections(p),
      );
    },
  );
  it.each([0, 1, 2])(
    "aligns a contiguous two-lane group starting at %i",
    (lane) => {
      const reference = makeRoad(v(0, 0), v(80, 0), options(4));
      const road = makeRoad(v(-80, 15), v(0, 0), options(2));
      const anchors = laneAnchors(reference, 0, road, 1);
      expect(anchors).toHaveLength(3);
      attachLanes(road, 1, reference, 0, [lane, lane + 1], [0, 1]);
      const p = emptyProject();
      p.roads = [reference, road];
      expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
        [0, lane],
        [1, lane + 1],
      ]);
      for (let i = 0; i < 2; i++)
        expect(
          dist(lanePoint(road, i, 1), lanePoint(reference, lane + i, 0)),
        ).toBeLessThan(1e-8);
    },
  );
  it("selects reverse-direction lanes at the start of a two-way road", () => {
    const reference = makeRoad(v(0, 0), v(80, 0), {
      ...options(3),
      twoWay: true,
    });
    const road = makeRoad(v(0, 0), v(-60, 0), options(1));
    const groups = endpointLaneGroups(reference, 0, road, 0);
    expect(groups.map((g) => g.lanes)).toEqual([[2], [1], [0]]);
    attachLanes(road, 0, reference, 0, [1], [0]);
    const p = emptyProject();
    p.roads = [reference, road];
    expect(connections(p).map((c) => [c.from.lane, c.to.lane])).toEqual([
      [1, 0],
    ]);
    expect(tangent(road, 0).x).toBeCloseTo(-1);
  });
  it("keeps lane references valid through automatic splits and removes deleted references", () => {
    const p = emptyProject(),
      reference = makeRoad(v(-100, 0), v(0, 0), options(4)),
      road = makeRoad(v(0, 0), v(80, 0), options(1));
    attachLanes(road, 0, reference, 1, [2], [0]);
    p.roads = [reference, road];
    const second = splitRoad(p, reference.id, 0.5)!;
    expect(road.attachments?.start?.road).toBe(second);
    expect(
      connections(p).some(
        (c) =>
          c.from.road === second && c.to.road === road.id && c.from.lane === 2,
      ),
    ).toBe(true);
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    removeRoads(p, new Set([second]));
    expect(road.attachments?.start).toBeUndefined();
    expect(() => parseProject(JSON.stringify(p))).not.toThrow();
  });
  it.each(["left", "right"] as const)(
    "builds a smooth generic 4 → 2+2 split on the %s",
    (side) => {
      const p = emptyProject(),
        road = makeRoad(v(-100, 0), v(0, 0), options(4));
      p.roads = [road];
      const rampId = makeBranch(p, road.id, false, {
        lanes: 2,
        side,
        length: 100,
        offset: 35,
      });
      const ramp = p.roads.find((r) => r.id === rampId)!;
      const outgoing = connections(p).filter((c) => c.from.road === road.id);
      expect(outgoing).toHaveLength(4);
      expect(
        outgoing.filter((c) => c.to.road === ramp.id).map((c) => c.from.lane),
      ).toEqual(side === "left" ? [0, 1] : [2, 3]);
      for (const c of outgoing) {
        const target = p.roads.find((r) => r.id === c.to.road)!;
        expect(
          dist(
            lanePoint(road, c.from.lane, 1),
            lanePoint(target, c.to.lane, 0),
          ),
        ).toBeLessThan(1e-8);
        expect(tangent(target, 0).x).toBeCloseTo(1);
      }
      expect(() => parseProject(JSON.stringify(p))).not.toThrow();
    },
  );
});

it("lane turn restrictions affect reachable routes and survive save/load", () => {
  const p = emptyProject(),
    o = { ...options(3), twoWay: true };
  const west = makeRoad(v(-100, 0), v(0, 0), o),
    east = makeRoad(v(0, 0), v(100, 0), o),
    north = makeRoad(v(0, -100), v(0, 0), o),
    south = makeRoad(v(0, 0), v(0, 100), o);
  p.roads = [west, east, north, south];
  p.ports = [
    { road: west.id, end: "start", type: "both", rate: 30 },
    { road: north.id, end: "start", type: "both", rate: 30 },
  ];
  const before = connections(p).filter((c) => c.from.road === west.id);
  expect(before.some((c) => c.to.road === north.id)).toBe(true);
  west.turns = { 3: ["straight"], 4: ["left"], 5: ["right"] };
  const after = connections(p).filter((c) => c.from.road === west.id);
  expect(
    after.filter((c) => c.to.road === north.id).map((c) => c.from.lane),
  ).toEqual([4]);
  expect(
    after.filter((c) => c.to.road === east.id).map((c) => c.from.lane),
  ).toEqual([3]);
  west.turns[4] = [];
  expect(
    connections(p).some(
      (c) => c.from.road === west.id && c.to.road === north.id,
    ),
  ).toBe(false);
  const sim = new Simulation();
  sim.configure(p);
  expect(sim.routeCount).toBe(1); // Return journey remains, restricted outward journey is unreachable.
  expect(connections(parseProject(JSON.stringify(p)))).toEqual(connections(p));
});

it("rejects corrupt lane references and turn data when importing", () => {
  const p = emptyProject(),
    road = makeRoad(v(0, 0), v(80, 0), options(4));
  p.roads = [road];
  road.turns = { 4: ["left"] };
  expect(() => parseProject(JSON.stringify(p))).toThrow(/转向/);
  delete road.turns;
  road.attachments = {
    start: { road: "missing", end: 1, lanes: [1], ownLanes: [0] },
  };
  expect(() => parseProject(JSON.stringify(p))).toThrow(/吸附/);
});

it("traffic actually enters the chosen inner lane and completes its journey", () => {
  const p = emptyProject(),
    target = makeRoad(v(0, 0), v(100, 0), options(4)),
    source = makeRoad(v(-100, -1.75), v(0, -1.75), options(1));
  attachLanes(source, 1, target, 0, [1], [0]);
  p.roads = [source, target];
  p.ports = [
    { road: source.id, end: "start", type: "source", rate: 12 },
    { road: target.id, end: "end", type: "sink", rate: 0 },
  ];
  const sim = new Simulation();
  sim.configure(p);
  sim.running = true;
  let observedEntry = false;
  for (let i = 0; i < 1600; i++) {
    sim.update(0.05);
    if (
      sim.vehicles.some(
        (car) => car.route[1]?.road === target.id && car.route[1].inLane === 1,
      )
    )
      observedEntry = true;
  }
  expect(observedEntry).toBe(true);
  expect(sim.completed).toBeGreaterThan(5);
  expect(sim.statistics.safetyStops).toBe(0);
});

it("permits a new explicit lane attachment to a road that already has another incoming attachment", () => {
  const p = emptyProject(),
    previous = makeRoad(v(-100, 0), v(0, 0), options(4)),
    target = makeRoad(v(0, 0), v(100, 0), options(4)),
    ramp = makeRoad(v(-80, 25), v(0, 0), options(1));
  attachLanes(target, 0, previous, 1, [0, 1, 2, 3], [0, 1, 2, 3]);
  attachLanes(ramp, 1, target, 0, [2], [0]);
  p.roads = [previous, target, ramp];
  const links = connections(p);
  expect(
    links.filter((c) => c.from.road === previous.id && c.to.road === target.id),
  ).toHaveLength(4);
  expect(
    links
      .filter((c) => c.from.road === ramp.id && c.to.road === target.id)
      .map((c) => c.to.lane),
  ).toEqual([2]);
  expect(connections(parseProject(JSON.stringify(p)))).toEqual(links);
});

it("keeps the spare lane in a 2+1 → 3 join available without letting a third road steal the chosen group", () => {
  const p = emptyProject(),
    reference = makeRoad(v(-70, 0), v(), { ...options(2), width: 4 }),
    target = makeRoad(v(), v(70, 0), { ...options(3), width: 4 });
  attachLanes(target, 0, reference, 1, [0, 1], [0, 1]);
  const spare = lanePoint(target, 2, 0),
    chosen = lanePoint(target, 0, 0),
    branch = makeRoad(add(spare, v(-70, 25)), spare, {
      ...options(1),
      width: 4,
    }),
    thief = makeRoad(add(chosen, v(-60, -20)), chosen, {
      ...options(1),
      width: 4,
    });
  p.roads = [reference, target, branch, thief];
  const links = connections(p);
  expect(
    links
      .filter((c) => c.from.road === reference.id && c.to.road === target.id)
      .map((c) => [c.from.lane, c.to.lane]),
  ).toEqual([
    [0, 0],
    [1, 1],
  ]);
  expect(
    links
      .filter((c) => c.from.road === branch.id && c.to.road === target.id)
      .map((c) => c.to.lane),
  ).toEqual([2]);
  expect(
    links.filter((c) => c.from.road === thief.id && c.to.road === target.id),
  ).toEqual([]);
  expect(attachmentAllows(target.attachments?.start, 2, reference, 1, 1)).toBe(
    false,
  );
  expect(attachmentAllows(target.attachments?.start, 2, branch, 1, 0)).toBe(
    false,
  );
  expect(attachmentAllows(target.attachments?.start, 2, reference, 0, 1)).toBe(
    false,
  );
  expect(target.autoTaper).toBeUndefined();
  expect(connections(parseProject(JSON.stringify(p)))).toEqual(links);
  setJunctionLaneRule(p, { road: branch.id, lane: 0, end: 1 }, []);
  expect(connections(p).filter((c) => c.from.road === branch.id)).toEqual([]);
  expect(
    connections(parseProject(JSON.stringify(p))).filter(
      (c) => c.from.road === branch.id,
    ),
  ).toEqual([]);
});

it.each([1, -1] as const)(
  "persists both aligned carriageways when direction %i is selected",
  (direction) => {
    const p = emptyProject(),
      reference = makeRoad(v(-70, 0), v(), {
        ...options(2),
        twoWay: true,
        width: 4,
        median: { kind: "concrete", width: 2 },
      }),
      own = makeRoad(v(), v(70, 0), {
        ...options(2),
        twoWay: true,
        width: 4,
        median: { kind: "concrete", width: 2 },
      }),
      group = endpointLaneGroups(reference, 1, own, 0).find(
        (a) => laneDirection(own, a.ownLanes[0]) === direction,
      )!;
    attachLanes(own, 0, reference, 1, group.lanes, group.ownLanes);
    p.roads = [reference, own];
    expect(own.attachments?.start?.ownLanes).toHaveLength(4);
    expect(
      new Set(
        own.attachments?.start?.ownLanes.map((lane) =>
          laneDirection(own, lane),
        ),
      ).size,
    ).toBe(2);
    const links = connections(p);
    expect(links.filter((c) => c.from.road === reference.id)).toHaveLength(2);
    expect(links.filter((c) => c.from.road === own.id)).toHaveLength(2);
    expect(tangent(own, 0).x).toBeCloseTo(1);
    expect(connections(parseProject(JSON.stringify(p)))).toEqual(links);
  },
);

it("leaves an unaligned return direction free for valid geometric links to the target and a third road", () => {
  const p = emptyProject(),
    reference = makeRoad(v(-70, 0), v(), {
      ...options(2),
      twoWay: true,
      width: 4,
      median: { kind: "concrete", width: 2 },
    }),
    own = makeRoad(v(), v(70, 0), {
      ...options(2),
      twoWay: true,
      width: 4,
      backwardLanesStart: 3,
      backwardLanesEnd: 3,
      median: { kind: "concrete", width: 1 },
    }),
    group = endpointLaneGroups(reference, 1, own, 0).find(
      (a) => laneDirection(own, a.ownLanes[0]) === 1,
    )!;
  attachLanes(own, 0, reference, 1, group.lanes, group.ownLanes);
  const returnPoint = lanePoint(own, 0, 0),
    third = makeRoad(returnPoint, add(returnPoint, v(-60, -20)), {
      ...options(1),
      width: 4,
    });
  p.roads = [reference, own, third];
  expect(
    own.attachments?.start?.ownLanes.every(
      (lane) => laneDirection(own, lane) === 1,
    ),
  ).toBe(true);
  const links = connections(p);
  expect(
    links.some(
      (c) =>
        c.from.road === own.id &&
        c.to.road === reference.id &&
        laneDirection(own, c.from.lane) === -1,
    ),
  ).toBe(true);
  expect(
    links.some(
      (c) =>
        c.from.road === own.id && c.from.lane === 0 && c.to.road === third.id,
    ),
  ).toBe(true);
  expect(connections(parseProject(JSON.stringify(p)))).toEqual(links);
});

/** Drive the real editor snap → draft → finish transaction with a projection-only scene. */
function constructionEditor(
  reference: Road,
  draw: Partial<Road>,
  model: "source" | "compatible",
) {
  const editor = Object.create(Editor.prototype) as Editor,
    previews: Road[][] = [],
    p = emptyProject();
  p.roads = [reference];
  Object.assign(editor, {
    project: p,
    tool: "line",
    draw: { ...options(2), width: 4, ...draw, height: 0, endHeight: 0 },
    drawPoints: [],
    drawControlPoints: [],
    laneSnapping: true,
    alignment: "auto",
    laneCandidate: 0,
    laneCandidateKey: "",
    laneCandidateCount: 0,
    laneCandidateOrder: [],
    roadConstructionModel: model,
    assetId: draw.twoWay ? "two-2" : "one-2",
    settings: { snap: true, grid: false },
    continuous: false,
    selected: new Set<string>(),
    onChange: () => {},
    onStatus: () => {},
    onToast: () => {},
    updateSnapFeedback: () => {},
    edit: (fn: () => void) => fn(),
    scene: {
      project: (p: V) => ({ x: p.x * 3, y: p.z * 3 }),
      hit: () => undefined,
      showPreviews: (roads: Road[]) => previews.push(structuredClone(roads)),
      showBuildMarker: () => {},
      showLaneTarget: () => {},
      setHover: () => {},
    },
  });
  return { editor, previews };
}

it.each(["compatible", "source"] as const)(
  "%s editor keeps a selected reverse group stable under Tab and commits the exact endpoint preview",
  (model) => {
    const reference = makeRoad(v(-75, -20), v(), {
        twoWay: true,
        lanesStart: 3,
        lanesEnd: 3,
        backwardLanesStart: 2,
        backwardLanesEnd: 2,
        width: 4,
        sectionOffset: 2,
        median: { kind: "concrete", width: 2 },
      }),
      { editor, previews } = constructionEditor(
        reference,
        {
          twoWay: true,
          backwardLanesStart: 1,
          backwardLanesEnd: 1,
          sectionOffset: -3,
          median: { kind: "concrete", width: 2 },
        },
        model,
      ),
      raw = lanePoint(reference, 0, 1);
    editor.updatePlacement(raw);
    expect(editor.snapInfo?.kind).toBe("lane");
    const count = editor["laneCandidateCount"];
    expect(count).toBeGreaterThan(1);
    for (
      let i = 0;
      i < count && laneDirection(reference, editor.snapInfo!.lanes![0]) !== -1;
      i++
    )
      editor.cycleLane();
    expect(editor.snapInfo?.text).toContain("反向");
    const selected = structuredClone(editor.snapInfo!),
      start = { ...selected.position };
    editor.updatePlacement(add(raw, v(0.05, 0.03)));
    expect(editor.snapInfo?.lanes).toEqual(selected.lanes);
    expect(editor.snapInfo?.ownLanes).toEqual(selected.ownLanes);
    const previewStart = previews.at(-1)![0];
    for (let i = 0; i < selected.lanes!.length; i++)
      expect(
        dist(
          lanePoint(previewStart, selected.ownLanes![i], 0),
          lanePoint(reference, selected.lanes![i], 1),
        ),
      ).toBeLessThan(1e-5);
    Object.assign(editor, {
      drawStartSnap: selected,
      drawPoints: [start],
      drawControlPoints: [editor["placementControlPoint"]],
    });
    const end = add(start, mul(tangent(reference, 1), 65));
    editor.updatePlacement(end, true);
    const preview = previews.at(-1)![0];
    editor.drawPoints.push(editor["placementControlPoint"]!.position);
    editor["drawControlPoints"].push(
      structuredClone(editor["placementControlPoint"]!),
    );
    editor["finishDraw"]();
    const committed = editor.project.roads.find((r) => r.id !== reference.id)!;
    for (const t of [0, 1])
      for (let lane = 0; lane < laneCount(committed); lane++)
        expect(
          dist(lanePoint(committed, lane, t), lanePoint(preview, lane, t)),
        ).toBeLessThan(1e-5);
    expect(committed.autoTaper).toBeUndefined();
  },
);

it.each(["compatible", "source"] as const)(
  "%s editor ignores lanes on another elevation and never offers a wrong-side destination",
  (model) => {
    const reference = makeRoad(v(-70, 0), v(), {
        ...options(2),
        twoWay: true,
        width: 4,
      }),
      { editor } = constructionEditor(reference, { twoWay: true }, model);
    editor.updatePlacement(v(0, 0, 8));
    expect(editor.snapInfo?.kind).not.toBe("lane");
    Object.assign(editor, { drawPoints: [v(-60, 0)], drawControlPoints: [] });
    editor.updatePlacement(v());
    expect(editor.snapInfo?.kind).not.toBe("lane");
  },
);

it.each(
  (["compatible", "source"] as const).flatMap((model) =>
    ([0, 1] as const).map((referenceEnd) => ({ model, referenceEnd })),
  ),
)(
  "$model editor commits the exact curved reverse-lane destination preview at reference end $referenceEnd",
  ({ model, referenceEnd }) => {
    const reference = makeRoad(
        v(-40, -65),
        v(10, 5),
        {
          twoWay: true,
          lanesStart: 3,
          lanesEnd: 3,
          backwardLanesStart: 2,
          backwardLanesEnd: 2,
          width: 4,
          sectionOffset: 3,
          median: { kind: "concrete", width: 2 },
        },
        v(-52, -38),
        v(-8, -4),
      ),
      { editor, previews } = constructionEditor(
        reference,
        {
          twoWay: true,
          backwardLanesStart: 1,
          backwardLanesEnd: 1,
          sectionOffset: -2,
          median: { kind: "concrete", width: 1 },
        },
        model,
      ),
      anchor = reference.knots[referenceEnd === 0 ? 0 : 1].p,
      outward = mul(
        tangent(reference, referenceEnd),
        referenceEnd === 0 ? -1 : 1,
      ),
      start = add(anchor, mul(outward, 70)),
      control = add(add(anchor, mul(outward, 35)), v(6, -4)),
      raw = lanePoint(reference, 0, referenceEnd);
    Object.assign(editor, { tool: "curve", drawPoints: [start, control] });
    editor.updatePlacement(raw);
    expect(editor.snapInfo?.kind).toBe("lane");
    for (
      let i = 0;
      i < editor["laneCandidateCount"] &&
      laneDirection(reference, editor.snapInfo!.lanes![0]) !== -1;
      i++
    )
      editor.cycleLane();
    const selected = structuredClone(editor.snapInfo!),
      preview = previews.at(-1)![0];
    expect(laneDirection(reference, selected.lanes![0])).toBe(-1);
    for (let i = 0; i < selected.lanes!.length; i++)
      expect(
        dist(
          lanePoint(preview, selected.ownLanes![i], 1),
          lanePoint(reference, selected.lanes![i], referenceEnd),
        ),
      ).toBeLessThan(1e-5);
    editor.drawPoints.push(editor["placementControlPoint"]!.position);
    editor["drawControlPoints"].push(
      structuredClone(editor["placementControlPoint"]!),
    );
    editor["finishDraw"]();
    const committed = editor.project.roads.find((r) => r.id !== reference.id)!;
    for (const t of [0, 1])
      for (let lane = 0; lane < laneCount(committed); lane++)
        expect(
          dist(lanePoint(committed, lane, t), lanePoint(preview, lane, t)),
        ).toBeLessThan(1e-5);
    expect(committed.attachments?.end?.end).toBe(referenceEnd);
    expect(committed.autoTaper).toBeUndefined();
  },
);
