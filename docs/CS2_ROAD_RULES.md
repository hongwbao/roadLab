# 原版道路优先权与 lane flags

`cs2-road-rules.ts` 依据用户提供的 Game.dll **1.6.0f1 (419.d6c6)**，恢复道路 composition priority、完整 CalculateYieldOffset 控制流、NetUtils.IsTurn 与道路 builder 中可以独立表示的 flag 写入。原文件 SHA256 为 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID 为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`。

## 显式 snapshot 边界

模块不访问 Unity ECS。每个 incoming/outgoing arm 提供 `{owner, priority, highway, position, tangent}`：

- owner 是原路段 edge 的身份；同一 road edge 的多条 lane 共用 owner。不能把每条车道都当成不同的高等级道路。
- position 是实际车道端点位置，不能统一替换成路口中心。
- 两端 tangent 都遵循原 ConnectPosition 的约定：source 朝向路口；target 从出口指回路口，即 `normalize(connector.c2 - connector.to)`。原算法不在入口自动标准化输入，调用方应提供已有的单位切线。
- highway 是原 RoadPrefab.m_HighwayRules 的显式规则。当前 RoadLab 由道路资产明确保存 highwayRules；缺少字段的旧地图不能靠限速阈值冒充原生规则。

输入 incoming/outgoing 是原 source query 中的适用道路连接位置。原始 native 车道筛选、RoadTypes、composition prefab、车道组、几何层与禁转筛选由适配层处理；本模块不假装重建这些查询。

## 道路 priority

原证据：`Game.Prefabs.NetInitializeSystem.cs:1944`、`NetCompositionSystem.cs:225–261`。

`cs2RoadCompositionPriority` 的 speedLimit 单位是 **m/s**，RoadLab 的 km/h 必须先除以 3.6。基础值是限速；Gravel 减 1.25。只统计真实 Road lane，排除 Master lane；向前/向后数量为 f、b：

| 道路规则     | 车道数带来的增量         |
| ------------ | ------------------------ |
| HighwayRules | max(f,b)                 |
| 普通道路     | 0.5 max(f,b) + 0.25(f+b) |

过渡道路应查询连接端的有效断面。直接用全路最大车道数会是另一种几何近似。

## 完整 CalculateYieldOffset

原方法：`Game.Net.LaneSystem+UpdateLanesJob.CalculateYieldOffset`，MethodDef token `100680010`，IL SHA256 `23820b81657b503dc78c97e3658166604c065c9d92abafb85b93d16f06cb1308`。

`cs2CalculateYieldOffset` 保留以下原顺序：

1. AllWayStop 返回 2，优先于红绿灯。
2. LevelCrossing 或 TrafficLights 返回 0。
3. 扫 incoming。只有 owner 不是本 source、也不是已记录的首个高优先 owner，并且 priority 差 **>0.99f** 才考虑。第一个仅记录；第二个不同高优先 owner 出现立即返回 1。同一路多条 incoming lane 不重复计算。
4. 恰好一个高 incoming owner 时，outgoing 中必须还有另一个更高 owner，且不同于本 source owner 和已记录 owner，才返回 1；否则 0。
5. 完全没有高 incoming：普通道路返回 0；HighwayRules 还检查每个 incoming 是否能到达其他 owner 的 outgoing，且几何分类为直行或 gentle turn。当前 source 自己能直行/缓转则返回 0；否则其他 incoming 至少一个能直行/缓转才返回 1。

这个过程不能用“有更高级的路就让行”或“所有大路个数”替代。低速支路连接一条高等级双向死端，和连接贯通主路，可能得到不同结果。

输出 1、2、-1 在 node lane builder 分别映射 Yield、Stop、RightOfWay；当前普通道路自动计算本身只返回 0、1、2，-1 还用于其他 builder，例如环岛。

## 转向分类与 flag 写入

`cs2IsTurn` 移植 public `Game.Net.NetUtils.IsTurn`。它结合端点位置、两端切线、混合与浮点阈值，返回 isTurn/right/gentle/uturn。原阈值包括 -0.9335804、-0.4848096、0.7547096；用单一 dot>0.9 分类并不等价。小于等于 0.1 米端点距离还有单独分支。

`cs2NodeLaneFlags` 对应 `LaneSystem.CreateNodeLane` 中道路分支（7030–7157），在有效连接已选择、curviness 已知后：

- 仅当两端都有 HighwayRules 时添加 Highway。
- isUnsafe/isForbidden 是独立的源连接选择结果。普通左转没有自动 Unsafe；不能直接令所有 ramp/left 都 Unsafe。
- 交叉口、环岛、掉头、side connection 会设置 ForbidPassing，并区分 Forward、TurnLeft/Right、GentleTurnLeft/Right、UTurnLeft/Right。
- 非交叉口还会根据原 curviness 阈值（普通 PI/180，高速 PI/360）及双向多车道 composition 状态设置 ForbidPassing。
- Yield/Stop/RightOfWay、TrafficLights、LevelCrossing、PublicOnly、SecondaryStart/End、Runway、Left/RightLimit 只按显式源输入写入。
- `sharedTwoway` 指一条原生 lane 本身允许双向，不等同于 RoadLab 的 Road.twoWay（后者通常是不同方向占用不同车道）。

Approach 来自上游 edge lane 对 node lane 的规则传播（LaneOverlapSystem179–319），不在 node helper 中自动添加。源重叠优先比较还会清除 Approach 上的 Yield/Stop/RightOfWay；把它加到所有 connector 会抹掉正确的让行。

`cs2MiddleConnectionFlags` 是另一个 builder 的明确标量规则：Unsafe|SideConnection，作为 source 时再 Yield，按实际曲线左右关系设置转向，按目标 composition 设置 Highway 等。Road.kind=ramp 不足以证明原生 MiddleConnection，调用方只有确知这种连接语义时才应使用。

本 flag helper 没有重建车道分配、unsafeCount/forbiddenCount、merge layers、原 owner 索引去重、prefab替换、几何拟合和 source/target lane 实体生成。未知 isUnsafe 不能靠命名推测；需要由相应适配或后续恢复提供。

## 原始执行与源提取验证

`tests/fixtures/cs2-road-rules-oracle.json` 保存：

- **512 条原始 Game.dll 直接执行**的 NetUtils.IsTurn，包含全部 out flags、近零端点距离及随机位置/方向。
- **108 条源提取 C# priority** 样例，覆盖两向车道数、普通/高速与 gravel。
- **265 条完整方法 source-extracted C#** CalculateYieldOffset。生成器机械抽取原方法体，仅把首个 ComponentLookup 换成 node snapshot、NativeList换数组、Entity身份换 owner 字符串/null；分支未改，内部 IsTurn 仍实际调用原始 DLL。
- **256 条 source-extracted C# flags** 样例，覆盖 straight/left/right/gentle/uturn 及独立 flag 条件。

不能把后三类描述为原版 ECS 系统在无 Unity 环境下运行。原完整方法与改写方法的文本 SHA、IL SHA、变更列表均保留在 fixture provenance 和本机 oracle 目录。

本机可复现：

```bash
python3 /home/bhw/repos/roadlab-reverse/oracles/road-rules/extract.py
DOTNET_ROOT=/home/bhw/repos/roadlab-reverse/tools/dotnet \
  /home/bhw/repos/roadlab-reverse/tools/dotnet/dotnet run \
  --project /home/bhw/repos/roadlab-reverse/oracles/road-rules -- \
  /home/bhw/repos/roadlab-reverse/extraction/Managed \
  /home/bhw/repos/interchange-lab/tests/fixtures/cs2-road-rules-oracle.json
npx vitest run tests/cs2-road-rules.test.ts
```

这些结果证明相应标量/查询适配决策的对照，不证明当前网页已经接入每个 flag 或原生整套路网行为。
