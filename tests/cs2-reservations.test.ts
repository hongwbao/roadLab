import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  cs2ReserveNavigationLanes,
  type CS2NavigationReservationInput,
  type CS2ReservationLane,
} from "../src/simulation/cs2-reservations";

type Case = {
  id: string;
  world: {
    lanes: Record<string, CS2ReservationLane>;
    owners: Record<string, string[]>;
  };
  input: CS2NavigationReservationInput;
  expected: ReturnType<typeof cs2ReserveNavigationLanes>;
};
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-reservations-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    game_sha256: string;
    methods: { name: string; token: number }[];
    classification: string;
  };
  cases: Case[];
};
const f = Math.fround;
function normalized(result: ReturnType<typeof cs2ReserveNavigationLanes>) {
  return {
    ...result,
    current: {
      ...result.current,
      curvePosition: {
        x: f(result.current.curvePosition.x),
        y: f(result.current.curvePosition.y),
        z: f(result.current.curvePosition.z),
      },
      changeProgress: f(result.current.changeProgress),
      lanePosition: f(result.current.lanePosition),
      duration: f(result.current.duration),
      distance: f(result.current.distance),
    },
    nextLanes: result.nextLanes.map((lane) => ({
      ...lane,
      start: f(lane.start),
      end: f(lane.end),
    })),
  };
}
it("identifies the whole original reservation methods and their execution boundary", () => {
  expect(fixture.provenance.game_sha256).toBe(
    "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
  );
  expect(fixture.provenance.methods.map((method) => method.token)).toEqual([
    100695350, 100695351,
  ]);
  expect(fixture.provenance.classification).toContain("dictionary");
});
for (const testCase of fixture.cases) {
  it(`matches full reservation state, queues and RNG: ${testCase.id}`, () => {
    const input = structuredClone(testCase.input),
      before = structuredClone(input);
    const result = cs2ReserveNavigationLanes(
      {
        lanes: new Map(Object.entries(testCase.world.lanes)),
        owners: new Map(Object.entries(testCase.world.owners)),
      },
      input,
    );
    expect(normalized(result)).toEqual(normalized(testCase.expected));
    expect(input).toEqual(before);
  });
}
