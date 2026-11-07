import type { TrafficSignal } from "./traffic-signals";

export type V = { x: number; y: number; z: number };
export type Knot = { p: V; incoming: V; outgoing: V; at?: number };
export type Turn = "left" | "straight" | "right";
export type LaneAttachment = {
  road: string;
  end: 0 | 1;
  lanes: number[];
  ownLanes: number[];
};
export type AutomaticTaper = {
  lanes: number;
  firstLane: number;
  offset: number;
  span: number;
};
export type Road = {
  id: string;
  name: string;
  knots: Knot[];
  lanesStart: number;
  lanesEnd: number;
  twoWay: boolean;
  width: number;
  speed: number;
  align: "left" | "center" | "right";
  kind: "road" | "ramp";
  /** Explicit traffic rule carried by highway assets; absent in older saves. */
  highwayRules?: boolean;
  transitionStart: number;
  transitionEnd: number;
  profile?: {
    from: number;
    to: number;
    start: number;
    end: number;
    transitionStart: number;
    transitionEnd: number;
  };
  widthOrigin?: number;
  attachments?: { start?: LaneAttachment; end?: LaneAttachment };
  turns?: Record<string, Turn[]>;
  autoTaper?: { start?: AutomaticTaper; end?: AutomaticTaper };
};
export type LaneRef = { road: string; lane: number };
export type Connection = {
  id: string;
  from: LaneRef;
  to: LaneRef;
  enabled: boolean;
  manual?: boolean;
};
export type Port = {
  road: string;
  end: "start" | "end";
  type: "source" | "sink" | "both";
  rate: number;
};
export type Blueprint = {
  id: string;
  name: string;
  roads: Road[];
  connections: Connection[];
  signals?: TrafficSignal[];
};
export type Project = {
  version: 1;
  name: string;
  roads: Road[];
  connections: Connection[];
  ports: Port[];
  templates: Blueprint[];
  trafficMultiplier?: number;
  signals?: TrafficSignal[];
};
export type Issue = {
  road?: string;
  message: string;
  severity: "error" | "warning";
};
export type Tool =
  | "select"
  | "line"
  | "curve"
  | "boundary"
  | "upgrade"
  | "delete"
  | "turn"
  | "signal";
export const isSource = (p: Port) => p.type === "source" || p.type === "both";
export const isSink = (p: Port) => p.type === "sink" || p.type === "both";
export type Settings = {
  grid: boolean;
  snap: boolean;
  arrows: boolean;
  paths: boolean;
  layer: number;
  ghost: boolean;
};
export const copy = <T>(x: T): T => structuredClone(x);
let counter = 0;
export const uid = (prefix = "r") =>
  `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;
