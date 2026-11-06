import { getAsset } from "../core/assets";
import { automaticTransitionPreview } from "../core/auto-transitions";
import {
  add,
  center,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  lerp,
  maxGrade,
  mul,
  nearest,
  point,
  roadLength,
  sub,
  tangent,
  v,
} from "../core/math";
import {
  History,
  autoBoundaries,
  autoJunction,
  connections,
  emptyProject,
  example,
  insertKnot,
  makeBranch,
  makeRoad,
  mirrorRoads,
  normalizePorts,
  parseProject,
  reconnectIntersections,
  remapRoadReferences,
  removeBoundary,
  removeRoads,
  reverseRoad,
  setBoundary,
  splitRoad,
  transformRoads,
  validate,
} from "../core/model";
import { endpointAnchors, laneAnchors, type Alignment } from "../core/snapping";
import { segmentRoads } from "../core/road-segments";
import {
  allowedTurns,
  attachLanes,
  laneNumber,
  TURNS,
} from "../core/lane-rules";
import {
  copy,
  isSource,
  uid,
  type Project,
  type Road,
  type Settings,
  type Tool,
  type Turn,
  type V,
} from "../core/types";
import { Scene, type Hit } from "../render/scene";
import { Simulation } from "../simulation/simulation";
import { TrafficLightTool } from "./traffic-light-tool";
import { cloneTrafficSignals } from "../core/traffic-signals";
export type SnapInfo = {
  kind: "endpoint" | "offset" | "road" | "angle" | "grid" | "lane";
  position: V;
  text: string;
  road?: string;
  t?: number;
  contact?: V;
  reference?: V;
  alignment?: Alignment;
  offset?: number;
  lanes?: number[];
  ownLanes?: number[];
  interior?: boolean;
};
export class Editor {
  project: Project;
  selected = new Set<string>();
  history = new History();
  scene: Scene;
  simulation = new Simulation();
  signalTool = new TrafficLightTool(this);
  tool: Tool = "select";
  assetId = "city-2";
  alignment: Alignment = "auto";
  laneSnapping = true;
  branch = {
    lanes: 1,
    side: "right" as "left" | "right",
    length: 65,
    offset: 32,
  };
  turnSelection?: { road: string; lane: number };
  private laneCandidate = 0;
  private laneCandidateKey = "";
  private laneCandidateCount = 0;
  settings: Settings = {
    grid: true,
    snap: true,
    arrows: false,
    paths: false,
    layer: -1,
    ghost: true,
  };
  draw = {
    lanesStart: 1,
    lanesEnd: 1,
    twoWay: true,
    width: 3.5,
    speed: 50,
    align: "center" as Road["align"],
    kind: "road" as Road["kind"],
    height: 0,
    endHeight: 0,
    transitionStart: 0,
    transitionEnd: 1,
  };
  drawPoints: V[] = [];
  private drawStartSnap?: SnapInfo;
  continuous = true;
  snapInfo?: SnapInfo;
  pointer?: V;
  hovered?: string;
  onChange = () => {};
  onStatus = (_s: string) => {};
  onToast = (_s: string) => {};
  private drag?: {
    snapshot: Project;
    hit?: Hit;
    start: V;
    x: number;
    y: number;
    height: number;
    moved: boolean;
    box?: boolean;
  };
  private pointerPress?: {
    button: number;
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  };
  private saveTimer?: ReturnType<typeof setTimeout>;
  get chosen() {
    return [...this.selected]
      .map((id) => this.project.roads.find((r) => r.id === id))
      .filter((r): r is Road => !!r);
  }
  get active() {
    return this.chosen[0];
  }
  get building() {
    return this.tool === "line" || this.tool === "curve";
  }
  constructor(el: HTMLElement) {
    let initial: Project | undefined;
    try {
      const saved = localStorage.getItem("interchange-lab:v1");
      if (saved) initial = parseProject(saved);
    } catch {}
    this.project = initial || example();
    normalizePorts(this.project);
    autoJunction(this.project);
    this.scene = new Scene(el);
    this.scene.fit(this.project.roads);
    this.bind();
    this.simulation.configure(this.project);
    this.refresh();
  }
  save(notify = false) {
    try {
      localStorage.setItem("interchange-lab:v1", JSON.stringify(this.project));
      document.querySelector("#save-state")!.textContent = "已保存";
      if (notify) this.onToast("地图已保存。");
    } catch {
      this.onToast("本机存储不可用，请导出地图备份。");
    }
  }
  queueSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  }
  refresh(ui = true) {
    this.scene.rebuild(
      this.project,
      this.selected,
      this.settings,
      this.tool === "select" && !this.simulation.running,
    );
    if (ui) this.onChange();
    this.queueSave();
  }
  stopForEdit() {
    this.simulation.running = false;
    normalizePorts(this.project);
    this.simulation.configure(this.project);
    this.scene.updateCars([]);
  }
  edit(fn: () => void, message?: string) {
    const before = copy(this.project);
    try {
      fn();
      if (JSON.stringify(before) === JSON.stringify(this.project)) return;
      normalizePorts(this.project);
      autoJunction(this.project);
      this.history.commit(before);
      this.stopForEdit();
      this.refresh();
      if (message) this.onToast(message);
    } catch (error) {
      this.project = before;
      this.stopForEdit();
      this.refresh();
      this.onToast((error as Error).message);
    }
  }
  setPortRate(index: number, rate: number) {
    const p = this.project.ports[index];
    if (
      !p ||
      !isSource(p) ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 240
    ) {
      this.onToast("入口基准流量为 0–240 辆/分。");
      this.onChange();
      return;
    }
    if (p.rate === rate) return;
    this.history.commit(this.project);
    p.rate = rate;
    this.queueSave();
    this.onChange();
  }
  select(id: string, append = false) {
    if (!append) this.selected.clear();
    if (append && this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.refresh();
  }
  cancel() {
    this.pointerPress = undefined;
    if (this.drag?.moved && !this.drag.box) {
      this.project = this.drag.snapshot;
      this.stopForEdit();
    }
    this.drag = undefined;
    this.drawPoints = [];
    this.drawStartSnap = undefined;
    this.snapInfo = undefined;
    this.scene.showPreviews([]);
    this.scene.showBuildMarker();
    this.scene.showLaneTarget();
    this.scene.setHover();
    this.scene.controls.enabled = true;
    document.querySelector<HTMLElement>("#selection-box")!.hidden = true;
    this.updateSnapFeedback();
  }
  setTool(tool: Tool) {
    this.cancel();
    this.tool = tool;
    if (this.building) this.selected.clear();
    this.refresh();
    this.onStatus(this.instructions());
    if (this.building)
      this.updatePlacement(this.pointer || this.scene.controls.target);
  }
  chooseAsset(id: string) {
    this.assetId = id;
    const asset = getAsset(id);
    Object.assign(this.draw, asset.options);
    this.branch.side = this.draw.align === "right" ? "left" : "right";
    this.setTool(
      this.tool === "curve"
        ? "curve"
        : this.tool === "upgrade"
          ? "upgrade"
          : "line",
    );
  }
  instructions() {
    return {
      select: "左键拖动旋转 · 右键拖动平移 · 滚轮或中键缩放 · 单击道路查看",
      line: "左键单击起点、终点 · 拖动可移动镜头 · 右键返回一步",
      curve: "依次点击起点、弯曲位置、终点 · 右键返回",
      boundary: "点击端点设置通行口 · 双向道路同时进出 · 右键取消通行口",
      delete: "拆除模式 · 悬停道路预览 · 左键拆除 · B / Esc 退出",
      upgrade: "先选择道路资产，再点击已有道路替换",
      turn: "点击地图中的车道，设置允许的左转、直行和右转 · J / Esc 退出",
      signal: "点击路口中心设置红绿灯 · 右键移除 · K / Esc 退出",
    }[this.tool];
  }
  private updateSnapFeedback() {
    const el = document.querySelector<HTMLElement>("#snap-feedback");
    if (!el) return;
    const snap = this.snapInfo;
    if (!snap || !this.building) {
      el.hidden = true;
      return;
    }
    const p = this.scene.project(snap.contact || snap.position),
      rect = this.scene.el.getBoundingClientRect();
    el.textContent = snap.text;
    el.dataset.kind = snap.kind;
    el.style.left = `${Math.max(12, Math.min(rect.width - 185, p.x - rect.left + 14))}px`;
    el.style.top = `${Math.max(68, Math.min(rect.height - 230, p.y - rect.top - 52))}px`;
    el.hidden = false;
  }
  snapped(p: V, exclude?: string, disabled = false): V {
    const previous = this.snapInfo;
    this.snapInfo = undefined;
    if (!this.settings.snap || disabled) return p;
    const screen = this.scene.project(p);
    if (
      this.building &&
      this.laneSnapping &&
      this.alignment === "auto" &&
      !this.draw.twoWay
    ) {
      const ownEnd = this.drawPoints.length ? 1 : 0;
      const candidates: {
        road: Road;
        t: number;
        anchor: ReturnType<typeof laneAnchors>[number];
        distance: number;
        interior: boolean;
      }[] = [];
      for (const road of this.project.roads) {
        if (road.id === exclude) continue;
        const near = nearest(road, p);
        const ts = [0, 1];
        if (
          this.draw.kind === "ramp" &&
          !road.twoWay &&
          road.lanesStart === road.lanesEnd &&
          !road.profile &&
          near.t > 0.04 &&
          near.t < 0.96
        )
          ts.push(near.t);
        for (const t of ts) {
          if (Math.abs(center(road, t).y - p.y) > 1.5) continue;
          const direction = mul(tangent(road, t), t === 0 ? -1 : 1);
          const proposed = this.drawPoints.length
            ? this.draft(p)
            : makeRoad(p, add(p, mul(direction, 32)), { ...this.draw });
          if (ownEnd === 1) {
            const toward = sub(p, this.drawPoints[0]),
              length = Math.hypot(toward.x, toward.z);
            if (
              length > 4 &&
              Math.abs(toward.x * direction.x + toward.z * direction.z) /
                length <
                0.7
            )
              continue;
          }
          for (const anchor of laneAnchors(road, t, proposed, ownEnd)) {
            if (t !== 0 && t !== 1) {
              const edge =
                Math.min(...anchor.lanes) === 0 ||
                Math.max(...anchor.lanes) === laneCount(road) - 1;
              if (!edge) continue;
            }
            const projected = this.scene.project(anchor.contact),
              distance = Math.hypot(
                screen.x - projected.x,
                screen.y - projected.y,
              );
            if (distance < 24)
              candidates.push({
                road,
                t,
                anchor,
                distance,
                interior: t !== 0 && t !== 1,
              });
          }
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      if (candidates.length) {
        const nearestCandidate = candidates[0],
          same = candidates.filter(
            (c) =>
              c.road.id === nearestCandidate.road.id &&
              Math.abs(c.t - nearestCandidate.t) < 0.001,
          );
        const key = `${nearestCandidate.road.id}:${nearestCandidate.t.toFixed(4)}:${ownEnd}`;
        if (key !== this.laneCandidateKey) {
          this.laneCandidate = 0;
          this.laneCandidateKey = key;
        }
        this.laneCandidateCount = same.length;
        const selected =
            same[
              ((this.laneCandidate % same.length) + same.length) % same.length
            ],
          { anchor, road, t } = selected;
        const numbers = anchor.lanes.map((lane) => laneNumber(road, lane, t));
        const offset = dist(anchor.contact, center(road, t));
        this.snapInfo = {
          kind: "lane",
          position: anchor.position,
          contact: anchor.contact,
          reference: center(road, t),
          road: road.id,
          t,
          lanes: anchor.lanes,
          ownLanes: anchor.ownLanes,
          interior: selected.interior,
          text: `车道吸附：${numbers.length === 1 ? `第 ${numbers[0]} 车道` : `第 ${numbers[0]}–${numbers.at(-1)} 车道`} · ${offset.toFixed(2)} m${same.length > 1 ? " · Tab 切换" : ""}`,
        };
        return anchor.position;
      }
      this.laneCandidateCount = 0;
      this.laneCandidateKey = "";
    }
    let best:
      | {
          p: V;
          distance: number;
          road: string;
          t: number;
          contact?: V;
          reference?: V;
          alignment?: Alignment;
          offset?: number;
        }
      | undefined;
    for (const r of this.project.roads) {
      if (r.id === exclude) continue;
      for (const t of [0, 1] as const) {
        const q = center(r, t);
        if (Math.abs(q.y - p.y) > 1.5) continue;
        const proposed = this.drawPoints.length
          ? this.draft(p)
          : makeRoad(p, add(p, mul(tangent(r, t), t === 0 ? -32 : 32)), {
              ...this.draw,
            });
        const anchors = this.building
          ? endpointAnchors(
              r,
              t,
              proposed,
              this.drawPoints.length ? 1 : 0,
              this.alignment,
            )
          : [
              {
                position: q,
                contact: q,
                reference: q,
                alignment: "center" as const,
                offset: 0,
              },
            ];
        for (const a of anchors) {
          const s = this.scene.project(a.contact);
          let distance = Math.hypot(screen.x - s.x, screen.y - s.y);
          if (
            previous?.road === r.id &&
            previous.t === t &&
            previous.alignment === a.alignment
          )
            distance -= 2;
          if (distance < 24 && (!best || distance < best.distance))
            best = { p: a.position, distance, road: r.id, t, ...a };
        }
      }
    }
    if (best) {
      const offset = Math.abs(best.offset || 0) > 0.05;
      this.snapInfo = {
        kind: offset ? "offset" : "endpoint",
        position: best.p,
        contact: best.contact,
        reference: offset ? best.reference : undefined,
        alignment: best.alignment,
        offset: best.offset,
        road: best.road,
        t: best.t,
        text: offset
          ? `偏移吸附：${best.alignment === "left" ? "左" : "右"}缘对齐 · ${Math.abs(best.offset!).toFixed(2)} m`
          : "吸附：道路端点",
      };
      return best.p;
    }
    for (const r of this.project.roads) {
      if (r.id === exclude) continue;
      const n = nearest(r, p);
      if (Math.abs(n.point.y - p.y) > 1 || n.t < 0.015 || n.t > 0.985) continue;
      const s = this.scene.project(n.point),
        edge = this.scene.project(
          add(
            n.point,
            mul(
              { x: -tangent(r, n.t).z, y: 0, z: tangent(r, n.t).x },
              (r.width * laneCount(r)) / 2,
            ),
          ),
        );
      const threshold = Math.max(
          16,
          Math.hypot(s.x - edge.x, s.y - edge.y) + 8,
        ),
        distance = Math.hypot(screen.x - s.x, screen.y - s.y);
      if (distance < threshold && (!best || distance < best.distance))
        best = { p: n.point, distance, road: r.id, t: n.t };
    }
    if (best) {
      this.snapInfo = {
        kind: "road",
        position: best.p,
        text: "吸附：接入道路，自动生成路口",
        road: best.road,
        t: best.t,
      };
      return best.p;
    }
    if (this.drawPoints.length) {
      const a = this.drawPoints[0],
        dx = p.x - a.x,
        dz = p.z - a.z,
        length = Math.hypot(dx, dz),
        angle = Math.atan2(dz, dx),
        target = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4,
        q = v(
          a.x + Math.cos(target) * length,
          a.z + Math.sin(target) * length,
          p.y,
        ),
        s = this.scene.project(q);
      if (length > 5 && Math.hypot(s.x - screen.x, s.y - screen.y) < 13) {
        this.snapInfo = {
          kind: "angle",
          position: q,
          text: `方向对齐 ${Math.round((target * 180) / Math.PI)}°`,
        };
        return q;
      }
    }
    if (this.settings.grid) {
      const q = v(Math.round(p.x / 5) * 5, Math.round(p.z / 5) * 5, p.y),
        s = this.scene.project(q);
      if (Math.hypot(screen.x - s.x, screen.y - s.y) < 10) {
        this.snapInfo = { kind: "grid", position: q, text: "网格对齐" };
        return q;
      }
    }
    return p;
  }
  cycleAlignment() {
    const modes: Alignment[] = ["auto", "center", "left", "right"];
    this.alignment = modes[(modes.indexOf(this.alignment) + 1) % modes.length];
    this.onChange();
    if (this.building && this.pointer) this.updatePlacement(this.pointer);
  }
  cycleLane(direction = 1) {
    if (this.snapInfo?.kind === "lane" && this.laneCandidateCount > 1) {
      this.laneCandidate += direction;
      if (this.pointer) this.updatePlacement(this.pointer);
    } else this.cycleAlignment();
  }
  private branchOptions(r: Road) {
    const count =
      getAsset(this.assetId).action === "merge" ? r.lanesStart : r.lanesEnd;
    return {
      ...this.branch,
      lanes: Math.max(1, Math.min(this.branch.lanes, count - 1)),
    };
  }
  changeBuildCount(end: "lanesStart" | "lanesEnd", delta: number) {
    this.draw[end] = Math.max(1, Math.min(6, this.draw[end] + delta));
    const action = getAsset(this.assetId).action;
    if (action && this.draw[action === "merge" ? "lanesStart" : "lanesEnd"] < 2)
      this.draw[action === "merge" ? "lanesStart" : "lanesEnd"] = 2;
    if (
      !this.draw.twoWay &&
      this.draw.lanesStart !== this.draw.lanesEnd &&
      this.draw.align === "center"
    )
      this.draw.align = "left";
    this.onChange();
    if (this.pointer) this.updatePlacement(this.pointer);
  }
  setBuildSide(side: "left" | "right") {
    this.branch.side = side;
    this.draw.align = side === "left" ? "right" : "left";
    this.onChange();
    if (this.pointer) this.updatePlacement(this.pointer);
  }
  changeBranchLanes(delta: number) {
    const count =
      getAsset(this.assetId).action === "merge"
        ? this.draw.lanesStart
        : this.draw.lanesEnd;
    this.branch.lanes = Math.max(
      1,
      Math.min(count - 1, this.branch.lanes + delta),
    );
    this.onChange();
    if (this.pointer) this.updatePlacement(this.pointer);
  }
  setBranchLength(length: number) {
    this.branch.length = Math.max(20, Math.min(180, length));
    this.branch.offset = Math.max(12, Math.min(50, this.branch.length * 0.5));
    if (this.pointer) this.updatePlacement(this.pointer);
  }
  private turnHit(x: number, y: number) {
    const hit = this.scene.hit(x, y),
      road = this.project.roads.find((r) => r.id === hit?.road);
    if (!road) return;
    const raw = this.scene.groundPoint(
      x,
      y,
      hit?.position?.y ?? center(road, 0.5).y,
    );
    if (!raw) return;
    const near = nearest(road, raw);
    const lanes = Array.from({ length: laneCount(road) }, (_, lane) => lane)
      .filter(
        (lane) =>
          laneWidth(road, lane, near.t) > road.width * 0.7 &&
          laneWidth(road, lane, laneDirection(road, lane) === 1 ? 1 : 0) >
            road.width * 0.7,
      )
      .sort(
        (a, b) =>
          dist(lanePoint(road, a, near.t), raw) -
          dist(lanePoint(road, b, near.t), raw),
      );
    if (lanes.length) return { road, lane: lanes[0] };
  }
  toggleTurn(turn: Turn) {
    const choice = this.turnSelection,
      road = this.project.roads.find((r) => r.id === choice?.road);
    if (!choice || !road) return;
    this.edit(() => {
      const turns = allowedTurns(road, choice.lane);
      road.turns ??= {};
      road.turns[choice.lane] = turns.includes(turn)
        ? turns.filter((t) => t !== turn)
        : TURNS.filter((t) => t === turn || turns.includes(t));
    }, "车道转向规则已更新");
    this.scene.showLaneTarget(
      road,
      [choice.lane],
      laneDirection(road, choice.lane) === 1 ? 1 : 0,
    );
  }
  resetTurns() {
    const choice = this.turnSelection,
      road = this.project.roads.find((r) => r.id === choice?.road);
    if (!choice || !road) return;
    this.edit(() => {
      if (road.turns) delete road.turns[choice.lane];
    }, "已恢复自动转向规则");
  }
  private draft(q: V, endSnap?: SnapInfo) {
    let a = this.drawPoints[0] || q;
    const control = this.drawPoints[1];
    // The first click cannot know whether this is a parallel continuation or a turn.
    // Re-evaluate that attachment in both the preview and the committed geometry.
    if (this.drawStartSnap?.kind === "offset") {
      const reference = this.project.roads.find(
        (r) => r.id === this.drawStartSnap!.road,
      );
      const toward = this.tool === "curve" && control ? control : q;
      const delta = sub(toward, a),
        length = Math.hypot(delta.x, delta.z);
      if (reference && length > 4) {
        const d = tangent(reference, this.drawStartSnap.t || 0);
        if (Math.abs((delta.x * d.x + delta.z * d.z) / length) < 0.94)
          a = center(reference, this.drawStartSnap.t || 0);
      }
    }
    const r =
      this.tool === "curve" && control
        ? makeRoad(
            a,
            q,
            { ...this.draw },
            lerp(a, control, 2 / 3),
            lerp(q, control, 2 / 3),
          )
        : makeRoad(a, q, { ...this.draw });
    if (this.drawStartSnap?.road) {
      const reference = this.project.roads.find(
        (old) => old.id === this.drawStartSnap!.road,
      );
      if (reference) {
        const t = this.drawStartSnap.t || 0,
          d = mul(tangent(reference, t), t === 0 ? -1 : 1),
          toward = sub(q, a),
          length = Math.hypot(toward.x, toward.z);
        if (length > 8 && (toward.x * d.x + toward.z * d.z) / length > 0.75)
          r.knots[0].outgoing = add(a, mul(d, Math.min(length / 3, 35)));
      }
    }
    if (
      (endSnap?.kind === "offset" || endSnap?.kind === "endpoint") &&
      endSnap.road
    ) {
      const reference = this.project.roads.find(
        (old) => old.id === endSnap.road,
      );
      if (reference) {
        const d = tangent(reference, endSnap.t || 0),
          toward = sub(q, a),
          dot = toward.x * d.x + toward.z * d.z,
          sign = dot >= 0 ? 1 : -1,
          length = Math.hypot(toward.x, toward.z),
          handle = Math.min(length / 3, 35);
        if (length > 8 && Math.abs(dot) / length > 0.75)
          r.knots.at(-1)!.incoming = add(q, mul(d, -sign * handle));
      }
    }
    if (endSnap?.contact) {
      const correction = sub(endSnap.contact, center(r, 1)),
        last = r.knots.at(-1)!;
      last.p = add(last.p, correction);
      last.incoming = add(last.incoming, correction);
      last.outgoing = add(last.outgoing, correction);
    }
    if (this.tool === "curve" && control)
      for (const end of [0, 1])
        for (const old of this.project.roads) {
          const t = end === 0 ? 1 : 0;
          if (dist(point(r, end), center(old, t)) > 0.7) continue;
          const d = tangent(old, t),
            current = tangent(r, end);
          if (d.x * current.x + d.z * current.z < 0.5) continue;
          const k = end === 0 ? r.knots[0] : r.knots.at(-1)!,
            key = end === 0 ? "outgoing" : "incoming";
          k[key] = add(k.p, mul(d, dist(k.p, k[key]) * (end === 0 ? 1 : -1)));
          break;
        }
    for (const [ownEnd, snap] of [
      [0, this.drawStartSnap],
      [1, endSnap],
    ] as const) {
      if (snap?.kind !== "lane" || !snap.road || !snap.lanes || !snap.ownLanes)
        continue;
      const reference = this.project.roads.find((old) => old.id === snap.road);
      if (reference)
        attachLanes(
          r,
          ownEnd,
          reference,
          snap.t ?? 0,
          snap.lanes,
          snap.ownLanes,
        );
    }
    return r;
  }
  private draftBundle(r: Road) {
    const asset = getAsset(this.assetId);
    if (!asset.action) return [r];
    const p = emptyProject();
    p.roads = [r];
    makeBranch(p, r.id, asset.action === "merge", this.branchOptions(r));
    return p.roads;
  }
  updatePlacement(raw: V, alt = false) {
    if (!this.building) return;
    this.pointer = { x: raw.x, y: raw.y, z: raw.z };
    const q = this.snapped(raw, undefined, alt);
    let road: Road;
    if (!this.drawPoints.length) {
      let direction = v(1, 0);
      if (this.snapInfo?.road) {
        const r = this.project.roads.find((r) => r.id === this.snapInfo!.road)!;
        direction = mul(
          tangent(r, this.snapInfo.t ?? 1),
          this.snapInfo.t === 0 ? -1 : 1,
        );
      }
      const end = add(q, mul(direction, 32));
      road = makeRoad(q, end, { ...this.draw });
    } else road = this.draft(q, this.snapInfo);
    let bundle = [road],
      invalid = roadLength(road) < 3;
    try {
      bundle = this.draftBundle(road);
    } catch {
      invalid = true;
    }
    const transitionPreview = automaticTransitionPreview(this.project, bundle);
    bundle = transitionPreview.roads;
    const warning =
      maxGrade(road) > 15
        ? "坡度过大，请延长道路"
        : road.lanesStart !== road.lanesEnd &&
            roadLength(road) * (road.transitionEnd - road.transitionStart) < 15
          ? "过渡过短，建议至少 15 m"
          : "";
    this.scene.showPreviews(bundle, invalid || !!warning);
    this.scene.showBuildMarker(
      this.snapInfo?.contact || q,
      this.snapInfo?.kind === "endpoint" ||
        this.snapInfo?.kind === "road" ||
        this.snapInfo?.kind === "offset" ||
        this.snapInfo?.kind === "lane",
      this.snapInfo?.reference,
    );
    this.scene.setHover(this.snapInfo?.road, "snap");
    const reference = this.project.roads.find(
      (r) => r.id === this.snapInfo?.road,
    );
    this.scene.showLaneTarget(
      reference,
      this.snapInfo?.lanes,
      this.snapInfo?.t,
    );
    this.updateSnapFeedback();
    this.onStatus(
      `${warning ? warning + " · " : ""}${transitionPreview.hasTransitions ? "自动生成车道过渡 · " : ""}${this.snapInfo?.text || this.instructions()} · ${roadLength(road).toFixed(0)} m · 最大坡度 ${maxGrade(road).toFixed(1)}%`,
    );
  }
  private finishDraw() {
    const end = this.drawPoints.at(-1)!,
      r = this.draft(end, this.snapInfo);
    r.name = getAsset(this.assetId).name;
    if (roadLength(r) < 4) {
      this.onToast("道路过短，请将终点移远一点。");
      this.drawPoints.pop();
      return;
    }
    this.edit(() => {
      const descendants = new Map<string, Set<string>>();
      for (const [ownEnd, snap] of [
        [0, this.drawStartSnap],
        [1, this.snapInfo],
      ] as const) {
        if (
          snap?.kind !== "lane" ||
          !snap.road ||
          !snap.lanes ||
          !snap.ownLanes
        )
          continue;
        const original = this.project.roads.find((old) => old.id === snap.road);
        const ids = descendants.get(snap.road) ?? new Set([snap.road]);
        descendants.set(snap.road, ids);
        const originalPoint =
          snap.reference ?? (original && center(original, snap.t ?? 0));
        if (!originalPoint) continue;
        let reference = this.project.roads
          .filter((old) => ids.has(old.id))
          .sort(
            (a, b) =>
              nearest(a, originalPoint).distance -
              nearest(b, originalPoint).distance,
          )[0];
        if (!reference) throw new Error("目标道路已改变，请重新选择车道。");
        const near = nearest(reference, originalPoint);
        let targetEnd: 0 | 1 = near.t < 0.5 ? 0 : 1;
        if (snap.interior && near.t > 0.025 && near.t < 0.975) {
          const next = splitRoad(this.project, reference.id, near.t);
          if (!next) throw new Error("此处空间不足，无法接出匝道。");
          ids.add(next);
          if (ownEnd === 1)
            reference = this.project.roads.find((old) => old.id === next)!;
          else
            reference = this.project.roads.find(
              (old) => old.id === reference.id,
            )!;
          targetEnd = ownEnd === 0 ? 1 : 0;
        }
        attachLanes(r, ownEnd, reference, targetEnd, snap.lanes, snap.ownLanes);
      }
      for (const t of [0, 1]) {
        const q = center(r, t);
        for (const old of [...this.project.roads]) {
          const n = nearest(old, q);
          if (
            n.distance < 0.45 &&
            Math.abs(n.point.y - q.y) < 0.5 &&
            n.t > 0.025 &&
            n.t < 0.975
          )
            splitRoad(this.project, old.id, n.t);
        }
      }
      const beforeBuild = new Set(this.project.roads.map((road) => road.id));
      this.project.roads.push(r);
      const action = getAsset(this.assetId).action;
      if (action)
        makeBranch(this.project, r.id, action === "merge", {
          ...this.branchOptions(r),
        });
      segmentRoads(
        this.project,
        new Set(
          this.project.roads
            .filter((road) => !beforeBuild.has(road.id))
            .map((road) => road.id),
        ),
      );
      reconnectIntersections(this.project);
      autoJunction(this.project);
      this.selected.clear();
    }, "道路已建造");
    const continuation = this.project.roads.find(
      (road) =>
        dist(center(road, 1), center(r, 1)) < 0.01 &&
        tangent(road, 1).x * tangent(r, 1).x +
          tangent(road, 1).z * tangent(r, 1).z >
          0.99,
    );
    const keep =
      this.continuous &&
      r.lanesStart === r.lanesEnd &&
      !getAsset(this.assetId).action &&
      continuation;
    this.drawPoints = keep ? [copy(center(continuation!, 1))] : [];
    this.drawStartSnap = keep
      ? {
          kind: "endpoint",
          position: copy(center(continuation!, 1)),
          contact: copy(center(continuation!, 1)),
          road: continuation!.id,
          t: 1,
          text: "继续建造道路",
        }
      : undefined;
    this.scene.showPreviews([]);
    this.scene.showBuildMarker();
    this.scene.showLaneTarget();
    this.onStatus(this.instructions());
  }
  private boundaryHit(x: number, y: number) {
    const marked = this.scene.portHit(x, y);
    if (marked) return marked;
    const hit = this.scene.hit(x, y);
    let best:
      { road: string; end: "start" | "end"; distance: number } | undefined;
    for (const r of this.project.roads)
      for (const end of ["start", "end"] as const) {
        const q = this.scene.project(center(r, end === "start" ? 0 : 1));
        const distance = Math.hypot(q.x - x, q.y - y);
        const threshold = hit?.road === r.id ? 40 : 24;
        if (distance < threshold && (!best || distance < best.distance))
          best = { road: r.id, end, distance };
      }
    return best;
  }

  private leftClick(e: PointerEvent) {
    const hit = this.scene.hit(e.clientX, e.clientY),
      raw = this.scene.groundPoint(
        e.clientX,
        e.clientY,
        this.drawPoints.length ? this.draw.endHeight : this.draw.height,
      );
    if (!raw) return;
    if (this.tool === "signal") {
      this.signalTool.select(e.clientX, e.clientY);
      return;
    }
    if (this.tool === "turn") {
      const choice = this.turnHit(e.clientX, e.clientY);
      if (choice) {
        this.turnSelection = { road: choice.road.id, lane: choice.lane };
        this.scene.showLaneTarget(
          choice.road,
          [choice.lane],
          laneDirection(choice.road, choice.lane) === 1 ? 1 : 0,
        );
        this.onChange();
      }
      return;
    }
    if (this.building) {
      const q = this.snapped(raw, undefined, e.altKey);
      if (!this.drawPoints.length)
        this.drawStartSnap = this.snapInfo ? copy(this.snapInfo) : undefined;
      this.drawPoints.push(q);
      if (this.drawPoints.length === (this.tool === "line" ? 2 : 3))
        this.finishDraw();
      else this.updatePlacement(raw, e.altKey);
      return;
    }
    if (this.tool === "delete") {
      if (hit?.road)
        this.edit(() => {
          removeRoads(this.project, new Set([hit.road!]));
          this.selected.delete(hit.road!);
        }, "道路已拆除");
      this.scene.setHover();
      return;
    }
    if (this.tool === "boundary") {
      const port = this.boundaryHit(e.clientX, e.clientY);
      if (!port) {
        this.onToast("请点击道路的端点。");
        return;
      }
      this.edit(
        () => setBoundary(this.project, port.road, port.end),
        "已设置通行口；双向道路可同时进出",
      );
      return;
    }
    if (this.tool === "upgrade") {
      if (!hit?.road) return;
      this.edit(() => {
        const r = this.project.roads.find((r) => r.id === hit.road)!;
        Object.assign(r, getAsset(this.assetId).options);
        r.name = getAsset(this.assetId).name;
        delete r.profile;
        delete r.widthOrigin;
        reconnectIntersections(this.project);
      }, "道路已替换");
      return;
    }
    if (hit?.road) this.select(hit.road, e.shiftKey);
    else if (!e.shiftKey) {
      this.selected.clear();
      this.refresh();
    }
  }

  private rightClick(e: PointerEvent) {
    if (this.tool === "signal") {
      const junction = this.signalTool.hit(e.clientX, e.clientY);
      if (junction) {
        this.signalTool.selected = junction.id;
        this.signalTool.remove();
        this.onChange();
        return;
      }
    }
    const port = this.boundaryHit(e.clientX, e.clientY);
    if (
      (this.tool === "boundary" || this.tool === "select") &&
      port &&
      this.project.ports.some((p) => p.road === port.road && p.end === port.end)
    ) {
      this.edit(
        () => removeBoundary(this.project, port.road, port.end),
        "已取消此处通行口",
      );
      return;
    }
    if (this.building && this.drawPoints.length) {
      this.drawPoints.pop();
      if (!this.drawPoints.length) this.drawStartSnap = undefined;
      const raw = this.scene.groundPoint(e.clientX, e.clientY);
      if (raw) this.updatePlacement(raw, e.altKey);
      else this.scene.showPreviews([]);
      this.onStatus(
        this.drawPoints.length
          ? "已返回上一个绘制点。"
          : "已取消当前道路，继续选择起点。",
      );
      return;
    }
    if (this.tool !== "select") this.setTool("select");
    else if (this.selected.size) {
      this.selected.clear();
      this.refresh();
    }
  }

  bind() {
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (![0, 1, 2].includes(e.button)) return;
        this.pointerPress = {
          button: e.button,
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        if (e.button === 1) e.preventDefault();
        if (e.button !== 0 || this.building || this.tool !== "select") return;
        const hit = this.scene.hit(e.clientX, e.clientY),
          raw = this.scene.groundPoint(e.clientX, e.clientY);
        if (!raw) return;
        if (hit?.road && (hit.handle || e.altKey)) {
          if (!this.selected.has(hit.road)) this.select(hit.road, e.shiftKey);
          const handle = hit.handle ? hit : undefined,
            height = handle
              ? this.project.roads.find((r) => r.id === handle.road)!.knots[
                  handle.knot!
                ][handle.part!].y
              : (hit.position?.y ?? 0);
          this.drag = {
            snapshot: copy(this.project),
            hit: handle,
            start: this.scene.groundPoint(e.clientX, e.clientY, height)!,
            x: e.clientX,
            y: e.clientY,
            height,
            moved: false,
          };
        } else if (!hit?.road && e.shiftKey)
          this.drag = {
            snapshot: copy(this.project),
            start: raw,
            x: e.clientX,
            y: e.clientY,
            height: 0,
            moved: false,
            box: true,
          };
        if (this.drag) {
          this.scene.controls.enabled = false;
          canvas.setPointerCapture(e.pointerId);
        }
      },
      { capture: true },
    );
    canvas.addEventListener("pointermove", (e) => {
      if (this.pointerPress?.pointerId === e.pointerId)
        this.pointerPress.moved ||=
          Math.hypot(
            e.clientX - this.pointerPress.x,
            e.clientY - this.pointerPress.y,
          ) >= 4;
      const height =
          this.drag?.height ??
          (this.drawPoints.length ? this.draw.endHeight : this.draw.height),
        raw = this.scene.groundPoint(e.clientX, e.clientY, height);
      if (!raw) return;
      this.pointer = raw;
      if (this.drag) {
        const d = this.drag;
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4)
          return;
        d.moved = true;
        if (d.box) {
          const rect = this.scene.el.getBoundingClientRect(),
            box = document.querySelector<HTMLElement>("#selection-box")!;
          box.hidden = false;
          Object.assign(box.style, {
            left: `${Math.min(e.clientX, d.x) - rect.left}px`,
            top: `${Math.min(e.clientY, d.y) - rect.top}px`,
            width: `${Math.abs(e.clientX - d.x)}px`,
            height: `${Math.abs(e.clientY - d.y)}px`,
          });
          return;
        }
        this.project = copy(d.snapshot);
        const delta = sub(raw, d.start),
          hit = d.hit;
        if (hit) {
          const r = this.project.roads.find((r) => r.id === hit.road)!,
            k = r.knots[hit.knot!],
            original = copy(k[hit.part!]),
            target = this.snapped(add(original, delta), r.id, e.altKey),
            move = sub(target, original);
          if (hit.part === "p") {
            k.p = target;
            k.incoming = add(k.incoming, move);
            k.outgoing = add(k.outgoing, move);
            if (hit.knot === 0 || hit.knot === r.knots.length - 1)
              for (const other of this.project.roads) {
                if (other.id === r.id) continue;
                for (const endpoint of [0, other.knots.length - 1]) {
                  const ok = other.knots[endpoint];
                  if (dist(ok.p, original) < 0.8) {
                    ok.p = add(ok.p, move);
                    ok.incoming = add(ok.incoming, move);
                    ok.outgoing = add(ok.outgoing, move);
                  }
                }
              }
          } else {
            k[hit.part!] = target;
            if (hit.knot! > 0 && hit.knot! < r.knots.length - 1 && !e.altKey) {
              const opposite =
                  hit.part === "incoming" ? "outgoing" : "incoming",
                length = dist(k.p, k[opposite]);
              k[opposite] = add(
                k.p,
                mul(
                  sub(k.p, target),
                  length / Math.max(0.01, dist(k.p, target)),
                ),
              );
            }
          }
        } else transformRoads(this.chosen, (p) => add(p, delta));
        this.scene.rebuild(this.project, this.selected, this.settings);
        return;
      }
      if (this.building) {
        this.updatePlacement(raw, e.altKey);
        canvas.style.cursor = "crosshair";
        return;
      }
      if (this.tool === "turn") {
        const choice = this.turnHit(e.clientX, e.clientY);
        const selected = this.turnSelection;
        const road =
          choice?.road ??
          this.project.roads.find((r) => r.id === selected?.road);
        const lane = choice?.lane ?? selected?.lane;
        this.scene.setHover();
        this.scene.showLaneTarget(
          road,
          lane === undefined ? [] : [lane],
          road && lane !== undefined
            ? laneDirection(road, lane) === 1
              ? 1
              : 0
            : 1,
        );
        canvas.style.cursor = "crosshair";
        return;
      }
      if (this.tool === "signal") {
        const junction = this.signalTool.hit(e.clientX, e.clientY);
        this.scene.setHover();
        this.scene.showBuildMarker(junction?.position, true);
        canvas.style.cursor = "crosshair";
        return;
      }
      const hit = this.scene.hit(e.clientX, e.clientY);
      this.hovered = hit?.road;
      this.scene.setHover(
        hit?.road,
        this.tool === "delete"
          ? "delete"
          : this.tool === "upgrade"
            ? "upgrade"
            : "select",
      );
      canvas.style.cursor =
        this.tool === "delete"
          ? "crosshair"
          : hit?.handle
            ? "move"
            : hit?.road
              ? "pointer"
              : "grab";
      if (this.tool === "boundary") {
        const p = this.boundaryHit(e.clientX, e.clientY);
        if (p) {
          const r = this.project.roads.find((r) => r.id === p.road)!;
          this.scene.showBuildMarker(
            center(r, p.end === "start" ? 0 : 1),
            true,
          );
          this.onStatus(
            r.twoWay
              ? "双向通行口：左键设置，右键取消"
              : "左键设置入口或出口，右键取消",
          );
        } else this.scene.showBuildMarker();
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      const press = this.pointerPress;
      this.pointerPress = undefined;
      if (!this.drag) {
        if (!press || press.pointerId !== e.pointerId) return;
        const moved =
          press.moved ||
          Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 4;
        if (moved) {
          if (this.building) {
            const raw = this.scene.groundPoint(e.clientX, e.clientY);
            if (raw) this.updatePlacement(raw, e.altKey);
          }
          return;
        }
        if (press.button === 0) this.leftClick(e);
        if (press.button === 1) this.scene.controls.dollyIn(1.25);
        if (press.button === 2) this.rightClick(e);
        return;
      }
      const d = this.drag;
      this.drag = undefined;
      this.scene.controls.enabled = true;
      if (d.box) {
        const x0 = Math.min(d.x, e.clientX),
          x1 = Math.max(d.x, e.clientX),
          y0 = Math.min(d.y, e.clientY),
          y1 = Math.max(d.y, e.clientY);
        for (const r of this.project.roads) {
          const p = this.scene.project(center(r, 0.5));
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
            this.selected.add(r.id);
        }
        document.querySelector<HTMLElement>("#selection-box")!.hidden = true;
      } else if (d.moved) {
        this.history.commit(d.snapshot);
        reconnectIntersections(this.project);
        this.stopForEdit();
      }
      this.refresh();
    });
    canvas.addEventListener("pointercancel", () => {
      this.pointerPress = undefined;
      if (this.drag) {
        this.cancel();
        this.refresh();
      }
    });
    canvas.addEventListener("pointerleave", () => {
      if (this.drag || this.pointerPress) return;
      this.scene.setHover();
      this.scene.showBuildMarker();
      this.scene.showPreviews([]);
      this.snapInfo = undefined;
      this.updateSnapFeedback();
    });
    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.matches("input,textarea,select") ||
        target.isContentEditable ||
        document.querySelector("dialog[open]")
      )
        return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        this.action(e.shiftKey ? "redo" : "undo");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();
        this.action(e.shiftKey ? "export" : "save");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "d") {
        e.preventDefault();
        this.action("duplicate");
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (target.closest("button,a") && (e.key === " " || e.key === "Enter"))
        return;
      if (
        /^(Key[WASDQETGRF]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(
          e.code,
        )
      ) {
        if (e.code === "KeyF" && e.shiftKey) {
          e.preventDefault();
          this.scene.fit(this.chosen.length ? this.chosen : this.project.roads);
          return;
        }
        this.scene.setCameraKey(e.code, true);
        if (e.code !== "ShiftLeft" && e.code !== "ShiftRight")
          e.preventDefault();
        return;
      }
      if (e.key === "Tab" && this.building && target === this.scene.el) {
        e.preventDefault();
        this.cycleLane(e.shiftKey ? -1 : 1);
        return;
      }
      if (key === "b") {
        e.preventDefault();
        this.setTool(this.tool === "delete" ? "select" : "delete");
        return;
      }
      if (key === "v") this.setTool("select");
      if (key === "l") this.setTool("line");
      if (key === "c") this.setTool("curve");
      if (key === "u") this.setTool("upgrade");
      if (key === "i") this.setTool("boundary");
      if (key === "j") this.setTool(this.tool === "turn" ? "select" : "turn");
      if (key === "k")
        this.setTool(this.tool === "signal" ? "select" : "signal");
      if (e.key === "Escape") {
        this.setTool("select");
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        this.action("delete");
      }
      if (e.key === "Backspace" && this.drawPoints.length) {
        e.preventDefault();
        this.drawPoints.pop();
        this.scene.showPreviews([]);
      }
      if (e.key === " ") {
        e.preventDefault();
        this.action("play");
      }
      if (key === "h") this.scene.top();
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        this.changeHeight(e.key === "PageUp" ? 8 : -8);
      }
    });
    window.addEventListener("keyup", (e) =>
      this.scene.setCameraKey(e.code, false),
    );
    window.addEventListener("blur", () => this.scene.clearCameraKeys());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.scene.clearCameraKeys();
    });
  }
  changeHeight(delta: number) {
    this.draw.endHeight = Math.max(
      0,
      Math.min(80, this.draw.endHeight + delta),
    );
    if (!this.drawPoints.length) this.draw.height = this.draw.endHeight;
    this.onChange();
    if (this.building)
      this.updatePlacement(this.pointer || this.scene.controls.target);
    this.onToast(
      this.draw.endHeight === 0
        ? "地面道路"
        : `建造高度 ${this.draw.endHeight} 米`,
    );
  }
  duplicate(template = false) {
    if (!this.chosen.length) return;
    const roads = copy(this.chosen),
      ids = new Map(roads.map((r) => [r.id, uid()]));
    if (template) {
      remapRoadReferences(roads, new Map(roads.map((r) => [r.id, r.id])));
      this.edit(
        () =>
          this.project.templates.push({
            id: uid("t"),
            name: `路网模板 ${this.project.templates.length + 1}`,
            roads,
            connections: [],
            signals: cloneTrafficSignals(
              this.project.signals,
              new Map(roads.map((r) => [r.id, r.id])),
            ),
          }),
        "模板已保存",
      );
      return;
    }
    this.edit(() => {
      const signals = cloneTrafficSignals(this.project.signals, ids);
      remapRoadReferences(roads, ids);
      transformRoads(roads, (p) => add(p, v(15, 30)));
      this.project.roads.push(...roads);
      if (signals.length) {
        this.project.signals ??= [];
        this.project.signals.push(...signals);
      }
      this.selected = new Set(roads.map((r) => r.id));
    }, "道路已复制");
  }
  action(name: string) {
    if (name === "undo" || name === "redo") {
      this.cancel();
      const p =
        name === "undo"
          ? this.history.undo(this.project)
          : this.history.redo(this.project);
      if (p) {
        this.project = p;
        this.selected = new Set(
          [...this.selected].filter((id) => p.roads.some((r) => r.id === id)),
        );
        this.stopForEdit();
        this.refresh();
      }
      return;
    }
    if (name === "save") {
      this.save(true);
      return;
    }
    if (name === "import") {
      document.querySelector<HTMLInputElement>("#import-file")!.click();
      return;
    }
    if (name === "export") {
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(this.project, null, 2)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "interchange-lab.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (name === "play") {
      if (!this.simulation.running && !this.simulation.routeCount) {
        this.onToast("先设置路网通行口，或使用自动识别。");
        return;
      }
      this.simulation.running = !this.simulation.running;
      this.refresh();
      return;
    }
    if (name === "reset-sim") {
      const running = this.simulation.running;
      this.simulation.configure(this.project);
      this.simulation.running = running;
      this.scene.updateCars([]);
      return;
    }
    if (name === "top") {
      this.scene.top();
      return;
    }
    if (name === "perspective") {
      this.scene.perspective();
      return;
    }
    if (name === "fit") {
      this.scene.fit(this.chosen.length ? this.chosen : this.project.roads);
      return;
    }
    if (name === "focus-transition") {
      const r = this.project.roads.find((r) => r.lanesStart !== r.lanesEnd);
      if (r) {
        this.select(r.id);
        this.scene.fit([r]);
      }
      return;
    }
    if (name === "height-up") {
      this.changeHeight(8);
      return;
    }
    if (name === "height-down") {
      this.changeHeight(-8);
      return;
    }
    if (name === "delete") {
      this.edit(() => removeRoads(this.project, this.selected), "道路已拆除");
      this.selected.clear();
      this.refresh();
      return;
    }
    if (name === "auto-ports") {
      let count = 0;
      this.edit(() => (count = autoBoundaries(this.project)));
      this.onToast(
        count ? `已识别 ${count} 处路网通行口` : "现有端点均已连接或已有通行口",
      );
      return;
    }
    if (name === "duplicate" || name === "template") {
      this.duplicate(name === "template");
      return;
    }
    if (name === "reverse") {
      this.edit(() => {
        for (const road of this.project.roads)
          for (const end of ["start", "end"] as const)
            if (
              road.attachments?.[end] &&
              this.selected.has(road.attachments[end]!.road)
            )
              delete road.attachments[end];
        for (const r of this.chosen) {
          for (const signal of this.project.signals ?? [])
            for (const arm of signal.arms)
              if (arm.road === r.id) arm.end = arm.end === 0 ? 1 : 0;
          reverseRoad(r);
          this.project.ports
            .filter((p) => p.road === r.id)
            .forEach((p) => (p.end = p.end === "start" ? "end" : "start"));
        }
      }, "道路方向已反转");
      return;
    }
    if (name === "rotate" || name === "mirror") {
      this.edit(() => {
        if (name === "mirror") {
          mirrorRoads(this.project, this.selected);
          return;
        }
        const pts = this.chosen.flatMap((r) => r.knots.map((k) => k.p));
        if (!pts.length) return;
        const x = pts.reduce((n, p) => n + p.x, 0) / pts.length,
          z = pts.reduce((n, p) => n + p.z, 0) / pts.length;
        transformRoads(this.chosen, (p) =>
          v(x - (p.z - z), z + (p.x - x), p.y),
        );
      });
      return;
    }
    if (name === "add-knot" && this.active)
      this.edit(() => insertKnot(this.active!, 0.5));
  }
  load(p: Project) {
    this.cancel();
    this.edit(() => {
      this.project = p;
      this.selected.clear();
    }, "地图已载入，路口已自动连接");
    this.scene.fit(this.project.roads);
  }
  loadTemplate(id: string) {
    const t = this.project.templates.find((t) => t.id === id);
    if (!t) return;
    this.edit(() => {
      const roads = copy(t.roads),
        points = roads.flatMap((r) => r.knots.map((k) => k.p)),
        cx = points.reduce((s, p) => s + p.x, 0) / points.length,
        cz = points.reduce((s, p) => s + p.z, 0) / points.length,
        target = this.scene.controls.target;
      const ids = new Map(roads.map((r) => [r.id, uid()])),
        signals = cloneTrafficSignals(t.signals, ids);
      remapRoadReferences(roads, ids);
      transformRoads(roads, (p) =>
        v(p.x - cx + target.x, p.z - cz + target.z, p.y),
      );
      this.project.roads.push(...roads);
      if (signals.length) {
        this.project.signals ??= [];
        this.project.signals.push(...signals);
      }
      this.selected = new Set(roads.map((r) => r.id));
    }, "模板已放置，可以拖动整体调整");
    this.setTool("select");
  }
  exportDebug() {
    return {
      project: this.project,
      selected: [...this.selected],
      tool: this.tool,
      asset: this.assetId,
      snap: this.snapInfo,
      issues: validate(this.project),
      connections: connections(this.project),
      routes: this.simulation.routeCount,
      junctions: this.simulation.junctions,
    };
  }
}
