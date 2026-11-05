# 代码结构与数据流

应用入口是 `index.html → src/main.ts`。界面使用 TypeScript 和 CSS，Three.js 负责三维场景，Vite 负责开发与打包。

```text
src/
├── main.ts                   # HUD、资产选择、文件输入和模拟帧循环
├── style.css                 # 游戏式浮动面板和响应式布局
├── core/
│   ├── types.ts              # Project / Road / Port 等数据结构
│   ├── math.ts               # 分段 Bézier、断面、车道轨迹和弧长
│   ├── assets.ts             # 14 个道路资产预设
│   ├── model.ts              # 自动拓扑、道路分段、历史和序列化
│   ├── junctions.ts          # 路口分组、裁切范围和路口多边形
│   └── snapping.ts           # 端点断面与横向偏移对齐
├── editor/
│   └── editor.ts             # 鼠标键盘、编辑事务、保存与导入导出
├── render/
│   └── scene.ts              # 道路、标线、桥梁、预览、选取和车辆实例
└── simulation/
    ├── simulation.ts         # 路由、发车、跟车、变道和路口预约
    └── collision.ts          # 车身定向矩形检测和空间索引
```

## 模型

`Project` 包含道路、通行口、模板和车流倍率。道路几何由 Bézier 控制点及断面参数决定。曲线轴线、实际路面中心、车道中心分别计算，支持拓宽、收窄和偏移对齐。

车道连接根据几何自动推导。`connections` 字段保留旧文件格式兼容性，手工连接覆盖已退役，不再作为运行时连接依据。导入通过 `parseProject()` 校验并迁移端点角色；双向通行口类型为 `both`。

## 编辑事务

`Editor` 接收鼠标、键盘和 HUD 操作，修改 `Project`。一次已提交的编辑产生一个历史快照；拖动过程中更新预览，完成后记录一次。几何编辑后重建拓扑、路口和场景，并重新配置交通。运行中只调整车流需求时保留车辆与统计。

## 共享几何

- `core/math.ts` 提供路面和车辆共同使用的车道轨迹与弧长查找。
- `core/junctions.ts` 为渲染与交通提供同一组路口裁切数据。
- `core/snapping.ts` 按断面宽度计算端点锚点，编辑器根据屏幕距离选择候选。
- 渲染层使用裁切范围停止路段标线，路口铺独立路面并绘制斑马线。
- 模拟层从路口边缘沿弧长参数化曲线完成转向，并通过碰撞检测和预约控制冲突。

## 模拟与渲染

`Simulation` 不依赖 DOM 或 Three.js，可直接在核心测试中运行。它维护路由、车辆和需求，使用最多 0.025 秒的积分步。`Scene` 将车辆位置、朝向和俯仰更新到实例化网格；车身、车窗和轮胎分别批量绘制。

`core/` 不依赖界面层；`simulation/` 依赖核心模型；`render/` 消费模型和车辆状态；`editor/` 协调模型、渲染和模拟；`main.ts` 绑定界面与帧循环。新增算法优先放在不依赖浏览器的层，交互只负责选择和提交。

## 测试与部署

- `tests/*.test.ts`：数学、模型、历史、序列化、流量和碰撞回归。
- `tests/browser/editor.spec.ts`：真实指针、键盘与页面状态回归。
- `tests/production.mjs`：检查构建或外部部署地址的资源加载和默认场景。
- `tests/support/browser.ts`：统一选择测试浏览器。
- `deploy/`、`Dockerfile`、`compose.yaml`：静态生产托管。
- `.github/workflows/`：验证与可选 Pages 发布。

`node_modules/`、`dist/`、测试产物和本机工作缓存均不提交。仓库截图位于 `docs/images/`，运行时资源随构建打包，不依赖截图或会话工作文件。
