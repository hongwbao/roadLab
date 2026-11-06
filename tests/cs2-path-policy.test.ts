import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  applyCs2PathResult,
  classifyCs2TrafficBottleneck,
  cs2BlockedPathChain,
  cs2PathfindFailed,
  cs2PathfindRandomPolicy,
  cs2PersonalCarFallbackParameters,
  cs2RequireNewPath,
  cs2SetupCarPathfind,
  cs2StuckPathDecision,
  Cs2BlockerType,
  Cs2PathFlags,
  decideCs2PersonalCarPathAction,
  invalidateCs2Path,
  prepareCs2PersonalCarPathRequest,
  resetCs2UpdatedPath,
  setCs2PathTarget,
  type Cs2PathBlocker,
} from "../src/simulation/cs2-path-policy";
import { calculateCs2PathCost } from "../src/simulation/cs2-routing";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-path-policy-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  mvid: string;
  source: string;
  flags: {
    flags: number;
    require: boolean;
    failed: boolean;
    stuck: boolean;
    updated: boolean;
    resetFlags: number;
    targetFlags: number;
  }[];
  setups: {
    flags: number;
    laneFlags: number;
    personal: boolean;
    expected: {
      flags: number;
      laneFlags: number;
      elementIndex: number;
      queued: number;
    };
  }[];
  applies: {
    flags: number;
    elementIndex: number;
    oldPath: number[];
    resultPath: number[];
    destination: number;
    expected: {
      flags: number;
      elementIndex: number;
      path: number[];
      publishInformation: boolean;
    };
  }[];
  chains: {
    self: number;
    target: number | null;
    initial: Cs2PathBlocker;
    records: (Cs2PathBlocker & { id: number })[];
    controllers: { id: number; controller: number }[];
    expected: boolean;
  }[];
  bottlenecks: {
    groupCount: number;
    blocker: Cs2PathBlocker;
    expected: string;
  }[];
  stability: {
    stable: boolean;
    sample: number;
    cost: number;
    afterState: number;
    afterDrawState: number;
  }[];
};

it("retains direct-DLL flag evidence separately from extracted world adapters", () => {
  expect(oracle.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
  expect(oracle.source).toContain("directly executed");
  expect(oracle.source).toContain("source-extracted");
  expect(oracle.flags).toHaveLength(8192);
});

it("matches original VehicleUtils for every combination of the 13 PathFlags bits", () => {
  for (const row of oracle.flags) {
    const owner = { flags: row.flags, elementIndex: 1 };
    const require = cs2RequireNewPath(owner.flags);
    const failed = cs2PathfindFailed(owner.flags);
    const stuck = !!(owner.flags & Cs2PathFlags.Stuck);
    const updated = resetCs2UpdatedPath(owner);
    const resetFlags = owner.flags;
    owner.flags = row.flags;
    setCs2PathTarget(owner);
    expect(
      {
        flags: row.flags,
        require,
        failed,
        stuck,
        updated,
        resetFlags,
        targetFlags: owner.flags,
      },
      `flags ${row.flags}`,
    ).toEqual(row);
  }
});

it("matches source setup and PersonalCar-specific flag preparation", () => {
  for (const row of oracle.setups) {
    const owner = { flags: row.flags, elementIndex: 1 };
    const laneFlags = row.personal
      ? prepareCs2PersonalCarPathRequest(owner, row.laneFlags)
      : cs2SetupCarPathfind(owner, row.laneFlags);
    expect(
      { flags: owner.flags, laneFlags, elementIndex: owner.elementIndex },
      `setup ${row.flags}/${row.personal}`,
    ).toEqual({
      flags: row.expected.flags,
      laneFlags: row.expected.laneFlags,
      elementIndex: row.expected.elementIndex,
    });
    expect(row.expected.queued).toBe(1);
  }
});

it("matches source result acceptance, stale results, append and failed paths", () => {
  for (const row of oracle.applies) {
    const owner = { flags: row.flags, elementIndex: row.elementIndex };
    const result = applyCs2PathResult(owner, row.oldPath, row.resultPath, {
      destination: row.destination,
    });
    expect(
      { flags: owner.flags, elementIndex: owner.elementIndex, ...result },
      `result ${row.flags}/${row.resultPath.length}`,
    ).toEqual(row.expected);
  }
});

it("matches extracted StuckMovingObjectSystem blocker-chain traversal", () => {
  for (const [i, row] of oracle.chains.entries())
    expect(
      cs2BlockedPathChain(
        row.self,
        row.target,
        row.initial,
        new Map(row.records.map((record) => [record.id, record])),
        new Map(
          row.controllers.map((record) => [record.id, record.controller]),
        ),
      ),
      `chain ${i}`,
    ).toBe(row.expected);
});

it("matches source bottleneck notification thresholds without requesting routes", () => {
  for (const row of oracle.bottlenecks)
    expect(classifyCs2TrafficBottleneck(row.groupCount, row.blocker)).toBe(
      row.expected,
    );
});

it("leaves an ordinary unchanged route intact for repeated congested/red-light updates", () => {
  const owner = { flags: 0, elementIndex: 2 };
  for (let i = 0; i < 1000; i++)
    expect(
      decideCs2PersonalCarPathAction({
        owner,
        laneFlags: 0,
        personalFlags: 8,
        targetExists: true,
      }).action,
    ).toBe("continue");
  expect(owner.flags).toBe(0);
  invalidateCs2Path(owner);
  expect(
    decideCs2PersonalCarPathAction({
      owner,
      laneFlags: 0,
      personalFlags: 8,
      targetExists: true,
    }).action,
  ).toBe("request");
});

it("requests again after an obsolete in-flight result instead of waiting for a cooldown", () => {
  const owner = { flags: Cs2PathFlags.Obsolete, elementIndex: 1 };
  prepareCs2PersonalCarPathRequest(owner, 0);
  expect(cs2RequireNewPath(owner.flags)).toBe(false);
  invalidateCs2Path(owner);
  const stale = applyCs2PathResult(owner, [1, 2], [3, 4]);
  expect(stale.publishInformation).toBe(false);
  expect(stale.path).toEqual([]);
  expect(cs2RequireNewPath(owner.flags)).toBe(true);
});

it("treats Failed/Stuck as failure handling rather than an automatic retry", () => {
  for (const flag of [Cs2PathFlags.Failed, Cs2PathFlags.Stuck]) {
    const owner = { flags: flag | Cs2PathFlags.Obsolete, elementIndex: 0 };
    expect(cs2RequireNewPath(owner.flags)).toBe(false);
    expect(
      decideCs2PersonalCarPathAction({
        owner,
        laneFlags: 0,
        personalFlags: 8,
        targetExists: true,
      }).action,
    ).toBe("invalid");
  }
});

it("distinguishes arrival, waypoint refresh and delegated parking activity", () => {
  const run = (laneFlags: number, personalFlags = 8) =>
    decideCs2PersonalCarPathAction({
      owner: { flags: 0, elementIndex: 0 },
      laneFlags,
      personalFlags,
      targetExists: true,
    });
  expect(run(3).action).toBe("arrived");
  expect(run(3, 1).action).toBe("activity");
  expect(run(2 | 512)).toMatchObject({ action: "request", laneFlags: 2 });
  expect(run(2 | 16).action).toBe("activity");
  expect(run(0, 4).action).toBe("activity");
});

it("marks actual blocking cycles, but preserves pending requests and temporary stops", () => {
  const blocker = { blocker: 2, type: Cs2BlockerType.Crossing, maxSpeed: 0 };
  const blockers = new Map<number, Cs2PathBlocker>([
    [1, blocker],
    [2, { blocker: 1, type: Cs2BlockerType.Crossing, maxSpeed: 0 }],
  ]);
  const base = { self: 1, target: 9, blocker, blockers };
  expect(cs2StuckPathDecision({ ...base, ownerFlags: 0 })).toEqual({
    flags: Cs2PathFlags.Stuck,
    requestSpaceFor: 2,
  });
  expect(
    cs2StuckPathDecision({ ...base, ownerFlags: Cs2PathFlags.Pending }),
  ).toEqual({ flags: Cs2PathFlags.Pending, requestSpaceFor: 2 });
  expect(
    cs2StuckPathDecision({
      ...base,
      ownerFlags: 0,
      blocker: { ...blocker, type: Cs2BlockerType.Temporary },
    }).flags,
  ).toBe(0);
});

it("uses the source no-resident fallback and leaves Stable disabled", () => {
  expect(cs2PersonalCarFallbackParameters(30)).toEqual({
    maxSpeed: [30, 30],
    walkSpeed: [Math.fround(5.555556), Math.fround(5.555556)],
    weights: [1, 1, 1, 1],
    pathfindFlags: 0,
    stable: false,
    ignoreFlow: false,
  });
});

it("matches original random edge costs and records the draw consumed even when Stable", () => {
  for (const row of oracle.stability) {
    const policy = cs2PathfindRandomPolicy(row.stable ? 1 : 0);
    expect(policy.stable).toBe(row.stable);
    expect(policy.consumeSample).toBe(true);
    expect(row.afterState).toBe(row.afterDrawState);
    expect(
      calculateCs2PathCost(
        {
          length: 100,
          maxSpeed: 10,
          flowOffset: 0,
          costs: [0, 0, 0, 0],
          methods: 2,
        },
        {
          maxSpeed: [10, 10],
          walkSpeed: [5.555556, 5.555556],
          weights: [1, 1, 1, 1],
          methods: 2,
        },
        policy.stable ? 1 : row.sample,
      ),
    ).toBe(Math.fround(row.cost));
  }
});
