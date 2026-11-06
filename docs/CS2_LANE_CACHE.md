# 原 CurrentLaneCache 与车道对象登记

`src/simulation/cs2-lane-cache.ts` 移植完整 `CarNavigationHelpers.CurrentLaneCache` 构造/CheckChanges、搜索树bounds计算，以及运行时NetUtils车道对象增删改。它以显式字典替代Unity EntityStorageInfoLookup、BufferLookup和搜索树查询，输出延后应用的命令，供原lane-speed与选道模块读取一致的世界快照。

依据是用户提供的 `Game.dll` 1.6.0f1，SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。下列源文件位于分析目录，未加入项目仓库。

## 完整路径审计结论

普通car的正常决策顺序见 `Game/Simulation/CarNavigationSystem.cs:453`–`:463`：

1. **在更新前**构造CurrentLaneCache，保存原current lane、change lane和current.xy；删除无效实体引用。
2. UpdateNavigationLanes：按PathOwner状态处理更新/作废路径、填充导航/选道与清理。
3. UpdateNavigationTarget：目标游标前移、当前lane可能切换，完成跟车/冲突限速。
4. ReserveNavigationLanes：重新计算current.y制动预约，更新未来lane的Reserved与byte预约请求。
5. CheckChanges：比较更新前后current/change/xy，发车道对象或搜索树命令。
6. 该批job结束后由LaneObjectUpdater统一应用命令，后续批次读取更新的buffers。

缓存必须包住整个导航与预约过程。如果在Reserve之前登记，LaneObject.y仍是旧预约；如果每个物理帧用nearest位置覆盖登记，则不再对应源current.xy。

**BlockedLane不是普通车辆跨lane后的旧车道车身保留机制。** 原Execute只有OutOfControl分支`:406`–`:408`传入FindBlockedLanes得到的新blocked列表。普通移动`:463`、无Moving的停止分支`:504`均传入default NativeList。CurrentLaneCache`:161`–`:173`在没有新blocked时清空旧blocked；正常current变化`:215`–`:263`直接Remove旧lane、Add新lane，没有等待后轮/车尾离开旧lane的条件。

因此本模块不会给普通car添加“多保留一段旧lane占用”。普通跟车在目标提前跨lane后仍需由后继lane扫描、真实Transform.position、车身后界和重叠窗口共同处理。若另做车身占用扩展，应明确标为额外模型，而不能冒充此源缓存。

## LaneObject运行时按 y 排序

`LaneObject.CompareTo`按x比较，但这不代表运行时更新顺序。实际 `LaneObjectUpdater.UpdateLaneObjectsJob` 通过下列NetUtils方法维护buffer：

| 源方法                                   | 运行时行为                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `Game/Net/NetUtils.cs:439` AddLaneObject | 找第一个旧对象 `.curvePosition.y >= new.y` 的位置插入，**新对象排在相等y之前**。 |
| `:452` UpdateLaneObject                  | 按y向前插入/向后移动；保留源码的同值顺序、缺失对象时加入行为。                   |
| `:494` RemoveLaneObject                  | CollectionUtils.RemoveValue按实体相等删除第一个匹配项，使用有序RemoveAt。        |

不能用每帧sort(x)代替，也不能用“先删旧对象再稳定sort(y)”替代所有更新，因为同值顺序会变化。CheckSpace等方法会取buffer里第一个满足条件的对象，顺序直接影响下游容量与blocker身份。

## 接口

```ts
const world: CS2LaneCacheWorld = {
  entities, // 存活实体Set；区别于是否有LaneObject buffer
  laneObjects, // Map<laneID, readonly CS2LaneSpeedLaneObject[]>
  searchTree, // Map<objectID, {min,max}>，提供源TryGet语义
};
const cache = new CS2CurrentLaneCache(world, current, blocked);
// UpdateNavigationLanes → UpdateNavigationTarget → ReserveNavigationLanes
const commands = cache.checkChanges(
  entity,
  current,
  {
    position,
    rotation,
    velocity,
    targetPosition,
    maxSpeed,
    geometry: { min, max, size, flags },
  },
  newBlockedLanes,
);

// 本批所有决策读取旧世界后再应用：
applyCS2LaneCacheCommands(batchCommands, mutableLaneObjects, mutableSearchTree);
```

`current` 与导航state结构兼容，使用 `laneId,changeLaneId,curvePosition:{x,y,z},flags`。构造器按原实体存在性清理不存在的current；不存在的change被清空，同时清除**Vehicles.CarLaneFlags**的TurnLeft/TurnRight，保留其它位。构造器会修改这个current对象，更新后不能再用之前的未清理副本覆盖。

`blocked` 是可变 `{lane,curvePosition:[x,y]}[]`，保留原动态buffer语义。普通移动传 `newBlockedLanes=undefined`。OutOfControl可传由真实世界查询得到的新列表；CheckChanges会按源RemoveAtSwapBack消费匹配项，保留剩余新项及其顺序，因此该参数也为可变数组。不要换成按lane去重的Map，原列表与重复项处理有明确顺序。

命令为：

- lane-add / lane-update：`lane,object,curvePosition`。
- lane-remove：`lane,object`。
- tree-add / tree-update：`object,bounds`。
- tree-remove：`object`。

原缓冲把lane/tree分到两条队列并在不同jobs应用；本模块统一返回有序命令列表，两类世界状态彼此独立。同一lane内仍须保留原命令顺序。apply会跳过已不存在的lane buffer；tree-add重复对象保留原值并返回warning，tree-update找不到对象则遵照NativeQuadTree.Update抛错误。

出生/收养时如果没有“更新前未登记”的状态，调用者需显式 `cs2AddLaneObject` 初始化。不能用cache构造器把已在current lane的出生对象凭空当作已登记。清理死亡/离场对象也需有明确remove动作。

## Source bounds

`cs2LaneCacheObjectBounds` 对应原ObjectUtils.CalculateBounds，包括GeometryFlags.Circular。普通box按旋转后的三个基向量与bounds min/max累加，保留高程；Circular用size.x/2作为XZ半径，Y来自bounds。

`cs2LaneCacheMinBounds` 对应缓存的最小预测边界：物理包围盒扩展当前velocity×4/15，以及朝导航目标方向的abs(maxSpeed×4/15)。只有它超出已登记搜索树边界时才发更新。

`cs2LaneCacheMaxBounds` 对应原最大缓存边界：物体size长度的一半为球形半径，中心Y加size.y/2；包含velocity×−1.0666667、velocity×2与目标方向abs(maxSpeed×2)。这是原搜索树维护的宽边界，不是车辆让行/碰撞预测时间，也不额外生成速度限制。

## UpdateNavigationLanes 与普通占用边界

`:666`–`:706`的原UpdateNavigationLanes本身不写BlockedLane或LaneObjects：它处理无效lane/Obsolete、查找当前lane、Updated path起点、Pending/Scheduled、FillNavigationPaths，以及必要时ClearNavigationForPathfind并清空path elements。两种ClearNavigationLanes保留Reserved/ClearedForPathfind边界。对象登记由后面的CurrentLaneCache统一处理，不能为了寻路或物理位置更新自行追加登记。

`:2265`开始的ReserveNavigationLanes先计算current.y，再限制到current.z并向后继lane发布byte预约/Reserved flags。普通car没有把每条未来lane都加入LaneObjects。源ApplySideEffects和路径/选道状态不由这个cache模块代替，仍由engine与对应源模块负责。

本模块完整保留CurrentLaneCache所有分支。`FindBlockedLanesIterator`的物理胶囊与Bezier相交查询、NetSearchTree候选收集、OutOfControl状态机与TrailerLaneCache仍需各自后续源移植；这里接收其明确的newBlocked结果，不把普通car的nearest投影或旧lane车尾假设伪装为该查询。车道外搜索树字典提供接口与已验证的bounds/命令语义，没有声称复现NativeQuadTree内部节点分配与遍历。

## 独立oracle与验证

`/home/bhw/repos/roadlab-reverse/oracles/lane-cache/` 的 `extract.py` 自动提取完整CurrentLaneCache及NetUtils三个运行时方法。原构造器、CheckChanges、bounds与增删改方法体未重写。仅namespace/struct名称与lookup/container/command写入适配成托管字典和列表；原ObjectUtils/Unity.Mathematics/Colossal数学DLL继续直接执行。

整个cache oracle因此标记为**源方法自动提取＋字典ECS适配**，不能叫原Native ECS完整执行。ObjectUtils子方法是真正直接调用原DLL。provenance保存原程序集身份、源文件SHA和各方法IL SHA；bounds之外的原生树结构不在本轮oracle执行范围内。

验证包含：

- 397个cache世界场景：构造器实体删除、普通lane切换、change晋升/新增/删除、curve.xy变化、lane↔树、blocked模式进入/差分/退出、swap-back剩余顺序、树边界更新与重复登记。
- 256个body向量，各比较原ObjectUtils bounds与缓存min/max；含任意3D旋转、Circular与非Circular、正负导航速度/速度向量。
- 160组、每组20次增删改，共3200次buffer操作后逐步比较完整数组，覆盖同y、多对象、更新缺失对象、重复实体与有序删除。
- 普通target提前跨lane但物理body尚在旧lane时，明确对照“Remove旧/Add新，无额外blocked”。

```sh
npx vitest run tests/cs2-lane-cache.test.ts
```

当前**562项独立测试通过**。实体、命令类型、布尔分支、数组成员/顺序精确比较；浮点bounds用明确的少量ULP容差，未以宽松碰撞距离自证。真实交通稳定性仍需engine在完整source图、预约、选道与运动链上验证。
