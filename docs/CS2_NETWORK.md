# 共用车道网络：全局 master 路由与物理 slave 运动

`src/simulation/cs2-network.ts` 为一个 RoadLab 项目编译一份网络快照。原寻路执行器与原导航/运动端口读取同一拓扑；全局结果先展开为物理车道候选，再由局部选道决定实际队列。master 的中心曲线用于全局图，不用于车辆运动。

依据是用户提供的 `Game.dll` **1.6.0f1 (419.d6c6) [6216.19404]**：SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。下列 C# 路径相对本地分析目录 `/home/bhw/repos/roadlab-reverse/decompiled/Game/`，不将反编译文件加入本项目。

## 原始拓扑证据

| 原类与位置                                                       | 直接观察                                                                                                                                                                            | 编译器的对应部分                                                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Game/Pathfind/LanesModifiedSystem.cs:124`、`:548`、查询 `:1052` | car lane 创建/更新 path action 时排除 `SlaveLane`；master 和独立 lane 进入全局图。action owner 是 **lane entity**，不是整条 road entity。                                           | `graph.edges[].owner = group.master`；单车道为实际 standalone，多车道有独立虚拟 master。slave 不成为全球换道边。                             |
| `Game/Pathfind/PathUtils.cs:881`                                 | `GetMasterLane` 使用 slave 的 `Owner`、`MasterIndex` 找到 `Owner.SubLanes[MasterIndex]`，无 slave 时返回自己。                                                                      | 每条物理 lane 直接引用 `group`；`groups[group].master` 为对应全球 owner。                                                                    |
| `Game/Net/Lane.cs`、`Game/Net/LaneSystem.cs:4093`、`:7224`       | lane 有 Start/Middle/End PathNode。普通 edge lane 用 road owner + prefab lane index + segment index；node lane 起终点引用两个道路的 PathNode，中点用 node owner + node lane index。 | 同道路方向的相邻分段共享端点 ID；connection group 直接连接 from road group 的 endNode 与 to road group 的 startNode，另有自己的 middleNode。 |
| `Game/Pathfind/PathNode.cs:25`–`:60`                             | owner.Index 占高32位；laneIndex 占低16位，byte lane + byte segment 时 `(segment<<8)\|lane`；曲线位置是 float32 乘32767后**截断**，放在16..30位；31位是 Secondary。                  | `cs2PackPathNode`、`cs2ReadPathNode`、`cs2StripPathNodeCurve` 保留64位布局，使用 bigint 避免 JS 数字精度丢失。                               |
| `Game/Net/LaneSystem.cs:4393`–`:4418`、`:7415`–`:7439`           | edge slave 添加 `AllowChange`，node slave 在此分支没有添加；lane group/SubIndex 来自 prefab composition/建造器。                                                                    | road group 允许本地换道，connection group 不默认允许；`groupsForPath` 不把 node 强制标为 fixed，不创建全球横向换道边。                       |
| `Game/Net/LaneReferencesSystem.cs:408`–`:508`                    | 建造后按 group、SubIndex 建立 master 索引与 slave 范围。                                                                                                                            | 本模块显式保存成员顺序和连续后继，交给局部 DP。原 prefab group、SubIndex 未随项目提供，排序属于适配层，不能声称恢复原 ECS 索引。             |
| `Game/Pathfind/LaneDataSystem.cs:175`–`:216`                     | master 汇总其成员的 blockage，bounds 使用交集；恢复 default speed、清零 access、设置缺省 blockage 255/0。                                                                           | `pathProperties(master)` 允许主模拟器提供聚合动态属性；本模块不猜造碰撞、封路和访问权限。                                                    |

因此，“在原版全局路径里每条物理车道之间加横向换道边”与本次得到的源证据不符。普通道路的 master 意图由局部 slave 组 DP 展开；单车道以及没有 SlaveLane 的 lane 本身也是全局 edge，不能反过来说全部原版 lane 都是 master。

## 接口与单位

```ts
const network = compileCs2Network({
  project,
  connections, // 调用者已计算、已应用车道转向规则的真实 Connection[]
  revision,
  roadTrims, // Map<roadID, { start, end }>，几何中心线两端裁掉的米数
  connectionGeometry, // Map<connectionID, geometry>，或者 (connection) => geometry
  pathProperties: (lane) => ({
    laneFlags: lane.laneFlags, // Game.Net.CarLaneFlags
    flowOffset: getSourceFlow(lane), // 已量化的0..255字节
  }),
});
```

`geometry` 为 `{points:[from,c1,c2,to], length?, width?, widthOffset?, laneFlags?, junction?}`。点是实际 connector 的四个控制点，按行车方向排列，长度与宽度为米。`length` 若已由现有 connector 采样得到应直接传入，避免两个长度来源；否则本模块用64等分估计。道路速度从 Road 的 km/h 转为 m/s。节点限速使用源 `CreateNodeLane` 的两端均值，不使用较低的一端。

`laneFlags` 是 **Game.Net.CarLaneFlags**。它与导航 `CurrentLane`/`QueuedLane` 的 **Game.Vehicles.CarLaneFlags** 位值不同。例如 Net.ForbidPassing 与 Vehicle.ResetSpeed 都占 `0x02000000`。本模块没有把 Net flags 复制到导航队列；`groupsForPath` 返回的是选道组，不生成 QueuedLane.flags。

返回内容：

| 属性/方法                            | 用途                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lanes`                              | lane 元数据，含 id、role、group、curve、laneFlags、m/s maxSpeed、road/lane/direction/roadInterval 或 connection/from/to。                                           |
| `curves`                             | `ReadonlyMap<string, CS2NavigationCurve>`。为诊断保留 master，但所有虚拟 master 有 `isMaster:true` 标记，runtime 可拒绝驱动它。真正可行驶车道只取 `group.members`。 |
| `groups`                             | master、实际 members、全局 edge index、Start/Middle/End 节点、是否允许本地换道。                                                                                    |
| `graph`                              | 可序列化 `Cs2SearchGraph`，edge ID 等于数组下标，owner 为全球 lane ID。可直接传给 path worker。                                                                     |
| `graphLaneIds`                       | dense edge index → 全球 lane ID。                                                                                                                                   |
| `roadLaneIds`                        | `cs2RoadLaneKey(roadID,laneIndex)` → 沿行车方向排列的实际物理 pieces。                                                                                              |
| `connectionLaneIds`                  | 真实 Connection.id → node/slave lane ID。                                                                                                                           |
| `successors`                         | 物理车道的连续后继。道路分段之间只连接同一物理 lane，节点只连接真实启用的 Connection。                                                                              |
| `locateRoadLane(road,lane,travelS)`  | 将现有模型的**行车方向中心线弧长**映射到实际 laneId、局部 curveT、原 roadT、master edge/delta。反方向自动使用 total−s。裁剪外或车道尚未形成处返回 undefined。       |
| `targetsForRoad(road,travelS,lane?)` | worker 起终 targets；相同 master/delta 去重，target 保存物理 lane 意图。指定 lane 时只定位该车道。                                                                  |
| `groupsForPath(steps)`               | 每条全球步骤的实际 laneIds、区间、`Cs2NavigationGroup`，其 lane.next 是**下一个组的局部候选索引**。调用者再填对象数、driveCost、reservation 后执行原 DP。           |
| `nextLane(old,requested)`            | 导航的 selectNextLane 回调。指定实际连续后继优先；否则从 requested 所在组找 old 的连续后继，在跨节点换道过程中保留旧车道连续性。没有真实连接返回 null。             |
| `warnings`                           | 缺失车道、提前消失、缺省 connector 几何、端点不匹配或拟合未达公差。                                                                                                 |

`CS2NavigationCurve.twoway` 表示一条**共享双向 lane**。RoadLab 的双向道路由两组方向相反的独立 lane 构成，因此不会仅因 `Road.twoWay` 而设置此标志，也不会给 path edge 添加 Backward。反向曲线本身按行驶方向编译，正常导航区间仍为0→1。

路径返回的 master owner 不能直接作为车辆队列。调用 `groupsForPath`，用局部选道结果的 laneIds 生成实际 slave 队列，才能给 motion。`lanes[physicalID]` 中的 road/lane/roadInterval 或 connection 元数据用于回写现有道路步骤；不要解析 opaque ID 字符串。

## 与原 PathSpecification 的逐项对应

`cs2NetworkPathSpecification` 对应 `PathUtils.GetCarDriveSpecification` 的普通汽车分支：

- Forward 默认开启；非 Unsafe 才有 AllowMiddle；共享 Twoway 才有 Backward；SideConnection 才有 SingleOnly；AllowEnter 映射到原 edge bit。
- 复用冻结 `cs2CarDriveCosts`：Driving×length、水平起终切线夹角、显式 laneCrossCount、turn/u-turn/forbidden 条件。Approach 跳过相应额外惩罚。
- PublicOnly → ForbidPrivateTraffic；Highway → ForbidSlowTraffic；只有 blockageEnd≥Start 才设置 HasBlockage 并写入 bounds。没有 blockage 时 PathSpecification 的 bounds 为原默认0/0，不能误写 CarLane 的255/0。
- `density` 在原实现中取 sqrt；flowOffset 是原字节，不再归一化。
- 默认普通汽车方法 Road=2；可通过 callback 传入恢复后的 methods。未复现水运、轨道、公共交通、骑行等规格分支。
- 费用使用原 `CarPathfind` 字段初始化值。未提供游戏序列化 prefab assets，不能称为已恢复所有资产费用。全图 heuristicCosts.road 默认 `[0,0,.01,0]`，是目前统一 driving 成本，**不预加行驶时间**；若各资产费用不同，应传真实各分量最小值。

PathSpecification token `100679226`，IL SHA256 `303494d843696857bc3a35603d0646663e70ab636426e2c9202a1b7e092291af`。PathNode 四参数构造 token `100678920`，IL SHA256 `a985c5bd79ed1e751c981ad6295790ac6294667a7cc6b9e8c6d3f9bedf707cd3`；StripCurvePos token `100678931`，IL SHA256 `8b871a8fc4caf5265cb162dfba41263455a442b55f3e4256ab3b39a7d8d4cace`。

## 几何与分组适配边界

这是 **source-compatible topology + RoadLab world-geometry adapter**，没有复制完整约381KB的 LaneSystem，也没有声称“道路实体与原版逐一相同”。

1. 原道路 prefab composition 与 LaneFlags.Master/Slave 数据不在 RoadLab 存档内。本适配器按道路、行车方向、实际分段建立 road groups；同一 from/to road group 的真实 Connections 建立 node groups。多个物理成员拥有虚拟 master，一个成员使用实际 standalone。这是明确的映射选择，不是从原游戏 assets 还原的组划分。
2. 道路实际 lane 中线来自现有 `lanePoint`、`laneWidth`，包括高程、对齐、profile 和 autoTaper。偏移后的中线通常不是一个精确 cubic；每个原 knot 与宽度变化边界内部使用端点/导数拟合，再按误差细分。默认样本公差0.03m、深度上限9；深度耗尽会记录 warning。这是采样误差检查，不是所有连续 t 的数学上界证明。
3. 默认 usable width 比例0.8是 **RoadLab 模型政策**，不是声称原版用0.8。车道达到此宽度才有可行驶 physical piece，消失则终止；不会把末端已经消失的车道连接到另一条路。局部 DP 必须在消失前完成换道；本模块不会把车辆瞬移到邻道。道路组允许普通局部换道，全球图始终没有横向 lane-change edges。
4. RoadLane 的 widthOffset 用于表示当前适配器的可用宽度变化；node widthOffset 使用两端实际宽度减基础 width，与源 NodeLane 的单位一致。它不是 lane 中心位置偏移。
5. 调用者提供的 connector cubic 原样使用。没有提供时用实际端点与切线生成 Hermite，并产生 warning；这是可测试的 fallback，不能称为原 `CreateNodeLane` 几何。相对 master 的 node 中心曲线是实际成员控制点平均后对齐两端 group 中心，仍属于适配器。
6. 未传 node laneFlags 时仅由已移植 IsTurn/NodeLaneFlags 计算转向、Highway等基础标志，yieldOffset默认0。主集成应传入已知路口的真实规则结果，才能包含不同进口路权、信号等。不会把左转本身等同于 Unsafe，也不会用 speed 阈值推测 HighwayRules。
7. ID 为按逻辑身份构造的 opaque strings，重载、输入数组重排、仅改变 revision 时稳定，不依赖 JS 对象地址或数组序号。几何编辑导致分段边界改变时，对应 pieces 的 ID 会改变；整个 worker snapshot 以 revision 作废。dense edge/node 数字是该 revision 的序列化索引，不冒充原 Entity.Index。64位 PathNode 函数是经 DLL 对照的源编码原语，浏览器图使用显式数字节点而非伪造 Unity entities。
8. 原 NativeGraph 增删历史会影响每个节点的连接顺序；浏览器新图使用确定性顺序。原 executor 随机 draw/heap 的顺序只对这一明确提供的快照保证一致。实际交通 ECS、资产分组、车道重叠建立等未因本模块而全部恢复。

## 独立对照与验证

`tests/fixtures/cs2-network-oracle.json` 来自本地 `/home/bhw/repos/roadlab-reverse/oracles/network/` harness，反射直接调用提取的原 DLL：**320个 PathNode 构造/读取/StripCurvePos + 192个七参数 GetCarDriveSpecification**，共512个原始执行向量。没有把 TS 实现当 oracle，也没有以重写 C# 自证。PathSpecification 对照显式设置原值类型输入，使用原方法实际返回的 cost、flags、rules、density、access 与 bounds。

无 Unity player 的环境仍能执行上述纯值类型方法。此结果不意味着 LaneSystem/LaneReferencesSystem 的 NativeContainer/ECS Job 已在浏览器或独立 .NET 环境执行。几何编译与拓扑连接另以功能性测试验证，未标为 DLL oracle。

独立测试覆盖单向/双向、standalone/master/slave、弯道/高程/非均匀 knot、trim 原点、断路与禁用转向、真实 connector、Net/Vehicle flags 区分、2→3扩展后外侧2+1匝道、成员连续关系、重载 ID、提前消失车道以及中心线距离映射。

```sh
npx vitest run tests/cs2-network.test.ts
```
