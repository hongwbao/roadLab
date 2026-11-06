# 普通汽车实际车道选择

`cs2-lane-select.ts` 移植本地程序集的完整 `CarLaneSelectIterator` 非绘图状态机，并恢复 `CarNavigationSystem` 的主车道转实际车道、阻挡重选触发和跨节点续接。原程序集没有名为 `FindBest` 或 `GetCurrent` 的方法；实际入口是两个 `UpdateOptimalLane` 重载。

这层决定车辆选择哪一条实际车道、何时发起或撤回换道。它没有自加速度间隙或仅允许相邻车道的限制。换道安全与渐变进度仍由原 `CarLaneSpeedIterator.canChangeLane` 和导航目标计算处理。

## 证据与验证范围

Game.dll SHA256：`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`。MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。

`Game/Simulation/CarLaneSelectIterator.cs` 恢复文本 SHA256：`992cde3bdf263fd0d34e91fb81383e64eb0515c4e1febd9810328e25b743a268`。完整方法位置和文本哈希保存在 fixture 的 `source.extraction`。本地 C# oracle 自动提取所有 12 个非绘图方法；只把 ECS 组件查询、动态缓冲和 NativeArray 容器换成显式字典和数组，仍执行原 Game 组件结构、PathNode 等式及 Unity.Mathematics 运算。没有运行 Unity World。

另外直接反射执行原 Game.dll 的四个标量方法，每个 160 组输入：

| 原方法              | Metadata token | IL SHA256 前缀     |
| ------------------- | -------------- | ------------------ |
| GetLaneSwitchCost   | `06007cd5`     | `70f9ab9fa370ed81` |
| GetLanePriorityCost | `06007cd6`     | `8972c079df47b6fd` |
| GetLaneDriveCost    | `06007cd7`     | `b057598a89d86665` |
| GetBicycleDriveCost | `06007cd8`     | `725058853a5c89d0` |

原 `Colossal.MathUtils.DistanceSquared(Bezier4x3,float3)` 另有 96 组直接 DLL 调用结果。Colossal.Mathematics.dll SHA256：`b76952dca8852052f2ee3eb9903a104019343de52f5f4888e27a622e466883ee`，MVID：`8e84d010-7e28-4fa4-befa-ca4ea0e1a627`。最近距离按原 16 段弦线加四次双侧细化执行；原 `ChooseClosestLane` 的 curvePosition 参数实际未被使用。

夹具包含 160 个完整选择场景，每个成本缓冲、游标、当前车道和前向选择阶段均核对；另有 49 个主车道初选/RNG 状态场景及 80 个 CheckBlocker 场景。覆盖 12 段前方窗口、带前缀的 owner 绝对索引、GroupTarget、Reserved、FixedLane、FixedStart、控制对象排除、静止 Moving、Queue、转向、反向车道、MiddleStart/MiddleEnd、窄路合流和已在换道时的撤回。夹具中的场景输入是合成组件快照，不是原城市存档或车型资源。

## 源行为

1. `FillNavigationPaths` 1131–1198 仅在当前 `UpdateOptimalLane` 位存在时计算。先清此位；若 IsBlocked，则检查当前和前方路段的 master blockage。仍封闭时返回原 invalidPath；封闭已解除则清 FixedLane/IsBlocked 并置 IgnoreBlocker。
2. 从前方队尾开始写成本缓冲，逆序累计；随后选择当前组的实际车道，再正序确定每个前方组的实际车道并清 Reserved。Reserved/Fixed 不参与普通组成本计算；FixedStart 的原有缓冲游标行为也保留。
3. 换道成本是车道索引距离的三次方，乘 `base + (AllowChange ? 1 : 5)`；看到前方转弯时再乘 7。逆序每段 base 加 `0.01f`，正序每段减 `0.01f`。常数来自代码，不是车型资源默认值。
4. 正常对象单位成本 `0.49f`。前方组按区间长度缩放，再乘 `2/(2+index)`；近两段对指定 blocker 特殊检查。当前组只检查 `object.curvePosition.y > current.curvePosition.x` 的对象，排除自己和自己控制的对象。这个比较保留源式，没有用物理位置或速度替代。
5. 没有 Moving 组件的普通阻挡成本在 1000 万和 900 万之间插值；带 Moving 的零速车辆仍只计普通对象成本。Queueing 车辆在 Queue 路线上也只计普通成本。当前组普通汽车不另加 drive penalty；前方缓冲才加原 forbidden/preferred/path-method 成本。
6. 候选是完整 Slave[min,max]，并不局限相邻车道。连接通过 PathNode 等式找到索引范围，范围内部即按原算法处理；没有把它改成另一套图搜索。
7. 新目标不同于当前及已有 changeLane 时，直接设置 changeLane、进度归零并更新转向灯。选回当前车道时，零进度直接取消；非零进度交换 current/changeLane 并设 `1-progress`。跨两条车道也允许直接启动，三次方成本只提高代价。
8. 当前车道确定之后，第一次前向选择使用 1000 万的切换系数，优先保持真实连接；后续恢复各组系数。跨节点 `GetNextLane` 按 owner 顺序返回第一个真正相连的 slave，requested 实体没有优先权。
9. GetRandomLane 对允许方法的候选做 reservoir sampling，每个候选调用 `NextInt(++count)`；没有允许候选时才在整个 master 范围抽一个。FixedLane 且非 Connection 的首段走另一重载，按源曲线最近距离选初始车道并置 FixedStart。非 master 路径实体直接置 FixedLane。
10. CheckBlocker 在静态阻挡时每次请求重选，速度不高于 3 时再置 IsBlocked；带 Moving 的阻挡只在对象变化时请求重选。它更新标志供后续调度，不能在同一轮反复重跑选择直至获得期望结果。

## API 与接入顺序

`CS2CarLaneSelectIterator(world, options)` 提供 `calculateLaneCosts`、`updateCurrentLane`、`updateNavigationLane` 和 `snapshot`；通常直接调用 `cs2SelectOptimalLanes` 即可获得完整原顺序结果。只有需要 oracle 调试时开启 `captureTrace`，实际引擎默认不复制 96 槽调试缓冲。

`world.owners` 保存完整有序 SubLane 数组，Slave min/max/masterIndex 是这些数组中的绝对索引。`world.lanes` 保存组件存在性和原 packed PathNode bigint；Net flags 与 Vehicle flags 分开。对象的 `moving` 表示组件存在，不代表速度大于零。LaneObject 的 curvePosition 继续保留源缓冲参数，与几何导航目标游标及实际车身位置分开。

实际调度顺序：补齐源路径窗口，必要时用 `cs2ResolveLaneSelectionMaster` 初选实体，然后调用 `cs2SelectOptimalLanes`；运行速度/重叠/信号迭代器，再通过 `cs2CheckLaneSelectionBlocker` 更新 blocker 状态；导航目标使用这些结果和 `canChangeLane`，最后执行原移动。物理目标续接可使用 `cs2GetNextSelectLane`。

`cs2ResolveLaneSelectionMaster` 接收**正在使用的** Unity Random.state，返回消费后的状态，不能在每次调用时重新做构造器预热。`fixedStartCurrent` 仅对应原首段 FixedLane 且非 Connection 分支；TransformTarget 世界位置解析成功与否由调用者显式提供。

`cs2CreateLaneSelectWorld(network, speedWorld)` 从唯一共享网络和速度世界投影输入，不解析 opaque ID。RoadLab 没有原 Unity prefab 的 SubLane 分配信息，适配器按实际 group.members 创建明确的合成 owner 索引，连接完全委托 physical successors。它不声称这些索引或合成 PathNode 是原城市网络数据。真实 packed PathNode 快照不需要连接回调。

## 边界

原临时缓冲固定为 96 float；TS 越界显式报错。oracle 将未写槽初始化为零，原 UninitializedMemory 中未读槽的内容无游戏语义。有效成本和游标按源操作核对。

这里没有重建路径窗口填充中的停车、建筑、区域、航点和复杂 TransformTarget 世界查询；普通选择入口可保留这些实体的无 Lane/Slave 组件快照。堵塞 master 的 byte 区间、主从索引、曲线和控制关系必须来自调用者，适配器不会用道路拥堵率猜测这些组件。

本模块不修改已冻结的标量 routing DP、navigation-target、motion 或 runtime 文件，也不替代 ECS 世界、原 lane 生成系统或资源加载。源码 C# 文件只保存在本机 reverse 工作区，仓库只包含 TS 端口、证据元数据和数值夹具。

## 本机重现

oracle 位于 `/home/bhw/repos/roadlab-reverse/oracles/lane-select/`。`python3 extract.py` 从恢复文本重新提取；在该目录用已安装的 .NET 8 构建 `LaneSelectOracle.csproj`，再以 `dotnet run --no-build` 输出 JSON。`tests/cs2-lane-select.test.ts` 对照仓库 fixture，无需安装 .NET 或持有原 DLL。
