import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildJunctions, roadRange, type Junction } from "../core/junctions";
import {
  add,
  boundaryPoint,
  backwardLaneCount,
  center,
  dist,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  lerp,
  mul,
  nearest,
  normal,
  nodePoint,
  point,
  roadLength,
  smooth,
  tangent,
  pavementWidth,
  medianWidth,
  medianExtent,
} from "../core/math";
import { connections } from "../core/model";
import { allowedTurns } from "../core/lane-rules";
import { renderRoadMedian } from "./road-median";
import { roadMedianRange } from "../core/road-median";
import {
  separatorPaths,
  transitionMarkings,
  type TransitionMarkings,
} from "../core/transition-markings";
import { previewRoadMarkings } from "./road-markings";
import { roadCrosswalkQuads } from "../core/junction-crosswalks";
import {
  roadForks,
  forkPavement,
  forkEdgePaths,
  forkSurfaces,
  type ForkNeighbours,
} from "../core/road-forks";
import { roadSegmentNodes } from "../core/road-segments";
import type { Project, Road, Settings, V } from "../core/types";
import type { Step, Vehicle } from "../simulation/simulation";
import { TrafficLightRenderer } from "./traffic-lights";
const vec = (p: V) => new T.Vector3(p.x, p.y, p.z);
export type Hit = {
  road?: string;
  knot?: number;
  part?: "p" | "incoming" | "outgoing";
  lane?: number;
  handle?: boolean;
  position?: V;
  end?: "start" | "end";
  port?: boolean;
};
export class Scene {
  trafficLights = new TrafficLightRenderer();
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  roads = new T.Group();
  overlays = new T.Group();
  details = new T.Group();
  handles = new T.Group();
  preview = new T.Group();
  cars = new T.Group();
  ground = new T.Group();
  routePreview = new T.Group();
  private ray = new T.Raycaster();
  private mouse = new T.Vector2();
  private junctionList: Junction[] = [];
  private ranges = new Map<string, { start: number; end: number }>();
  private currentProject?: Project;
  private forks = new Map<string, ForkNeighbours>();
  private previewHiddenRoads = new Set<string>();
  private previewHiddenJunctions = new Set<T.Object3D>();
  private rebuildSignature = "";
  private topologySignature = "";
  private signalRenderSignature = "";
  private roadNodesSignature = "";
  private markingSignature = "";
  private transitionPaint = new Map<string, TransitionMarkings>();
  private previewMarkingSignature = "";
  private previewTransitionPaint = new Map<string, TransitionMarkings>();
  private junctionRenderCache = new Map<
    string,
    { signature: string; objects: T.Object3D[] }
  >();
  private roadRenderCache = new Map<
    string,
    { signature: string; groups: [T.Group, T.Group, T.Group, T.Group] }
  >();
  private hoverId?: string;
  private hoverMode?: string;
  private cameraKeys = new Set<string>();
  private edgeScroll = new T.Vector2();
  private lastCameraFrame = performance.now();
  junctionMesh = new T.Group();
  hover = new T.Group();
  buildMarker = new T.Group();
  laneTarget = new T.Group();
  roadNodes = new T.Group();
  portGroup = new T.Group();
  private bodyInstances!: T.InstancedMesh;
  private cabinInstances!: T.InstancedMesh;
  private wheelInstances!: T.InstancedMesh;
  private mats = {
    asphalt: new T.MeshStandardMaterial({
      color: 0x354445,
      roughness: 0.95,
      side: T.DoubleSide,
    }),
    side: new T.MeshStandardMaterial({
      color: 0x82918d,
      roughness: 1,
      side: T.DoubleSide,
    }),
    mark: new T.LineBasicMaterial({ color: 0xf0eed8 }),
    dashedMark: new T.LineDashedMaterial({
      color: 0xf0eed8,
      dashSize: 3,
      gapSize: 6,
    }),
    centerline: new T.LineBasicMaterial({ color: 0xf3c454 }),
    lane: new T.LineBasicMaterial({
      color: 0x33a7ac,
      transparent: true,
      opacity: 0.8,
    }),
    selected: new T.LineBasicMaterial({ color: 0xea7b35 }),
    ghost: new T.MeshStandardMaterial({
      color: 0x63baf1,
      transparent: true,
      opacity: 0.45,
      side: T.DoubleSide,
    }),
    ghostMedian: new T.MeshStandardMaterial({
      color: 0x63baf1,
      transparent: true,
      opacity: 0.8,
      side: T.DoubleSide,
    }),
    invalid: new T.MeshStandardMaterial({
      color: 0xbb4d32,
      transparent: true,
      opacity: 0.65,
      side: T.DoubleSide,
    }),
  };
  private demolition = new T.MeshBasicMaterial({
    color: 0xf15b48,
    transparent: true,
    opacity: 0.72,
    side: T.DoubleSide,
  });
  private hoverBlue = new T.MeshBasicMaterial({
    color: 0x69caff,
    transparent: true,
    opacity: 0.35,
    side: T.DoubleSide,
  });
  constructor(public el: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x8ca77c);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.el.append(this.renderer.domElement);
    this.camera = new T.PerspectiveCamera(42, 1, 0.2, 3000);
    this.camera.position.set(135, 210, 240);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 10);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1000;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = {
      LEFT: T.MOUSE.ROTATE,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.PAN,
    };
    this.scene.add(new T.HemisphereLight(0xffffff, 0x6b825c, 1.8));
    const sun = new T.DirectionalLight(0xfff3da, 1.5);
    sun.position.set(-80, 180, 60);
    this.scene.add(sun);
    const plane = new T.Mesh(
      new T.PlaneGeometry(2000, 2000),
      new T.MeshStandardMaterial({ color: 0x92aa7e, roughness: 1 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.16;
    this.ground.add(plane);
    const grid = new T.GridHelper(1000, 100, 0xb8c5b0, 0xcdd7c4);
    grid.position.y = -0.12;
    (grid.material as T.Material).transparent = true;
    (grid.material as T.Material).opacity = 0.3;
    this.ground.add(grid);
    this.scene.add(
      this.ground,
      this.roads,
      this.overlays,
      this.details,
      this.handles,
      this.preview,
      this.cars,
      this.routePreview,
    );
    this.scene.add(
      this.junctionMesh,
      this.trafficLights.group,
      this.laneTarget,
      this.roadNodes,
      this.hover,
      this.buildMarker,
      this.portGroup,
    );
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      if (e.buttons) {
        this.edgeScroll.set(0, 0);
        return;
      }
      const rect = this.renderer.domElement.getBoundingClientRect();
      const edge = 20;
      this.edgeScroll.set(
        e.clientX < rect.left + edge
          ? -1
          : e.clientX > rect.right - edge
            ? 1
            : 0,
        e.clientY < rect.top + edge
          ? 1
          : e.clientY > rect.bottom - edge
            ? -1
            : 0,
      );
    });
    this.renderer.domElement.addEventListener("pointerleave", () =>
      this.edgeScroll.set(0, 0),
    );
    this.initializeCars();
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.renderer.domElement.addEventListener("pointerdown", () =>
      this.el.focus({ preventScroll: true }),
    );
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }
  resize() {
    const w = this.el.clientWidth,
      h = this.el.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private syncViewport(rect: { width: number; height: number }) {
    // Pointer/API events can arrive before ResizeObserver after a fast resize.
    // Keep projection and canvas dimensions consistent with the current view.
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      Math.abs(this.camera.aspect - rect.width / rect.height) > 1e-6
    )
      this.resize();
  }
  setCameraKey(code: string, pressed: boolean) {
    if (pressed) this.cameraKeys.add(code);
    else this.cameraKeys.delete(code);
  }
  clearCameraKeys() {
    this.cameraKeys.clear();
    this.edgeScroll.set(0, 0);
  }
  private updateCamera() {
    const now = performance.now();
    const dt = Math.min((now - this.lastCameraFrame) / 1000, 0.05);
    this.lastCameraFrame = now;
    if (
      !this.controls.enabled ||
      document.hidden ||
      document.querySelector("dialog[open]")
    )
      return;
    const held = (code: string) => Number(this.cameraKeys.has(code));
    const right =
      held("KeyD") -
      held("KeyA") +
      held("ArrowRight") -
      held("ArrowLeft") +
      this.edgeScroll.x;
    const forward =
      held("KeyW") -
      held("KeyS") +
      held("ArrowUp") -
      held("ArrowDown") +
      this.edgeScroll.y;
    if (right || forward) {
      const direction = this.controls.target.clone().sub(this.camera.position);
      direction.y = 0;
      direction.normalize();
      const side = new T.Vector3().crossVectors(direction, this.camera.up);
      const movement = direction
        .multiplyScalar(forward)
        .addScaledVector(side, right)
        .normalize();
      const speed =
        Math.max(
          18,
          this.camera.position.distanceTo(this.controls.target) * 0.9,
        ) *
        dt *
        (this.cameraKeys.has("ShiftLeft") || this.cameraKeys.has("ShiftRight")
          ? 2.5
          : 1);
      this.camera.position.addScaledVector(movement, speed);
      this.controls.target.addScaledVector(movement, speed);
    }
    const yaw = held("KeyQ") - held("KeyE");
    if (yaw) this.controls.rotateLeft(yaw * 1.3 * dt);
    const pitch = held("KeyT") - held("KeyG");
    if (pitch) this.controls.rotateUp(pitch * 0.8 * dt);
    const zoom = held("KeyR") - held("KeyF");
    if (zoom) {
      const scale = Math.exp(1.4 * dt);
      if (zoom > 0) this.controls.dollyIn(scale);
      else this.controls.dollyOut(scale);
    }
  }
  clear(group: T.Group) {
    for (const obj of [...group.children]) {
      group.remove(obj);
      obj.traverse((child) => {
        if (child instanceof T.Mesh || child instanceof T.Line) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const m of mats)
            if (
              ![
                ...Object.values(this.mats),
                this.demolition,
                this.hoverBlue,
              ].includes(m as never)
            )
              m.dispose();
        }
      });
    }
  }
  line(points: V[], material: T.LineBasicMaterial, group: T.Group, hit?: Hit) {
    const g = new T.BufferGeometry().setFromPoints(
      points.map((p) => vec({ ...p, y: p.y + 0.065 })),
    );
    const l = new T.Line(g, material);
    if (material instanceof T.LineDashedMaterial) l.computeLineDistances();
    if (hit) l.userData = hit;
    group.add(l);
    return l;
  }
  roadMesh(
    r: Road,
    group: T.Group,
    material: T.Material = this.mats.asphalt,
    range = { start: 0, end: 1 },
    medianJunctions: readonly Junction[] = this.junctionList,
    medianProject: Pick<Project, "roads"> = this.currentProject ?? {
      roads: [r],
    },
  ) {
    const n = Math.max(60, r.knots.length * 35),
      positions: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = range.start + ((range.end - range.start) * i) / n,
        c = center(r, t),
        norm = normal(r, t),
        half = pavementWidth(r, t) / 2 + 0.35;
      for (const sign of [-1, 1]) {
        const q = add(c, mul(norm, half * sign));
        positions.push(q.x, q.y, q.z);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = i * 2;
      indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
    }
    const g = new T.BufferGeometry();
    const blockers = this.forks.get(r.id)?.pavement ?? [];
    if (material === this.mats.asphalt && blockers.length) {
      g.setAttribute(
        "position",
        new T.Float32BufferAttribute(
          forkPavement(r, range, forkSurfaces(blockers)),
          3,
        ),
      );
    } else {
      g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
    }
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, material);
    mesh.userData = { road: r.id };
    group.add(mesh);
    if (medianExtent(r))
      renderRoadMedian(
        medianProject,
        r,
        medianJunctions,
        group,
        material === this.mats.asphalt
          ? this.mats.side
          : material === this.mats.ghost
            ? this.mats.ghostMedian
            : material,
      );
    if (material !== this.mats.asphalt) return;
    // A thin deck gives elevated roads a readable edge; columns are visual only.
    const edgeBlockers = forkSurfaces(this.forks.get(r.id)?.edges ?? []);
    for (const sign of [-1, 1]) {
      const edge: V[] = [];
      for (let i = 0; i <= n; i++) {
        const t = range.start + ((range.end - range.start) * i) / n;
        edge.push(
          add(
            center(r, t),
            mul(normal(r, t), (pavementWidth(r, t) / 2 + 0.35) * sign),
          ),
        );
      }
      const side: number[] = [];
      for (const path of forkEdgePaths(edge, edgeBlockers))
        for (let i = 0; i < path.length - 1; i++) {
          const a = path[i],
            b = path[i + 1];
          for (const [p, drop] of [
            [a, 0.02],
            [b, 0.02],
            [a, 0.45],
            [a, 0.45],
            [b, 0.02],
            [b, 0.45],
          ] as const)
            side.push(p.x, p.y - drop, p.z);
        }
      const sg = new T.BufferGeometry();
      sg.setAttribute("position", new T.Float32BufferAttribute(side, 3));
      sg.computeVertexNormals();
      group.add(new T.Mesh(sg, this.mats.side));
    }
    for (let t = 0.12; t < 1; t += 0.18) {
      const p = center(r, range.start + (range.end - range.start) * t);
      if (p.y > 3 && this.pillarFits(r, p)) {
        const column = new T.Mesh(
          new T.CylinderGeometry(0.55, 0.65, p.y, 8),
          new T.MeshStandardMaterial({ color: 0x9ca89a }),
        );
        column.position.set(p.x, p.y / 2 - 0.25, p.z);
        group.add(column);
      }
    }
  }
  private pillarFits(road: Road, p: V) {
    for (const other of this.currentProject?.roads || []) {
      if (other.id === road.id) continue;
      const near = nearest(other, p);
      if (near.point.y > p.y - 0.5) continue;
      const clearance = pavementWidth(other, near.t) / 2 + 1.5;
      if (near.distance < clearance) return false;
    }
    return true;
  }
  private syncRoadEditing(
    r: Road,
    overlays: T.Group,
    handles: T.Group,
    selected: boolean,
    showHandles: boolean,
  ) {
    for (const object of overlays.children) {
      if (
        object instanceof T.Line &&
        (object.material === this.mats.mark ||
          object.material === this.mats.selected)
      )
        object.material = selected ? this.mats.selected : this.mats.mark;
    }
    handles.visible = selected;
    if (!selected) {
      if (handles.children.length) this.clear(handles);
      return;
    }
    if (!showHandles || handles.children.length) return;
    for (let i = 0; i < r.knots.length; i++) {
      const k = r.knots[i];
      for (const part of ["p", "incoming", "outgoing"] as const) {
        if (
          (part === "incoming" && i === 0) ||
          (part === "outgoing" && i === r.knots.length - 1)
        )
          continue;
        if (part !== "p")
          this.line(
            [k.p, k[part]],
            new T.LineBasicMaterial({
              color: 0xc97537,
              transparent: true,
              opacity: 0.7,
            }),
            handles,
          );
        const m = new T.Mesh(
          new T.SphereGeometry(part === "p" ? 1.4 : 1, 12, 8),
          new T.MeshBasicMaterial({
            color: part === "p" ? 0xf08740 : 0xfff5dd,
            depthTest: false,
          }),
        );
        m.position.copy(vec(k[part]));
        m.position.y += 0.3;
        m.renderOrder = 20;
        m.userData = {
          road: r.id,
          knot: i,
          part,
          handle: true,
          radius: part === "p" ? 1.4 : 1,
        };
        handles.add(m);
      }
    }
  }
  rebuild(
    p: Project,
    selected: Set<string>,
    settings: Settings,
    showHandles = true,
  ) {
    this.currentProject = p;
    const topologySignature = JSON.stringify(p.roads);
    const signature = JSON.stringify([
      topologySignature,
      p.ports,
      p.signals,
      [...selected],
      settings,
      showHandles,
      p.junctionLaneConnections,
    ]);
    if (signature === this.rebuildSignature) return;
    this.rebuildSignature = signature;
    if (topologySignature !== this.topologySignature) {
      this.junctionList = buildJunctions(p);
      this.forks = roadForks(p.roads);
      this.topologySignature = topologySignature;
    }
    const markingSignature = JSON.stringify([
      topologySignature,
      p.junctionLaneConnections,
    ]);
    if (markingSignature !== this.markingSignature) {
      this.transitionPaint = p.roads.some(
        (r) => r.transitionMode === "smooth" || r.autoTaper,
      )
        ? transitionMarkings(p, connections(p), this.junctionList)
        : new Map();
      this.markingSignature = markingSignature;
    }
    const signalSignature = JSON.stringify([topologySignature, p.signals]);
    if (signalSignature !== this.signalRenderSignature) {
      this.trafficLights.rebuild(p, this.junctionList);
      this.signalRenderSignature = signalSignature;
    }
    this.handles.visible = showHandles;
    this.ranges = new Map(
      p.roads.map((r) => [r.id, roadRange(r, this.junctionList)]),
    );
    this.junctionMesh.clear();
    const junctionIds = new Set(this.junctionList.map((j) => j.id));
    for (const [id, cached] of this.junctionRenderCache)
      if (!junctionIds.has(id)) {
        const group = new T.Group();
        group.add(...cached.objects);
        this.clear(group);
        this.junctionRenderCache.delete(id);
      }
    this.clear(this.portGroup);
    this.clear(this.hover);
    this.hoverId = undefined;
    // Detach cached road groups; dispose only removed/changed geometry.
    for (const group of [
      this.roads,
      this.overlays,
      this.details,
      this.handles,
    ]) {
      for (const child of group.children)
        if (child instanceof T.Line) child.geometry.dispose();
      group.clear();
    }
    const ids = new Set(p.roads.map((r) => r.id));
    for (const [id, entry] of this.roadRenderCache)
      if (!ids.has(id)) {
        entry.groups.forEach((g) => this.clear(g));
        this.roadRenderCache.delete(id);
      }
    this.clear(this.routePreview);
    this.roadNodes.visible = showHandles;
    if (showHandles && this.roadNodesSignature !== topologySignature) {
      this.clear(this.roadNodes);
      this.roadNodesSignature = topologySignature;
      const nodes: V[] = [];
      for (const road of p.roads)
        for (const end of [0, 1]) {
          const pos = center(road, end);
          if (nodes.some((node) => dist(node, pos) < 0.7)) continue;
          nodes.push(pos);
          const node = new T.Mesh(
            new T.CircleGeometry(0.7, 16),
            new T.MeshBasicMaterial({
              color: 0xc3d2ca,
              transparent: true,
              opacity: 0.9,
              depthTest: false,
            }),
          );
          node.rotation.x = -Math.PI / 2;
          node.position.set(pos.x, pos.y + 0.15, pos.z);
          node.renderOrder = 25;
          this.roadNodes.add(node);
        }
    }
    this.ground.children[1].visible = settings.grid;
    for (const r of p.roads) {
      const height = (point(r, 0).y + point(r, 1).y) / 2;
      const hidden =
        settings.layer !== -1 && Math.abs(height - settings.layer * 8) > 5;
      if (hidden && !settings.ghost) continue;
      const range = this.ranges.get(r.id)!;
      const roadSignature = JSON.stringify([
        r,
        range,
        this.forks.get(r.id),
        medianExtent(r) ? roadMedianRange(p, r, this.junctionList) : undefined,
        hidden,
        settings.paths,
        settings.arrows,
        this.transitionPaint.get(r.id),
      ]);
      const cached = this.roadRenderCache.get(r.id);
      if (cached?.signature === roadSignature) {
        const [road, overlays, details, handles] = cached.groups;
        this.syncRoadEditing(
          r,
          overlays,
          handles,
          selected.has(r.id),
          showHandles,
        );
        this.roads.add(road);
        this.overlays.add(overlays);
        this.details.add(details);
        this.handles.add(handles);
        continue;
      }
      if (cached) cached.groups.forEach((g) => this.clear(g));
      const group = new T.Group(),
        overlays = new T.Group(),
        details = new T.Group(),
        handles = new T.Group();
      this.roadRenderCache.set(r.id, {
        signature: roadSignature,
        groups: [group, overlays, details, handles],
      });
      this.overlays.add(overlays);
      this.details.add(details);
      this.handles.add(handles);
      this.roadMesh(
        r,
        group,
        hidden ? this.mats.ghost : this.mats.asphalt,
        range,
      );
      if (hidden) {
        group.traverse((obj) => (obj.userData.noPick = true));
        this.roads.add(group);
        continue;
      }
      this.roads.add(group);
      for (const side of [-1, 1]) {
        const pts: V[] = [];
        for (let i = 0; i <= 100; i++) {
          const t = range.start + ((range.end - range.start) * i) / 100;
          pts.push(
            add(
              center(r, t),
              mul(normal(r, t), (pavementWidth(r, t) / 2 - 0.12) * side),
            ),
          );
        }
        for (const path of forkEdgePaths(
          pts,
          forkSurfaces(this.forks.get(r.id)?.edges ?? []),
        ))
          this.line(path, this.mats.mark, overlays);
      }
      const max = laneCount(r);
      for (let l = 1; l < max; l++) {
        if (r.twoWay && l === backwardLaneCount(r)) {
          const pts: V[] = [];
          for (let i = 0; i <= 100; i++) {
            const t = range.start + ((range.end - range.start) * i) / 100;
            pts.push(boundaryPoint(r, l, t));
          }
          if (medianExtent(r))
            for (const side of [-1, 1]) {
              const edge = pts.map((p, i) =>
                add(
                  p,
                  mul(
                    normal(
                      r,
                      range.start + ((range.end - range.start) * i) / 100,
                    ),
                    side *
                      (medianWidth(
                        r,
                        range.start + ((range.end - range.start) * i) / 100,
                      ) /
                        2 +
                        0.12 *
                          Math.min(
                            1,
                            medianWidth(
                              r,
                              range.start +
                                ((range.end - range.start) * i) / 100,
                            ),
                          )),
                  ),
                ),
              );
              this.line(edge, this.mats.centerline, details);
            }
          else this.line(pts, this.mats.centerline, details);
          continue;
        }
        for (const path of separatorPaths(
          r,
          l,
          range,
          this.transitionPaint.get(r.id),
        )) {
          const line = this.line(path, this.mats.dashedMark, details);
          line.userData = { road: r.id, markingBoundary: l };
        }
      }
      for (let l = 0; l < max; l++) {
        if (settings.paths) {
          const pts: V[] = [];
          for (let i = 0; i <= 100; i++)
            if (
              laneWidth(
                r,
                l,
                range.start + ((range.end - range.start) * i) / 100,
              ) >
              r.width * 0.75
            )
              pts.push(
                lanePoint(
                  r,
                  l,
                  range.start + ((range.end - range.start) * i) / 100,
                ),
              );
          if (pts.length > 1) this.line(pts, this.mats.lane, overlays);
        }
        if (settings.arrows)
          for (const t of [0.22, 0.55, 0.83]) {
            if (t < range.start + 0.01 || t > range.end - 0.01) continue;
            if (laneWidth(r, l, t) < r.width * 0.8) continue;
            if (
              r.turns?.[l] &&
              Math.abs(t - (laneDirection(r, l) === 1 ? 0.83 : 0.22)) < 0.01
            ) {
              const c = lanePoint(r, l, t),
                d = mul(tangent(r, t), laneDirection(r, l)),
                n = { x: -d.z, y: 0, z: d.x };
              const turns = allowedTurns(r, l);
              if (!turns.length) {
                this.line(
                  [add(c, mul(n, -1)), add(c, mul(n, 1))],
                  this.mats.centerline,
                  details,
                );
              }
              for (const turn of turns) {
                const side = turn === "left" ? -1 : turn === "right" ? 1 : 0;
                const tip = side
                  ? add(c, mul(n, side * 1.15))
                  : add(c, mul(d, 1.8));
                const direction = side ? mul(n, side) : d,
                  cross = { x: -direction.z, y: 0, z: direction.x };
                this.line(
                  [
                    add(c, mul(d, -1.8)),
                    c,
                    tip,
                    add(add(tip, mul(direction, -0.75)), mul(cross, 0.5)),
                    tip,
                    add(add(tip, mul(direction, -0.75)), mul(cross, -0.5)),
                  ],
                  this.mats.mark,
                  details,
                );
              }
              continue;
            }
            const p = lanePoint(r, l, t),
              d = mul(tangent(r, t), laneDirection(r, l)),
              n = normal(r, t),
              tip = add(p, mul(d, 1.7));
            this.line(
              [
                add(p, mul(d, -1.7)),
                tip,
                add(add(p, mul(d, 0.2)), mul(n, 0.75)),
                tip,
                add(add(p, mul(d, 0.2)), mul(n, -0.75)),
              ],
              this.mats.mark,
              details,
            );
          }
      }
      this.batchLines(overlays);
      this.batchLines(details);
      this.syncRoadEditing(
        r,
        overlays,
        handles,
        selected.has(r.id),
        showHandles,
      );
    }
    if (settings.paths) {
      const cs = connections(p).filter((x) => x.enabled);
      for (const c of cs) {
        const a = p.roads.find((r) => r.id === c.from.road),
          b = p.roads.find((r) => r.id === c.to.road);
        if (!a || !b) continue;
        const ap = lanePoint(
            a,
            c.from.lane,
            laneDirection(a, c.from.lane) === 1 ? 1 : 0,
          ),
          bp = lanePoint(
            b,
            c.to.lane,
            laneDirection(b, c.to.lane) === 1 ? 0 : 1,
          );
        if (dist(ap, bp) > 0.1)
          this.line([ap, bp], this.mats.lane, this.overlays);
      }
    }
    // Fork edge clipping follows the shared pavement. Do not draw synthetic
    // gore stripes across two independently sampled road cross-sections: they
    // can cross live lanes or continue into the unpaved gap.
    for (const j of this.junctionList) {
      const signature = JSON.stringify([
        j,
        j.arms.map((a) => p.roads.find((r) => r.id === a.road)),
      ]);
      const cached = this.junctionRenderCache.get(j.id);
      if (cached?.signature === signature) {
        this.junctionMesh.add(...cached.objects);
        continue;
      }
      if (cached) {
        const group = new T.Group();
        group.add(...cached.objects);
        this.clear(group);
      }
      const junctionGroup = new T.Group();
      const vertices = j.polygon.map((p) => new T.Vector2(p.x, p.z)),
        triangles = T.ShapeUtils.triangulateShape(vertices, []).flat(),
        positions = j.polygon.flatMap((p) => [p.x, j.position.y + 0.018, p.z]);
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(triangles);
      geometry.computeVertexNormals();
      const mesh = new T.Mesh(geometry, this.mats.asphalt);
      mesh.userData = { junction: j.id };
      junctionGroup.add(mesh);
      if (j.crosswalks)
        for (const arm of j.arms) {
          if (arm.crosswalkT === undefined) continue;
          const road = p.roads.find((r) => r.id === arm.road)!;
          for (const points of roadCrosswalkQuads(road, arm.crosswalkT)) {
            const geometry = new T.BufferGeometry();
            geometry.setAttribute(
              "position",
              new T.Float32BufferAttribute(
                points.flatMap((p) => [p.x, p.y + 0.055, p.z]),
                3,
              ),
            );
            geometry.setIndex([0, 1, 2, 0, 2, 3]);
            geometry.computeVertexNormals();
            const mesh = new T.Mesh(
              geometry,
              new T.MeshBasicMaterial({ color: 0xf5f5e9, side: T.DoubleSide }),
            );
            mesh.userData = {
              crosswalk: j.id,
              crosswalkRoad: arm.road,
              crosswalkEnd: arm.end,
            };
            junctionGroup.add(mesh);
          }
        }
      const objects = [...junctionGroup.children];
      this.junctionRenderCache.set(j.id, { signature, objects });
      this.junctionMesh.add(...objects);
    }
    for (const port of p.ports) {
      const r = p.roads.find((r) => r.id === port.road);
      if (!r) continue;
      const t = port.end === "start" ? 0 : 1,
        q = center(r, t),
        radius = pavementWidth(r, t) / 2 + 1.2,
        ring = new T.Mesh(
          new T.TorusGeometry(radius, 0.35, 6, 36),
          new T.MeshBasicMaterial({
            color:
              port.type === "both"
                ? 0x56c8ee
                : port.type === "source"
                  ? 0x7ee276
                  : 0xffb563,
            depthTest: false,
          }),
        );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(vec(q));
      ring.position.y += 0.2;
      ring.renderOrder = 30;
      ring.userData = { road: r.id, end: port.end, port: true };
      this.portGroup.add(ring);
      const direction = mul(tangent(r, t), port.end === "start" ? 1 : -1),
        n = normal(r, t);
      for (const sign of port.type === "both"
        ? [1, -1]
        : [port.type === "source" ? 1 : -1]) {
        const c = add(q, mul(n, sign * radius * 0.4)),
          d = mul(direction, sign),
          tip = add(c, mul(d, 2));
        const line = this.line(
          [
            add(c, mul(d, -2)),
            tip,
            add(add(c, mul(d, 0.4)), mul(n, 0.9)),
            tip,
            add(add(c, mul(d, 0.4)), mul(n, -0.9)),
          ],
          new T.LineBasicMaterial({
            color: sign === 1 ? 0x7ee276 : 0xffb563,
            depthTest: false,
          }),
          this.portGroup,
        );
        line.userData = { road: r.id, end: port.end, port: true };
        line.renderOrder = 31;
      }
    }
    this.batchLines(this.overlays);
    this.batchLines(this.details);
  }
  batchLines(group: T.Group) {
    const batches = new Map<T.Material, number[]>();
    for (const obj of [...group.children])
      if (
        obj instanceof T.Line &&
        !(obj instanceof T.LineSegments) &&
        !(obj.material instanceof T.LineDashedMaterial)
      ) {
        const material = obj.material as T.Material,
          positions = batches.get(material) || [],
          a = obj.geometry.getAttribute("position");
        for (let i = 0; i < a.count - 1; i++)
          for (const j of [i, i + 1])
            positions.push(a.getX(j), a.getY(j), a.getZ(j));
        batches.set(material, positions);
        group.remove(obj);
        obj.geometry.dispose();
      }
    for (const [mat, positions] of batches) {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      group.add(new T.LineSegments(g, mat));
    }
  }
  showPreviews(
    roads: Road[],
    invalid = false,
    options?: {
      replaceExisting?: boolean;
      junctions?: readonly Junction[];
      project?: Pick<Project, "roads">;
    },
  ) {
    for (const id of this.previewHiddenRoads)
      this.roadRenderCache
        .get(id)
        ?.groups.forEach((group) => (group.visible = true));
    this.previewHiddenRoads.clear();
    for (const object of this.previewHiddenJunctions) object.visible = true;
    this.previewHiddenJunctions.clear();
    if (options?.replaceExisting)
      for (const road of roads) {
        const cached = this.roadRenderCache.get(road.id);
        if (cached) {
          cached.groups.forEach((group) => (group.visible = false));
          this.previewHiddenRoads.add(road.id);
        }
      }
    this.clear(this.preview);
    if (!roads.length) {
      this.previewMarkingSignature = "";
      this.previewTransitionPaint.clear();
      return;
    }
    // Placement only touches nearby seam geometry. Do not route or rebuild the
    // entire map on pointer movement, even for a replacement with a full draft.
    const nextRoads = new Map(
      (options?.project?.roads ?? this.currentProject?.roads ?? []).map((r) => [
        r.id,
        r,
      ]),
    );
    roads.forEach((r) => nextRoads.set(r.id, r));
    const nearby = [...nextRoads.values()].filter((other) =>
      roads.some(
        (road) =>
          road.id === other.id ||
          ([0, 1] as const).some((end) =>
            ([0, 1] as const).some(
              (at) =>
                dist(nodePoint(road, end), nodePoint(other, at)) <
                (pavementWidth(road, end) + pavementWidth(other, at)) / 2 + 1,
            ),
          ),
      ),
    );
    const draft = { ...this.currentProject, roads: nearby } as Project;
    const markingSignature = JSON.stringify([
      nearby,
      draft.junctionLaneConnections,
    ]);
    if (this.previewMarkingSignature !== markingSignature) {
      this.previewTransitionPaint = nearby.some(
        (r) => r.transitionMode === "smooth" || r.autoTaper,
      )
        ? transitionMarkings(
            draft,
            connections(draft),
            options?.junctions ?? this.junctionList,
          )
        : new Map();
      this.previewMarkingSignature = markingSignature;
    }
    if (options?.replaceExisting) {
      const ids = new Set(roads.map((r) => r.id));
      for (const junction of this.junctionList)
        if (junction.arms.some((a) => ids.has(a.road))) {
          for (const object of this.junctionRenderCache.get(junction.id)
            ?.objects ?? []) {
            object.visible = false;
            this.previewHiddenJunctions.add(object);
          }
        }
      for (const junction of options.junctions ?? [])
        if (junction.arms.some((a) => ids.has(a.road))) {
          const g = new T.BufferGeometry();
          g.setAttribute(
            "position",
            new T.Float32BufferAttribute(
              junction.polygon.flatMap((p) => [
                p.x,
                junction.position.y + 0.018,
                p.z,
              ]),
              3,
            ),
          );
          g.setIndex(
            T.ShapeUtils.triangulateShape(
              junction.polygon.map((p) => new T.Vector2(p.x, p.z)),
              [],
            ).flat(),
          );
          g.computeVertexNormals();
          const mesh = new T.Mesh(
            g,
            invalid ? this.mats.invalid : this.mats.ghost,
          );
          mesh.userData.previewJunction = junction.id;
          this.preview.add(mesh);
        }
    }
    for (const r of roads) {
      for (const p of this.currentProject?.roads.some((old) => old.id === r.id)
        ? []
        : roadSegmentNodes(r)) {
        const node = new T.Mesh(
          new T.CircleGeometry(0.8, 16),
          new T.MeshBasicMaterial({
            color: invalid ? 0xff7765 : 0x9de2ff,
            depthTest: false,
          }),
        );
        node.rotation.x = -Math.PI / 2;
        node.position.set(p.x, p.y + 0.18, p.z);
        node.renderOrder = 30;
        node.userData.segmentNode = true;
        this.preview.add(node);
      }
      this.roadMesh(
        r,
        this.preview,
        invalid ? this.mats.invalid : this.mats.ghost,
        options?.replaceExisting
          ? roadRange(r, [...(options.junctions ?? [])])
          : { start: 0, end: 1 },
        options?.junctions,
        options?.project,
      );
      const boundary = new T.LineBasicMaterial({
        color: invalid ? 0xff7765 : 0x9de2ff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      });
      const direction = new T.LineBasicMaterial({
        color: invalid ? 0xff7765 : 0x9de2ff,
        transparent: true,
        opacity: 0.48,
        depthTest: false,
      });
      const range = options?.replaceExisting
        ? roadRange(r, [...(options.junctions ?? [])])
        : { start: 0, end: 1 };
      const geometry = previewRoadMarkings(
        r,
        range,
        this.previewTransitionPaint.get(r.id),
      );
      for (const [kind, paths] of [
        ["edge", geometry.edges],
        ["lane-boundary", geometry.lanes],
        ["median", geometry.median],
      ] as const)
        for (const path of paths) {
          const line = this.line(path, boundary, this.preview);
          line.userData = { previewMarking: kind, road: r.id };
          line.renderOrder = 31;
        }
      for (const arrow of geometry.arrows) {
        const line = this.line(arrow.path, direction, this.preview);
        line.userData = {
          previewMarking: "direction",
          road: r.id,
          lane: arrow.lane,
          at: arrow.t,
        };
        line.renderOrder = 32;
      }
    }
  }
  showPreview(r?: Road, invalid = false) {
    this.showPreviews(r ? [r] : [], invalid);
  }
  showLaneTarget(road?: Road, lanes: number[] = [], at = 1) {
    this.clear(this.laneTarget);
    if (!road || !lanes.length) return;
    const span = Math.min(0.3, 24 / Math.max(1, roadLength(road))),
      start = Math.max(0, at - span),
      end = Math.min(1, at + span);
    const material = new T.MeshBasicMaterial({
      color: 0xffcf70,
      transparent: true,
      opacity: 0.62,
      depthTest: false,
      side: T.DoubleSide,
    });
    const line = new T.LineBasicMaterial({ color: 0xffedbf, depthTest: false });
    for (const lane of lanes) {
      const positions: number[] = [],
        indices: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = start + ((end - start) * i) / 24,
          c = lanePoint(road, lane, t),
          n = normal(road, t);
        for (const side of [-1, 1]) {
          const p = add(c, mul(n, side * laneWidth(road, lane, t) * 0.42));
          positions.push(p.x, p.y + 0.12, p.z);
        }
        if (i < 24) {
          const j = i * 2;
          indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
        }
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(indices);
      const mesh = new T.Mesh(geometry, material);
      mesh.renderOrder = 42;
      this.laneTarget.add(mesh);
      const t = (start + end) / 2,
        c = lanePoint(road, lane, t),
        d = mul(tangent(road, t), laneDirection(road, lane)),
        n = normal(road, t);
      const arrow = this.line(
        [
          add(c, mul(d, -2.8)),
          add(c, mul(d, 2.8)),
          add(add(c, mul(d, 1)), mul(n, 0.9)),
          add(c, mul(d, 2.8)),
          add(add(c, mul(d, 1)), mul(n, -0.9)),
        ],
        line,
        this.laneTarget,
      );
      arrow.renderOrder = 43;
    }
  }
  showBuildMarker(p?: V, snapped = false, reference?: V) {
    this.clear(this.buildMarker);
    if (!p) return;
    const group = new T.Group(),
      ring = new T.Mesh(
        new T.TorusGeometry(1, 0.07, 6, 40),
        new T.MeshBasicMaterial({
          color: snapped ? 0xffcf70 : 0xa3e5ff,
          depthTest: false,
        }),
      );
    ring.rotation.x = -Math.PI / 2;
    const dot = new T.Mesh(
      new T.SphereGeometry(0.14, 10, 8),
      new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    group.add(ring, dot);
    group.position.set(p.x, p.y + 0.18, p.z);
    group.renderOrder = 40;
    group.userData.marker = true;
    this.buildMarker.add(group);
    if (reference && dist(reference, p) > 0.05) {
      const material = new T.LineBasicMaterial({
        color: 0xffcf70,
        depthTest: false,
      });
      const guide = this.line([reference, p], material, this.buildMarker);
      guide.renderOrder = 40;
      const dot = new T.Mesh(
        new T.SphereGeometry(0.25, 8, 6),
        new T.MeshBasicMaterial({ color: 0xffcf70, depthTest: false }),
      );
      dot.position.copy(vec(reference));
      dot.position.y += 0.16;
      dot.renderOrder = 40;
      this.buildMarker.add(dot);
    }
  }
  setHover(id?: string, mode = "select") {
    if (this.hoverId === id && this.hoverMode === mode) return;
    this.hoverId = id;
    this.hoverMode = mode;
    this.clear(this.hover);
    const r = this.currentProject?.roads.find((r) => r.id === id);
    if (!r) return;
    this.roadMesh(
      r,
      this.hover,
      mode === "delete" ? this.demolition : this.hoverBlue,
      this.ranges.get(r.id),
    );
    this.hover.position.y = 0.035;
  }
  portHit(
    x: number,
    y: number,
  ): { road: string; end: "start" | "end" } | undefined {
    this.setRay(x, y);
    const hit = this.ray
      .intersectObjects(this.portGroup.children, true)
      .find((x) => x.object.userData.port);
    return hit
      ? { road: hit.object.userData.road, end: hit.object.userData.end }
      : undefined;
  }
  showRoute(project: Project, steps: Step[]) {
    this.clear(this.routePreview);
    const material = new T.LineBasicMaterial({
      color: 0xd85e20,
      depthTest: false,
    });
    const points: V[] = [];
    for (const step of steps) {
      const r = project.roads.find((r) => r.id === step.road)!;
      for (let i = 0; i <= 100; i++) {
        const travel = i / 100,
          t = step.direction === 1 ? travel : 1 - travel,
          available = laneWidth(r, step.outLane, t) > r.width * 0.8;
        const blend = available ? smooth((travel - 0.12) / 0.7) : 0,
          q = lerp(
            lanePoint(r, step.inLane, t),
            lanePoint(r, step.outLane, t),
            blend,
          );
        points.push({ ...q, y: q.y + 0.2 });
      }
    }
    const line = this.line(points, material, this.routePreview);
    line.renderOrder = 30;
  }
  hit(clientX: number, clientY: number): Hit | undefined {
    this.setRay(clientX, clientY);
    const handle = this.handles.visible
      ? this.ray
          .intersectObjects(this.handles.children, true)
          .find((x) => x.object.userData.handle && x.object.parent?.visible)
      : undefined;
    if (handle)
      return {
        ...handle.object.userData,
        position: { x: handle.point.x, y: handle.point.y, z: handle.point.z },
      } as Hit;
    const road = this.ray
      .intersectObjects(this.roads.children, true)
      .find((x) => x.object.userData.road && !x.object.userData.noPick);
    return road
      ? ({
          ...road.object.userData,
          position: { x: road.point.x, y: road.point.y, z: road.point.z },
        } as Hit)
      : undefined;
  }
  setRay(x: number, y: number) {
    const b = this.el.getBoundingClientRect();
    this.syncViewport(b);
    this.mouse.set(
      ((x - b.left) / b.width) * 2 - 1,
      (-(y - b.top) / b.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.mouse, this.camera);
  }
  groundPoint(x: number, y: number, height = 0): V | undefined {
    this.setRay(x, y);
    const plane = new T.Plane(new T.Vector3(0, 1, 0), -height),
      p = new T.Vector3();
    if (this.ray.ray.intersectPlane(plane, p))
      return { x: p.x, y: p.y, z: p.z };
  }
  project(p: V) {
    const rect = this.el.getBoundingClientRect();
    this.syncViewport(rect);
    const q = vec(p).project(this.camera);
    return {
      x: rect.left + ((q.x + 1) * rect.width) / 2,
      y: rect.top + ((-q.y + 1) * rect.height) / 2,
    };
  }
  top() {
    const t = this.controls.target.clone(),
      d = this.camera.position.distanceTo(t);
    this.camera.position.copy(t).add(new T.Vector3(0, d, 0.01));
    this.controls.update();
  }
  perspective() {
    const t = this.controls.target.clone(),
      d = this.camera.position.distanceTo(t);
    this.camera.position
      .copy(t)
      .add(new T.Vector3(0.25, 0.7, 0.7).normalize().multiplyScalar(d));
    this.controls.update();
  }
  fit(roads: Road[]) {
    if (!roads.length) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(100, 180, 200);
      return;
    }
    const b = new T.Box3();
    for (const r of roads) for (const k of r.knots) b.expandByPoint(vec(k.p));
    b.expandByScalar(12);
    const c = b.getCenter(new T.Vector3()),
      size = b.getSize(new T.Vector3()),
      tan = Math.tan(T.MathUtils.degToRad(21)),
      d = Math.max(
        55,
        Math.max(
          size.x / (2 * tan * this.camera.aspect),
          (size.z + size.y * 0.6) / (2 * tan),
        ) * 1.2,
      );
    this.controls.maxDistance = Math.max(1000, d * 1.15);
    this.camera.far = Math.max(3000, d + size.length() * 2);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.camera.position
      .copy(c)
      .add(new T.Vector3(0.02, 0.86, 0.51).normalize().multiplyScalar(d));
    this.controls.update();
  }
  private initializeCars() {
    const body = new T.BoxGeometry(3.8, 1, 1.65),
      cabin = new T.BoxGeometry(1.8, 0.55, 1.35),
      wheel = new T.CylinderGeometry(0.3, 0.3, 0.2, 8);
    wheel.rotateX(Math.PI / 2);
    this.bodyInstances = new T.InstancedMesh(
      body,
      new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }),
      350,
    );
    this.cabinInstances = new T.InstancedMesh(
      cabin,
      new T.MeshStandardMaterial({ color: 0x304953, roughness: 0.3 }),
      350,
    );
    this.wheelInstances = new T.InstancedMesh(
      wheel,
      new T.MeshStandardMaterial({ color: 0x202728 }),
      1400,
    );
    for (const mesh of [
      this.bodyInstances,
      this.cabinInstances,
      this.wheelInstances,
    ]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.cars.add(mesh);
    }
  }
  private ensureCarCapacity(required: number) {
    const capacity = this.bodyInstances.instanceMatrix.count;
    if (required <= capacity) return;
    const nextCapacity = Math.max(required, capacity * 2);
    const grow = (previous: T.InstancedMesh, count: number) => {
      const mesh = new T.InstancedMesh(
        previous.geometry,
        previous.material,
        count,
      );
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.cars.remove(previous);
      previous.dispose();
      this.cars.add(mesh);
      return mesh;
    };
    this.bodyInstances = grow(this.bodyInstances, nextCapacity);
    this.cabinInstances = grow(this.cabinInstances, nextCapacity);
    this.wheelInstances = grow(this.wheelInstances, nextCapacity * 4);
  }
  updateCars(vehicles: Vehicle[]) {
    this.ensureCarCapacity(vehicles.length);
    const object = new T.Object3D(),
      matrix = new T.Matrix4(),
      local = new T.Matrix4(),
      colors = [0xf3c96f, 0xbcdde0, 0xeb855e, 0xf4f1da, 0x7daba1];
    this.bodyInstances.count = vehicles.length;
    this.cabinInstances.count = vehicles.length;
    this.wheelInstances.count = vehicles.length * 4;
    for (let i = 0; i < vehicles.length; i++) {
      const c = vehicles[i];
      object.position.set(c.position.x, c.position.y + 0.025, c.position.z);
      object.rotation.set(0, -c.heading, c.pitch || 0, "YXZ");
      object.updateMatrix();
      this.bodyInstances.setMatrixAt(
        i,
        matrix.multiplyMatrices(
          object.matrix,
          local.makeTranslation(0, 0.82, 0),
        ),
      );
      this.bodyInstances.setColorAt(i, new T.Color(colors[c.color]));
      this.cabinInstances.setMatrixAt(
        i,
        matrix.multiplyMatrices(
          object.matrix,
          local.makeTranslation(-0.35, 1.4, 0),
        ),
      );
      let w = 0;
      for (const x of [-1.15, 1.15])
        for (const z of [-0.78, 0.78])
          this.wheelInstances.setMatrixAt(
            i * 4 + w++,
            matrix.multiplyMatrices(
              object.matrix,
              local.makeTranslation(x, 0.31, z),
            ),
          );
    }
    for (const mesh of [
      this.bodyInstances,
      this.cabinInstances,
      this.wheelInstances,
    ])
      mesh.instanceMatrix.needsUpdate = true;
    if (this.bodyInstances.instanceColor)
      this.bodyInstances.instanceColor.needsUpdate = true;
  }
  render() {
    this.updateCamera();
    this.controls.update();
    const near = Math.max(
      0.2,
      this.camera.position.distanceTo(this.controls.target) * 0.01,
    );
    if (Math.abs(this.camera.near - near) > 0.001) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    const tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)),
      height = this.el.clientHeight;
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.details.visible = (3.6 * height) / (2 * distance * tan) > 4;
    if (this.handles.visible)
      this.handles.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const d = this.camera.position.distanceTo(object.position),
          pixelWorld = (2 * d * tan) / height,
          radius = object.userData.radius || 1;
        object.scale.setScalar(
          Math.max(
            0.5,
            (pixelWorld * (object.userData.part === "p" ? 6 : 5)) / radius,
          ),
        );
      });
    for (const marker of this.buildMarker.children) {
      if (!marker.userData.marker) continue;
      const d = this.camera.position.distanceTo(marker.position);
      marker.scale.setScalar(((2 * d * tan) / height) * 12);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
