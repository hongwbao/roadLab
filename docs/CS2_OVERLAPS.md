# 路口 LaneOverlap 浏览器适配

`CS2OverlapController` 把当前 RoadLab 的 movement connector 接到 `cs2-conflicts.ts` 中从用户提供的 CS2 1.6.0f1 恢复的标量决策。它提供可运行的实际适配；完整原生 Bezier/车道资产/ECS 调度还没有在浏览器重建，不能把适配层称为原游戏整个系统的逐位移植。

## 几何输入

`configure(movements)` 接收每条 connector 的 21 个中心线点，首点对应 `s=0`，末点对应 connector 的总弧长。RoadLab 原始 `Movement.points` 如包含前后各 2.2 米的延伸点，集成者必须去掉首尾两个点再传入。不能让弧长原点与车辆 `s` 混用。

同一个 junction 内的 movement 两两分析一次。适配器用折线段胶囊距离求各自进入、离开相交区域的弧长范围，并生成源 `LaneOverlap` 格式的 byte 端点、平行度与优先权差。相同 from/to 对应 MergeStart/MergeEnd。每个 movement 可以有多个相交窗口，不会因路口任意位置有车而全部禁止进入。

当前缺少原始车道资产断面时，通道宽度默认 3.2 米，可用 movement.laneWidth 覆盖；高度差超过 1.8 米视为独立。这两个默认值是 RoadLab 几何适配参数，不是从 Game.dll 证明的原游戏常量。原始系统使用 Bezier、实际车道半径与倾角；这里使用折线胶囊和中点切线近似平行度，环形曲线的多段不连续接触可能被合并成一个范围。

道路优先权差实际调用 `cs2LanePriorityDelta`，遵循原 Stop/Yield/RightOfWay/Unsafe 优先及左右行切线规则。`laneFlags` 使用原 Game.Net.CarLaneFlags 数值；没有道路标志时只使用切线侧向关系。当前地图如未提供停车让行标志，不会假设这些功能已经存在。

## 每车输入和输出

`plan(agents, elapsed)` 的 elapsed 是绝对模拟秒数。车辆输入：

- `id`：当前车辆数字 ID；`movement`：movement.id。
- `s`：入口之前为负，connector 内为 0..length，离开后继续大于 length。
- `speed`、`length`、`car`：实际速度、车长和 `CS2CarData`；`freeSpeed` 可提供道路速度上限。
- `signal`：原 LaneSignalType 0..4。Stop/SafeStop 且仍在入口之前的车辆不会预约入口之后的范围；已进入 connector 的车辆继续清空。
- `canExit` 与可选 `exitSpace`：接收车道的容量与投影可用距离；供 normal CheckSpace / RequestSpace 逻辑使用。
- 可选 `navigationSpeed` 是已计算的导航目标速度，`safeTimeStep` 是本车安全时间；普通 priority 默认 100，emergency 为 108。

返回 `Map<number, CS2OverlapDirective>`：

- `maxSpeed` 是源决策得到的当前速度上限，需继续送入源驾驶积分；它已经参考 `CalculateSpeedRange`。
- `stopS` 是在同一个 movement 坐标系里的停止位置，可能在入口之后的实际重叠区域之前。移动前车通常只产生速度约束，不把它当作静止墙。
- `blocker` 与 `blockerType` 标明实际车辆阻挡；纯预约阻挡可能没有车辆 ID，与原 `Entity.Null` 情况对应。
- `requestSpace` 与 `stuck` 来自源预约及 blocker 链状态。集成者可针对 stuck 重排路径；这里没有负向移动指令。

`width` 字段为后续更精细的车身适配预留，当前静态 overlap 由 movement 的车道宽度生成，最终车身几何保护由集成者处理。

## 实际决策流程

1. 每个 movement 维护原 previous/next 两桶预约。将模拟秒数映射到 60Hz frame，并按 movement ID 的稳定 0..15 bucket 轮换。源游戏基于真实 lane entity 的 UpdateFrame；这里的 ID 分桶是适配。
2. 按车辆 ID 的稳定顺序处理当前 snapshot。根据原 speed range、同向跟车与出口空间得到初始导航速度范围。稳定次序用于浏览器可复现，不代表 Unity chunk/job 的原执行顺序，也不是额外的成对先行承诺。
3. 用 `cs2OverlapWindow` 解读 byte 窗口，跳过水面、已经驶过和不同高度的车道。仅在自车前端还没进入相交范围时检查该范围的预约。
4. 用原 `cs2OverlapDecision` 比较预约 offset/priority、道路让行差和接收车道空间，并用 `cs2OverlapVehicleWindow` 对较高优先车辆追加源两秒项。实际在相交范围内的车辆也形成阻挡；合流/分流共享范围使用源跟车公式。
5. 用已经限制的导航目标速度计算原制动距离，向尚未进入的未来 movement 发布 100/108 预约；已经进入的当前 movement 主要通过车道物体窗口占用表示，不错误地持续给当前 lane 发布 100。RequestSpace 发布 96。原生系统还会向完整路线图中的后续多条 lane 传播，本适配目前只覆盖已知的 connector。
6. 以源 blocker 速度 byte 和 `cs2StuckCarDecision` 检查链路；Crossing 先向阻挡者请求空间。movement 改变后清理本次 RequestSpace 状态，车辆移除后清理对应记录。

同一 movement 的前后车和同出口合流也实际调用 `cs2FollowingSpeed`。对向直行和不相交右转没有窗口时直接并行。长时间高需求仍可因接收车道容量和道路能力拥堵。

## 验证范围

运行：

```bash
npx vitest run tests/cs2-overlap-controller.test.ts tests/cs2-conflicts.test.ts
```

适配器的九项场景覆盖：局部量化范围、对向直行、高架分离、不相交右转、交叉先行并最终清空、红灯与绿灯隔离、接收车道溢出、同 movement 跟车、旧预约过期和长期需求。交叉双车场景逐步检查当前两条直线上 3.8×1.65 米矩形车身未重叠；60 车、60 模拟秒的独立场景检查数值有限且至少 16 辆驶过目标距离。

这些是自建 RoadLab 场景，不是原 CS2 运行回放。原始 DLL 标量向量的来源与限制见 `CS2_CONFLICTS.md`。需要由主集成继续验证真实保存地图、曲线车身、密集多车道路口、信号控制、长时间压力以及浏览器性能。

仍未实现原版全部机制：精确 Bezier 交叠区、原 lane entity 分桶与并发、跨完整路线图的预约传播、环岛专用临时表、行人/自行车/列车/拖车几何、完整 AreaLane 侧向避障和实际游戏资产参数。当前浏览器的最终防穿模检查是附加约束，可能比原游戏低速 IgnoreBlocker 试探更保守。
