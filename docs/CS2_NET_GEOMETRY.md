# 原式道路曲线与平滑偏移

`src/core/cs2-net-geometry.ts` 移植用户提供的《天际线2》1.6.0f1 道路曲线数学，供道路工具课程、吸附和车道创建共用。曲线是按 a/b/c/d 顺序的四个三维控制点；坐标单位为米，所有原 float 运算保留 float32 舍入。

## 已实现接口

| 接口                                                          | 原方法与语义                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cs2StraightRoadCurve(start,end)`                             | `NetUtils.StraightCurve`，三分之一和三分之二控制点。                                                          |
| `cs2FitRoadCurveFromLines([a,b],[d,c])`                       | `NetUtils.FitCurve(Line3.Segment,Line3.Segment)`；两条控制线均朝曲线内部，按角度与两侧线长计算控制柄。        |
| `cs2FitRoadCurve(a,startTangent,endTangent,d)`                | 四向量 `NetUtils.FitCurve`；endTangent 沿行驶方向，原无限直线求交、平行回退及夹角混合保留。                   |
| `cs2FitRoadCurveThrough(a,startTangent,middle,endTangent,d)`  | 五向量 `NetUtils.FitCurve`；保留中点误差投影和控制柄下界约束，并非一般的穿点样条。                            |
| `cs2OffsetRoadCurveLeftSmooth(curve,[startOffset,endOffset])` | 原 `OffsetCurveLeftSmooth`；根据首/中/末的水平切线偏移，再拟合曲线，保留坡度上限与零向量分支。                |
| `cs2RoadCurvePosition/Tangent(curve,t)`                       | 原三维 `Colossal.MathUtils` 的求值与导数，保留表达式分组。                                                    |
| `cs2RoadCurveLength(curve)`                                   | 原 `MathUtils.Length`，固定16段积分。                                                                         |
| `cs2LinearizeRoadElevation(curve)`                            | 原 `NetToolSystem.CreateDefinitionsJob.LinearizeElevation` 的单曲线重载；高度按端点线性化，不修改平面控制柄。 |

原 `NetToolSystem.CreateSimpleCurve` 还包含基于道路宽度的控制点修正、允许高程、CoursePos、创建命令和归属处理。这些属于完整道路工具模块；只调用 FitCurve 不等同于完整建路过程。

## 原 DLL 对照

分析工程：`/home/bhw/repos/roadlab-reverse/oracles/net-geometry/`。`generate.py` 使用固定种子生成输入；`Program.cs` 直接调用原程序集的 NetUtils/MathUtils，并通过反射调用原 private LinearizeElevation。没有把 TypeScript 再执行一次生成预期。

fixture 记录原 Game.dll SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`、MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`、方法 token 和 IL SHA。反编译 C# 与 oracle 工程均留在分析目录，没有加入 RoadLab Git。

719 个原式场景覆盖直线、各种控制线、切线拟合、中点约束、正负与变化偏移、坡度、零长度、近似平行/反向切线和高程线性化。每个场景比较四个控制点、原16段长度，以及七个参数处的位置与导数；加来源和四分之一圆回归，共 **721 项测试通过**。

```sh
npx vitest run tests/cs2-net-geometry.test.ts
```

数值比较采用逐字段 float32 和明确的微小容差，源分支没有用简化曲线替换。输入不被修改。这些证据证明给定几何函数输入的对应关系，不证明整个原建造工具、地形、资源和道路实体世界已经移植完成。
