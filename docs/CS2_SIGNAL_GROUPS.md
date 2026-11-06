# 天际线 2 自动信号分组

`src/simulation/cs2-signal-groups.ts` 移植用户所提供 Game 1.6.0f1 中 `Game.Net.TrafficLightInitializationSystem` 的普通节点车辆分组算法，以及行人组分配分支。它负责决定每条lane属于哪些信号组；信号状态机、需求检测、组切换、车辆优先权和实际让行由其他模块执行。

## 普通十字口不是默认保护左转四相

源码 `FillLaneBuffers` 收集带LaneSignal、非Secondary的车道。MasterLane会携带自己的整组slave范围，独立非slave lane单独成组；行人另外收集。方向分别取水平起点切线和**负的终点切线**，然后归一化。直行标志来自CarLaneFlags，不是简单比较“接近对向”。

`ProcessVehicleLaneGroups` 先按起始方向点积大于0.999，把同进口的直行、左转、右转归为一个组。随后在每组中寻找起止方向点积最小的直行lane；若能找到首尾方向与它交换匹配的另一个直行lane，就把那个lane所在的**整个进口组**合并过来。

因此普通对称十字口通常得到两组：东西进口所有转向一组，南北进口所有转向一组。左转不是自动获得独立保护相位；同一组的相遇车辆仍需源驾驶逻辑做优先权与冲突判断。为车身避碰而把每个转向拆成互斥相位，会改变参考游戏的默认行为。

分组的相位顺序取决于原sub-lane缓冲顺序，并保留 `RemoveAtSwapBack` 的行为。适配器如果按另一种顺序生成道路movement，组成员可以相同，但组编号或起始放行顺序不一定与原场景相同。

## 接线接口

`buildCs2SignalGroups(lanes, options)` 输入：

- 每个原master组或独立movement的id；可选members用于展开master/slave成员。
- startDirection为沿车辆行驶方向的起始切线；endDirection为**负出口切线**。这两个向量都指向movement内部，不能把普通道路末端向前切线直接传入endDirection。
- straight根据原直行/普通转弯/缓转/掉头flags派生；unsafe、track、waterway、pedestrian根据对应组件派生。普通小汽车默认car=true。
- secondary=true或hasSignal=false不参与初始化。
- 可选levelCrossing对应原普通铁路道口分支；可选overlaps为行人lane到真实重叠车辆lane成员ID的映射。

输出为groupCount、groups和laneSignals。groups同时提供0基index、1基signalGroup和16位mask；laneSignals按成员id提供groupMask、defaultPriority和canExtend。

`InitializeTrafficLights` 源代码对普通小汽车设置CanExtend=true，默认LaneSignal优先级为0。这个0是**信号请求的默认值**，与普通车辆的100优先级不是同一概念。普通铁路道口不启用CanExtend，轨道默认优先级-1。

原代码最多显示16组，mask位移使用 `index&15`。模块保留16位回绕语义，没有自行把第17组静默删除。groupCount<=1时，源行人分支会增加一个组，即使行人列表为空；此行为也由原DLL测试确认。

## 行人和特殊节点的边界

行人初始可参与全部车辆组；对真正LaneOverlap表中冲突的车辆组清除相应mask，若所有组都不适合，增加共用的独立行人组。转弯lane根据其起止方向和行人方向有额外排除逻辑；unsafe行人lane跳过这套重叠排除。

没有overlap输入时，模块按原“没有Overlap buffer”的分支处理，不能声称已经建立了真实行人冲突关系。当前RoadLab若只提供小汽车movement，行人分支只是可调用基础，并不意味着游戏已经有行人实体、过街需求和避让。

可开合桥梁使用源码另一个 `ProcessMoveableBridgeLanes` 分支，依赖真实PathNode连接、MoveableBridgeData及其主/子节点关系，当前模块没有伪装支持它。master/slave范围的实际ECS查找由网络适配器负责；本模块只接收已解码组。

## 原DLL完整分组验证

数值fixture位于 `tests/fixtures/cs2-signal-groups-oracle.json`。本机可复现项目为 `/home/bhw/repos/roadlab-reverse/oracle-signal-groups/OracleSignalGroups.csproj`。

验证程序载入用户原Game.dll，使用CLR真实布局给LaneGroup、UnsafeList和NativeList预分配足够内存，再通过反射**直接执行原私有ProcessVehicleLaneGroups和ProcessPedestrianLaneGroups**。当前分支只用到列表读写/交换删除，预分配后无需运行Unity引擎或替换原算法。内存大小和写入由CLR `sizeof/stobj` 决定，没有用默认Marshal布尔尺寸猜测原结构体布局。

8个直接原DLL场景包括普通十字全转向、T口、无直行Y口、斜交、单进口、铁路道口、17组mask回绕、单进口独立行人组。测试逐个核对完整成员mask和组数；另有CanExtend/default分支、master展开和行人overlap测试。后几项是源码分支对应的TS功能测试，不能冒充原完整ECS初始化器的运行结果。

运行 `npx vitest run tests/cs2-signal-groups.test.ts`。完整游戏交通一致性仍需网络组输入、状态机、车辆冲突/优先权、需求与实际轨迹共同验证，不能由这8个分组场景推导整个交通系统完全一致。
