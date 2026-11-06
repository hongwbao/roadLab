# CS2 正常道路导航目标

`src/simulation/cs2-navigation-target.ts` 对应 `CarNavigationSystem.UpdateNavigationJob.UpdateNavigationTarget` 中的正常 road/node 几何目标阶段。它接收速度/冲突迭代器已经求出的限制，更新导航点与当前车道状态，再把导航命令交给 `cs2MoveCar`。

本模块保留原目标距离、八次参数二分、横向车道位置、双车道混合、跨短路段队列、朝向触发倒车和曲线扫描距离。它没有用任意的固定前视米数替代这些运算。

## 来源与对照

程序集 SHA256：`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`；MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。

以下方法通过默认 boxed `UpdateNavigationJob` 或静态方法反射，直接调用原 `Game.dll`。两个曲线 `MoveTarget` 重载不读取 job 的 ECS 字段，因此可以在没有 Unity 世界的情况下执行。

| 原方法                                  | token        | TS                          |
| --------------------------------------- | ------------ | --------------------------- |
| 单曲线 `UpdateNavigationJob.MoveTarget` | `0x06007d3a` | `cs2MoveRoadTarget`         |
| 双曲线 `UpdateNavigationJob.MoveTarget` | `0x06007d3b` | `cs2MoveChangingLaneTarget` |
| `VehicleUtils.GetLaneOffset`            | `0x060003f0` | `cs2LaneOffset`             |
| `VehicleUtils.GetLanePosition`          | `0x060003f1` | `cs2LanePosition`           |

完整目标协调阶段和 `CarLaneSpeedIterator` 的曲线距离尾部则由脚本自动截取恢复的 C#，用原数学 DLL 运行，组件查找改为显式字典、队列改为列表；几何 `MoveTarget` 仍调用原 DLL。这些属于 **source-extracted oracle**，不是原 ECS job 的运行。具体片段哈希和替换说明随 fixture 保存。

本地可重建 oracle 在 `/home/bhw/repos/roadlab-reverse/oracles/navigation-target/`；数值对照保存在 `tests/fixtures/cs2-navigation-target-oracle.json`。

## 曲线与缓存状态

`CS2NavigationCurve` 是单条实际车道的三次曲线，包含 id、四个世界坐标控制点、长度、宽度和 NodeLane 起终点宽度偏移。road 与 node 使用同一套几何；道路中心线不能自动代表所有偏移车道的真实曲线。

`current.curvePosition` 有三种不同含义：

- `x`：已经推进的导航目标参数游标。
- `y`：`ReserveNavigationLanes` 另行计算的制动预留终点。
- `z`：当前路径在该曲线上的区间终点。

**x 不是车辆实际位置。**物理位置由 `cs2MoveCar` 推进；不能把 x 直接写成车辆沿路位置。目标函数保留 y，换到下一条车道时按原式设置为 `{x:start,y:start,z:end}`。完整预留系统仍由宿主负责。

反向区间由 `z < x` 表示。`twoway` 对应原 `NetLaneData.Twoway` 的共享双向车道含义，不等于整条道路具有两个行驶方向。

## 原目标距离与二分

比较点以车辆位置为基础，按上一条导航速度的符号选择 pivot；需要时沿车体轴移到 pivot。新的目标距离为：

`max(1, 新导航最大速度 × 4/15) + abs(pivot)`。

只有旧目标与比较点的距离乘 `(1 − oncoming)` 小于该距离，才重新推进目标。距离足够的旧目标会保持，避免每个显示帧重新生成任意目标。

单曲线先检查区间末端。如果末端不足目标距离，就到达该末端并尝试消费后续车道；否则在 x→z 的参数区间内恰好二分八次，以世界空间欧氏距离作判断。

双曲线换道则以两条车道同一参数点之间的线段为距离判据，搜索完成后才按换道进度混合目标点。这与直接对混合点做距离搜索不同。混合进度在几何求点时限制为 0–1；原状态进度本身可超过 1，完成阈值为 `1 + 车体前缘 × 0.05`。

车道横向偏移为 `lanePosition × max(0, 实际车道宽 − 车辆宽)`。实际宽度包括 NodeLane 的渐变宽度。横向方向只由 XZ 平面切线决定，Y 仍来自原三次曲线。

## 接线

`cs2UpdateRoadNavigationTarget` 的主要输入：

- `state`、上一条 `navigation`、当前 `current` 状态。
- `lanes: ReadonlyMap` 与 `nextLanes` 路径队列。
- 车宽、车体前缘、pivot、车型参数。
- 速度迭代器的 `maxSpeed`、`oncoming` 和 `canChangeLane`。
- 原宿主导航随机流的一次 `random01` 样本；用于原横向漂移公式。
- 临时阻塞状态、后续转向标记和可选连续车道解析回调。

返回更新后的 `navigation`、`current`、剩余队列、已消费数量、里程增量、车道统计事件及结束/生成阻塞状态。它与移动内核不同：这个阶段的导航与当前车道状态确实需要写回；`cs2MoveCar.localNavigation` 则不能写回。

节点处仍在换道时，`selectNextLane(previousLane,nextRequestedLane)` 可提供旧车道的连续后继。原式会保留换道进度，在两个后继车道间继续混合。缺少这种连接关系时，普通单后继路径可以直接前进，但不能据此声称复杂交叉口中的换道延续已经完整实现。

普通路口 node 曲线不要全部标记成 `Game.Vehicles.CarLaneFlags.Connection`。该标志用于特殊连接模式，会改变车型限制、速度重置与移动方式。

## 曲线速度扫描

`cs2AdvanceNavigationCurve` 保留 `CarLaneSpeedIterator` 对当前单车道、当前换道及后续车道的距离累计公式：使用弦长与“曲线长度 × 参数跨度”按参数跨度混合，最小累计 0.001 米。后续车道的弦起点是上一次扫描位置，不能在存在间隙时擅自改成新曲线起点。

`cs2ScanNavigationGeometry` 提供正常曲线遍历和每条车道的显式 `evaluate` 回调。扫描按原条件在累计距离减去 20 米已覆盖制动距离，或最大速度达到允许下界时结束；到达缓冲末端时应用原停车包络。回调负责原 ECS 中的车辆、路口、信号、优先权与其他速度限制。

这个扫描器保留几何部分和调用边界，没有把所有原 `CarLaneSpeedIterator.CheckCurrentLane/CheckOverlappingLanes` 的世界查询替换成“看整座路口是否有人”。它也不代表这些世界查询已经全部恢复。

## 特殊组件边界

| 范围                                                         | 状态                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 正常 road/node、反向参数、变宽、短段连续、换道双曲线         | 已移植并对照                                                                           |
| 普通目标的距离限速、转向/倒车切换、ResetSpeed 状态、统计重置 | 已移植并对照                                                                           |
| 速度、冲突和换道许可                                         | 由显式输入或扫描回调提供，需宿主按原查询接入                                           |
| 高光灯前向可见性与照明查询、污染/磨损等资源副作用            | 不在几何模块内恢复；保留 flags/统计事件供宿主处理                                      |
| Area、停车位、TransformTarget                                | 当前入口明确拒绝；队列中的此类已验证目标以 `deferredLane` 保留，不静默当作普通曲线处理 |
| 挂车路径缓存与车道预留                                       | 由各自源系统维护；本模块不以汽车目标代替挂车状态                                       |
| 路径重建、lane group 选择、跨节点旧车道后继                  | 由源路径系统和 `selectNextLane` 提供                                                   |

## 验证

执行 `npx vitest run tests/cs2-navigation-target.test.ts`。

11 项测试包含 333 次数值对照：72 个原单曲线 MoveTarget、45 个原双曲线 MoveTarget、24 个原横向偏移、48 个原车道点、68 个提取的普通目标阶段、36 个提取的曲线累计片段，以及两条各 20 步的提取目标＋移动联动轨迹。还验证了特殊目标的明确边界、输入状态独立性和速度扫描回调。

使用 float32 舍入，以绝对 `0.00003` 加分量绝对值乘 `0.000002` 比较。联动轨迹只证明所给组件、速度约束与随机样本下的两阶段组合；没有执行真实 Unity ECS 世界、原生 Burst job 或实际城市资源，不证明整个交通系统已经完整复刻。
