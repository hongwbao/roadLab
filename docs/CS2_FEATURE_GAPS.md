# 与天际线 2 交通系统的功能差距

核对日期：2026-11-07。代码状态以当前工作树为准，对照对象是用户提供的 1.6.0f1 托管程序集。下面只讨论道路与交通；城市财政、分区经营等不作为本项目的产品需求。

## 当前版本边界

- 网站现已按用户要求发布 `source-road-curves-20261107-142015` 预览，资源为 `index-B-NnWHYI.js`、`index-CxjdwM7I.css`；原稳定构建保留以便回退。
- 本次预览的 `Simulation` 已委托 `Cs2TrafficSimulation`。后续完整 owner、导航窗口与车道生成开发使用工作区，网站服务固定快照；两者进度仍须分开描述。
- 已恢复所提供核心托管程序集的可读实现；这不包含原始 Unity 工程、native player、全部序列化道路/车辆资产，也不等于浏览器运行行为已经相同。导出范围与来源见 [复现记录](CS2_RECONSTRUCTION.md)。

## 功能与证据

| 方向                 | 当前已有                                                                                                                | 尚缺或未证明                                                                                                                | 主要依据                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 道路编辑             | 资产栏、实时预览、车道与偏移吸附、指定车道组连接、平滑扩缩与分合流、自动路口、拆除/升级、转向规则、自动分段、存档与撤销 | 渐变道路中段与双向主线中段匝道的完整自动处理；复杂几何的持续通行验证                                                        | `docs/ROAD_BUILDING.md`、`docs/AUTO_TRANSITIONS.md`、`docs/ROAD_SEGMENTS.md`                                          |
| 道路底层             | 主/从车道图、局部选道、原 Bézier 重叠查询、原式预约已接入普通车链路                                                     | 原 LaneSystem 的完整 composition、Edge/Node、Merging/Split/Merge 与规则传播。当前道路分段、宽度过滤和实体归属仍有浏览器适配 | `src/simulation/cs2-network.ts`、`src/simulation/cs2-lane-overlaps.ts`、`.coordination/handoffs/cs2-lane-overlaps.md` |
| 普通车导航           | 原式跟车、制动、96 槽选道、全局异步寻路、目标更新、车道对象缓存、预约、分组运动和显示插值                               | 完整 Update/Clear/FillNavigationPaths 模块已独立验证但尚未接引擎；长期复杂路网的无穿模与完整状态接合                        | `src/simulation/cs2-simulation.ts`、`docs/CS2_SIMULATION.md`；原 CarNavigationSystem 的上述完整方法已恢复             |
| 红绿灯与路权         | 本地已有源分组与七态感应模式，同时保留手工配时；车道信号参与行车决策                                                    | 与行人、特殊车辆、完整环岛世界、完整路权创建/传播的综合行为；全部灯头显示细节                                               | `docs/TRAFFIC_LIGHTS.md`、`docs/CS2_SIGNAL_GROUPS.md`、`docs/CS2_SIGNAL_CLOCK.md`                                     |
| 出行需求             | 外部通行口、入口基准流量、0–400% 需求、排队/到达/失败会计                                                               | 居民家庭/工作/购物目的、持续出行链、时段需求与真实个体权重的城市输入；当前端口车主要映射 DummyTraffic                       | `src/simulation/cs2-simulation.ts`；原 CitizenTravelPurposeSystem 已恢复                                              |
| 停车与上下车         | PersonalCarAI 完整 owner 状态机已接实际引擎，保留完整状态与延后结构命令                                                 | 实际车位/车库查询、占用、停车几何、乘客状态更新、步行接续和费用消费仍需实现并接入                                           | `src/simulation/cs2-personal-car-ai.ts`、`docs/CS2_PERSONAL_CAR_AI.md`；实际接线见 `docs/CS2_SIMULATION.md`           |
| 行人及其他道路参与者 | 斑马线显示；若干共用内核含特殊标志与参数分支                                                                            | 行人寻路/过街/人车让行、乘客实体、自行车等完整世界与运动链路。标线和内核分支不代表这些角色已实现                            | 当前组装引擎与 `docs/CS2_SIMULATION.md` 的明确范围                                                                    |
| 公交、货运和服务车   | 共用寻路/导航基础；预约内核包含应急分支；独立挂车数学函数                                                               | 公交线路/站点/上下客、出租车派单、货运任务/装卸、应急任务与让路、服务调度、完整拖挂实体链；轨道/水运/航空交通系统也未接入   | 普通车组装范围；恢复的 TaxiAISystem、TaxiDispatchSystem、AmbulanceAISystem 等是后续移植来源                           |
| 事故及道路条件       | 若干底层 blocker、OutOfControl 等状态接口                                                                               | 事故产生、失控碰撞、受影响车道、警务与清障任务，以及道路状况/天气对交通的完整影响                                           | `docs/CS2_SIMULATION.md`；原事故/维护系统仍需世界接线                                                                 |
| 诊断与性能           | 基础在途/排队/通过/平均时间、源流量采样、Worker 寻路、车辆实例按需扩容                                                  | 交通流量/速度热力图、时段曲线与道路层诊断界面；千辆/万辆复杂路网的实际浏览器性能与长期正确性证据                            | `src/main.ts`、`src/render/scene.ts`、`docs/CS2_RECONSTRUCTION.md`                                                    |

平行道路、网格、环岛工具、非对称道路、隧道等扩展建造工具仍属于此前用户暂缓的第三批。已有高架与高度编辑不能等同于完整地形、挖方和隧道系统。这些差距保留在清单中，不据此擅自恢复第三批产品开发。

## 本轮实际复核

执行：

```sh
npx vitest run tests/cs2-simulation.test.ts tests/cs2-personal-car-ai.test.ts tests/cs2-reservations.test.ts
```

三文件共 **1,345 项测试通过**，日志为 `.cache/cs2/feature-gap-audit-tests.log`。这些分别是组装场景、owner 状态机对照和预约对照，不是完整原 Unity 城市的运行证据；PersonalCarAI 独立通过也不能证明它已经在主引擎接入。

另外重新运行两项诊断并检查其 JSON，而不是把“诊断脚本退出成功”当作交通行为通过：

- `first-transition-render-overlap`：400% 需求、入口 60 辆/分钟的过渡示例，在约 **12.18 模拟秒**检出首个同一显示时刻的车身重叠，车辆 15 与 14。原始记录为 `.cache/cs2/first-transition-render-overlap.json`。
- `unobstructed-source`：无其他车辆的直行场景，在第 192 个循环步从约 **16.67 m/s** 降到 **14.50 m/s**；需继续区分世界几何、导航窗口和原式曲率/目标限制，不能直接宣称原游戏也会这样。记录为 `.cache/cs2/unobstructed-source.json`。

诊断日志为 `.cache/cs2/feature-gap-audit-diagnostics.log`。当前结论是普通车的整合稳定性仍未达到发布新引擎的门槛。

## 最初开发顺序（道路优先调整见文末）

1. 修正现有道路世界的合流拓扑与导航窗口，补全 owner/path 生命周期，先通过普通车的复杂分合流、红灯、低流量和长期压力回归。
2. 接入真实停车与人车接续，扩展行人、不同车型和道路服务/运输任务。保留完整交通目标；不把普通车子集当作最终完成。
3. 完成诊断工具、实际浏览器规模测试，以及最终不可变构建上的编辑器/信号/交通回归，再发布新引擎。

## 游戏功能的公开对照

官方说明提供功能范围的辅助对照，算法依据仍以用户提供的程序集为准：

- [道路工具](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools)：道路与路口、停车和扩展建造工具。
- [交通 AI](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai)：出行决策、停车、事故与交通信息视图。
- [公共与货物运输](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation)：车辆任务、运输线路和换乘网络。

不能由公开功能说明反推已经实现了相应算法，也不将较新补丁或 DLC 内容混作本次 1.6.0f1 的完成标准。

## 本轮后续发布与减速对照

用户要求先上线预览后，已发布固定快照 `cs2-preview-20261107-134908`。类型检查与构建、23项实际链路测试通过；43项浏览器运行中42项通过，唯一旧实例数断言按原Unspawned可见性修正后单独复测通过。线上浏览器约61模拟秒记录24辆进入、16辆到达、0辆失败和0页面错误。完整记录见 [发布验证](verification.json)。高压分合流的穿模仍是已知问题，本次发布不代表长期压力验收通过。

将真实无车直行的frame192世界与调用序列回放到完整原式C# lane-speed oracle后，原方法同样得到16.666666→14.501171 m/s，blocker为空、类型Crossing。保持其余输入，只把路权差置0或移除Reservation组件时，原方法保持16.666666。因此该处已确认属于原式让行减速，不能再仅凭旧测试的恒速下界判错。证据保存在分析工作区 `oracles/lane-speed/live-regressions/`。

## 道路优先与原式曲线发布

用户明确优先参考原代码复刻道路建造系统。现已发布原式Straight/Simple课程事务与曲线/高程处理；不是仅在独立模块中存在。固定构建类型/生产构建、788核心检查、44完整浏览器用例通过，实际线上三点曲线鼠标/预览/撤销保存也已复测。完整PersonalCarAI已在本次预览调用。完整导航模块438独立对照仍未接实际engine。原式吸附673项与节点连接选择276项已独立完成，正在接实际建造世界；完整节点创建仍在开发。
