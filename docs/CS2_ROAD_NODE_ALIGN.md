# 原式节点对齐

`cs2-road-node-align.ts`恢复完整`Game.Net.NodeAlignSystem.UpdateNodeRotationsJob`、LineComparer与实际EdgeIterator路径，使用独立[道路ECS](CS2_ROAD_ECS.md)输入。入口`cs2AlignRoadNodes(world)`返回`{status:"complete",world}`，输入保持不变。

它按原`Node + Updated`查询处理节点，读取实际Node/Edge/Curve、PrefabRef/NetData、ConnectedEdge、Temp/Hidden、Standalone与OutsideConnection。原代码没有额外Deleted排除；默认Disabled/Prefab查询行为由宿主保留。方向、连边偏移、切线配对和权重决定最终位置与旋转，排序复用原NativeSort。

这解释了端点连接链中的两步：GenerateNodes可按original身份保留旧node数据，后续NodeAlign又可以根据真实连边重算节点位置。节点身份贯穿两者，不能用“曲线终点必须等于节点坐标”替代这些阶段。本模块不重写Curve的XZ端点，也不承担GenerateNodes、GenerateEdges或ApplyNet。

独立oracle在分析目录`oracles/road-apply/`，`generate-align.py`执行机械提取的完整原job与比较器，配合真实Game.dll值类型/数学及明确的托管ECS、容器、chunk适配。生成时重新核对实际加载DLL的SHA、MVID与四个原方法token/IL SHA。原C#及Game.dll不进入RoadLab仓库。

86个完整世界覆盖0–6连边、偏移-1.95与2.3、Standalone、平地/8m/16m、反向与随机方向、不同层、OutsideConnection、Temp/Delete/Hidden及查询边界，另有超过16元素的原排序路径。整世界输出比较与输入不变性加来源检查共87项。当前测试证明这一阶段的提供输入，不代表完整原Unity城市、道路创建或交通已经完成。
