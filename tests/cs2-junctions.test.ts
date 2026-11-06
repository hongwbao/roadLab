import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  CS2_MOVEABLE_BRIDGE,
  CS2_SIGNAL_CAN_EXTEND,
  Cs2LaneSignal,
  Cs2TrafficLightState,
  selectCs2SignalGroup,
  tickCs2TrafficLights,
  updateCs2LaneSignal,
  updateCs2SignalHeads,
  type Cs2SignalClock,
  type Cs2SignalLane,
} from "../src/simulation/cs2-junctions";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-signals-oracle.json", import.meta.url),
    "utf8",
  ),
) as { origin: { sha256: string }; lanes: number[][]; heads: number[][] };

it("matches original Game.dll lane signals across states, masks and history", () => {
  expect(oracle.origin.sha256).toBe(
    "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
  );
  expect(oracle.lanes.length).toBe(5880);
  const mismatches: number[][] = [];
  for (const row of oracle.lanes) {
    const [state, current, next, groupMask, signal, flags, expected] = row;
    const actual = updateCs2LaneSignal(
      { state, current, next },
      { groupMask, signal, flags },
    );
    if (actual !== expected) mismatches.push([...row, actual]);
  }
  expect(mismatches).toEqual([]);
});

it("matches both original Game.dll light heads including level crossings", () => {
  expect(oracle.heads.length).toBe(19600);
  const mismatches: number[][] = [];
  for (const row of oracle.heads) {
    const [state, current, next, mask0, mask1, previous, flags, expected] = row;
    const actual = updateCs2SignalHeads(
      { state, current, next, flags },
      mask0,
      mask1,
      previous,
    );
    if (actual !== expected) mismatches.push([...row, actual]);
  }
  expect(mismatches).toEqual([]);
});

const lane = (groupMask: number, priority = 0): Cs2SignalLane => ({
  groupMask,
  priority,
  defaultPriority: 0,
  petitioner: null,
  blocker: null,
  signal: Cs2LaneSignal.Stop,
  flags: 0,
});
const clock = (overrides: Partial<Cs2SignalClock> = {}): Cs2SignalClock => ({
  state: Cs2TrafficLightState.None,
  current: 0,
  next: 0,
  groupCount: 3,
  timer: 0,
  flags: 0,
  ...overrides,
});

it("petitions select a highest-priority group and transfer blocker identities", () => {
  const lanes = [lane(1, 1), lane(2, 3), lane(4, -1)];
  lanes[1].petitioner = 71;
  const result = selectCs2SignalGroup(clock({ current: 1 }), lanes, false);
  expect(result).toEqual({ group: 2, canExtend: false });
  expect(lanes.map((x) => x.blocker)).toEqual([71, null, 71]);
  expect(lanes.map((x) => x.priority)).toEqual([0, 0, 0]);
  expect(lanes.map((x) => x.petitioner)).toEqual([null, null, null]);
});

it("idle controllers stay in their current group and negative petitions mask groups", () => {
  const lanes = [lane(1), lane(2), lane(4)];
  expect(selectCs2SignalGroup(clock({ current: 2 }), lanes, true).group).toBe(
    2,
  );
  lanes.push(lane(2, -1));
  expect(selectCs2SignalGroup(clock({ current: 2 }), lanes, true).group).toBe(
    3,
  );
});

it("ties rotate cyclically and extension depends on current-group top petitions", () => {
  const lanes = [lane(1, 2), lane(2, 2), lane(4, 2)];
  lanes[0].flags = CS2_SIGNAL_CAN_EXTEND;
  expect(selectCs2SignalGroup(clock({ current: 1 }), lanes, true)).toEqual({
    group: 2,
    canExtend: true,
  });
  lanes.forEach((x) => (x.priority = 2));
  expect(selectCs2SignalGroup(clock({ current: 3 }), lanes, true)).toEqual({
    group: 1,
    canExtend: false,
  });
});

it("movable bridge caps petition priority at one before rotating ties", () => {
  const lanes = [lane(1, 100), lane(2, 1)];
  expect(
    selectCs2SignalGroup(
      clock({ current: 1, flags: CS2_MOVEABLE_BRIDGE }),
      lanes,
      true,
    ).group,
  ).toBe(2);
});

it("startup yields before going and a demanded change gets ending and clearance ticks", () => {
  const c = clock();
  const lanes = [lane(1), lane(2)];
  expect(tickCs2TrafficLights(c, lanes)).toBe(true);
  expect(c.state).toBe(Cs2TrafficLightState.Beginning);
  expect(c.next).toBe(1);
  lanes.forEach((x) => (x.signal = updateCs2LaneSignal(c, x)));
  expect(lanes[0].signal).toBe(Cs2LaneSignal.Yield);
  tickCs2TrafficLights(c, lanes);
  lanes.forEach((x) => (x.signal = updateCs2LaneSignal(c, x)));
  expect(lanes[0].signal).toBe(Cs2LaneSignal.Go);
  lanes[1].priority = 2;
  expect(tickCs2TrafficLights(c, lanes)).toBe(false);
  lanes[1].priority = 2;
  expect(tickCs2TrafficLights(c, lanes)).toBe(true);
  expect(c.state).toBe(Cs2TrafficLightState.Ending);
  lanes.forEach((x) => (x.signal = updateCs2LaneSignal(c, x)));
  expect(lanes[0].signal).toBe(Cs2LaneSignal.SafeStop);
  expect(lanes[1].signal).toBe(Cs2LaneSignal.Stop);
  lanes[1].priority = 2;
  tickCs2TrafficLights(c, lanes);
  lanes[1].priority = 2;
  tickCs2TrafficLights(c, lanes);
  expect(c.state).toBe(Cs2TrafficLightState.Changing);
  lanes.forEach((x) => (x.signal = updateCs2LaneSignal(c, x)));
  expect(lanes.map((x) => x.signal)).toEqual([
    Cs2LaneSignal.Stop,
    Cs2LaneSignal.Stop,
  ]);
  lanes[1].priority = 2;
  tickCs2TrafficLights(c, lanes);
  expect(c.state).toBe(Cs2TrafficLightState.Beginning);
  tickCs2TrafficLights(c, lanes);
  expect(c.current).toBe(2);
  expect(c.state).toBe(Cs2TrafficLightState.Ongoing);
});

it("bridge clearance can defer changing after ending without resetting the timer", () => {
  const c = clock({
    state: Cs2TrafficLightState.Ending,
    current: 1,
    next: 2,
    timer: 1,
    flags: CS2_MOVEABLE_BRIDGE,
  });
  expect(tickCs2TrafficLights(c, [lane(2, 1)], 0, () => false)).toBe(false);
  expect(c.state).toBe(Cs2TrafficLightState.Ending);
  expect(c.timer).toBe(2);
});
