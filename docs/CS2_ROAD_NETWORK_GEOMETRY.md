# 原道路网络几何生成阶段

`src/core/cs2-road-network-geometry.ts` 生成供原 `CourseSplitSystem` 读取的道路边界。它没有把中心线、横截面或临时圆当成已生成的 `EdgeGeometry` / `EdgeNodeGeometry`。当前可完成普通、具有相同合并层的道路全阶段流程；特殊资产分支返回明确 `pending`，尚未宣称所有 CS2 网络类别完整移植。

## 调用与组件

```ts
const world = createCS2NetworkGeometryWorld({/* 真实宿主组件 maps */});
const result = cs2GenerateRoadNetworkGeometry(world, {
  nodes: nodeEntityIds,
  edges: edgeEntityIds,
  loaded: false,
});
if (result.status === "complete") {
  // 结果均来自完整生成流程；输入 world 的输出 maps 保持原样。
  useGeneratedGeometry(result.world);
} else {
  // { dependency, entity } 明确指出本次尚不能完成的源分支。
  showPendingGeometry(result.dependency, result.entity);
}
```

输入是原组件的独立字典快照。原生 ECS 查询顺序由 `nodes`、`edges` 和每个 `connectedEdges` 数组提供；不额外排序或用最近几何替换原选择。

| 字段                                                                | 输入含义                                                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `nodes`                                                             | Node 的真实三维物理位置                                                                                        |
| `edges`                                                             | Edge 的真实 `start` / `end` 实体，几何交叉不隐式成为拓扑连接                                                   |
| `curves`                                                            | Curve 的 `bezier` 与原长度 `length`                                                                            |
| `prefabRefs`, `prefabGeometry`                                      | PrefabRef 与 NetGeometryData 的本阶段读取字段                                                                  |
| `compositions`, `prefabComposition`                                 | edge/startNode/endNode 三种 composition 引用及完整本阶段读取数值                                               |
| `prefabCompositionLanes`                                            | composition 的实际 NetCompositionLane 数组；有序、含 Road/Invert/Master/Twoway/Disconnected 标记与 carriageway |
| `prefabCompositionCrosswalks`                                       | 节点 composition 的斑马线 start/end，用于源路口退让距离                                                        |
| `prefabLaneWidths`                                                  | NetLaneData 的宽度；原 TryGetComponent 缺组件仍保持缺失                                                        |
| `connectedEdges`, `temps`, `hidden`, `updated`, `owners`, `orphans` | 原拓扑、临时编辑、可见性、更新与归属状态                                                                       |
| `outsideConnections`                                                | 原 OutsideConnection 实体集合；本轮特殊边界分支返回 pending                                                    |
| `nodeGeometry`                                                      | 全局 NodeGeometry：bounds、position（标高）、flatness、offset                                                  |
| `edgeGeometry`                                                      | EdgeGeometry：start/end 两个 Segment，以及 bounds                                                              |
| `startNodeGeometry`, `endNodeGeometry`                              | 直接存 EdgeNodeGeometry，省略 C# 外层 m_Geometry 包装                                                          |
| `sampleTerrain(position)`                                           | 显式宿主地形采样；没有默认伪造地形                                                                             |

`Segment` 含 left/right 两条 cubic 与 length[2]。`EdgeNodeGeometry` 含 left/right 两个 Segment、middle cubic、bounds、middleRadius 及两组 syncVertexTargets[4]，与 CourseSplit 读取结构一致。所有参数与控制点保持原 float 运算次序；没有加入吸附 epsilon。

空组件工厂 `cs2EmptyNetworkNodeGeometry`、`cs2EmptyNetworkEdgeGeometry`、`cs2EmptyNetworkEdgeNodeGeometry` 仅表达原新建 ECS 组件初值。它们不能直接作为 CourseSplit 输入。全阶段完成后才能发布生成几何。

重建整个 RoadLab 网络时，必须将所有待重建边置于 `updated`，并为每条边的两个节点提供所有相关邻边输入。原 InitializeNode 使用 `bounds.min.x` 暂存“保留未更新旧邻边端高”标志；不能用零组件冒充真实旧几何。`loaded` 对应原系统输入，不能为了掩盖缺失 Updated 随意更改。

## 阶段与边界

主调用按原 `Game.Net.GeometrySystem.OnUpdate` 顺序执行：

1. InitializeNodeGeometry：完整节点标高/flatness/offset 与保留旧高度判断。
2. CalculateEdgeGeometry：普通道路 CalculateOffsets、节点裁切、两半曲线偏移、完整普通道路 CornerOffset（宽差、车道、斑马线、坡差、样式过渡、对侧约束）、切段/长度对齐及高度限制。
3. FlattenNodeGeometry：完整层过滤、Temp 原件保护与最多 100 轮高度约束。
4. FinishEdgeGeometry：完整高度表应用、两种坡度处理、16 段长度、紧边界、地形扩边。
5. CalculateNodeGeometry：依次迭代 0 和 1；普通道路 FindMiddleNodePos、FindTargetSegments、宽差修正、左右四条节点曲线、VertexSyncTarget。
6. CalculateIntersectionGeometry：完整中间曲线/标高/紧边界及地形采样分支。
7. CopyNodeGeometry：最后统一写入缓冲 middle/bounds，保持原计算读写顺序。
8. UpdateNodeGeometry：完整普通/Orphan 默认包围盒与真实相邻 EdgeNodeGeometry 合并。

原 Intersection job 对局部复制的 outline 作 Flatten 后只缓冲 middle/bounds，Copy 不写回局部 outline 的高程。移植保留这一读写行为，没有自行“修正”原组件。

已支持普通 straight/curved 道路、1–4 岔口、不同宽度与中线偏移、单双向 lane buffers、master lanes、斑马线、端点方向反转、SmoothElevation、SmoothSlopes、SymmetricalEdges、已有高程和原 Temp/Hidden 遍历。

以下目前是 **未移植的原特殊分支**，并非缺了随意默认值即可成功：Roundabout / FixedNodeSize / StraightNodeEnd 的专属曲线和资产、Pathway side/middle connection、非合并层节点反射、OutsideConnection 地形边界、Waterway 高程交接、Airspace 横截面、LinkAuxOffsets 专属子网络。当前宿主 world 不提供这些专属资产组件；普通 RoadLab 自定义道路资产必须明确采用无此类资产行为的值。若以后加入这些类别，需要拓展 world 和源分支，不能把 pending 改为无条件成功。

`missing` 普通必需组件会抛出带组件和实体名称的错误；`pending` 是明确尚未实现的源分支。主调用只复制/修改输出组件 maps，pending 不发布中间几何。单阶段函数用于对照与诊断，它们可原地写入 world，不应替代主调用的完整性判断。

## 原式证据

输入版本为 CS2 1.6.0f1，Game.dll SHA256：

`721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`

MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。

独立 oracle 在 RoadLab 仓库外的 `/home/bhw/repos/roadlab-reverse/oracles/road-network-geometry/`。`extract.py` 机械提取原 GeometrySystem 全部八个计算 job 的整个 struct（保留完整 CalculateEdge/CalculateNode 的特殊分支）、原 EdgeIterator 的全部本流程使用方法（未使用的 AddSorted 被移除）、原 CalculateRoundaboutSize。管理数组/字典/chunk 替代 Unity Native 容器与调度；原数学函数实际调用 Game.dll / Colossal.Mathematics.dll；地形仅由明确 affine reader 替代 Native TerrainHeightData。没有把反编译 C# 放入 RoadLab Git。

fixture provenance 保存 DLL 身份、实际反射取得的所有 job 方法 metadata token、原源码 SHA256、完整提取 struct 体 SHA256 和适配边界。完整 C# oracle 包含尚未进入 TS 的特殊分支；不能从它编译成功推断 TS 特殊分支已经实现。

首轮验证包括 49 个真实八阶段完整世界，以及 Initialize / Flatten / Finish / Node / Intersection / Update 六类独立阶段世界。含真实车道/斑马线缓冲、宽差、曲线、坡度、正反拓扑、真实 Temp/Create/Delete/Hidden 分支、8m/16m 分层路网、-1.95m 建造相位和离轴端点。比较的是生成后的实际曲线控制点、长度、middle、sync targets、bounds 与 heightMap。浮点数测试使用绝对 `1e-4` 加相对 `2e-6` 的观测容差；该容差只存在于断言，不进入算法阈值。

## RoadLab 映射

RoadLab 使用自己的资产数值，不宣称已恢复 CS2 prefab 配置。默认宽度采用本游戏名义车道数 × 单车道宽度 × 方向数；composition、lane flags/positions 与可见物理中心由宿主真实数据提供。Road layer 1、同类 merge/intersect layers 是本游戏明确映射；平地 `sampleTerrain=0` 是真实场景地形输入。高架节点必须按实际三维坐标建立独立实体，不得仅按 XZ 坐标去重。

遗留多 knot / 非 cubic 中心线需要分片时，人工 fitting seam 仍是适配边界。几何系统不得将其重新命名成用户实际路口；原 CourseSplit 引用与全局 t 映射由上游适配器保留。
