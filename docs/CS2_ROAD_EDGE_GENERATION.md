# Source road edge generation

`cs2GenerateRoadEdges(world, { editorMode, buildOrder })` implements the recovered
`Game.Tools.GenerateEdgesSystem` chain: CheckNodes, CheckDefinitions,
FillOldEdges, CollectLocalConnectItems, GenerateEdges with its duplicate/split
and connection helpers, and UpdateBuildOrder. Structural writes publish at
`ModificationBarrier2`. Call it after GenerateNodes has published its barrier.
The result contains a new world, ordered commands, and the next build-order
counter. The input world is not mutated, including when mandatory data is absent.

The module preserves node entity identity separately from curve endpoints. It
selects split nodes by original entity and curve position, cuts the original
curve with the source Divide/Cut functions, and handles preview edge duplication
and reuse. It preserves the original interpolation order for condition and flow
vectors, split random seeds, build-order ranges, half-cell alignment, upgrades,
owner/editor state, native/electricity/track data and local connections. Terrain
and water adjustment use an explicit reader and retain the original update
threshold and cached-length behavior. Original optional component presence is
meaningful and is not replaced with guessed asset fields.

NodeMap uses the declared input chunk/entity order, with source prepend ordering
per key. CheckDefinitions follows all CheckNodes work. This is a deterministic
host execution order, not a claim to reproduce Unity's parallel insertion order.
The shared Course Divide and hanging-curve functions are aliases of previously
verified implementations; their arithmetic bodies were not changed.

## Reference evidence

`tests/fixtures/cs2-road-edge-generation-oracle.json` contains 241 original C#
worlds: 239 GenerateNodes → GenerateEdges transactions in one world and two
permanent-edge connection updates. Outputs come from the extracted complete
source jobs and original DLL numerical dependencies, with declared dictionary
ECS, chunk/queue/tree/archetype/terrain/barrier adapters. They retain original
source block hashes, Game.dll SHA-256/MVID and original method IL hashes. The
assembly recovery and C# harness remain outside this Git repository.

The cases cover source course outputs, temporary/permanent edits, existing
nodes and edge split targets, multiple split ranges, preview duplication and
repeated-preview reuse, local connections, strict/straight/hanging geometry,
terrain/water policies, electricity flag tests, upgrade/invert/prefab changes,
32-entry query boundaries, and uint build-order wraparound. Ordinary node and
edge archetypes omit EditorContainer; editor assets explicitly include it.
There is an explicit check that an ordinary new road creates an actual edge,
and that a repeated temporary preview reuses its previous edge and nodes.

There are 246 tests including provenance and contracts. One semantic integration
check passes native entities through References, NodeReduction, NodeAlign and
ApplyNet, then checks permanent endpoint identities and reciprocal ConnectedEdge
references. This check deliberately covers entity interoperability; composition,
surface geometry and lanes are separate stages. With the adjacent generation,
application, course/intersection, alignment/reference and motion modules, the
accepted run passed 2,436 tests in eight files. Scoped strict TypeScript checks
and the committed-source build are checked separately.

## Remaining construction work

The editor still uses the previously published implementation. These source
entity stages need the composition/geometry/lane chain, Project persistence and
editor/renderer adapters before they become a complete native construction tool.
Prefab archetypes and numerical asset policies in the reference worlds are
explicit test assets, not the missing serialized Skylines asset library. The
module does not establish complete Unity city equivalence or full-game parity.
