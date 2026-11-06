# 天际线 2 信号时钟独立对照

`tests/cs2-signal-clock.test.ts` 为 `src/simulation/cs2-junctions.ts` 的7态时钟和需求选组提供独立预期结果。输入来自用户给定 Game 1.6.0f1 程序集，MVID为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`。此验证不把“TypeScript结果再抄回测试”当作oracle。

## 两种证据分别标记

fixture `tests/fixtures/cs2-signal-clock-oracle.json` 明确区分：

1. `direct-original-dll-empty`：给原私有 `UpdateTrafficLightsJob.UpdateTrafficLightState`、`GetNextSignalGroup` 传入真实预分配NativeList和空lane列表，通过反射直接执行原DLL。这些输入覆盖7态、计时边界、移动桥梁时间和byte溢出，列表为空时不会执行ECS查表。
2. `source-extracted`及其变体：Python从恢复C#中按完整签名和大括号范围**自动提取原方法体**，只把 `NativeList<Entity>` 代换成具有Length的类型安全List，把 `ComponentLookup<LaneSignal>` 代换成 `Dictionary<Entity,原Game.Net.LaneSignal>`；`IsEmpty` 用明确的回调输入。Game结构体、枚举、Entity相等比较和Unity.Mathematics.math仍使用用户原DLL。

非空lane分支需要Unity ECS世界、有效ComponentLookup和类型注册；仅有可读NativeList内存不足以直接执行它。本验证没有伪造这些原生世界状态，也没有将提取后的编译结果冒充Game.dll原方法直接执行。

本机复现项目位于 `/home/bhw/repos/roadlab-reverse/oracles/signal-clock/`，其中 `extract.py` 自动生成 `ExtractedClock.cs` 和 `extraction-manifest.json`。提取方法包括UpdateTrafficLightState、GetNextSignalGroup、RequireEnding和ClearPriority；原方法和代换后方法分别保存SHA256。普通方法体的分支、原局部变量、float字面值、byte计数和副作用均保持原式，没有另写一个“参考算法”。

## 对照范围

fixture包含1,041个单tick输入、430个选组输入，以及8条每条48tick的连续轨迹，合计1,855次时钟/选组决策。其内271次直接执行原DLL，其余为原式提取方法配合类型安全查表输入；连续轨迹在状态改变后还直接调用原公共 `TrafficLightSystem.UpdateLaneSignal` 投影lane信号。

对照不仅比较“下一个绿灯是谁”，还比较：

- state/current/next/groupCount/timer/flags及返回的changed。
- 每条lane被修改后的petitioner、priority、blocker和信号历史。
- 多lane组mask、同优先级请求、负默认优先级、无需求、是否允许延长、0组/16组边界。
- Extending/Extended在需求变化时继续、退出或回到Beginning的行为。
- 移动桥梁的优先级截断、移动时间、IsEmpty=false时保持，以及Changing/Ending期间下一组再次改变。
- timer在254/255附近的byte回绕，和C# float阈值两侧的相邻表示值。

连续轨迹包含持续竞争、需求突变、多股同优先级、完全空需求、移动桥梁阻塞和起始byte边界。原DLL时钟的空列表结果与source-extracted方法另有内部交叉核对，避免提取器无意改变计时语义。

## 验证实际发现并修复的问题

最初随机/连续输入全部通过，但额外加入C# float阈值附近的输入后，发现JavaScript双精度运算会使移动桥梁提前换态。例如Ongoing的移动时间4.5333333、timer=7，源计算按单精度将 `movingTime*1.875f+0.5f` 舍入为9；旧TS计算得到略小于9的数并截断为8，提前进入Extending。Changing的0.9375f也有相同风险。

还加入了直接Game.dll执行的Changing空列表输入：移动时间9.0666666、timer=7。这个用例独立证明差异来自原float计时语义，无须依赖非空ECS查表替代。实现已经对输入、乘法和加法逐步执行Math.fround，相关fixture保留为回归用例。

## 实际限制

IsEmpty回调只表达“该目标组当前是否满足清空条件”；这里没有声称重建了原桥梁、车道对象、物理阻挡和世界查询。source-extracted证据证明的是所提取状态机在给定查表记录下的行为，不证明原ECS调度、网络生成、所有车辆需求传感、相位渲染或完整游戏交通已一致。

运行 `npx vitest run tests/cs2-signal-clock.test.ts`。测试分为11项检查，内部逐项比较全部fixture决策和连续轨迹；不能用“11项测试”误解为只抽查11个输入。
