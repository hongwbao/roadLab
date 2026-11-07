# 原车道重叠窗口与标志

`cs2-lane-overlaps.ts` 恢复 `LaneOverlapSystem.UpdateLaneOverlapsJob` 的实际曲线重叠区间，以及完整 `UpdateOverlaps` / `CheckOverlaps` 的组件判断、双向量化结果和额外写入队列。它供实际速度迭代器消费 `LaneOverlap`，替代控制器的折线近似窗口。

此外恢复 `UpdateLaneFlagsJob` 的普通汽车非 EdgeLane 分支：路口穿越数量、master 组最小穿越数，以及环岛共享端点计数的 255 哨兵。完整 edge/track 标志传播仍有明确缺口，见下表。

## 来源和 oracle

原 Game.dll SHA256：`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。

两项纯方法直接反射调用**原 DLL**，不需要构造 ECS 世界：

| 方法                 | 源位置                    | Token      | IL SHA256                                                          |
| -------------------- | ------------------------- | ---------- | ------------------------------------------------------------------ |
| FindOverlapRange     | LaneOverlapSystem.cs:1438 | `060040ee` | `952d13b7d5436af14b385cc638a1d0ea06fae215e93c0d06b093824865f7321d` |
| CalculateParallelism | LaneOverlapSystem.cs:1426 | `060040ed` | `34e4a2022e0f8c2a495624af55928606252b24b492c5dd51647a2b546f8cdd4b` |

原 FindOverlapRange 的 stackalloc、Colossal 几何方法、Unity 数学和 Mathf.RoundToInt 都实际执行。TS 测试比较是否重叠、四个参数端点及平行度；参数允许 `1e-6` 浮点误差。原 Colossal.Mathematics.dll SHA256：`b76952dca8852052f2ee3eb9903a104019343de52f5f4888e27a622e466883ee`。

完整组件逻辑另用从恢复 C# 自动提取的 UpdateOverlaps、CheckOverlaps 和非 EdgeLane CarLane 后处理分支核对，字典/数组替换 Unity 容器。该 C# oracle 的几何部分继续调用原私有 DLL 方法；原 `LaneOverlap` 构造器和 CompareTo 也实际执行。额外队列应用与排序是明确的容器调度适配。没有执行 Unity World 或原 job 调度器。

恢复文本 SHA256：`a82917495673fc05e770b78259310b3980d1ca2a08e1b06a264b25f1401ba0fc`。

| 自动提取内容               | 源行 | 方法体 SHA256                                                      |
| -------------------------- | ---- | ------------------------------------------------------------------ |
| UpdateOverlaps             | 1038 | `335c88537fe23ad93b18f28a5fb2bb4260bed9e8f38e8d93631d57884e380240` |
| CheckOverlaps              | 1099 | `dd694367288854a212811cd84145218afeb31c80bf66eff10ee2fb574628832e` |
| 非 EdgeLane CarLane 后处理 | 420  | `12fb1807d0a98cbf33a27866215cfedce058f7601dd68d07ee5228915e702587` |

夹具包含 744 个曲线直接 DLL 向量、27 个直接原 PathNode 构造器语义向量和 267 个完整组件世界；后者精确核对双向 byte 区间、flags、priorityDelta、parallelism、共享计数、额外队列、穿越数及环岛 255。覆盖斜角、反向、同起点/终点、中段节点、极短曲线、严格宽度边界、变化宽度、停车角度、左右行交通、Approach、Stop/Yield/RightOfWay/Unsafe、高差和不同 owner。输入世界为合成快照，不能称作原城市运行结果。

## 几何与候选范围

半径严格来自 `(prefabWidth + NodeLane.widthOffset) * 0.4f`。细分次数取曲线原 16 弦线长度、端点半径、平方根和银行家舍入，最多四级；不是根据 RoadLab 帧率或车长选择。包围盒距离使用严格小于半径和平方。叶子以曲线起终切线构建带停车角度偏移的四边形，保留原 16 对边线相交及 LIFO 细分顺序。

此处需要分别保留 Bezier4x2 和 Bezier4x3 的浮点加法顺序：平面几何和平行度使用前者；合流侧与优先方向使用原三维方法再取 XZ。长度比会令存储平行度大于 128，最终量化上限仍是 byte 的 255。

几何只用 XZ，没有高差门。原 UpdateOverlaps 比较同一个 owner 中当前车道之前的候选；edge 的非 NodeLane 还可以比较其实际端点 node owner 的车道。逻辑上相接、切线同向的端点会排除。不同 owner、没有该拓扑关系的道路不会进入几何比较。因此同 owner 的两条上下分离曲线在原函数中仍可能重叠；不能加入自定义高度阈值后称为原行为。

源还会通过 AddNonUpdatedEdgesJob 把更新 node 的相关未更新 edge 加进处理列表；跨 owner 写入先排队，全部几何完成后再应用并排序。原排序键只有 thisStart/thisEnd，键相同的顺序不应被上层当成优先级。

## 标志与优先级

MergeStart/End/MiddleStart/MiddleEnd/Flip 来自真实 PathNode 等式，IgnoreCurvePos 只忽略原 bit 范围。合流区间会按原侧向关系扩展到 0 或 1，并更新左右侧标志。Unsafe/Road/Track/Water 描述对方车道，不能直接复制成自己的 Net CarLane flags。

Approach 在优先级计算时屏蔽 Stop/Yield/RightOfWay。普通道路的差异优先级按 Stop、Yield、RightOfWay、Unsafe、行驶侧顺序处理；MergeStart/MiddleStart 有独立排除条件。行人、停车与轨道分支及双向 priorityDelta 符号均保留。TrafficLights 本身不构成这里的静态优先级比较，实时灯态由速度迭代器处理。

原代码第二个候选的 train 检查受 Parking 而非 Track 条件保护，第一个候选受 Track 保护。该不对称照原式保留，没有擅自修正。普通 RoadLab car 适配器只生成 road prefab 类型；高级组件必须由显式世界快照提供。

普通共享计数最多 254；后处理中的环岛无连接端点使用 255 哨兵。普通非 EdgeLane 的 LaneCrossCount 忽略安全合流，只统计原 Road 穿越谓词，并截断到 255；master 取可用 slave 数量的最小值，没有任何可用 buffer 时为 0。

## API 与 RoadLab 投影

`cs2UpdateLaneOverlaps(world, {owners?, leftHandTraffic?, updateAll?})` 返回 `overlaps`、`nodes`、`extra` 与实际处理的 `updatedOwners`。输入是显式曲线、原长度、PathNode、prefab 类型/宽度、组件存在性、NodeLane 宽度与计数，以及有序 owner.SubLanes。未处理 owner 的旧 overlap buffer 可以作为输入保留。

`cs2FinalizeNodeLaneOverlaps(world, result, {lanes?, collectedLanes?})` 计算上述普通非 EdgeLane 后处理，返回 nodes 与 laneCrossCounts。完整加载时默认取全部车道；增量更新时两份列表对应原 UpdatedLanes 查询和 CollectLaneDirections 输入，不能从渲染可见车辆反推。普通 RoadLane 安全性决定方向图录入；Unsafe bicycle 的特例未纳入该普通汽车投影。

`cs2CreateLaneOverlapWorld(network, {junctionForLane?, carFlags?})` 是明确的 RoadLab 适配器：

- 实际 physical successors 的两端通过 DSU 共享 PathNode 身份。同 incoming-road-end 的多个连接共享 start，同 outgoing-road-start 的连接共享 end。
- PathNode 端点的 owner 与 SubLane 所属路口分开：原 CreateEdgeLane 用 edge owner 建立 start/middle/end；CreateNodeLane 的 start/end 继承相连 edge 的端点，只有 middle 属于 junction。适配器的 DSU root 含 road vertex 时使用 road edge owner，仅没有 road vertex 的内部连接端点才使用 node owner。普通 edge endpoint 不会因此额外触发 edge→node 候选，外部环岛端点也不会错误变成共享计数255。
- 同 junction 的全部实际连接共享一个 node owner，允许不同连接组之间计算横向重叠。不能把每个 connection group 当成一个路口。缺 junction 时要求调用者提供 resolver，不用 opaque ID 猜测。
- 同 Road ID 的物理片段归同 edge owner。按该 road 的实际最小/最大 roadInterval 参数识别逻辑端点，包含修剪后的 0.1/0.9；内部 cubic 分段点不变成路口。未连接的外侧车道仍使用同一逻辑路口 owner。
- 虚拟 master 不生成物理 overlap buffer。几何、长度、宽度和宽度偏移转成源 float32。合成 owner entityIndex 和 PathNode 明确是适配分配，不声称恢复了原城市 prefab 或 entity 分配。

引擎应在网络重建/道路规则更新时计算这些 buffer，再给 source speedWorld 提供；无需每辆车每个物理帧重算所有曲线。共享网络中的 master/group/road-piece ID 继续保持稳定。

## 仍缺的完整 LaneOverlapSystem 阶段

| 阶段                                                | 当前状态与影响                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UpdateOverlaps / CheckOverlaps                      | 已恢复，包括候选筛选、停车角度、双向 flags/priority、共享计数、额外队列与量化                                                                                                        |
| 非 EdgeLane CarLane 的穿越数与环岛哨兵              | 已恢复；masterMembers、EdgeLane 存在性及更新查询由输入明确提供                                                                                                                       |
| CollectLaneDirections 的普通 road 录入              | 后处理对普通安全 car 提供对应方向图；原 Unsafe bicycle/轨道/连接组件特例仍需完整数据                                                                                                 |
| EdgeLane 连接计数与 outside connection 回退         | 尚未恢复。会影响无后继、道路终止与并道的状态                                                                                                                                         |
| Edge CarLane 标志传播                               | 尚未恢复。原实现清理旧 turns/Stop/Yield/RightOfWay/Approach 等，再从 SourceMap/TargetMap 传播；master 去转弯位、无安全 Road overlap 时去 Yield、ForbidPassing 与环岛前瞻均有专门条件 |
| Slave Merging/Split/Merge 标志                      | 尚未恢复。依赖 owner 绝对索引、完整 SourceMap/TargetMap、open-start/end flags 与源 lane 连接计数，不能用当前 group.allowChange 近似宣称完成                                          |
| TrackLane Switch/DiamondCrossing/CrossingTraffic 等 | 尚未恢复。普通汽车不以另一套猜测规则替代                                                                                                                                             |

调用者提供的 carFlags 应清楚区分上游已恢复值与 RoadLab 规则适配值；本模块不会默默声称完整 edge 标志传播已经运行。

尤其是 RoadLab taper：适配器当前把 `kind=road` 映射成 EdgeLane，把连接映射成 NodeLane。这不是原 LaneSystem 的完整组件分配。源 `isEdge && !isNodeLane1` 不检查另一条普通 edge lane；原 oracle 也验证平面相交的两条 edge lane 仍不会生成窗口。不能为了消除 taper 穿模而私加 edge-edge 重叠或全网几何让行。

原中段生成链的待审计入口包括 LaneSystem.CreateEdgeConnectionLanes:2130、CreateCarEdgeConnections:2982、CreateNodeConnectionLanes:3125、CreateNodeConnectionLane:3306、CreateEdgeConnectionLane:3640、ProcessCarConnectPositions:5638、CreateNodeLane:6759；7430/7502 的 isMergeLeft/Right 分支会设置 Slave.MergingLane。尚未完成其对具体 2→1 prefab 的因果审计，不能断言每个 taper 都应生成 NodeLane。这里保留真实机制缺口供网络适配继续恢复。

本机 oracle 在 `/home/bhw/repos/roadlab-reverse/oracles/lane-overlaps/`，`python3 extract.py` 自动提取组件方法。恢复 C# 只存本机；仓库 fixture 仅为输入输出及证据元数据，测试无需原 DLL 或 .NET SDK。
