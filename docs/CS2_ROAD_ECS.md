# 道路创建流程的结构化宿主

`cs2-road-ecs.ts`提供原道路jobs使用的组件、缓冲、查询和结构命令宿主。它从尚未完成的`cs2-road-apply.ts`中独立出来，使完整References/Reduction能够独立验证，也避免后续Apply调用References时形成模块循环。

组件存储为`componentName → entity → record`，缓冲存储为`bufferName → entity → record[]`。组件读取遵循C#值类型拷贝；DynamicBuffer读取返回当前事务内的可写缓冲。输入世界与返回世界分离，实体顺序和查询chunk分组是明确的宿主输入，不冒充原Unity城市的并行调度。

`CS2RoadApplyCommandWriter`记录创建、销毁、组件与缓冲变更；`CS2RoadApplyECS.publish`由宿主在原命名barrier时调用，按记录顺序发布。创建必须有显式archetype模板；SetComponent缺少实际组件时抛错。模板、地形与资产值由实际调用方提供，不为未知道路资源补成功结果。

这不是完整Unity ECS，也不是GenerateNodes、GenerateEdges、ApplyNet已经完成的声明。其值拷贝、缓冲行为与查询当前由完整原References/Reduction的源世界回归共同验证；NodeAlign与后续创建流程继续各自对照原方法。
