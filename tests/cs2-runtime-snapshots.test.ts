import { expect, it } from "vitest";
import { Cs2VehicleRuntime } from "../src/simulation/cs2-vehicle-runtime";
import type { CS2NavigationCurve } from "../src/simulation/cs2-navigation-target";

function setup() {
  const point = (x: number) => ({ x, y: 0, z: 0 });
  const lane: CS2NavigationCurve = {
    id: "lane",
    points: [point(0), point(100 / 3), point(200 / 3), point(100)],
    length: 100,
    width: 3.5,
  };
  const runtime = new Cs2VehicleRuntime(new Map([[lane.id, lane]]));
  const seed = {
    id: 1,
    updateGroup: 15,
    geometry: { width: 1.65, frontExtent: 1.9, pivotOffset: -0.76 },
    state: {
      position: point(0),
      velocity: point(0),
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    },
    navigation: { targetPosition: point(0), maxSpeed: 0 },
    current: {
      laneId: lane.id,
      curvePosition: { x: 0, y: 0, z: 1 },
      changeProgress: 0,
      lanePosition: 0,
      duration: 0,
      distance: 0,
      flags: 1,
    },
    nextLanes: [],
  };
  runtime.addVehicle(seed);
  return { runtime, seed };
}

it("shares immutable snapshots while mutable copy access stays isolated", () => {
  const { runtime } = setup(),
    snapshot = runtime.readVehicle(1)!;
  expect(runtime.readVehicle(1)).toBe(snapshot);
  expect(runtime.readVehicles()).toBe(runtime.readVehicles());
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.frames[0].position)).toBe(true);
  expect(() => {
    (snapshot as any).current.curvePosition.x = 0.5;
  }).toThrow();
  const mutable = runtime.getVehicle(1)!;
  mutable.state.position.x = 999;
  mutable.current.flags = 0;
  expect(runtime.readVehicle(1)).toBe(snapshot);
  expect(runtime.readVehicle(1)!.state.position.x).toBe(0);
  expect(runtime.getVehicle(1)!.current.flags).toBe(1);
});

it("refreshes only changed vehicles and preserves older source snapshots", () => {
  const { runtime } = setup(),
    previous = runtime.readVehicle(1)!,
    list = runtime.readVehicles();
  for (let frame = 0; frame < 15; frame++)
    runtime.stepFrame(frame, () => {
      throw new Error("Wrong source update group");
    });
  expect(runtime.readVehicle(1)).toBe(previous);
  expect(runtime.readVehicles()).toBe(list);
  runtime.stepFrame(15, () => ({ maxSpeed: 5, random01: 0.5 }));
  const updated = runtime.readVehicle(1)!;
  expect(updated).not.toBe(previous);
  expect(updated).toEqual(runtime.getVehicle(1));
  expect(updated.state.position.x).toBeGreaterThan(0);
  expect(previous.state.position.x).toBe(0);
  expect(runtime.readVehicles()).not.toBe(list);
});

it("invalidates in-place full updates and id reuse without changing retained snapshots", () => {
  const { runtime, seed } = setup(),
    before = runtime.readVehicle(1)!;
  runtime.applyFullUpdate(1, {
    position: { x: 25, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: seed.state.rotation,
  });
  const updated = runtime.readVehicle(1)!;
  expect(updated.state.position.x).toBe(25);
  expect(updated.frames.every((frame) => frame.position.x === 25)).toBe(true);
  expect(before.state.position.x).toBe(0);
  runtime.removeVehicle(1);
  expect(runtime.readVehicle(1)).toBeUndefined();
  expect(runtime.readVehicles()).toHaveLength(0);
  runtime.addVehicle(seed);
  expect(runtime.readVehicle(1)).not.toBe(before);
  expect(runtime.readVehicle(1)!.state.position.x).toBe(0);
});
