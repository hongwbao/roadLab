import * as T from "three";
import { add, dist, mul } from "../core/math";
import {
  junctionLaneKey,
  type JunctionLaneEndpoint,
  type JunctionLaneLayout,
  type JunctionLaneLink,
  type JunctionLanePort,
} from "../core/junction-lane-connections";
import type { V } from "../core/types";

export type JunctionLaneHit =
  | { kind: "port"; port: JunctionLanePort }
  | { kind: "link"; link: JunctionLaneLink };
type ProjectPoint = (p: V) => { x: number; y: number };
const vector = (p: V) => new T.Vector3(p.x, p.y + 0.16, p.z);
const cyan = 0x5de2ed,
  selected = 0xffd276,
  white = 0xffffff;
function segmentDistance(
  x: number,
  y: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}
function clear(group: T.Group) {
  group.traverse((object) => {
    if (object instanceof T.Mesh || object instanceof T.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    }
  });
  group.clear();
}
/** An independent scene group: road rebuilds never clear or steal these resources. */
export class JunctionLaneOverlay {
  readonly group = new T.Group();
  private lines = new Map<
    string,
    T.Mesh<T.TubeGeometry, T.MeshBasicMaterial>
  >();
  private dots = new Map<
    string,
    {
      centre: T.Mesh<T.CircleGeometry, T.MeshBasicMaterial>;
      ring: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
    }
  >();
  private preview = new T.Group();
  private layout?: JunctionLaneLayout;
  private selected?: JunctionLaneEndpoint;
  constructor() {
    this.group.name = "junction-lane-connections";
    this.group.visible = false;
  }
  rebuild(layout?: JunctionLaneLayout) {
    clear(this.group);
    this.lines.clear();
    this.dots.clear();
    this.layout = layout;
    this.group.visible = !!layout;
    if (!layout) return;
    const outline = new T.Line(
      new T.BufferGeometry().setFromPoints(
        [...layout.junction.polygon, layout.junction.polygon[0]]
          .filter(Boolean)
          .map(vector),
      ),
      new T.LineBasicMaterial({
        color: cyan,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        depthWrite: false,
      }),
    );
    outline.renderOrder = 70;
    this.group.add(outline);
    for (const link of layout.links) {
      const curve = new T.CubicBezierCurve3(
        ...(link.points.map(vector) as [
          T.Vector3,
          T.Vector3,
          T.Vector3,
          T.Vector3,
        ]),
      );
      const line = new T.Mesh(
        new T.TubeGeometry(curve, 48, 0.17, 5, false),
        new T.MeshBasicMaterial({
          color: cyan,
          transparent: true,
          opacity: 0.8,
          depthTest: false,
          depthWrite: false,
        }),
      );
      line.renderOrder = 75;
      line.userData = { connection: link.id };
      this.group.add(line);
      this.lines.set(link.id, line);
    }
    for (const port of layout.ports) {
      const centre = new T.Mesh(
        new T.CircleGeometry(0.67, 24),
        new T.MeshBasicMaterial({
          color: port.kind === "in" ? cyan : 0x263540,
          depthTest: false,
          depthWrite: false,
        }),
      );
      const ring = new T.Mesh(
        new T.RingGeometry(0.65, 0.91, 24),
        new T.MeshBasicMaterial({
          color: cyan,
          depthTest: false,
          depthWrite: false,
        }),
      );
      for (const dot of [centre, ring]) {
        dot.rotation.x = -Math.PI / 2;
        dot.position.copy(vector(port.position));
        dot.renderOrder = 85;
        dot.userData = { port: port.key, kind: port.kind };
        this.group.add(dot);
      }
      this.dots.set(port.key, { centre, ring });
    }
    this.preview = new T.Group();
    this.group.add(this.preview);
    this.setState();
  }
  setState(
    source?: JunctionLaneEndpoint,
    hover?: JunctionLaneHit,
    connection?: string,
  ) {
    this.selected = source;
    const key = source ? junctionLaneKey(source) : undefined;
    const possible = new Set(
      this.layout?.candidates
        .filter((link) => link.from.key === key)
        .map((link) => link.to.key),
    );
    for (const [id, line] of this.lines) {
      const link = this.layout!.links.find((row) => row.id === id)!,
        active = !key || link.from.key === key,
        highlight =
          id === connection || (hover?.kind === "link" && hover.link.id === id);
      line.material.color.setHex(highlight ? white : cyan);
      line.material.opacity = highlight ? 1 : active ? 0.9 : 0.17;
      line.renderOrder = highlight ? 80 : 75;
    }
    for (const port of this.layout?.ports ?? []) {
      const dot = this.dots.get(port.key)!,
        active = port.key === key,
        hovered = hover?.kind === "port" && hover.port.key === port.key,
        legal = !key || port.kind === "in" || possible.has(port.key);
      dot.centre.material.color.setHex(
        active
          ? selected
          : hovered && legal
            ? white
            : port.kind === "in"
              ? cyan
              : 0x263540,
      );
      dot.ring.material.color.setHex(
        active ? selected : hovered && legal ? white : legal ? cyan : 0x617581,
      );
      dot.centre.scale.setScalar(active || (hovered && legal) ? 1.18 : 1);
      dot.ring.scale.copy(dot.centre.scale);
    }
  }
  previewTo(point?: V, port?: JunctionLanePort) {
    clear(this.preview);
    if (!this.selected || !this.layout || !point) return;
    const from = this.layout.ports.find(
      (p) => p.key === junctionLaneKey(this.selected!),
    );
    if (!from) return;
    let points: readonly [V, V, V, V];
    if (port) {
      const candidate = this.layout.candidates.find(
        (link) => link.from.key === from.key && link.to.key === port.key,
      );
      if (!candidate) return;
      points = candidate.points;
    } else {
      const span = dist(from.position, point) * 0.45;
      points = [
        from.position,
        add(from.position, mul(from.direction, span)),
        point,
        point,
      ];
    }
    const curve = new T.CubicBezierCurve3(
      ...(points.map(vector) as [T.Vector3, T.Vector3, T.Vector3, T.Vector3]),
    );
    const exists =
        port &&
        this.layout.links.some(
          (link) => link.from.key === from.key && link.to.key === port.key,
        ),
      mesh = new T.Mesh(
        new T.TubeGeometry(curve, 32, 0.19, 5, false),
        new T.MeshBasicMaterial({
          color: exists ? 0xffae8c : cyan,
          transparent: true,
          opacity: 0.65,
          depthTest: false,
          depthWrite: false,
        }),
      );
    mesh.renderOrder = 88;
    this.preview.add(mesh);
  }
  hit(
    x: number,
    y: number,
    project: ProjectPoint,
  ): JunctionLaneHit | undefined {
    if (!this.group.visible || !this.layout) return;
    let point: JunctionLanePort | undefined,
      best = 14;
    for (const port of this.layout.ports) {
      const p = project(port.position),
        d = Math.hypot(x - p.x, y - p.y);
      if (d < best) {
        best = d;
        point = port;
      }
    }
    if (point) return { kind: "port", port: point };
    let line: JunctionLaneLink | undefined;
    best = 6;
    for (const link of this.layout.links) {
      const samples = link.samples.map(project);
      for (let i = 1; i < samples.length; i++) {
        const d = segmentDistance(x, y, samples[i - 1], samples[i]);
        if (d < best) {
          best = d;
          line = link;
        }
      }
    }
    return line ? { kind: "link", link: line } : undefined;
  }
  dispose() {
    clear(this.group);
    this.lines.clear();
    this.dots.clear();
    this.layout = undefined;
    this.group.visible = false;
  }
}
