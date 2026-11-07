# PersonalCarAI：完整车辆 owner 状态机

`src/simulation/cs2-personal-car-ai.ts` 移植本次程序集中的 `PersonalCarAISystem.PersonalCarTickJob.Tick` 与全部私有helper分支。它处理普通个人车辆、居民/游客/通勤者乘车、DummyTraffic、上下车、路径更新/失败/终点、停车转换、家庭收费及完整寻路请求参数。

来源为用户提供的 `Game.dll` **1.6.0f1 (419.d6c6) [6216.19404]**，SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`，MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`。源导出位于本地 `/home/bhw/repos/roadlab-reverse/decompiled/Game/Game/Simulation/PersonalCarAISystem.cs`，没有放进RoadLab仓库。

## 源调用链与调度

`Game/Common/SystemOrder.cs:310,334,337` 的顺序是 **CarNavigation → PersonalCarAI → CarMove**；LoadSimulation的610/621/623行相同。PersonalCarAI按 `frameIndex % 16` 选择UpdateFrame组。

Owner job的Execute先调用CheckUnspawned，再执行Tick，并把personalCar、car、currentLane、pathOwner、target全部写回。Tick实际方法链如下：

| 原方法/行                                         | 行为                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tick，288                                         | 清Updated并ResetPath；自行车访问限制；失效目标/Failed/Stuck；停车/上下车；路径终点/waypoint；新寻路或停车检查。                                             |
| CheckParkingSpace，406                            | ValidateParkingSpace；从剩余path最多40000个元素中按原两次随机抽样挑选；检查停车位/车库与更早停车备选；必要时置Obsolete。                                    |
| ResetPath，464                                    | Transporting且非自行车时设置Car.StayOnRoad；重置停车状态、停车曲线位置。此版本 `PathUtils.ResetPath(ref CarCurrentLane,...)` 的实际函数体为空，保留此事实。 |
| RemovePath，480                                   | 清PathElement buffer及ElementIndex，不擅自清空所有PathFlags。                                                                                               |
| Start/StopBoarding，486/583                       | Dummy不能开始boarding；等待真实Ready；识别leader、复制其剩余路径和目标，推导HomeTarget并清EndOfPath。                                                       |
| HasPassengers/FindLeader/PassengersReady，496–582 | 支持Layout内多车辆；FindLeader返回首个Leader，PassengersReady遍历后保留最后一个Ready Leader；不存在CurrentVehicle组件的乘客按原分支跳过。                   |
| Start/StopDisembarking，625/688                   | 等乘客真正移除；设置Disembarking；处理spawn处路径元素；对有leader的居民家庭发布停车费转账与费用事件。                                                       |
| ParkCar，700                                      | Dummy删除；普通车转换ParkedCar并发布FixParkingLocation/PathfindUpdated；清拖车Layout；自行车保留源特定删除条件。                                            |
| FindNewPath，747                                  | 普通/Transporting参数；居民步行/公交/taxi/活动掩码、家庭/工作授权、居民权重、紧急避难权重、Divert、HomeTarget；最后发布完整SetupQueueItem。                 |

本程序集没有一个名为 `CheckNavigationPath` 的PersonalCarAI方法，接口按实际Tick链实现。TripSource在源OnCreate查询`:1126`被排除，由其它系统接管；不会在此凭空假造TripSource成功或删除车辆。

关键方法身份：Tick token `100695078`，IL SHA256 `64aae12a2be3d24a27b1a93252e9387fbf0b4f8ce7f4618e1d0c37e1cb96e3c7`；ParkCar `100695091` / `6ce70ee76eac8fd34d57096d416bb0477318ede49e27b256154c93dcc3e7bb44`；FindNewPath `100695092` / `db0123d4e5b560f6c32a5cd174d764f231e5ff701dd0da0102b9035be900ad29`。其余15个helper/overload身份保存在fixture provenance。

## 状态与世界输入

`CS2PersonalCarInput.state` 保留：

- `personalCar:{keeper,flags}`：Transporting=1、Boarding=2、Disembarking=4、DummyTraffic=8、HomeTarget=16。
- `carFlags`：源CarFlags，包括StayOnRoad=2。
- `current`：与导航current兼容的laneId、changeLaneId、curvePosition、**Vehicles.CarLaneFlags**。
- `pathOwner:{flags,elementIndex}`、`target`、完整PathElement `{target,delta:[x,y],flags}` buffer、实际slave导航queue。
- `layout?`：undefined与已创建但空数组有不同语义；ParkCar即使空Layout也移除其组件。
- `unspawned`：当前组件存在性快照，组件命令延后应用。

input还提供entity及真实/适配后的numeric entityIndex、batchSeed、PrefabCar包含sizeClass/energyType、有效几何、isBicycle。源RandomSeed使用 **entity.Index** 混合，不用group index或重新采样新种子。

world为明确组件/Buffer字典：存活entities、lane组件、Passenger、CurrentVehicle、其它实体的Path/PathOwner/Target、Resident及有效Human/Creature prefab数据、HouseholdMember/PropertyRenter/Household/HouseholdCitizen、Citizen/Worker/TravelPurpose/MovingAway/Divert、city与timeOfDay。

lane快照分别表达car组件、pedestrianFlags/accessRestriction、connectionFlags、parking fee、garage count/capacity/fee、SpawnLocation及有效SpawnLocationData。`spawn`提供有效prefab数据并默认存在SpawnLocation，显式 `spawnLocation:false` 则保留“有prefab数据但没有组件”的区别。原生fee/count/flags/pseudoRandom等整数值须保持源byte/ushort/uint范围。

`createCS2PersonalCarWorld` 可将省略的组件字典设为空，代表该世界明确没有相应组件；不会自动建立城市、居民或家庭。源需要索引存在的Passenger/leader path等buffer时，缺失会明确报错，不把它当空车或已Ready。

## 最小边界 Dummy 接入

源 `TrafficSpawnerAISystem.cs:360` 创建随机个人车时实际传入 `PersonalCarFlags.DummyTraffic`，所以测试入口车使用 **8**；不额外加Transporting=1。

```ts
const endpoint = `outside:${sink.road}:${sink.end}`;
const world = createCS2PersonalCarWorld({
  entities: new Set([...network.lanes.keys(), id, endpoint]),
  city: null,
  timeOfDay,
  lanes: new Map([...network.lanes].map(([laneID]) => [laneID, { car: true }])),
  passengers: new Map([[id, []]]),
});
const result = runCS2PersonalCarAI(world, {
  entity: id,
  entityIndex: numericVehicleId,
  batchSeed,
  prefabCar: { ...vehicleCarData, sizeClass, energyType },
  geometry,
  state: {
    personalCar: { keeper: null, flags: 8 },
    carFlags,
    current,
    pathOwner,
    target: endpoint,
    path: globalPath.map((step) => ({
      target: step.owner,
      delta: step.delta,
      flags: 0,
    })),
    navigationLanes: actualSlaveQueue,
    unspawned,
  },
});
```

synthetic endpoint明确表示RoadLab端口适配，不冒充原城市建筑。上例仅适用于当前全部是普通道路的边界测试世界；世界真正有parking/connection/spawn/居民时，必须填对应组件而非一律car:true。

`complete`结果中的state必须全部写回，随后提交commands再进入CarMove。居民StopBoarding会换目标/复制路径，ResetPath会改StayOnRoad，停车回调可改current/queue；仅消费Deleted命令会丢掉这些源状态。

命令包括：组件增删/转换、ParkedCar、FixParkingLocation、PathfindUpdated、钱款转移、Parking费用事件及完整pathfind请求。移动→驻车移除原11种组件、增加ParkedCar/Stopped/Updated；删除Layout其它车辆的顺序按源保留。

`outcome`是适配器用于统计的解释元数据，不是原ECS组件：

- Deleted且reason=path-failure表示Failed/Stuck删除；invalid-target、boarding或parking-reached不应计为出口完成。
- 只有源真实PathEndReached mask满足且发生相应删除时，reason才是path-end。路径末端只是目标，不由此模块伪造EndReached。
- resident失败通常得到parked及FixParkingLocation，不能按Dummy删掉，也不能计为成功到达。
- 过滤的TripSource/Deleted/Temp/OutOfControl/Destroyed返回filtered，交给负责它们的源系统。

## 原 native 停车依赖：可暂停的完整contract

普通全road、无parking的Dummy可直接完成Tick，不必伪造回调成功。源停车查询确实需要世界数据时，函数返回：

```ts
{
  status: ("pending", request, transaction);
}
// 获得世界查询真实答复后，在同一次Tick的原位置继续：
const next = transaction.advance(reply);
```

有同步完整实现时可向run函数传callbacks。回调返回undefined表示仍待处理；null/false必须显式写入result，不能被当作“没回答”。input.state在事务开始时复制；**只在complete时提交state/commands**，pending不重跑Tick、不再次抽随机数，也不提交部分收费/组件命令。world在该事务期间应保持同一不可变快照。

| 请求                      | 源依赖/传入信息                                                                                   | 合法响应修改                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| reset-parking-lane-status | VehicleUtils.ResetParkingLaneStatus，isBicycle；完整current/pathOwner/path在request.state中       | current、pathOwner、path。原签名没有RNG或navigation buffer，不能凭此消耗RNG/改nav。                  |
| set-parking-curve-pos     | VehicleUtils.SetParkingCurvePos，ignoreDriveways=false；current/pathOwner为值参数                 | path、randomState，及可选返回index；不能修改current/owner/nav。                                      |
| validate-parking-space    | VehicleUtils.ValidateParkingSpace，ignoreDriveways=false、ignoreDisabled=true、boardingOnly=false | 明确result=laneID或null；可改current/owner/path/nav及randomState。                                   |
| find-free-parking-space   | VehicleUtils.FindFreeParkingSpace，lane/minT/parkingLength/offset/curvePosition、两个ignore选项   | 明确result=true/false、可返回curvePosition、randomState；没有PathElement/current/owner/nav可写权限。 |

每个request包含调用前完整state、entity、randomState与参数。模块检查这些mutable-argument边界，防止一个找位回调随意重写owner或宣布全部成功。停车几何/slot/garage/world查询仍需真实native contract实现；本轮没有把脚本答案称为已实现原停车搜索算法。

## 保留的 owner 行为

- Failed **或Stuck**进入原失败路径；RemovePath先执行，再根据Disembarking/Transporting/Boarding处理。失败不会一律重新寻路或删除居民。
- 乘客Ready之前保持Boarding；没有Leader时结束boarding但不设Transporting。复制Leader路径从其ElementIndex开始，重置本车index并置Updated，目标与HomeTarget跟随真实家庭/Divert数据。
- StartDisembarking只在真实有乘客时进入；之后一直等待Passenger buffer被其它系统清空。收费只在开始时发布一次，等待期间不重复收费。
- 居民停车费支付者是Leader关联Citizen的Household；缺少相应HouseholdMember不凭空扣款。转账与ServiceFee事件保持队列，实际资源消费仍由TransferMoney/经济模块检查两边Resources并处理。
- ResetLocation查Keeper所属家庭；只有已MovedIn、存在PropertyRenter、未MovingAway才优先家庭房产，否则FixParkingLocation保持源空/自身目标。
- Transporting寻路包含行走与停车；居民补上步行速度、活动掩码、公交/taxi、住宅/工作授权与CitizenUtils权重。游客/通勤者/迁离者影响money权重条件，EmergencyShelter覆盖权重为[1,.2,0,.1]。
- Divert保留目标覆盖、Mailbox/Safety/Outside类型及AddDestination/Divert位；WaitingHome/PathFailed的返回值虽为false，原调用者不检查此返回值，模块保留实际调用行为。
- SetupPathfind清Failed/Obsolete/DivertObsolete、置Pending、清EndOfPath并置FixedLane，保留源CachedObsolete条件；没有额外路线收益阈值。
- CheckUnspawned先于Tick执行，发布Unspawned/BatchesUpdated增删；原组件命令延后提交，不把同一次Tick里读取的组件快照提前改变。

## 独立方法体 oracle

`/home/bhw/repos/roadlab-reverse/oracles/personal-car-ai/` 包含extract.py、generate.py、C#项目、字典组件/命令/queue adapter与harness。

自动提取原Tick及全部私有helper方法体，保留body，仅改namespace/job名与Tick入口可见性。原VehicleUtils纯谓词/方法规则、RouteUtils、CitizenUtils、CreatureUtils及Unity RNG直接执行Game/Mathematics DLL。Random wrapper只委托原RNG并记录state，避免为了观察返回状态而改写Tick的return顺序。

原需要Unity native lookup的停车依赖由**明确脚本contract回复**替代；无回复时抛pending并记录完整调用前状态。这些native算法不是本轮oracle直接执行对象。整体对照明确标为“完整owner方法自动提取＋字典ECS＋native停车contract”，不能称整座城市/停车/乘客物理系统已在无Unity环境运行。

fixture包含**908个场景**，逐项对照state、native requests、原RNG状态和有序commands：

- 全PersonalFlags、Pending/Failed/Stuck/Updated/Obsolete/DivertObsolete、路径终点/停车/waypoint组合。
- 居民、游客、通勤者、Dummy；多种车体等级/能源；自行车访问规则；白天/夜间、公交通行与Divert。
- 多车辆Layout、Ready/缺CurrentVehicle/有无Leader、家庭目标/复制路径、停车费、失败恢复、spawn处disembark。
- 所有四类native依赖的pending与明确响应、FindFree失败/成功、Reserved末端minT、更早停车备选、暂停原处恢复。
- 原Query排除与最小边界Dummy world。

```sh
npx vitest run tests/cs2-personal-car-ai.test.ts
```

当前**916项独立测试通过**，strict/noUnused定向类型检查通过。owner状态、flag、实体、命令与RNG精确比较；原float参数/权重使用明确少量ULP容差。

## 后续世界系统与限制

本模块保留完整PersonalCarAI分支，并通过contract暴露真实缺失依赖。停车FindFree/Validate/ResetParking几何与slot算法、FixParkingLocation实体处理、乘客进入/离开动画与Resident/CurrentVehicle更新、TripSource系统、资源转账消费、各transport方法的世界图仍需继续源移植。它们不是可随意替换为成功的空回调。

当前浏览器engine若只有端口Dummy，能够验证这部分实际接线；完整居民world场景须由后续适配/世界系统提供，不能将端口压力测试当作全部owner行为验证。prefab参数来自明确输入，未恢复所有游戏序列化资产。
