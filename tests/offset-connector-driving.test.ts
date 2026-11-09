import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  bezier,
  dist,
  lanePoint,
  roadLength,
  tangent,
  v,
} from "../src/core/math";
import { connections, emptyProject, makeRoad } from "../src/core/model";
import { setJunctionLaneRule } from "../src/core/junction-lane-connections";
import { Cs2TrafficSimulation } from "../src/simulation/cs2-simulation";
import type { Vehicle } from "../src/simulation/simulation";

const drivingMetrics: unknown[] = [];

/** Exact carriageway counts, medians, offsets and authored target choices from
 * 城市路口实验; translated straight roads keep this regression self-contained.
 * The separate original-save replay preserves the full input and traffic. */
function fixture(direction: 1 | -1, aligned = false) {
  const project = emptyProject(),
    source = makeRoad(v(), v(120, 0), {
      id: "source",
      lanesStart: 3,
      lanesEnd: 3,
      twoWay: true,
      median: { kind: "concrete", width: 4 },
      speed: 60,
    }),
    target = makeRoad(
      direction === 1 ? v(120, 0) : v(-120, 0),
      direction === 1 ? v(240, 0) : v(),
      {
        id: "target",
        lanesStart: direction === 1 ? 5 : 3,
        lanesEnd: direction === 1 ? 5 : 3,
        backwardLanesStart: direction === 1 ? 3 : 5,
        backwardLanesEnd: direction === 1 ? 3 : 5,
        sectionOffset: direction === 1 ? -2 : 2,
        twoWay: true,
        speed: 60,
      },
    ),
    lane = direction === 1 ? 5 : 0,
    destination = direction === 1 ? (aligned ? 6 : 7) : aligned ? 1 : 0,
    end = direction === 1 ? (1 as const) : (0 as const);
  project.roads = [source, target];
  project.ports = [];
  project.trafficMultiplier = 0;
  // Preserve both legal authored choices. A specific trip chooses one target;
  // the fix must not silently remap the offset branch to its aligned neighbor.
  const choices = [
    { road: target.id, lane: direction === 1 ? 6 : 1, end: end === 1 ? 0 : 1 },
    { road: target.id, lane: direction === 1 ? 7 : 0, end: end === 1 ? 0 : 1 },
  ] as const;
  setJunctionLaneRule(
    project,
    { road: source.id, lane, end },
    aligned ? choices.slice(0, 1) : [...choices],
  );
  return {
    project,
    source,
    target,
    lane,
    destination,
    direction,
    id: `source:${lane}>target:${destination}`,
  };
}
function configured(f: ReturnType<typeof fixture>) {
  const sim = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
    deterministicSeed: 19,
  });
  sim.configure(f.project);
  const lane = sim.network!.lanes.get(
    sim.network!.connectionLaneIds.get(f.id)!,
  )!;
  expect(lane).toBeDefined();
  return { sim, lane };
}

it.each([1, -1] as const)(
  "gives the authored4m offset connector positive forward geometry, direction %i",
  (direction) => {
    const f = fixture(direction),
      before = structuredClone(f.project),
      { sim, lane } = configured(f),
      start = lane.curve.points[0],
      end = lane.curve.points[3];
    expect(Math.abs(end.z - start.z)).toBeCloseTo(4, 5);
    expect((end.x - start.x) * direction).toBeGreaterThan(4);
    let previous = start;
    for (let i = 1; i <= 100; i++) {
      const p = bezier(...lane.curve.points, i / 100);
      expect((p.x - previous.x) * direction).toBeGreaterThan(0);
      previous = p;
    }
    const incoming = [...sim.network!.lanes.values()].find(
        (candidate) =>
          candidate.kind === "road" &&
          candidate.role !== "master" &&
          candidate.road === "source" &&
          candidate.lane === f.lane &&
          sim.network!.successors.get(candidate.id)?.includes(lane.id),
      ),
      target = sim.network!.lanes.get(
        sim.network!.successors.get(lane.id)![0],
      )!;
    expect(incoming).toBeDefined();
    expect(dist(incoming!.curve.points[3], start)).toBeLessThan(0.0001);
    expect(dist(target.curve.points[0], end)).toBeLessThan(0.0001);
    expect(target.lane).toBe(f.destination);
    expect(connections(f.project).find((row) => row.id === f.id)?.manual).toBe(
      true,
    );
    expect(f.project).toEqual(before);
    sim.dispose();
  },
);

it.each([1, -1] as const)(
  "drives the actual authored offset without stop, reverse or right-angle steering, direction %i",
  (direction) => {
    const f = fixture(direction);
    // Exercise this legal offset target specifically; otherwise the native
    // selector may choose the other, aligned target and never test this curve.
    // Multi-target preservation is checked separately above and on the saved map.
    setJunctionLaneRule(
      f.project,
      { road: "source", lane: f.lane, end: direction === 1 ? 1 : 0 },
      [{ road: "target", lane: f.destination, end: direction === 1 ? 0 : 1 }],
    );
    const { sim } = configured(f),
      sourceLength = roadLength(f.source),
      s = sourceLength - 65,
      t = direction === 1 ? s / sourceLength : 1 - s / sourceLength,
      heading = Math.atan2(
        tangent(f.source, t).z * direction,
        tangent(f.source, t).x * direction,
      ),
      route = [
        { road: "source", direction, inLane: f.lane, outLane: f.lane },
        {
          road: "target",
          direction,
          inLane: f.destination,
          outLane: f.destination,
        },
      ],
      car: Vehicle = {
        id: 1,
        route,
        step: 0,
        s,
        lane: f.lane,
        speed: 10,
        age: 0,
        color: 0,
        position: lanePoint(f.source, f.lane, t),
        heading,
        pitch: 0,
        nextLaneDecision: Infinity,
      };
    sim.adoptVehicles([car]);
    sim.running = true;
    let minSpeed = Infinity,
      maxAngle = 0,
      samples = 0,
      reversed = false,
      entered = false;
    for (let frame = 0; frame < 2400 && !entered; frame++) {
      sim.update(1 / 60);
      const vehicle = sim.vehicles[0],
        state = sim.runtime!.readVehicle(1);
      if (!vehicle || !state) break;
      const lane = sim.network!.lanes.get(state.current.laneId!)!;
      if (lane.connection === f.id) {
        samples++;
        minSpeed = Math.min(minSpeed, vehicle.speed);
        maxAngle = Math.max(
          maxAngle,
          Math.abs(
            Math.atan2(
              Math.sin(vehicle.heading - heading),
              Math.cos(vehicle.heading - heading),
            ),
          ),
        );
        reversed ||= state.navigation.maxSpeed < 0;
      }
      entered =
        !vehicle.connector &&
        vehicle.route[vehicle.step]?.road === "target" &&
        vehicle.s > 55;
    }
    drivingMetrics.push({
      direction,
      sourceLane: f.lane,
      targetLane: f.destination,
      samples,
      minSpeed,
      maxAngleDegrees: (maxAngle * 180) / Math.PI,
      reversed,
      entered,
    });
    mkdirSync(".cache/city-junction-six-to-five-three", { recursive: true });
    writeFileSync(
      ".cache/city-junction-six-to-five-three/single-car-metrics.json",
      JSON.stringify(drivingMetrics, null, 2),
    );
    expect(samples).toBeGreaterThan(10);
    expect(entered).toBe(true);
    expect(sim.failed).toBe(0);
    expect(minSpeed).toBeGreaterThan(0.5);
    expect(reversed).toBe(false);
    expect(maxAngle).toBeLessThan(Math.PI / 3);
    sim.dispose();
  },
);

it.each([1, -1] as const)(
  "keeps already aligned ordinary lane seams unshifted, direction %i",
  (direction) => {
    const f = fixture(direction, true),
      { sim, lane } = configured(f);
    expect(lane.curve.length).toBeLessThan(0.001);
    expect(dist(lane.curve.points[0], lane.curve.points[3])).toBeLessThan(
      0.001,
    );
    sim.dispose();
  },
);

it("retains an explicit closure and permits restoring the original multiple targets", () => {
  const f = fixture(-1),
    ref = { road: "source", lane: f.lane, end: 0 as const },
    targets = structuredClone(f.project.junctionLaneConnections![0].to);
  setJunctionLaneRule(f.project, ref, []);
  const closed = new Cs2TrafficSimulation({
    synchronousPathsOnlyForTests: true,
  });
  closed.configure(f.project);
  expect(
    [...closed.network!.connectionLaneIds.keys()].some((id) =>
      id.startsWith(`source:${f.lane}>`),
    ),
  ).toBe(false);
  expect(f.project.junctionLaneConnections![0].to).toEqual([]);
  closed.dispose();
  setJunctionLaneRule(f.project, ref, targets);
  const { sim } = configured(f);
  expect(sim.network!.connectionLaneIds.has("source:0>target:1")).toBe(true);
  expect(sim.network!.connectionLaneIds.has("source:0>target:0")).toBe(true);
  expect(f.project.junctionLaneConnections![0].to).toEqual(targets);
  sim.dispose();
});
