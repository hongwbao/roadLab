# Source road node generation

`cs2GenerateRoadNodes(world, { editorMode })` implements the recovered
`Game.Tools.GenerateNodesSystem` chain: FillNodeMap (including both spatial
iterators), FillOldNodes, CollectUpdates, and CreateNodes with all its helpers.
It publishes structural commands at `ModificationBarrier1` and returns a new
world plus the ordered command list. Failed dependencies do not change the input.

The ECS component uses original field names: `NetCourse.startPosition` and
`endPosition`. The earlier course module has `start` and `end`; converting these
names is an explicit adapter operation. The world must supply the actual
archetypes referenced by `NetData.nodeArchetype`, complete prefab components,
terrain bounds, and the search tree. An explicit empty tree is valid. Missing
spatial data is an error, rather than silently assuming no surrounding roads.
Optional component absence retains the original source branches and zero struct
defaults. RoadLab asset dimensions and elevation policy must be declared by the
host; recovered managed code does not supply serialized game asset values.

This stage preserves original node identity. For an ordinary unowned OnCourse
update referencing an existing node, CreateNodes reads the original Node, even
when the course endpoint lies nearby. The fixture `reuse-identity-offset` uses
an endpoint at x = -1.95 and an original node at x = 0. Later NodeAlign can adjust
the resulting position; Curve endpoints must not be forcibly equated to Node
positions by an editor adapter.

Other preserved behavior includes original edge-node random seeds, editor-lane
identity, overlapping split-range merging, deleted-preview nearest reuse,
32/64-entry multimap growth ordering, node prefab priority, standalone/orphan
and owner handling, local connections and attachments, strict geometry,
elevation/fixed/cache data, boundary connections, and road condition/flow vector
interpolation when inserting a node into a road edge. Upgrade flags use the
original node mask.

## Reference evidence

`tests/fixtures/cs2-road-node-generation-oracle.json` contains 170 complete world
transactions generated outside this repository by the extracted original C#
jobs. Their executable bodies and data constructors come from the supplied
Game.dll decompilation; math, component structs, random seeds and refund helpers
load the supplied assemblies. The harness adapts ECS storage, chunks, queues,
search tree, archetypes, multimap storage and deferred command playback. It uses
a declared sequential job order, not the original parallel Unity scheduler.
Original source/block hashes and the loaded Game.dll SHA-256, MVID and method IL
hashes are retained in the fixture. The C# recovery and assemblies remain outside
this Git repository.

The cases include 40 source-course outputs, existing-node and edge targets,
strict geometry, overlapping/disjoint split ranges, temporary and permanent
operations, owner/editor/cache branches, 32/64-entry reuse boundaries, deletion
neighbors, spatial attachment/local-connect queries, and terrain boundaries.
Discrete identities, flags, random seeds and indices are checked exactly;
floating values allow `2e-6 + abs(expected) * 4e-7`. Whole worlds and commands
are compared and input immutability is checked. There are 173 tests including
provenance and explicit contracts. Together with NodeAlign, road references and
motion, the accepted run passed 444 tests. Scoped strict TypeScript checks pass.

## Integration boundary

This module is not connected to the published editor yet. GenerateEdges /
SplitEdge, composition and the final native construction adapter must connect
the node world to the remaining source geometry/lane stages and saved Project.
The production editor still runs the previously published implementation.
These reference checks establish this stage for explicit input worlds; they do
not establish complete Unity city or full RoadLab construction equivalence.
