# CS2 LaneDataSystem：完整车道数据初始化与更新

`src/simulation/cs2-lane-data.ts` 恢复提供的 CS2 **1.6.0f1** `Game.Pathfind.LaneDataSystem` 的两个完整作业及全部八个 helper。它覆盖 CarLane、PedestrianLane、TrackLane、ConnectionLane，包括停车连接的访问权限；独立 `ParkingLaneDataSystem` 的停车空间、收费、车库、spawn location 更新仍属于后续工作，不能把本模块视为停车系统已完成。

原阶段位于 ModificationEnd，消费 LaneSystem 创建、LaneReferencesSystem 排序及 LaneOverlapSystem 后的数据。CreateNodeLane 初始 `CarLane.SpeedLimit=0`，本阶段才根据默认限速、城市选项、区域 modifier、道路资产与车道组等得出有效数据；模块保留全部相关分支。

## 接口和源世界

```ts
const {
  world: next,
  ran,
  commands,
} = cs2UpdateLaneData(world, {
  city, // CitySystem.City；null 表示显式空城市世界
  laneChunks, // 原第一个 query 的 chunks
  cautionChunks, // 原第二个 query 的 chunks
});
```

它使用独立 `CS2LaneDataWorld`：Entity → 组件 Map，以及 prefabCars、prefabBuildings、prefabGeometry、netCompositions 四张资产 Map。组件保留 Owner/PrefabRef/Lane、EdgeLane、MasterLane、SlaveLane、有序 SubLane/ConnectedNode/ConnectedEdge，以及实际 City/District/Building/Attachment/Gate、LaneObject/Moving/Car/InvolvedInAccident/AccidentSite/TargetElement 等源数据。路径节点为完整 64 位 bigint，Entity ID 表示含 Version 的完整身份。

`CS2LaneDataComponents` 复用引用阶段组件字段，但 car/pedestrian/track/connection 在此是完整组件值；引用阶段的对应布尔值需要在适配时换为真实创建器输出。CarLane 使用创建器导出的 `CS2CreatedNodeCarLane`，包含默认/有效限速、flags、curviness、carriageway group、blockage/caution、flow offset 和 cross count。这里只改源方法确实写入的字段。

| 输入                                                        | 源语义                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `city`、实体 `city.optionMask`                              | 真实 CitySystem.City 与 City 组件；null 时源使用 default City                                             |
| `district.optionMask`、`borderDistrict`                     | 两侧区域存在性与真实选项 bit mask                                                                         |
| `districtModifiers`                                         | 原有序 DistrictModifier 缓冲，条目为 float2 delta；StreetSpeedLimit 位于 index 9，缺失/短缓冲按源分支跳过 |
| `prefabCars.roadTypes`                                      | CarLaneData.RoadTypes，汽车 Owner 分支直接索引，缺失报错                                                  |
| `prefabBuildings.flags`                                     | BuildingData Flags，包括 RestrictedPedestrian/Car/Parking/Track                                           |
| `prefabGeometry.flags`                                      | NetGeometryData.Flags，保留 SubOwner 提前返回                                                             |
| `netCompositions.flags`                                     | NetCompositionData 的 general/left/right，消费 Invert 与 ForbidSecondary                                  |
| `connectedNodes/connectedEdges/subLanes`                    | 完整有序拓扑，缺失与空缓冲不同                                                                            |
| `laneObjects`                                               | 每个物体 Entity 与原 float2 CurvePosition                                                                 |
| `moving/vehicleCar/involvedInAccident/targets/accidentSite` | 停止物体、应急车辆、事件目标和事故是否 secured；不以不存在的事故状态代替真实数据                          |

显式 chunks 为 `{index,entities}`，沿用引用阶段的 DTO。调用方提供真实查询成员及一致的组件存在组合；模块拒绝混用相关 archetype 字段。宿主 Web 适配器的分组/顺序是明确的宿主输入，不声称恢复了原城市 native chunk 布局。

返回克隆后的组件世界，原快照和查询不被修改。源系统没有 ECB 命令，只有组件直接写入，故 `commands` 恒为空；不虚构标签或播放阶段。`ran` 表示原 RequireForUpdate 的第一 query 是否非空；第一 query 空时连第二遍也不运行。

源 query 条件不能用一个宽泛的“所有车道”替代：

- 第一 query：Updated + Lane，具备 car/pedestrian/track/connection 至少一个，排除 GarageLane/Deleted；或者 PathfindUpdated + Lane + 上述类型之一，排除 GarageLane/Updated/Deleted/Temp。Updated 的分支允许 Temp。
- 第二 query：Updated + Lane + CarLane；或者 PathfindUpdated + Lane + CarLane，排除 Updated/Deleted/Temp。第二 query 的 Updated 分支允许 GarageLane/Deleted/Temp；没有 Owner 的 chunk 不传播 caution。

## 完整行为

每个第一遍 chunk 依次处理全部 car，再 pedestrian、track、connection；全部第一遍完成后才运行同 carriageway 的第二遍。

CarLane 先清理旧 AccessRestriction、IsSecured/ForbidBicycles/AllowEnter，令有效 speed 等于源 default，blockage/caution 重置为 255/0。普通道路和 master 走原来的不同分支：Master 根据最终 SubLane min/max 收集各子车道 LaneObjects，以阻塞范围的交集得到整组 blockage，累积事故 IsSecured；普通/Slave 用自身停止物体的并集决定 blockage/caution。Master 不直接添加 caution，第二遍可能从同 carriageway 的其他 car 车道传播。原 master 无 Owner 时跳过城市选项这一细节保留。

城市 UnlimitedHighwaySpeed 只作用 Highway，源上限为 float32 `111.111115`。区域限速逐侧按 `value += delta.x; value += value * delta.y` 运算，每一步保留 float32，再按源两侧 max/min 规则决定结果；不把区域限制一律处理成取最小值。Highway 不消费 StreetSpeedLimit modifier。

ForbidBicycles 只作用满足源条件的汽车与自行车混用、非等值 EdgeDelta、没有 Master.HasBikeOnlyLane 的车道，组合两侧 District 选项和按方向/Invert 选择的 Composition.ForbidSecondary。两侧区域对同一选项一方明确关闭时，不当作共同启用。

GetAccessRestriction 完整保留：两种侧连接图搜索及第一个端点匹配、SubOwner 几何退出、Owner 层级中间建筑的 restriction mask 交集、最后一次 Attachment 代换、建筑数据、Road/Gate 特例、junction 邻边与 gate 的端点匹配、圆环内外边处理、NoRestriction，以及 car/ped/parking/track 各自的 allow enter/exit 规则。节点只按完整 PathNode 相等，不另加距离阈值。

Pedestrian 更新区域 ForbidTransitTraffic 与建筑访问；OnWater 不请求 pedestrian restriction。Track 根据 Station 决定是否请求 RestrictedTrack，保留原限速/曲率不改。Connection 按源优先次序选择 pedestrian、road、parking、cargo、track 分支；停车连接同时请求 pedestrian/car，并分别设置 allow enter/exit。

Blockage 忽略存在 Moving 的物体；停止物体根据曲线范围累积，事故按事件 TargetElement 中第一处 AccidentSite 判断 Secured，没有事故现场时按源返回 true。普通应急车辆与事故会触发 caution；两端同时 StartingLane/EndingLane 的中间 Slave 对普通阻塞保留源抑制。阻塞范围按源 float32 ×255 后 floor/ceil 量化。

第二遍遍历 Owner.SubLane，只从同 CarriagewayGroup 且 caution 范围有效的其他 CarLane 合并范围；Invert 不同时使用 `255-end/255-start` 翻转，同时传播 IsSecured。保留源显式读取/写入顺序，无额外交通判断。

## 明确空世界与必需数据

RoadLab 当前没有城市经营、建筑或事故时，适配器应传 `city:null`，实体上不添加这些组件，相关资产 Map 显式为空，LaneObjects 提供实际空缓冲或缺失状态。例如普通汽车车道仍必须具有真实 Owner/SubLane、创建器 CarLane、PrefabRef 与其 CarLaneData.RoadTypes；相关道路自定义资产值应标记为 RoadLab 自定义映射。

不能靠空 City 掩盖缺失的必要 prefab：非空 City ID 缺 City、汽车 Owner 分支缺 CarLaneData、建筑分支缺 BuildingData 或侧连接直接索引缓冲缺失都会报错。没有推测默认建筑、未知路型、事件现场或区域 modifier。额外的宿主校验会拒绝循环 Owner 依赖，避免错误世界挂死；原源循环对此没有保护，此域外校验单独测试。

## 证据与验证

本机 reverse oracle：`/home/bhw/repos/roadlab-reverse/oracles/lane-data/`。`bash rebuild.sh` 自动机械提取完整两 Execute、八 helper 和所需 AreaUtils 两个 buffer/lookup helper，构建并生成预期结果。原 DLL 的组件值、PathNode、City/District option 测试、Bounds1/MathUtils 与 Mathf 实际执行；native component/chunk/buffer 存储由显式 managed world 代替。没有声称直接运行私有 Unity World。预期结果完全来自 C# oracle，未用 TS 生成；导出 float 时转为 double 以保留真实 float32 数值，测试完全相等且无容差。

Fixture 固定 Game.dll SHA256 `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`、MVID `36b776ac-5007-4e06-81b3-242b2abfd5b6`、10 个原方法 token/IL SHA256、12 段提取源 SHA256。**652 个完整世界**覆盖 96 options、112 blockage、64 master +8 master bicycle、128 access、96 topology、16 query、64 非汽车类型组合、64 第二遍 caution、4 显式空城市世界；比较完整组件输出，不只比较有效限速。

另有快照不变、必要资产/City/Building 缺失、无汽车不读取 City、空主查询、查询错误、循环 Owner，以及从真实创建式零 speed 开始初始化、master 城市分支、自行车专用组等 contract 回归。独立运行：

```sh
npx vitest run tests/cs2-lane-data.test.ts
npx tsc --noEmit --strict --noUnusedLocals --noUnusedParameters \
  --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck \
  src/simulation/cs2-lane-data.ts tests/cs2-lane-data.test.ts
```

本模块未改 RoadLab graph/editor/碰撞/部署入口。集成者应先播放创建与引用命令，按正确系统阶段生成源世界，再用本阶段的有效速度、访问权限与 caution/blockage 构建后续寻路与驾驶输入。停车场完整数据阶段仍待独立 ParkingLaneDataSystem。
