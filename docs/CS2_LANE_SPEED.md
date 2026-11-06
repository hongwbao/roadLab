# 普通汽车的完整 lane speed iterator

`src/simulation/cs2-lane-speed.ts` 实现用户提供的 `Game.Simulation.CarLaneSpeedIterator` 普通汽车方法链。它每次导航决策创建一个状态迭代器，按顺序检查当前车道、正在切入的车道、后续车道与重叠车道，最终输出速度、阻挡对象、换道可行性和对向响应。它不是按整路口加锁，也不是将已有5秒预测或倒退恢复改名。

源程序集：`Game.dll` **1.6.0f1 (419.d6c6) [6216.19404]**，SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。本地来源 `/home/bhw/repos/roadlab-reverse/decompiled/focus/Game.Simulation.CarLaneSpeedIterator.cs`，共1547行；反编译产物不加入项目仓库。

## 已实现的方法链

| 原方法                                        | 模块对应                | 范围                                                                                                            |
| --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `IterateFirstLane` 单曲线 overload，源118行   | `iterateFirstLane`      | 当前位置到目标游标的距离、车道速度/弯曲/磨损、102级预约减速、caution、Current和Overlap扫描、距离推进与终止。    |
| `IterateFirstLane` 双曲线 overload，源242行   | `iterateChangingLane`   | 两车道插值位置；changeProgress<0.9检查旧车道；新车道总被检查；progress=0调用带 canUseLane 的 Current overload。 |
| `IterateNextLane`，源366行                    | `iterateNextLane`       | Approach传播、信号/停止规则、下游空间、分支特定速度clamp、Current/Overlap扫描、累计距离与终止。                 |
| `CheckSpace`，源642行                         | 私有同名逻辑            | 当前路口、合流方向上的队列和多个后续道路的真实空间检查，直到足够容量、源边界或队列耗尽。                        |
| `CheckOverlapSpace`，源926行                  | 私有同名逻辑            | RequestSpace=96分支，考虑当前与下一车道、队列长度、末车后界和制动距离。                                         |
| `CheckCurrentLane` 两 overload，源1103/1131行 | `checkCurrentLane`      | 使用LaneObject的目标/预约区间判断前后，不把物理s代入；区分Continuing/Oncoming；初始切入检查后车车身占用。       |
| `CheckOverlappingLanes`，源1172行             | `checkOverlappingLanes` | 原byte窗口、两桶预约、优先级/信号覆盖、合流方向、环岛临时记忆、对象无条件扫描。                                 |
| `GetObjectSpeed`，源1393行                    | `objectSpeed`           | Moving.velocity在该对象游标处的完整3D车道切线上的投影。                                                         |
| `UpdateMaxSpeed`，源1433行                    | `updateMaxSpeed`        | 源车身后界投影、曲线/世界位置的较近距离、前段位置补偿、双方制动差异、IgnoreBlocker/Oncoming。                   |
| `IterateTarget` 两 overload，源623/629行      | `iterateTarget`         | 默认目标速度或显式速度的制动，以及目标终点前的停车速度。                                                        |

原始方法token与IL SHA256保存在fixture provenance；关键入口：

- First单曲线 `100695263`：`ad14d882571f5437d3b7f558fb9c99315f7af8adab1d8ce6c63015ede3b4d9a6`。
- First双曲线 `100695264`：`abaeb7e61fea025476e12d56b434ca350192c8a735b555d90f46434f0000b74a`。
- Next `100695265`：`3e079dbf67caba85524535fbabd968056f0f82edda8aa8c04bd3d8b6b4fa79b1`。
- Overlap `100695274`：`85b58f467c5d315b7ca367e7cb34c5eacf67049ebd981ff074cff0dd95490554`。
- UpdateMaxSpeed `100695277`：`ccfa22f79e39dcac4fdb48ac62df9642738b581460b2763a25e94f68a3e7f9b1`。

## 世界快照接口

```ts
const world: CS2LaneSpeedWorld = {
  lanes: new Map<string, CS2LaneSpeedLane>(),
  objects: new Map<string, CS2LaneSpeedObject>(),
};
```

每条lane显式提供：

- `curve`：实际物理车道的 `CS2NavigationCurve`，包括四个Bezier控制点、米制长度、width与NodeLane widthOffset。不能传虚拟master的运动轨迹。
- `carLane`：源Net.CarLane `{flags,speedLimit,curviness,cautionStart?,cautionEnd?}`。速度m/s、弯曲度源单位，caution为byte边界，缺省255/0表示没有caution。
- `condition?: {wear}`：源LaneCondition磨损。
- `signal?: {type,flags,blocker}`：原None=0、Stop=1、SafeStop=2、Yield=3、Go=4；Physical=2。
- `reservation?`：直接复用 `CS2LaneReservation` 的previous/next两桶byte值，不把offset重新当0..1量化。
- `objects?: [{object,curvePosition:[x,y]}]`：原LaneObject buffer。运行时由 `NetUtils.AddLaneObject/UpdateLaneObject` 按预约末端 `curvePosition.y` 维护；保留真实 buffer 顺序以及相等 y 时的插入/更新顺序。`LaneObject.CompareTo` 使用 x，但普通命令更新并不调用它，不能据此重排运行时 buffer。对象还必须存在于 world.objects。
- `overlaps?: (CS2LaneOverlap & {other})[]`：复用已对照的byte窗口/parallelism/priorityDelta/flags，再加对方lane ID。窗口是源量化结果，parallelism是0..255的byte，不能传未量化dot值。

每个object提供 `kind,position,velocity?,geometry?,car?,controller?,emergency?`。`geometry={min,max,size}` 为完整源ObjectGeometryData bounds/size；`car` 为其有效Prefab CarData。`controller` 保留源Controller实体身份，源Car状态Emergency决定108/100优先级。缺少Moving意味着速度0；CarData与Geometry是否存在分别保留，不因对象名或外观补造组件。

这些对象数据将源PrefabRef→Prefab CarData/Geometry查询**预先解引用为有效值**。它没有改变普通car分支的值语义；若需要共享prefab动态修改，调用者负责在同一快照中传递一致的新值。普通汽车分支读取Transform.position，不读取其rotation；原旋转相关的行人检查属于暂缓部分，没有用车辆角度猜造行人判定。

Bezier几何按原float3数值缓存一次，避免将RoadLab拟合出的double控制点直接当Unity float3。曲线对象必须在该网络revision内保持不可变；几何编辑应建立新曲线对象。其余源算术明确使用float32；flags/byte/实体标识仍是整数或opaque string，不进行float32位掩码转换。

## 构造与调用顺序

```ts
const iterator = new CS2CarLaneSpeedIterator(world, {
  entity,
  ignore: ignoredBlocker ?? null,
  priority,
  timeStep: 4 / 15,
  safeTimeStep: 4 / 15 + safetyTime,
  distanceOffset,
  speedLimitFactor,
  currentSpeed,
  prefabCar,
  prefabGeometry,
  speedRange,
  maxSpeed: speedRange.max,
  canChangeLane: 1,
  currentPosition: physicalTransformPosition,
});

let result = current.changeLaneId
  ? iterator.iterateChangingLane({
      lane1,
      lane2,
      curveOffset,
      nextLane,
      nextOffset,
      laneDelta: current.changeProgress,
      laneOffset1,
      laneOffset2,
      requestSpace,
    })
  : iterator.iterateFirstLane({
      lane,
      curveOffset,
      nextLane,
      nextOffset,
      laneOffset,
      requestSpace,
    });

for (let index = 0; !result.stop && index < queue.length; index++) {
  const next = queue[index];
  const same =
    next.laneId === current.laneId || next.laneId === current.changeLaneId;
  result = iterator.iterateNextLane({
    lane: next.laneId,
    curveOffset: [next.start, next.end],
    laneOffset,
    minOffset: same ? current.curvePosition.y : next.end < next.start ? 2 : -1,
    nextLanes: queue
      .slice(index + 1)
      .map((q) => ({ lane: q.laneId, curvePosition: [q.start, q.end] })),
    requestSpace: nextRequestSpace,
    laneFlags: result.laneFlags,
  });
}
```

对应原CarNavigationSystem：初始化见1518–1558行，First/Changing见1626–1631行，未来lane的 `minOffset` 见2050行。原 `math.select(-1,2,reverse)` 表示**正向−1、反向2**；当前/换道lane再次出现在队列时用current.y。不能默认传0，也不能颠倒两端。

`curveOffset.x` 是导航目标游标，`.y` 是预约终点，`.z` 是当前路径区间末端；它们不是车辆物理弧长s。LaneObject.x/y同样来自原当前导航状态，不是nearest物理投影。当车辆正在变道，可在两个车道的buffer中出现，Controller/自身排除逻辑保留。

`laneOffset` 是由源 `GetLaneOffset` 用 lanePosition、车宽、NodeLane widthOffset 算好的**米数**。单曲线First在反向时翻转它；双曲线First保留两个传入偏移的原顺序，不能再自行统一翻转。迭代器不将标准化lanePosition误当横向米偏移。

每次调用返回 `{stop,laneFlags,needSignal}`：stop是该方法链是否已经看够制动距离或到达min speed，应结束继续扫描；needSignal由Next返回，用于原信号请求队列。laneFlags是**Game.Net.CarLaneFlags**，原样传给下一个Next作为上游Approach上下文。它不是Vehicles.CarLaneFlags，不能写入导航队列flags。

最终 `iterator.state` 包含 `maxSpeed,blocker,blockerType,canChangeLane,oncoming`，以及用于精确对照的distance、previousDistance、previousPosition、当前工作lane/curveOffset、nextOffset、环岛临时记忆。BlockerType是原数值：None0、Continuing1、Crossing2、Signal3、Temporary4、Limit5、Caution6、Spawn7、Oncoming8。oncoming保留原数值，可能大于1；调用者应按原导航目标代码使用，不能在本模块偷偷clamp。

这是**一次导航决策**的可变迭代器，不能跨帧持续累积distance。环岛temporaryLanes在同一次First→Next方法链保留；原CarNav在一次决策结束时清空临时buffer。

## 保留的关键控制流

- `CheckCurrentLane` 根据对象x/y预约区间判断前后，然后才使用Transform的实际位置和车身rear求速度。相同物理位置，预约终点不同，可产生不同对象可见性；这正是不能把physical s代替cursor的原因。
- `UpdateMaxSpeed` 同时考虑曲线位置、世界位置、前一段位置与累计距离，取源代码规定的较近距离，扣掉对象 `−bounds.min.z`。它不是简单的“同车道s差−半车长”。
- 对方仍在前进时，先扣对方 `braking*timeStep*2`；本车刹车更强/相等与更弱时使用不同的结果速度/额外制动距离公式。
- 普通car的安全留距是源0.9m，并包含前界 `−self.bounds.max.z` 与低速distanceOffset；没有额外5秒预测间距。
- 初始changeProgress=0时，邻车即使落在“后方”的预约区间，也会用其车身前界否定切入；已经进入变道时，原方法使用另一个Current overload，不重新用此门槛取消。
- 重叠扫描的reservation判断与对象扫描分开。源 `IL_051f` 无条件进入LaneObjects；优先级、是否已进入窗口、merge flags或环岛临时列表跳过预约检查，都不意味着跳过车身检查。
- 更高优先级对象的预约终点按原 `objectSpeed*2/max(1,curveLength)` 扩展。普通相等优先级不因任意pair排序而获得两秒预测。
- reservation=96时可检查是否有足够驶出空间；队列长度与停车后界来自实际对象，CheckSpace可跨多个短后继车道继续寻找容量。
- 上游没有Approach时，Next会按源清除本地Stop/TrafficLights等入场处理；这依赖网络/engine准确传播Approach，不应把信号静态挂在每个未来lane后强行逐段停车。
- Stop与SafeStop使用当前速度、**dt=0**制动距离决定能否在信号前停住；Stop额外允许1m差值；紧急车只有非Physical信号可豁免。
- IgnoreBlocker将该对象导致的低于3m/s上限抬到3，之后仍按speedRange clamp；Oncoming同样有3m/s下界，但清空blocker实体并输出Oncoming类型/因子。
- `PushBlockers` 在普通car的这些方法体中没有另加“强行穿过车辆”分支，它影响源行人逻辑。传入该字段不会被误用为取消普通汽车车身检查。

## Oracle：原方法体与原DLL数学的边界

`/home/bhw/repos/roadlab-reverse/oracles/lane-speed/` 包含可重复的 `extract.py`、`generate.py`、C#项目与harness：

1. 自动读取完整导出的原struct，重命名namespace/struct；所有普通car入口和私有方法体保持原文。
2. namespace-local `ComponentLookup<T>`、`BufferLookup<T>`、`DynamicBuffer<T>`、`NativeArray<T>`、`NativeList<T>` 用托管字典/数组替代Unity native容器。
3. 普通car之外的 `CheckParkingLane` 显式抛NotSupportedException，原因是其 `VehicleUtils.GetParkingSize` 参数要求原生ECS lookup。这一处差异逐项记录于provenance，不将stub伪装为停车复现。
4. 原 `Unity.Mathematics`、`Colossal.Mathematics`、`Game.Vehicles.VehicleUtils` DLL方法仍直接执行，没有复制成同一个TS实现作为oracle。
5. 用相同世界DTO执行First/Changing→Next→Next→Target，保存每一步返回值及完整私有状态。provenance包括原文件SHA、程序集身份、所有方法token/IL SHA。

因此整体iterator对照是 **source-extracted + dictionary ECS adapter oracle**，不是“独立进程直接运行原Native ECS iterator”。其数学/VehicleUtils子调用才是原DLL执行。无Unity环境没有执行原ECS调度/真实NativeBuffer生命周期。

目前fixture有**436个场景、1744次入口调用**：240个有固定种子的组合场景，加上前车速度/车身位置、两个制动强度、双曲线0/0.9边界、红灯/黄灯/紧急/物理灯、merge/window/priority/requestSpace、反向/对向、环岛记忆、跨多个出口lane、IgnoreBlocker、游标与物理坐标分离、两个目标overload及Unspawned有无对照等定向场景。每步返回值、实体、类型与布尔分支精确比较；浮点内部状态使用约数个ULP的显式容差，未以宽松速度区间代替状态对照。独立测试共443项通过。

`CS2LaneSpeedObject.unspawned` 保留真实组件输入；C# harness按每个对象的flag实际填充m_UnspawnedData字典，而不是写死HasComponent=false。源1062行的跳过条件属于**CheckParkingLane**；普通Current、Overlap与CheckOverlapSpace没有这项过滤。三组有/无Unspawned向量逐步返回与状态相同，明确防止把停车的过滤误加到普通交通。出生可见性仍由PersonalCarAI/CheckUnspawned维护，不能以此全局删除普通LaneObject扫描中的对象。

```sh
npx vitest run tests/cs2-lane-speed.test.ts
```

## 明确暂缓

- 自行车的0.4m留距、半车长队列压缩和横向推挤；火车bogie/attach rear与TrainData制动；行人Line overlap/朝向与Temporary阻挡；停车lane与车辆停放。DTO发现这些kind或lane类型时抛明确unsupported错误，不默认为普通car。普通静态道路物体仍可按无Moving/无CarData的原分支参与阻挡。
- 网络几何/byte LaneOverlap生成、LaneObject登记、预约发布/16帧轮换、信号分组与请求消费、车辆物理积分、Stuck链与DummyTraffic失败行程由各自模块负责。启用本迭代器时，应移除另一套controller的重复限速，避免两个不同模型同时约束车辆。
- 不能根据上述方法链测试声称整城性能、原资产车辆参数、全部事故/交通参与者或整个天际线AI已经完整复现。实际engine必须使用同一网络的slave曲线和源当前/预约游标，才能让已验证分支在仿真中产生对应行为。
