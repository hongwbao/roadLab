import type { Editor } from "../editor/editor";
import {
  clearSignalPresets,
  loadSignalPresets,
  parseSignalPreset,
  removeSignalPreset,
  resolveSignalApproaches,
  serializeSignalPreset,
  SIGNAL_TURN_NAMES,
  SIGNAL_TURNS,
  storeSignalPreset,
} from "../core/traffic-signal-programs";
import type { Turn } from "../core/types";

export const trafficLightIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="18" rx="3"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="11" r="1"/><circle cx="12" cy="16" r="1"/><path d="M12 20v2M4 5h3M17 5h3M4 11h3M17 11h3"/></svg>`;
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const range = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
) =>
  `<label class="signal-timing"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" value="${value}" data-signal-time="${key}" aria-label="${label}"><output>${value} s</output></label>`;
function customEditor(editor: Editor) {
  const tool = editor.signalTool,
    config = tool.config!,
    program = config.program!,
    phase = tool.phase!,
    index = program.phases.indexOf(phase),
    junction = tool.junction!;
  const resolved = resolveSignalApproaches(program, junction),
    library = loadSignalPresets();
  const tabs = program.phases
    .map(
      (p, i) =>
        `<li><button type="button" class="signal-phase-tab${p.id === phase.id ? " selected" : ""}" data-signal-action="select-phase" data-phase-id="${p.id}" aria-pressed="${p.id === phase.id}" title="${escape(p.name)}"><span>相位 ${i + 1}</span><strong>${escape(p.name)}</strong><output>${p.duration} s</output></button></li>`,
    )
    .join("");
  const matrix = program.approaches
    .map(
      (approach) =>
        `<tr><th scope="row">${escape(approach.name)}${resolved.has(approach.id) ? "" : "<small>方向缺失</small>"}</th>${SIGNAL_TURNS.map(
          (turn) => {
            const checked = phase.movements.some(
                (m) => m.approach === approach.id && m.turn === turn,
              ),
              id = `signal-phase-${phase.id}-${approach.id}-${turn}`;
            return `<td><label class="signal-movement" for="${id}"><input type="checkbox" id="${id}" name="${id}" data-signal-movement data-phase-id="${phase.id}" data-approach="${approach.id}" data-turn="${turn}" aria-label="${escape(approach.name)}${SIGNAL_TURN_NAMES[turn]}"${checked ? " checked" : ""}${resolved.has(approach.id) ? "" : " disabled"}><span class="signal-movement-state">${checked ? "放行" : "红灯"}</span></label></td>`;
          },
        ).join("")}</tr>`,
    )
    .join("");
  const cycle = program.phases.reduce(
    (sum, p) => sum + p.duration + config.yellow + config.allRed,
    0,
  );
  return `<section class="signal-program" aria-label="自定义相位"><div class="signal-program-heading"><h3>相位顺序</h3><output>周期 ${cycle} s</output></div><ol class="signal-program-tabs" aria-label="选择要编辑的相位">${tabs}</ol><div class="signal-phase-edit" data-editing-phase="${phase.id}"><div class="signal-phase-heading"><h3>编辑相位 ${index + 1}</h3><div class="signal-phase-actions"><button type="button" class="icon-only" data-signal-action="phase-up" data-phase-id="${phase.id}" aria-label="上移相位"${index === 0 ? " disabled" : ""}>${icon("arrow-up")}</button><button type="button" class="icon-only" data-signal-action="phase-down" data-phase-id="${phase.id}" aria-label="下移相位"${index === program.phases.length - 1 ? " disabled" : ""}>${icon("arrow-down")}</button><button type="button" class="icon-only" data-signal-action="remove-phase" data-phase-id="${phase.id}" aria-label="删除相位"${program.phases.length <= 1 ? " disabled" : ""}>${icon("trash-2")}</button></div></div><div class="signal-phase-fields"><label for="signal-phase-${phase.id}-name"><span>名称</span><input type="text" id="signal-phase-${phase.id}-name" name="signal-phase-${phase.id}-name" data-signal-phase-name aria-describedby="signal-editor-error" data-phase-id="${phase.id}" maxlength="60" value="${escape(phase.name)}"></label><label for="signal-phase-${phase.id}-duration"><span>绿灯时长（秒）</span><input type="number" id="signal-phase-${phase.id}-duration" name="signal-phase-${phase.id}-duration" data-signal-phase-duration aria-describedby="signal-editor-error" data-phase-id="${phase.id}" min="1" max="180" step="1" value="${phase.duration}"></label></div><table class="signal-matrix"><caption>本相位允许通行的方向</caption><thead><tr><th scope="col">进口</th>${SIGNAL_TURNS.map((turn) => `<th scope="col">${SIGNAL_TURN_NAMES[turn]}</th>`).join("")}</tr></thead><tbody>${matrix}</tbody></table>${phase.movements.length ? "" : '<p class="signal-empty-phase" role="status">本相位没有放行方向，将保持红灯。</p>'}</div><div class="signal-program-actions"><button type="button" data-signal-action="add-phase"${program.phases.length >= 16 ? " disabled" : ""}>${icon("plus")}新增相位</button><button type="button" data-signal-action="reset-default">恢复默认四相位</button></div><p class="muted signal-mode-note">进口按地图方位命名。勾选的转向在本相位通行；右转同样经过黄灯和全红清空。</p></section><details class="signal-advanced" data-signal-detail="timing"><summary>黄灯、清空与协调</summary>${range("yellow", "黄灯", config.yellow, 1, 8)}${range("allRed", "全红清空", config.allRed, 1, 10)}${range("offset", "启动偏移", config.offset, 0, 600)}</details><details class="signal-presets" data-signal-detail="presets"><summary>方案保存与导入</summary><label class="signal-preset-name" for="signal-preset-name"><span>方案名称</span><input type="text" id="signal-preset-name" name="signal-preset-name" data-signal-preset-name aria-describedby="signal-editor-error" maxlength="60" placeholder="例如：十字路口四相位" value="${escape(tool.presetName)}"></label><div class="signal-preset-actions"><button type="button" data-signal-action="save-preset">保存到本机</button><button type="button" data-signal-action="export-preset">${icon("download")}导出 JSON</button></div>${library.error ? `<p class="signal-preset-error" role="alert">${escape(library.error)}</p><button type="button" data-signal-action="clear-presets">清空损坏方案库</button>` : `<label for="signal-preset-select"><span>已保存方案</span><select id="signal-preset-select" name="signal-preset-select" data-signal-preset-select${library.presets.length ? "" : " disabled"}>${library.presets.length ? library.presets.map((preset) => `<option value="${preset.id}"${tool.presetSelection === preset.id ? " selected" : ""}>${escape(preset.name)} · ${preset.program.phases.length} 相位</option>`).join("") : '<option value="">尚未保存方案</option>'}</select></label><div class="signal-preset-actions"><button type="button" data-signal-action="apply-preset"${library.presets.length ? "" : " disabled"}>导入当前路口</button><button type="button" data-signal-action="delete-preset"${library.presets.length ? "" : " disabled"}>删除方案</button></div>`}<button type="button" data-signal-action="import-preset">${icon("upload")}从 JSON 文件导入</button><input type="file" id="signal-preset-file" name="signal-preset-file" data-signal-preset-file accept=".json,application/json" hidden><p class="muted">方案按方位匹配新路口，不绑定原道路。缺失的进口不会放行；新增进口请另行勾选。本机方案仅保存在此浏览器，同名保存会替换旧方案。导出 JSON 可跨浏览器备份。</p></details>`;
}
export function trafficLightPanel(editor: Editor) {
  const tool = editor.signalTool,
    junction = tool.junction,
    config = tool.config;
  const heading = `<div class="panel-heading"><h2>路口红绿灯</h2><button type="button" data-action="leave-signals" class="icon-only" aria-label="关闭红绿灯工具">${icon("x")}</button></div>`;
  if (!junction)
    return (
      heading +
      `<p>点击地图中的路口中心，添加或调整红绿灯。</p><p class="muted">支持三岔和十字路口。按 K 或 Esc 返回。</p>`
    );
  if (!config)
    return (
      heading +
      `<p>已选中 ${junction.arms.length} 岔路口</p><button type="button" data-action="enable-signal" class="primary">${trafficLightIcon}添加红绿灯</button><p class="muted">十字路口默认使用四相位，各相位均允许四向右转；添加后可逐相位调整。</p>`
    );
  const automatic = config.mode === "cs2",
    custom = config.mode === "custom";
  const modes = `<div class="signal-modes" role="group" aria-label="信号配相方式"><button data-signal-mode="custom" aria-pressed="${custom}">自定义相位</button><button data-signal-mode="cs2" aria-pressed="${automatic}">自动感应</button><button data-signal-mode="protected" aria-pressed="${config.mode === "protected"}">直行／左转分相</button><button data-signal-mode="sequential" aria-pressed="${config.mode === "sequential"}">逐进口轮放</button></div>`;
  const timing = custom
    ? customEditor(editor)
    : automatic
      ? `<p class="muted signal-mode-note">根据来车选择信号组。对向车辆可以同时通行，左转车辆让行。</p>`
      : `<p class="muted signal-mode-note">${config.mode === "protected" ? "对向直行与右转同时放行，左转使用独立相位。共用转向车道可选逐进口轮放。" : "每次放行一个进口的所有转向。"}红灯禁止右转。</p>${range("green", "通行绿灯", config.green, 5, 120)}${config.mode === "protected" ? range("leftGreen", "左转绿灯", config.leftGreen, 3, 60) : ""}<details class="signal-advanced" data-signal-detail="timing"><summary>黄灯、清空与协调</summary>${range("yellow", "黄灯", config.yellow, 1, 8)}${range("allRed", "全红清空", config.allRed, 1, 10)}${range("offset", "启动偏移", config.offset, 0, 600)}</details>`;
  return (
    heading +
    `<div class="signal-live" role="status" aria-live="off"><span class="signal-status-dot" data-signal-dot></span><strong data-signal-live>准备通行</strong><output data-signal-remaining></output></div>${modes}<p class="signal-editor-error" id="signal-editor-error" data-signal-error role="alert" hidden></p>${timing}${custom ? "" : '<ol class="signal-phases" aria-label="自动生成的信号相位" data-signal-phases></ol>'}<p class="muted signal-clearance">${automatic ? "没有其他方向来车时保持当前通行组，有需求时经过转换阶段切换。" : "黄灯结束后先全红；路口车辆尚未驶离时延长清空。修改相位或配时会重置测试。"}</p><button type="button" data-action="remove-signal" class="danger">${icon("trash-2")}移除红绿灯</button>`
  );
}

/** Bind once to the stable panel element. Its contents can be replaced on every edit. */
export function bindTrafficLightPanel(editor: Editor, panel: HTMLElement) {
  const tool = editor.signalTool;
  const error = (value: unknown) => {
    const message =
      value instanceof Error ? value.message : "操作失败，请检查方案后重试。";
    const target = panel.querySelector<HTMLElement>("[data-signal-error]");
    if (target) {
      target.hidden = false;
      target.textContent = message;
    }
    editor.onToast(message);
  };
  const resetError = () => {
    const target = panel.querySelector<HTMLElement>("[data-signal-error]");
    if (target) target.hidden = true;
    panel
      .querySelectorAll('[aria-invalid="true"]')
      .forEach((field) => field.removeAttribute("aria-invalid"));
  };
  const presetName = () =>
    panel.querySelector<HTMLInputElement>("[data-signal-preset-name]")?.value ??
    tool.presetName;
  const presetId = () =>
    panel.querySelector<HTMLSelectElement>("[data-signal-preset-select]")
      ?.value ?? tool.presetSelection;
  panel.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute("data-signal-preset-name"))
      tool.presetName = input.value;
  });
  panel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-signal-action]",
    );
    if (!button || !panel.contains(button) || button.disabled) return;
    event.preventDefault();
    resetError();
    try {
      const id = button.dataset.phaseId!;
      switch (button.dataset.signalAction) {
        case "select-phase":
          tool.selectPhase(id);
          break;
        case "add-phase":
          tool.addPhase();
          break;
        case "remove-phase":
          tool.removePhase(id);
          break;
        case "phase-up":
          tool.movePhase(id, -1);
          break;
        case "phase-down":
          tool.movePhase(id, 1);
          break;
        case "reset-default":
          tool.resetProgram();
          break;
        case "save-preset": {
          const preset = tool.preset(presetName());
          storeSignalPreset(preset);
          tool.presetSelection = preset.id;
          editor.onChange();
          editor.onToast(`方案“${preset.name}”已保存到本机`);
          break;
        }
        case "apply-preset": {
          const library = loadSignalPresets();
          if (library.error) throw new Error(library.error);
          const preset = library.presets.find(
            (value) => value.id === presetId(),
          );
          if (!preset) throw new Error("请先选择一个已保存方案。");
          tool.applyPreset(preset);
          break;
        }
        case "delete-preset":
          removeSignalPreset(presetId());
          tool.presetSelection = "";
          editor.onChange();
          editor.onToast("已删除本机方案，当前路口配置保留");
          break;
        case "clear-presets":
          clearSignalPresets();
          editor.onChange();
          editor.onToast("已清空损坏方案库，当前路口配置保留");
          break;
        case "export-preset": {
          const preset = tool.preset(presetName().trim() || "十字路口四相位");
          const url = URL.createObjectURL(
            new Blob([serializeSignalPreset(preset)], {
              type: "application/json",
            }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = `${preset.name.replace(/[<>:"/\\|?*]/g, "_")}.signal.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          editor.onToast("已导出当前相位方案");
          break;
        }
        case "import-preset":
          panel
            .querySelector<HTMLInputElement>("[data-signal-preset-file]")
            ?.click();
          break;
      }
    } catch (value) {
      error(value);
    }
  });
  panel.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    resetError();
    try {
      if (input.hasAttribute("data-signal-phase-name"))
        tool.changePhase(input.dataset.phaseId!, "name", input.value);
      else if (input.hasAttribute("data-signal-phase-duration"))
        tool.changePhase(
          input.dataset.phaseId!,
          "duration",
          input.value.trim() ? Number(input.value) : NaN,
        );
      else if (input.hasAttribute("data-signal-movement"))
        tool.toggleMovement(
          input.dataset.phaseId!,
          input.dataset.approach!,
          input.dataset.turn as Turn,
          input.checked,
        );
      else if (input.hasAttribute("data-signal-preset-select"))
        tool.presetSelection = input.value;
      else if (input.hasAttribute("data-signal-preset-file")) {
        const file = input.files?.[0];
        if (!file) return;
        const selected = tool.selected;
        if (file.size > 512000)
          throw new Error("方案文件超过 500 KB，请选择较小的 JSON 文件。");
        const preset = parseSignalPreset(await file.text());
        if (tool.selected !== selected)
          throw new Error("路口已切换，请在目标路口重新导入。");
        tool.presetName = preset.name;
        tool.applyPreset(preset);
      }
    } catch (value) {
      input.setAttribute("aria-invalid", "true");
      error(value);
    } finally {
      if (input.hasAttribute("data-signal-preset-file")) input.value = "";
    }
  });
}
export function updateTrafficLightPanel(editor: Editor) {
  const junction = editor.signalTool.junction,
    state = junction && editor.simulation.trafficLights.state(junction.id),
    live = document.querySelector<HTMLElement>("[data-signal-live]");
  if (!live || !state) return;
  const empty =
    editor.signalTool.config?.mode === "custom" &&
    !state.phases[state.phase].movements.size;
  live.textContent = state.clearing
    ? "等待路口清空"
    : empty
      ? `${state.name} · 全红等待`
      : `${state.name} · ${{ green: "绿灯", yellow: "黄灯", "all-red": "全红" }[state.stage]}`;
  const remaining = document.querySelector<HTMLOutputElement>(
    "[data-signal-remaining]",
  );
  if (remaining)
    remaining.textContent = state.actuated
      ? "感应控制"
      : state.clearing
        ? "清空中"
        : `${Math.ceil(state.remaining)} s`;
  const dot = document.querySelector<HTMLElement>("[data-signal-dot]");
  if (dot)
    dot.dataset.color =
      empty || state.stage === "all-red" ? "red" : state.stage;
  panelPhaseHighlight(editor, state.phase);
  const phases = document.querySelector<HTMLOListElement>(
    "[data-signal-phases]",
  );
  if (!phases) return;
  const key = `${state.id}:${state.phase}:${state.stage}:${state.phases.map((p) => `${p.name}:${p.duration}`).join(",")}`;
  if (phases.dataset.key !== key) {
    phases.dataset.key = key;
    phases.innerHTML = state.phases
      .map(
        (p, i) =>
          `<li${i === state.phase ? ' class="active" aria-current="step"' : ""}><span>${escape(p.name)}</span><span>${state.actuated ? "按车流" : `${p.duration} s`}</span></li>`,
      )
      .join("");
  }
}
function panelPhaseHighlight(editor: Editor, phase: number) {
  const id = editor.signalTool.config?.program?.phases[phase]?.id;
  document
    .querySelectorAll<HTMLElement>(".signal-phase-tab")
    .forEach((button) => {
      const running = button.dataset.phaseId === id;
      button.classList.toggle("is-running", running);
      if (running) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
}
