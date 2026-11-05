import { getAsset } from "../core/assets";
import {
  add,
  center,
  dist,
  laneCount,
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
  removeBoundary,
  removeRoads,
  reverseRoad,
  setBoundary,
  splitRoad,
  transformRoads,
  validate,
} from "../core/model";
import { endpointAnchors, type Alignment } from "../core/snapping";
import {
  copy,
  isSource,
  uid,
  type Project,
  type Road,
  type Settings,
  type Tool,
  type V,
} from "../core/types";
import { Scene, type Hit } from "../render/scene";
import { Simulation } from "../simulation/simulation";
export type SnapInfo = {
  kind: "endpoint" | "offset" | "road" | "angle" | "grid";
  position: V;
  text: string;
  road?: string;
  t?: number;
  contact?: V;
  reference?: V;
  alignment?: Alignment;
  offset?: number;
};
export class Editor {
  project: Project;
  selected = new Set<string>();
  history = new History();
  scene: Scene;
  simulation = new Simulation();
  tool: Tool = "select";
  assetId = "city-2";
  alignment: Alignment = "auto";
  settings: Settings = {
    grid: true,
    snap: true,
    arrows: true,
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
      select: "点击道路查看 · 中键平移 · Alt＋中键旋转 · 滚轮缩放",
      line: "点击起点，再点击终点 · 右键取消 · PageUp / PageDown 调整高度",
      curve: "依次点击起点、弯曲位置、终点 · 右键返回",
      boundary: "点击端点设置通行口 · 双向道路同时进出 · 右键取消通行口",
      delete: "拆除模式 · 悬停道路预览 · 左键拆除 · B / Esc 退出",
      upgrade: "先选择道路资产，再点击已有道路替换",
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
    el.style.top = `${Math.max(68, Math.min(rect.height - 230, p.y - rect.top - 30))}px`;
    el.hidden = false;
  }
  snapped(p: V, exclude?: string, disabled = false): V {
    const previous = this.snapInfo;
    this.snapInfo = undefined;
    if (!this.settings.snap || disabled) return p;
    const screen = this.scene.project(p);
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
  private draft(q: V) {
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
    return r;
  }
  private draftBundle(r: Road) {
    const asset = getAsset(this.assetId);
    if (!asset.action) return [r];
    const p = emptyProject();
    p.roads = [r];
    makeBranch(p, r.id, asset.action === "merge", { length: 65, offset: 32 });
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
    } else road = this.draft(q);
    this.scene.showPreviews(this.draftBundle(road), roadLength(road) < 3);
    this.scene.showBuildMarker(
      this.snapInfo?.contact || q,
      this.snapInfo?.kind === "endpoint" ||
        this.snapInfo?.kind === "road" ||
        this.snapInfo?.kind === "offset",
      this.snapInfo?.reference,
    );
    this.scene.setHover(this.snapInfo?.road, "snap");
    this.updateSnapFeedback();
    this.onStatus(
      `${this.snapInfo?.text || this.instructions()} · ${roadLength(road).toFixed(0)} m · 最大坡度 ${maxGrade(road).toFixed(1)}%`,
    );
  }
  private finishDraw() {
    const end = this.drawPoints.at(-1)!,
      r = this.draft(end);
    r.name = getAsset(this.assetId).name;
    if (roadLength(r) < 4) {
      this.onToast("道路过短，请将终点移远一点。");
      this.drawPoints.pop();
      return;
    }
    this.edit(() => {
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
      this.project.roads.push(r);
      const action = getAsset(this.assetId).action;
      if (action)
        makeBranch(this.project, r.id, action === "merge", {
          length: 65,
          offset: 32,
        });
      reconnectIntersections(this.project);
      autoJunction(this.project);
      this.selected.clear();
    }, "道路已建造");
    const keep =
      this.continuous &&
      r.lanesStart === r.lanesEnd &&
      !getAsset(this.assetId).action;
    this.drawPoints = keep ? [copy(center(r, 1))] : [];
    this.drawStartSnap = undefined;
    this.scene.showPreviews([]);
    this.scene.showBuildMarker();
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

  bind() {
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 2) {
        const port = this.boundaryHit(e.clientX, e.clientY);
        if (
          (this.tool === "boundary" || this.tool === "select") &&
          port &&
          this.project.ports.some(
            (p) => p.road === port.road && p.end === port.end,
          )
        ) {
          this.edit(
            () => removeBoundary(this.project, port.road, port.end),
            "已取消此处通行口",
          );
          return;
        }
        if (this.building && this.drawPoints.length) {
          this.drawPoints = [];
          this.drawStartSnap = undefined;
          this.scene.showPreviews([]);
          this.onStatus("已取消当前道路，继续选择起点。");
          return;
        }
        this.setTool("select");
        return;
      }
      if (e.button !== 0) return;
      const hit = this.scene.hit(e.clientX, e.clientY),
        raw = this.scene.groundPoint(
          e.clientX,
          e.clientY,
          this.drawPoints.length ? this.draw.endHeight : this.draw.height,
        );
      if (!raw) return;
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
      if (hit?.road) {
        if (!this.selected.has(hit.road) || e.shiftKey)
          this.select(hit.road, e.shiftKey);
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
      } else if (e.shiftKey)
        this.drag = {
          snapshot: copy(this.project),
          start: raw,
          x: e.clientX,
          y: e.clientY,
          height: 0,
          moved: false,
          box: true,
        };
      else {
        this.selected.clear();
        this.refresh();
        return;
      }
      this.scene.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
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
        this.tool === "delete" ? "crosshair" : hit?.handle ? "grab" : "default";
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
      if (!this.drag) return;
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
      this.cancel();
      this.refresh();
    });
    canvas.addEventListener("pointerleave", () => {
      if (this.drag) return;
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
      if (e.key === "Tab" && this.building && target === this.scene.el) {
        e.preventDefault();
        this.cycleAlignment();
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
      if (key === "f")
        this.scene.fit(this.chosen.length ? this.chosen : this.project.roads);
      if (key === "h") this.scene.top();
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        this.changeHeight(e.key === "PageUp" ? 8 : -8);
      }
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
      this.edit(
        () =>
          this.project.templates.push({
            id: uid("t"),
            name: `路网模板 ${this.project.templates.length + 1}`,
            roads,
            connections: [],
          }),
        "模板已保存",
      );
      return;
    }
    this.edit(() => {
      roads.forEach((r) => (r.id = ids.get(r.id)!));
      transformRoads(roads, (p) => add(p, v(15, 30)));
      this.project.roads.push(...roads);
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
        for (const r of this.chosen) {
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
      roads.forEach((r) => (r.id = uid()));
      transformRoads(roads, (p) =>
        v(p.x - cx + target.x, p.z - cz + target.z, p.y),
      );
      this.project.roads.push(...roads);
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
