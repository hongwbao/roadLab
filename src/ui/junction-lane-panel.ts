import type { JunctionLaneTool } from "../editor/junction-lane-tool";

const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const closeIcon = svg('<path d="m6 6 12 12M18 6 6 18"/>');
const trashIcon = svg(
  '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
);
const resetIcon = svg('<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>');
const bound = new WeakSet<HTMLElement>(),
  keyboardOpen = new WeakMap<JunctionLaneTool, boolean>();
export function junctionLanePanel(tool: JunctionLaneTool) {
  const heading = `<div class="panel-heading"><h2>路口车道连线</h2><button type="button" class="icon-only" data-junction-lane-action="leave" aria-label="关闭车道连线工具">${closeIcon}</button></div>`;
  const junction = tool.junction;
  if (!junction)
    return (
      heading +
      `<p>点击路口或偏移吸附接头，显示车道连接点。分流、汇流和偏移接入都可编辑。</p><p class="muted">再点入车道和出车道圆点，添加或取消连线。按 J 或 Esc 返回。</p>`
    );
  const source = tool.source,
    links = tool.destinations,
    candidates =
      tool.layout?.candidates.filter((link) => link.from.key === source?.key) ??
      [],
    active = new Set(links.map((link) => link.to.key));
  const legend = `<div class="junction-lane-legend"><span><i class="lane-port-in" aria-hidden="true"></i>入车道</span><span><i class="lane-port-out" aria-hidden="true"></i>出车道</span><span class="muted">点两个圆点连线</span></div>`;
  const selection = source
    ? `<div class="junction-lane-selection" role="status"><strong>${esc(source.name)}</strong><span class="muted">${tool.rule ? "自定义连接" : "自动连接"} · ${links.length} 个出口</span></div><p class="muted">点击出车道：添加或取消连接。右键连线可直接移除。</p>${tool.rule && links.length === 0 ? '<p class="junction-lane-closed" role="status">此入车道已禁止全部出口。</p>' : ""}<ul class="junction-lane-destinations">${links.map((link) => `<li><span>${esc(link.to.name)}</span><button type="button" class="icon-only" data-junction-lane-action="remove-link" data-junction-lane-link="${esc(link.id)}" aria-label="移除到${esc(link.to.name)}的连线">${trashIcon}</button></li>`).join("")}</ul><div class="junction-lane-actions"><button type="button" data-junction-lane-action="restore-lane"${tool.rule ? "" : " disabled"}>${resetIcon}此车道恢复自动</button><button type="button" data-junction-lane-action="ban-lane"${tool.rule && links.length === 0 ? " disabled" : ""}>禁止全部出口</button></div>`
    : `<p>已选${junction.kind === "attachment" ? `偏移连接路口（${junction.arms.length} 条道路）` : ` ${junction.arms.length} 岔路口`}。点击一个实心入车道圆点，选择要编辑的车道。</p><p class="muted">青色曲线是当前可通行路线；空心圆点是可连接的出车道。</p>`;
  const keyboard = `<details class="junction-lane-keyboard" data-junction-lane-keyboard${keyboardOpen.get(tool) ? " open" : ""}><summary>按名称选择车道</summary><div class="junction-lane-source-buttons" role="group" aria-label="选择入车道">${tool.ports
    .filter((port) => port.kind === "in")
    .map(
      (port) =>
        `<button type="button" id="junction-lane-source-${esc(port.key)}" data-junction-lane-action="choose-source" data-junction-lane-key="${esc(port.key)}" aria-pressed="${port.key === source?.key}">${esc(port.name)}</button>`,
    )
    .join(
      "",
    )}</div>${source ? `<div class="junction-lane-target-buttons" role="group" aria-label="允许到达的出车道">${candidates.map((link) => `<button type="button" id="junction-lane-target-${esc(link.to.key)}" data-junction-lane-action="toggle-target" data-junction-lane-key="${esc(link.to.key)}" aria-pressed="${active.has(link.to.key)}">${esc(link.to.name)}${active.has(link.to.key) ? " · 已连接" : ""}</button>`).join("")}</div>` : ""}</details>`;
  const line = tool.selectedLink
    ? `<button type="button" class="danger" data-junction-lane-action="delete-selected">${trashIcon}删除选中的连线</button>`
    : "";
  return (
    heading +
    legend +
    selection +
    line +
    keyboard +
    `<button type="button" data-junction-lane-action="restore-junction">${resetIcon}整个路口恢复自动</button><p class="muted junction-lane-footnote">修改会保存到地图，并重置交通测试。右键空白取消当前选择。</p>`
  );
}
/** Install once on the stable panel; its children may be rebuilt after edits. */
export function bindJunctionLanePanel(
  tool: JunctionLaneTool,
  panel: HTMLElement,
) {
  if (bound.has(panel)) return;
  bound.add(panel);
  panel.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>(
      "[data-junction-lane-action]",
    );
    if (!target || target.disabled) return;
    const focusedId = target.id;
    const scrollTop = panel.scrollTop;
    const action = target.dataset.junctionLaneAction;
    if (action === "leave") tool.close();
    else if (action === "restore-lane") tool.restoreLane();
    else if (action === "ban-lane") tool.banLane();
    else if (action === "restore-junction") tool.restoreJunction();
    else if (action === "delete-selected") tool.deleteSelected();
    else if (action === "remove-link")
      tool.removeConnection(target.dataset.junctionLaneLink!);
    else if (action === "choose-source")
      tool.chooseSource(target.dataset.junctionLaneKey!);
    else if (action === "toggle-target")
      tool.toggleTarget(target.dataset.junctionLaneKey!);
    if (focusedId)
      panel
        .querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`)
        ?.focus({ preventScroll: true });
    panel.scrollTop = scrollTop;
  });
  panel.addEventListener(
    "toggle",
    (event) => {
      const target = event.target as HTMLDetailsElement;
      if (target.matches("[data-junction-lane-keyboard]"))
        keyboardOpen.set(tool, target.open);
    },
    true,
  );
}
