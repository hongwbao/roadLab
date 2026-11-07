# 原式节点车辆连接选择

`cs2-lane-generation.ts` 移植本次 Game.dll 1.6.0f1 中 `LaneSystem.UpdateLanesJob` 的完整 `ProcessCarConnectPositions`、`SortTargets`、`CalculateSourcesBetween` 与 `CreateNodeCarLanes` 方法。它生成传给 `CreateNodeLane` 的完整有序请求，并保留回调的创建、跳过、索引与随机状态影响。

这里的完整范围是上述四个方法。完整 `CreateNodeLane` 的资产选择、几何、实体命令、附属车道和中段连接世界不在此模块内，必须由调用者提供真实创建回调。不能因为得到了一组连接请求，就声称已经恢复了整套原 LaneSystem。

## 来源与验证

- Game.dll SHA256：`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`。
- MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。
- `ProcessCarConnectPositions` token `100680011`，`SortTargets` `100680012`，`CalculateSourcesBetween` `100680013`，`CreateNodeCarLanes` `100680014`。
- 四个方法的 IL SHA、自动提取方法体 SHA 与来源行号保存在 fixture 的 `source.extraction`。
- 独立 oracle 工程：`/home/bhw/repos/roadlab-reverse/oracles/lane-generation/`。`extract.py` 机械提取完整原方法体；只有 ECS 查询、NativeList/StackList 容器被替换成托管容器。转向分类和 Unity RNG 实际执行原 DLL。
- `NativeList.Sort` 没有用 JavaScript 的稳定排序替代。原 Unity.Collections introsort 的完整控制流程同样机械提取，以托管数组访问代替 UnsafeUtility；TS 保留原分区、16 元素小段、堆排序及等键次序。`sortExtraction` 单独记录程序集 SHA 与源方法体 SHA。
- `CreateNodeLane` 在 oracle 中是明确的脚本回调边界，返回指定 created/skipped、curviness、索引变化与真实原 RNG draw。它不执行原 Unity 实体创建，不能当作创建算法 oracle。

fixture 含 270 个完整节点世界：保留原先 84 个车道增减/偏移/左右行驶/mergeLayers 场景，增加多出口、回转、禁转、Car/Bicycle 混合专用边道、高速规则、不同 mergeLayers、回调拒绝/跳过、字节计数溢出、空缓冲，以及超过 16 个等键项的原排序场景。逐字段检查有序请求、排序后的 source/target、目标计数、已创建 key、RNG 和索引状态。

```sh
npx vitest run tests/cs2-lane-generation.test.ts
```

## 接口与数据

```ts
const result = cs2ProcessCarConnectPositions(world, input, (request, state) => {
  // Resolve real assets/world, create or update the lane, consume RNG.
  return { created, skipped, curviness, nodeLaneIndex, randomState };
});
```

`world` 必须显式提供 owner 对应道路 prefab 的 mergeLayers，以及 source NodeComposition 的 general/left/right flags。缺少值会报错，实际为零的 mergeLayers 则是原式“不兼容”的有效输入，不能使用默认非零值掩盖。

`input` 保留完整源 ConnectPosition payload：道路 owner 与原 Entity.Index、lane prefab/index/group/flags/carriageway/local position、Node/EdgeComposition、世界位置与 inward tangent、order、composition speed/priority/highway flags、curvePosition、baseHeight/elevation、group/segment、三个计数字节、road/track/utility types、isEnd/isSideConnection。原比较器按 Entity.Index 排序；不能用随机字符串排序代替。source 与 target 的 tangent 都向节点内部，target 不应直接使用驶出方向。

节点的 owner/prefab、mergeLayers、intersection flags、roadPassThrough、左右行驶、yield、临时状态、nodeLaneIndex 和 RNG live state 都是显式输入。入口 RNG 不进行构造预热。传入的 buffers 不被修改，输出包含按原顺序排序和更新后的副本。

回调接收完整请求：source、target、group、laneIndex、Unsafe/Forbidden、Turn/Right/Gentle/UTurn、Left/RightLimit、MergeLeft/Right，以及其余原 CreateNodeLane 参数。回调是强制的，不默认成功；它必须返回原 ref 状态，拒绝创建也不自动回滚 RNG 或索引。target 的 skipped/unsafe/forbidden 计数按原控制流程更新，不简单等价于 created。所有三个计数保留 byte 溢出。

`createdConnections` 用原 ConnectionKey 的四个整数 `[source Entity.Index, source laneIndex, target Entity.Index, target laneIndex]` 去重，保留已有 key 与接受顺序。它不按 owner 的字符串标识代替原整数身份。

## 扩缩车道的直接结果

下面是交集 mergeLayers 非零、相同横向起点、右侧增减、右行交通的原式输出。车道编号从 0 开始：

| 变换 | 连接 | 原 laneIndex | Unsafe | MergeLeft | MergeRight |
| ---- | ---- | ------------ | ------ | --------- | ---------- |
| 3→2  | 0→0  | 1            | 否     | 否        | 否         |
| 3→2  | 1→1  | 2            | 否     | 否        | 否         |
| 3→2  | 2→1  | 3            | 是     | 否        | 是         |
| 2→3  | 0→0  | 1            | 否     | 否        | 否         |
| 2→3  | 1→1  | 2            | 否     | 否        | 否         |
| 2→3  | 1→2  | 3            | 是     | 否        | 是         |

第一条连接带 LeftLimit，最后一条带 RightLimit；group 为 `source.group | (target.group << 16)`。偏移、更多出口、车型限制和原行驶方向会改变分配，不应硬编码上述表替代方法。mergeLayers 没有交集时，即使主要连接也可被置 Unsafe。

## 接入真实车道图必须继续完成的部分

源 `CreateNodeLane` 对主要节点连接分配 StartNode 为 `(source Road owner, laneIndex, segmentIndex)`，MiddleNode 为 `(junction owner, ushort nodeLaneIndex++)`，EndNode 为 `(target Road owner, laneIndex, segmentIndex)`。道路端点的 PathNode owner 不能统一改成 junction owner。附属车道有另一条节点分配分支。

源创建/更新 Slave 时，`group` 原样保留，初始 `minIndex=maxIndex=subIndex=laneIndex`。任一 MergeLeft/Right 置 `SlaveLaneFlags.MergingLane=0x10`；Master 另有 group 组件和后续索引范围计算。源重叠 flags 更新还会对没有安全驶出连接的边车道传播 MergeLeft/MergeRight 等标志，例如上述 3→2 中源 lane2 的既有 oracle 结果为 `MergingLane|MergeLeft=8208`。这不是单纯绘制两条相交曲线。

完整创建回调还需要：道路与节点 composition、车道 prefab 与 fallback（公交/轨道/步行）、CheckPrefab 的随机选择、NetLaneData 宽度与附属车道、FitCurve/ModifyCurveHeight/曲率、CarLane/NodeLane flags 与车宽偏移、路权与信号、中段连接、短连接 skip、临时和旧实体更新、新实体命令。原源码的这些分支已恢复，可继续独立移植；本模块不会凭缺失资产值伪造它们完成。

RoadLab 的连续渐变路面需明确映射成原式固定 composition Edge 和实际 Node 连接，才能把上述结果用于合流。当前网络的宽度阈值和人工 cubic seam 不是原 LaneSystem；也不能通过全网 edge-edge overlap 或经验碰撞截停替代其创建与拓扑语义。自定义 RoadLab mergeLayers 可以明确提供，但不能标注为已恢复了原游戏资产。
