import {
  makeTrafficSignal,
  signalForJunction,
  validateTrafficSignals,
  type TrafficSignal,
} from "../core/traffic-signals";
import type { Editor } from "./editor";

export class TrafficLightTool {
  selected?: string;
  constructor(private editor: Editor) {}
  get junction() {
    return this.editor.simulation.junctions.find(
      (j) => j.id === this.selected && j.arms.length >= 3,
    );
  }
  get config() {
    const junction = this.junction;
    return junction && signalForJunction(this.editor.project.signals, junction);
  }
  hit(x: number, y: number) {
    const editor = this.editor;
    return editor.simulation.junctions
      .filter((j) => j.arms.length >= 3)
      .map((junction) => {
        const p = editor.scene.project(junction.position),
          edge = editor.scene.project({
            ...junction.position,
            x: junction.position.x + junction.radius,
          });
        return {
          junction,
          distance: Math.hypot(p.x - x, p.y - y),
          radius: Math.max(22, Math.hypot(p.x - edge.x, p.y - edge.y)),
        };
      })
      .filter((x) => x.distance < x.radius)
      .sort((a, b) => a.distance - b.distance)[0]?.junction;
  }
  select(x: number, y: number) {
    const junction = this.hit(x, y);
    if (!junction) {
      this.editor.onToast("请点击三岔或十字路口的中心。");
      return;
    }
    this.selected = junction.id;
    this.editor.scene.showBuildMarker(junction.position, true);
    this.editor.onChange();
  }
  enable() {
    const junction = this.junction;
    if (!junction || this.config) return;
    this.editor.edit(() => {
      this.editor.project.signals ??= [];
      this.editor.project.signals.push(makeTrafficSignal(junction));
    }, "已添加红绿灯");
    this.editor.scene.showBuildMarker(junction.position, true);
  }
  remove() {
    const config = this.config;
    if (!config) return;
    this.editor.edit(() => {
      this.editor.project.signals = this.editor.project.signals?.filter(
        (s) => s.id !== config.id,
      );
    }, "已移除红绿灯，恢复无灯通行");
  }
  change(
    key: "green" | "leftGreen" | "yellow" | "allRed" | "offset" | "mode",
    value: number | TrafficSignal["mode"],
  ) {
    const config = this.config;
    if (!config) return;
    this.editor.edit(() => {
      if (key === "mode") config.mode = value as TrafficSignal["mode"];
      else config[key] = Number(value);
      validateTrafficSignals(this.editor.project);
    }, "红绿灯配时已更新，测试已重置");
  }
}
