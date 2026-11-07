# 道路点击点的原式吸附编排

`src/core/cs2-road-placement.ts` 是编辑器可直接调用的纯编排层：创建 RoadLab 世界快照，恢复已点击控制点的原生引用，执行 `cs2SnapRoad`，并同时返回物理控制点和可编辑道路锚点。它不修改 Project，不负责提交课程、切分道路、历史记录或渲染。

## 接口

```ts
const result = placeCS2RoadLabPoint({
  project,
  proposedRoad,
  assetId,
  raw,
  previous, // CS2RoadLabPlacementPoint[]
  mode: 0, // straight=0，simple=1
  snap: true,
  grid: true,
  excludeRoad,
  hit, // 可选：实际 Scene raycast 的 {road,t}
});
```

Stored point 的格式为：

```ts
type CS2RoadLabPlacementPoint = {
  position: V; // editable spline anchor
  source: CS2RoadControlPoint; // physical source state
  reference?: CS2RoadLabResolvedSnapReference;
};
```

输出 `{point,source?,adapter?}`。`source` 是原吸附阶段的完整输出；`adapter` 是本次道路世界及参数映射。`point.source` 保留原 `best` 的物理状态，`point.position` 通过 adapter.editablePosition 去掉 proposedRoad 端部中心偏移。两者不互相覆盖，也不把 source position 重算成量化参数对应点。

## 原生输入与身份重映射

- 当前 raw 通过原形状 factory 创建；与原 NetTool caller 一样，在吸附之前赋予工具高程。在 RoadLab 实际平地中，高程为 raw.y。
- mask 为 ExistingGeometry、NearbyGeometry、GuideLines、StraightDirection；grid 只增加 CellLength，没有启用暂缓的 ZoneGrid 工具。
- previous.source 的物理位置、方向、命中位置、优先级、高程等状态保留；只将持久 Road/global t 通过本次 adapter.referenceForRoad 改写为当前 native entity/u。
- 真实端点可改写成共享 node 身份；人工 seam 保持内部引用，不伪装为真实 Road end。
- 已删除、被排除或 extended 的旧引用清除 native join 身份，仍保留物理点击和方向，允许继续几何建造。
- 输入不被修改；返回 Stored source 与诊断 source.best 也不是同一可变对象。

## 实际 raycast

原 `Net/RaycastJobs` 对 node 命中写入 node.position，对 edge 命中写入 curve(t)，并将射线命中位置保存在单独的 HitPosition。可选 `hit:{road,t}` 按这一语义创建当前原生控制点：真实端点用 node，内部用本次 native edge/u；position 来自对应组件，hitPosition 保留 raw。

hit 必须来自实际的场景命中。编排层不会再按最近像素挑选道路，也不会通过该接口跳过源候选优先级；消失或被排除的 hit 直接失去身份。

## 关闭吸附与格长相位

snap=false 时不创建世界、不查询候选，editable position 完整保留 raw。source 清除吸附身份、方向和优先级等元数据；**工具高程仍为 raw.y**，保证 Alt 建高架不会把课程高程误清为零。

原 HandleCurve 的 CellLength 使用当前已有 edge 长度的居中余数相位。对任意旧长度道路，这不等于把鼠标位置直接按全局 8m 格取整。例如旧 edge 从 x=-100 到 0，格长开启且鼠标在端点附近时，原阶段可返回 x≈-1.95。若有真实 node raycast，节点身份仍可保留，但物理位置不会因此自动改为 0。

此行为在回归中明确保留：不能在编排层强制替换 `best.position`，或把实体引用与物理点视作必然同一个坐标。旧任意长度/自定义资产的端点体验与原游戏原生世界的完整一致性，仍取决于资产、raycast、课程定义及后续应用系统的整体接线。

## 验证

```sh
npx vitest run tests/cs2-road-placement.test.ts
```

当前 **17 项测试通过**，定向 strict/noUnused 类型检查通过。覆盖真实两次点击及 64m 新格长、无格长方向吸附、连续直线点击、三点 simple 输入、普通/disabled 高架高程、关闭吸附绕过世界、改路后的 native 引用重映射、已删除/人工 seam/extended 引用、物理与可编辑锚点分离、编辑排除、不变性，以及实际 endpoint/edge raycast 与旧 edge 格长相位。

底层原式方法证据与世界适配限制分别见 [道路吸附](CS2_ROAD_SNAPPING.md) 和 [RoadLab 世界适配](CS2_ROAD_SNAP_WORLD.md)。编辑器的鼠标/Tab 扩展、预览提交一致性及生产构建验证由集成者继续完成。
