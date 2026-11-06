# CS2 车辆帧运行时

`Cs2VehicleRuntime` 实际持有和推进车辆状态，将已核对的正常导航目标、向量移动与显示插值接到同一个运行循环。它不执行旧的沿路弧长梯形积分，也不在内部采用 IDM/MOBIL 决策。

## 原系统顺序

所提供程序集的 `Game.Common.SystemOrder` 按顺序注册 `CarNavigationSystem`、其 Actions、各类车辆 owner AI、`CarMoveSystem`、`CarTrailerMoveSystem`。`UpdateSystem.SystemData.CompareTo` 在相同阶段按注册顺序排序。

本运行时相应地先为本组所有车辆计算导航，再执行显式的 `afterNavigation` 宿主阶段，最后为本组所有车辆计算移动。速度和冲突决策共享同一份帧开始物理快照，不会因为 JavaScript 逐车循环就让后面的车看到前面车辆已经移动后的状态。

原每辆普通汽车每 16 个 60Hz 模拟帧更新一次，逻辑步长 `4/15` 秒；写入 `(frame >> 4) & 3` 的 TransformFrame 槽。`stepFrame` 维护这个契约。

## 接入接口

```ts
const runtime = new Cs2VehicleRuntime(network.curves, {
  afterNavigation: (vehicle, context) => {
    // 显式执行源预留/owner AI；可返回 current、nextLanes、navigation、
    // carFlags、skipMotion 或 remove。
  },
});

runtime.addVehicle({
  id,
  updateGroup,
  car,
  geometry: { width, frontExtent, pivotOffset },
  state,
  navigation,
  current,
  nextLanes,
  seed,
});

const result = runtime.stepFrame(absolute60HzFrame, (vehicle, context) => ({
  maxSpeed,
  random01,
  oncoming,
  canChangeLane,
  temporaryBlocker,
  upcomingTurnFlags,
  // current/nextLanes 可接收源 lane selection 与全局路径窗口更新。
  selectNextLane: network.nextLane,
}));
```

构造器 `initialFrame` 是第一帧要处理的编号，默认 0；处理前的 `runtime.frame` 因而为 -1。`stepFrame` 对重复的当前帧不再执行决策或移动，跳过中间帧则明确报错。`advanceToFrame(target, decide)` 会逐一处理所有遗漏的逻辑帧并返回逐帧结果数组，不以大 delta 替代。

车辆 ID 可以是数字或字符串；车道 ID 独立为不解析内容的稳定字符串。车辆必须沿实际 physical/slave 车道和 node 曲线行驶，不沿寻路 master 的虚拟中心线行驶。带 `isMaster` 的曲线会在入口明确拒绝。

`current.curvePosition.x` 是前视目标游标，不能当作车辆实际 s。物理状态来自 `physicalState(id)` 或 `getVehicle(id).state`；目标和队列状态由目标阶段保存。`cs2MoveCar.localNavigation` 的局部修改不会写回持久导航组件。

## 显式决策与事件

决策回调必须给出速度迭代器结果 `maxSpeed` 和导航随机流样本 `random01`，可提供 oncoming、换道许可、临时阻塞、转向标记、光照和当前/后续车道状态更新。运行时没有隐藏的启发式跟车或换道模型。

`afterNavigation` 接收所有本组目标结果的 `navigationSnapshot`，用于继续执行源预留与 owner AI。它能回传 current/nextLanes，因而可以在目标计算后更新源 `ReserveNavigationLanes` 的 y 预留终点；也可回传导航或车辆标志，停止本次移动，或请求删除。帧内不能通过其他方法直接改运行时，所有变更先计算、后提交。

事件包括车道流量统计、裸 EndReached 变化、灯光效果变化、完整更新请求、特殊目标等待和 owner 删除。裸 `end-reached` 事件不能直接作为全路径到达判断：原 `VehicleUtils.PathEndReached` 要求 `(flags & (EndOfPath | EndReached | ParkingSpace | Waypoint)) === (EndOfPath | EndReached)`。最多 12 条的前视窗口必须在目标阶段前补充，窗口尾不是最终目的地。

特殊 Area、停车和 TransformTarget 仍需要各自世界组件处理。遇到 `deferredLane` 会发出明确事件并暂不使用普通道路运动内核推进该车；宿主处理后可继续，不能把它静默伪装成已恢复的特殊行为。

## 四槽帧初始化与完整更新

原 `UpdateGroupSystem` 新建正常车辆时，用出生 Transform 构造四个帧：位置和旋转为出生值，帧速度和 flags 为零。车辆自身的 Moving 速度可以非零；不要把这个物理初速擅自复制到四个出生帧。

加载时，原 `TransformFrameSystem.InitTransformFrames` 以当前位置/速度按槽回溯历史位置。`frameInitialization: "loaded"` 保留已有 flags、stateTimer 等字段，但重建位置/速度/旋转；`initializationFrame` 指定原加载阶段的准确模拟帧。普通传入完整四槽且未指定 loaded 模式，则表示恢复已经初始化的运行时快照。

`CarMoveJob` 的 `ForceFullUpdate` 会通过命令队列安排 Updated 与子对象更新，不是立即清空帧。因此运行时只设置 `fullUpdatePending` 并发出请求。宿主在相应修改 barrier 阶段调用 `applyFullUpdate(id, state?, editorMode?, sourceFrame?)`；它按原 `MovingObjectsUpdatedJob` 重置四槽的位置、零帧速度、flags 与 stateTimer 槽序，编辑器模式按原式保留 flags。不要在决策回调内立即执行它。

灯光的 `effects-updated` 另按四槽 aggregate flags 比较计算，不会因为某一槽变化就错误地触发整车效果重建。

## 更新组分配与显示

原新车更新组不是简单 `id & 15`。`UpdateGroupJob.FindUpdateIndex` 优先使用已有 controller/指定 prefab 组，否则选择当前数量最少的组，同数量取最小索引。运行时接受显式 updateGroup；未给定时用其普通车辆群体的 least-populated 分配器。真实世界其他实体、prefab 和 layout 的组信息仍应由宿主传入。

`displayPose(id, frameTime, renderFrame?)` 仅读四槽，使用原 `CalculateUpdateFrames` 和三次位置／四元数插值。显示调用不改任何物理、导航、随机数或帧缓冲状态。宿主必须分别使用物理 pose 做交通判断、display pose 做显示，并将自己的渲染时钟与模拟帧正确对应。

几何必须显式提供。源码 `VehicleInitializeSystem` 的 pivot 优先使用非转向轮平均 z，其次转向轮平均 z，没有轮骨架才用车长乘 -0.2；本模块没有把测试中的 -2 米当作游戏车型默认值。

## 验证与边界

执行 `npx vitest run tests/cs2-vehicle-runtime.test.ts`。

独立 C# oracle 在 `/home/bhw/repos/roadlab-reverse/oracles/vehicle-runtime/`。它组合自动提取的正常目标阶段与移动原片段，调用原 DLL 的速度、曲率、帧构造和显示方法；数组适配原帧缓冲与分组选择。fixture 保存原程序集和提取片段身份。这不是完整 Unity World 或 Burst 原生 job 的执行。

10 项测试覆盖：160 个连续逻辑帧 × 2 辆车的物理状态、持久导航、车道队列、四槽 flags/stateTimer 和 display pose；96 组创建/加载/更新/编辑器帧初始化；源分组选择；以及 20、30、60、144 渲染 FPS 下最终状态逐字段完全相等。轨迹包含跨短 node 的持续换道、停车、夜灯和显式完整帧重置。

另外检查整组阶段顺序、同帧旧物理快照、重复帧、无丢帧补齐、局部导航不写回、完整更新请求、末端误删保护及读取显示不影响模拟。

运行时已把普通车辆的这些内核接成可执行状态机。完整源速度/路口/信号查询、路径 owner、12lane 窗口补充、实际车身碰撞、世界 barrier、车队布局、原车型资源及特殊 Area/停车行为仍需宿主系统接入验证；这些组合测试不能证明整座城市交通已经完全复刻。
