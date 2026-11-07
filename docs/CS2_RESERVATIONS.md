# 完整汽车导航预约

`cs2-reservations.ts` 恢复提供程序集的 `CarNavigationSystem.UpdateNavigationJob.ReserveNavigationLanes` 与 `ReserveOtherLanesInGroup` 全部方法。调用顺序为目标更新后、车道对象缓存提交前；输出请求仍在批次结束后统一应用，不能逐车写回本次决策世界。

该实现包含普通汽车、反向区间、应急车辆、环岛、旁车道清空、信号请求和 RequestSpace。它不把当前速度或物理最近位置代替 `current.curvePosition.x`；y 是制动预约末端，z 是当前路径区间终点。

## 接口

`cs2ReserveNavigationLanes(world, input)` 返回新的 `current`、`nextLanes`、预约请求、信号请求及随机数状态，输入不被修改。世界显式提供各车道长度、CarLane/Reservation 组件是否存在、信号类型与 Physical 标志，以及 Slave min/max 和 Owner.SubLanes 的真实顺序。缺失组件与数值为零是不同情况。

输入的 `randomState` 是已经初始化的 `Unity.Mathematics.Random.state`，不再进行构造预热。普通非环岛汽车不消耗随机数；应急和环岛分支即使最终没有后继可处理，也按原控制流程消耗对应一次 NextInt。

返回预约 `offset` 和 `priority` 已是原 byte 编码，消费时直接传给两桶预约合并，不再量化。信号请求的 priority 保留原 sbyte 转换。请求顺序与重复请求均保留，不在该模块去重。

## 源行为

- y 由原 `GetBrakingDistance(abs(maxSpeed), 4/15) - .01` 计算，原 1e-6 长度下界和参数偏置保留；超过路径终点才进入后继预约循环。
- 当前或第一个未来车道的 RequestSpace 各自发 96 级请求。
- 普通制动范围内的未来车道设置 Reserved；原方法不会清除范围外既有 Reserved 标志。
- 应急车在当前变道目标或当前车道的同组其他车道发 102 级请求；未来制动范围同样清空同组并请求信号。
- 应急额外前视保留原随机长度、Physical 红灯条件和信号请求。Physical 红灯影响该额外预约，不取消信号请求。
- 环岛额外前视保留原半个制动距离和随机车头余量；遇到非 CarLane 或无 Roundabout 标志的后继即停止。

## 独立证据

本地 oracle 位于 `/home/bhw/repos/roadlab-reverse/oracles/reservations/`。`extract.py` 自动提取两个完整原方法体，正文不改；只把组件、DynamicBuffer 和请求队列宿主替换为托管字典、列表和队列。`VehicleUtils.GetBrakingDistance`、Unity RNG、LaneReservation 与 LaneSignal 构造函数实际执行提供 DLL。不存在将同一份 TypeScript 再运行一次作为预期结果的做法。

源程序集为 1.6.0f1 的 Game.dll，SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。方法 token 分别为 `100695350`、`100695351`，IL SHA 与自动提取正文 SHA 保存在 fixture 的 provenance。

当前 fixture 包含 409 个完整世界场景，逐字段比较当前 y、后继 Reserved、原量化请求及其顺序、信号与随机状态，覆盖不同组件存在性、反向/部分区间、零/极短长度、应急/环岛/空间请求组合及浮点边界。这证明所提供输入上的托管方法对应关系，不表示原 ECS 世界或完整城市交通已经运行等价。

应急车辆的实际任务 AI、道路资产参数、完整环岛几何与世界组件创建仍由各自系统负责；本模块不会因拥有应急预约分支就宣称这些系统已经实现。
