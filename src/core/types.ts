import type { TrafficSignal } from "./traffic-signals";
import type { JunctionLaneRule } from "./junction-lane-connections";

export type V = { x: number; y: number; z: number };
export type Knot = { p: V; incoming: V; outgoing: V; at?: number };
export type Turn = "left" | "straight" | "right";
export type LaneAttachment = {
  road: string;
  end: 0 | 1;
  lanes: number[];
  ownLanes: number[];
};
/** Node decoration is authored separately from every functional road property. */
export type RoadVisualArm = { road: string; end: 0 | 1 };
export type RoadNodeVisual = { arms: RoadVisualArm[]; smooth: true };
export type RoadVisualSettings = { version: 1; nodes: RoadNodeVisual[] };
export type AutomaticTaper = {
  lanes: number;
  backwardLanes?: number;
  firstLane: number;
  offset: number;
  /** Physical central-divider width at the attached endpoint, including zero. */
  medianWidth?: number;
  span: number;
};
export type Road = {
  id: string;
  name: string;
  knots: Knot[];
  lanesStart: number;
  lanesEnd: number;
  /** Reverse direction counts; absent preserves legacy symmetric roads. */
  backwardLanesStart?: number;
  backwardLanesEnd?: number;
  /** One-way carriageway offset from its editable reference spline, in metres. */
  sectionOffset?: number;
  /** Legacy import field. Runtime node decoration lives in Project.roadVisuals. */
  transitionMode?: "direct" | "smooth";
  median?: { kind: "concrete"; width: number };
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
    fromBackward?: number;
    toBackward?: number;
    start: number;
    end: number;
    transitionStart: number;
    transitionEnd: number;
  };
  widthOrigin?: number;
  attachments?: { start?: LaneAttachment; end?: LaneAttachment };
  turns?: Record<string, Turn[]>;
  /** Legacy derived display cache; ignored by logical geometry and discarded on import. */
  autoTaper?: { start?: AutomaticTaper; end?: AutomaticTaper };
  /** Last road-asset replacement, restored by right-click in replace mode. */
  replacedSection?: RoadSection;
};
export type RoadSection = Pick<
  Road,
  | "name"
  | "lanesStart"
  | "lanesEnd"
  | "backwardLanesStart"
  | "backwardLanesEnd"
  | "sectionOffset"
  | "transitionMode"
  | "median"
  | "twoWay"
  | "width"
  | "speed"
  | "align"
  | "kind"
  | "highwayRules"
  | "transitionStart"
  | "transitionEnd"
  | "profile"
  | "widthOrigin"
>;
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
  /** Optional authored OD shares. Missing means equal shares of all exits. */
  destinations?: { road: string; end: "start" | "end"; weight: number }[];
};
export type Blueprint = {
  id: string;
  name: string;
  roads: Road[];
  connections: Connection[];
  signals?: TrafficSignal[];
  junctionLaneConnections?: JunctionLaneRule[];
  roadVisuals?: RoadVisualSettings;
};
export type Project = {
  version: 1;
  name: string;
  roads: Road[];
  connections: Connection[];
  ports: Port[];
  templates: Blueprint[];
  trafficMultiplier?: number;
  /** Total vehicles/minute per entry at100%, divided among entry lanes. */
  trafficBaseRate?: number;
  /** Metres of fixed-route lane lookahead; absent uses500. */
  laneLookahead?: number;
  signals?: TrafficSignal[];
  junctionLaneConnections?: JunctionLaneRule[];
  roadVisuals?: RoadVisualSettings;
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
  | "widen"
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
