import { expect, it } from "vitest";
import { v } from "../src/core/math";
import {
  connections,
  emptyProject,
  makeRoad,
  validate,
} from "../src/core/model";
import { findRoute, Simulation } from "../src/simulation/simulation";
import { sharedRoadMap } from "../src/core/shared-map";

it("routes each ramp into the surviving lane before the taper ends", () => {
  const p = sharedRoadMap();
  expect(validate(p).filter((issue) => issue.severity === "error")).toEqual([]);
  const links = connections(p);
  for (const [ramp, merge] of [
    ["r-mw3ni79w-ikx", "r-mw3ni79w-ikv"],
    ["r-mw3nk6ej-oh3", "r-mw3nk6ej-oh1"],
  ]) {
    const source = p.ports.find((port) => port.road === ramp)!;
    const sink = p.ports.find((port) => port.road === merge)!;
    const route = findRoute(p, source, sink, links);
    expect(route?.at(-1)).toMatchObject({
      road: merge,
      inLane: 2,
      outLane: 1,
    });
  }

  const short = makeRoad(v(0, 0), v(24, 0), {
    lanesStart: 3,
    lanesEnd: 2,
    align: "left",
  });
  const impossible = emptyProject();
  impossible.roads = [short];
  expect(
    findRoute(
      impossible,
      { road: short.id, end: "start", type: "source", rate: 1 },
      { road: short.id, end: "end", type: "sink", rate: 1 },
      [],
      2,
      undefined,
      0.01,
    ),
  ).toBeUndefined();
});

it("keeps every branch of the shared map flowing at 400% demand", () => {
  const p = sharedRoadMap();
  const sim = new Simulation();
  sim.configure(p);
  sim.running = true;
  expect(sim.routeCount).toBe(12);
  const finishedByRoad = new Map<string, number>();
  let active = new Map<number, string>();
  let lastCompleted = 0;
  for (let i = 0; i < 4800; i++) {
    sim.update(0.05);
    const now = new Map(
      sim.vehicles.map((car) => [car.id, car.route.at(-1)!.road]),
    );
    for (const [id, sink] of active)
      if (!now.has(id))
        finishedByRoad.set(sink, (finishedByRoad.get(sink) ?? 0) + 1);
    active = now;
    if (i % 1200 === 1199) {
      expect(sim.completed - lastCompleted).toBeGreaterThan(150);
      lastCompleted = sim.completed;
    }
  }
  for (const sink of p.ports.filter((port) => port.type !== "source"))
    expect(finishedByRoad.get(sink.road) ?? 0).toBeGreaterThan(25);
  if (process.env.DEBUG_SHARED_MAP)
    console.log({
      generated: sim.generated,
      entered: sim.entered,
      completed: sim.completed,
      waiting: sim.waiting,
      queued: sim.queued,
      finishedByRoad: Object.fromEntries(finishedByRoad),
    });
}, 30000);
