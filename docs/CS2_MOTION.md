# CS2 向量移动、挂车与显示插值

`src/simulation/cs2-motion.ts` 移植了所提供程序集中的普通汽车向量移动内核、单节挂车约束、更新分组以及显示插值。它与 `cs2-driving.ts` 的速度决策分开：速度决策产生导航命令，本模块按原移动步长执行命令。

## 证据身份与验证方式

- `Game.dll` SHA256：`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`。
- MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。
- 原 `CarMoveSystem.CarMoveJob.Execute` 方法 token：`0x06007cf3`；方法 IL SHA256：`70c08ad8446aeef937e0cf9ce457c0b348d3cc4188a54c4a69c5d8b472294de1`。
- 本地 oracle：`/home/bhw/repos/roadlab-reverse/oracles/motion/`。
- 对照数据：`tests/fixtures/cs2-motion-oracle.json`。

移动 job 依赖 Unity ECS 的 `ArchetypeChunk`、组件查询与原生容器，当前没有在完整 Unity 世界中执行它。移动对照程序自动截取恢复的 C# 原方法片段，保留原公式和分支，引用原 `Unity.Mathematics.dll`、`Colossal.Mathematics.dll` 运行；把 ECS 的完整更新请求转成布尔输出，把地形取样替换成显式平面取样器。因此这是 **source-extracted oracle**，不能称为原始 ECS job 的直接执行。fixture 保留了原片段哈希、截取行号和所有替换。

以下插值方法则确实通过反射直接调用原 `Game.dll`：

| 原方法                                          | token        | 对应 TS                   |
| ----------------------------------------------- | ------------ | ------------------------- |
| `ObjectInterpolateSystem.CalculateUpdateFrames` | `0x0600507e` | `cs2InterpolationFrames`  |
| 同方法，包含上一模拟帧与变更状态的重载          | `0x0600507f` | `cs2InterpolationFrames`  |
| `ObjectInterpolateSystem.CalculateTransform`    | `0x06005080` | `cs2InterpolateTransform` |

## 坐标、输入与输出

位置以米计，速度以米/秒计；Y 向上，车辆局部 +Z 向前，四元数顺序为 `{x,y,z,w}`。`pivotOffset` 以米计。`navigation.maxSpeed` 的符号位表达倒车，原实现连负零也识别为倒车命令。

`cs2MoveCar` 接收：

- `state`：位置、世界速度、朝向四元数。
- `navigation`：世界目标点、有符号目标速度、可选目标旋转；全零旋转表示没有显式旋转。
- 车辆/车道 flags、车辆随机种子、日光亮度、pivot，以及 Area 分支需要的地形取样回调。

返回值分别表示：

- `state`：原 job 写回的完整移动步末状态。
- `frame`：原 job 写入当前 TransformFrame 槽的半步位置、速度、半步朝向和灯态。
- `localNavigation`：本次执行内部修改的局部导航副本，仅供诊断及本次向量计算。
- `forceFullUpdate`：宿主应安排原“完整更新”效果的请求。

**原 `CarNavigation` 组件是只读的。**原 job 修改局部目标点和速度，但结尾只写回 `Moving`、`Transform` 与 `TransformFrame`；宿主不能把 `localNavigation` 当作组件写回。函数也不会直接修改输入对象。

## 普通道路的移动方式

原 job 的一个车辆更新步长固定为 `4/15` 秒。它首先把目标方向缩放至导航速度，在车辆局部坐标中检查转角，并依据速度、步长和 pivot 约束目标方向。随后混入旧速度：方向调整向量乘以 8 再加旧速度，再次归一化至本次导航速度。

位置使用本次世界速度乘完整步长。原实现还计算半步位置，并以车辆 pivot 分别求半步与完整步的朝向。这与沿车道弧长做一维梯形积分的处理不同。

`cs2MoveCar` 必须按上述逻辑步长调用，不应在每个浏览器渲染帧直接执行一次，也不应执行后再额外叠加旧的一维位移。

## 特殊分支

| 分支                             | 移植状态与契约                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 普通道路                         | 目标方向、旧速度混合、pivot 转角限制、两次朝向计算均移植                                                                             |
| Connection / ResetSpeed          | 依原式跳过普通转向混合                                                                                                               |
| 显式目标旋转                     | 直接采用命令中的旋转，并跳过普通转向混合                                                                                             |
| 倒车 / CanReverse                | 方向修正、倒车速度及朝向分支均移植，包括负零符号位                                                                                   |
| CannotReverse                    | 清除本次局部倒车标志、局部 maxSpeed 设零，并请求完整更新；原代码已提前读取旧速度绝对值，本次移动仍可能发生。此局部修改不写回导航组件 |
| Area                             | 水平目标长度限制与多次地形高度取样均保留；宿主必须提供实际 `terrainHeight`。当前模块没有恢复游戏地形资源及高度场存储                 |
| 灯光、刹车灯、转向、警示、工作灯 | 原 flags 与伪随机亮度偏移已移植                                                                                                      |
| 灯光效果失效通知                 | `cs2MotionEffectsChanged` 保留跨帧 aggregate flags 的比较；实际 ECS 命令由宿主执行                                                   |
| ECS 完整更新                     | `forceFullUpdate` 暴露请求；布局内车辆与递归子对象的 Updated/BatchesUpdated 命令仍需宿主实现                                         |

原汽车查询排除了 Deleted、Temp、TripSource 和 OutOfControl，并按 UpdateFrame 分组。调用方需要维持同样的适用实体边界，不能把本内核直接应用于所有未生成车辆或失控车辆。

## 挂车

挂车运动属于独立的 `CarTrailerMoveSystem`。`cs2MoveTrailer` 移植其单个连接关节，输入前一节车辆状态、当前挂车状态、两侧连接点、pivot、运动类型及头车帧 flags。

- Free：根据两侧连接点与前后车速度预测方向，再求挂车朝向与连接位置。
- Locked：采用前车旋转，但原位置公式仍用挂车旧旋转计算挂车侧连接点；保留这个具体运算顺序。
- Unspawned：两侧连接点都使用前车旋转进行初始对齐。
- 其他运动类型：保持位置和旋转，并由原位移公式得到零速度。

挂车速度由位置差除以 `4/15` 秒得到，帧位置取两端中点，帧旋转进行半程 slerp。多节车辆应按原 LayoutElement 顺序逐节计算，把上一节的新状态作为下一节的前车；各节的灯态均继承头车对应帧的 flags。实体布局遍历、挂车资源和车型生成尚未由这个纯函数代替。

## 更新分组与显示

`cs2MotionSchedule` 对应 `CarMoveSystem.OnUpdate`：每个 60Hz 逻辑帧处理 `frameIndex & 15` 的一个车辆组，写入 `(frameIndex >> 4) & 3` 的 TransformFrame 槽。各车每 16 个逻辑帧更新一次，四个槽循环使用。

显示时，`cs2InterpolationFrames` 按原无符号运算从模拟帧减去车辆分组和 32，选相邻的两个槽及插值位置；包含原 uint 溢出行为。具体显示时间还取决于宿主 RenderingSystem 的帧时钟，不能仅凭此减法断言完整游戏的端到端显示延迟。

`cs2InterpolateTransform` 用两帧的位置和速度构造三次曲线：内侧控制点分别为起点加起点速度乘 `4/45`，终点减终点速度乘 `4/45`；朝向使用原 shortest-path slerp/nlerp，flags 在插值位置 0.5 切换。输入位置未被强制截断到 0–1，保留原方法的外插行为。

## 验证及剩余差异

执行 `npx vitest run tests/cs2-motion.test.ts`。

对照包括 110 个汽车单步 case、5 条各 32 步的连续状态轨迹、36 个挂车关节 case；另有 81 个原 DLL 帧索引结果、40 个原 DLL 显示插值结果，合计 427 次数值对照。连续轨迹包含转弯、倒车、坡面 Area、显式旋转和 CannotReverse；插值包含负点积四元数、nlerp、180°、负插值位置和大于 1 的位置。

使用 float32 舍入，并以绝对 `0.00003` 加每个分量绝对值乘 `0.000002` 的容差对照。Area 取样器也需按输入中的 float32 系数还原；双精度系数会在连续反馈中累积差异。

目前验证的是明确的内核与插值契约。完整原游戏 ECS 执行、实际导航目标更新、分组调度接入、地形资源、碰撞/车道占用同步、车辆布局生成、渲染环形帧缓冲和事件队列仍需继续集成与验证，不能由这些纯函数测试推断整车交通已完全复刻。
