import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  Copy,
  createIcons,
  Download,
  FlipHorizontal,
  Focus,
  FolderOpen,
  Grid2x2,
  HelpCircle,
  Layers,
  LogIn,
  Magnet,
  Menu,
  MousePointer2,
  MoveRight,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Route,
  Save,
  SlidersHorizontal,
  Spline,
  Trash2,
  Undo2,
  Wrench,
  X,
} from "lucide";
import {
  assetForRoad,
  getAsset,
  ROAD_ASSETS,
  type RoadAsset,
} from "./core/assets";
import { point, roadLength } from "./core/math";
import { emptyProject, example, parseProject } from "./core/model";
import { copy, isSource, type Project, type Tool } from "./core/types";
import { Editor } from "./editor/editor";
import "./style.css";
const iconSet = {
  Route,
  MousePointer2,
  MoveRight,
  Spline,
  Trash2,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  Download,
  Play,
  Pause,
  RotateCcw,
  Focus,
  Layers,
  HelpCircle,
  Copy,
  RotateCw,
  FlipHorizontal,
  Plus,
  X,
  Check,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
  Magnet,
  Grid2x2,
  Menu,
  LogIn,
  SlidersHorizontal,
  Wrench,
};
const esc = (x: unknown) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (name: string) =>
  `<i data-lucide="${name}" aria-hidden="true"></i>`;
const button = (action: string, label: string, glyph: string, classes = "") =>
  `<button type="button" data-action="${action}" title="${label}" aria-label="${label}" class="${classes}">${icon(glyph)}<span>${label}</span></button>`;
function thumbnail(asset: RoadAsset) {
  const o = asset.options,
    total = (o.lanesEnd ?? 1) * (o.twoWay ? 2 : 1),
    height = Math.min(38, total * 6 + 6),
    y = (52 - height) / 2;
  if (asset.action)
    return `<svg viewBox="0 0 120 52" aria-hidden="true"><path d="M0 22H63L120 13M63 22C85 22 85 43 120 43" stroke="#222e35" stroke-width="17" fill="none"/><path d="M0 22H63L120 13M63 22C85 22 85 43 120 43" stroke="#c5d3d8" stroke-width="1" stroke-dasharray="5 4" fill="none"/><path d="M44 19L49 22L44 25" fill="none" stroke="#e8f5f8" stroke-width="1.6"/></svg>`;
  const start = (o.lanesStart ?? 1) * (o.twoWay ? 2 : 1),
    hy = Math.min(38, start * 6 + 6),
    shape = `M0 ${(52 - hy) / 2} C45 ${(52 - hy) / 2} 75 ${y} 120 ${y}V${y + height}C75 ${y + height} 45 ${(52 + hy) / 2} 0 ${(52 + hy) / 2}Z`;
  let lines = "";
  for (let i = 1; i < total; i++) {
    const cy = y + 3 + (i * (height - 6)) / total;
    lines += `<path d="M0 ${cy}H120" stroke="${o.twoWay && i === total / 2 ? "#dfc17b" : "#d0dbdd"}" stroke-width="${o.twoWay && i === total / 2 ? 1.4 : 0.8}" ${o.twoWay && i === total / 2 ? "" : 'stroke-dasharray="5 5"'}/>`;
  }
  for (let i = 0; i < total; i++) {
    const cy = y + 3 + ((i + 0.5) * (height - 6)) / total,
      dir = o.twoWay && i < total / 2 ? -1 : 1;
    lines += `<path d="M${58 - dir * 5} ${cy}H${58 + dir * 5}M${58 + dir * 2} ${cy - 2}L${58 + dir * 5} ${cy}L${58 + dir * 2} ${cy + 2}" fill="none" stroke="#dce9eb" stroke-width="1"/>`;
  }
  return `<svg viewBox="0 0 120 52" aria-hidden="true"><path d="${shape}" fill="#253139" stroke="#72868e" stroke-width="1"/>${lines}</svg>`;
}
document.querySelector("#app")!.innerHTML = `
 <main class="game-workspace"><div id="viewport" tabindex="0" aria-label="道路地图"></div>
 <header class="game-header"><div class="project-brand">${icon("route")}<strong>路网工坊</strong></div><input id="project-name" aria-label="项目名称" maxlength="120"><span id="save-state" role="status">已保存</span><div class="header-actions">${button("undo", "撤销", "undo-2", "icon-only")}${button("redo", "重做", "redo-2", "icon-only")}${button("menu", "地图菜单", "menu", "icon-only")}${button("help", "操作帮助", "help-circle", "icon-only")}</div></header>
 <section id="map-menu" class="floating-panel map-menu" hidden><h2>地图</h2><div class="menu-grid">${button("save", "保存地图", "save")}${button("export", "导出地图", "download")}${button("import", "导入地图", "folder-open")}${button("new", "空白地图", "plus")}${button("example-transition", "立交过渡示例", "route")}${button("example-junction", "城市路口示例", "grid-2x2")}${button("example-elevated", "高架交叉示例", "layers")}${button("templates", "我的路网模板", "copy")}</div></section>
 <div class="view-controls">${button("top", "俯视", "arrow-down-to-line")}${button("perspective", "立体", "layers")}${button("fit", "查看全图", "focus")}${button("grid", "网格", "grid-2x2", "icon-only")}${button("focus-transition", "查看过渡段", "spline", "icon-only")}</div>
 <div class="map-title"><strong id="scene-name">道路实验</strong><span id="scene-summary"></span></div>
 <div id="snap-feedback" class="snap-feedback" hidden></div><div id="selection-box" hidden></div><div id="empty-hint" hidden>选择下方的道路资产，开始建造。</div>
 <aside id="selection-panel" class="floating-panel selection-panel" hidden></aside>
 <aside id="boundary-panel" class="floating-panel boundary-panel" hidden><h2>路网通行口</h2><p>点击道路端点设置通行口。双向道路在同一端点同时进出，单向道路按方向自动判断。</p>${button("auto-ports", "自动识别外部通行口", "log-in")}<p class="muted">右键点击通行口，即可取消。</p></aside>
 <aside id="templates-panel" class="floating-panel templates-panel" hidden><div class="panel-heading"><h2>路网模板</h2>${button("close-templates", "关闭", "x", "icon-only")}</div><div id="template-list"></div></aside>
 <div class="tool-rail" role="toolbar" aria-label="地图工具"><button data-tool="select" title="选择道路 V" aria-label="选择道路 V">${icon("mouse-pointer-2")}</button><button data-action="roads" title="道路资产" aria-label="道路资产">${icon("route")}</button><button data-tool="boundary" title="路网通行口 I" aria-label="路网通行口 I">${icon("log-in")}</button><button data-tool="delete" title="拆除道路 B" aria-label="拆除道路 B">${icon("trash-2")}</button></div>
 <section id="road-dock" class="road-dock" aria-label="道路资产栏"><div class="dock-heading"><nav class="asset-categories" aria-label="道路分类"><button data-category="city">城市道路</button><button data-category="oneway">单向道路</button><button data-category="highway">高速与匝道</button><button data-category="transition">车道过渡</button></nav>${button("close-roads", "收起道路资产", "x", "icon-only")}</div><div id="asset-list" class="asset-list"></div><div class="construction-tools"><div class="build-modes" role="toolbar" aria-label="道路建造方式"><button data-tool="line" title="直线 L" aria-label="直线 L">${icon("move-right")}<span>直线</span></button><button data-tool="curve" title="曲线 C" aria-label="曲线 C">${icon("spline")}<span>曲线</span></button><button data-tool="upgrade" title="升级道路 U" aria-label="升级道路 U">${icon("wrench")}<span>升级</span></button></div><div class="build-height">${button("height-down", "降低道路 PageDown", "arrow-down", "icon-only")}<span id="build-height-label">地面</span>${button("height-up", "抬高道路 PageUp", "arrow-up", "icon-only")}</div><button id="snap-toggle" data-action="snap" title="道路吸附" aria-pressed="true">${icon("magnet")}<span>吸附</span></button><button data-action="alignment" id="alignment-mode" title="单向道路接口对齐：自动、中线、左缘、右缘；地图中按 Tab 切换">对齐：自动</button><span id="asset-description"></span></div></section>
 <div class="map-status"><span id="tool-hint">选择道路资产开始建造。</span><span id="mode-badge">选择</span></div></main>
 <footer class="simulation-bar"><div class="simulation-actions">${button("play", "开始测试", "play", "primary")}${button("reset-sim", "重置测试", "rotate-ccw", "icon-only")}<div class="speed-buttons" aria-label="模拟速度"><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button></div></div><div class="traffic-control"><div class="traffic-heading"><label for="traffic-range">车流量</label><output id="traffic-total" aria-live="off">目标 24 辆/分</output></div><div class="traffic-inputs"><input id="traffic-range" type="range" min="0" max="400" step="1" value="100" aria-label="车流强度"><label class="traffic-percentage"><input id="traffic-level" type="number" min="0" max="400" step="1" value="100" aria-label="车流百分比"><span>%</span></label></div></div><div class="sim-stat"><span>在途</span><strong id="stat-active">0</strong></div><div class="sim-stat"><span>已通过</span><strong id="stat-completed">0</strong></div><div class="sim-stat"><span>排队</span><strong id="stat-queued">0</strong></div><div class="sim-stat average-stat"><span>平均通行</span><strong id="stat-average">—</strong></div><span id="sim-note">基础车流</span><button data-tool="boundary" class="footer-ports">${icon("log-in")}设置通行口</button></footer>
 <input id="import-file" type="file" accept=".json,application/json" hidden><div id="toast" role="status" hidden></div>
 <dialog id="confirm-dialog"><h2>载入其他地图？</h2><p>当前路网会被替换，可以撤销或先导出备份。</p><div class="dialog-actions"><button data-action="cancel-dialog">取消</button><button id="confirm-yes" class="primary">确认载入</button></div></dialog>
 <dialog id="help-dialog"><div class="panel-heading"><h2>道路建造</h2>${button("close-help", "关闭", "x", "icon-only")}</div><ol><li>在下方选择道路资产，鼠标会立即显示蓝色道路预览。</li><li>直线依次点击起点、终点；曲线再增加一个弯曲控制位置。</li><li>靠近道路端点或路段时会吸附，显示圆环和文字。单向接口支持左右路缘偏移对齐；在地图中按 Tab 切换。交叉处自动生成路口。</li><li>按 B 切换拆除，悬停预览，左键删除；右键或 Esc 退出。</li><li>按 I 设置通行口，双向道路同时进出；右键取消通行口。</li></ol><dl><dt>中键拖动 / Alt＋中键 / 滚轮</dt><dd>平移 / 旋转 / 缩放</dd><dt>L / C / U / V</dt><dd>直线 / 曲线 / 升级 / 选择</dd><dt>PageUp / PageDown</dt><dd>抬高 / 降低道路</dd><dt>Ctrl Z / Ctrl Shift Z / Ctrl S</dt><dd>撤销 / 重做 / 保存</dd><dt>Shift＋拖动空白</dt><dd>框选道路</dd><dt>右键 / Esc / Space</dt><dd>取消当前建造 / 退出工具 / 测试暂停</dd></dl></dialog>`;
const editor = new Editor(document.querySelector("#viewport")!);
let category: RoadAsset["category"] = "city",
  dockOpen = true,
  menuOpen = false,
  toastTimer: ReturnType<typeof setTimeout>,
  pendingConfirm: (() => void) | undefined,
  trafficBefore: Project | undefined;
const icons = () =>
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.8 } });
function renderAssets() {
  document.querySelector("#asset-list")!.innerHTML = ROAD_ASSETS.filter(
    (a) => a.category === category,
  )
    .map(
      (a) =>
        `<button class="road-asset ${a.id === editor.assetId && (editor.building || editor.tool === "upgrade") ? "selected" : ""}" data-asset="${a.id}" aria-label="${a.name}" aria-pressed="${a.id === editor.assetId && (editor.building || editor.tool === "upgrade")}" title="${a.description}">${thumbnail(a)}<strong>${a.name}</strong></button>`,
    )
    .join("");
  document.querySelectorAll<HTMLElement>("[data-category]").forEach((b) => {
    b.classList.toggle("active", b.dataset.category === category);
    b.setAttribute("aria-pressed", String(b.dataset.category === category));
  });
}
function selectedPanel() {
  const r = editor.active;
  if (!r) return "";
  const asset = assetForRoad(r),
    ports = editor.project.ports.filter((p) => p.road === r.id);
  return `<div class="panel-heading"><h2>${esc(asset?.name || r.name)}</h2>${button("deselect", "关闭", "x", "icon-only")}</div><div class="road-information"><span>${roadLength(r).toFixed(0)} m</span><span>${r.speed} km/h</span><span>${point(r, 0).y.toFixed(0)} → ${point(r, 1).y.toFixed(0)} m</span></div><p class="muted">拖动端点和曲线柄调整道路。${editor.selected.size > 1 ? `已选择 ${editor.selected.size} 段道路。` : ""}</p><div class="selection-actions">${button("duplicate", "复制", "copy")}${!r.twoWay ? button("reverse", "反向", "rotate-ccw") : ""}${button("delete", "拆除", "trash-2", "danger")}</div><details><summary>更多操作</summary><div class="selection-actions">${button("rotate", "旋转", "rotate-cw")}${button("mirror", "镜像", "flip-horizontal")}${button("add-knot", "增加控制点", "plus")}${button("template", "保存模板", "copy")}</div></details>${ports.length ? `<div class="port-settings"><h3>通行口基准流量</h3>${ports.map((p) => `<div class="port-row"><span>${p.end === "start" ? "起点" : "终点"} · ${p.type === "both" ? "双向进出" : p.type === "source" ? "入口" : "出口"}</span>${isSource(p) ? `<label><input type="number" min="0" max="240" value="${p.rate}" data-port="${editor.project.ports.indexOf(p)}" aria-label="入口基准流量"><span>辆/分</span></label>` : ""}<button data-remove-port="${editor.project.ports.indexOf(p)}" class="icon-only" title="取消通行口">${icon("x")}</button></div>`).join("")}<p class="muted">运行中调整流量会保留现有车辆。</p></div>` : ""}`;
}
function syncTraffic(inputs = true) {
  const m = editor.project.trafficMultiplier ?? 1;
  if (inputs) {
    document.querySelector<HTMLInputElement>("#traffic-range")!.value = String(
      m * 100,
    );
    document.querySelector<HTMLInputElement>("#traffic-level")!.value = String(
      Math.round(m * 100),
    );
  }
  const total = editor.project.ports
      .filter(isSource)
      .reduce((s, p) => s + p.rate * m, 0),
    waiting = editor.simulation.waiting,
    text = `目标 ${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(total)} 辆/分${waiting ? ` · 待进入 ${waiting}` : ""}`;
  const out = document.querySelector("#traffic-total")!;
  if (out.textContent !== text) out.textContent = text;
}
function render() {
  const name = document.querySelector<HTMLInputElement>("#project-name")!;
  if (document.activeElement !== name) name.value = editor.project.name;
  document.querySelector("#scene-name")!.textContent = editor.project.name;
  document.querySelector("#scene-summary")!.textContent =
    `${editor.project.roads.length} 段道路 · ${editor.simulation.junctions.filter((j) => j.arms.length >= 3).length} 处路口`;
  document.querySelector<HTMLElement>("#road-dock")!.hidden =
    !dockOpen || editor.tool === "boundary" || editor.tool === "delete";
  document.querySelector<HTMLElement>("#map-menu")!.hidden = !menuOpen;
  document.querySelector<HTMLElement>("#empty-hint")!.hidden =
    !!editor.project.roads.length || editor.building;
  document.querySelector<HTMLElement>("#boundary-panel")!.hidden =
    editor.tool !== "boundary";
  const selection = document.querySelector<HTMLElement>("#selection-panel")!;
  selection.hidden = !editor.active || editor.tool !== "select";
  selection.innerHTML = selection.hidden ? "" : selectedPanel();
  renderAssets();
  document.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === editor.tool);
    b.setAttribute("aria-pressed", String(b.dataset.tool === editor.tool));
  });
  document.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled =
    !editor.history.canUndo;
  document.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled =
    !editor.history.canRedo;
  const play = document.querySelector<HTMLButtonElement>(
    '[data-action="play"]',
  )!;
  play.innerHTML = `${icon(editor.simulation.running ? "pause" : "play")}<span>${editor.simulation.running ? "暂停测试" : "开始测试"}</span>`;
  const alignment =
    document.querySelector<HTMLButtonElement>("#alignment-mode")!;
  alignment.hidden = editor.draw.twoWay;
  alignment.textContent = `对齐：${{ auto: "自动", center: "中线", left: "左缘", right: "右缘" }[editor.alignment]}`;
  document.querySelector("#build-height-label")!.textContent =
    editor.draw.endHeight === 0 ? "地面" : `${editor.draw.endHeight} m`;
  document.querySelector("#asset-description")!.textContent = getAsset(
    editor.assetId,
  ).description;
  document.querySelector("#mode-badge")!.textContent = (
    {
      select: "选择",
      line: "道路建造",
      curve: "曲线建造",
      upgrade: "道路升级",
      delete: "拆除 B",
      boundary: "设置通行口",
    } as const
  )[editor.tool];
  document.querySelector("#mode-badge")!.className =
    editor.tool === "delete" ? "demolition" : "";
  document.querySelector("#tool-hint")!.textContent = editor.instructions();
  document
    .querySelector("#snap-toggle")!
    .setAttribute("aria-pressed", String(editor.settings.snap));
  document.querySelector("#template-list")!.innerHTML =
    editor.project.templates
      .map(
        (t) =>
          `<button data-template="${esc(t.id)}">${icon("copy")}<span>${esc(t.name)} · ${t.roads.length} 段道路</span></button>`,
      )
      .join("") ||
    '<p class="muted">框选一组道路，在道路信息中保存为模板。</p>';
  syncTraffic();
  icons();
}
editor.onChange = render;
editor.onStatus = (s) =>
  (document.querySelector("#tool-hint")!.textContent = s);
editor.onToast = (s) => {
  const toast = document.querySelector<HTMLElement>("#toast")!;
  toast.textContent = s;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 3200);
};
editor.refresh();
function confirmLoad(fn: () => void) {
  pendingConfirm = fn;
  document.querySelector<HTMLDialogElement>("#confirm-dialog")!.showModal();
}
document.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!target) return;
  if (target.dataset.asset) {
    editor.chooseAsset(target.dataset.asset);
    dockOpen = true;
    render();
    return;
  }
  if (target.dataset.category) {
    category = target.dataset.category as RoadAsset["category"];
    renderAssets();
    icons();
    return;
  }
  if (target.dataset.tool) {
    const tool = target.dataset.tool as Tool;
    editor.setTool(
      tool === "delete" && editor.tool === "delete" ? "select" : tool,
    );
    if (tool === "boundary") dockOpen = false;
    if (tool === "line" || tool === "curve" || tool === "upgrade")
      dockOpen = true;
    render();
    return;
  }
  if (target.dataset.speed) {
    editor.simulation.speed = Number(target.dataset.speed);
    document
      .querySelectorAll<HTMLElement>("[data-speed]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.speed === target.dataset.speed),
      );
    return;
  }
  if (target.dataset.template) {
    editor.loadTemplate(target.dataset.template);
    return;
  }
  if (target.dataset.removePort !== undefined) {
    const p = editor.project.ports[Number(target.dataset.removePort)];
    editor.edit(
      () =>
        (editor.project.ports = editor.project.ports.filter((x) => x !== p)),
      "已取消通行口",
    );
    return;
  }
  const action = target.dataset.action;
  if (!action) return;
  if (action === "menu") {
    menuOpen = !menuOpen;
    render();
    return;
  }
  if (action === "roads") {
    if (editor.tool === "boundary" || editor.tool === "delete") {
      dockOpen = true;
      editor.setTool("select");
    } else dockOpen = !dockOpen;
    render();
    return;
  }
  if (action === "close-roads") {
    dockOpen = false;
    editor.setTool("select");
    render();
    return;
  }
  if (action === "alignment") {
    editor.cycleAlignment();
    return;
  }
  if (action === "snap") {
    editor.settings.snap = !editor.settings.snap;
    render();
    return;
  }
  if (action === "grid") {
    editor.settings.grid = !editor.settings.grid;
    editor.refresh();
    return;
  }
  if (action === "deselect") {
    editor.selected.clear();
    editor.refresh();
    return;
  }
  if (action === "new" || action.startsWith("example-")) {
    confirmLoad(() => {
      const kind = action.replace("example-", "");
      editor.load(action === "new" ? emptyProject() : example(kind));
      menuOpen = false;
      render();
    });
    return;
  }
  if (action === "help") {
    document.querySelector<HTMLDialogElement>("#help-dialog")!.showModal();
    return;
  }
  if (action === "close-help") {
    document.querySelector<HTMLDialogElement>("#help-dialog")!.close();
    return;
  }
  if (action === "cancel-dialog") {
    document.querySelector<HTMLDialogElement>("#confirm-dialog")!.close();
    return;
  }
  if (action === "templates" || action === "close-templates") {
    document.querySelector<HTMLElement>("#templates-panel")!.hidden =
      action === "close-templates";
    menuOpen = false;
    render();
    return;
  }
  editor.action(action);
});
document.querySelector("#confirm-yes")!.addEventListener("click", () => {
  document.querySelector<HTMLDialogElement>("#confirm-dialog")!.close();
  pendingConfirm?.();
  pendingConfirm = undefined;
});
document
  .querySelector("#project-name")!
  .addEventListener("change", (e) =>
    editor.edit(
      () =>
        (editor.project.name =
          (e.target as HTMLInputElement).value.trim() || "未命名路网"),
    ),
  );
document
  .querySelector("#import-file")!
  .addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("地图文件超过 8 MB。");
      const p = parseProject(await file.text());
      confirmLoad(() => editor.load(p));
    } catch (error) {
      editor.onToast((error as Error).message);
    }
    input.value = "";
  });
document.querySelector("#selection-panel")!.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.port !== undefined)
    editor.setPortRate(Number(input.dataset.port), Number(input.value));
});
function previewTraffic(percent: number) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 400) return false;
  if (percent === (editor.project.trafficMultiplier ?? 1) * 100) return true;
  trafficBefore ??= copy(editor.project);
  editor.project.trafficMultiplier = percent / 100;
  editor.queueSave();
  syncTraffic();
  return true;
}
function commitTraffic() {
  if (!trafficBefore) return;
  editor.history.commit(trafficBefore);
  trafficBefore = undefined;
  editor.onChange();
}
document
  .querySelector("#traffic-range")!
  .addEventListener("input", (e) =>
    previewTraffic(Number((e.target as HTMLInputElement).value)),
  );
document
  .querySelector("#traffic-range")!
  .addEventListener("change", commitTraffic);
document.querySelector("#traffic-level")!.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.value === "" || !previewTraffic(Number(input.value))) {
    editor.onToast("车流强度为 0–400%。");
    syncTraffic();
    return;
  }
  commitTraffic();
});
let last = performance.now(),
  lastStats = 0;
function frame(now: number) {
  editor.simulation.update((now - last) / 1000);
  last = now;
  editor.scene.updateCars(editor.simulation.vehicles);
  editor.scene.render();
  if (now - lastStats > 250) {
    lastStats = now;
    const sim = editor.simulation;
    document.querySelector("#stat-active")!.textContent = String(
      sim.vehicles.length,
    );
    document.querySelector("#stat-completed")!.textContent = String(
      sim.completed,
    );
    document.querySelector("#stat-queued")!.textContent = String(sim.queued);
    document.querySelector("#stat-average")!.textContent = sim.completed
      ? `${sim.average.toFixed(1)} s`
      : "—";
    document.querySelector("#sim-note")!.textContent =
      `${sim.routeCount} 条可达路径`;
    syncTraffic(false);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
Object.assign(window, {
  lab: {
    editor,
    getState: () => editor.exportDebug(),
    worldToScreen: (p: { x: number; y: number; z: number }) =>
      editor.scene.project(p),
  },
});
window.addEventListener("beforeunload", () => editor.save());
