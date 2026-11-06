# 天际线 2 普通车辆路径生命周期

参考用户给定Game 1.6.0f1，程序集MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。本模块对应 `src/simulation/cs2-path-policy.ts`，以实际PathOwner状态转换替换旧版RoadLab的定时重算假设。

## 真实请求链

普通车辆的链路是：

1. CarNavigationSystem发现当前lane丢失/Obsolete、前方路径实体被删除或路径不连续等问题，将PathOwner标为Obsolete。目标移动、到达中间Waypoint、停车目标失效等也会产生相应失效事件。
2. PersonalCarAISystem.Tick先处理Updated路径重置，再处理失败、停车、上下客、终点和Waypoint。只有随后 `VehicleUtils.RequireNewPath` 成立，才执行FindNewPath。
3. FindNewPath先清AddDestination/Divert。VehicleUtils.SetupPathfind清Failed/Obsolete/DivertObsolete、加Pending；当前车道清EndOfPath、加FixedLane，然后请求入队。
4. PathfindSetupSystem解析起终点，PathfindQueueSystem调度搜索。请求动作的Scheduled标志与车辆PathOwner是不同记录，不能混为一体。
5. `PathfindJobs.ProcessResultsJob.Execute` 接受结果、替换或追加路径、处理过期结果，设置Updated并清Pending。
6. 下轮PersonalCarAI通过ResetUpdatedPath消费Updated，再执行实际导航路径重置。

这条链中未见“每5秒检查一次、改道后冷却10秒、至少改善15%/2.5秒才采用”的规则。旧版RoadLab的这些数字属于自己的IDM/MOBIL实验，不能继续标为天际线原逻辑。Source-derived模式应根据失效事件提出请求；Legacy模式如保留旧行为，应清楚区分。

## PathFlags不等于PathfindFlags

PathOwner.m_State的PathFlags用于生命周期：Pending=1、Failed=2、Obsolete=4、Scheduled=8、Append=16、Updated=32、Stuck=64、WantsEvent=128、AddDestination=256、Debug=512、Divert=1024、DivertObsolete=2048、CachedObsolete=4096。

`RequireNewPath` 严格要求存在Obsolete或DivertObsolete，同时没有Pending、Failed和Stuck。`PathfindFailed` 把Failed和Stuck都视为失败。ResetUpdatedPath只消费Updated；SetTarget清Failed并加Obsolete，**不会清Stuck**。

搜索参数的PathfindFlags是另一套枚举，其中Stable也恰好等于1。不能把Pending=1当成Stable=1。

## 结果接受与失效

`applyCs2PathResult<T>` 对应存在PathElement缓冲的源分支，输入旧路径、新结果和PathOwner，不比较新旧成本收益。

- 非Append结果清空旧路径并将elementIndex归零；Append结果先移除已消费的前缀。
- 请求执行期间如果再次变Obsolete，结果不写入；仍清Pending并按源分支设置Updated，失效标志保留，下轮可立即再请求。
- 普通空结果设置Failed；Divert的空结果保留原路径、不设置Updated，标记Failed并清Pending。
- CachedObsolete、AddDestination的行为保持源状态条件。
- `publishInformation` 对应是否继续更新PathInformation，不等于“路径一定成功”；空失败结果也可能发布失败信息。

接口假设owner有路径缓冲，elementIndex有效；不会悄悄修正一个原实现本会拒绝的越界索引。FindNewPath参数中的真正城市目的地、门禁和停车目标仍需世界适配器提供。

## 正常拥堵不是一个定时重算开关

在该提供版本的普通车调用链，以及全量恢复Game代码中的PathFlags.Obsolete写入者中，没有发现“车速变慢或Flow改变就定时给普通车标Obsolete”的对应逻辑。Flow会影响新的搜索和确实触发的重算；局部导航也可以在既定路线内重新选车道。这与每辆车在排队时不断重算整条道路路线不同。

这是对所提供版本和已检查调用链的结论，不把其他车辆类别、其他版本或未提供资源的行为一概否定。

`decideCs2PersonalCarPathAction` 提供普通驾驶分支的请求/继续/到达/失效判断。activity结果表示需要真实停车、上下客等辅助逻辑处理，不能将其当成已模拟城市。Updated标记的真实ResetPath会改动导航和几何；调用方应先完成这一世界侧重置或提供重置后的laneFlags，不能只清一个位就宣称整个PersonalCarAI已移植。

## Stuck与Bottleneck

StuckMovingObjectSystem检查的是Blocker链。非临时阻挡且编码速度足够低时，链若回到自身/关联目标，或达到100次跟随遍历，会标Stuck；正在Pending的路径不标。它不是“停够几秒”。临时信号停车、有限队列不自动构成循环；极长的100步阻挡链也会触发边界。

Blocker.m_MaxSpeed是**编码字节**，这里的阈值6不能当成6m/s。Crossing阻挡还可能给阻挡车辆加RequestSpace。`cs2BlockedPathChain` 和 `cs2StuckPathDecision` 将实体/Controller查表作为明确输入。源Stuck系统每4帧更新一组，共16组。

TrafficBottleneckSystem按Continuing阻挡关系合并车辆组：达到10个实体才维护候选；组不足50或仍被前车连续阻挡时Keep，至少50且位于阻挡链头部时Add。它还维护图标和通知计数，更新间隔64帧，**不直接设置PathFlags或请求新路线**。`classifyCs2TrafficBottleneck` 只对应分类，不假装实现了完整图标、链分组或通知计时系统。

## 默认普通车搜索参数

PersonalCarAISystem的无居民fallback使用四维权重[1,1,1,1]、最高速度来自CarData、步行速度5.555556m/s，未设置Stable，SearchFlags默认0。有居民时权重来自CitizenUtils，紧急避难等另有覆盖，见CS2_ROUTING.md。

非Stable搜索的每边成本带0.5..1随机因子，启发式因子乘2。原C#的math.select会先求值随机实参；即使Stable选择乘数1，也仍消费一次随机样本。`cs2PathfindRandomPolicy` 明确这个区别，随机流本身由源随机数/请求调度适配器提供。

## 独立验证

本机复现目录：`/home/bhw/repos/roadlab-reverse/oracles/path-policy/`。

- 8,192种PathFlags组合直接调用原Game.dll的VehicleUtils.RequireNewPath、PathfindFailed、IsStuck、ResetUpdatedPath和SetTarget，覆盖全部13个已定义位的组合。
- SetupPathfind和PersonalCar清标志前缀320例、ProcessResultsJob.Execute结果处理1,024例、Stuck阻挡链320例、Bottleneck分类162例，从恢复C#自动提取原方法体，保存原方法SHA256，用类型安全容器/查表及队列接收器替换ECS存储。
- Stable/非Stable随机成本样本另直接调用原DLL PathUtils.CalculateCost，同时记录调用后的原Unity.Random状态，核对Stable也消费样本。

Source-extracted用例不冒充完整Unity世界执行：Bottleneck的Keep/Add只记录诊断标签，队列只接收请求，实体查表由受控输入提供。原Game结构体/枚举与Unity数学继续使用DLL。原始反编译代码与oracle源码保留本地，仓库只放精简数值fixture及移植代码。

运行 `npx vitest run tests/cs2-path-policy.test.ts`。这些证据证明已覆盖的状态/策略，不证明完整城市活动、异步调度、停车世界和全部交通参与者已经一致。
