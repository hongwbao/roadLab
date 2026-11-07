# 源交通运行链的独立组装

`src/simulation/cs2-simulation.ts` 将已经逐项校验的源内核接成实际运行的普通小汽车链。`Simulation` 的共享入口由主会话负责委托；本模块仅以 type import 引用旧 `Vehicle` / `Step`，不调用旧 `advanceVehicle`、IDM、梯形沿路积分、旧 `pose` 或5秒预测/倒退解锁。

这仍是 **cs2-derived** 道路世界中的普通小汽车子集，不代表完整天际线2城市、全部交通工具或整个Unity世界已经复刻。

## 实际调用链

1. `compileCs2Network`：同一个主/从车道图服务于全局路径、局部选道、物理曲线和调试投影。全局边用master/standalone；运行车辆只能在真实physical slave/standalone上。
2. `Cs2PathService` → `Cs2PathSearch`：生产使用module Worker；同一配置安装一次图，请求只携带小query DTO。普通无居民车使用源码fallback `[time,behaviour,money,comfort]=[1,1,1,1]`、Road|MediumRoad、非Stable随机A*。成本修订时重配graph，generation/revision/token阻止旧结果污染。
3. 路径窗口补到最多12个未来lane；仅完整Path末端设置EndOfPath。保留已选择的物理lane、Reserved/Fixed标志，新增部分用源 `GetSlaveLaneFromMasterLane` / `GetRandomLane` 提名；按FillNavigationPaths原前缀复制TurnLeft/TurnRight、Roundabout、CanReverse和UpdateOptimal标志，确保局部selector的turnAhead成本读取真实弯向。
4. `cs2SelectOptimalLanes`：按UpdateOptimalLane触发，执行源96float槽的反向成本、当前车道选择与正向实际slave选择。启动换道没有旧MOBIL、相邻限定或自造速度gap门。新Blocker经 `cs2CheckLaneSelectionBlocker` 为下次决策安排更新。
5. `CS2CarLaneSpeedIterator`：完整普通车First/Changing → Next → Target顺序，处理前后车、双方制动、限速/曲率、下游空间、信号、预约和重叠区。真实Transform.position/velocity与LaneObject目标/预约区间分别提供，不能把物理s冒充current.xy。
6. `Cs2VehicleRuntime` → `cs2UpdateRoadNavigationTarget`：更新目标游标、变道进度、车道内偏移与过渡，真正推进到下一lane；source `canChangeLane` / `oncoming` 直接控制目标。
7. 完整 `cs2ReserveNavigationLanes` 在target之后、owner AI之前生成current.y、未来Reserved标志、旁车道预约、环岛/应急分支、信号与源随机draw。两桶预约按16组推进，所有本批请求完成后合并最大值。返回的offset已量化为byte，不再重复量化。
8. `CS2CurrentLaneCache` 捕获决策前的current；在完整导航批次完成后，统一执行预约和cache命令，再进入owner AI，对应原 `CarNavigationSystem.Actions` 的时序。源NetUtils按 **curvePosition.y** 维护LaneObject顺序，保留equal-y插入/更新规则；没有每帧重新sort(x)。普通current变化不额外保留旧lane，OutOfControl的blocked分支另有完整cache端口，几何发现器仍属后续范围。
9. 实际调用完整 `runCS2PersonalCarAI`，保留PersonalCar、Target、PathElement和PathOwner状态，执行原CheckUnspawned、ResetPath、失败/终点/上下车/停车分支与新路径请求。完整state写回current、queue、carFlags等；不是只消费Deleted命令。原独立模块与native依赖范围见 [PersonalCarAI](CS2_PERSONAL_CAR_AI.md)。
10. `cs2MoveCar` 使用源4/15秒向量积分，写原4槽运动帧；显示用 `cs2InterpolateTransform` / runtime.displayPose。随后回放owner的EndFrameBarrier结构命令：Deleted车仍完成本批CarMove，Unspawned和驻车组件才在该边界改变。原生实体清理在浏览器中投影为此边界的活动实体/车道成员清理，不代表已恢复完整Unity清理系统。

每个60Hz源帧只导航/AI/运动其16组中的一组，群体分配由runtime按原最少组数量规则处理。所有导航读取本批开始的物理/对象快照；显示不写回物理。变帧长只改变调度累计器，不把源运动改回0.05秒小步积分。

## 可见性、物理与坐标

runtime物理四元数遵循Unity +Z forward；RoadLab的车模与Body长轴为+X，DTO heading使用 `atan2(forward.z,forward.x)`。pitch保留垂直分量。显示与物理共用这个投影，不能给原quaternion再转一次。

边界实体开始于显式Unspawned的出生生命周期，owner AI随后按 `VehicleUtils.CheckUnspawned(CarCurrentLane)` 维护持久组件：Connection|ResetSpeed添加；非TransformTarget/非ParkingSpace且已有组件时移除；停车/变换目标可保留现状。它在owner-AI分组执行，未用render时直接检查“已经走了10米”替代。普通速度/Overlap/CheckSpace仍看到这些实体；只有渲染过滤Unspawned。边界出生组件是RoadLab外部需求映射，不能把它声称为所有原生来源/Prefab archetype的统一初态。

`vehicles` 是每辆车其最近源组物理状态的调试DTO，组之间可能是不同未来时刻。`renderVehicles` 是同一个渲染时刻的4槽插值，并过滤未正式spawn实体。画面穿模验证应比较后者；不能将异步组的物理缓存当成旧同步积分下的同时刻状态，再添加SAT截停来掩盖世界适配问题。

当前无车型资源，车身长3.8m、宽1.65m、高1.4m是显式世界几何输入，非声称恢复了CS2具体车型资产。pivot使用 `VehicleInitializeSystem` 没有wheel骨架时的源码fallback `size.z * -0.2`，即-0.76m。CarData其余值使用已标明的源码base字段初始化值；真实Prefab可覆盖。

## 世界和信号适配

RoadLab中心线/偏移车道拟合成分段cubic，这是浏览器道路格式的适配。端点统一使用未裁剪Road中心线行程米数：正向entry=startTrim、exit=L-endTrim；反向entry=endTrim、exit=L-startTrim。转回原Road参数时反向使用L-travelS。

signalized端点的physical lane在路面trim外再加 `SIGNAL_STOP_OFFSET` 结束，与现有画面停止线对齐；node connector从该边界覆盖斑马线。源速度kernel按真正lane末端制动，不在代码里额外塞硬停距离。自动源模式与两种手工配时共用该几何。

`deriveCs2ConnectionRules` 提供真实CompositionPriority/YieldOffset/IsTurn/Node flags；highwayRules只读显式道路字段，不按速度猜。`LaneOverlapSystem` 的Approach传播前缀按真实successors把节点规则mask带回上游physical piece；进入node的First/Next按原规则决定是否看信号。信号组输入为规范化inward切向量，普通对称四臂十字形成两组；原7态时钟和手工配时继续共存。

重叠窗口由已独立oracle验证的 `cs2CreateLaneOverlapWorld` → `cs2UpdateLaneOverlaps` 产生，使用原owner候选遍历、XZ曲线计算、方向/byte范围和priorityDelta；不再调用旧OverlapController。逻辑同一Road端点的并行连接统一node owner；纯edge-edge排除规则保留，不额外加全网两两碰撞或高度门。`cs2FinalizeNodeLaneOverlaps` 的物理node crossing count按master各slave最小值进入全局路径成本。source-shaped owner/SubLane/PathNode分配仍是浏览器拓扑映射，实际连通完全来自同一network.successors；数据缺口不靠解析opaque ID补造。

浏览器把一条偏移Road拟合成多段cubic，人工piece seam并非原游戏的独立道路节点。如果源forward选择给出同Road相邻piece的不连续入口、而同组存在真实连续successor，适配层用原FixedStart/GetSlaveLaneFromMasterLane距离选择投影为连续入口；已有Reserved等标志保留。它不冻结整个piece，进入新piece后的源96槽换道选择继续执行；真实road/node转换也不受此约束。RoadLab同Road内渐变宽度与原固定composition Edge之间的语义差异仍需后续完整transition-node建模，不能把此seam约束称为已恢复原LaneSystem。

## 路径、失败与流量

车辆path结果在后续source frame barrier应用；诊断用可达性probe收到后立即更新，使暂停编辑时也能启动游戏。PathOwner使用已校验的Pending/Updated/Failed/Stuck/Obsolete策略，Updated保留到完整owner的ResetUpdatedPath/ResetPath阶段，不在结果发布时提前清除。活车重算使用owner产生的完整参数，并从owner阶段更新后的current lane/游标发起；保留源成本而非5秒检查/10秒冷却/15%收益门。

Trip的canonical `ownerPath` 保留真正的 `{target,delta,flags}` buffer，搜索/渲染Step只作为投影。`PathfindJobs.CreatePath:1013–1054` 的Secondary和首元素PathStart标志在搜索DTO映射到owner buffer时恢复；owner可以删除或替换整个buffer。完整Update/Clear/FillNavigationPaths已有独立模块，但本checkpoint仍未接入，原有12-lane前缀仍是明确缺口。

完整到达必须满足原 `PathEndReached` mask：`flags & (EndOfPath|EndReached|ParkingSpace|Waypoint) == EndOfPath|EndReached`。窗口尾、失败和死锁都不能计作completed。低速阻挡链按源64帧/16组的检查提出Stuck/RequestSpace，不把正常红灯等候时间当死锁。ResetSpeed超过60秒的源Spawn blocker为self，随后通过同一Stuck检查/owner-AI处理，未增加任意排队超时删除。

边界 `Port.rate` 单位辆/分钟；0–400%是对此输入需求的倍率。需求队列与Source实体出生是显式DummyTraffic实验输入；没有虚构居民、就业、货物或城市经济。每到达一个需求增加generated，因入口空间不足保留waiting。场内队列queued按speed<1计，entered是累计进入runtime，failed只记录失效行程，completedByExit只记录真实到达。

外部边界生成按 `TrafficSpawnerAISystem` 设置ResetSpeed，其source速度范围为 `[0,prefab.maxSpeed]`；手动spawnTrip/adopt的显式初速保留普通范围。ResetSpeed的距离/时间清除仍由原target逻辑执行，不是给所有新车猜一个rolling10。

flow按physical road piece存4个时段duration/distance桶，由原LaneEffects数据归一化，每512帧轮16road groups更新。master先求和各slave的duration/distance桶再求flowSpeed/量化，不能平均已量化offset。node flow没有凭空从road平均补造；owner分组使用稳定Road次序，是本游戏实体分配的明确适配。

`statistics.safetyStops` 保留旧API的“硬车身防穿模截停”语义，本engine没有该fallback，因此不把普通导航减速算进去。其源速度上限调整另计 `navigationLimits`。mandatory/discretionaryChanges计实际开始的目标lane更换，前者指旧lane不能直接连接下一global group；junctionEntries按物理中心进入connection计，simultaneousJunctions为同时在connection中的车辆峰值。这些是本游戏诊断指标，不冒充原CS2统计组件。

## 主入口接口

```ts
const engine = new Cs2TrafficSimulation({
  pathService,
  deterministicSeed: 123456,
  recordTrace: false,
});
engine.configure(project);
engine.running = true;
engine.syncDemand(project.ports, project.trafficMultiplier ?? 1);
engine.update(realDelta);
const physical = engine.vehicles;
const visibleAtRenderTime = engine.renderVehicles();
```

方法：configure、update、renderVehicles、setTrafficMultiplier、setPortRate、syncDemand、spawnTrip、waitForPaths、adoptVehicles、reset、dispose。live需求变更不清车、不重置时间/credit、不重复配置Worker图。停用入口不再生成/入场，waiting不计，场内车继续运行。

owner接口：`ownerComponents`保存已回放的结构组件，`parkedOwners`保留转驻车后的完整owner状态，`ownerCommandTrace`在recordTrace下记录原命令。`drainOwnerWorldCommands()`交付需要城市经济、费用或特殊路径setup系统处理的完整请求，不用空回调假装已经消费。当前道路宿主能够解析Dummy的外部端点道路请求；多模式、授权和真实城市目标交给后续世界系统，不悄悄改回原出口。

`personalCarWorld`可补充实际居民、乘客、停车等只读组件，`personalCarCallbacks`可提供真实native查询实现。默认实验世界明确没有这些城市组件，只有普通CarLane、边界端点和空Passenger buffer。缺少原native停车算法时，`pendingOwnerQueries`保留精确的事务及请求，本宿主暂停且不提交部分owner状态/命令，不把缺依赖解释为停车成功或行程失败。当前尚无宿主级跨帧恢复接口；独立事务保有原位置继续执行的contract，待真实世界系统完成后接合。这种依赖暂停不是已经实现停车玩法的证据。

读数：completed、failed、generated、unreachable、entered、waiting、queued、elapsed、average、routeCount、completedByExit、junctions、trafficLights、statistics、navigationLimits；调试可读frame/network/runtime/trace/flowOffsets/pendingPathCount/unspawnedIds。

`adoptVehicles` 是RoadLab Step存档/测试适配，按实际network初始化source组件并保持输入Vehicle对象引用同步；它不冒充完整CS2存档加载。生产边界车辆始终走全局source搜索。

`synchronousPathsOnlyForTests` 仅把同一个源搜索内核在本线程执行，结果仍readyFrame+1；用于Node紧循环测试不被Promise调度饿死。生产默认真实Worker。每个源帧的PersonalCarAI另取一次原式RandomSeed.Next，Tick再用entity.Index派生；不逐车抽取整批种子，也不借用导航内部随机流。源码全局RandomSeed规则和Unity RNG保留；浏览器将普通导航当一个显式合成chunk、查询可单独成batch，实体/分批次序及其它未接系统的随机调用不是原城市的ECS布局。新增真实系统的种子调用会改变实验随机需求序列，因此匝道回归使用显式目的行程，不再依赖固定随机车号。

世界只读扫描使用runtime按实际组件版本缓存的冻结快照；调试route/组到Step的映射按path版本缓存，只在组件快照变化时更新Vehicle投影。这些缓存不改变原导航/运动组、随机draw或4槽积分，`getVehicle/allVehicles`的独立副本契约仍保留给外部调用者。

## 验证与未完成范围

`tests/cs2-simulation.test.ts` 以真实模块组合检验普通行程完成、物理/显示分离、16组导航→owner-AI→运动trace、不同render delta一致性、自动信号两相/无车身重叠、30piece跨12窗口、2→3→2+1外侧匝道、失败与Stuck计数、存档对象引用、暂停probe、实时需求、四方向heading、ResetSpeed/Unspawned生命周期、停止线几何和100/400%需求会计。

owner接线新增6项组合验证：Updated由完整ResetPath消费并在CarMove前写回StayOnRoad；Deleted车仍完成最后一轮CarMove；无效目标不误计出口/寻路失败；非Dummy失败转Parked并保留全部结构命令；新路径使用完整owner参数与post-navigation起点；未知native停车依赖保留pending且不提交部分state。该checkpoint共25项组装测试，完整PersonalCarAI模块另有916项源方法体对照/contract验证。

这些是**组装测试**，不是原Game.dll中完整城市世界的端到端oracle。独立数值依据分别在CS2_PATH_SEARCH、CS2_LANE_SELECT、CS2_LANE_SPEED、CS2_LANE_CACHE、CS2_NAVIGATION_TARGET、CS2_VEHICLE_RUNTIME、CS2_SIGNAL_CLOCK、CS2_ROUTING、CS2_PATH_POLICY等文档中保留，区分真正原DLL执行与机械source-extracted容器适配。

完整FillNavigationPaths的城市目标/停车/Waypoint/Area分支、FindBlockedLanes与OutOfControl/事故、拖挂整链、公交/轨道/行人/自行车/货运/紧急服务完整AI、居民出行与经济、完整Prefab资源、原生ECS线程/分配器与原世界拓扑仍未全部移植。普通car链完成不等于全交通目标完成；后续应继续按源分支和独立oracle扩展，而不是把当前子集改名宣布全复刻。
