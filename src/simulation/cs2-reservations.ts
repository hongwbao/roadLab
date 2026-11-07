/** Complete CarNavigationSystem reservation methods; see CS2_RESERVATIONS.md. */
import {
  cs2BrakingDistance,
  CS2_NAVIGATION_TIMESTEP,
  type CS2CarData,
} from "./cs2-driving";
import { cs2QuantizeReservation } from "./cs2-conflicts";
import {
  CS2_NAV_TARGET_FLAGS as F,
  type CS2NavigationCurrentState,
  type CS2NavigationQueuedLane,
} from "./cs2-navigation-target";

export type CS2ReservationLane = {
  length: number;
  carLane: boolean;
  hasReservation: boolean;
  signal?: { type: number; flags: number };
  owner?: string;
  slave?: { minIndex: number; maxIndex: number };
};
export type CS2ReservationWorld = {
  lanes: ReadonlyMap<string, CS2ReservationLane>;
  /** Actual owner.SubLanes order, including any master/non-reservable lanes. */
  owners: ReadonlyMap<string, readonly string[]>;
};
export type CS2NavigationReservationInput = {
  entity: string;
  priority: number;
  car: CS2CarData;
  carFlags: number;
  frontExtent: number;
  maxSpeed: number;
  current: CS2NavigationCurrentState;
  nextLanes: readonly CS2NavigationQueuedLane[];
  /** Live Unity random.state, without another constructor warm-up. */
  randomState: number;
};
export type CS2NavigationReservationRequest = {
  lane: string;
  /** Already quantized source byte; do not quantize it again on consumption. */
  offset: number;
  priority: number;
};
export type CS2NavigationSignalRequest = {
  entity: string;
  lane: string;
  priority: number;
};

const f = Math.fround;
const reservedFlag = 0x80;
const roundaboutFlag = 0x8000000;

export function cs2ReserveNavigationLanes(
  world: CS2ReservationWorld,
  input: CS2NavigationReservationInput,
) {
  const current: CS2NavigationCurrentState = {
    ...input.current,
    flags: input.current.flags >>> 0,
    changeProgress: f(input.current.changeProgress),
    lanePosition: f(input.current.lanePosition),
    duration: f(input.current.duration),
    distance: f(input.current.distance),
    curvePosition: {
      x: f(input.current.curvePosition.x),
      y: f(input.current.curvePosition.y),
      z: f(input.current.curvePosition.z),
    },
  };
  const nextLanes = input.nextLanes.map((lane) => ({
    ...lane,
    start: f(lane.start),
    end: f(lane.end),
  }));
  const reservations: CS2NavigationReservationRequest[] = [];
  const signals: CS2NavigationSignalRequest[] = [];
  let randomState = input.randomState >>> 0;
  const result = () => ({
    current,
    nextLanes,
    reservations,
    signals,
    randomState,
  });
  const first = current.laneId && world.lanes.get(current.laneId);
  if (!first || !first.carLane) return result();

  const enqueue = (lane: string, offset: number, priority: number) => {
    reservations.push({ lane, ...cs2QuantizeReservation(offset, priority) });
  };
  const signal = (lane: string) =>
    signals.push({
      entity: input.entity,
      lane,
      priority: (input.priority << 24) >> 24,
    });
  const reserveOtherLanes = (id: string, priority: number) => {
    const lane = world.lanes.get(id);
    if (!lane?.slave) return;
    const siblings = lane.owner && world.owners.get(lane.owner);
    if (!siblings)
      throw new Error(`Missing reservation owner.SubLanes for ${id}`);
    const end = Math.min(lane.slave.maxIndex, siblings.length - 1);
    for (let index = lane.slave.minIndex; index <= end; index++) {
      const other = siblings[index];
      if (other === undefined)
        throw new Error(`Invalid SubLane index ${index}`);
      if (other !== id && world.lanes.get(other)?.hasReservation)
        enqueue(other, 0, priority);
    }
  };
  const nextInt = (max: number) => {
    const value = randomState;
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    randomState >>>= 0;
    return Math.floor((value * max) / 4294967296);
  };
  const emergency = (input.carFlags & 1) !== 0;
  const braking = Math.max(
    0,
    f(
      cs2BrakingDistance(
        input.car,
        Math.abs(f(input.maxSpeed)),
        CS2_NAVIGATION_TIMESTEP,
      ) - f(0.01),
    ),
  );
  let remaining = braking;
  let length = f(first.length);
  let offset = f(f(remaining / Math.max(f(1e-6), length)) + f(1e-6));
  const reverse = current.curvePosition.z < current.curvePosition.x;
  current.curvePosition.y = f(
    current.curvePosition.x + (reverse ? f(-offset) : offset),
  );
  remaining = f(
    remaining -
      f(
        length * Math.abs(f(current.curvePosition.z - current.curvePosition.x)),
      ),
  );
  let index = 0;
  if (emergency && braking > 1)
    reserveOtherLanes(current.changeLaneId || current.laneId!, 102);
  if (current.flags & F.RequestSpace && first.hasReservation)
    enqueue(current.laneId!, 0, 96);
  if (
    nextLanes.length &&
    nextLanes[0].flags & F.RequestSpace &&
    world.lanes.get(nextLanes[0].laneId)?.hasReservation
  )
    enqueue(nextLanes[0].laneId, 0, 96);

  if (
    reverse
      ? current.curvePosition.z > current.curvePosition.y
      : current.curvePosition.y > current.curvePosition.z
  ) {
    current.curvePosition.y = current.curvePosition.z;
    while (index < nextLanes.length && remaining > 0) {
      const lane = nextLanes[index],
        component = world.lanes.get(lane.laneId);
      if (!component?.carLane) break;
      length = f(component.length);
      if (component.hasReservation) {
        offset = f(remaining / Math.max(f(1e-6), length));
        offset = Math.max(
          lane.start,
          Math.min(lane.end, f(lane.start + offset)),
        );
        enqueue(lane.laneId, offset, input.priority);
      }
      if (emergency) {
        reserveOtherLanes(lane.laneId, 102);
        if (component.signal) signal(lane.laneId);
      }
      remaining = f(remaining - f(length * Math.abs(f(lane.end - lane.start))));
      lane.flags = (lane.flags | reservedFlag) >>> 0;
      index++;
    }
  }
  if (emergency) {
    remaining = f(remaining + braking);
    if (nextInt(4) !== 0)
      remaining = f(remaining + f(f(input.frontExtent) + 1));
    for (; index < nextLanes.length; index++) {
      if (!(remaining > 0)) break;
      const lane = nextLanes[index],
        component = world.lanes.get(lane.laneId);
      if (!component?.carLane) break;
      let mayReserve = true;
      if (component.signal) {
        mayReserve =
          (component.signal.flags & 2) === 0 || component.signal.type === 4;
        signal(lane.laneId);
      }
      if (mayReserve && component.hasReservation)
        enqueue(lane.laneId, 0, input.priority);
      remaining = f(
        remaining - f(f(component.length) * Math.abs(f(lane.end - lane.start))),
      );
    }
  } else if (current.flags & roundaboutFlag) {
    remaining = f(remaining + f(braking * f(0.5)));
    if (nextInt(2) !== 0)
      remaining = f(remaining + f(f(input.frontExtent) + 1));
    for (; index < nextLanes.length; index++) {
      if (!(remaining > 0)) break;
      const lane = nextLanes[index],
        component = world.lanes.get(lane.laneId);
      if (!component?.carLane || !(lane.flags & roundaboutFlag)) break;
      if (component.hasReservation) enqueue(lane.laneId, 0, input.priority);
      remaining = f(
        remaining - f(f(component.length) * Math.abs(f(lane.end - lane.start))),
      );
    }
  }
  return result();
}
