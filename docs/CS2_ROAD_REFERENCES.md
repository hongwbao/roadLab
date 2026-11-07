# 原式道路引用修正与节点归并

`cs2-road-references.ts`恢复`Game.Net.ReferencesSystem`五个jobs和`Game.Tools.NodeReductionSystem`两个jobs及调用到的完整helpers。它使用独立[道路ECS宿主](CS2_ROAD_ECS.md)，不依赖尚未完成的道路应用模块。

```ts
cs2UpdateRoadReferences(world);
cs2ReduceRoadNodes(world, { editorMode, candidateOrder });
cs2UpdateRoadReferencesAndReduce(world, { editorMode, candidateOrder });
```

正常结果为`{status:"complete",world,candidates?}`，输入世界保持不变。缺少直接索引的真实组件或缓冲会抛错；缺少本阶段必需资产字段时返回`pending`，并标明component、entity和fields。`candidateOrder`用于明确合法候选的宿主调度顺序，不能当作原并行队列唯一顺序。

覆盖新增/删除边的ConnectedEdge维护，ConnectedNode校验与搬迁、LocalConnect的ChooseBest/ChooseSides、Owner/Building/ServiceUpgrade分支、Temp/Deleted/Hidden，及原节点归并、长短段重分配、Road/BuildOrder转移。空缓冲是实际已创建但为空的缓冲；缺失缓冲是缺失组件，两者不混同。该阶段会从真实空缓冲产生连接关系，不要求宿主预先伪造结果。

原NativeParallelMultiHashMap容量扩张会反转旧bucket链，同距离候选的赢家可能随32/64扩容变化。实现保留该行为，并有0、31、63个额外连接的原式反例。跨chunk/线程候选顺序仍属于明确的宿主调度边界。

资产至少包括实际NetGeometryData的flags、defaultWidth、elevationLimit、elevatedLength、edgeLengthRange，以及相应NetData、LocalConnect、Building数据。未恢复的天际线资产值不等于0；RoadLab须显式定义自己的资产。尤其零elevationLimit可能按原代码将地面判为Elevated，不能将未知字段补0后声称复刻完成。

独立源oracle在分析工作区`oracles/road-references/`，机械提取七个完整jobs及相关数据结构，保留原DLL SHA/MVID、方法IL与源体SHA，实际执行原Game.dll数学与值类型。Native容器、chunk和队列由明确的托管适配实现，不声称执行原Unity World。165个完整源世界与3个合约共168项通过，整世界组件/缓冲均参与比较；独立严格类型检查通过。

本阶段处于GenerateEdges之后、NodeAlign及Composition/Geometry之前。它尚未接入最终编辑器应用事务，不能把独立模块通过视为端到端建路已完成。原C#保留在分析目录，不进入RoadLab仓库。
