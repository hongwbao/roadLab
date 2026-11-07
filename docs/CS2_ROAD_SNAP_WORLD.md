# RoadLab 道路到原式吸附世界的适配

`src/core/cs2-road-snap-world.ts` 将当前 Project/Road 的可见几何、道路资产和引用转换成 `cs2SnapRoad` 所需的组件快照。它不改写项目、不提交道路、不创建真实路口，也不修改已校验的源吸附内核。

## 接口

```ts
const adapter = createCS2RoadLabSnapWorld(project, proposedRoad, {
  assetId,
  snapDistance: 8,
  excludeRoad,
});
const result = cs2SnapRoad(adapter.world, {
  prefab: adapter.prefab,
  controlPoints,
  mode,
  snap,
  elevation,
});
const reference = adapter.resolveReference(
  result.best.originalEntity,
  result.best.curvePosition,
  result.best.direction,
);
```

- `world`：有序候选与完整道路组件 Map，可直接供原式内核选择端点、中段、偏移、方向、格长与导向线。
- `prefab`：传入的自定义 assetId。
- `resolveReference(entity,nativeT,direction?)`：返回原 Road ID、全局 t，以及真实端点 end、native 参数、extended、artificialSeam。真实共享 node 有多个 incident road 时，可按源方向挑选一致道路；不传方向按稳定项目顺序。
- `referenceForRoad(roadId,globalT)`：把 Scene.pickRoad 等道路命中的全局参数变回当前快照的 native entity/u。真实端点还返回 node ID；控制点应保留实际的原生 entity 与参数语义。
- `editablePosition(physical,end)`：源内核返回物理道路中心；本函数减去 proposedRoad 在端部的 `center-point` 偏移，避免将左/右对齐或自动过渡偏移应用两次。
- `pieces` 与 `diagnostics`：包含每段原道路区间、实际源曲线、拟合误差、宽度误差和人工/逻辑节点数量，便于检查世界适配边界。

## 本游戏的真实资产与地形输入

这些值描述 RoadLab 当前世界，不能称为从天际线序列化资产恢复的数值：

- DefaultWidth 为 `max(lanesStart,lanesEnd) × width × (twoWay ? 2 : 1)`。
- 所有普通道路使用显式自定义 Road layer=1，连接/合并层均为该层；没有虚构轨道、管线或建筑 ownership。
- Composition width 使用对应小段中部的实际可见车道宽度加两侧各 0.35m 路肩，与 `Scene.roadMesh` 一致；实际渐变宽度与此常量快照的差异进入误差检查。
- 道路 y 来自其真实曲线/可见中心；默认高度范围为实际显示的薄路板 `[-0.45,0]`，与 0.45m 边缘厚度相符。建造范围使用当前工具的 0–80m。
- 当前 RoadLab 地形确实是 y=0 平面，且没有水。因此显式提供 `sampleTerrain=0` 和 `sampleSurface={height:0,depth:0}`；不在源内核中暗中补零。
- 这里没有分区经营，RoadData/RoadComposition 的 zoning flags 为零。SnapDistance 是显式参数，默认 8；不会按旧像素距离另选最近点后冒充源优先级。

world 包含 Node、Edge、Curve、PrefabRef、NetData、NetGeometryData、PlaceableNetData、Composition/NetCompositionData、RoadComposition/Road、EdgeGeometry、ConnectedEdge 和空的道路 buildable-area 快照。不存在的建筑、对象或 ownership 组件保持不存在。

## 曲线、渐变与参数

原 RoadLab `center(r,t)` 可叠加法线方向的增减车道偏移与 autoTaper。这样的中心通常不是单条三次 Bézier。

本适配保留没有中心偏移的原 knot Bézier，并按原 knot、有效渐变边界和必要的误差细分构造 native 段。非 cubic 的中心与路面边界采用 0、1/3、2/3、1 四个几何样本拟合。每段检查 17 个等间距位置，并补上原渲染网格的参数位置。默认采样中心/边界误差上限为 0.02m、常量 composition 宽度误差上限为 0.125m；这些是明确的适配精度策略，未改源 kernel 的阈值。

`diagnostics` 中的误差是上述采样点上的误差证据，不是任意连续几何的数学误差证明。测试还用密集的独立参数检查弯曲渐变中心。达到最大细分仍无法表示的偏移/法线不连续道路会明确报错，不静默使用错误中心。调用方应将该错误作为本游戏几何输入不能映射的情况处理。

native u 到原 Road 全局参数使用每段的线性区间映射。不会通过重新找最近点覆盖源的 curvePosition。特别是源 AddSnapLine 的交点优先级和 4m 参数量化，可能让物理 position 与参数对应点不同；两者必须分开保留。

## 真实节点与人工 seam

真实 Road 首末端共享坐标时，使用与课程适配器一致的标识：

```ts
`roadlab:node:${JSON.stringify([f32(center.x), f32(center.y), f32(center.z)])}`;
```

它们共享同一个 Node 和有序 ConnectedEdge。人工拟合段的节点使用道路内部独立标识；不会因坐标重合就与另一道路合并。`resolveReference` 对人工 seam 返回原 Road 的内部 t、`artificialSeam:true`，不会标记为 Road 的 end，也不会创建 Project 路口。

源 ExtendedCurve 可返回片段之外的参数。适配保留原始 global t 与 `extended:true`，即使该 global t 仍落在整条 Road 内，也不把源延伸位置重算为可见曲线上的点。NearbyGeometry、格长与导向线会按这些 native 段执行原算法，因此旧非 cubic 道路的人工片段可能产生与单 edge 不同的吸附相位/端部候选。这是旧格式的明确世界适配差异；完整消除此差异需要将道路格式迁移到原生成体系，不能通过给内核加 epsilon 宣称等价。

## 快照与复用

几何拟合结果按 Road 对象与完整几何内容签名复用；原地修改控制点、宽度、断面、profile 或 autoTaper 后会失效。每个 world 获得独立的曲线组件值，旧世界不随项目编辑变化，也不能污染缓存或后续世界。项目本身不被修改。

## 验证

```sh
npx vitest run tests/cs2-road-snap-world.test.ts
```

当前 **19 项实际组装测试通过**，均调用 `cs2SnapRoad` 或检查其可见几何/引用边界，覆盖新建、端点、中段、斜坡、高架分离、双向、宽差偏移、多路口共享节点、多 knot、显式与自动渐变、参数量化与物理点独立、真实命中映射、编辑排除、缓存失效/快照隔离、不可表示几何的明确失败。模块和测试的定向 strict/noUnused 类型检查通过。

原吸附内核的独立 673 项方法/原 DLL 对照见 [道路吸附](CS2_ROAD_SNAPPING.md)。这里的测试验证真实 RoadLab 世界适配，不能替代编辑器鼠标交互、预览/提交一致性和最终浏览器构建检查。
