# 完整导航路径窗口与路径更新

`src/simulation/cs2-navigation-paths.ts` 移植用户提供 1.6.0f1 的 `CarNavigationSystem.UpdateNavigationJob` 中 Update/Clear/Fill 导航路径控制流，包含普通车与自行车的所有分支。源 C# 保存在独立分析工作区，没有加入 RoadLab Git。

本模块完成路径窗口与其状态转换；空间搜索树的实际 FindLaneIterator 查询仍是明确的外部依赖。停车、公交、居民和完整世界的其它系统不会因为这里能处理相应车道标志就自动完成。

## 源方法范围

| 原方法                                     | token               | 本模块处理                                                                |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| UpdateNavigationLanes                      | 100695327           | current 恢复、Updated/Pending/Append 分支、路径失效与清除                 |
| ClearNavigationLanes 两个重载              | 100695328/100695329 | Reserved/Cleared 前缀保留；无效路径的制动距离前缀                         |
| TryFindCurrentLane 两个重载                | 100695330/100695331 | 查询前缀、100m 边界、未来位置、访问所有者与查询结果写回；查询本体显式等待 |
| FillNavigationPaths                        | 100695332           | 完整 12 个未来车道窗口、剩余路径抽样校验与所有特殊分支                    |
| IsContinuous / IsBlockedLane               | 100695333/100695334 | master 身份及 PathNode 比较；blockage 使用已校验 lane-select 实现         |
| GetTransformTarget / UpdateSlaveLane       | 100695335/100695336 | PropertyRenter、Transform/Position、最近 slave、FixedLane                 |
| GetSlaveLaneFromMasterLane / GetRandomLane | 100695337–100695339 | 复用已校验的 `cs2ResolveLaneSelectionMaster`，保持原 RNG 顺序             |

还完整移植 `VehicleUtils.ClearNavigationForPathfind` 的制动距离与前缀截断；Transform 目标位置包含原建筑前沿位置计算。最终 96 槽反向成本与正向选道调用已校验的 `cs2SelectOptimalLanes`，没有重新编写另一套选择策略。GetNextLane 的独立源实现继续由 lane-select 提供。

## 接口与世界组件

```ts
const world = createCS2NavigationPathsWorld({
  selection, // CS2LaneSelectWorld：Lane/Curve/CarLane/Master/Slave/Owner/SubLane
  entities, // 与组件是否存在分开的真实 Entity.Exists 集合
  // 可选：parkingLanes, connectionLanes, pedestrianLanes,
  // transforms, positions, prefabRefs, buildings, owners, propertyRenters
});
const result = cs2UpdateNavigationPaths(world, {
  entity,
  priority,
  current,
  nextLanes,
  pathOwner,
  path,
  randomState,
  transform,
  velocity,
  target,
  car,
  carFlags,
  isBicycle,
  blocker,
  leftHandTraffic,
});
```

`createCS2NavigationPathsWorld` 对未提供的组件创建空 Map/Set，表示这个世界确实不存在对应组件。`selection` 中 lane 的 owner 与额外 `owners` 中的 vehicle/controller owner 属于同一种原 Owner 组件，宿主不得提供互相冲突的重复快照。真正的 Net.ConnectionLane 与普通转弯 NodeLane 是不同组件。

PathElement 为 `{target:string|null, delta:[start,end], flags}`；PathOwner 为 `{flags,elementIndex}`。保持完整原 owner buffer，不能把当前导航窗口或物理道路组索引当成 PathOwner.elementIndex。

成功输出包含 `status:complete` 以及新的 `current`、`nextLanes`、`pathOwner`、`path`、`randomState` 和诊断 `invalidPath`。输入状态不被修改，所有源状态应由宿主统一写回，再进行速度/目标/预约等后续阶段。

`randomState` 是已经初始化的活跃 Unity Random.state；这里不调用构造预热。12 个未来车道之后的剩余路径有效性抽样也按源消耗两次随机数，最多抽取剩余 40,000 个元素。

## 需要保留的状态语义

- Updated 由后续 owner AI 消费。这里遇到 Updated 且非 Append 时只截取已预约/已为寻路清理的导航前缀，不提前清 Updated。
- Pending/Failed/Obsolete/Updated 的前缀截断与路径真正失效时的制动距离清理是两种不同操作；后者可保留当前速度所需的安全距离，并设置 ClearedForPathfind。
- PathStart 对同 master 且前后区间端点相等的路径元素延长当前 z 或上一个未来车道的 end，消耗该路径元素并继续填充。不要再次添加当前车道，也不要一律跳过首个路径元素。
- master nomination 在连续性校验之前执行并消耗原 RNG，即使随后发现同车道而折叠路径也保持这些 draw。
- 保留转向、环岛、逆行、Unsafe/RequestSpace、出入停车侧向、Area/Connection/Parking、Waypoint、TransformTarget、GroupTarget/StayOnRoad 等全部 Fill 分支。
- PropertyRenter 的空 property、PrefabRef 组件内的 Entity.Null 与组件缺失不同。缺 PrefabRef 的 Transform 查询按源视为无效世界输入，不能自动伪造成功。
- 路径目标 Entity.Null 在一般 Fill 中失效；Updated/current 查找失败的源 fallback 仍可按构造函数生成空 current，不能提前替换成最近车道。

## FindLane 查询合约

current 不存在或 Obsolete 时，原方法准备 FindLaneIterator，然后依序搜索 net、static objects、areas 三棵空间树。本模块输出 `status:pending`、`request` 与 `transaction`，请求包含预测位置、100m bounds/minDistance、Car/Bicycle 类型、访问限制 owner 和原查询结果初态。

宿主取得真实查询答复后执行 `transaction.advance({current})`；也可用 `findCurrentLane(request)` 同步回调返回同一合约。没有答复时保持 pending，不把未实现查询当成“没找到”。若查询确实没有结果，应明确返回 laneId=null 的 current。暂停期间宿主须保持 world/input 快照一致；只在 complete 后提交全部输出，不在恢复时重新执行原前缀或重复 RNG。

`cs2FindTrailerNavigationLane` / `CS2TrailerLaneFindTransaction` 提供原挂车重载的查询包络。该重载从默认 current 结果开始，并在获得结果后清空 NextLane/NextPosition；完整挂车控制、空间查询与实体链仍由其它系统负责。

## 独立 oracle 与验证

源程序集 SHA256 为 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID 为 `36b776ac-5007-4e06-81b3-242b2abfd5b6`。

本地 oracle 位于 `/home/bhw/repos/roadlab-reverse/oracles/navigation-paths/`：

- `extract.py` 机械提取完整原 Update/Clear/Fill/Find 包络及其它 helper 方法体，记录源体 SHA；仅替换 ECS 容器和明确的空间树查询边界。
- 原 Game structs、Unity Mathematics/RNG、VehicleUtils 标量助手和 BuildingUtils 前沿几何实际执行原 DLL；lane selector 复用独立验证过的完整源提取 iterator。
- ComponentLookup/DynamicBuffer 替换为字典/可变数组；三次树调用保留原顺序，但以明确提供的 FindLane 查询响应恢复，不声称执行原 native 搜索或 Unity World。
- fixture 保留原方法 token/IL SHA、程序集身份、机械提取方法体 SHA 与适配说明。没有用 TypeScript 自身输出生成预期值。

435 个完整世界/查询包络场景对照 current、未来队列、完整 path/owner、RNG 和空间查询请求。覆盖 pending/updated/append、12 窗口及剩余抽样、PathStart、转向与特殊车道、停车侧向、建筑/租赁/空实体、失败清理、正反向/零长度制动前缀、自行车访问、挂车包络和随机多车道世界。

```sh
npx vitest run tests/cs2-navigation-paths.test.ts
```

当前 **438 项测试通过**，定向 strict/noUnused TypeScript 检查通过。这些是方法控制流/世界适配边界对照；整合引擎仍需检查接线与复杂场景，不代表完整城市交通已经等价。
