import { isSink, isSource, type Port, type Project } from "./types";
import { laneCount, laneDirection, laneWidth } from "./math";

export const DEFAULT_TRAFFIC_BASE_RATE = 50;
export const MAX_TRAFFIC_BASE_RATE = 240;
export const MAX_ENTRY_PERCENT = 1000;
export const MAX_ENTRY_RATE = (MAX_TRAFFIC_BASE_RATE * MAX_ENTRY_PERCENT) / 100;
export type PortReference = Pick<Port, "road" | "end">;
export type DestinationShare = PortReference & { weight: number };
export const trafficPortKey = (p: PortReference) =>
  JSON.stringify([p.road, p.end]);
export const trafficBaseRate = (p: Project) =>
  p.trafficBaseRate ?? DEFAULT_TRAFFIC_BASE_RATE;
export const entryPercent = (p: Project, source: Port) =>
  (source.rate / trafficBaseRate(p)) * 100;
export function sourceLanes(p: Project, source: Port) {
  const r = p.roads.find((r) => r.id === source.road);
  if (!r || !isSource(source)) return [];
  const direction = source.end === "start" ? 1 : -1,
    t = source.end === "start" ? 0 : 1;
  return Array.from({ length: laneCount(r) }, (_, i) => i).filter(
    (i) =>
      laneDirection(r, i) === direction && laneWidth(r, i, t) >= r.width * 0.8,
  );
}
/** Explicit profiles are relative weights. Missing profiles track every current
 * exit equally; missing rows in an authored profile are intentionally zero. */
export function destinationShares(p: Project, source: Port) {
  const exits = p.ports.filter(
    (port) => isSink(port) && trafficPortKey(port) !== trafficPortKey(source),
  );
  const authored =
    source.destinations &&
    new Map(source.destinations.map((d) => [trafficPortKey(d), d.weight]));
  const weights = exits.map((port) =>
    Math.max(0, authored ? (authored.get(trafficPortKey(port)) ?? 0) : 1),
  );
  const total = weights.reduce((s, n) => s + n, 0);
  return exits.map((port, i) => ({
    port,
    percent: total > 0 ? (weights[i] / total) * 100 : 0,
  }));
}
export function sourceDemandRate(p: Project, source: Port) {
  return isSource(source) &&
    destinationShares(p, source).some((d) => d.percent > 0)
    ? Math.max(0, source.rate * (p.trafficMultiplier ?? 1))
    : 0;
}
export function chooseDestination(p: Project, source: Port, random: number) {
  const shares = destinationShares(p, source).filter((d) => d.percent > 0);
  let cursor = Math.max(0, Math.min(1 - Number.EPSILON, random)) * 100;
  for (const share of shares) {
    cursor -= share.percent;
    if (cursor < 0) return share.port;
  }
  return shares.at(-1)?.port;
}
/** Lock the edited percentage; redistribute the remainder proportionally. */
export function setDestinationPercent(
  p: Project,
  source: Port,
  target: PortReference,
  percent: number,
) {
  const shares = destinationShares(p, source),
    key = trafficPortKey(target);
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    !shares.some((d) => trafficPortKey(d.port) === key)
  )
    throw new Error("出口比例须为0–100%。");
  if (shares.length === 1 && percent !== 0 && percent !== 100)
    throw new Error("只有一个出口时可设为100%，或设为0%暂停。");
  const others = shares.filter((d) => trafficPortKey(d.port) !== key),
    total = others.reduce((s, d) => s + d.percent, 0);
  source.destinations = shares.map((d) => ({
    road: d.port.road,
    end: d.port.end,
    weight:
      trafficPortKey(d.port) === key
        ? percent
        : (100 - percent) *
          (total > 0 ? d.percent / total : 1 / Math.max(1, others.length)),
  }));
}
export function setTrafficBaseRate(p: Project, rate: number) {
  if (!Number.isFinite(rate) || rate < 1 || rate > MAX_TRAFFIC_BASE_RATE)
    throw new Error("100%基准须为1–240辆/分钟。");
  const factor = rate / trafficBaseRate(p);
  if (
    p.ports.some(
      (port) => isSource(port) && port.rate * factor > MAX_ENTRY_RATE,
    )
  )
    throw new Error("调整后入口流量过高，请先降低入口比例。");
  for (const source of p.ports.filter(isSource)) source.rate *= factor;
  p.trafficBaseRate = rate;
}
export function pruneDestinationShares(p: Project) {
  for (const source of p.ports)
    if (source.destinations) {
      if (!isSource(source)) {
        delete source.destinations;
        continue;
      }
      const exits = new Set(
        destinationShares(p, source).map((d) => trafficPortKey(d.port)),
      );
      source.destinations = source.destinations.filter((d) =>
        exits.has(trafficPortKey(d)),
      );
    }
}
export function validateTrafficDemand(p: Project) {
  if (
    p.trafficBaseRate !== undefined &&
    (!Number.isFinite(p.trafficBaseRate) ||
      p.trafficBaseRate < 1 ||
      p.trafficBaseRate > MAX_TRAFFIC_BASE_RATE)
  )
    throw new Error("100%基准须为1–240辆/分钟。");
  for (const source of p.ports) {
    if (
      isSource(source) &&
      source.rate > (trafficBaseRate(p) * MAX_ENTRY_PERCENT) / 100
    )
      throw new Error("入口比例须为0–1000%。");
    if (source.destinations === undefined) continue;
    if (!isSource(source) || !Array.isArray(source.destinations))
      throw new Error("入口出口比例格式不正确。");
    const keys = new Set<string>(),
      valid = new Set(
        destinationShares(p, { ...source, destinations: undefined }).map((d) =>
          trafficPortKey(d.port),
        ),
      );
    for (const d of source.destinations) {
      if (
        !d ||
        typeof d.road !== "string" ||
        !["start", "end"].includes(d.end) ||
        !Number.isFinite(d.weight) ||
        d.weight < 0 ||
        d.weight > 100
      )
        throw new Error("出口比例须为0–100%。");
      const key = trafficPortKey(d);
      if (keys.has(key) || !valid.has(key))
        throw new Error("出口比例引用了重复或不存在的出口。");
      keys.add(key);
    }
  }
}
