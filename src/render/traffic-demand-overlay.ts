import * as T from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { center, dist, pavementWidth } from "../core/math";
import type { PortReference } from "../core/traffic-demand";
import type { Project } from "../core/types";

/** OD indication only: independent of pavement and physical lane paths. */
export class TrafficDemandOverlay {
  readonly group = new T.Group();
  private signature = "";
  private points: T.Vector3[] = [];
  private length = 1;
  private strokes: Line2[] = [];
  private rings: { mesh: T.Mesh; radius: number }[] = [];
  private arrow?: T.Mesh;
  private readonly projected = new T.Vector3();
  show(project: Project, source?: PortReference, target?: PortReference) {
    this.group.visible = !!source && !!target;
    if (!source || !target) return;
    const a = project.roads.find((r) => r.id === source.road),
      b = project.roads.find((r) => r.id === target.road);
    if (!a || !b) {
      this.group.visible = false;
      return;
    }
    const start = center(a, source.end === "start" ? 0 : 1),
      end = center(b, target.end === "start" ? 0 : 1);
    const radii = [
      pavementWidth(a, source.end === "start" ? 0 : 1) / 2 + 2,
      pavementWidth(b, target.end === "start" ? 0 : 1) / 2 + 2,
    ];
    const signature = JSON.stringify([
      source.road,
      source.end,
      target.road,
      target.end,
      start,
      end,
      radii,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    const geometries = new Set<T.BufferGeometry>();
    this.group.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        geometries.add(o.geometry);
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => m.dispose());
      }
    });
    geometries.forEach((g) => g.dispose());
    this.group.clear();
    this.strokes = [];
    this.rings = [];
    const curve = new T.QuadraticBezierCurve3(
      new T.Vector3(start.x, start.y + 0.6, start.z),
      new T.Vector3(
        (start.x + end.x) / 2,
        Math.max(start.y, end.y) + Math.max(8, dist(start, end) * 0.06),
        (start.z + end.z) / 2,
      ),
      new T.Vector3(end.x, end.y + 0.6, end.z),
    );
    this.points = curve.getPoints(80);
    this.length = Math.max(1, curve.getLength());
    const geometry = new LineGeometry().setPositions(
      this.points.flatMap((p) => [p.x, p.y, p.z]),
    );
    for (const [color, width] of [
      [0x1d2b33, 5.5],
      [0x62c3f0, 2.75],
    ]) {
      const line = new Line2(
        geometry,
        new LineMaterial({
          color,
          linewidth: width,
          dashed: true,
          dashSize: 13,
          gapSize: 8,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = color === 0x62c3f0 ? 61 : 60;
      line.frustumCulled = false;
      line.userData.trafficOD = color === 0x62c3f0;
      this.group.add(line);
      this.strokes.push(line);
    }
    [start, end].forEach((p, i) => {
      for (const [color, tube] of [
        [0x1d2b33, 0.24],
        [i === 0 ? 0x62c3f0 : 0xffd276, 0.12],
      ]) {
        const ring = new T.Mesh(
          new T.TorusGeometry(1, tube, 6, 48),
          new T.MeshBasicMaterial({
            color,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(p.x, p.y + 0.65, p.z);
        ring.renderOrder = tube < 0.2 ? 64 : 62;
        this.group.add(ring);
        this.rings.push({ mesh: ring, radius: radii[i] });
      }
    });
    const arrow = new T.Mesh(
      new T.ConeGeometry(0.45, 1.4, 12),
      new T.MeshBasicMaterial({
        color: 0x62c3f0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    arrow.position.copy(curve.getPoint(0.82));
    arrow.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      curve.getTangent(0.82).normalize(),
    );
    arrow.renderOrder = 65;
    this.group.add(arrow);
    this.arrow = arrow;
  }
  /** Keep width/dashes and marker readability through camera zoom and resize.
   * Only a few projections and uniforms change; no road/line geometry rebuild. */
  updateView(camera: T.Camera, size: T.Vector2) {
    if (!this.group.visible || !this.strokes.length || !size.y) return;
    let pixels = 0,
      lastX = 0,
      lastY = 0;
    for (let i = 0; i < this.points.length; i += 10) {
      const p = this.projected.copy(this.points[i]).project(camera),
        x = (p.x * size.x) / 2,
        y = (p.y * size.y) / 2;
      if (i) pixels += Math.hypot(x - lastX, y - lastY);
      lastX = x;
      lastY = y;
    }
    for (const line of this.strokes)
      line.material.dashScale = Math.max(0.001, pixels / this.length);
    const worldPixel = (p: T.Vector3) => {
      const depth =
        camera instanceof T.PerspectiveCamera
          ? Math.abs(
              this.projected.copy(p).applyMatrix4(camera.matrixWorldInverse).z,
            )
          : 1;
      return Math.max(
        0.001,
        (2 * depth) / (size.y * camera.projectionMatrix.elements[5]),
      );
    };
    for (const ring of this.rings)
      ring.mesh.scale.setScalar(
        Math.max(ring.radius, worldPixel(ring.mesh.position) * 11),
      );
    if (this.arrow)
      this.arrow.scale.setScalar(worldPixel(this.arrow.position) * 12);
  }
  hide() {
    this.group.visible = false;
  }
}
