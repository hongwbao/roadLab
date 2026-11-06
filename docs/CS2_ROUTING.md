# 天际线 2 路由与选道移植证据

本页描述用户提供的 `Managed.zip` 内实际程序逻辑及当前移植范围，不能据此宣称整个交通系统已经复刻完成。参考输入中的 Game 版本是 **1.6.0f1**，Game.dll MVID 为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`。原程序集、反编译 C# 和完整清点留在本机 `/home/bhw/repos/roadlab-reverse/`，未放入 RoadLab 仓库。

独立模块：`src/simulation/cs2-routing.ts`。数值证据：`tests/fixtures/cs2-routing-oracle.json`。测试：`tests/cs2-routing.test.ts`。

## 源码位置与行为

| 原类/方法                                           | 核实的逻辑                                                                                                                       | 本项目接口                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `PathfindWeights`、`PathfindCosts`                  | 四维向量顺序为 **时间、行为、金钱、舒适**，与常见介绍的列举顺序不同                                                              | `Cs2CostVector`                                  |
| `PathUtils.CalculateSpeed`                          | 根据共同出行方式选择个人最高速度或步行速度；次级边选第二速度；限于道路最高速度；再按 `1-flowOffset/256` 缩减，IgnoreFlow时不缩减 | `calculateCs2PathSpeed`                          |
| `PathUtils.CalculateCost`                           | 给时间维度加 length/speed，四维成本与权重点积；非Stable可乘随机0.5..1                                                            | `calculateCs2PathCost`                           |
| `PathfindJobs.PathfindExecutor.CalculateCost`       | 处理路段部分长度、违规规则/授权成本、免费方向/Boarding，四维点积乘实际跨度                                                       | `calculateCs2EdgeCost`                           |
| `CarPathfind` 字段初始化                            | 明确写在DLL里的驾驶/转弯/掉头/曲率/横跨车道/禁止等默认向量                                                                       | `CS2_DEFAULT_CAR_PATH_COSTS`、`cs2CarDriveCosts` |
| `CitizenUtils.GetPathfindWeights`                   | 根据休闲计数、家庭人数/消费及伪随机舒适偏好计算权重                                                                              | `cs2CitizenPathfindWeights`                      |
| `PersonalCarAISystem.FindNewPath`                   | 无可解析居民时使用[1,1,1,1]；有居民时改用居民权重                                                                                | `CS2_FALLBACK_PATH_WEIGHTS`                      |
| `CarLaneSelectIterator.CalculateLaneCosts`          | 从导航缓冲尾部向前动态规划，计入连接范围、车道对象、优先级与跨道代价                                                             | `backwardCs2LaneCosts`                           |
| `CarLaneSelectIterator.UpdateOptimalLane`           | 当前组检查可通往下一组的车道，综合前车与跨道成本选目标                                                                           | `chooseCs2CurrentLane`                           |
| `CarLaneSelectIterator.GetLaneSwitchCost`           | 跨道数的三次方乘系数；不允许普通变道时系数5而非1；前方转弯再乘7                                                                  | `cs2LaneSwitchCost`                              |
| `TrafficFlowSystem`、`NetUtils.GetTrafficFlowSpeed` | 四个时段桶的归一化流速，编码为0..255字节，再参与寻路速度                                                                         | flow相关纯函数                                   |

`LaneDataSystem` 主要更新车道限速、地区规则、车辆限制、门禁等静态/政策信息，并非从车辆队列直接算出我们旧版的延误秒数。道路图的修改、密度、时间与Flow都通过PathfindQueueSystem的动作系统分发。

## 默认道路成本不是猜测的秒数

源 `Game.Prefabs.CarPathfind` 默认向量如下，列顺序都是时间/行为/金钱/舒适：

| 项目               | 默认值           |
| ------------------ | ---------------- |
| 驾驶每米           | `[0,0,0.01,0]`   |
| 转弯               | `[0,0,0,1]`      |
| 掉头               | `[0,0,0,10]`     |
| 不安全掉头         | `[0,50,0,10]`    |
| 起止切线夹角每弧度 | `[2,0,0,3]`      |
| 横跨车道           | `[0,0,0,2]`      |
| 停车               | `[10,0,0,0]`     |
| 生成连接           | `[5,0,0,0]`      |
| 禁止行驶           | `[10,100,20,50]` |

这不同于旧模型的“右转0.6秒、左转1.4秒、每次换道2.5秒”。源码里的 `laneCrossCount` 是车道/连接组件的属性，不能不加说明地当成玩家车辆所有普通换道次数。资源资产可能覆盖字段初始化值，输入只有 Managed 程序集时不能证明这些数值等于每一个游戏资产的实际配置。

居民没有固定的“成人权重”：时间为 `5*(4-3.75*leisureCounter/255)`，行为固定2，金钱为 `2500*max(1,家庭人数)/max(250,每日消费)`，舒适为 `1+2*TrafficComfort伪随机样本`。尚未迁入且非游客/通勤等居民，金钱权重再乘0.1。这里的接口接收已经取得的舒适随机样本，不擅自消耗RoadLab原LCG随机流。边界道路实验不模拟家庭，可以明确使用源码无居民fallback，而不能宣称恢复了完整居民出行模型。

## 车道动态规划的接线约定

旧实现用IDM/MOBIL加速度收益选择自主换道；源实现则给导航缓冲中的车道组反向计算成本，再为当前车道组选择目标。它不是“每车对整张路网重新寻路”。

- `Cs2NavigationGroup` 表示同一导航层的候选车道组；`lanes` 必须按真实物理索引递增排列。
- `lane.next` 是到**下一组**的连接索引，由源组件node关系适配出来；源实现对可连接索引取min/max范围，可能包含范围内的中间槽位。
- `objectCount` 是车道对象数。未来组普通对象按 `0.49*曲线跨度` 计费，非最终组再乘 `2/(2+navigationIndex)`；当前组仅统计车前方对象，默认每个0.49。
- 被特别检查的阻挡对象若没有Moving组件且不是正常队列，代价为 `lerp(1e7,9e6,curveEnd)`。`blockerCost` 是相对普通计数的增量，避免重复统计。
- 车道预约优先级只在高于车辆自身时增加成本；普通车优先级100、紧急车108，有 `VehicleUtils.GetPriority` 的直接证据。
- 跨越n条车道的成本为 `n³*(baseCost+(allowChange?1:5))`，前方有转弯再乘7；逆推中每经过导航层，baseCost增加0.01。
- `backwardCs2LaneCosts(groups,options)` 接收当前组之后的导航缓冲，返回每组成本Map和当前组需要的switchBaseCost；`chooseCs2CurrentLane` 接收当前组、下一组及下一组成本。
- 选出目标后，实际横向移动和可用间隙判断属于别的导航/运动逻辑；本模块本身不准许穿越车身或瞬移到目标lane。

原 `FillNavigationPaths` 最多维护12个导航lane，包含node内部转弯lane，不是12条道路。原buffer临时存储96个float。普通路口lane不能一概当FixedLane：Fixed/Reserved来自具体状态，错误标Fixed会截断前向成本。如果RoadLab适配暂时只传道路组，必须记录node层、预约与部分曲线语义的简化。

## 拥堵Flow的来源

源流程与我们原先“每秒速度采样、平滑延误秒数”不同：

1. `CarNavigationSystem.ApplySideEffects` 将车辆在lane中的持续时间和移动距离转为 `[duration*min(prefabMaxSpeed,laneLimit)/max(1,laneLength), distance/max(1,laneLength)]`，积累到lane流量next样本。
2. `TrafficFlowSystem.UpdateLaneFlowJob` 用当前时段权重乘0.125，把四个duration/distance桶分别lerp到该next样本，随后清空next。
3. `NetUtils.GetTrafficFlowSpeed` 返回 `saturate(distance/duration)`。**直接执行原DLL确认：空桶0/0的结果是1**，不是JS Math.min/Math.max所产生的NaN，也不能改成0，否则空道路会被判为几乎无法通行。
4. 当前时段四个流速与三角权重点积，`flowOffset=clamp(256-RoundToInt(ratio*256),0,255)`；之后寻路限速乘 `1-flowOffset/256`。

`cs2LaneFlowSample`、`cs2TrafficTimeFactors`、`cs2UpdateLaneFlow`、`cs2TrafficFlowSpeed`、`cs2FlowOffset` 分别对应这些标量操作。必须由调度器决定更新时刻，不能每25ms直接套一次0.125平滑。源TrafficFlowSystem间隔512个simulation frame，并按 `SimulationUtils.GetUpdateFrame(frameIndex,32,16)` 的组筛选车道/道路。当前时段权重取normalizedTime，而非真实机器时间。

## 已确认的搜索与调度结构

原PathfindExecutor使用 `UnsafeMinHeap<HeapData>`、空间终点边界启发式、路径成本上限和多结果支持。启发式因子从允许出行方式的单位长度最低成本计算；NoHeuristics设0，非Stable会把启发式因子乘2，同时边成本使用随机0.5..1因子。这比“Dijkstra换成heap”更广，完整等价还需要源的有向/部分边、访问规则、目标连接、反向搜索与路径拼接语义。

PathfindQueueSystem管理Create/Update/Delete/Pathfind/Density/Time/Flow等动作，普通worker最大线程数为 `max(1,JobWorkerCount/2)`，高优先级请求可以增加调度数量。CarNavigationSystem则每次只更新 `frameIndex%16` 对应的车辆UpdateFrame组，并通过Unity Jobs并行调度。这些内容已经读到实际代码，不再只是公开介绍推断；当前纯函数模块没有因此自动实现完整worker/ECS调度器。

## 验证范围与复现

本地 `/home/bhw/repos/roadlab-reverse/oracle-routing/OracleRouting.csproj` 用.NET 8直接载入用户原DLL，通过反射执行原方法，未用翻译后的TS或手抄C#公式生成预期值。输出被保存为小型JSON数值fixture。

直接DLL证据覆盖：PathUtils速度与稳定成本；private PathfindExecutor单边成本；GetCarDriveSpecification道路成本；CitizenUtils居民权重；私有三次跨道成本与优先级成本；NetUtils流速。输入包含慢行/次级边/流量字节/规则与授权/免费方向/Boarding、不同居民状态及禁止/掉头等。

运行 `npx vitest run tests/cs2-routing.test.ts`。独立场景测试另外检查反向传播、转弯时变道惩罚、实际下游连接约束和Flow桶编码；这些场景是TS功能测试，**不等于整个原DLL的Unity ECS动态规划已可执行对照**。完整组件查表、运行时资产、所有车辆出行目的、时段调度和多帧行为仍需后续接入与差分验证。
