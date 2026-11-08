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

## RoadLab 车道选择扩展（2026-11-08）

原实现确实只支持新建单向道路：`endpointLaneGroups` 首句是 `if (proposed.twoWay) return []`，Editor 的 source 与 compatible 路径都有 `!this.draw.twoWay` 门槛，`endpointAnchors` 的侧缘偏移也要求参考路、新路同时单向。另一个独立问题是 `attachLanes` 只把参考车道方向乘到样条切线上；选择双向新路的反向车道时，这会把样条翻转。

现在按新路每个真实行驶方向分别枚举连续有效车道组。参考车道的方向由双方端点入口/出口角色决定，同端相接需反转样条方向；不能按相同索引假定交通合法。较宽一侧可选择实际重叠的子组，因此 2+1→3 的两条支路可以使用不同车道。正反方向都可 Tab 选择，提示显示参考路的正向/反向及车道编号。进入同一端点后保留候选顺序，轻微移动不会重新排序已选项；离开该端点后重新按鼠标距离选默认组。

`laneAnchors` 使用新路副本执行真实 `attachLanes`，先按“参考样条切线 × 参考车道方向 × 新路车道方向”调整端部切线，再用 `lanePoint` 的物理中心贴合。候选的 editable position 就是该结果的样条端点；多车道组必须逐个中心吻合，否则不提供候选。这统一处理 4m 车道、反向端点、旋转、曲线端部、非对称断面、中央隔离带与 `sectionOffset`。Editor 的预览和提交仍调用同一 draft/attach 流程；车道接点不再误用“接触中心=路面中心”的端点修正。末端候选要求沿合法方向接近，保留原有高度相容筛选，不把反向驶入当成可选车道。source 路径仍先由原式候选优先级选道路，再在该道路上增加用户车道选择；没有更换 CS2 内核候选排序。

存档继续使用既有 `attachments.{start,end}.{road,end,lanes,ownLanes}`，没有新 schema。双向另一侧若整组物理中心完全重合，也一同保存真实映射；没有重合的对向不按索引硬塞进数组。`attachmentAllows` 仅对数组表示的交通方向实施映射限制，未选对向仍经过真实入口/出口及几何约束；单向未映射同向车道仍不能绕过已选目标映射。对于第三条道路，`connections` 只绑定 attachment 实际覆盖的 ownLane，使 3 车道里的空余车道能接另一条 1 车道支路，同时已选车道不能被第三方抢接。不同 road/end 不会被 `attachmentAllows` 放行；用户显式 `to: []` 仍最终关闭该车道。

默认仍为直接接入，不自动添加过渡，不改变车道宽度。双向侧缘对齐沿用已有中线/左缘/右缘按钮，不新增密集设置。compatible 路径先按端点断面的屏幕范围排除远处道路，每次移动只构造一次在画 draft，再为选中端点保留完整 Tab 候选。

本轮定向测试：`npx vitest run tests/snapping.test.ts tests/lane-building.test.ts`，**58 项通过**。其中 24 组覆盖双方 0/1 端组合、三个旋转角度、隔离带有/无、非对称 2+3 与 1+2、曲线切线和双向选择；逐车道物理中心误差小于 `1e-8 m`。Editor 测试直接执行 source/compatible 两条真实 `snapped → draft → finishDraw` 路径，验证起点及两种参考末端的反向组，预览与落地的两端所有车道中心误差小于 `1e-5 m`，并覆盖 Tab 稳定性、8m 分层排除、错误接近方向、2+1→3 空位、第三方抢接防护、对向通行、保存重载及显式禁行。浮点重复贴合按误差界验收，不要求控制点的逐位浮点相等。

原吸附内核的独立 673 项方法/原 DLL 对照见 [道路吸附](CS2_ROAD_SNAPPING.md)。这里的测试验证真实 RoadLab 世界适配，不能替代编辑器鼠标交互、预览/提交一致性和最终浏览器构建检查。
