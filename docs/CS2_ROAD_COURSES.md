# 原式道路建造课程与定义命令

`src/core/cs2-road-courses.ts` 恢复所提供 `Game.Tools.NetToolSystem.CreateDefinitionsJob` 的直线、简单曲线、复杂曲线、连续曲线及相关控制点/定义状态。它返回完整 `NetCourse` 和创建命令，供编辑器预览与提交使用同一份结果。

来源为用户提供的 **1.6.0f1** `Game.dll`，SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`、MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。反编译原文件留在独立分析工作区，没有加入 RoadLab 仓库。

## 实际移植范围

| 原方法                             | 本模块行为                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CreateStraightLine，3603           | 起点高程限制、零最大坡度的同高处理、源随机种子、StraightCurve、端点标志、方向反转、Owner 和创建命令       |
| CreateSimpleCurve，3915            | 起点/中点高程限制、宽度相关的窄角控制点修正、原 FitCurve(Line3,Line3)、线性高程、完整端点/命令流程        |
| CreateComplexCurve，4305           | 两端切线、退化时回退 Simple、控制柄修正、平行/反向分支和完整创建流程                                      |
| CreateContinuousCurve，4460        | 原方向输入；接近直角时两段曲线与共同中点、NoCurveSplit、反向终点处理、双随机种子和严格命令顺序            |
| FixElevation / SetHeight           | 保留原控制点修改范围；源方法不会对简单曲线终点再次执行 FixElevation，SetHeight也不改其elevation字段       |
| LinearizeElevation，4660           | 单段线性高程；双段共同中点高度为总起终点高度的均值                                                        |
| GetCoursePos，4674                 | Edge起终点/中段或Node引用、实际分割参数、水平节点旋转、Owner链ParentMesh选择、Building/Extension停止条件  |
| InvertCourse                       | 反转曲线与原指定的端点字段、绕Y轴转180度、左右标志；原未交换的Entity、SplitPosition、CourseDelta继续保留  |
| GetOwnerDefinition / GetLocalCurve | 完整Owner缓存、编辑器控制点所有者、Temp原实体、InstalledUpgrade、变换/曲线所有者、SubObject选择与局部曲线 |
| GetCutPosition                     | SnapCellSize时按原8米网格与0.16米偏置进行偶数舍入                                                         |
| MathUtils.Cut(Bezier4x3,float2)    | 原多项式控制点裁剪，支持部分、反向和退化范围                                                              |

真正的 `NetUtils.FitCurve` 等数学实现复用已独立原DLL对照的 [道路几何](CS2_NET_GEOMETRY.md)。不能将旧的二次曲线转三次控制柄当作原SimpleCurve：原式先调整窄角中点，然后按两条向内的线拟合，并独立线性化高程。

## 接口

```ts
const world = createCS2RoadCourseWorld({
  geometryNets: new Map([
    [assetId, { defaultWidth: roadWidth, maxSlopeSteepness: slope, flags: 0 }],
  ]),
});
const result = cs2CreateRoadCourses(world, {
  mode: "simple",
  prefab: assetId,
  batchSeed,
  controlPoints: [start, middle, end].map((p) => cs2RoadCourseControlPoint(p)),
});
if (result.status === "complete") {
  const previewCurve = result.courses[0].curve;
  const definitions = result.commands;
}
```

`CS2RoadCourseControlPoint` 与原ControlPoint完整字段同形：position、hitPosition、direction（原XZ对应x/y）、hitDirection、rotation、originalEntity、snapPriority、elementIndex、curvePosition和elevation。工厂函数是RoadLab画布命中的显式适配：默认无原实体和父网格，不声称等于所有Unity默认构造状态。吸附模块提供真实字段时可以直接传入。

world明确表示当前存在的Geometry/Placeable、Edge、Node、Owner、Temp、LocalTransform、Transform、Curve、PrefabRef、Attachment、InstalledUpgrades、SubNet及PrefabSubObject组件/缓冲。缺失组件保持缺失。Placeable可提供实际高程范围；Geometry.defaultWidth是整幅断面的宽度，不是单车道宽度。不能把缺失资产字段推断成已恢复全部原版资源。

输出包含：

- `courses`：完整端点CoursePos、curve、elevation、length和fixedIndex。
- `commands`：原顺序的CreateEntity与CreationDefinition/Updated/OwnerDefinition/LocalCurveCache/NetCourse等组件命令。
- `randomState`：最后一份局部源RNG的原始state，CreationDefinition种子严格使用原NextInt/NextInt2语义。
- `ownerDefinitions`和`ownerDefinitionsCreated`：区分未创建的hash表与已创建的空表，保留更新后的Owner缓存。

## 原世界依赖的明确边界

原方法在以下位置进入本模块之外的资产/世界流程：

| 依赖请求             | 调用时保留的信息                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| update-owner-object  | 原Owner、原实体、附着父对象及实际变换；对应场景对象、子网络/区域更新                             |
| create-course-object | SubObject prefab、变换、OwnerDefinition、selectedSpawnables及其IsCreated；空表与未创建表分别保留 |
| parallel-courses     | 实际定义、课程、Owner、左右数量/间距与共享nodeMap；连续双段沿用原第二随机种子的definition        |
| water-inverse-weight | 原课程和FlowLeft/FlowRight标志；需要真实水面速度采样与原加权结果                                 |

普通无场景Owner/附属资源、无平行道路、无水流依赖的道路世界同步完成。需要上述世界系统但未提供实现时返回 `status: "pending"`、request和transaction；部分命令不会作为已完成结果交付。`transaction.advance(reply)`从原位置继续，保留命令前缀、缓存、共享表与RNG；不会重新抽种子或重跑创建前缀。等待期间调用方须保持输入/world为同一份只读快照。`cs2CreateRoadCourses`的callbacks也可以同步提供真实依赖实现。

oracle中的脚本reply只是对这些边界的验证，**不是已实现原附属资产、平行道路或水面算法的证明**。本模块恢复了完整目标课程方法的控制流与状态，仍需真实的建造提交、地形、资产资源及后续网络定义/应用系统接合。

## 独立验证

`/home/bhw/repos/roadlab-reverse/oracles/road-courses/` 保留extract.py、generate.py、Program.cs、World.cs、项目与provenance。机械提取13个完整原方法体，控制流不改；仅用字典查询、托管hash表/命令队列替换native ECS容器，并用委托实际Unity RNG的wrapper记录state。`Game.dll`的NetUtils、ObjectUtils、RandomSeed与`Colossal.MathUtils`实际执行。source方法token、IL SHA、原方法体SHA和容器/依赖替换范围写入fixture。

当前fixture有458个原式输入：346个完整课程世界（直线、Simple、Complex、Continuous），35个GetCoursePos世界、7个Cut范围和70个网格切分参数。包含高程限制、零坡度、窄角与退化回退、双段连续曲线、元数据、Owner缓存/临时对象/升级/附着、原命令次序以及每类依赖的pending和明确回复。另有provenance与独立合约测试，合计460项。它们检查同一次事务恢复时不重复前缀或RNG。

这些证据区分原完整方法体提取、实际DLL数值调用与浏览器世界适配，不等同于整个Unity道路建造系统或完整道路资产已经运行等价。
