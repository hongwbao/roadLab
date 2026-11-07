import {
  makeTrafficSignal,
  signalForJunction,
  validateTrafficSignals,
  type TrafficSignal,
} from "../core/traffic-signals";
import type { Editor } from "./editor";
import { copy, uid, type Turn } from "../core/types";
import {
  adaptSignalProgram,
  createDefaultSignalProgram,
  makeSignalPreset,
  validateSignalPreset,
  validateSignalProgram,
  type SignalProgram,
  type SignalPreset,
} from "../core/traffic-signal-programs";

export class TrafficLightTool {
  selected?: string;
  selectedPhase?: string;
  presetName = "";
  presetSelection = "";
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
  get phase() {
    const phases = this.config?.program?.phases;
    return (
      phases?.find((phase) => phase.id === this.selectedPhase) ?? phases?.[0]
    );
  }
  selectPhase(id: string) {
    if (!this.config?.program?.phases.some((phase) => phase.id === id)) return;
    this.selectedPhase = id;
    this.editor.onChange();
  }
  private programEdit(
    change: (program: SignalProgram) => void,
    message: string,
  ) {
    const config = this.config,
      junction = this.junction;
    if (!config || !junction) return;
    const program = copy(
      config.program ??
        createDefaultSignalProgram(junction, config.green, config.leftGreen),
    );
    change(program);
    validateSignalProgram(program);
    this.editor.edit(() => {
      config.program = program;
      config.mode = "custom";
      validateTrafficSignals(this.editor.project);
    }, message);
  }
  changePhase(id: string, key: "name" | "duration", value: string | number) {
    this.programEdit((program) => {
      const phase = program.phases.find((phase) => phase.id === id);
      if (!phase) throw new Error("相位已不存在，请重新选择。");
      if (key === "name") phase.name = String(value).trim();
      else phase.duration = Number(value);
    }, "相位已更新，测试已重置");
  }
  toggleMovement(id: string, approach: string, turn: Turn, allowed: boolean) {
    this.programEdit((program) => {
      const phase = program.phases.find((phase) => phase.id === id);
      if (!phase) throw new Error("相位已不存在，请重新选择。");
      phase.movements = phase.movements.filter(
        (m) => m.approach !== approach || m.turn !== turn,
      );
      if (allowed) phase.movements.push({ approach, turn });
    }, "相位通行方向已更新，测试已重置");
  }
  addPhase() {
    const id = uid("phase");
    this.selectedPhase = id;
    this.programEdit((program) => {
      if (program.phases.length >= 16)
        throw new Error("最多支持 16 个相位，请先删除不需要的相位。");
      program.phases.push({
        id,
        name: `相位 ${program.phases.length + 1}`,
        duration: 20,
        movements: [],
      });
    }, "已新增相位，请选择需要放行的方向");
  }
  removePhase(id: string) {
    this.programEdit((program) => {
      if (program.phases.length <= 1) throw new Error("请至少保留一个相位。");
      program.phases = program.phases.filter((phase) => phase.id !== id);
    }, "已删除相位，测试已重置");
  }
  movePhase(id: string, direction: -1 | 1) {
    this.programEdit((program) => {
      const index = program.phases.findIndex((phase) => phase.id === id),
        target = index + direction;
      if (index < 0 || target < 0 || target >= program.phases.length) return;
      [program.phases[index], program.phases[target]] = [
        program.phases[target],
        program.phases[index],
      ];
    }, "相位顺序已更新，测试已重置");
  }
  resetProgram() {
    const config = this.config,
      junction = this.junction;
    if (!config || !junction) return;
    const program = createDefaultSignalProgram(
      junction,
      config.green,
      config.leftGreen,
    );
    this.selectedPhase = program.phases[0].id;
    this.editor.edit(() => {
      config.mode = "custom";
      config.program = program;
      validateTrafficSignals(this.editor.project);
    }, "已恢复默认四相位");
  }
  preset(name: string) {
    const config = this.config;
    if (!config?.program || config.mode !== "custom")
      throw new Error("请先切换到自定义相位并完成配置。");
    return makeSignalPreset(name, config.program, {
      yellow: config.yellow,
      allRed: config.allRed,
      offset: config.offset,
    });
  }
  applyPreset(preset: SignalPreset) {
    validateSignalPreset(preset);
    const config = this.config,
      junction = this.junction;
    if (!config || !junction) return;
    const program = adaptSignalProgram(preset.program, junction);
    this.selectedPhase = program.phases[0].id;
    this.editor.edit(() => {
      config.mode = "custom";
      config.program = program;
      config.yellow = preset.yellow;
      config.allRed = preset.allRed;
      config.offset = preset.offset;
      validateTrafficSignals(this.editor.project);
    }, `已导入方案“${preset.name}”，测试已重置`);
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
      if (key === "mode") {
        config.mode = value as TrafficSignal["mode"];
        if (value === "custom" && !config.program)
          config.program = createDefaultSignalProgram(
            this.junction!,
            config.green,
            config.leftGreen,
          );
      } else config[key] = Number(value);
      validateTrafficSignals(this.editor.project);
    }, "红绿灯配时已更新，测试已重置");
  }
}
