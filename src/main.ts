import {
  CornerUpLeft,
  CornerUpRight,
  Minus,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  Copy,
  createIcons,
  Download,
  Upload,
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
import {
  deleteNamedMap,
  listSavedMaps,
  loadNamedMap,
  saveNamedMap,
} from "./core/saved-maps";
import { sharedRoadMap } from "./core/shared-map";
import { copy, isSource, type Project, type Tool } from "./core/types";
import { Editor } from "./editor/editor";
import {
  trafficLightIcon,
  trafficLightPanel,
  updateTrafficLightPanel,
  bindTrafficLightPanel,
} from "./ui/traffic-light-panel";
import {
  junctionLanePanel,
  bindJunctionLanePanel,
} from "./ui/junction-lane-panel";
import "./style.css";
const iconSet = {
  Route,
  CornerUpLeft,
  CornerUpRight,
  Minus,
  MousePointer2,
  MoveRight,
  Spline,
  Trash2,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  Download,
  Upload,
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
    total =
      (o.lanesEnd ?? 1) +
      (o.twoWay ? (o.backwardLanesEnd ?? o.lanesEnd ?? 1) : 0),
    height = Math.min(38, total * 6 + 6),
    y = (52 - height) / 2;
  if (asset.action)
    return `<svg viewBox="0 0 120 52" aria-hidden="true"><path d="M0 22H63L120 13M63 22C85 22 85 43 120 43" stroke="#222e35" stroke-width="17" fill="none"/><path d="M0 22H63L120 13M63 22C85 22 85 43 120 43" stroke="#c5d3d8" stroke-width="1" stroke-dasharray="5 4" fill="none"/></svg>`;
  const start =
      (o.lanesStart ?? 1) +
      (o.twoWay ? (o.backwardLanesStart ?? o.lanesStart ?? 1) : 0),
    hy = Math.min(38, start * 6 + 6),
    shape = `M0 ${(52 - hy) / 2} C45 ${(52 - hy) / 2} 75 ${y} 120 ${y}V${y + height}C75 ${y + height} 45 ${(52 + hy) / 2} 0 ${(52 + hy) / 2}Z`;
  let lines = "";
  for (let i = 1; i < total; i++) {
    const cy = y + 3 + (i * (height - 6)) / total;
    lines += `<path d="M0 ${cy}H120" stroke="${o.twoWay && i === (o.backwardLanesEnd ?? o.lanesEnd ?? 1) ? "#dfc17b" : "#d0dbdd"}" stroke-width="${o.twoWay && i === (o.backwardLanesEnd ?? o.lanesEnd ?? 1) ? 1.4 : 0.8}" ${o.twoWay && i === (o.backwardLanesEnd ?? o.lanesEnd ?? 1) ? "" : 'stroke-dasharray="5 5"'}/>`;
  }
  return `<svg viewBox="0 0 120 52" aria-hidden="true"><path d="${shape}" fill="#253139" stroke="#72868e" stroke-width="1"/>${lines}</svg>`;
}
document.querySelector("#app")!.innerHTML = `
 <main class="game-workspace"><div id="viewport" tabindex="0" aria-label="道路地图"></div>
 <header class="game-header"><div class="project-brand">${icon("route")}<strong>路网工坊</strong></div><input id="project-name" aria-label="项目名称" maxlength="120"><span id="save-state" role="status">已保存</span><div class="header-actions">${button("undo", "撤销", "undo-2", "icon-only")}${button("redo", "重做", "redo-2", "icon-only")}${button("menu", "地图菜单", "menu", "icon-only")}${button("help", "操作帮助", "help-circle", "icon-only")}</div></header>
 <section id="map-menu" class="floating-panel map-menu" hidden><div class="panel-heading"><h2>地图</h2><span class="map-menu-note">当前进度自动保存</span></div><div class="menu-grid">${button("new", "重置为空白地图", "rotate-ccw")}${button("example-shared", "载入测试地图", "route")}${button("example-transition", "立交过渡示例", "route")}${button("example-junction", "城市路口示例", "grid-2x2")}${button("example-elevated", "苜蓿叶立交示例", "layers")}${button("templates", "我的路网模板", "copy")}</div><section class="map-saves"><div class="panel-heading"><h3>本机存档</h3><span id="save-count"></span></div><form id="save-form"><label for="save-name" class="visually-hidden">存档名称</label><input id="save-name" name="name" maxlength="80" autocomplete="off" placeholder="给存档起个名字" required><button id="save-submit" type="submit" class="primary">${icon("save")}<span>保存新存档</span></button></form><div id="save-list" class="save-list"></div><p class="muted">存档保存在当前浏览器；打开此地址可随时载入。</p></section><details class="map-files"><summary>导入与备份文件</summary><div class="menu-grid">${button("import", "导入 JSON", "folder-open")}${button("export", "导出 JSON", "download")}</div></details></section>
 <div class="view-controls">${button("top", "俯视", "arrow-down-to-line")}${button("perspective", "立体", "layers")}${button("fit", "查看全图", "focus")}${button("grid", "网格", "grid-2x2", "icon-only")}${button("focus-transition", "查看过渡段", "spline", "icon-only")}</div>
 <div class="map-title"><strong id="scene-name">道路实验</strong><span id="scene-summary"></span></div>
 <div id="snap-feedback" class="snap-feedback" hidden></div><div id="selection-box" hidden></div><div id="empty-hint" hidden>选择下方的道路资产，开始建造。</div>
 <aside id="signal-panel" class="floating-panel signal-panel" hidden></aside>
 <aside id="turn-panel" class="floating-panel turn-panel" hidden></aside>
 <aside id="selection-panel" class="floating-panel selection-panel" hidden></aside>
 <aside id="boundary-panel" class="floating-panel boundary-panel" hidden><h2>路网通行口</h2><p>点击道路端点设置通行口。双向道路在同一端点同时进出，单向道路按方向自动判断。</p>${button("auto-ports", "自动识别外部通行口", "log-in")}<p class="muted">右键点击通行口，即可取消。</p></aside>
 <aside id="templates-panel" class="floating-panel templates-panel" hidden><div class="panel-heading"><h2>路网模板</h2>${button("close-templates", "关闭", "x", "icon-only")}</div><div id="template-list"></div></aside>
 <div class="tool-rail" role="toolbar" aria-label="地图工具"><button data-tool="select" title="选择道路 V" aria-label="选择道路 V">${icon("mouse-pointer-2")}</button><button data-action="roads" title="道路资产" aria-label="道路资产">${icon("route")}</button><button data-tool="boundary" title="路网通行口 I" aria-label="路网通行口 I">${icon("log-in")}</button><button data-tool="signal" title="路口红绿灯 K" aria-label="路口红绿灯 K">${trafficLightIcon}</button><button data-tool="turn" title="车道连线 J" aria-label="车道连线 J">${icon("corner-up-right")}</button><button data-tool="delete" title="拆除道路 B" aria-label="拆除道路 B">${icon("trash-2")}</button></div>
 <section id="road-dock" class="road-dock" aria-label="道路资产栏"><div class="dock-heading"><strong id="upgrade-heading" hidden>中央隔离带</strong><nav class="asset-categories" aria-label="道路分类"><button data-category="city">城市道路</button><button data-category="oneway">单向道路</button><button data-category="highway">高速与匝道</button></nav>${button("close-roads", "收起道路资产", "x", "icon-only")}</div><div id="asset-list" class="asset-list"></div><div class="construction-tools"><div class="build-modes" role="toolbar" aria-label="道路建造方式"><button data-tool="line" title="直线 L" aria-label="直线 L">${icon("move-right")}<span>直线</span></button><button data-tool="curve" title="曲线 C" aria-label="曲线 C">${icon("spline")}<span>曲线</span></button><button data-tool="upgrade" title="升级道路 U" aria-label="升级道路 U">${icon("wrench")}<span>升级</span></button></div><div class="build-height">${button("height-down", "降低道路 PageDown", "arrow-down", "icon-only")}<span id="build-height-label">地面</span>${button("height-up", "抬高道路 PageUp", "arrow-up", "icon-only")}</div><button id="snap-toggle" data-action="snap" title="道路吸附" aria-pressed="true">${icon("magnet")}<span>吸附</span></button><button data-action="alignment" id="alignment-mode" title="单向道路接口对齐：自动、中线、左缘、右缘；地图中按 Tab 切换">对齐：自动</button><span id="asset-description"></span></div><div id="upgrade-tools" class="road-edit-tools" hidden><div class="build-modes upgrade-actions" role="toolbar" aria-label="道路升级方式"><button data-upgrade-mode="replace">替换道路</button><button data-upgrade-mode="widen" aria-label="添加车道">加车道</button><button data-upgrade-mode="median">中央隔离带</button><button data-upgrade-mode="smooth">添加平滑过渡</button><button data-upgrade-mode="direct">恢复直接连接</button></div><span class="muted" id="upgrade-description">选择升级项目，再点击路段</span></div><div id="median-upgrade-options" class="road-edit-settings" hidden><div class="build-modes" role="toolbar" aria-label="隔离带操作"><button data-median-action="add">添加／替换</button><button data-median-action="remove">移除</button></div><div id="median-widths" class="build-modes" role="toolbar" aria-label="隔离带宽度"><span>宽度</span><button data-median-width="1">1 m</button><button data-median-width="2">2 m</button><button data-median-width="4">4 m</button></div><span class="muted">双向道路 · 路口及斑马线前自动收口</span></div><div id="lane-build-tools" class="lane-build-tools" hidden><button id="lane-snap-toggle" data-action="lane-snap" aria-pressed="true" title="按车道吸附；地图中按 Tab 切换候选">${icon("magnet")}车道吸附</button><div class="lane-count-control"><span id="forward-count-label">车道</span><button data-build-direction="forward" data-delta="-1" aria-label="减少正向车道">${icon("minus")}</button><output id="build-start-count">1</output><button data-build-direction="forward" data-delta="1" aria-label="增加正向车道">${icon("plus")}</button></div><div id="backward-count-control" class="lane-count-control"><span>反向</span><button data-build-direction="backward" data-delta="-1" aria-label="减少反向车道">${icon("minus")}</button><output id="build-backward-count">1</output><button data-build-direction="backward" data-delta="1" aria-label="增加反向车道">${icon("plus")}</button></div><span class="muted">默认直接连接 · 平滑过渡可在升级中添加</span></div></section>
 <div class="map-status"><span id="tool-hint">选择道路资产开始建造。</span><span id="mode-badge">选择</span></div></main>
 <footer class="simulation-bar"><div class="simulation-actions">${button("play", "开始测试", "play", "primary")}${button("reset-sim", "重置测试", "rotate-ccw", "icon-only")}<div class="speed-buttons" aria-label="模拟速度"><button data-speed="1" class="active">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button></div></div><div class="traffic-control"><div class="traffic-heading"><label for="traffic-range">车流量</label><output id="traffic-total" aria-live="off">目标 24 辆/分</output></div><div class="traffic-inputs"><input id="traffic-range" type="range" min="0" max="400" step="1" value="100" aria-label="车流强度"><label class="traffic-percentage"><input id="traffic-level" type="number" min="0" max="400" step="1" value="100" aria-label="车流百分比"><span>%</span></label></div></div><div class="sim-stat"><span>在途</span><strong id="stat-active">0</strong></div><div class="sim-stat"><span>已通过</span><strong id="stat-completed">0</strong></div><div class="sim-stat"><span>排队</span><strong id="stat-queued">0</strong></div><div class="sim-stat average-stat"><span>平均通行</span><strong id="stat-average">—</strong></div><span id="sim-note">基础车流</span><button data-tool="boundary" class="footer-ports">${icon("log-in")}设置通行口</button></footer>
 <input id="import-file" type="file" accept=".json,application/json" hidden><div id="toast" role="status" hidden></div>
 <dialog id="confirm-dialog"><h2 id="confirm-title">载入其他地图？</h2><p id="confirm-message">当前路网会被替换，可以撤销或先保存存档。</p><div class="dialog-actions"><button data-action="cancel-dialog">取消</button><button id="confirm-yes" class="primary">确认载入</button></div></dialog>
 <dialog id="help-dialog"><div class="panel-heading"><h2>道路建造</h2>${button("close-help", "关闭", "x", "icon-only")}</div><ol><li>在下方选择道路资产，鼠标会立即显示蓝色道路预览。</li><li>左键单击起点、终点建造直线；曲线再增加一个弯曲控制位置。左键拖动用于旋转镜头。</li><li>靠近道路端点或路段时会吸附，显示圆环和文字。单向接口支持左右路缘偏移对齐；在地图中按 Tab 切换。交叉处自动生成路口。</li><li>按 B 切换拆除，悬停预览，左键删除；右键或 Esc 退出。</li><li>按 I 设置通行口，双向道路同时进出；右键取消通行口。</li></ol><dl><dt>WASD / 方向键 / 画面边缘</dt><dd>移动地图；按住 Shift 加速</dd><dt>左键拖动 / 右键拖动</dt><dd>旋转俯仰 / 移动地图</dd><dt>滚轮 / 中键上下拖动 / 中键单击</dt><dd>缩放 / 连续缩放 / 拉近一级</dd><dt>Q / E · T / G · 滚轮或 R / F</dt><dd>旋转 / 俯仰 / 缩放</dd><dt>Shift＋F / H</dt><dd>查看全图 / 俯视</dd><dt>L / C / U / V</dt><dd>直线 / 曲线 / 升级 / 选择</dd><dt>PageUp / PageDown</dt><dd>抬高 / 降低道路</dd><dt>Ctrl Z / Ctrl Shift Z / Ctrl S</dt><dd>撤销 / 重做 / 保存</dd><dt>Shift＋拖动空白</dt><dd>框选道路</dd><dt>右键单击 / Esc / Space</dt><dd>返回上一步 / 退出工具 / 测试暂停</dd></dl></dialog>`;
const editor = new Editor(document.querySelector("#viewport")!);
bindTrafficLightPanel(
  editor,
  document.querySelector<HTMLElement>("#signal-panel")!,
);
bindJunctionLanePanel(
  editor.junctionLaneTool,
  document.querySelector<HTMLElement>("#turn-panel")!,
);
let category: RoadAsset["category"] = "city",
  dockOpen = true,
  menuOpen = false,
  toastTimer: ReturnType<typeof setTimeout>,
  pendingConfirm: (() => void) | undefined,
  trafficBefore: Project | undefined;
const icons = () =>
  createIcons({ icons: iconSet, attrs: { "stroke-width": 1.8 } });
let assetsSignature = "";
function renderAssets() {
  const signature = JSON.stringify([
    category,
    editor.assetId,
    editor.tool,
    editor.upgradeMode,
  ]);
  if (signature === assetsSignature) return;
  assetsSignature = signature;
  document.querySelector("#asset-list")!.innerHTML = ROAD_ASSETS.filter(
    (a) => a.category === category,
  )
    .map(
      (a) =>
        `<button class="road-asset ${a.id === editor.assetId && (editor.building || (editor.tool === "upgrade" && (editor.upgradeMode === "replace" || editor.upgradeMode === "widen"))) ? "selected" : ""}" data-asset="${a.id}" aria-label="${a.name}" aria-pressed="${a.id === editor.assetId && (editor.building || (editor.tool === "upgrade" && (editor.upgradeMode === "replace" || editor.upgradeMode === "widen")))}" title="${a.description}">${thumbnail(a)}<strong>${a.name}</strong></button>`,
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
  return `<div class="panel-heading"><h2>${esc(asset?.name || r.name)}</h2>${button("deselect", "关闭", "x", "icon-only")}</div><div class="road-information"><span>${roadLength(r).toFixed(0)} m</span><span>${r.speed} km/h</span><span>${point(r, 0).y.toFixed(0)} → ${point(r, 1).y.toFixed(0)} m</span></div><p class="muted">拖动端点和曲线柄调整道路；Alt＋拖动道路可整体移动。${editor.selected.size > 1 ? `已选择 ${editor.selected.size} 段道路。` : ""}</p><div class="selection-actions">${button("duplicate", "复制", "copy")}${!r.twoWay ? button("reverse", "反向", "rotate-ccw") : ""}${button("delete", "拆除", "trash-2", "danger")}</div><details><summary>更多操作</summary><div class="selection-actions">${button("rotate", "旋转", "rotate-cw")}${button("mirror", "镜像", "flip-horizontal")}${button("add-knot", "增加控制点", "plus")}${button("template", "保存模板", "copy")}</div></details>${ports.length ? `<div class="port-settings"><h3>通行口基准流量</h3>${ports.map((p) => `<div class="port-row"><span>${p.end === "start" ? "起点" : "终点"} · ${p.type === "both" ? "双向进出" : p.type === "source" ? "入口" : "出口"}</span>${isSource(p) ? `<label><input type="number" min="0" max="240" value="${p.rate}" data-port="${editor.project.ports.indexOf(p)}" aria-label="入口基准流量"><span>辆/分</span></label>` : ""}<button data-remove-port="${editor.project.ports.indexOf(p)}" class="icon-only" title="取消通行口">${icon("x")}</button></div>`).join("")}<p class="muted">运行中调整流量会保留现有车辆。</p></div>` : ""}`;
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
function renderSavedMaps() {
  const list = document.querySelector<HTMLElement>("#save-list")!,
    count = document.querySelector<HTMLElement>("#save-count")!,
    input = document.querySelector<HTMLInputElement>("#save-name")!,
    submit = document.querySelector<HTMLButtonElement>("#save-submit")!;
  if (document.activeElement !== input && !input.dataset.edited)
    input.value = editor.project.name;
  try {
    const saves = listSavedMaps(localStorage);
    count.textContent = `${saves.length} 个`;
    list.innerHTML = saves.length
      ? saves
          .map(
            (save) =>
              `<div class="save-row"><div title="${esc(save.name)}"><strong>${esc(save.name)}</strong><small>${save.roads} 段道路 · ${new Date(save.savedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small></div><button type="button" data-save-load="${esc(save.id)}" aria-label="载入${esc(save.name)}">载入</button><button type="button" class="icon-only danger" data-save-delete="${esc(save.id)}" title="删除${esc(save.name)}" aria-label="删除${esc(save.name)}">${icon("trash-2")}</button></div>`,
          )
          .join("")
      : '<p class="muted">还没有存档。输入名称后点击保存即可创建。</p>';
    submit.querySelector("span")!.textContent = saves.some(
      (save) => save.name === input.value.trim(),
    )
      ? "覆盖存档"
      : "保存新存档";
  } catch (error) {
    count.textContent = "读取失败";
    list.textContent = (error as Error).message;
    submit.querySelector("span")!.textContent = "保存存档";
  }
}
function render() {
  document
    .querySelector<HTMLElement>("#toast")!
    .classList.toggle("signal-toast", editor.tool === "signal");
  document
    .querySelector("#toast")!
    .classList.toggle(
      "edit-toast",
      editor.building || editor.tool === "upgrade" || editor.tool === "widen",
    );
  const name = document.querySelector<HTMLInputElement>("#project-name")!;
  if (document.activeElement !== name) name.value = editor.project.name;
  document.querySelector("#scene-name")!.textContent = editor.project.name;
  document.querySelector("#scene-summary")!.textContent =
    `${editor.project.roads.length} 段道路 · ${editor.simulation.junctions.filter((j) => j.arms.length >= 3).length} 处路口`;
  document.querySelector<HTMLElement>("#road-dock")!.hidden =
    !dockOpen ||
    editor.tool === "boundary" ||
    editor.tool === "delete" ||
    editor.tool === "turn" ||
    editor.tool === "signal";
  document.querySelector<HTMLElement>("#map-menu")!.hidden = !menuOpen;
  if (menuOpen) renderSavedMaps();
  document.querySelector<HTMLElement>("#empty-hint")!.hidden =
    !!editor.project.roads.length || editor.building;
  document.querySelector<HTMLElement>("#boundary-panel")!.hidden =
    editor.tool !== "boundary";
  const selection = document.querySelector<HTMLElement>("#selection-panel")!;
  selection.hidden = !editor.active || editor.tool !== "select";
  selection.innerHTML = selection.hidden ? "" : selectedPanel();
  const signalPanel = document.querySelector<HTMLElement>("#signal-panel")!;
  signalPanel.hidden = editor.tool !== "signal";
  if (!signalPanel.hidden) {
    const detailKey = (detail: HTMLDetailsElement, index: number) =>
      detail.dataset.signalDetail || detail.id || `details-${index}`;
    const openDetails = new Map(
      [...signalPanel.querySelectorAll<HTMLDetailsElement>("details")].map(
        (detail, index) => [detailKey(detail, index), detail.open],
      ),
    );
    const focused = document.activeElement;
    const focusSelector =
      focused instanceof HTMLElement && signalPanel.contains(focused)
        ? focused.id
          ? `#${CSS.escape(focused.id)}`
          : focused.getAttribute("name")
            ? `[name="${CSS.escape(focused.getAttribute("name")!)}"]`
            : focused.dataset.signalTime
              ? `[data-signal-time="${CSS.escape(focused.dataset.signalTime)}"]`
              : undefined
        : undefined;
    const selection =
      focused instanceof HTMLInputElement ||
      focused instanceof HTMLTextAreaElement
        ? { start: focused.selectionStart, end: focused.selectionEnd }
        : undefined;
    const scrollTop = signalPanel.scrollTop;
    signalPanel.innerHTML = trafficLightPanel(editor);
    signalPanel
      .querySelectorAll<HTMLDetailsElement>("details")
      .forEach((detail, index) => {
        const wasOpen = openDetails.get(detailKey(detail, index));
        if (wasOpen !== undefined) detail.open = wasOpen;
      });
    if (focusSelector) {
      const replacement = signalPanel.querySelector<HTMLElement>(focusSelector);
      replacement?.focus({ preventScroll: true });
      if (
        selection?.start !== null &&
        selection?.start !== undefined &&
        selection.end !== null &&
        (replacement instanceof HTMLInputElement ||
          replacement instanceof HTMLTextAreaElement)
      )
        replacement.setSelectionRange(selection.start, selection.end);
    }
    signalPanel.scrollTop = scrollTop;
    updateTrafficLightPanel(editor);
  }
  const turnPanel = document.querySelector<HTMLElement>("#turn-panel")!;
  turnPanel.hidden = editor.tool !== "turn";
  turnPanel.innerHTML = turnPanel.hidden
    ? ""
    : junctionLanePanel(editor.junctionLaneTool);
  document.querySelector<HTMLElement>("#lane-build-tools")!.hidden =
    !editor.building && !editor.isWidening;
  document.querySelector("#build-start-count")!.textContent = String(
    editor.draw.lanesStart,
  );
  document.querySelector("#build-backward-count")!.textContent = String(
    editor.draw.backwardLanesStart ?? editor.draw.lanesStart,
  );
  document.querySelector("#forward-count-label")!.textContent = editor.draw
    .twoWay
    ? "正向"
    : "车道";
  document.querySelector<HTMLElement>("#backward-count-control")!.hidden =
    !editor.draw.twoWay;
  document.querySelector<HTMLElement>("#lane-snap-toggle")!.hidden =
    editor.isWidening;
  document
    .querySelector("#lane-snap-toggle")!
    .setAttribute("aria-pressed", String(editor.laneSnapping));
  document.querySelector<HTMLElement>("#upgrade-tools")!.hidden =
    editor.tool !== "upgrade";
  document
    .querySelectorAll<HTMLElement>("[data-upgrade-mode]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.upgradeMode === editor.upgradeMode),
      ),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-build-direction]")
    .forEach((b) => {
      const count =
        b.dataset.buildDirection === "backward"
          ? (editor.draw.backwardLanesStart ?? editor.draw.lanesStart)
          : editor.draw.lanesStart;
      b.disabled = Number(b.dataset.delta) < 0 ? count <= 1 : count >= 6;
    });
  const medianMode =
    editor.tool === "upgrade" && editor.upgradeMode === "median";
  const sectionMode =
    medianMode ||
    (editor.tool === "upgrade" &&
      ["smooth", "direct"].includes(editor.upgradeMode));
  document.querySelector<HTMLElement>(".build-height")!.hidden = sectionMode;
  document.querySelector<HTMLElement>("#snap-toggle")!.hidden = sectionMode;
  document.querySelector<HTMLElement>("#alignment-mode")!.hidden =
    sectionMode || editor.draw.twoWay;
  document.querySelector<HTMLElement>("#median-upgrade-options")!.hidden =
    !medianMode;
  document.querySelector<HTMLElement>("#median-widths")!.hidden =
    editor.medianAction === "remove";
  document.querySelector<HTMLElement>("#asset-list")!.hidden = sectionMode;
  document.querySelector<HTMLElement>(".asset-categories")!.hidden =
    sectionMode;
  document.querySelector<HTMLElement>("#upgrade-heading")!.hidden =
    !sectionMode;
  document.querySelector("#upgrade-heading")!.textContent = medianMode
    ? "中央隔离带"
    : editor.upgradeMode === "smooth"
      ? "平滑断面过渡"
      : "直接连接";
  document
    .querySelectorAll<HTMLElement>("[data-median-action]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.medianAction === editor.medianAction),
      ),
    );
  document
    .querySelectorAll<HTMLElement>("[data-median-width]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(Number(b.dataset.medianWidth) === editor.medianWidth),
      ),
    );
  document.querySelector("#upgrade-description")!.textContent =
    editor.upgradeMode === "median"
      ? "左键应用 · 右键取消此项升级"
      : editor.isWidening
        ? "选择单向资产 · 左键加车道，右键减车道"
        : editor.upgradeMode === "smooth"
          ? "车道、隔离带及偏移 · 左键过渡，右键取消"
          : editor.upgradeMode === "direct"
            ? "左键直接连接 · 右键恢复过渡"
            : "选择道路资产 · 左键替换，右键恢复";
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
  if (sectionMode)
    document.querySelector<HTMLElement>("#alignment-mode")!.hidden = true;
  document.querySelector("#build-height-label")!.textContent =
    editor.draw.endHeight === 0 ? "地面" : `${editor.draw.endHeight} m`;
  document.querySelector("#asset-description")!.textContent = medianMode
    ? editor.medianAction === "remove"
      ? "移除中央隔离带"
      : `中央实体隔离带 · ${editor.medianWidth} m`
    : sectionMode
      ? editor.upgradeMode === "smooth"
        ? "道路衔接 · 平滑过渡"
        : "道路衔接 · 直接连接"
      : getAsset(editor.assetId).description;
  document.querySelector("#mode-badge")!.textContent = (
    {
      select: "选择",
      line: "道路建造",
      curve: "曲线建造",
      upgrade:
        editor.upgradeMode === "widen"
          ? "升级·加车道"
          : editor.upgradeMode === "median"
            ? "升级·隔离带"
            : "道路升级",
      widen: "加车道",
      delete: "拆除 B",
      boundary: "设置通行口",
      turn: "车道连线 J",
      signal: "红绿灯 K",
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
function confirmLoad(
  fn: () => void,
  title = "载入其他地图？",
  message = "当前路网会被替换，可以撤销或先保存存档。",
  label = "确认载入",
) {
  pendingConfirm = fn;
  document.querySelector("#confirm-title")!.textContent = title;
  document.querySelector("#confirm-message")!.textContent = message;
  document.querySelector("#confirm-yes")!.textContent = label;
  document.querySelector<HTMLDialogElement>("#confirm-dialog")!.showModal();
}
function loadProject(project: Project, saveName?: string) {
  editor.load(project);
  menuOpen = false;
  const name = document.querySelector<HTMLInputElement>("#save-name")!;
  name.value = saveName ?? project.name;
  if (saveName) name.dataset.edited = "true";
  else delete name.dataset.edited;
  render();
}
document.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!target) return;
  if (target.dataset.signalMode) {
    editor.signalTool.change(
      "mode",
      target.dataset.signalMode as
        "cs2" | "protected" | "sequential" | "custom",
    );
    return;
  }
  if (target.dataset.buildCount) {
    editor.changeBuildCount(
      target.dataset.buildCount as "lanesStart" | "lanesEnd",
      Number(target.dataset.delta),
    );
    return;
  }
  if (target.dataset.buildSide) {
    editor.setBuildSide(target.dataset.buildSide as "left" | "right");
    return;
  }
  if (target.dataset.branchDelta) {
    editor.changeBranchLanes(Number(target.dataset.branchDelta));
    return;
  }
  if (target.dataset.turn) {
    editor.toggleTurn(target.dataset.turn as "left" | "straight" | "right");
    return;
  }
  if (target.dataset.medianAction) {
    editor.medianAction = target.dataset.medianAction as "add" | "remove";
    editor.setUpgradeMode("median");
    return;
  }
  if (target.dataset.medianWidth) {
    editor.medianWidth = Number(target.dataset.medianWidth);
    editor.setUpgradeMode("median");
    return;
  }
  if (target.dataset.upgradeMode) {
    dockOpen = true;
    const mode = target.dataset.upgradeMode as typeof editor.upgradeMode;
    if (mode === "widen") category = "oneway";
    editor.setUpgradeMode(mode);
    return;
  }
  if (target.dataset.buildDirection) {
    editor.setDirectionCount(
      target.dataset.buildDirection as "forward" | "backward",
      Number(target.dataset.delta),
    );
    return;
  }
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
    if (editor.isWidening) category = getAsset(editor.assetId).category;
    if (tool === "boundary") dockOpen = false;
    if (
      tool === "line" ||
      tool === "curve" ||
      tool === "upgrade" ||
      tool === "widen"
    )
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
  if (target.dataset.saveLoad) {
    try {
      const project = loadNamedMap(localStorage, target.dataset.saveLoad),
        slot = listSavedMaps(localStorage).find(
          (item) => item.id === target.dataset.saveLoad,
        );
      confirmLoad(
        () => loadProject(project, slot?.name),
        `载入“${slot?.name ?? project.name}”？`,
        "当前地图会被替换，可以通过撤销返回。",
      );
    } catch (error) {
      editor.onToast((error as Error).message);
    }
    return;
  }
  if (target.dataset.saveDelete) {
    try {
      const save = listSavedMaps(localStorage).find(
        (item) => item.id === target.dataset.saveDelete,
      );
      if (!save) throw new Error("存档不存在，请刷新列表后重试。");
      confirmLoad(
        () => {
          try {
            deleteNamedMap(localStorage, save.id);
            render();
            editor.onToast(`已删除存档“${save.name}”。`);
          } catch (error) {
            editor.onToast((error as Error).message);
          }
        },
        `删除“${save.name}”？`,
        "删除后无法恢复。当前画布中的地图不会被修改。",
        "确认删除",
      );
    } catch (error) {
      editor.onToast((error as Error).message);
    }
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
  if (action === "leave-signals") {
    editor.setTool("select");
    return;
  }
  if (action === "enable-signal") {
    editor.signalTool.enable();
    return;
  }
  if (action === "remove-signal") {
    editor.signalTool.remove();
    return;
  }
  if (action === "leave-turns") {
    editor.setTool("select");
    return;
  }
  if (action === "reset-turns") {
    editor.resetTurns();
    return;
  }
  if (action === "lane-snap") {
    editor.laneSnapping = !editor.laneSnapping;
    if (editor.pointer) editor.updatePlacement(editor.pointer);
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
    const project =
      action === "new"
        ? emptyProject()
        : action === "example-shared"
          ? sharedRoadMap()
          : example(action.replace("example-", ""));
    confirmLoad(
      () => loadProject(project),
      action === "new" ? "重置为空白地图？" : `载入“${project.name}”？`,
      "当前地图会被替换，可以通过撤销返回。",
      action === "new" ? "确认重置" : "确认载入",
    );
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
    pendingConfirm = undefined;
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
document.querySelector("#save-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>("#save-name")!,
    name = input.value.trim();
  try {
    const existing = listSavedMaps(localStorage).find(
      (save) => save.name === name,
    );
    const save = () => {
      try {
        saveNamedMap(localStorage, editor.project, name);
        input.dataset.edited = "true";
        render();
        editor.onToast(`地图已保存为“${name}”。`);
      } catch (error) {
        editor.onToast((error as Error).message);
      }
    };
    if (existing)
      confirmLoad(
        save,
        `覆盖“${name}”？`,
        "该存档中的旧地图会被当前地图替换。",
        "确认覆盖",
      );
    else save();
  } catch (error) {
    editor.onToast((error as Error).message);
  }
});
document.querySelector("#save-name")!.addEventListener("input", (event) => {
  (event.target as HTMLInputElement).dataset.edited = "true";
  renderSavedMaps();
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
      confirmLoad(() => loadProject(p));
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
document.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.signalTime)
    input.parentElement!.querySelector("output")!.textContent =
      `${input.value} s`;
});
document.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.signalTime)
    editor.signalTool.change(
      input.dataset.signalTime as
        "green" | "leftGreen" | "yellow" | "allRed" | "offset",
      Number(input.value),
    );
});
let last = performance.now(),
  lastStats = 0;
function frame(now: number) {
  editor.simulation.update((now - last) / 1000);
  last = now;
  editor.scene.updateCars(editor.simulation.renderVehicles());
  editor.scene.trafficLights.update(editor.simulation.trafficLights);
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
      `${sim.routeCount} 条可达路径${sim.failed ? ` · ${sim.failed} 次失效行程` : ""}`;
    syncTraffic(false);
    updateTrafficLightPanel(editor);
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
