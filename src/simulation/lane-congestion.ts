import type { Cs2CompiledNetwork } from "./cs2-network";
import { MAX_LANE_LOOKAHEAD } from "./early-lane-planning";
import { CS2_BASE_CAR } from "./cs2-driving";

type Occupant = { id: number; s: number; speed?: number };
type Span = { lane: string; offset: number; length: number };
const NAVIGATION_PADDING = 32;
const REAR_WINDOW = CS2_BASE_CAR.maxSpeed * 1.3;

/** Reuses the runtime's sorted physical occupancy. Search only the forward
 * window, deduplicating a body present in more than one fitted lane piece.
 * Corridor topology is cached; live vehicle counts are not topology data. */
export class LaneCongestion {
  private predecessors = new Map<string, string[]>();
  private corridors = new Map<string, Span[]>();
  readonly statistics = {
    corridorBuilds: 0,
    queries: 0,
    binarySteps: 0,
    rowsVisited: 0,
    gapQueries: 0,
  };
  constructor(
    private network: Cs2CompiledNetwork,
    private continuousConnection: (group: string) => boolean,
  ) {
    for (const [from, next] of network.successors)
      for (const to of next) {
        const rows = this.predecessors.get(to) ?? [];
        rows.push(from);
        this.predecessors.set(to, rows);
      }
  }
  private next(
    id: string,
    backwards = false,
  ): { lane: string; gap: number } | null {
    const network = this.network,
      edges = backwards ? this.predecessors : network.successors,
      choices = edges.get(id) ?? [];
    if (choices.length !== 1) return null;
    let next = network.lanes.get(choices[0])!;
    if (next.kind === "connection") {
      if (!this.continuousConnection(next.group)) return null;
      const road = edges.get(next.id) ?? [];
      return road.length === 1
        ? { lane: road[0], gap: next.curve.length }
        : null;
    }
    const current = network.lanes.get(id)!;
    return next.kind === "road" &&
      next.road === current.road &&
      next.direction === current.direction &&
      next.lane === current.lane
      ? { lane: next.id, gap: 0 }
      : null;
  }
  private corridor(id: string) {
    const cached = this.corridors.get(id);
    if (cached) return cached;
    this.statistics.corridorBuilds++;
    const network = this.network,
      spans: Span[] = [],
      seen = new Set([id]);
    let at = id,
      offset = 0;
    // The source navigation target can cross a seam before the physical body.
    // Include its short predecessor tail rather than losing cars ahead of it.
    for (
      let i = 0;
      i < network.lanes.size && offset > -REAR_WINDOW - NAVIGATION_PADDING;
      i++
    ) {
      const prev = this.next(at, true);
      if (!prev || seen.has(prev.lane)) break;
      seen.add(prev.lane);
      at = prev.lane;
      const length = network.lanes.get(at)!.curve.length;
      offset -= length + prev.gap;
      spans.unshift({ lane: at, offset, length });
    }
    at = id;
    offset = 0;
    seen.clear();
    seen.add(id);
    const limit =
      network.lanes.get(id)!.curve.length +
      MAX_LANE_LOOKAHEAD +
      NAVIGATION_PADDING;
    for (let i = 0; i < network.lanes.size; i++) {
      const length = network.lanes.get(at)!.curve.length;
      spans.push({ lane: at, offset, length });
      offset += length;
      if (offset >= limit) break;
      const next = this.next(at);
      if (!next || seen.has(next.lane)) break;
      seen.add(next.lane);
      offset += next.gap;
      at = next.lane;
    }
    this.corridors.set(id, spans);
    return spans;
  }
  private bound(rows: readonly Occupant[], value: number, inclusive: boolean) {
    let low = 0,
      high = rows.length;
    while (low < high) {
      this.statistics.binarySteps++;
      const middle = (low + high) >>> 1;
      if (rows[middle].s < value || (inclusive && rows[middle].s === value))
        low = middle + 1;
      else high = middle;
    }
    return low;
  }
  count(
    lane: string,
    self: number,
    position: number,
    distance: number,
    occupancy: ReadonlyMap<string, readonly Occupant[]>,
  ) {
    this.statistics.queries++;
    const ids = new Set<number>(),
      end = position + distance;
    for (const span of this.corridor(lane)) {
      if (span.offset > end + NAVIGATION_PADDING) break;
      if (span.offset + span.length < position - NAVIGATION_PADDING) continue;
      const rows = occupancy.get(span.lane) ?? [],
        first = this.bound(rows, position - span.offset, false),
        last = this.bound(rows, end - span.offset, true);
      for (let i = first; i < last; i++) {
        this.statistics.rowsVisited++;
        if (rows[i].id !== self) ids.add(rows[i].id);
      }
    }
    return ids.size;
  }
  gapClear(
    lane: string,
    self: number,
    position: number,
    speed: number,
    occupancy: ReadonlyMap<string, readonly Occupant[]>,
  ) {
    this.statistics.gapQueries++;
    const front = Math.max(6, speed * 1.1),
      from = position - REAR_WINDOW,
      end = position + front;
    for (const span of this.corridor(lane)) {
      if (span.offset > end + NAVIGATION_PADDING) break;
      if (span.offset + span.length < from - NAVIGATION_PADDING) continue;
      const rows = occupancy.get(span.lane) ?? [],
        first = this.bound(rows, from - span.offset, false),
        last = this.bound(rows, end - span.offset, true);
      for (let i = first; i < last; i++) {
        const row = rows[i];
        if (row.id === self) continue;
        const gap = span.offset + row.s - position;
        if (gap >= 0 ? gap < front : -gap < Math.max(6, (row.speed ?? 0) * 1.3))
          return false;
      }
    }
    return true;
  }
}

/** Choose among all eligible lanes, with no nearest-front-car proxy or weak
 * congestion weight. Equal counts retain the current lane, then a stable goal. */
export function leastOccupiedLane(
  members: readonly string[],
  eligible: readonly string[],
  current: string,
  counts: ReadonlyMap<string, number>,
  previous?: string,
) {
  const candidates = members.filter((id) => eligible.includes(id));
  if (!candidates.length) return current;
  const minimum = Math.min(...candidates.map((id) => counts.get(id) ?? 0)),
    best = candidates.filter((id) => (counts.get(id) ?? 0) === minimum);
  if (best.includes(current)) return current;
  if (previous && best.includes(previous)) return previous;
  const origin = members.indexOf(current);
  return best.sort(
    (a, b) =>
      Math.abs(members.indexOf(a) - origin) -
        Math.abs(members.indexOf(b) - origin) ||
      members.indexOf(a) - members.indexOf(b),
  )[0];
}
