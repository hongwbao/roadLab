# CS2 标量车辆导航移植

本模块根据用户提供的 `Managed.zip` 中托管实现恢复车辆速度决策。当前覆盖普通同向小汽车的速度范围、弯速、制动包络、安全时间与跟车标量分支；完整车辆系统仍包含其他待移植的状态与几何逻辑。

## 来源与可复核身份

- 原程序集：`Game.dll`。
- SHA256：`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`。
- MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。
- 本地完整反编译目录：`/home/bhw/repos/roadlab-reverse/decompiled/Game/`。
- 原始 DLL 对照程序：`/home/bhw/repos/roadlab-reverse/oracles/driving/Program.cs`。
- 提交的数值对照：`tests/fixtures/cs2-driving-oracle.json`，含 384 组直接调用原始 DLL 的输入输出、方法 token 和数学依赖身份。

| 浏览器函数           | 原实现                                                                            | 原方法 token                          |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| `cs2MaxDriveSpeed`   | `VehicleUtils.GetMaxDriveSpeed(CarData,float,float)`                              | `0x060003af`                          |
| `cs2MaxBrakingSpeed` | `VehicleUtils.GetMaxBrakingSpeed` 两个 CarData/float 重载                         | `0x060003b1`、`0x060003b2`            |
| `cs2BrakingDistance` | `VehicleUtils.GetBrakingDistance(CarData,float,float)`                            | `0x060003b3`                          |
| `cs2SpeedRange`      | `VehicleUtils.CalculateSpeedRange(CarData,float,float)`                           | `0x060003b4`                          |
| `cs2SafetyTime`      | `VehicleUtils.GetDrivingStyle`，以及 `PseudoRandomSeed.GetRandom` 与 Unity Random | `0x060003b9`                          |
| `cs2CurveCurviness`  | `NetUtils.CalculateCurviness(Curve,float)`                                        | `0x060041d5`                          |
| `cs2FollowingSpeed`  | `CarLaneSpeedIterator.UpdateMaxSpeed` 的普通同向汽车标量分支                      | 静态源分支移植，未独立运行 ECS 原方法 |

`cs2InverseSmoothStep` 对应 `Colossal.Mathematics.MathUtils.InverseSmoothStep`；该函数通过原 `CalculateSpeedRange` 的结果间接核对。反编译文本的证据位置与哈希保存在本地分析目录，不将完整反编译代码混入 RoadLab。

## 单位与参数

距离以米计，速度以米/秒计，加减速度以米/秒²计，时间以秒计，转向参数以弧度计。RoadLab 道路资产的 km/h 限速需要先除以 3.6。

`CS2_BASE_CAR` 使用 `CarBasePrefab` 类中确实存在的默认值：最高 200 km/h、加速度 5、制动力 10、转向参数 `(90°,15°)`；依照 `VehicleInitializeSystem` 转换最高速度和转向角度。它们是源码基类默认值。压缩包没有提供实际车型资源的参数覆盖，不能据此断言游戏中的每种小汽车都采用这些数值。

`CS2_NAVIGATION_TIMESTEP` 为原 `CarNavigationSystem.UpdateNavigationTarget` 的 `4/15` 秒。安全时间由模拟帧、16 位车辆种子与 `kDrivingStyle=45236` 生成：普通汽车约为 0.1–0.5 秒，并以 4096 帧为周期缓慢变化。它没有替换为 RoadLab 原先的固定 IDM 时距。

## 速度决策

原实现先根据当前速度求允许的速度范围。加速能力通过反平滑函数随最高车速接近而降低；制动下界由当前速度减去制动力乘步长得到。

弯速使用车辆最高速度、转向参数和车道曲率共同计算。车道曲率在道路生成阶段计算：把三次曲线分为四段，取最大的转向曲率；短于两倍车道宽的路段还会平滑。它不同于简单的“横向加速度乘转弯半径再开平方”。应在车道或连接器建立时缓存，避免逐车逐步重复计算几何。

跟车分支先假设前车已经以自身制动力制动两个导航步长，然后根据前后车制动能力决定制动包络：

1. 后车制动能力至少与前车相同：把前车反应期内移动的距离加入可用距离，再求允许以后车速度接近该前车速度的包络。
2. 后车制动能力较弱：将前车完整的制动距离加入可用距离，求后车停下的包络。
3. 前车已经停下：直接求针对该距离的停车包络。

输入 `leader.gap` 是几何投影完成后的净车身间距。低于 1.5 m/s 时的原距离偏移在模块内加入，停车时该偏移最多为 -0.5 米。车身投影、遮挡、相邻车道占用和路口冲突仍由外部系统提供，不能用这个标量函数替代。

## 浏览器接线与调度差异

`cs2NavigateSpeed` 输入当前速度、道路限速、曲率、前车、停车目标、车辆种子、模拟帧以及实际积分步长；输出 `maxSpeed`、`nextSpeed`、`acceleration`、`safeTimeStep` 与原导航速度范围。

`maxSpeed` 是按 `4/15` 秒求出的导航目标。RoadLab 仍使用小步积分，适配器额外用实际步长调用同一个原始速度范围函数，将目标限制在该步的加减速范围内，得到 `nextSpeed` 和 `acceleration`。这是明确的浏览器调度适配，不等同于恢复原 `CarMoveSystem` 的向量转向、变换帧插值或 ECS 更新组。完整复刻仍需继续移植这些调用关系。

`stopDistance` 必须对应真实的停车目标；不要把每个路口或斑马线自动当作停车目标。前车速度决策与信号、路口让行指令最终仍需共同取限制，并保留车身安全检查。

## 验证范围

执行 `npx vitest run tests/cs2-driving.test.ts`。

384 组数值由 .NET 8 对原始 `Game.dll` 做直接反射调用生成，覆盖直道与弯道速度、负/零/近零停车距离、不同目标速度和步长、接近及超过最高车速、帧周期和不同车辆种子，以及直线、90°弯、S 弯、坡道、退化控制点和短曲线。TS 使用 float32 舍入，数值检查允许绝对误差小于 `0.00004`。

另有跟车制动力分支、停车与恢复、小步积分、速度上限等场景检查。原 `CarLaneSpeedIterator.UpdateMaxSpeed` 依赖 ECS 数据与车身投影，当前没有直接运行其完整方法；这些场景检查不能证明完整路口、换道或整车行为已经与游戏一致。

仍需对齐的部分包括实际车型资源、路口/车道重叠检查、道路优先权、紧急车辆、迎面车辆、列车与自行车分支、目标点跟踪、向量转向、原调度、完整换道与寻路成本。原 RoadLab 的 IDM/MOBIL 及独立路口策略在尚未替换的调用点仍属于明确差异。
