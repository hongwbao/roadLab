import * as T from "three";
import {
  arcParameter,
  arcTable,
  add,
  laneCount,
  laneDirection,
  lanePoint,
  laneWidth,
  mul,
  tangent,
} from "../core/math";
import {
  signalForJunction,
  signalArmKey,
  SIGNAL_STOP_OFFSET,
} from "../core/traffic-signals";
import type { Junction } from "../core/junctions";
import type { Project, Turn } from "../core/types";
import type {
  LightColor,
  TrafficLightController,
} from "../simulation/traffic-lights";

type Head = {
  junction: string;
  arm: string;
  turn: Turn;
  sprite: T.Sprite;
  color?: LightColor;
};
export class TrafficLightRenderer {
  group = new T.Group();
  private heads: Head[] = [];
  private textures = new Map<string, T.CanvasTexture>();
  private texture(color: LightColor, left: boolean) {
    const key = `${color}:${left}`;
    let texture = this.textures.get(key);
    if (texture) return texture;
    const canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 160;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#202e36";
    c.beginPath();
    c.roundRect(3, 3, 66, 154, 12);
    c.fill();
    c.strokeStyle = "#b4c7d0";
    c.lineWidth = 3;
    c.stroke();
    for (const [i, light] of (["red", "yellow", "green"] as const).entries()) {
      c.beginPath();
      c.arc(36, 31 + i * 49, 19, 0, Math.PI * 2);
      c.fillStyle =
        light === color
          ? { red: "#ff6159", yellow: "#ffd568", green: "#75e6aa" }[light]
          : "#35434b";
      c.fill();
      if (left && light === color) {
        c.strokeStyle = "#142b25";
        c.lineWidth = 5;
        c.lineCap = "round";
        c.lineJoin = "round";
        const y = 31 + i * 49;
        c.beginPath();
        c.moveTo(46, y + 9);
        c.lineTo(46, y - 3);
        c.lineTo(26, y - 3);
        c.moveTo(33, y - 10);
        c.lineTo(26, y - 3);
        c.lineTo(33, y + 4);
        c.stroke();
      }
    }
    texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    this.textures.set(key, texture);
    return texture;
  }
  rebuild(project: Project, junctions: readonly Junction[]) {
    this.group.traverse((obj) => {
      if (obj instanceof T.Mesh || obj instanceof T.Line) {
        obj.geometry.dispose();
        (obj.material as T.Material).dispose();
      } else if (obj instanceof T.Sprite) obj.material.dispose();
    });
    this.group.clear();
    this.heads = [];
    for (const junction of junctions) {
      const config = signalForJunction(project.signals, junction);
      if (!config) continue;
      for (const arm of junction.arms) {
        const road = project.roads.find((r) => r.id === arm.road)!;
        const direction = arm.end === 1 ? 1 : -1;
        const lanes = Array.from({ length: laneCount(road) }, (_, i) => i)
          .filter(
            (i) =>
              laneDirection(road, i) === direction &&
              laneWidth(road, i, arm.end) > road.width * 0.7,
          )
          .sort((a, b) => (a - b) * direction);
        if (!lanes.length) continue;
        const table = arcTable(road),
          length = table.at(-1)!.s,
          offset = arm.trim + SIGNAL_STOP_OFFSET;
        const t = arcParameter(table, arm.end === 0 ? offset : length - offset),
          d = mul(tangent(road, t), direction),
          n = { x: -d.z, y: 0, z: d.x };
        const outer = lanePoint(road, lanes.at(-1)!, t),
          base = add(outer, mul(n, road.width / 2 + 0.9));
        const pole = new T.Mesh(
          new T.CylinderGeometry(0.12, 0.15, 4.4, 7),
          new T.MeshStandardMaterial({ color: 0x76888e, roughness: 0.7 }),
        );
        pole.position.set(base.x, base.y + 2.2, base.z);
        this.group.add(pole);
        const turns: ("left" | "straight")[] =
          config.mode === "cs2" ? ["straight"] : ["left", "straight"];
        for (const [i, turn] of turns.entries()) {
          const p = add(base, mul(n, (i - (turns.length - 1) / 2) * 1.5));
          const sprite = new T.Sprite(
            new T.SpriteMaterial({
              map: this.texture("red", turn === "left"),
              depthTest: false,
            }),
          );
          sprite.position.set(p.x, p.y + 5.1, p.z);
          sprite.scale.set(1.65, 3.65, 1);
          sprite.renderOrder = 35;
          this.group.add(sprite);
          this.heads.push({
            junction: junction.id,
            arm: signalArmKey(arm),
            turn,
            sprite,
          });
        }
        for (const lane of lanes) {
          const p = lanePoint(road, lane, t),
            half = mul(n, road.width * 0.45);
          const line = new T.Line(
            new T.BufferGeometry().setFromPoints([
              new T.Vector3(p.x - half.x, p.y + 0.09, p.z - half.z),
              new T.Vector3(p.x + half.x, p.y + 0.09, p.z + half.z),
            ]),
            new T.LineBasicMaterial({ color: 0xf0eed8 }),
          );
          this.group.add(line);
        }
      }
    }
  }
  update(controller: TrafficLightController) {
    for (const head of this.heads) {
      const color = controller.armColor(head.junction, head.arm, head.turn);
      if (head.color === color) continue;
      head.color = color;
      head.sprite.material.map = this.texture(color, head.turn === "left");
      head.sprite.material.needsUpdate = true;
    }
  }
}
