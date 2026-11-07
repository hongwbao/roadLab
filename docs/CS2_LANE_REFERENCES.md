# CS2 LaneReferencesSystem：完整车道引用后处理

`src/simulation/cs2-lane-references.ts` 移植提供的 CS2 **1.6.0f1** 中 `Game.Net.LaneReferencesSystem` 的四个完整作业，以及两个 `UpdatePathNode` 重载和 `SubLaneOrder.CompareTo`。它负责新旧车道加入/移出 Owner 的 SubLane 缓冲、跳过车道的节点替换、按分组排序、Master/Slave 索引与相邻开口标志，以及轨道 Owner 标签更新。

这一步消费 LaneSystem 创建结果；CreateNodeLane 中的初始 `SubIndex/MinIndex/MaxIndex` 还不是最终索引。原执行阶段为 LaneSystem（Modification4）→ LaneReferencesSystem 与 LaneOverlapSystem（Modification4B）→ LaneDataSystem（ModificationEnd）。车道创建时 `CarLane.SpeedLimit` 仍为零，后续有效限速初始化不属于本模块。

## 输入与输出

入口：

```ts
const result = cs2UpdateLaneReferences(world, {
  laneChunks,
  updatedOwnerChunks,
  allOwnerChunks, // loaded=true 必须提供，可为空
  loaded,
  skippedLanes, // undefined 表示未分配队列；[] 表示已分配但为空
});
```

`world.entities` 是 Entity ID → 组件快照 Map。ID 为 `string | null`，标识完整 Entity 身份（含 Version）；`world.entityIndices` 单独记录原 `Entity.Index`，供 PathNode 的 OwnerEquals 使用。两个不同 ID 可以拥有同一 Index、不同 Version。PathNode 使用 `bigint` 保留完整 64 位。

组件保留源结构：

| 组件字段                           | 输入来源及意义                                    |
| ---------------------------------- | ------------------------------------------------- |
| `owner`、`lane`、`prefab`          | Owner、Lane 三个 PathNode、PrefabRef              |
| `subLanes`                         | Owner 的有序 `{lane,pathMethods}` 缓冲            |
| `connectedEdges`                   | 节点有序 ConnectedEdge；缺失与 `[]` 不同          |
| `edge`                             | Edge 的完整 start/end Entity 身份                 |
| `edgeLane.delta`                   | EdgeLane 两个 float32 EdgeDelta                   |
| `master`、`slave`                  | 原 Flags、Group、ushort 范围/索引字段             |
| `parking`、`connection`            | ParkingLane.Flags；ConnectionLane.Flags/RoadTypes |
| `created/deleted/updated/temp/...` | 对应组件是否存在；false/缺失表示不存在            |

`prefabCars/prefabParking/prefabTracks` 分别是原 Prefab Entity → CarLaneData.RoadTypes、ParkingLaneData.RoadTypes、TrackLaneData.TrackTypes。缺少 prefab 数据时保留源 TryGet 分支；需要 PrefabRef 或 Lane/Owner/SubLane 等直接索引组件时缺失会报错，不生成默认数据。

每个 query chunk 显式提供 `{index,entities}`。index 对应作业的 `unfilteredChunkIndex`，保留为 ECB 命令的 `jobIndex`。源查询条件为：

- `laneChunks`：Lane + Owner，具有 Created/Deleted 至少一个，排除 SecondaryLane。
- `updatedOwnerChunks`：SubLane + Updated。
- `allOwnerChunks`：全部具有 SubLane 的实体，仅 loaded 时用于索引作业。

同一个 chunk 必须具有作业读取的相同组件存在组合；模块会拒绝混用。调用方负责准确查询及其顺序。当前 Web 世界没有 Unity 原生 ArchetypeChunk；适配器提供自己的显式、可追踪分组与排序键，不将此顺序声称为原城市的 native chunk 布局。

返回新的 `world`、`commands`、`loaded:false`、用于核对的 `pathNodeMap`。原世界、缓冲和输入队列不被修改。命令包括 `PathfindUpdated/TramTrack/TrainTrack` 的 add/remove，保留源作业调用顺序、chunk 排序键和重复请求。组件写入已经反映到新世界；这些标签命令仍等待调用方的 barrier/ECB playback，不能当作已应用标签。返回的 pathNodeMap 用插入顺序展示映射；原 native 哈希表的物理枚举顺序不参与算法语义。

## 保留的细节

- SubLane 相等只比较 Entity。新增同一实体时不更新已有 PathMethods；删除只移除第一个匹配值，其他元素保持顺序。
- PathMethods 从零开始，严格按行人/汽车/轨道/停车/连接组件和资产 RoadTypes 累积。自行车单独用 Bicycle/BicycleParking，特殊停车使用 Boarding + SpecialParking。
- Skip 映射对 start/middle/end 都指向去除 secondary 位后的 middle，键第一次插入生效，不求传递闭包。
- Owner 的直接节点修复只处理 Pedestrian/Road/Bicycle 的 start/end，先 StripCurvePos 并按 Temp 查 secondary key。Track 不参与这一分支。
- ConnectedEdge 分支处理 Pedestrian/Road/Track/Bicycle。仅 EdgeDelta 精确等于节点所在端的 0/1 才修复；两个 Delta 都匹配时选择 start。若旧节点属于 junction owner，先换成 edge middle 并设置 segment 0/4；此分支不 StripCurvePos。
- **空的已分配 skipQueue 仍执行上述 edge 修复**；没有 ConnectedEdge 组件的 Owner 则连直接子车道修复也不会执行。若边没有 Updated，改动后逐次发出 PathfindUpdated。
- loaded 只让索引作业改查全部 Owner。Skip 修复始终查 Updated Owner。
- 分组按 uint Group 排序；组内使用原 int32 溢出减法比较 Index。Slave 的排序键是 `(SubIndex << 16) | 原缓冲位置`；Master 的键为 -1；普通/Secondary 车道分别排在 `0xfffffffe/0xffffffff` 哨兵组。
- 使用共用 `cs2NativeSort` 的原 introsort 控制流，不改成 JS 稳定排序。最终索引包含 Owner 中之前各组的偏移及 Master 自身位置，并按 ushort 存储。
- OpenStart/End Left/Right 只跨相同 MergingLane 状态的相邻 Slave，完整比较 PathNode；不人为补连接。MultipleLanes、Master.HasBikeOnlyLane 和无 Master 时的自身 MasterIndex 都保留源行为。
- 没有 Master 时，源代码对第一条 full bicycle-only 车道的计数存在特殊性；没有将它改成统一过滤。只含 Master 的空组、角色恰处于哨兵组也按原分支保留。
- 仅 Node + Road 的 Owner 统计轨道资产，并比较、更新 TramTrack/TrainTrack 标签；没有扩大为 Subway 标签初始化。

## 可重复验证与边界

Oracle 位于本机 reverse 工作区：`/home/bhw/repos/roadlab-reverse/oracles/lane-references/`，运行 `bash rebuild.sh` 可重新提取、构建、生成全部预期值。`extract.py` 从提供的反编译源机械提取完整四 Execute、两 helper 及比较器；`SourceJobs.cs` 中分支保持原样。输入通过有序、显式的源组件世界喂给这些方法。

执行原 Game.dll 的组件值类型、PathNode 操作及 SubLane.Equals；NativeSort 使用原方法的机械提取。替换边界为 Unity native chunk/lookup/buffer/list/queue/ECB 的存储层，由可核对的 managed world、引用 cell 和命令捕获实现。未宣称直接启动私有 Unity World，也未宣称全 LaneSystem 已全部移植。预期值不是 TypeScript 实现生成。

`tests/fixtures/cs2-lane-references-oracle.json` 固定：

- Game.dll SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`。
- MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。
- 四 jobs、两 UpdatePathNode、CompareTo 的原 token/IL SHA256 和七段提取源 SHA256。
- **464 个完整世界**：96 引用增删、128 索引排序、96 skip/endpoint 修复、48 加载、64 创建/删除→修复→索引的连续更新、24 分组边界、8 Entity Version/Index 案例。

验证比较整个新组件世界、完整命令序列、节点映射，不采用浮点容差。额外检查快照不变、重复增删、空队列、第一条自行车、Version/Index 身份差别，以及必要数据/查询错误。独立验证命令：

```sh
npx vitest run tests/cs2-lane-references.test.ts
npx tsc --noEmit --strict --noUnusedLocals --noUnusedParameters \
  --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck \
  src/simulation/cs2-lane-references.ts tests/cs2-lane-references.test.ts
```

## RoadLab 接线要求

先完成 CreateNodeLane 的 deferred Entity 分配、创建命令 playback，并将真实 Owner/SubLane、Edge/ConnectedEdge、PrefabRef、EdgeLane、Master/Slave、Created/Deleted/Updated/Temp 映射到 source world；不要只把选择请求接回旧的手写连接曲线。保留源道路和 junction Owner 的不同 Entity.Index、原 packed PathNode 以及创建器输出的 skipQueue。所有查询和资产字段由适配器提供实际数据；自定义 RoadLab 资产值应明确标识。

用本模块输出的 SubLane 顺序、范围、SubIndex、MasterIndex、Open/Merging 标志构建最终寻路图，随后执行对应 LaneOverlap 与 LaneData 初始化。模块自身不改 RoadLab 编辑器、渲染、碰撞或运行时寻路入口，也不替代尚未映射的资产与原系统阶段。
