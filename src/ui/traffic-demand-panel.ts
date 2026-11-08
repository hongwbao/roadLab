import {
  sourceLanes,
  trafficBaseRate,
  trafficPortKey,
} from "../core/traffic-demand";
import { isSink, type Port } from "../core/types";
import type { TrafficDemandTool } from "../editor/traffic-demand-tool";
const esc = (x: string) =>
  x.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (x: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(x);
const value = (x: number) => String(Math.round(x * 100) / 100);
const closeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
function portName(tool: TrafficDemandTool, p: Port) {
  const r = tool.project.roads.find((r) => r.id === p.road);
  return `${r?.name ?? p.road} · ${p.end === "start" ? "起点" : "终点"}`;
}
export function trafficDemandPanel(tool: TrafficDemandTool) {
  const p = tool.project,
    s = tool.source,
    base = trafficBaseRate(p),
    sources = tool.sources;
  const heading = `<div class="demand-sticky-heading"><div class="panel-heading"><h2>车流测试</h2><button type="button" class="icon-only" data-demand-action="close" aria-label="关闭车流测试">${closeIcon}</button></div><p class="demand-target-hint" aria-live="polite"></p></div>`;
  const portals =
    '<p class="muted">点击地图端点添加通行口，右键取消；双向道路同时进出。</p><button type="button" data-action="auto-ports">自动识别外部通行口</button>';
  if (!sources.length)
    return heading + "<p>先在道路端点设置入口，再分配测试车流。</p>" + portals;
  const sourceIndex = sources.indexOf(s!) + 1;
  const selectors = `<div class="demand-sources" role="group" aria-label="选择车流入口">${sources.map((port, i) => `<button type="button" data-demand-source="${p.ports.indexOf(port)}" aria-pressed="${port === s}" title="${esc(portName(tool, port))}">入口${i + 1}<span>${num((port.rate / base) * 100)}%</span></button>`).join("")}</div>`;
  if (!s) return heading + selectors + portals;
  const lanes = sourceLanes(p, s).length,
    shares = tool.shares,
    exits = p.ports.filter(isSink);
  return (
    heading +
    selectors +
    `<h3 class="demand-source-name">入口${sourceIndex} · ${esc(portName(tool, s))}</h3><label class="demand-entry-control" for="demand-entry-percent">入口比例 <span><input id="demand-entry-percent" type="number" min="0" max="1000" step="any" value="${value(tool.percent)}" aria-describedby="demand-flow-total"><span>%</span></span></label><div id="demand-flow-total" class="demand-flow-summary"><strong>${num(tool.rate)} 辆/分</strong><span>${lanes}条入口车道${lanes ? ` · 每条${num(tool.rate / lanes)}辆/分` : ""}</span></div><p class="muted demand-formula">全局${num((p.trafficMultiplier ?? 1) * 100)}% × 入口${num(tool.percent)}% × 基准${num(base)}</p><div class="panel-heading demand-distribution-heading"><h3>出口分配</h3><button type="button" data-demand-action="equal"${s.destinations ? "" : " disabled"}>均分出口</button></div>${
      shares.length
        ? `<p class="muted">修改一个出口，其余出口按原比例分配剩余车流。</p><ul class="demand-destinations">${shares
            .map((d) => {
              const index = p.ports.indexOf(d.port),
                label = `出口${exits.indexOf(d.port) + 1}`;
              return `<li data-demand-target="${index}"><button type="button" class="demand-target-name" data-demand-view="${index}" title="在地图上标出${esc(label)}"><strong>${label}</strong><span>${esc(portName(tool, d.port))}</span></button><label class="demand-share-field"><input id="demand-share-${index}" type="number" min="0" max="100" step="any" value="${value(d.percent)}" data-demand-share="${index}" aria-label="到${label}的车流比例"><span>%</span></label><output>${num((tool.rate * d.percent) / 100)} 辆/分</output></li>`;
            })
            .join("")}</ul>`
        : '<p class="muted">还没有其他出口。请在道路另一端添加通行口。</p>'
    }<p class="muted demand-live-note">出车总量平分到入口车道，各车道随机分配目的地。运行中可调整，已规划车辆保留原路线。</p><details class="demand-base"><summary>100%基准：${num(base)} 辆/分钟</summary><label for="demand-base-rate">每个入口的总量 <span><input id="demand-base-rate" type="number" min="1" max="240" value="${value(base)}">辆/分</span></label><p class="muted">改变基准会保留各入口百分比。50是测试基准，实际出车仍受道路空间限制。</p></details><details class="demand-port-tools"><summary>添加与取消通行口</summary>${portals}</details>`
  );
}
export function bindTrafficDemandPanel(
  tool: TrafficDemandTool,
  panel: HTMLElement,
) {
  let previous = "";
  const visual = () => {
    for (const row of panel.querySelectorAll<HTMLElement>(
      "[data-demand-target]",
    )) {
      const p = tool.project.ports[Number(row.dataset.demandTarget)],
        active =
          !!p &&
          !!tool.target &&
          trafficPortKey(p) === trafficPortKey(tool.target);
      row.classList.toggle("active", active);
      row.querySelector("button")?.setAttribute("aria-current", String(active));
    }
    const hint = panel.querySelector(".demand-target-hint");
    if (hint) {
      const source = tool.source ? tool.sources.indexOf(tool.source) + 1 : 0,
        target =
          tool.project.ports
            .filter(isSink)
            .findIndex(
              (p) =>
                tool.target &&
                trafficPortKey(p) === trafficPortKey(tool.target),
            ) + 1;
      hint.textContent = target
        ? `地图虚线：入口${source} → 出口${target}`
        : "";
    }
  };
  tool.onVisualChange = visual;
  const update = () => {
    const html = trafficDemandPanel(tool);
    if (html !== previous) {
      previous = html;
      const focused = panel.contains(document.activeElement)
          ? (document.activeElement as HTMLElement).id
          : "",
        scroll = panel.scrollTop;
      const open = [
        ...panel.querySelectorAll<HTMLDetailsElement>("details[open]"),
      ].map((d) => d.className);
      panel.innerHTML = html;
      for (const d of panel.querySelectorAll<HTMLDetailsElement>("details"))
        if (open.includes(d.className)) d.open = true;
      if (focused)
        panel
          .querySelector<HTMLElement>(`#${CSS.escape(focused)}`)
          ?.focus({ preventScroll: true });
      panel.scrollTop = scroll;
    }
    visual();
  };
  panel.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    if (target.dataset.demandSource !== undefined)
      tool.choose(Number(target.dataset.demandSource));
    if (target.dataset.demandView !== undefined)
      tool.chooseTarget(Number(target.dataset.demandView));
    if (target.dataset.demandAction === "equal") tool.reset();
    if (target.dataset.demandAction === "close") tool.close();
  });
  panel.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement,
      n = input.value === "" ? NaN : Number(input.value);
    if (input.id === "demand-entry-percent") tool.setPercent(n);
    else if (input.dataset.demandShare !== undefined)
      tool.setShare(Number(input.dataset.demandShare), n);
    else if (input.id === "demand-base-rate") tool.setBase(n);
    previous = "";
    update();
  });
  const highlight = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>(
      "[data-demand-target]",
    );
    if (target) tool.chooseTarget(Number(target.dataset.demandTarget));
  };
  panel.addEventListener("pointerover", highlight);
  panel.addEventListener("focusin", highlight);
  return update;
}
