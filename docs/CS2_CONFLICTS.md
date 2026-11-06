# CS2 车道重叠、预约与阻塞恢复

本模块依据用户提供的 `Managed.zip` 中 CS2 **1.6.0f1 (419.d6c6)**，不把 RoadLab 原有的 5 秒轨迹预测、成对先行承诺或短距离倒车称为天际线实现。

程序集 `Game.dll` SHA256 为 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID 为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`。完整反编译保存在本机 `/home/bhw/repos/roadlab-reverse/decompiled/`，未加入项目仓库。

## 原始决策链

1. `Game.Net.LaneOverlapSystem` 对车道曲线和宽度建立重叠范围、合流标志、平行系数及优先权差。每个范围端点量化为 byte；`CarLaneSpeedIterator.CheckOverlappingLanes` 用 `0.003921569f` 恢复归一化曲线坐标，平行系数用 unsigned byte 除以 128。它不是整路口互斥锁。
2. 当前范围后方的重叠以及 `Water` 重叠被跳过。正向、反向对应不同的 `MergeStart/MergeEnd/MergeMiddle*` 掩码；合流类型决定继续跟车还是横向冲突。自车和由自车控制的拖车被过滤。
3. 普通车优先权 100，紧急车 108；列车/地铁 110，其他轨道车 104。当前车道存在至少 108 的预约时，低于 106 的自车临时按 106 处理。紧急车还会用 102 请求同组其他车道让路。
4. 道路间优先权先比较 Stop、Yield、RightOfWay、Unsafe 标志，Approach 车道先清除前三种标志；没有这些差别时，按重叠中点处两条曲线的切线方向和左右行制计算 `PriorityDelta`。对应的反向重叠记录取相反的差值。
5. 他车道信号 Stop 令本次 `yieldOverride` 加一，Yield 减一；非零覆盖几何优先差。请求空间时不承受正向让行差。若他车道预约的 offset 已超过本次阈值，或 priority 高于本车的有效优先权，则使用源制动公式限制速度。这里只检查实际相交车道的范围。
6. 没有硬预约阻挡、但本路应让行或重叠含 Slow 时，可在仍不低于道路限速一半的范围内提前减速观察。该分支与硬制动使用不同的限幅方式，端口保留了区别。
7. 他车 priority 高于本车时，满足原范围条件才将其 `curvePosition.y` 推进 `speed * 2 / max(1, laneLength)`。普通车并不统一预测未来五秒；他车原来的 y 本身已经包含导航/制动占用范围。
8. 他车道预约 priority 恰为 96、自车还能在重叠前刹停且没有 RequestSpace 时，再执行 `CheckOverlapSpace`，避免把冲突区域堵死。

## 预约生命周期

`Game.Net.LaneReservation` 有 previous 和 next 两个桶，读取时分别取两桶 offset 和 priority 的最大值。它们不要求来自同一辆车，不能把它简化成一个“占用者 ID”。

`CarNavigationSystem.UpdateLaneReservationsJob` 独立累积 next 的两个最大值；新请求的 priority 超过 next、且不低于 previous 时清除旧 blocker。`NetLaneReservationSystem` 按 `frameIndex % 16` 分桶轮换：next priority 低于 previous 时清 blocker，然后 previous=next、next 清零。

`ReserveNavigationLanes` 用导航目标速度的制动距离减 0.01 米决定前方预约范围，沿下一条及后续车道扣除长度；不是固定秒数的轨迹图。RequestSpace 发布 `(offset=0, priority=96)`，紧急车及环岛有额外向前预约分支。

## 出口空间

`CheckOverlapSpace` 从当前车道剩余长度开始，必要时把下一条道路车道加入。自车长度加一米，沿缓冲区顺序累加前方移动物体长度与间距；自行车使用半米间距，连续自行车允许更紧凑占用。

找到到达重叠终点的物体，或下一条车道的首个物体后，沿重叠终点切线投影其车身后端；其正向速度大于 0.001 时还加入该车的制动距离。可用距离大于等于需求才算通过。因此它比“出口车道有车就不走”细，也依赖实际车身和几何。

`cs2CheckOverlapSpace` 端口接收已经完成自车/拖车过滤的对象序列，以及调用方投影得到的车身后端距离。`blockerRearDistance` 应已经加入源规则中的前车制动距离。它没有伪造 Unity 的 ComponentLookup。

## 卡住时的源行为

- `CheckBlocker` 用 `round(maxSpeed * 2.2949998f)` 量化速度为 byte；后续阈值 6 指这个 byte，不是 6m/s。
- `StuckMovingObjectSystem` 跳过空 blocker 和 Temporary。汽车被 Crossing 车阻挡时，先向对方（必要时其 controller）设置 RequestSpace；之后仅对低于 byte 6 的阻塞链检测循环。
- 阻塞链遇到自己、出行目标/所乘车辆，或追踪达到 100 条就判断卡住；途中遇到空 blocker、Temporary 或速度 byte 至少 6 则停止。路径不在 Pending 时标记 `PathFlags.Stuck`，由后续车辆 AI 处理。这个过程不会命令汽车倒车。
- `CarNavigationSystem` 重新选车道时发现 IsBlocked 但路径本身仍可走，会设置 IgnoreBlocker；障碍物变化时清掉。`UpdateMaxSpeed` 遇到对应 blocker 时，会把小于 3m/s 的制动目标提高到 3m/s，再按当前加减速范围限幅。Oncoming 也有至少 3m/s 与转向修正。原生逻辑的这种低速试探与 RoadLab 的绝不重叠保护可能冲突，不能声称同时保留后就完全等价。
- Temporary 主要是行人：持续至少五秒后允许 PushBlockers；它也不是通用的路口死锁解决器。

## VehicleCollisionIterator 的适用范围

`IterateFirstLane` **只有当前车道是 AreaLane 才扫描四叉树**。普通道路的交通冲突主要由上述车道对象和 LaneOverlap 处理，不能把所有道路上逐车身矩形否决移动称为同一套算法。

AreaLane 扫描会过滤自身、WalkThrough、creature 和由自车控制的物体；移动物体使用当前位置到目标的线段，与他车一秒速度线段的距离，结合当前步长作前后过滤。两者半宽之和加 0.5 米构成接近半径。接近时会把导航目标侧向推开，推力从 0.75 开始逐次减半，并把目标约束在区域多边形内。随后按相对方向、最近距离和近距离前后关系计算速度上限。静态物体使用另外的几何半径与 0.25 米余量，只推开目标，不执行同一个移动物体限速分支。

`cs2AreaCollisionLimit` 仅移植已取得这些几何量后的移动物体限速部分；区域多边形、地形采样、四叉树和完整侧向推开尚不在此标量模块中。

## API 与验证

`src/simulation/cs2-conflicts.ts` 提供量化、两桶预约、道路优先差、重叠窗口、预约限速、较高优先车辆的两秒范围延伸、出口空间、blocker 低速处理和循环链检测。调用方仍需提供真实车道几何与车辆状态；`cs2OverlapDecision` 只能在 `cs2OverlapWindow` 判定该范围仍相关且需要预约判断时使用。

`tests/fixtures/cs2-conflicts-oracle.json` 明确分两种来源：

- **544 条直接原始 DLL 执行向量**：四类 VehicleUtils.GetPriority、LaneReservation 构造与 getter、LaneOverlap 构造。使用 .NET 8 反射调用原文件，没有改写成同名的 C# oracle。
- **384 条单独编译的 C# 源提取向量**：CheckOverlappingLanes 预约决策的标量分支。它们用于交叉语言验证，不能描述为完整 Unity 方法执行。

生成器保存在 `/home/bhw/repos/roadlab-reverse/oracles/conflicts/`。可复现命令：

```bash
DOTNET_ROOT=/home/bhw/repos/roadlab-reverse/tools/dotnet \
  /home/bhw/repos/roadlab-reverse/tools/dotnet/dotnet run \
  --project /home/bhw/repos/roadlab-reverse/oracles/conflicts -- \
  /home/bhw/repos/roadlab-reverse/extraction/Managed \
  /home/bhw/repos/interchange-lab/tests/fixtures/cs2-conflicts-oracle.json
npx vitest run tests/cs2-conflicts.test.ts
```

这些测试还覆盖非冲突车流、合流/反向窗口、出口存车空间、byte 量化边界、恢复链路与区域限速。它们没有运行游戏，也没有证明整个路口系统等价。

尚需由适配层及后续工作补全：精确原生 Bezier/车道宽度重叠生成、环岛去重的临时车道列表、完整车道图上的预约传播、train/trailer/bicycle/pedestrian 几何和 ECS 分桶调度。现有 source-inspired 折线几何适配必须与此标量端口分开标注。
