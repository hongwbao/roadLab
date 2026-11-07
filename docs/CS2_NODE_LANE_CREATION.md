# 原式节点车道创建

`cs2-node-lane-creation.ts` 完整移植所提供 1.6.0f1 的 `LaneSystem.UpdateLanesJob.CreateNodeLane` 控制流程，并提供原 prefab 选择、曲线、车道组件和命令阶段。它可以作为 [节点连接选择](CS2_LANE_GENERATION.md) 的真实创建回调，输出用于建造预览与提交的相同几何和组件计划。

## 来源和证据等级

源位置为本地 `roadlab-reverse/decompiled/Game/Game/Net/LaneSystem.cs:6759`。Game.dll SHA256 为 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID 为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`；原方法 token `100680021`，IL SHA256 `42833e47fae0f6f8b5ff5ee11f6e15285b43e6820fead5714bac4753dac3bcc8`。

独立 oracle 位于 `/home/bhw/repos/roadlab-reverse/oracles/node-lane-creation/`。`extract_full.py` 机械提取完整约 770 行原方法体及 `CalculateAuxialryZOffset`，组件查询改用字典，NativeList 插入改为托管 List，原生 ECB 存储改为有序命令快照，archetype 与 deferred entity 分配由明确的宿主适配器提供。原 DLL 的数学、NetCompositionHelpers、Unity RNG、PseudoRandomSeed 和 PathNode 构造实际执行。

这属于“完整源方法体 + 宿主适配”的整方法对照；没有在实际 Unity ECS World 中直接运行原 private job。archetype 标签和实体分配器不是原游戏资源。源体、辅助方法、IL 和适配边界分别记录在 fixture 的 `source.extraction`，反编译 C# 未加入 RoadLab 仓库。

## 已移植流程

1. 读取两端 composition，处理 BlockUTurn 和双行人车道拒绝。
2. 按 Master/Slave 角色、道路品质、高速/砖石/砂石、步行/自行车属性选择 prefab；保留公交、轨道、步行 fallback 与 CanConnectTrack。
3. 完整 CheckPrefab：分组主题要求、概率抽取、随机组复用、selectedSpawnables 和原 draw 顺序。原调用者不检查其 bool 返回值，此事实保留。
4. 主车道和全部 auxiliary lane 循环，按两端 composition 的 all/any/none 与 spacing 筛选；保留原 y 偏移、道路端点 z 偏移及 source/target auxiliary 覆盖次序。
5. NodeLane 宽度偏移与自行车端点标志；真实 FitCurve/StraightCurve、ModifyCurveHeight、悬挂管线和 U-turn 挡板修正、16 段长度与原曲率。
6. 完整 CarLane 与 TrackLane 组件、双向拒绝、路权、信号、车行道分组；UtilityLane/HangingLane 同步保留。
7. 主要/附属 PathNode 分配、完整 middleConnections 分组/距离/插入更新，以及辅助车道分配节点后原 `flag=false`。
8. 主/从车道 skip 规则、临时 owner 替换、原车道查找、PseudoRandomSeed、旧实体复用、新实体创建和完整有序命令尾部。

主要节点 Start/End 的 PathNode 分别使用 source/target 道路 owner、组成车道 index 与 segmentIndex；Middle 使用 junction owner 与 ushort nodeLaneIndex。附属车道三个 PathNode 都使用节点 owner。计数器保留 int/ushort 溢出语义。

原 LaneKey 只保留 prefab lane flags 的 **Slave|Master**，并以三 PathNode、prefab Entity 和角色位判断复用。它不使用完整 Road/PublicOnly 等 flags。原 `isSkipped` 和方法返回 bool 也不是“已创建实体数量”：例如短主车道可入 skip queue，而方法仍返回 true。

## 接口

```ts
const result = cs2CreateNodeLane(
  world,
  {
    request,
    nodeLaneIndex,
    randomState,
    curviness: -1,
    isSkipped: false,
    buffers,
    middleConnections,
  },
  allocateDeferredEntity,
);
```

结果包含 `created`（原方法返回值）、nodeLaneIndex、主 RNG 状态、curviness、isSkipped、新 buffers、middleConnections、命令、skip queue 新条目和操作的实体标识。输入 world/buffers 保持不变；命令捕获组件值副本。宿主的实体分配器接收实际选定 archetype 标签，返回 deferred entity 标识。

组合选择器时，每次回调都使用新的 `curviness=-1`、`isSkipped=false`，同时保存同一 owner 本批 buffers 与 middleConnections：

```ts
const generated = cs2ProcessCarConnectPositions(
  selectionWorld,
  selectionInput,
  (request, state) => {
    const result = cs2CreateNodeLane(
      creationWorld,
      {
        request,
        ...state,
        curviness: -1,
        isSkipped: false,
        buffers,
        middleConnections,
      },
      allocateDeferredEntity,
    );
    buffers = result.buffers;
    middleConnections = result.middleConnections;
    commands.push(...result.commands);
    skippedLanes.push(...result.skippedLanes);
    return {
      created: result.created,
      skipped: result.isSkipped,
      curviness: result.curviness,
      nodeLaneIndex: result.nodeLaneIndex,
      randomState: result.randomState,
    };
  },
);
```

命令按源调用顺序保留 `jobIndex`、create/set/add、组件集合增删和组件数据。`LaneSignal` 的 `{default:true}` 表示安装原零值组件，后续信号系统再初始化/更新。world 的 component lookups 在整批命令播放之前保持同一快照；buffers 和 middleConnections 的直接更新则应传入下一次创建，不能逐车道提前播放所有 ECS 命令改变本批读取。

## 世界输入与 RoadLab 映射

| 输入              | 必须明确提供的来源                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ConnectPosition   | 真正 composition 车道描述、位置/inward tangent、owner/index、节点/边 composition、group/segment、speed/priority/flags、baseHeight 等；source 与 target tangent 均向节点内 |
| entityIndices     | RoadLab road/node 等逻辑实体到稳定原式整数索引的映射；PathNode 不使用字符串排序或临时车道显示编号                                                                         |
| compositions      | 两端及可选 edge composition 的 general/left/right flags、state、surfaceHeightMin、width                                                                                   |
| netLanes          | 实际选定/原端点/可能 fallback 与 auxiliary prefab 的 flags、width；缺少与实际零值不同                                                                                     |
| fallback 数据     | CarLaneData 的 notBus/notTrack、TrackLaneData 的 fallback/maxCurviness、PedestrianLaneData 的 notWalk                                                                     |
| CheckPrefab 数据  | editorMode、defaultTheme、placeholder/requirement/spawnable buffers 与 selectedSpawnables cache；游戏中的 editorMode 指地图编辑器状态，不能直接等同于“正在画道路”         |
| auxiliary/utility | 完整 auxiliary descriptors、all/any/none、spacing、prefab/位置、UtilityLaneData.hanging；实际 source/end 边几何边界线和 middleRadius                                      |
| U-turn pieces     | 对应节点 composition 的 piece flags、offset、size；包括明确存在但为空的 buffer                                                                                            |
| middleConnections | 真实连接候选、sort/group/role、已有 target curve/node/owner/distance 等；原式曲线到线段距离与分组更新已在模块内执行                                                       |
| 复用/临时状态     | old/original lane buffers、Temp/Edge/PseudoRandomSeed/LaneSignal 存在性；不要用空对象代表所有 lookup 缺失                                                                 |
| archetypes/分配器 | 由 prefab 角色确定的 node/slave/master archetype 与 deferred entity 分配。当前 oracle 用不透明标签验证选择，不声称恢复了实际序列化 archetype                              |

RoadLab 自定义资产可提供明确的 prefab/composition 数据表，例如实际用户所选宽度和速度，但不能冒充已恢复了原游戏序列化资产。不同显示车道、composition 的 byte index、节点请求的 ushort laneIndex、Owner.SubLanes buffer index 是不同字段，应按原系统维护。

## 后处理与尚需集成的范围

- 上游仍需完整 RoadLab → 原式 composition、Edge/Node、GetNodeConnectPositions 和真实几何映射。当前宽度 0.8 阈值切片与人工 cubic seam 不等于原固定 composition Edge。
- `Game.Net.LaneReferencesSystem.cs:456,505–508` 在创建后排序 Owner.SubLanes，写真实 Master/Slave min/max/sub/masterIndex、MultipleLanes 与 OpenStart/OpenEnd。这是初始 membership 之后的独立阶段，不能把初始 `min=max=subIndex=requestIndex` 直接作为最终选道范围。
- `Game.Pathfind.LaneDataSystem.cs:170,236` 才把 defaultSpeedLimit 初始化到有效 speedLimit，并处理限速修改。创建出的原 CarLane.speedLimit 仍为 0，不能据此让道路停驶，也不能在创建方法里擅自覆盖成别的阶段结果。
- 后续 LaneOverlap/LaneFlags 的连接计数、merge/split 与路权传播，以及信号头/车道初始化仍须按原顺序运行。
- 预览与正式建造可以复用同一创建计划；鼠标/吸附/地形/成本/撤销、实体命令播放和渲染集成由道路工具与宿主负责。本模块完成不等于整个道路编辑器或交通世界已经等价。

目前 PathNode packing 复用 `cs2-network.ts` 已有函数；若 network 反向调用创建器，集成者应将通用 packing 移至独立模块并 re-export，避免高低层模块互相导入。创建器没有另写一份通用 packing。

## 验证

| 对照                                   |  场景数 |
| -------------------------------------- | ------: |
| 完整 CheckPrefab                       |     140 |
| 完整 ModifyCurveHeight                 |      96 |
| 完整 CarLane 条件块                    |     240 |
| 原 DLL PathNode 构造与计数器           |      48 |
| prefab 角色/fallback 选择              |      96 |
| NodeLane 宽度/bicycle flags            |      48 |
| 几何、utility、U-turn 修正             |      96 |
| Master/Slave 初始组件                  |      48 |
| 完整 skip/temp/pseudo/旧新实体命令尾部 |     128 |
| **完整 CreateNodeLane 世界**           | **112** |

上述 1,052 个场景加 7 个证据/契约检查，当前 **1,059 项测试通过**。整方法世界覆盖主车道/auxiliary、Car/Track/Utility、fallback、placeholder、回转、信号、短连接、middleConnections、旧实体/新实体/临时/隐藏/种子、live RNG、索引溢出和 early false。

所有对照字段在恢复 oracle JSON 的原 float32 值后精确比较，包括曲率、曲线点和长度；flags、RNG、PathNode、组件值与命令顺序同样精确。与既有节点选择模块组合运行共 **1,335 项通过**。

本轮修正了旧曲率核的位置/导数与 rsqrt 运算顺序近似，以及 auxiliary 节点分配后的 skip 清除遗漏。严格整方法对照保留，不以放宽容差或减少复杂分支消除失败。

```sh
npx vitest run tests/cs2-lane-generation.test.ts tests/cs2-node-lane-creation.test.ts
```

源码体/容器适配结果仍不能代替原 Unity World、原序列化资产和实际 RoadLab 整合场景的验证；复杂分合流无穿模、真实建造操作和规模性能仍由后续整合门槛核对。
