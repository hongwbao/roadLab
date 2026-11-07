# Source CourseSplit pipeline

`cs2-road-intersections.ts` implements the complete computational chain from the
supplied Game.dll 1.6.0f1 `CourseSplitSystem`: course filtering, overlap search,
intersection records, `CourseHeightData`, and the entire
`CheckCourseIntersectionResultsJob` through its deferred ToolReadyBarrier commands.
It is an independent module. Editor placement and applying these definition
commands to RoadLab's road/node model remain host integration work.

## Public API and order

1. `createCS2RoadIntersectionWorld(partial)` supplies first-stage component maps.
   `createCS2RoadResultWorld(partial)` adds the full downstream world.
2. `cs2CollectRoadCourses(world, chunks)` implements `CheckCoursesJob`. Original
   definitions enter the deletion map even when their Delete flag is false; new
   definitions with NetGeometryData enter the course list. Optional Owner and
   Upgraded chunk data preserve their source defaults.
3. `cs2FindRoadCourseOverlaps(world, courses, tree)` implements `FindOverlapsJob`
   and its full source tree visitor: auxiliary lateral width expansion, recursive
   two-half Bezier bounds, both-end DisableMerge, and Deleted candidate exclusion.
   The caller supplies an ordered tree; queue/list storage and traversal are host
   adapters, not the original Unity NativeQuadTree allocator.
4. `cs2CheckRoadCourseIntersections(world, courses, overlaps, deletedEntities)`
   implements every branch and helper of `CheckCourseIntersectionsJob`. Returns
   `{intersections, missingGeometry}`. `IntersectPos` preserves CoursePos, entity,
   rotation, course/edge intervals, both intersection height envelopes, priority,
   auxiliary/course indices and node/tunnel/waterway/optional/start-end metadata.
5. `cs2ProcessRoadIntersectionResults(world, courses, intersections, options)`
   implements the complete ResultsJob and returns
   `{commands, barrier: "ToolReadyBarrier"}`. Options provide deletion-map entries,
   editor mode and traffic handedness. Commands are records; this function does
   not apply them to ECS or to the RoadLab model.

`CS2RoadCourseHeightData` exposes the complete source sample/limit/height state
machine independently. `cs2GetRoadAuxiliaryDefinition` and
`cs2GetRoadAuxiliaryCourse` preserve partial changes on failure, offset/cut/vertical
and inversion behavior, including endpoint metadata. The exported Quad/Circle
helpers permit direct original private-method comparisons.

## Complete downstream behavior

The ResultsJob initializes endpoint anchors, samples terrain/water and constrains
slope and height. It retains original IsUnder/IsOver, CanConnect, MergePositions,
MergeAuxPositions, elevation transitions, optional support placement and removal,
SnapCoursePositions, UpdateCourses/TryAddCourse/Phase2, tangent-based curve splits,
fixed asset count/length allocation, CutCourse, CalculateElevation, auxiliary
inversion and endpoint mapping, FindOriginalEdge, owner/replacement checks, local
curve caching and Set/Add/Remove/Destroy commands.

High XZ crossings survive the first geometry job deliberately. The downstream
height envelopes and compatibility decisions determine whether their entity is
retained as a connection or cleared for crossing/support placement. There is no
fixed distance threshold replacing these source decisions.

Endpoint joining also spans these stages: node outlines and first/last half-width
circles produce node candidates; MergePositions propagates the existing node
identity into overlapping endpoint anchors. Original `SnapCoursePositions` aligns
intermediate deltas to the four metre grid. It is not an arbitrary endpoint
position correction. Host integration must honor CoursePos entity/split metadata
when reusing or splitting actual existing nodes and edges.

## World boundary

The first job requires actual Edge, Curve, Composition, EdgeGeometry,
StartNodeGeometry and EndNodeGeometry components. A Segment contains left/right
cubic outlines and lengths; EdgeGeometry contains start/end segments;
EdgeNodeGeometry contains left/right segments, middle cubic and middle radius.
Bounds cover the complete XZ outlines. The original recursion checks cut-course
bounds, then samples eight quad slices. Centerline intersection is not substituted
for missing geometry.

First-stage additional components are Owner/Building/Deleted, root
PrefabRef/ObjectGeometry, ConnectedEdge for orphan checks, LocalTransformCache
parent meshes, NetData/NetGeometryData/NetCompositionData, and AuxiliaryNet buffers.
An empty auxiliary buffer and an absent buffer retain different source behavior.
Missing EdgeGeometry follows the original guard and returns `missingGeometry`;
other required component reads throw an explicit missing-source-component error.

The full Results world additionally provides:

- Node positions, Fixed, Elevation, LocalCurveCache, transforms and ServiceUpgrade.
- PrefabData enabled state, BuildingExtensionData and ServiceUpgradeData presence.
- PlaceableNetData elevation range/placement flags; FixedNetElement length/count
  ranges and flags; AuxiliaryNet inversion modes.
- All used NetGeometryData fields: default/elevated height ranges, width, edge
  length range, elevation limit, slope, elevated span, hanging and geometry flags.
- A `CS2RoadTerrainReader`: `sampleHeight(position)` returns terrain height, water
  height and water depth; `terrainHeight` and `waterDepth` expose the corresponding
  source lookups. These are explicit host readers. No flat terrain, water, owner,
  building or asset world is silently fabricated. A required absent reader throws;
  source owned-course branches that need no reader remain usable without one.

RoadLab's existing road center curves and widths alone do not supply these ECS
components. The separate geometry/asset/terrain adapter must document how the
actual RoadLab world provides them. Oracle synthetic worlds supply explicit
outlines and analytic readers for testing, not original game assets or terrain.

## Commands and host integration

The first output segment reuses the supplied definition entity with SetComponent;
subsequent segments emit CreateEntity, AddComponent CreationDefinition/NetCourse/
Updated and applicable owner/cache/upgrade data. Empty results emit DestroyEntity.
Upgraded removal, int32 random-seed wrap, original-edge replacement/inversion and
DontCreate flags retain source order. New definition labels are local transaction
references `$split:<jobIndex>:<ordinal>`, to be resolved by the barrier host.

A host must consume the complete transaction at its ToolReadyBarrier equivalent,
then apply definition identity, old-edge split positions, owner relationships and
new geometry consistently. The module does not claim the subsequent game
Definition/Apply systems or RoadLab model integration already exist.

## Numerical and ordering details

Arithmetic retains float32 operations, Unity min/max NaN behavior, round-to-even
and float-to-int boundaries. Original Bezier4x2 packed Position/Tangent uses
`(a*w0+c*w2)+(b*w1+d*w3)`; its Cut has different even/odd control point addition
orders. These differ from Bezier4x3 and are preserved locally. They matter to exact
optional-node tie decisions, not just visual curve tolerance.

Results use the shared original `cs2NativeSort` introsort and the original
CourseIntersection.min sign comparator, including equal-key order. Independent
parallel courses may interleave in the game queue; supplied traversal/input order
and per-course command order are explicit in this adapter. Native allocation,
parallel scheduling, disposal and entity identifiers are not emulated wholesale.

## Evidence and verification

The fixture records 935 original-reference cases:

- 140 quad and 146 circle cases directly invoke the original private Game.dll
  methods.
- 256 complete filtering/overlap/intersection/Aux worlds execute automatically
  extracted C# bodies with component/chunk/tree/queue adapters.
- 90 complete CourseHeightData cases compare sample arrays and every public state
  operation, with explicit analytic terrain/water readers.
- 303 complete Results/pipeline worlds compare every command and field, covering
  high/low crossings, endpoints, equal-key introsort with more than 16 candidates,
  multiple courses, compatibility/owner/upgrade states, fixed assets, auxiliary
  inversion/waterway behavior, zero edge-length bounds and int32 seed wrapping.

The extraction includes 61 method IL provenance records: 21 filtering/geometry,
9 height and 31 Results methods. Primary executable source bodies are automatically
extracted, not rewritten into a second oracle algorithm. Redundant explicit job
forwarding/scheduling interfaces and container/native-world boundaries are recorded
in fixture provenance. Managed sorting reuses mechanically recovered Unity
NativeSort control flow. Game/MathUtils/ObjectUtils/composition numerics execute
the supplied DLLs in the C# world oracle.

Tests compare all entity/index/flag and command decisions exactly, with float32
numerical tolerances. Nine additional contracts cover provenance, geometry/terrain
requirements, the owned branch, retained first-stage high crossings, endpoint
identity and immutable deferred transactions: **944 passing tests**. Scoped
strict/noUnused TypeScript checking also passes.

Recovered code, binaries and generator remain outside the repository at
`/home/bhw/repos/roadlab-reverse/oracles/road-intersections/`.
DLL SHA-256: `721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee`.
MVID: `36b776ac-5007-4e06-81b3-242b2abfd5b6`.
