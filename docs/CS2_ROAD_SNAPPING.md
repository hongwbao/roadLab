# 原式道路与控制点吸附

`src/core/cs2-road-snapping.ts` 对应用户提供的天际线 2 **1.6.0f1** `NetToolSystem.SnapJob` 道路吸附阶段。它接收完整道路组件快照和有序空间候选，输出一个共同优先级下的控制点、吸附线和高度采样请求。

本模块不修改编辑器或项目。地图候选收集、RoadLab prefab/断面映射及最终建造提交由集成者负责；不能把独立模块对照通过视为浏览器工具已经接线。

## 已移植的完整源方法

- `SnapJob.NetIterator`：Intersect、Iterate、HandleGuideLines、HandleGeometry 两个重载、SnapSegmentAreas、HandleCurve，原源码 613–1333 行。
- `SnapJob.HandleControlPoints`、`HandleStartDirection`、`GetSnapLineFlags`、`HandleExistingGeometry`，原源码 2057–2192、2275–2375 行。
- `SnapJob.AdjustControlPointHeight`，原源码 1874–1951 行。
- `ToolUtils.CalculateSnapPriority`、CompareSnapPriority、AddSnapPosition、AddSnapLine、DirectionSnap 和道路区域旋转计算。
- 完整 XZ Bezier 距离/长度/长度截断及 NetUtils 的 ExtendedDistance、ExtendedLength、ExtendedClampLength、ExtendedPositionAndTangent。曲线拟合/偏移与 3D Position/Tangent 复用 `cs2-net-geometry.ts`。

保留道路中段/端点、宽度差偏移、格长、转向导线及交点、严格节点、禁止中段连接、owner/service owner、layer、不同高度、孤立节点、Area/StandingNodes/leg 宽度、道路分区半格对齐等分支。

## 公共接口

```ts
const current = cs2RoadControlPoint(hitPosition, hitEntity);
const world = createCS2RoadSnapWorld({
  netData,
  candidates, // [{entity,bounds:{min,max}}]；原空间遍历顺序
  nodes,
  edges,
  curves,
  connectedEdges,
  prefabRefs,
  geometryData,
  placeableData,
  sampleTerrain: (position) => terrainHeightAt(position),
  sampleSurface: (position) => ({
    height: surfaceHeightAt(position),
    depth: waterDepthAt(position),
  }),
});
const result = cs2SnapRoad(world, {
  prefab,
  controlPoints: [start, current],
  mode: CS2_ROAD_SNAP_MODE.straight,
  snap:
    CS2_ROAD_SNAP.existingGeometry |
    CS2_ROAD_SNAP.nearbyGeometry |
    CS2_ROAD_SNAP.straightDirection |
    CS2_ROAD_SNAP.cellLength |
    CS2_ROAD_SNAP.guideLines,
  elevation,
  startEntity,
});
```

输出 `best`、末端被替换后的 `controlPoints`、`snapLines` 和有序 `queries`。输入控制点与组件 Map 内的数据不被修改。

`CS2RoadControlPoint` 保留原字段：position、hitPosition、direction、hitDirection、rotation、originalEntity、snapPriority、elementIndex、curvePosition、elevation。`direction` 的 `{x,y}` 对应 Unity 的水平 XZ；三维坐标仍为 `{x,y,z}`。

`snapPriority.x` 是源优先级层级；相同层级才比较 y 分数，完全相同时保留先出现的候选。候选数量、顺序和已有曲线来源对结果有意义，不能用“找最近的一个点”替代。

## 世界组件

`createCS2RoadSnapWorld` 为省略的 Map/候选数组创建空容器，代表该组件不存在。某个源分支需要索引组件而快照缺失时会抛出明确错误；不会伪造默认道路或高度。

| 原组件/依赖                                | 对应输入                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Node / Edge / Curve                        | nodes `{position,rotation}`；edges `{start,end}`；curves `{bezier,length?}`                                     |
| ConnectedEdge / Owner / PrefabRef          | connectedEdges 的有序实体数组；owners、prefabRefs 可明确包含 Entity.Null                                        |
| Prefab.NetData                             | netData `{requiredLayers,connectLayers}`，保留 source CanConnect 与 LaneEditor 条件                             |
| NetGeometryData                            | geometryData `{flags,defaultWidth,defaultHeightRange,mergeLayers}`                                              |
| PlaceableNetData                           | placeableData `{snapDistance,placementFlags,minWaterElevation,elevationRange}`                                  |
| LocalConnectData / RoadData                | localConnectData.heightRange；roadData.flags                                                                    |
| Composition / NetCompositionData           | compositions.edge；compositionData.width                                                                        |
| RoadComposition / Road                     | roadCompositions.flags；roads.flags（起终点半格对齐）                                                           |
| EdgeGeometry / NetCompositionArea          | edgeGeometry 的 start/end、left/right 曲线；compositionAreas 的有序 flags/position/width/snapPosition/snapWidth |
| Transform / SubObject / ObjectGeometryData | transforms.rotation；subObjects.prefab；objectGeometry 的 flags/legSizeX/legOffsetX                             |
| NativeQuadTree                             | 有序 candidates 与原 bounds，完整 Intersect/Iterate 和方法内候选过滤仍执行                                      |
| Terrain/Water 查询                         | sampleTerrain 与 sampleSurface 回调，queries 中记录实际请求位置及调用顺序                                       |

曲线统一使用 `CS2RoadCurve = readonly [V,V,V,V]`，与共享源几何模块一致。原序列化资产参数没有从托管程序集完整恢复；RoadLab 应明确映射自己的道路宽度、层、flags 和地形，不把这些输入冒充原游戏全部 prefab 值。

RoadLab 目前的地形是实际的 y=0 平面且没有水。集成时返回 `{height:0,depth:0}` 是该世界的真实输入；本模块没有给任何世界暗中补零。`adjustHeight:false` 只用于检查原始吸附阶段，生产默认执行完整高度调整。

## 保留的源细节

- 源 SnapDistance 至少为 1；8m 分区格、4m 半格和优先级距离归一化是方法内的固定值。
- 曲线距离使用原 16 段初搜与 4 次局部细化，长度采用原分段算法；Bezier4x2 的加法分组与 Bezier4x3 不同，不能直接以三维函数投影代替。
- SnapCellSize 分支会量化 `curvePosition`，位置仍按原 t 计算；保留原控制流，不凭视觉将它们强制改成同一个参数。
- HandleCurve 在禁止中段连接且 continue 的分支不会推进偏移量；保留源循环顺序。
- AddSnapLine 比较所有既有非平行线，生成更高交点优先级；曲线参数按源 ExtendedCurve 分支恢复。
- 不同高度的范围、连接层、已有结构 owner 与禁止中段连接共同影响结果。最终高度阶段还会复核可合并高度并清除不兼容的 originalEntity。

## 范围边界

这里实现的是完整道路/控制点/高度吸附阶段。原 SnapJob 的建筑侧面、LotGrid、ZoneGrid、岸线寻找、世界边界、AutoParent、音效，以及连续曲线/网格的后续 AdjustMiddlePoint 和 Replace 升级路径属于其它方法。本模块不把这些阶段标记为已完成；Replace 模式明确要求其独立升级工作流。

候选树本身的原生索引结构与完整地形/水体采样并未移植，宿主应提供真实查询输入。现有的道路状态、预览、最终提交和撤销仍需编辑器整合测试。

## 原始证据与验证

源 Game.dll SHA256 为 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID 为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`。

独立 oracle 位于 `/home/bhw/repos/roadlab-reverse/oracles/road-snapping/`。`extract.py` 机械提取完整 NetIterator 和上述 SnapJob 方法体，保留源码体 SHA；只有 ECS 容器、候选树遍历和明确高度采样边界替换。ToolUtils 的优先级、比较、方向、旋转与 AddSnapPosition 以及 NetUtils/Colossal 几何实际执行原 DLL；需要 NativeList 的 AddSnapLine 使用自动源提取方法体及托管列表。没有用 TypeScript 的输出作为预期值，也未声称执行完整 Unity World。

fixture 记录原方法 token/IL SHA、程序集身份、完整提取体 SHA 和边界说明。反编译 C# 只在独立分析工作区中。

```sh
npx vitest run tests/cs2-road-snapping.test.ts
```

当前 **673 项测试通过**：415 个完整候选世界、256 个直接执行原 DLL 的 XZ/Extended 曲线对照，以及来源/必需采样合约检查。世界覆盖端点/中段/延伸、不同宽度与偏移阈值、格长与半格、所有原几何分支 flags、layer/owner/高度、直线/弯线/旋转区域、方向/网格/连续控制点、导线交点、组件缺失和优先级次序。模块与测试的定向 strict/noUnused 类型检查通过。

这些证据证明提供输入上的阶段对应关系；编辑器接线、实际地图与浏览器操作的验证由集成者继续完成。
