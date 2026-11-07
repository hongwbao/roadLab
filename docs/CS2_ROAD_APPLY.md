# Source road construction application

`cs2ApplyRoadNetwork(world, { simulationFrame })` implements the full recovered
`Game.Tools.ApplyNetSystem` processing chain. It runs PatchTempReferences first,
then FixConnectedEdges and HandleTempEntities, and publishes the structural
commands at `ToolOutputBarrier`. The returned world is independent of its input;
missing mandatory data throws before anything is published to the caller.

The implementation preserves original node/edge identities when updating a
road, resolves preview endpoints and interior connections back to their original
entities, repairs ConnectedEdge/ConnectedNode and owner SubNet buffers, and
handles original create/update/delete/replace/combine/cancel branches. Lane
handling follows the original owner's temporary state. Aggregate previews keep
the original cleanup path. Component transfer distinguishes copying a value
from preserving an existing value or adding a zero-initialized source component.
For example, applying Road flags preserves the original Road flow statistics.
Traffic-light timers are preserved where the original job preserves them.

The original Recent construction-cost accounting, direct NetUtils refund
helper, and bicycle-road-ban trigger are included. A unique, explicit
EconomyParameterData component is required for nonempty application queries,
even though RoadLab does not otherwise simulate a city economy. The host must
supply its own asset policy and PrefabData enable state. It must not substitute
invented game prefab values. Flags, costs, frames, triggers and entity identities
are checked exactly; floats use the declared source-reference tolerance.

## Evidence

`tests/fixtures/cs2-road-apply-oracle.json` contains 203 complete ApplyNet worlds
and 32 complete GenerateNodes → ApplyNet worlds, executed in the same C# world
without an intervening snapshot reload. Their expected outputs come from the
extracted original jobs with original Game.dll component/math/refund code and an
explicit dictionary/chunk/queue/barrier host. Loaded assembly SHA-256, MVID,
original method IL hashes, source block hashes and source component defaults are
recorded. The original Unity allocator, parallel scheduler and serialized game
assets are not reproduced by that harness. Recovery code and supplied binaries
remain outside this Git repository.

There are also 90 direct original-DLL refund reference cases covering strict
frame boundaries, uint-to-float conversion, negative values and out-of-range
float-to-int behavior. The complete application test file has 328 passing tests,
including provenance and input/publication contracts. Together with generation,
alignment, references and motion, 772 tests pass. Scoped strict TypeScript
checks pass.

The public facade reexports the independently verified ECS, GenerateNodes and
NodeAlign modules. GenerateEdges/SplitEdge is still being recovered. The native
construction stages have not been connected to the production editor or Project
save model, so these tests do not mean that the complete construction tool or
all traffic has been replicated. See `CS2_ROAD_NODE_GENERATION.md` and
`CS2_ROAD_NETWORK_GEOMETRY.md` for adjacent stage boundaries.
