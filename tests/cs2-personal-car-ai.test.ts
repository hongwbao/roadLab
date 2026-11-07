import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2PersonalCarAITransaction,
  runCS2PersonalCarAI,
  createCS2PersonalCarWorld,
  type CS2PersonalCarInput,
  type CS2PersonalCarWorld,
  type CS2PersonalCarState,
  type CS2PersonalCarCommand,
  type CS2PersonalCarNativeRequest,
  type CS2PersonalCarNativeReply,
} from "../src/simulation/cs2-personal-car-ai";

type EncodedWorld = {
  [K in keyof CS2PersonalCarWorld]: CS2PersonalCarWorld[K] extends ReadonlyMap<
    string,
    infer TValue
  >
    ? Record<string, TValue>
    : CS2PersonalCarWorld[K] extends ReadonlySet<string>
      ? string[]
      : CS2PersonalCarWorld[K];
};
type Scenario = {
  id: string;
  world: EncodedWorld;
  input: CS2PersonalCarInput;
  replies: CS2PersonalCarNativeReply[];
  expected: {
    status: "complete" | "pending";
    state: CS2PersonalCarState;
    commands: CS2PersonalCarCommand[];
    queries: CS2PersonalCarNativeRequest[];
    randomState: number;
    repliesConsumed: number;
  };
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-personal-car-ai-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    kind: string;
    sha256: string;
    mvid: string;
    methods: { name: string; ilSha256: string }[];
    changes: string[];
  };
  cases: Scenario[];
};
const maps = [
  "lanes",
  "passengers",
  "currentVehicles",
  "paths",
  "pathOwners",
  "targets",
  "residents",
  "householdMembers",
  "propertyRenters",
  "households",
  "householdCitizens",
  "citizens",
  "workers",
  "travelPurposes",
  "diverts",
] as const;
function world(input: EncodedWorld): CS2PersonalCarWorld {
  return {
    ...input,
    ...Object.fromEntries(
      maps.map((key) => [key, new Map(Object.entries(input[key]))]),
    ),
    entities: new Set(input.entities),
    movingAway: new Set(input.movingAway),
  } as unknown as CS2PersonalCarWorld;
}
function f32<T>(input: T): T {
  if (typeof input === "number")
    return (Number.isInteger(input) ? input : Math.fround(input)) as T;
  if (Array.isArray(input)) return input.map(f32) as T;
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, f32(v)]),
    ) as T;
  return input;
}
function compare(actual: unknown, expected: unknown, path: string) {
  if (typeof expected === "number") {
    if (
      /\.(flags|carFlags|randomState|repliesConsumed|elementIndex|methods|ignoredRules|taxiIgnoredRules|activityMask)$/.test(
        path,
      )
    )
      expect(actual, path).toBe(expected);
    else
      expect(
        Math.abs((actual as number) - Math.fround(expected)),
        path,
      ).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 6e-7));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((value, index) =>
      compare((actual as unknown[])[index], value, `${path}[${index}]`),
    );
  } else if (expected && typeof expected === "object") {
    expect(Object.keys(actual as object).sort(), path).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, value] of Object.entries(expected))
      compare(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
  } else expect(actual, path).toEqual(expected);
}
function run(row: Scenario) {
  const source = f32(row),
    transaction = new CS2PersonalCarAITransaction(
      world(source.world),
      source.input,
    ),
    queries: CS2PersonalCarNativeRequest[] = [];
  let result = transaction.advance(),
    repliesConsumed = 0;
  while (result.status === "pending") {
    queries.push(result.request);
    if (repliesConsumed === source.replies.length) break;
    result = transaction.advance(source.replies[repliesConsumed++]);
  }
  return {
    status: result.status,
    state: transaction.state,
    commands: transaction.commands,
    queries,
    randomState:
      result.status === "complete"
        ? result.randomState
        : result.request.randomState,
    repliesConsumed,
  };
}
describe("complete PersonalCarAI owner-method extraction and explicit native contracts", () => {
  it("records every owner helper and distinguishes scripted parking from original DLL pure helpers", () => {
    expect(oracle.provenance.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.provenance.kind).toContain("every helper");
    expect(oracle.provenance.kind).toContain(
      "explicitly scripted native parking contracts",
    );
    for (const method of [
      "Tick",
      "ResetPath",
      "CheckParkingSpace",
      "StartBoarding",
      "StopBoarding",
      "StartDisembarking",
      "StopDisembarking",
      "ParkCar",
      "FindNewPath",
    ])
      expect(
        oracle.provenance.methods.some(
          (m) => m.name === method && m.ilSha256.length === 64,
        ),
      ).toBe(true);
  });
  for (const row of oracle.cases)
    it(`matches full owner state, requests, RNG and ordered commands: ${row.id}`, () => {
      compare(run(row), row.expected, row.id);
    });
});

it("keeps resident failure recovery distinct from DummyTraffic deletion and completed arrival", () => {
  const dummy = structuredClone(
      oracle.cases.find((row) => row.id === "tick-state-8-64-0")!,
    ),
    normal = structuredClone(dummy);
  normal.input.state.personalCar.flags = 0;
  const a = runCS2PersonalCarAI(world(dummy.world), dummy.input),
    b = runCS2PersonalCarAI(world(normal.world), normal.input);
  expect(a.status).toBe("complete");
  expect(b.status).toBe("complete");
  if (a.status === "complete" && b.status === "complete") {
    expect(a.outcome).toEqual({ kind: "deleted", reason: "path-failure" });
    expect(
      a.commands.some(
        (c) => c.kind === "add-component" && c.component === "Deleted",
      ),
    ).toBe(true);
    expect(b.outcome).toEqual({ kind: "parked", reason: "path-failure" });
    expect(
      b.commands.some(
        (c) => c.kind === "set-component" && c.component === "ParkedCar",
      ),
    ).toBe(true);
    expect(
      b.commands.some(
        (c) => c.kind === "add-component" && c.component === "Deleted",
      ),
    ).toBe(false);
  }
});
it("waits for native world answers without committing partial commands or replaying the Tick", () => {
  const row = oracle.cases.find((x) => x.id === "reply-validate-p")!;
  const pending = runCS2PersonalCarAI(world(row.world), row.input);
  expect(pending.status).toBe("pending");
  if (pending.status !== "pending") return;
  expect(pending.request.kind).toBe("validate-parking-space");
  expect(() => pending.transaction.advance()).toThrow(
    "requires an explicit reply",
  );
  const complete = pending.transaction.advance({ result: "p" });
  expect(complete.status).toBe("complete");
  if (complete.status === "complete")
    compare(complete.state, row.expected.state, "resumed state");
});
it("does not execute personal owner logic while TripSource hands ownership to another source system", () => {
  const row = oracle.cases.find((x) => x.id === "excluded-tripSource")!,
    result = runCS2PersonalCarAI(world(row.world), row.input);
  expect(result.status).toBe("complete");
  if (result.status === "complete") {
    expect(result.outcome).toEqual({
      kind: "filtered",
      reason: "excluded-query",
    });
    expect(result.commands).toEqual([]);
  }
});

it("preserves parking search failure, prior parking alternatives and boarding household effects", () => {
  const failed = oracle.cases.find(
      (x) => x.id === "find-free-parking-False-reserved-True",
    )!,
    available = oracle.cases.find(
      (x) => x.id === "find-free-parking-True-reserved-True",
    )!;
  const a = run(failed),
    b = run(available);
  expect(a.state.pathOwner.flags & 4).toBe(4);
  expect(b.state.pathOwner.flags & 4).toBe(0);
  expect(a.queries[0].input.minT).toBe(Math.fround(0.8));
  expect(
    run(
      oracle.cases.find((x) => x.id === "prior-parking-before-full-garage-p")!,
    ).state.pathOwner.flags & 4,
  ).toBe(0);
  expect(
    run(
      oracle.cases.find((x) => x.id === "prior-parking-before-full-garage-a")!,
    ).state.pathOwner.flags & 4,
  ).toBe(4);
  const home = run(
    oracle.cases.find((x) => x.id === "passenger-False-0-2-leader")!,
  );
  expect(home.state.personalCar.flags & 17).toBe(17);
  expect(home.state.target).toBe("home");
  expect(home.state.path[0].target).toBe("b");
});
it("charges the resident household once when disembarking begins and waits for real passenger removal", () => {
  const row = oracle.cases.find(
      (x) => x.id === "disembark-layout-None-p-failed-False-occupied-True",
    )!,
    first = runCS2PersonalCarAI(world(row.world), row.input);
  expect(first.status).toBe("complete");
  if (first.status !== "complete") return;
  expect(first.state.personalCar.flags & 4).toBe(4);
  expect(first.commands.filter((c) => c.kind === "money-transfer")).toEqual([
    {
      kind: "money-transfer",
      payer: "household",
      recipient: "city",
      amount: 20,
    },
  ]);
  const second = runCS2PersonalCarAI(world(row.world), {
    ...row.input,
    state: first.state,
  });
  expect(second.status).toBe("complete");
  if (second.status !== "complete") return;
  expect(second.state.personalCar.flags & 4).toBe(4);
  expect(second.commands).toEqual([]);
});
it("enforces the real mutable-argument boundaries of unresolved native parking callbacks", () => {
  const row = oracle.cases.find(
    (x) => x.id === "find-free-parking-None-reserved-False",
  )!;
  const result = runCS2PersonalCarAI(world(row.world), row.input);
  expect(result.status).toBe("pending");
  if (result.status !== "pending") return;
  expect(() => result.transaction.advance({ result: true, path: [] })).toThrow(
    "cannot mutate PathElement buffer",
  );
});

it("allows an explicit minimal boundary-Dummy world without inventing city or resident data", () => {
  const row = oracle.cases.find((x) => x.id === "tick-state-8-0-3")!;
  const simple = createCS2PersonalCarWorld({
    entities: new Set(["car", "outside", "a"]),
    city: null,
    timeOfDay: 0.5,
    lanes: new Map([["a", { car: true }]]),
    passengers: new Map([["car", []]]),
  });
  const result = runCS2PersonalCarAI(simple, row.input);
  expect(result.status).toBe("complete");
  if (result.status === "complete") {
    expect(result.outcome).toEqual({ kind: "deleted", reason: "path-end" });
    expect(result.commands).toEqual([
      { kind: "add-component", entity: "car", component: "Deleted" },
    ]);
  }
  expect(simple.residents.size).toBe(0);
  expect(simple.city).toBeNull();
});
