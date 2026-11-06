import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CS2_OVERLAP,
  cs2AdvanceReservation,
  cs2AircraftPriority,
  cs2ApplyReservation,
  cs2AreaCollisionLimit,
  cs2CheckOverlapSpace,
  cs2EncodeBlockerSpeed,
  cs2IsBlockedChain,
  cs2LanePriorityDelta,
  cs2OverlapDecision,
  cs2OverlapVehicleWindow,
  cs2OverlapWindow,
  cs2PushBlockers,
  cs2QuantizeOverlap,
  cs2QuantizeReservation,
  cs2ReservationOffset,
  cs2ReservationPriority,
  cs2ResolveBlockerSpeed,
  cs2StuckCarDecision,
  cs2TrainPriority,
  cs2VehiclePriority,
  cs2WatercraftPriority,
  type CS2BlockerRecord,
  type CS2LaneOverlap,
  type CS2LaneReservation,
  type CS2OverlapDecisionInput,
} from "../src/simulation/cs2-conflicts";

type Oracle = {
  origin: { sha256: string; mvid: string; gameVersion: string };
  coverage: {
    directOriginalDll: string[];
    extractedCSharpOnly: string[];
    notExecuted: string[];
  };
  priorities: { flags: number; expected: number }[];
  otherPriorities: { kind: string; value: number; expected: number }[];
  quantization: {
    offset: number;
    priority: number;
    expected: { offset: number; priority: number };
  }[];
  reservations: {
    next: { offset: number; priority: number };
    previous: { offset: number; priority: number };
    expected: { offset: number; priority: number };
  }[];
  overlaps: {
    positions: [number, number, number, number];
    flags: number;
    parallelism: number;
    priorityDelta: number;
    expected: CS2LaneOverlap;
  }[];
  decisions: {
    input: CS2OverlapDecisionInput;
    expected: ReturnType<typeof cs2OverlapDecision>;
  }[];
};
const oracle: Oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-conflicts-oracle.json", import.meta.url),
    "utf8",
  ),
);

const decision = (
  override: Partial<CS2OverlapDecisionInput> = {},
): CS2OverlapDecisionInput => ({
  selfPriority: 100,
  priorityDelta: 0,
  yieldOverride: 0,
  otherSignal: 0,
  requestSpace: false,
  reservationOffsetThreshold: 0.5,
  slow: false,
  brakingSpeed: 2,
  speedRange: { min: 0, max: 20 },
  maxSpeed: 15,
  speedLimit: 15,
  canStopBeforeOverlap: true,
  ...override,
});

describe("CS2 conflict source and executable-oracle boundaries", () => {
  it("identifies the supplied DLL and distinguishes actual calls from extraction", () => {
    expect(oracle.origin.sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.origin.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.coverage.directOriginalDll).toHaveLength(7);
    expect(oracle.coverage.extractedCSharpOnly).toContain(
      "CarLaneSpeedIterator.CheckOverlappingLanes reservation branch",
    );
    expect(oracle.coverage.notExecuted).toContain("actual game simulation");
  });

  it("matches original VehicleUtils.GetPriority for ordinary and emergency cars", () => {
    for (const row of oracle.priorities)
      expect(cs2VehiclePriority((row.flags & 1) !== 0)).toBe(row.expected);
  });

  it("matches original train, watercraft and aircraft priorities", () => {
    for (const row of oracle.otherPriorities)
      expect(
        row.kind === "train"
          ? cs2TrainPriority(row.value)
          : row.kind === "watercraft"
            ? cs2WatercraftPriority(row.value)
            : cs2AircraftPriority(),
      ).toBe(row.expected);
  });

  it("matches the original reservation constructor, including halfway ties", () => {
    expect(oracle.quantization).toHaveLength(140);
    for (const row of oracle.quantization)
      expect(cs2QuantizeReservation(row.offset, row.priority)).toEqual(
        row.expected,
      );
  });

  it("matches both original LaneReservation getters over all byte offsets", () => {
    expect(oracle.reservations).toHaveLength(256);
    for (const row of oracle.reservations) {
      const r = { ...row, blocker: null };
      expect(cs2ReservationPriority(r)).toBe(row.expected.priority);
      expect(cs2ReservationOffset(r)).toBeCloseTo(row.expected.offset, 7);
    }
  });

  it("matches the original LaneOverlap constructor for signed deltas and ranges", () => {
    expect(oracle.overlaps).toHaveLength(128);
    for (const row of oracle.overlaps)
      expect(
        cs2QuantizeOverlap(
          row.positions,
          row.flags,
          row.parallelism,
          row.priorityDelta,
        ),
      ).toEqual(row.expected);
  });

  it("matches the separately compiled C# reservation branch (not a Unity run)", () => {
    expect(oracle.decisions).toHaveLength(384);
    for (const row of oracle.decisions)
      expect(cs2OverlapDecision(row.input)).toEqual(row.expected);
  });
});

describe("per-lane reservations and actual overlap windows", () => {
  it("derives source road priority from flags before the crossing tangent side", () => {
    const x = {
      selfFlags: 0,
      otherFlags: 0,
      selfTangent: [1, 0] as const,
      otherTangent: [0, 1] as const,
    };
    expect(cs2LanePriorityDelta(x)).toBe(1);
    expect(cs2LanePriorityDelta({ ...x, leftHandTraffic: true })).toBe(-1);
    expect(cs2LanePriorityDelta({ ...x, otherFlags: 0x800 })).toBe(-1);
    expect(cs2LanePriorityDelta({ ...x, selfFlags: 0x4000000 })).toBe(-1);
    expect(cs2LanePriorityDelta({ ...x, mergeStart: true })).toBe(0);
  });
  it("accumulates offset and priority independently and expires after two buckets", () => {
    const r: CS2LaneReservation = {
      previous: { offset: 200, priority: 100 },
      next: { offset: 20, priority: 96 },
      blocker: "old-blocker",
    };
    const applied = cs2ApplyReservation(r, { offset: 10, priority: 108 });
    expect(applied.next).toEqual({ offset: 20, priority: 108 });
    expect(applied.blocker).toBeNull();
    expect(cs2ReservationOffset(applied)).toBeCloseTo(200 / 255, 6);
    const first = cs2AdvanceReservation(applied);
    expect(cs2ReservationPriority(first)).toBe(108);
    expect(cs2ReservationPriority(cs2AdvanceReservation(first))).toBe(0);
    expect(r.next.priority).toBe(96);
  });

  it("clears the blocker only on the source-defined priority transitions", () => {
    const r: CS2LaneReservation = {
      previous: { offset: 20, priority: 108 },
      next: { offset: 30, priority: 96 },
      blocker: "waiting-car",
    };
    expect(cs2ApplyReservation(r, { offset: 40, priority: 100 }).blocker).toBe(
      "waiting-car",
    );
    expect(cs2AdvanceReservation(r).blocker).toBeNull();
  });

  it("ignores water and passed overlaps, and classifies a merge as continuing", () => {
    const overlap = cs2QuantizeOverlap([0.4, 0.6, 0.2, 0.8], 0, 0.5, 1);
    const args = {
      overlap,
      selfCurveStart: 0,
      minimumOffset: 0,
      laneLength: 100,
      distance: 10,
    };
    const w = cs2OverlapWindow(args);
    expect(w.skip).toBe(false);
    expect(w.checkReservation).toBe(true);
    expect(w.distance).toBeCloseTo(49.1, 4);
    expect(w.distanceFactor).toBe(0.5);
    expect(cs2OverlapWindow({ ...args, selfCurveStart: 0.8 }).skip).toBe(true);
    expect(
      cs2OverlapWindow({
        ...args,
        overlap: { ...overlap, flags: CS2_OVERLAP.water },
      }).skip,
    ).toBe(true);
    expect(
      cs2OverlapWindow({
        ...args,
        overlap: { ...overlap, flags: CS2_OVERLAP.mergeEnd },
      }).continuing,
    ).toBe(true);
  });

  it("allows unrelated traffic and applies priority only to the overlap", () => {
    expect(cs2OverlapDecision(decision()).maxSpeed).toBe(15);
    const equal = decision({
      otherReservation: { offset: 0.25, priority: 100 },
    });
    expect(cs2OverlapDecision(equal).yieldForReservation).toBe(false);
    const higher = cs2OverlapDecision({
      ...equal,
      otherReservation: { offset: 0.25, priority: 108 },
    });
    expect(higher.yieldForReservation).toBe(true);
    expect(higher.maxSpeed).toBe(2);
  });

  it("uses RequestSpace priority 96 to check downstream storage", () => {
    const x = decision({
      otherReservation: { offset: 0, priority: 96 },
      overlapSpaceAvailable: false,
    });
    expect(cs2OverlapDecision(x).blockForSpace).toBe(true);
    expect(cs2OverlapDecision({ ...x, requestSpace: true }).checkSpace).toBe(
      false,
    );
    expect(
      cs2OverlapDecision({ ...x, canStopBeforeOverlap: false }).checkSpace,
    ).toBe(false);
  });

  it("only extends a higher-priority object's window by the two-second term", () => {
    const x = {
      curvePosition: [0.2, 0.3] as const,
      objectSpeed: 10,
      objectPriority: 108,
      effectivePriority: 100,
      laneLength: 50,
      otherStart: 0.5,
      otherEnd: 0.8,
      minimumDelta: 0,
      mayProjectPriority: true,
    };
    expect(cs2OverlapVehicleWindow(x).intersects).toBe(true);
    expect(
      cs2OverlapVehicleWindow({ ...x, objectPriority: 100 }).intersects,
    ).toBe(false);
    expect(
      cs2OverlapVehicleWindow({ ...x, mayProjectPriority: false }).intersects,
    ).toBe(false);
  });

  it("includes queued vehicle lengths and a downstream moving rear clearance", () => {
    const x = {
      selfLength: 4,
      currentRemainingLength: 20,
      currentObjects: [
        { id: "front", moving: true, length: 4, reachesOverlapEnd: true },
      ],
      blockerRearDistance: 8,
    };
    expect(cs2CheckOverlapSpace(x)).toEqual({
      fits: false,
      required: 10,
      available: 8,
      blocker: "front",
    });
    expect(cs2CheckOverlapSpace({ ...x, blockerRearDistance: 12 }).fits).toBe(
      true,
    );
    expect(
      cs2CheckOverlapSpace({
        selfLength: 2,
        bicycle: true,
        currentRemainingLength: 4,
        currentObjects: [
          {
            id: "bicycle",
            moving: true,
            length: 2,
            bicycle: true,
            reachesOverlapEnd: false,
          },
        ],
      }).required,
    ).toBe(3.5);
  });
});

describe("source blocker recovery and area-only collision behavior", () => {
  it("raises an ignored blocker limit to 3m/s while respecting speed range", () => {
    const x = {
      brakingSpeed: 0.1,
      speedRange: { min: 0, max: 20 },
      ignore: true,
    };
    expect(cs2ResolveBlockerSpeed(x).speed).toBe(3);
    expect(cs2ResolveBlockerSpeed({ ...x, ignore: false }).speed).toBeCloseTo(
      0.1,
    );
    expect(
      cs2ResolveBlockerSpeed({ ...x, speedRange: { min: 0, max: 2 } }).speed,
    ).toBe(2);
    const oncoming = cs2ResolveBlockerSpeed({ ...x, oncoming: true });
    expect(oncoming.speed).toBe(3);
    expect(oncoming.hasVehicleBlocker).toBe(false);
    expect(oncoming.oncoming).toBeGreaterThan(1.9);
  });

  it("finds source/target blocker cycles and excludes temporary or moving chains", () => {
    const initial: CS2BlockerRecord = {
      blocker: "b",
      type: 2,
      maxSpeedByte: 0,
    };
    const nodes = new Map<string, CS2BlockerRecord>([
      ["b", { blocker: "a", type: 2, maxSpeedByte: 0 }],
      ["a", initial],
    ]);
    expect(cs2IsBlockedChain("a", initial, nodes)).toBe(true);
    expect(
      cs2IsBlockedChain(
        "a",
        initial,
        new Map(nodes).set("b", { blocker: "a", type: 4, maxSpeedByte: 0 }),
      ),
    ).toBe(false);
    expect(
      cs2IsBlockedChain(
        "a",
        initial,
        new Map(nodes).set("b", { blocker: "a", type: 2, maxSpeedByte: 6 }),
      ),
    ).toBe(false);
    expect(cs2IsBlockedChain("x", initial, nodes, new Map(), "b")).toBe(true);
    expect(
      cs2IsBlockedChain(
        "a",
        { ...initial, blocker: "trailer" },
        nodes,
        new Map([["trailer", "b"]]),
      ),
    ).toBe(true);
  });

  it("bounds another cycle at 100 links instead of walking forever", () => {
    const initial: CS2BlockerRecord = {
      blocker: "loop",
      type: 2,
      maxSpeedByte: 0,
    };
    expect(
      cs2IsBlockedChain("self", initial, new Map([["loop", initial]])),
    ).toBe(true);
    expect(cs2IsBlockedChain("self", initial, new Map())).toBe(false);
  });

  it("requests space from a crossing blocker before checking its low-speed cycle", () => {
    const initial: CS2BlockerRecord = {
        blocker: "other",
        type: 2,
        maxSpeedByte: 0,
      },
      blockers = new Map<string, CS2BlockerRecord>([
        ["other", { ...initial, blocker: "self" }],
        ["self", initial],
      ]),
      input = { self: "self", initial, blockers };
    expect(cs2StuckCarDecision(input)).toEqual({
      requestSpaceFor: "other",
      stuck: true,
      markPathStuck: true,
    });
    expect(
      cs2StuckCarDecision({ ...input, pathPending: true }).markPathStuck,
    ).toBe(false);
    expect(
      cs2StuckCarDecision({
        ...input,
        initial: { ...initial, maxSpeedByte: 6 },
      }),
    ).toEqual({ requestSpaceFor: "other", stuck: false, markPathStuck: false });
    expect(cs2EncodeBlockerSpeed(2)).toBe(5);
    expect(cs2EncodeBlockerSpeed(2.4)).toBe(6);
    expect(cs2EncodeBlockerSpeed(200)).toBe(255);
  });

  it("updates pedestrian push mode after five seconds without reversing", () => {
    expect(cs2PushBlockers(false, true, 4.99)).toBe(false);
    expect(cs2PushBlockers(false, true, 5)).toBe(true);
    expect(cs2PushBlockers(true, false, 5)).toBe(false);
  });

  it("limits area collision speed by direction and close forward separation", () => {
    const x = {
      pathDistance: 0,
      combinedRadius: 2,
      otherDirectionDot: -1,
      otherVelocityAlong: -5,
      objectDistance: 4,
      objectForwardDistance: 3,
      speedRange: { min: 0, max: 20 },
      maxSpeed: 20,
    };
    expect(cs2AreaCollisionLimit(x).maxSpeed).toBeCloseTo(8, 5);
    expect(cs2AreaCollisionLimit({ ...x, pathDistance: 2 }).maxSpeed).toBe(20);
    expect(
      cs2AreaCollisionLimit({ ...x, objectDistance: 0.001 }).maxSpeed,
    ).toBe(0);
  });
});
