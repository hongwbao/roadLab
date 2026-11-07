import type { Editor } from "../editor/editor";

export const trafficLightIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="18" rx="3"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="11" r="1"/><circle cx="12" cy="16" r="1"/><path d="M12 20v2M4 5h3M17 5h3M4 11h3M17 11h3"/></svg>`;
const range = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
) =>
  `<label class="signal-timing"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" value="${value}" data-signal-time="${key}" aria-label="${label}"><output>${value} s</output></label>`;
export function trafficLightPanel(editor: Editor) {
  const tool = editor.signalTool,
    junction = tool.junction,
    config = tool.config;
  const heading = `<div class="panel-heading"><h2>路口红绿灯</h2><button type="button" data-action="leave-signals" class="icon-only" aria-label="关闭红绿灯工具"><i data-lucide="x" aria-hidden="true"></i></button></div>`;
  if (!junction)
    return (
      heading +
      `<p>点击地图中的路口中心，添加或调整红绿灯。</p><p class="muted">支持三岔和十字路口。按 K 或 Esc 返回。</p>`
    );
  if (!config)
    return (
      heading +
      `<p>已选中 ${junction.arms.length} 岔路口</p><button type="button" data-action="enable-signal" class="primary">${trafficLightIcon}添加红绿灯</button><p class="muted">添加后可调整配时；未添加的路口保持无灯通行。</p>`
    );
  const automatic = config.mode === "cs2";
  const modes = `<div class="signal-modes" role="group" aria-label="信号配相方式"><button data-signal-mode="cs2" aria-pressed="${automatic}">自动感应</button><button data-signal-mode="protected" aria-pressed="${config.mode === "protected"}">直行／左转分相</button><button data-signal-mode="sequential" aria-pressed="${config.mode === "sequential"}">逐进口轮放</button></div>`;
  const timing = automatic
    ? `<p class="muted signal-mode-note">根据来车选择信号组。对向车辆可以同时通行，左转车辆让行。</p>`
    : `<p class="muted signal-mode-note">${config.mode === "protected" ? "对向直行与右转同时放行，左转使用独立相位。共用转向车道可选逐进口轮放。" : "每次放行一个进口的所有转向。"}红灯禁止右转。</p>${range("green", "通行绿灯", config.green, 5, 120)}${config.mode === "protected" ? range("leftGreen", "左转绿灯", config.leftGreen, 3, 60) : ""}<details class="signal-advanced"><summary>黄灯、清空与协调</summary>${range("yellow", "黄灯", config.yellow, 1, 8)}${range("allRed", "全红清空", config.allRed, 1, 10)}${range("offset", "启动偏移", config.offset, 0, 600)}</details>`;
  return (
    heading +
    `<div class="signal-live" role="status" aria-live="off"><span class="signal-status-dot" data-signal-dot></span><strong data-signal-live>准备通行</strong><output data-signal-remaining></output></div>${modes}${timing}<ol class="signal-phases" aria-label="自动生成的信号相位" data-signal-phases></ol><p class="muted signal-clearance">${automatic ? "没有其他方向来车时保持当前通行组，有需求时经过转换阶段切换。" : "黄灯结束后先全红；路口车辆尚未驶离时延长清空。修改配时会重置测试。"}</p><button type="button" data-action="remove-signal" class="danger"><i data-lucide="trash-2" aria-hidden="true"></i>移除红绿灯</button>`
  );
}
export function updateTrafficLightPanel(editor: Editor) {
  const junction = editor.signalTool.junction;
  const state = junction && editor.simulation.trafficLights.state(junction.id);
  const live = document.querySelector<HTMLElement>("[data-signal-live]");
  if (!live || !state) return;
  live.textContent = state.clearing
    ? "等待路口清空"
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
  if (dot) dot.dataset.color = state.stage === "all-red" ? "red" : state.stage;
  const phases = document.querySelector<HTMLOListElement>(
    "[data-signal-phases]",
  );
  if (!phases) return;
  const key = `${state.id}:${state.phase}:${state.stage}:${state.phases.map((p) => p.duration).join(",")}`;
  if (phases.dataset.key !== key) {
    phases.dataset.key = key;
    phases.innerHTML = state.phases
      .map(
        (p, i) =>
          `<li${i === state.phase ? ' class="active" aria-current="step"' : ""}><span>${p.name}</span><span>${state.actuated ? "按车流" : `${p.duration} s`}</span></li>`,
      )
      .join("");
  }
}
