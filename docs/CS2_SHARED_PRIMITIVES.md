# 道路车道系统的共用原语

`src/core/cs2-native-sort.ts`与`src/core/cs2-path-node.ts`将已校验的原语移到独立模块，供车道选择、实际节点创建和LaneReferences后处理共同调用。它们不创建RoadLab路网，不把独立原语视为完整道路系统。

`cs2NativeSort<T>(array,compare)`保留Unity.Collections的原地introsort、16元素阈值、pivot分区、堆排序和相等键的顺序。它来自已经冻结的节点车道选择模块；原式机械提取C#比较世界和方法体证据见[节点车道选择](CS2_LANE_GENERATION.md)。调用方仍须实现各自原比较器的uint分组、符号与溢出规则，不能用JavaScript稳定排序替换此核。

`cs2PackPathNode`、`cs2ReadPathNode`和`cs2StripPathNodeCurve`保留原64位owner、lane/segment、量化曲线位置和secondary布局。原`cs2-network.ts`继续重导出同一函数，兼容现有调用。节点创建直接依赖core原语，消除先前creator反向依赖完整network的问题。[网络模块](CS2_NETWORK.md)包含320个直接执行原Game.dll的构造/读取/剥离对照；完整节点创建另检查实际源方法生成的PathNode与命令。

这一提取为后续节点创建→引用排序→重叠生成→速度初始化顺序提供共同基础。源组件初始索引与速度不能跳过后处理直接当作最终交通图。

## 原式曲率共用核

`cs2-road-curviness.ts`统一节点创建与实际行车模型的`NetUtils.CalculateCurviness(Curve,float)`。它使用原式3D Bézier位置/切线、未放大的首末切向量、float32点积与rsqrt顺序，以及短曲线smoothstep；原`cs2CurveCurviness`与`cs2CreatedNodeCurveCurviness`导出保留，并指向同一函数。

旧行车模块的曲线采样与距离/归一化顺序有近似。这一差异在完整节点创建世界中暴露后，新增658个直接执行原Game.dll的曲率输入，包含短曲线、退化、近直线、大坐标、宽度和0.1m长度边界。全部结果按原float32值精确比较，另保留DLL SHA、MVID和方法IL SHA。原oracle位于独立分析工作区`oracles/road-curviness/`，没有重写C#期望函数。

诊断记录了旧实现与这些原输入的数值差别；其中部分是极短曲线/人为指定长度的边界输入，不能当成实际地图拥堵或可见穿模的修复证据。实际引擎和路网仍需各自集成验证。
