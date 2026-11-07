import type { V } from "../core/types";
import type { Movement } from "./intersections";
import {
  CS2_NAVIGATION_TIMESTEP,
  cs2BrakingDistance,
  cs2FollowingSpeed,
  cs2MaxBrakingSpeed,
  cs2SpeedRange,
  type CS2CarData,
} from "./cs2-driving";
import {
  CS2_OVERLAP,
  cs2AdvanceReservation,
  cs2ApplyReservation,
  cs2CheckOverlapSpace,
  cs2EncodeBlockerSpeed,
  cs2LanePriorityDelta,
  cs2OverlapDecision,
  cs2OverlapVehicleWindow,
  cs2OverlapWindow,
  cs2QuantizeOverlap,
  cs2QuantizeReservation,
  cs2ReservationOffset,
  cs2ReservationPriority,
  cs2StuckCarDecision,
  cs2VehiclePriority,
  type CS2BlockerRecord,
  type CS2LaneOverlap,
  type CS2LaneReservation,
} from "./cs2-conflicts";

/** Geometry is a browser polyline adapter; the scalar decisions use source ports. */
export type CS2OverlapMovement = Movement & {
  laneWidth?: number;
  laneFlags?: number;
  speedLimit?: number;
};
export type CS2OverlapAgent = {
  id: number;
  movement: string;
  /** Metres from the connector entrance. Approach is negative. */
  s: number;
  speed: number;
  length: number;
  car: CS2CarData;
  width?: number;
  freeSpeed?: number;
  priority?: number;
  emergency?: boolean;
  safeTimeStep?: number;
  /** Original LaneSignalType 0..4. Entered cars may continue to clear on Stop. */
  signal?: number;
  canExit?: boolean;
  /** Metres of projected storage after the connector; absent means unknown. */
  exitSpace?: number;
  navigationSpeed?: number;
  requestSpace?: boolean;
};
export type CS2OverlapDirective = {
  maxSpeed: number;
  stopS?: number;
  blocker?: number;
  blockerType: "crossing" | "continuing" | "none";
  requestSpace: boolean;
  stuck: boolean;
};
type Lane = {
  movement: CS2OverlapMovement;
  lengths: number[];
  length: number;
  reservation: CS2LaneReservation;
  bucket: number;
};
export type CS2MovementOverlap = {
  self: string;
  other: string;
  data: CS2LaneOverlap;
};
const emptyReservation = (): CS2LaneReservation => ({
  next: { offset: 0, priority: 0 },
  previous: { offset: 0, priority: 0 },
  blocker: null,
});
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const distance = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mix = (a: V, b: V, t: number): V => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
const bucket = (id: string) => {
  let value = 0;
  for (const c of id) value = (value * 31 + c.charCodeAt(0)) | 0;
  return value & 15;
};
function closestPoint(p: V, a: V, b: V) {
  const x = b.x - a.x,
    z = b.z - a.z,
    t = clamp(((p.x - a.x) * x + (p.z - a.z) * z) / (x * x + z * z || 1)),
    q = mix(a, b, t);
  return { t, distance: Math.hypot(p.x - q.x, p.z - q.z) };
}
function closestSegments(a: V, b: V, c: V, d: V) {
  const ux = b.x - a.x,
    uz = b.z - a.z,
    vx = d.x - c.x,
    vz = d.z - c.z,
    determinant = ux * vz - uz * vx;
  if (Math.abs(determinant) > 1e-9) {
    const x = c.x - a.x,
      z = c.z - a.z,
      s = (x * vz - z * vx) / determinant,
      t = (x * uz - z * ux) / determinant;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return { s, t, distance: 0 };
  }
  const ac = closestPoint(a, c, d),
    bc = closestPoint(b, c, d),
    ca = closestPoint(c, a, b),
    da = closestPoint(d, a, b);
  return [
    { s: 0, t: ac.t, distance: ac.distance },
    { s: 1, t: bc.t, distance: bc.distance },
    { s: ca.t, t: 0, distance: ca.distance },
    { s: da.t, t: 1, distance: da.distance },
  ].sort((x, y) => x.distance - y.distance)[0];
}
function capsuleRange(a: V, b: V, c: V, d: V, inside: number, radius: number) {
  const contains = (t: number) =>
    closestPoint(mix(a, b, t), c, d).distance <= radius;
  let start = 0,
    end = 1;
  if (!contains(0)) {
    let lo = 0,
      hi = inside;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (contains(mid)) hi = mid;
      else lo = mid;
    }
    start = hi;
  }
  if (!contains(1)) {
    let lo = inside,
      hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (contains(mid)) lo = mid;
      else hi = mid;
    }
    end = lo;
  }
  return [start, end] as const;
}
function tangentAt(lane: Lane, s: number): [number, number] {
  const i = Math.max(
      1,
      lane.lengths.findIndex((x) => x >= clamp(s, 0, lane.length)),
    ),
    a = lane.movement.points[i - 1],
    b = lane.movement.points[i],
    x = b.x - a.x,
    z = b.z - a.z,
    n = Math.hypot(x, z) || 1;
  return [x / n, z / n];
}

/** The adapter preserves per-lane windows and two buckets; no pair commitment map. */
export class CS2OverlapController {
  private lanes = new Map<string, Lane>();
  private overlaps = new Map<string, CS2MovementOverlap[]>();
  private requestSpace = new Set<number>();
  private previousMovement = new Map<number, string>();
  private decisions = new Map<number, CS2OverlapDirective>();
  private lastFrame = -1;
  readonly statistics = { plans: 0, windows: 0, yielding: 0, stuck: 0 };

  clear() {
    for (const lane of this.lanes.values())
      lane.reservation = emptyReservation();
    this.requestSpace.clear();
    this.previousMovement.clear();
    this.decisions.clear();
    this.lastFrame = -1;
    this.statistics.plans = 0;
    this.statistics.yielding = 0;
    this.statistics.stuck = 0;
  }

  configure(movements: readonly CS2OverlapMovement[]) {
    this.lanes.clear();
    this.overlaps.clear();
    const junctions = new Map<string, Lane[]>();
    for (const movement of movements) {
      if (movement.points.length < 2) continue;
      const lengths = [0];
      for (let i = 1; i < movement.points.length; i++)
        lengths.push(
          lengths[i - 1] + distance(movement.points[i - 1], movement.points[i]),
        );
      if (lengths.at(-1)! < 0.01) continue;
      const lane: Lane = {
        movement,
        lengths,
        length: lengths.at(-1)!,
        reservation: emptyReservation(),
        bucket: bucket(movement.id),
      };
      this.lanes.set(movement.id, lane);
      this.overlaps.set(movement.id, []);
      const list = junctions.get(movement.junction) ?? [];
      list.push(lane);
      junctions.set(movement.junction, list);
    }
    for (const list of junctions.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          this.connect(list[i], list[j]);
    this.statistics.windows = [...this.overlaps.values()].reduce(
      (n, x) => n + x.length,
      0,
    );
    this.clear();
  }

  /** Read-only diagnostic snapshot; geometry is rebuilt only by configure. */
  windows(movement: string): readonly CS2MovementOverlap[] {
    return this.overlaps.get(movement) ?? [];
  }

  private connect(a: Lane, b: Lane) {
    const ap = a.movement.points,
      bp = b.movement.points,
      radius =
        ((a.movement.laneWidth ?? 3.2) + (b.movement.laneWidth ?? 3.2)) / 2;
    let aStart = Infinity,
      aEnd = -Infinity,
      bStart = Infinity,
      bEnd = -Infinity;
    for (let i = 1; i < ap.length; i++)
      for (let j = 1; j < bp.length; j++) {
        const p = closestSegments(ap[i - 1], ap[i], bp[j - 1], bp[j]);
        if (p.distance >= radius) continue;
        if (
          Math.abs(
            mix(ap[i - 1], ap[i], p.s).y - mix(bp[j - 1], bp[j], p.t).y,
          ) > 1.8
        )
          continue;
        const ar = capsuleRange(
            ap[i - 1],
            ap[i],
            bp[j - 1],
            bp[j],
            p.s,
            radius,
          ),
          br = capsuleRange(bp[j - 1], bp[j], ap[i - 1], ap[i], p.t, radius),
          al = a.lengths[i] - a.lengths[i - 1],
          bl = b.lengths[j] - b.lengths[j - 1];
        aStart = Math.min(aStart, a.lengths[i - 1] + ar[0] * al);
        aEnd = Math.max(aEnd, a.lengths[i - 1] + ar[1] * al);
        bStart = Math.min(bStart, b.lengths[j - 1] + br[0] * bl);
        bEnd = Math.max(bEnd, b.lengths[j - 1] + br[1] * bl);
      }
    if (!Number.isFinite(aStart)) return;
    const sameStart = a.movement.from === b.movement.from,
      sameEnd = a.movement.to === b.movement.to,
      flags =
        CS2_OVERLAP.road |
        (sameStart ? CS2_OVERLAP.mergeStart : 0) |
        (sameEnd ? CS2_OVERLAP.mergeEnd : 0),
      ta = tangentAt(a, (aStart + aEnd) / 2),
      tb = tangentAt(b, (bStart + bEnd) / 2),
      parallelism = Math.max(0, ta[0] * tb[0] + ta[1] * tb[1]),
      delta = cs2LanePriorityDelta({
        selfFlags: a.movement.laneFlags ?? 0,
        otherFlags: b.movement.laneFlags ?? 0,
        selfTangent: ta,
        otherTangent: tb,
        mergeStart: sameStart,
      }),
      factorA =
        sameStart || sameEnd
          ? parallelism
          : (parallelism * Math.max(1, aEnd - aStart)) /
            Math.max(1, bEnd - bStart),
      factorB =
        sameStart || sameEnd
          ? parallelism
          : (parallelism * Math.max(1, bEnd - bStart)) /
            Math.max(1, aEnd - aStart);
    this.overlaps.get(a.movement.id)!.push({
      self: a.movement.id,
      other: b.movement.id,
      data: cs2QuantizeOverlap(
        [
          aStart / a.length,
          aEnd / a.length,
          bStart / b.length,
          bEnd / b.length,
        ],
        flags,
        factorA,
        delta,
      ),
    });
    this.overlaps.get(b.movement.id)!.push({
      self: b.movement.id,
      other: a.movement.id,
      data: cs2QuantizeOverlap(
        [
          bStart / b.length,
          bEnd / b.length,
          aStart / a.length,
          aEnd / a.length,
        ],
        flags,
        factorB,
        -delta,
      ),
    });
  }

  plan(
    agents: readonly CS2OverlapAgent[],
    elapsed: number,
    updateIds?: ReadonlySet<number>,
    stuckIds: ReadonlySet<number> | undefined = updateIds,
  ) {
    const frame = Math.floor(elapsed * 60);
    if (frame < this.lastFrame) this.clear();
    for (const lane of this.lanes.values()) {
      if (frame - this.lastFrame > 32) lane.reservation = emptyReservation();
      else
        for (let i = this.lastFrame + 1; i <= frame; i++)
          if ((i & 15) === lane.bucket)
            lane.reservation = cs2AdvanceReservation(lane.reservation);
    }
    this.lastFrame = frame;
    this.statistics.plans++;
    this.statistics.yielding = 0;
    const present = new Set(agents.map((a) => a.id));
    for (const id of this.requestSpace)
      if (!present.has(id)) this.requestSpace.delete(id);
    for (const id of this.previousMovement.keys())
      if (!present.has(id)) {
        this.previousMovement.delete(id);
        this.decisions.delete(id);
      }
    for (const a of agents) {
      if (this.previousMovement.get(a.id) !== a.movement) {
        this.requestSpace.delete(a.id);
        this.decisions.delete(a.id);
      }
      this.previousMovement.set(a.id, a.movement);
    }
    const byLane = new Map<string, CS2OverlapAgent[]>();
    for (const a of agents) {
      const list = byLane.get(a.movement) ?? [];
      list.push(a);
      byLane.set(a.movement, list);
    }
    const result = new Map<number, CS2OverlapDirective>();
    for (const a of [...agents].sort((x, y) => x.id - y.id)) {
      if (updateIds && !updateIds.has(a.id)) continue;
      const lane = this.lanes.get(a.movement);
      if (!lane) continue;
      const safe = a.safeTimeStep ?? CS2_NAVIGATION_TIMESTEP + 0.3,
        range = cs2SpeedRange(a.car, a.speed, CS2_NAVIGATION_TIMESTEP),
        priority = a.priority ?? cs2VehiclePriority(!!a.emergency),
        requestSpace = !!a.requestSpace || this.requestSpace.has(a.id),
        directive: CS2OverlapDirective = {
          maxSpeed: Math.fround(
            Math.min(a.freeSpeed ?? a.car.maxSpeed, range.max),
          ),
          blockerType: "none",
          requestSpace,
          stuck: false,
        },
        limit = (
          speed: number,
          stopS: number | undefined,
          type: "crossing" | "continuing",
          blocker?: number,
        ) => {
          if (speed >= directive.maxSpeed) return;
          directive.maxSpeed = speed;
          directive.stopS = stopS;
          directive.blockerType = type;
          directive.blocker = blocker;
        };
      // Normal CheckSpace ahead of a connector is independent of crossing traffic.
      if (
        a.s < 0 &&
        (a.canExit === false ||
          (a.exitSpace !== undefined && a.exitSpace < a.length + 1))
      ) {
        const stopS = -a.length / 2 - 0.9;
        limit(
          Math.max(range.min, cs2MaxBrakingSpeed(a.car, stopS - a.s, safe)),
          stopS,
          "continuing",
        );
      }
      for (const b of byLane.get(a.movement) ?? []) {
        if (b.id === a.id || b.s <= a.s) continue;
        const gap = b.s - a.s - (a.length + b.length) / 2,
          speed = cs2FollowingSpeed(
            a.car,
            { gap, speed: b.speed, braking: b.car.braking },
            CS2_NAVIGATION_TIMESTEP,
            safe,
          );
        limit(
          Math.max(range.min, speed),
          b.speed < 0.01 ? a.s + gap : undefined,
          "continuing",
          b.id,
        );
      }
      for (const record of this.overlaps.get(a.movement) ?? []) {
        const otherLane = this.lanes.get(record.other)!,
          window = cs2OverlapWindow({
            overlap: record.data,
            selfCurveStart: Math.max(0, a.s / lane.length),
            minimumOffset: Math.max(0, (a.s + a.length / 2) / lane.length),
            laneLength: lane.length,
            distance: -Math.min(0, a.s) - a.length / 2,
          });
        if (window.skip) continue;
        const others = byLane.get(record.other) ?? [],
          reservationPriority = cs2ReservationPriority(otherLane.reservation),
          space = cs2CheckOverlapSpace({
            selfLength: a.length,
            currentRemainingLength: Math.max(0, lane.length - a.s),
            nextLaneLength: a.exitSpace,
            currentObjects: [],
            nextBlocker: a.canExit === false ? "downstream" : null,
            blockerRearDistance: a.canExit === false ? 0 : a.exitSpace,
          }),
          brakingSpeed = cs2MaxBrakingSpeed(a.car, window.distance, safe),
          decision = cs2OverlapDecision({
            selfPriority: priority,
            ownReservationPriority: cs2ReservationPriority(lane.reservation),
            priorityDelta: record.data.priorityDelta,
            yieldOverride: 0,
            otherSignal: others[0]?.signal ?? 0,
            requestSpace,
            otherReservation:
              window.checkReservation && reservationPriority > 0
                ? {
                    offset: cs2ReservationOffset(otherLane.reservation),
                    priority: reservationPriority,
                  }
                : undefined,
            reservationOffsetThreshold: window.reservationOffsetThreshold,
            slow: false,
            brakingSpeed,
            speedRange: range,
            maxSpeed: directive.maxSpeed,
            speedLimit:
              lane.movement.speedLimit ?? a.freeSpeed ?? a.car.maxSpeed,
            canStopBeforeOverlap:
              cs2BrakingDistance(a.car, a.speed, CS2_NAVIGATION_TIMESTEP) <=
              window.stoppingDistance,
            overlapSpaceAvailable: a.canExit !== false && space.fits,
          }),
          stopS = window.start * lane.length - a.length / 2 - 0.9;
        if (decision.maxSpeed < directive.maxSpeed)
          limit(decision.maxSpeed, stopS, "crossing");
        for (const b of others) {
          if (b.id === a.id) continue;
          const bStart = window.otherStart * otherLane.length,
            bEnd = window.otherEnd * otherLane.length,
            redApproach = b.s < 0 && (b.signal === 1 || b.signal === 2),
            bNavigationSpeed = redApproach
              ? 0
              : (b.navigationSpeed ?? result.get(b.id)?.maxSpeed ?? b.speed),
            bPriority = b.priority ?? cs2VehiclePriority(!!b.emergency),
            bFuture =
              b.s +
              b.length / 2 +
              cs2BrakingDistance(
                b.car,
                bNavigationSpeed,
                CS2_NAVIGATION_TIMESTEP,
              ),
            objectWindow = cs2OverlapVehicleWindow({
              curvePosition: [
                b.s / otherLane.length,
                bFuture / otherLane.length,
              ],
              objectSpeed: redApproach ? 0 : b.speed,
              objectPriority: bPriority,
              effectivePriority: decision.priority,
              laneLength: otherLane.length,
              otherStart: window.otherStart,
              otherEnd: window.otherEnd,
              minimumDelta: window.minimumDelta,
              mayProjectPriority: window.checkReservation,
            });
          if (!objectWindow.intersects || b.s - b.length / 2 >= bEnd) continue;
          if (
            (record.data.flags & CS2_OVERLAP.mergeStart) !== 0 ||
            (record.data.flags & CS2_OVERLAP.mergeEnd) !== 0
          ) {
            const sharedStart =
                (record.data.flags & CS2_OVERLAP.mergeStart) !== 0,
              ahead = sharedStart
                ? b.s - a.s
                : lane.length - a.s - (otherLane.length - b.s),
              gap = ahead - (a.length + b.length) / 2;
            if (ahead > 0 && b.s + b.length / 2 >= bStart) {
              const speed = cs2FollowingSpeed(
                a.car,
                { gap, speed: b.speed, braking: b.car.braking },
                CS2_NAVIGATION_TIMESTEP,
                safe,
              );
              limit(
                Math.max(range.min, speed),
                b.speed < 0.01 ? a.s + gap : undefined,
                "continuing",
                b.id,
              );
            }
            continue;
          }
          // Source IL_051f runs object checks even AFTER reservation checks stop.
          // Priority affects projection of the other object's reserved interval,
          // not whether a physically overlapping object's speed is considered.
          limit(Math.max(range.min, brakingSpeed), stopS, "crossing", b.id);
        }
      }
      result.set(a.id, directive);
      this.decisions.set(a.id, directive);
      // Source ReserveNavigationLanes reserves future lanes, not the current one.
      const redApproach = a.s < 0 && (a.signal === 1 || a.signal === 2),
        targetSpeed = redApproach
          ? 0
          : Math.min(
              a.navigationSpeed ?? directive.maxSpeed,
              directive.maxSpeed,
            ),
        horizon = Math.max(
          0,
          cs2BrakingDistance(a.car, targetSpeed, CS2_NAVIGATION_TIMESTEP) -
            0.01,
        ),
        projected = a.s + horizon;
      if (a.s < 0 && projected > 0)
        lane.reservation = cs2ApplyReservation(
          lane.reservation,
          cs2QuantizeReservation(projected / lane.length, priority),
        );
      if (requestSpace)
        lane.reservation = cs2ApplyReservation(
          lane.reservation,
          cs2QuantizeReservation(0, 96),
        );
    }
    const blockers = new Map<string, CS2BlockerRecord>();
    for (const [id, d] of this.decisions)
      blockers.set(String(id), {
        blocker: d.blocker === undefined ? null : String(d.blocker),
        type:
          d.blockerType === "crossing"
            ? 2
            : d.blockerType === "continuing"
              ? 1
              : 0,
        maxSpeedByte: cs2EncodeBlockerSpeed(d.maxSpeed),
      });
    for (const [id, directive] of this.decisions) {
      if (stuckIds && !stuckIds.has(id)) continue;
      const decision = cs2StuckCarDecision({
        self: String(id),
        initial: blockers.get(String(id))!,
        blockers,
      });
      if (decision.requestSpaceFor !== null)
        this.requestSpace.add(Number(decision.requestSpaceFor));
      directive.stuck = decision.markPathStuck;
      if (directive.stuck) this.statistics.stuck++;
      if (directive.stuck) result.set(id, directive);
      if (directive.blockerType !== "none") this.statistics.yielding++;
    }
    return result;
  }
}
