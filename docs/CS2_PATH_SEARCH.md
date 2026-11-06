# CS2 普通道路全局寻路与异步请求

本模块从用户提供的 Game 1.6.0f1 (419.d6c6) [6216.19404] 恢复 C# 端口普通 Road/MediumRoad 的全局执行器。它是当前浏览器道路图上的 **cs2-derived** 实现；不是 Unity ECS、所有交通方式和原生线程池的完整运行时复制。

## 文件与接口

- `src/simulation/cs2-path-search.ts`：原控制流的执行器、四叉堆、Unity 随机数、编译图。
- `src/simulation/cs2-path-worker.ts`：安装图、执行队列、协作式预算、取消协议；作为独立 module Worker 入口。
- `src/simulation/cs2-path-service.ts`：主线程服务、generation/revision/token 隔离、浏览器 Worker 与可测 in-process transport。
- `tests/fixtures/cs2-path-search-oracle.json`：独立 C# oracle 的完整输入和输出。
- `tests/cs2-path-search.test.ts`、`tests/cs2-path-service.test.ts`：算法对照和异步生命周期验证。

```ts
const service = new Cs2PathService({ budget: 512 });
service.configure(graph); // 每个图配置发送一次完整图
const result = await service.submit({
  requestId: 1,
  revision: graph.revision,
  start: [{ edge: 0, delta: 0 }],
  end: [{ edge: 3, delta: 1 }],
  parameters: {
    maxSpeed: [35, 35],
    walkSpeed: [1.5, 1.5],
    weights: [1, 1, 1, 1],
    methods: 8194,
    pathfindFlags: 0,
  },
  seed: batchSeed,
  actionIndex: 0,
});
service.cancel(1);
service.dispose();
```

无 Worker 的测试/宿主环境使用同引擎的 in-process transport。同步验证入口为 `searchCs2Path(graph, query)`；`new Cs2PathSearch(compiledGraph, query).step(popBudget)` 可保留完整状态分步推进。

`Cs2SearchGraph` 只含可结构化克隆的 DTO。边 ID 必须等于数组下标，owner 是映射回游戏车道的字符串，start/end/middle 是非负源风格节点 ID，缺失 middle 不产生连接。编译图按边数组次序建立正反向连接表；这是本游戏图编译适配的确定次序，并未声称恢复了某个存档中 NativePathfindData 经增删后的实际内存顺序。若必须复现特定源世界的平局结果，还需导出该世界的连接表顺序。

`location` 为原 `LocationSpecification.m_Line` 两端点，单位米，仅用于目标边位置和启发式；`specification.length` 是实际弧长米。速度 m/s，时间秒；costs/weights 顺序为 `[time, behaviour, money, comfort]`。边 flags/rules、flowOffset、accessRequirement、blockageStart/End 使用原枚举/字节语义，不是浏览器自造惩罚。默认 accessRequirement=-1、target flags=0xfeff。输入应为已解析到对应主/次级图的有效 edge；这里直接传 dense edge ID，省略原 Entity→主/次级 edge map 查询。

`heuristicCosts.road` 是 NetInitializeSystem 汇总的 car driving prefab 逐分量最小值，不含时间项。源编码默认 driving `[0,0,.01,0]` 可用于缺少 prefab 资源的普通道路适配；执行器再加 `time += 1/max(.01,maxSpeed.x)`，dot 权重，先与 1,000,000 取 min；非 Stable 乘 2。居民/资产的实值须由调用方明确提供，不能把这个 fallback 称作完整成人驾驶偏好。

返回 steps 为沿行程顺序的 `{edge, owner, delta:[from,to]}`，保留首尾部分边。distance/duration 是重建时按真实距离和速度计算的值；随机化后的 cost 不能当实际秒数。status 区分 found/unreachable/max-cost/cancelled/stale/unsupported。

## 源调用链与保留的语义

证据根为 `roadlab-reverse/decompiled/Game/Game/Pathfind/`：

1. `PathfindQueueSystem.Enqueue` → Pending action；`ScheduleActions` 等依赖完成，放入 worker actions，并置 Scheduled。
2. `ScheduleWorkerJobs` 为一批动作获取一个 `RandomSeed.Next()`。worker 用 Interlocked 分配 batch 内 action index；`PathfindJobs.PathfindJob.Execute` 收到 `GetRandom(index)`。
3. `PathfindExecutor.Initialize` 设置方法启发式、方向/访问掩码和分配状态；`AddTargets` 求端点 bounds、最小成本、访问要求，必要时交换搜索方向。
4. `FindEndNode` 按源四叉 heap 弹出节点、关闭状态、检查最大成本/目标，再按连接顺序执行 `CheckNextEdge` / `AddConnections`。
5. `CreatePath` 回溯 source index，输出原边 owner/部分 delta，累计距离和时间，按是否倒向交换 delta 或反转列表。
6. action 完成后由结果系统应用；PathOwner 的 Pending→Updated/Failed/Stuck 处理在 `cs2-path-policy.ts`，需要主模拟接线，服务自身不擅自改车辆状态。

关键控制流不是常规 Map+Dijkstra 的等价改写：

- 四叉 heap 的 child 比较树偏移 `[0,2,1,3]`，只有严格 cost 小于比较，没有额外节点 ID 平局规则。
- FullNode 包含 node ID 和 curvePos；终点是 edge ID 编码的负节点。目标本身可在道路中途。
- 源 sentinel int.MaxValue 和负数 source index 表示尚未关闭；弹出关闭后不 reopen；旧堆条目按关闭状态跳过。
- 源节点桶采用 `abs(nodeID)>>4` 加链表；按原 NodeData 赋值重置 next 指针，未换成行为可能不同的单一 FullNode Map。
- 根据端点 bounds 大小/ForceForward/ForceBackward/多来源或多目的标志决定搜索反向；反向交换连接表、Forward/Backward、FreeForward/FreeBackward。
- 闭塞区间是硬拒绝；原交通规则/授权大部分是向量软成本。访问要求、AllowEnter/AllowExit、ForbidExit/ReducedAccess、连续 SingleOnly 均保留。
- 中间连接保留源 NextEdge 快捷分支、不同后继时撤销优化的规则。没有为全局图发明跨普通车道横移边。
- 每次 AddConnections 在检查方向之前消耗一次 `[.5,1)` 随机 draw，并在同次候选边段上复用。Stable 仍消耗随机数，只把倍率选为 1。
- maxCost 对扣除端点最小成本后的队首 total cost 判断；maxCost=0 表示 float.MaxValue。unreachable 的 graphTraversal 是 FindEndNode 进入时的 NodeData 长度，源返回值如此，非最终探索长度；另提供 expanded 作为清楚的诊断数。
- OutsideConnection 回溯时把报告速度上限提高到 277.77777m/s，并对更早回溯边持续生效，保留原顺序副作用。

## 随机源与稳定性

`Game.Common.RandomSeed` 的全局生成器以 `DateTime.Now.Ticks` 初始化，Next 给一批动作生成 seed；因此没有从源码可恢复的固定“某类司机种子”。可重放接口显式传 batch seed 和 actionIndex：

```text
seed = uint(batchSeed ^ uint(370248451 * actionIndex))
seed == 0 → 1851936439
Unity.Random 构造器先推进一次状态
NextState: xorshift <<13, >>17, <<5；返回推进前状态
NextUInt: NextState()-1
NextFloat: asfloat(0x3f800000 | (NextState() >> 9))-1
```

普通无居民 PersonalCar fallback 没有 Stable，使用 pathfindFlags=0；Stable 是明确的源参数，不是默认提高确定性的开关。方法/源参数依据见 `CS2_ROUTING.md`、`CS2_PATH_POLICY.md`。浮点按源关键运算逐步 f32；这里验证的是提供 DLL 的 managed CLR 逻辑，未验证 Unity Burst 编译器在全部硬件上的浮点收缩结果。

## Oracle 的可信边界与再生成

Game.dll MVID：`36b776ac-5007-4e06-81b3-242b2abfd5b6`。

**直接执行原 DLL**：RandomSeed.GetRandom、Unity.Mathematics.Random、原 Game structs、PathUtils/Colossal 数学。在 16 组 seed/actionIndex（含 0 和 uint/int 边界）各跑 8 对 NextFloat/NextUInt；共 128 对随机 draw，比较每次状态。

**source-extracted**：原 PathfindExecutor 的完整结构与方法、FullNode/NodeData/HeapData/TargetData，以及整个 Colossal UnsafeMinHeap<T>，由脚本按括号自动提取，不手工改写搜索算法。仅把原生容器/图存储换成类型安全的 C# 数组/字典、把 executor struct 换成单实例 class，并增加 expanded 计数和只读状态。提取清单保留原各类型 SHA-256。不能把这些结果称作直接执行 Game.dll 私有 executor；完整 ECS/native graph 尚未在宿主 .NET 中构建。

243 个完整查询场景包括 Stable/非 Stable、NoHeuristics、IgnoreFlow、强制/自动倒向、部分边/同边目标、target costs、maxCost、闭塞、规则豁免、流量降速、连续 SingleOnly、自由方向、OutsideConnection、访问/授权、中间连接、循环、竞争路径、多个目标。逐项比较路径边/delta、cost、distance、duration、expanded、graphTraversal、RNG 终态、方向及端点。另对全部场景用单 pop 预算重放，确认协作让步不会改变结果。

本机再生成命令（证据工程保留在应用仓库之外）：

```sh
cd /home/bhw/repos/roadlab-reverse/oracles/path-search
python3 generate.py
python3 extract.py
/home/bhw/repos/roadlab-reverse/tools/dotnet/dotnet run --project PathSearchOracle.csproj --configuration Release
cp oracle-output.json /home/bhw/repos/interchange-lab/tests/fixtures/cs2-path-search-oracle.json
```

## 浏览器调度与剩余边界

原游戏设置 `max(1, JobWorkerCount/2)` 常规工作线程，可随高优先级请求增加调度，拥有双份 worker graph、原生线性分配器和 graph modification 依赖。每条搜索在 worker 中完整运行，源码该分支没有“每车最多若干秒/固定节点数便宣布失败”的预算。

本服务目前一个浏览器 Worker，按 FIFO 执行；budget 只在 heap pop 之间让出 Worker event loop，让取消/重配可进入，不截断搜索、不丢堆、不重新抽 seed。它不复制 Unity 原生线程池、高优先级/跨动作种类调度、线性分配器和双图增量修改。configure 只安装一次可共享图，之后每请求只发送 query DTO；每次配置递增 generation，即使数字 revision 重用也取消旧结果。token 防止同 revision/requestId 取消后重用时被迟到结果污染。

本次投影为普通 Road/MediumRoad、单结果。停车/登乘/公交/出租车/轨道/飞行/越野/自行车及复合行程、ParkingReset、原城市资源/居民/目的地选择、同批多结果及完整目标 Entity map 等仍需扩展。查询非普通方法明确返回 unsupported，不把普通 A* 结果冒充这些分支；道路拓扑、主/从车道和 prefab 参数由独立世界图编译器提供。原完整 C# oracle 保留其他方法体，后续可逐分支新增资源适配和测试。
