import { expect, it } from "vitest";
import { Group, Matrix4 } from "three";
import { Scene } from "../src/render/scene";
import type { Vehicle } from "../src/simulation/simulation";

it("draws every car beyond the old 350-instance limit and reuses grown buffers", () => {
  // Exercise the actual scene batching without constructing a WebGL canvas.
  const scene = Object.create(Scene.prototype) as Scene;
  Object.assign(scene, { cars: new Group() });
  (scene as any).initializeCars();
  const vehicles: Vehicle[] = Array.from({ length: 701 }, (_, id) => ({
    id,
    route: [],
    step: 0,
    s: 0,
    lane: 0,
    speed: 0,
    age: 0,
    color: id % 5,
    position: { x: id * 5, y: 0, z: 0 },
    heading: 0,
    pitch: 0,
  }));
  scene.updateCars(vehicles);
  const {
    bodyInstances: body,
    cabinInstances: cabin,
    wheelInstances: wheels,
  } = scene as any;
  expect(body.count).toBe(vehicles.length);
  expect(cabin.count).toBe(vehicles.length);
  expect(wheels.count).toBe(vehicles.length * 4);
  const lastBody = new Matrix4();
  body.getMatrixAt(vehicles.length - 1, lastBody);
  expect(lastBody.elements.every(Number.isFinite)).toBe(true);
  expect(lastBody.elements[12]).toBe(vehicles.at(-1)!.position.x);
  const lastWheel = new Matrix4();
  wheels.getMatrixAt(vehicles.length * 4 - 1, lastWheel);
  expect(lastWheel.elements.every(Number.isFinite)).toBe(true);
  scene.updateCars(vehicles.slice(0, 10));
  expect((scene as any).bodyInstances).toBe(body);
  expect(body.count).toBe(10);
  for (const mesh of [body, cabin, wheels]) {
    mesh.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
