import { cs2NativeSort } from "../core/cs2-native-sort";
/** Original LaneSystem node-car connection selection. See CS2_LANE_GENERATION.md. */
import { cs2IsTurn } from "./cs2-road-rules";

export type CS2LaneGenerationVector = { x: number; y: number; z: number };
export type CS2LaneCompositionFlags = {
  general: number;
  left: number;
  right: number;
};
/** The full source ConnectPosition payload, including creation-only fields. */
export type CS2LaneConnectPosition = {
  lane: {
    prefab: string | null;
    position: CS2LaneGenerationVector;
    flags: number;
    carriageway: number;
    group: number;
    index: number;
  };
  owner: string;
  /** Original Entity.Index controls sorting and ConnectionKey identity. */
  ownerIndex: number;
  nodeComposition: string;
  edgeComposition: string | null;
  position: CS2LaneGenerationVector;
  /** Source and destination both point inward toward the node. */
  tangent: CS2LaneGenerationVector;
  order: number;
  composition: {
    speedLimit: number;
    priority: number;
    taxiwayFlags: number;
    roadFlags: number;
  };
  curvePosition: number;
  baseHeight: number;
  elevation: number;
  group: number;
  segmentIndex: number;
  unsafeCount: number;
  forbiddenCount: number;
  skippedCount: number;
  roadTypes: number;
  trackTypes: number;
  utilityTypes: number;
  isEnd: boolean;
  isSideConnection: boolean;
};
export type CS2LaneGenerationWorld = {
  /** NetGeometryData[PrefabRef[owner]].m_MergeLayers; missing differs from 0. */
  ownerMergeLayers: ReadonlyMap<string, number>;
  compositions: ReadonlyMap<string, CS2LaneCompositionFlags>;
};
export type CS2NodeLaneCreationState = {
  nodeLaneIndex: number;
  randomState: number;
};
export type CS2NodeLaneCreationReply = CS2NodeLaneCreationState & {
  created: boolean;
  skipped: boolean;
  curviness: number;
};
export type CS2NodeLaneCreationRequest = {
  jobIndex: number;
  owner: string;
  prefab: string;
  source: CS2LaneConnectPosition;
  target: CS2LaneConnectPosition;
  intersectionFlags: CS2LaneCompositionFlags;
  group: number;
  laneIndex: number;
  isUnsafe: boolean;
  isForbidden: boolean;
  isTemp: boolean;
  trackOnly: false;
  yieldValue: number;
  ownerTemp: { original: string | null; flags: number };
  isTurn: boolean;
  isRight: boolean;
  isGentle: boolean;
  isUTurn: boolean;
  isRoundabout: false;
  isLeftLimit: boolean;
  isRightLimit: boolean;
  isMergeLeft: boolean;
  isMergeRight: boolean;
  fixedTangents: false;
  roadPassThrough: number;
};
export type CS2NodeLaneCreator = (
  request: CS2NodeLaneCreationRequest,
  state: Readonly<CS2NodeLaneCreationState>,
) => CS2NodeLaneCreationReply;
export type CS2NodeCarConnectionsInput = CS2NodeLaneCreationState & {
  jobIndex: number;
  owner: string;
  prefab: string;
  /** Actual node prefab mergeLayers; no fallback inferred from lane count. */
  nodeMergeLayers: number;
  sources: readonly CS2LaneConnectPosition[];
  targets: readonly CS2LaneConnectPosition[];
  allSources: readonly CS2LaneConnectPosition[];
  leftHandTraffic: boolean;
  intersectionFlags: CS2LaneCompositionFlags;
  roadPassThrough: number;
  isTemp: boolean;
  ownerTemp: { original: string | null; flags: number };
  yieldValue: number;
  createdConnections?: readonly [number, number, number, number][];
};
export type CS2NodeCarConnectionsResult = CS2NodeLaneCreationState & {
  sources: CS2LaneConnectPosition[];
  targets: CS2LaneConnectPosition[];
  createdConnections: [number, number, number, number][];
  calls: {
    request: CS2NodeLaneCreationRequest;
    before: CS2NodeLaneCreationState;
    reply: CS2NodeLaneCreationReply;
  }[];
};

const f = Math.fround;
const math = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  clamp: (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n)),
  select: (a: number, b: number, test: boolean) => (test ? b : a),
};
const dot2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  f(f(a.x * b.x) + f(a.z * b.z));
const dot3 = (a: CS2LaneGenerationVector, b: CS2LaneGenerationVector) =>
  f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z));
function distanceSq2(a: CS2LaneGenerationVector, b: CS2LaneGenerationVector) {
  const delta = { x: f(a.x - b.x), z: f(a.z - b.z) };
  return dot2(delta, delta);
}
const distance2 = (a: CS2LaneGenerationVector, b: CS2LaneGenerationVector) =>
  f(Math.sqrt(distanceSq2(a, b)));
const shiftXZ = (
  a: CS2LaneGenerationVector,
  t: CS2LaneGenerationVector,
  scale: number,
) => ({ x: f(a.x + f(t.x * scale)), y: a.y, z: f(a.z + f(t.z * scale)) });
const vector = (v: CS2LaneGenerationVector): CS2LaneGenerationVector => ({
  x: f(v.x),
  y: f(v.y),
  z: f(v.z),
});
function clone(v: CS2LaneConnectPosition): CS2LaneConnectPosition {
  return {
    ...v,
    lane: { ...v.lane, position: vector(v.lane.position) },
    position: vector(v.position),
    tangent: vector(v.tangent),
    composition: {
      ...v.composition,
      speedLimit: f(v.composition.speedLimit),
      priority: f(v.composition.priority),
    },
    order: f(v.order),
    curvePosition: f(v.curvePosition),
    baseHeight: f(v.baseHeight),
    elevation: f(v.elevation),
  };
}
const connectionKey = (
  source: CS2LaneConnectPosition,
  target: CS2LaneConnectPosition,
) =>
  JSON.stringify([
    source.ownerIndex,
    source.lane.index,
    target.ownerIndex,
    target.lane.index,
  ]);

/** Source SortTargets geometric ordering, operating on copies of the buffer. */
export function cs2SortNodeCarTargets(
  source: CS2LaneConnectPosition,
  targets: readonly CS2LaneConnectPosition[],
) {
  const s = clone(source);
  const result = targets.map(clone);
  const right = { x: s.tangent.z, z: f(-s.tangent.x) };
  for (const value of result) {
    let delta = {
      x: f(f(value.position.x - s.position.x) - value.tangent.x),
      z: f(f(value.position.z - s.position.z) - value.tangent.z),
    };
    const squared = dot2(delta, delta);
    if (squared > f(1.1754944e-38)) {
      const inv = f(1 / f(Math.sqrt(squared)));
      delta = { x: f(delta.x * inv), z: f(delta.z * inv) };
    } else delta = { x: 0, z: 0 };
    if (dot2(s.tangent, delta) > 0) value.order = f(dot2(right, delta) * 0.5);
    else {
      const n = dot2(right, delta);
      value.order = f((n >= 0 ? 1 : -1) - f(n * 0.5));
    }
  }
  cs2NativeSort(result, (a, b) => Math.sign(f(a.order - b.order)));
  return result;
}

/** Full source CalculateSourcesBetween, including role/type/U-turn filtering. */
export function cs2CalculateNodeCarSourcesBetween(
  source: CS2LaneConnectPosition,
  target: CS2LaneConnectPosition,
  allSources: readonly CS2LaneConnectPosition[],
) {
  const right = {
    x: f(target.position.z - source.position.z),
    z: f(source.position.x - target.position.x),
  };
  const result = { x: 0, y: 0 };
  for (const other of allSources) {
    if (
      other.group === source.group ||
      (other.lane.flags & (4 | 8)) !== 8 ||
      (!((other.roadTypes & source.roadTypes & ~16) !== 0) &&
        !(other.roadTypes === 16 && source.roadTypes === 16))
    )
      continue;
    const turn = cs2IsTurn(other, target);
    if (turn.isTurn && turn.uturn) continue;
    const delta = {
      x: f(target.position.x - other.position.x),
      z: f(target.position.z - other.position.z),
    };
    if (dot2(right, delta) > 0) result.x++;
    else result.y++;
  }
  return result;
}

/**
 * Complete ProcessCarConnectPositions/CreateNodeCarLanes selection state machine.
 * Actual CreateNodeLane remains a mandatory host callback: it resolves assets,
 * creates entities and consumes the original RNG, then returns ref arguments.
 */
export function cs2ProcessCarConnectPositions(
  world: CS2LaneGenerationWorld,
  input: CS2NodeCarConnectionsInput,
  createLane: CS2NodeLaneCreator,
): CS2NodeCarConnectionsResult {
  const sourceBuffer = input.sources.map(clone);
  let targetBuffer = input.targets.map(clone);
  const allSources = input.allSources.map(clone);
  const calls: CS2NodeCarConnectionsResult["calls"] = [];
  const createdConnections = new Set(
    (input.createdConnections ?? []).map((v) => JSON.stringify(v)),
  );
  let state = {
    nodeLaneIndex: input.nodeLaneIndex,
    randomState: input.randomState >>> 0,
  };
  let lastSkipped = false;
  const mergeLayers = (owner: string) => {
    const value = world.ownerMergeLayers.get(owner);
    if (value === undefined)
      throw new Error(`Missing owner mergeLayers: ${owner}`);
    return value;
  };
  const composition = (id: string) => {
    const value = world.compositions.get(id);
    if (!value) throw new Error(`Missing node composition: ${id}`);
    return value;
  };
  const calculateSourcesBetween = cs2CalculateNodeCarSourcesBetween;
  const emit = (
    selected: Pick<
      CS2NodeLaneCreationRequest,
      | "source"
      | "target"
      | "group"
      | "laneIndex"
      | "isUnsafe"
      | "isForbidden"
      | "isTurn"
      | "isRight"
      | "isGentle"
      | "isUTurn"
      | "isLeftLimit"
      | "isRightLimit"
      | "isMergeLeft"
      | "isMergeRight"
    >,
  ) => {
    const request: CS2NodeLaneCreationRequest = {
      ...selected,
      source: clone(selected.source),
      target: clone(selected.target),
      group: selected.group >>> 0,
      laneIndex: selected.laneIndex & 65535,
      jobIndex: input.jobIndex,
      owner: input.owner,
      prefab: input.prefab,
      intersectionFlags: { ...input.intersectionFlags },
      isTemp: input.isTemp,
      trackOnly: false,
      yieldValue: input.yieldValue,
      ownerTemp: { ...input.ownerTemp },
      isRoundabout: false,
      fixedTangents: false,
      roadPassThrough: input.roadPassThrough,
    };
    const before = { ...state };
    const reply = createLane(structuredClone(request), { ...state });
    calls.push({ request, before, reply: { ...reply } });
    state = {
      nodeLaneIndex: reply.nodeLaneIndex,
      randomState: reply.randomState >>> 0,
    };
    lastSkipped = reply.skipped;
    return reply.created;
  };
  if (sourceBuffer.length && targetBuffer.length) {
    cs2NativeSort(sourceBuffer, (a, b) => {
      const ownerDelta = (a.ownerIndex - b.ownerIndex) | 0;
      return ownerDelta || Math.sign(f(a.order - b.order));
    });
    targetBuffer = cs2SortNodeCarTargets(sourceBuffer[0], targetBuffer);
    generate();
  }
  return {
    ...state,
    sources: sourceBuffer,
    targets: targetBuffer,
    createdConnections: [...createdConnections].map(
      (v) => JSON.parse(v) as [number, number, number, number],
    ),
    calls,
  };

  function generate() {
    let sourcePosition = clone(sourceBuffer[0]);
    let sourcePosition2 = clone(sourceBuffer[sourceBuffer.length - 1]);
    let roadTypes = 0;
    for (let i = 0; i < sourceBuffer.length; i++) {
      roadTypes |= sourceBuffer[i].roadTypes;
    }
    for (let j = 0; j < targetBuffer.length; j++) {
      roadTypes |= targetBuffer[j].roadTypes;
    }
    let roadTypes2 =
      (roadTypes & (~sourcePosition.roadTypes & 255)) != 0
        ? sourcePosition.roadTypes
        : 0;
    let roadTypes3 =
      (roadTypes & (~sourcePosition2.roadTypes & 255)) != 0
        ? sourcePosition2.roadTypes
        : 0;
    if (roadTypes2 == 1) {
      roadTypes2 = 0;
    }
    if (roadTypes3 == 1) {
      roadTypes3 = 0;
    }
    let k: number;
    for (
      k = 0;
      k < sourceBuffer.length && sourceBuffer[k].roadTypes == roadTypes2;
      k++
    ) {}
    let l: number;
    for (
      l = 0;
      l < sourceBuffer.length &&
      sourceBuffer[sourceBuffer.length - 1 - l].roadTypes == roadTypes3;
      l++
    ) {}
    let num = sourceBuffer.length - k - l;
    let num2 = k;
    if (k + l > sourceBuffer.length) {
      if (input.leftHandTraffic) {
        l = 0;
      } else {
        k = 0;
      }
      num = sourceBuffer.length;
      num2 = 0;
    }
    let stackList: number[] = [];
    let stackList2: number[] = [];
    let num3 = 2147483647;
    let num4 = -1;
    let num5 = 0;
    while (num5 < targetBuffer.length) {
      let connectPosition = clone(targetBuffer[num5]);
      let m: number;
      for (
        m = num5 + 1;
        m < targetBuffer.length &&
        targetBuffer[m].group == connectPosition.group;
        m++
      ) {}
      let connectPosition2 = clone(targetBuffer[m - 1]);
      let n = 0;
      let num6 = 0;
      let roadTypes4 =
        (roadTypes & (~connectPosition.roadTypes & 255)) != 0
          ? connectPosition.roadTypes
          : 0;
      let roadTypes5 =
        (roadTypes & (~connectPosition2.roadTypes & 255)) != 0
          ? connectPosition2.roadTypes
          : 0;
      if (roadTypes4 == 1) {
        roadTypes4 = 0;
      }
      if (roadTypes5 == 1) {
        roadTypes5 = 0;
      }
      for (
        ;
        num5 + n < m && targetBuffer[num5 + n].roadTypes == roadTypes4;
        n++
      ) {}
      for (
        ;
        m - num6 > num5 && targetBuffer[m - 1 - num6].roadTypes == roadTypes5;
        num6++
      ) {}
      if (n + num6 > m - num5) {
        if (input.leftHandTraffic) {
          num6 = 0;
        } else {
          n = 0;
        }
        for (let num7 = num5; num7 < m; num7++) {
          if (num7 - num5 < n || num7 >= m - num6) {
            stackList2.push(num7);
          }
          stackList.push(num7);
        }
      } else {
        for (let num8 = num5; num8 < m; num8++) {
          if (num8 - num5 < n || num8 >= m - num6) {
            stackList2.push(num8);
            continue;
          }
          num3 = math.min(num3, stackList.length);
          num4 = stackList.length;
          stackList.push(num8);
        }
      }
      num5 = m;
    }
    let netGeometryData = input.nodeMergeLayers;
    let netGeometryData2 = mergeLayers(sourcePosition.owner);
    let netCompositionData = composition(sourcePosition.nodeComposition);
    let num9 =
      ((netCompositionData.general & 4) != 0) !==
      ((sourcePosition.lane.flags & 1) != 0)
        ? netCompositionData.left
        : netCompositionData.right;
    let flag = (num9 & 0x1000000) != 0;
    let flag2 = (num9 & 0x2000000) != 0;
    let test = (num9 & 0x10000000) != 0;
    let num10 = 0;
    let num11 = 0;
    let num12 = 0;
    while (num10 < stackList.length) {
      let targetPosition = clone(targetBuffer[stackList[num10]]);
      let num13: number;
      for (num13 = num10 + 1; num13 < stackList.length; num13++) {
        let connectPosition3 = clone(targetBuffer[stackList[num13]]);
        if (connectPosition3.group != targetPosition.group) {
          break;
        }
        targetPosition = connectPosition3;
      }
      let turn1 = cs2IsTurn(sourcePosition, targetPosition);
      if (!turn1.isTurn || turn1.right || !turn1.uturn) {
        break;
      }
      num10 = num13;
      if (
        targetPosition.owner == sourcePosition.owner &&
        targetPosition.lane.carriageway == sourcePosition.lane.carriageway
      ) {
        num11 = num13;
      }
      if (flag) {
        num12 = num13;
      }
    }
    let num14 = 0;
    let num15 = 0;
    let num16 = 0;
    while (num14 < stackList.length - num10) {
      let targetPosition2 = clone(
        targetBuffer[stackList[stackList.length - num14 - 1]],
      );
      let num17: number;
      for (num17 = num14 + 1; num17 < stackList.length - num10; num17++) {
        let connectPosition4 = clone(
          targetBuffer[stackList[stackList.length - num17 - 1]],
        );
        if (connectPosition4.group != targetPosition2.group) {
          break;
        }
        targetPosition2 = connectPosition4;
      }
      let turn2 = cs2IsTurn(sourcePosition2, targetPosition2);
      if (!turn2.isTurn || !turn2.right || !turn2.uturn) {
        break;
      }
      num14 = num17;
      if (
        (targetPosition2.owner == sourcePosition2.owner &&
          targetPosition2.lane.carriageway ==
            sourcePosition2.lane.carriageway) ||
        flag2
      ) {
        num15 = num17;
      }
      if (flag2) {
        num16 = num17;
      }
    }
    let num18 = 0;
    let num19 = 0;
    let num20 = 0;
    while (num10 + num18 < stackList.length - num14) {
      let targetPosition3 = clone(targetBuffer[stackList[num10 + num18]]);
      let num21: number;
      for (
        num21 = num18 + 1;
        num10 + num21 < stackList.length - num14;
        num21++
      ) {
        let connectPosition5 = clone(targetBuffer[stackList[num10 + num21]]);
        if (connectPosition5.group != targetPosition3.group) {
          break;
        }
        targetPosition3 = connectPosition5;
      }
      let turn3 = cs2IsTurn(sourcePosition, targetPosition3);
      if (!turn3.isTurn || turn3.right) {
        break;
      }
      if (turn3.gentle) {
        num19 += num21 - num18;
      }
      num18 = num21;
      if (flag) {
        num20 = num21;
      }
    }
    let num22 = 0;
    let num23 = 0;
    let num24 = 0;
    while (num14 + num22 < stackList.length - num10 - num18) {
      let targetPosition4 = clone(
        targetBuffer[stackList[stackList.length - num14 - num22 - 1]],
      );
      let num25: number;
      for (
        num25 = num22 + 1;
        num14 + num25 < stackList.length - num10 - num18;
        num25++
      ) {
        let connectPosition6 = clone(
          targetBuffer[stackList[stackList.length - num14 - num25 - 1]],
        );
        if (connectPosition6.group != targetPosition4.group) {
          break;
        }
        targetPosition4 = connectPosition6;
      }
      let turn4 = cs2IsTurn(sourcePosition2, targetPosition4);
      if (!turn4.isTurn || !turn4.right) {
        break;
      }
      if (turn4.gentle) {
        num23 += num25 - num22;
      }
      num22 = num25;
      if (flag2) {
        num24 = num25;
      }
    }
    let num26 = num10 + num14;
    let num27 = num18 + num22;
    let num28 = stackList.length - num26;
    let num29 = num28 - num27;
    let num30 = math.select(0, num29, test);
    let num31 = num29 - num30;
    let num32 = math.min(num, num28);
    if (num11 + num15 == stackList.length) {
      num12 = math.max(0, num12 - num11);
      num16 = math.max(0, num16 - num15);
      num11 = 0;
      num15 = 0;
    }
    let num33 = num18 - num20;
    let num34 = num22 - num24;
    let num35 = num33 + num34;
    let num36 = num10 - math.max(num11, num12);
    let num37 = num14 - math.max(num15, num16);
    let num38 = num36 + num37;
    let num39 = num - num32;
    let num40 = math.min(
      num36,
      Math.trunc(math.max(0, num39 * num36 + num38 - 1) / math.max(1, num38)),
    );
    let num41 = math.min(
      num37,
      Math.trunc(math.max(0, num39 * num37 + num38 - 1) / math.max(1, num38)),
    );
    if (num40 + num41 > num39) {
      if (input.leftHandTraffic) {
        num41 = num39 - num40;
      } else {
        num40 = num39 - num41;
      }
    }
    let num42 = math.min(num32, num31);
    if (num42 >= 2 && num28 >= 4) {
      let num43 = math.max(num33, num34);
      let num44 = Math.trunc((math.max(0, num43 - 1) * num) / (num28 - 1));
      num42 = math.clamp(num - num44, 1, num42);
    }
    num39 = num32 - num42;
    let num45 = math.min(
      num33,
      Math.trunc(math.max(0, num39 * num33 + num35 - 1) / math.max(1, num35)),
    );
    let num46 = math.min(
      num34,
      Math.trunc(math.max(0, num39 * num34 + num35 - 1) / math.max(1, num35)),
    );
    if (num45 + num46 > num39) {
      if (num34 > num33) {
        num45 = num39 - num46;
      } else if (num33 > num34) {
        num46 = num39 - num45;
      } else if (input.leftHandTraffic) {
        num45 = num39 - num46;
      } else {
        num46 = num39 - num45;
      }
    }
    num39 = num - num42 - num40 - num41 - num45 - num46;
    if (num39 > 0) {
      if (num31 > 0) {
        num42 += num39;
      } else if (num35 > 0) {
        let num47 = Math.trunc((num39 * num33 + num35 - 1) / num35);
        let num48 = Math.trunc((num39 * num34 + num35 - 1) / num35);
        if (num47 + num48 > num39) {
          if (input.leftHandTraffic) {
            num47 = num39 - num48;
          } else {
            num48 = num39 - num47;
          }
        }
        num45 += num47;
        num46 += num48;
      } else if (num38 > 0) {
        let num49 = Math.trunc((num39 * num36 + num38 - 1) / num38);
        let num50 = Math.trunc((num39 * num37 + num38 - 1) / num38);
        if (num49 + num50 > num39) {
          if (input.leftHandTraffic) {
            num49 = num39 - num50;
          } else {
            num50 = num39 - num49;
          }
        }
        num40 += num49;
        num41 += num50;
      } else if (num29 > 0) {
        num42 += num39;
      } else if (num27 > 0) {
        let num51 = Math.trunc((num39 * num18 + num27 - 1) / num27);
        let num52 = Math.trunc((num39 * num22 + num27 - 1) / num27);
        if (num51 + num52 > num39) {
          if (input.leftHandTraffic) {
            num51 = num39 - num52;
          } else {
            num52 = num39 - num51;
          }
        }
        num45 += num51;
        num46 += num52;
      } else if (num26 > 0) {
        let num53 = Math.trunc((num39 * num10 + num26 - 1) / num26);
        let num54 = Math.trunc((num39 * num14 + num26 - 1) / num26);
        if (num53 + num54 > num39) {
          if (input.leftHandTraffic) {
            num53 = num39 - num54;
          } else {
            num54 = num39 - num53;
          }
        }
        num40 += num53;
        num41 += num54;
      } else {
        num42 += num39;
      }
    }
    let num55 = math.max(num40, math.select(0, 1, num10 != 0));
    let num56 = math.max(num41, math.select(0, 1, num14 != 0));
    let num57 = num45 + math.select(0, 1, num18 > num45 && num > num45);
    let num58 = num46 + math.select(0, 1, num22 > num46 && num > num46);
    if (num42 == 0 && num57 > num45 && num58 > num46) {
      if (num58 > num57) {
        num58 = math.max(1, num58 - 1);
      } else if (num57 > num58) {
        num57 = math.max(1, num57 - 1);
      } else if (input.leftHandTraffic ? num57 <= 1 : num58 > 1) {
        num58 = math.max(1, num58 - 1);
      } else {
        num57 = math.max(1, num57 - 1);
      }
    }
    let num59 = num10 + num18;
    let num60 = num14 + num22;
    if (num29 == 0) {
      num59 -= num19;
      num60 -= num23;
    }
    let num61 = -1;
    let num62 = targetBuffer.length;
    if (num59 < stackList.length) {
      num61 = stackList[num59];
    } else if (stackList.length != 0) {
      num61 = stackList[stackList.length - 1];
    }
    if (num60 < stackList.length) {
      num62 = stackList[stackList.length - num60 - 1];
    } else if (stackList.length != 0) {
      num62 = stackList[0];
    }
    for (let num63 = 0; num63 < k; num63++) {
      let num64 = num63;
      let sourcePosition3 = clone(sourceBuffer[num63]);
      let num65 = 0;
      let num66 = 0;
      let num67 = stackList.length - num60;
      let num68 = stackList2.length;
      while (num68 > 0 && stackList2[num68 - 1] > num62) {
        num68--;
      }
      while (num65 < num67 || num66 < num68) {
        let num70: number;
        let targetPosition5: CS2LaneConnectPosition;
        let flag3: boolean;
        if (num65 < num67) {
          let num69 = num65;
          num70 = stackList[num65++];
          targetPosition5 = targetBuffer[num70];
          flag3 = true;
          if (num66 < num68) {
            let num71 = stackList2[num66];
            let connectPosition7 = clone(targetBuffer[num71]);
            if (
              num71 < num70 ||
              targetPosition5.group == connectPosition7.group
            ) {
              targetPosition5 = connectPosition7;
              num70 = num71;
              num65 -= math.select(
                0,
                1,
                targetPosition5.group != connectPosition7.group,
              );
              num66++;
              flag3 = false;
            }
          }
          if (num65 != num69) {
            for (
              ;
              num65 < num67 &&
              targetBuffer[stackList[num65]].group == targetPosition5.group;
              num65++
            ) {}
          }
        } else {
          num70 = stackList2[num66++];
          targetPosition5 = targetBuffer[num70];
          flag3 = false;
        }
        if (
          (!flag3 || num64 < num2 || num64 >= num2 + num) &&
          (sourcePosition3.roadTypes & targetPosition5.roadTypes) != 0
        ) {
          let flag4 =
            flag3 && targetPosition5.roadTypes != sourcePosition3.roadTypes;
          let {
            isTurn,
            right: right5,
            gentle: gentle5,
            uturn: uturn5,
          } = cs2IsTurn(sourcePosition3, targetPosition5);
          let num72 = sourcePosition3.group | (targetPosition5.group << 16);
          let isLeftLimit = num64 == 0 && num70 == 0;
          let isRightLimit =
            num64 == sourceBuffer.length - 1 &&
            num70 == targetBuffer.length - 1;
          let netGeometryData3 = mergeLayers(targetPosition5.owner);
          flag4 =
            flag4 ||
            (netGeometryData & netGeometryData2 & netGeometryData3) == 0;
          if (
            emit({
              source: sourcePosition3,
              target: targetPosition5,
              group: num72,
              laneIndex: 0,
              isUnsafe: flag4,
              isForbidden: false,
              isTurn: isTurn,
              isRight: right5,
              isGentle: gentle5,
              isUTurn: uturn5,
              isLeftLimit: isLeftLimit,
              isRightLimit: isRightLimit,
              isMergeLeft: false,
              isMergeRight: false,
            })
          ) {
            createdConnections.add(
              connectionKey(sourcePosition3, targetPosition5),
            );
          }
        }
      }
    }
    for (let num73 = 0; num73 < l; num73++) {
      let num74 = sourceBuffer.length - l + num73;
      let sourcePosition4 = clone(sourceBuffer[num74]);
      let num75 = num59;
      let num76: number;
      for (
        num76 = 0;
        num76 < stackList2.length && stackList2[num76] < num61;
        num76++
      ) {}
      while (num75 < stackList.length || num76 < stackList2.length) {
        let num77: number;
        let targetPosition6: CS2LaneConnectPosition;
        let flag5: boolean;
        if (num75 < stackList.length) {
          num77 = stackList[num75++];
          targetPosition6 = targetBuffer[num77];
          flag5 = true;
          for (; num75 < stackList.length; num75++) {
            let connectPosition8 = clone(targetBuffer[stackList[num75]]);
            if (connectPosition8.group != targetPosition6.group) {
              break;
            }
            targetPosition6 = connectPosition8;
          }
          if (num76 < stackList2.length) {
            let num78 = stackList2[num76];
            let connectPosition9 = clone(targetBuffer[num78]);
            if (
              num78 < num77 ||
              targetPosition6.group == connectPosition9.group
            ) {
              targetPosition6 = connectPosition9;
              num77 = num78;
              num75 -= math.select(
                0,
                1,
                targetPosition6.group != connectPosition9.group,
              );
              num76++;
              flag5 = false;
            }
          }
        } else {
          num77 = stackList2[num76++];
          targetPosition6 = targetBuffer[num77];
          flag5 = false;
        }
        if (
          (!flag5 || num74 < num2 || num74 >= num2 + num) &&
          (sourcePosition4.roadTypes & targetPosition6.roadTypes) != 0
        ) {
          let flag6 =
            flag5 && targetPosition6.roadTypes != sourcePosition4.roadTypes;
          let {
            isTurn: isTurn2,
            right: right6,
            gentle: gentle6,
            uturn: uturn6,
          } = cs2IsTurn(sourcePosition4, targetPosition6);
          let num79 = sourcePosition4.group | (targetPosition6.group << 16);
          let isLeftLimit2 = num74 == 0 && num77 == 0;
          let isRightLimit2 =
            num74 == sourceBuffer.length - 1 &&
            num77 == targetBuffer.length - 1;
          let netGeometryData4 = mergeLayers(targetPosition6.owner);
          flag6 =
            flag6 ||
            (netGeometryData & netGeometryData2 & netGeometryData4) == 0;
          if (
            emit({
              source: sourcePosition4,
              target: targetPosition6,
              group: num79,
              laneIndex: 16383,
              isUnsafe: flag6,
              isForbidden: false,
              isTurn: isTurn2,
              isRight: right6,
              isGentle: gentle6,
              isUTurn: uturn6,
              isLeftLimit: isLeftLimit2,
              isRightLimit: isRightLimit2,
              isMergeLeft: false,
              isMergeRight: false,
            })
          ) {
            createdConnections.add(
              connectionKey(sourcePosition4, targetPosition6),
            );
          }
        }
      }
    }
    let num80 = 0;
    while (num80 < stackList.length) {
      let connectPosition10 = clone(targetBuffer[stackList[num80]]);
      let targetPosition7 = clone(connectPosition10);
      let num81: number;
      for (num81 = num80 + 1; num81 < stackList.length; num81++) {
        let connectPosition11 = clone(targetBuffer[stackList[num81]]);
        if (connectPosition11.group != connectPosition10.group) {
          break;
        }
        targetPosition7 = connectPosition11;
      }
      let num82 = num81 - num80;
      let num83 = stackList.length - num81;
      let num84 = sourcePosition.group | (connectPosition10.group << 16);
      let flag7 = num80 < num10 + num18 || num83 < num14 + num22;
      let flag8 = num80 < num10 || num83 < num14;
      let flag9 = num80 < num11 || num83 < num15;
      let flag10 = num80 < num12 + num20 || num83 < num16 + num24;
      let flag11 = num83 < num14 + num22;
      let isGentle = false;
      let num85: number;
      let num86: number;
      if (flag7) {
        if (flag8) {
          if (flag11) {
            num85 = Math.trunc(
              (num83 * num56 + math.select(0, num14 - 1, num56 > num14)) /
                num14,
            );
            num86 =
              Math.trunc(((num83 + num82) * num56 + num14 - 1) / num14) - 1;
            num85 = num - num85 - 1;
            num86 = num - num86 - 1;
            [num85, num86] = [num86, num85];
          } else {
            let num87 = num80;
            num85 = Math.trunc(
              (num87 * num55 + math.select(0, num10 - 1, num55 > num10)) /
                num10,
            );
            num86 =
              Math.trunc(((num87 + num82) * num55 + num10 - 1) / num10) - 1;
          }
        } else if (flag11) {
          let num88 = num83 - num14;
          num85 = Math.trunc(
            (num88 * num58 + math.select(0, num22 - 1, num58 > num22)) / num22,
          );
          num86 = Math.trunc(((num88 + num82) * num58 + num22 - 1) / num22) - 1;
          num85 = num - num41 - num85 - 1;
          num86 = num - num41 - num86 - 1;
          [num85, num86] = [num86, num85];
          let gentle7 = cs2IsTurn(
            sourceBuffer[num85 + num2],
            connectPosition10,
          ).gentle;
          let gentle8 = cs2IsTurn(
            sourceBuffer[num86 + num2],
            targetPosition7,
          ).gentle;
          isGentle = gentle7 && gentle8;
        } else {
          let num89 = num80 - num10;
          num85 = Math.trunc(
            (num89 * num57 + math.select(0, num18 - 1, num57 > num18)) / num18,
          );
          num86 = Math.trunc(((num89 + num82) * num57 + num18 - 1) / num18) - 1;
          num85 = num40 + num85;
          num86 = num40 + num86;
          let gentle9 = cs2IsTurn(
            sourceBuffer[num85 + num2],
            connectPosition10,
          ).gentle;
          let gentle10 = cs2IsTurn(
            sourceBuffer[num86 + num2],
            targetPosition7,
          ).gentle;
          isGentle = gentle9 && gentle10;
        }
      } else {
        let num90 = num80 - num10 - num18;
        if (num42 == 0) {
          num85 = !input.leftHandTraffic
            ? math.min(num40 + num45, num - 1)
            : math.max(num40 + num45 - 1, 0);
          num86 = num85;
        } else {
          num85 = Math.trunc(
            (num90 * num42 + math.select(0, num29 - 1, num42 > num29)) / num29,
          );
          num86 = Math.trunc(((num90 + num82) * num42 + num29 - 1) / num29) - 1;
          num85 = num40 + num45 + num85;
          num86 = num40 + num45 + num86;
        }
        if (num30 > 0) {
          flag10 = !input.leftHandTraffic
            ? flag10 || num29 - num90 - 1 < num30
            : flag10 || num90 < num30;
        }
      }
      let num91 = num86 - num85 + 1;
      let num92 = math.max(num91, num82);
      let num93 = math.min(num91, num82);
      let num94 = 0;
      let num95 = num92 - num93;
      let num96 = 0;
      let num97 = 0;
      let num98 = 3.4028234663852886e38;
      let between = { x: 0, y: 0 };
      if (num82 > num91) {
        between = calculateSourcesBetween(
          sourceBuffer[num85 + num2],
          targetBuffer[stackList[num80]],
          allSources,
        );
        if (between.x >= 1 || between.y >= 1) {
          let num99 = between.x + between.y;
          let num100: number;
          let num101: number;
          if (num99 > num95) {
            num100 = Math.trunc((between.x * num95) / num99);
            num101 = Math.trunc((between.y * num95) / num99);
            if (num95 >= 2 && between.x >= 1 && between.y >= 1) {
              num100 = math.max(num100, 1);
              num101 = math.max(num101, 1);
            }
          } else {
            num100 = between.x;
            num101 = between.y;
          }
          num94 += num100;
          num95 -= num101;
        }
      }
      for (let num102 = num94; num102 <= num95; num102++) {
        let num103 = math.max(num102 + num91 - num92, 0);
        let num104 = math.max(num102 + num82 - num92, 0);
        num103 += num85;
        num104 += num80;
        let connectPosition12 = clone(sourceBuffer[num103 + num2]);
        let connectPosition13 = clone(sourceBuffer[num103 + num2 + num93 - 1]);
        let connectPosition14 = clone(targetBuffer[stackList[num104]]);
        let connectPosition15 = clone(
          targetBuffer[stackList[num104 + num93 - 1]],
        );
        let num105 = math.max(
          0,
          f(dot3(connectPosition12.tangent, connectPosition14.tangent) * -0.5),
        );
        let num106 = math.max(
          0,
          f(dot3(connectPosition13.tangent, connectPosition15.tangent) * -0.5),
        );
        num105 = f(
          num105 *
            distance2(connectPosition12.position, connectPosition14.position),
        );
        num106 = f(
          num106 *
            distance2(connectPosition13.position, connectPosition15.position),
        );
        connectPosition12.position = shiftXZ(
          connectPosition12.position,
          connectPosition12.tangent,
          num105,
        );
        connectPosition14.position = shiftXZ(
          connectPosition14.position,
          connectPosition14.tangent,
          num105,
        );
        connectPosition13.position = shiftXZ(
          connectPosition13.position,
          connectPosition13.tangent,
          num106,
        );
        connectPosition15.position = shiftXZ(
          connectPosition15.position,
          connectPosition15.tangent,
          num106,
        );
        let x = distanceSq2(
          connectPosition12.position,
          connectPosition14.position,
        );
        let y = distanceSq2(
          connectPosition13.position,
          connectPosition15.position,
        );
        let num107 = math.max(x, y);
        if (num107 < num98) {
          num96 = math.min(num92 - num82 - num102, 0);
          num97 = math.min(num92 - num91 - num102, 0);
          num98 = num107;
        }
      }
      for (let num108 = 0; num108 < num92; num108++) {
        let num109 = math.clamp(num108 + num96, 0, num91 - 1);
        let num110 = math.clamp(num108 + num97, 0, num82 - 1);
        let flag12 = num108 + num96 < 0;
        let flag13 = num108 + num96 >= num91;
        let flag14 = num108 + num97 < 0;
        let flag15 = num108 + num97 >= num82;
        let flag16 = flag12 || flag14;
        let flag17 = flag13 || flag15;
        let flag18 = !flag7
          ? flag16 || flag17 || flag10
          : !flag11
            ? flag16 || flag17 || flag9 || flag10 || (flag8 && num40 == 0)
            : flag16 || flag17 || flag9 || flag10 || (flag8 && num41 == 0);
        num109 += num85;
        num110 += num80;
        let num111 = stackList[num110];
        let isLeftLimit3 = num109 == 0 && num110 == num3;
        let isRightLimit3 = num109 == num - 1 && num110 == num4;
        let sourcePosition5 = clone(sourceBuffer[num109 + num2]);
        let connectPosition16 = clone(targetBuffer[num111]);
        if (
          (sourcePosition5.composition.roadFlags &
            connectPosition16.composition.roadFlags &
            16) !=
            0 &&
          ((flag12 && between.x > 0) || (flag13 && between.y > 0))
        ) {
          continue;
        }
        let flag19 =
          (roadTypes & (~sourcePosition5.roadTypes & 255)) != 0 &&
          sourcePosition5.roadTypes != 1;
        let flag20 =
          (roadTypes & (~connectPosition16.roadTypes & 255)) != 0 &&
          connectPosition16.roadTypes != 1;
        if (num108 == 0 || num108 == num92 - 1) {
          let num112 = math.select(1, 0, flag20);
          for (let num113 = 0; num113 < stackList2.length; num113++) {
            let num114 = stackList2[num113];
            if (
              math.abs(num114 - num111) != num112 ||
              (k != 0 && num114 <= num62) ||
              (l != 0 && num114 >= num61)
            ) {
              continue;
            }
            let targetPosition8 = clone(targetBuffer[num114]);
            if (
              targetPosition8.group == connectPosition16.group &&
              (sourcePosition5.roadTypes & targetPosition8.roadTypes) != 0
            ) {
              let num115 = math.select(0, 16383, num114 > num111);
              let isLeftLimit4 = num109 + num2 == 0 && num114 == 0;
              let isRightLimit4 =
                num109 + num2 == sourceBuffer.length - 1 &&
                num114 == targetBuffer.length - 1;
              if (
                emit({
                  source: sourcePosition5,
                  target: targetPosition8,
                  group: num84,
                  laneIndex: num115,
                  isUnsafe: true,
                  isForbidden: flag10,
                  isTurn: flag7,
                  isRight: flag11,
                  isGentle: isGentle,
                  isUTurn: flag8,
                  isLeftLimit: isLeftLimit4,
                  isRightLimit: isRightLimit4,
                  isMergeLeft: false,
                  isMergeRight: false,
                })
              ) {
                createdConnections.add(
                  connectionKey(sourcePosition5, targetPosition8),
                );
              }
            }
          }
        }
        if (
          !flag20 &&
          (sourcePosition5.roadTypes & connectPosition16.roadTypes) != 0
        ) {
          let netGeometryData5 = mergeLayers(connectPosition16.owner);
          flag18 =
            flag18 ||
            (netGeometryData & netGeometryData2 & netGeometryData5) == 0;
          flag18 = flag18 || flag19;
          if (
            emit({
              source: sourcePosition5,
              target: connectPosition16,
              group: num84,
              laneIndex: num108 + 1,
              isUnsafe: flag18,
              isForbidden: flag10,
              isTurn: flag7,
              isRight: flag11,
              isGentle: isGentle,
              isUTurn: flag8,
              isLeftLimit: isLeftLimit3,
              isRightLimit: isRightLimit3,
              isMergeLeft: flag16,
              isMergeRight: flag17,
            })
          ) {
            createdConnections.add(
              connectionKey(sourcePosition5, connectPosition16),
            );
          }
          if (lastSkipped) {
            connectPosition16.skippedCount =
              (connectPosition16.skippedCount + 1) & 255;
            targetBuffer[num111] = connectPosition16;
          } else if (flag10) {
            connectPosition16.unsafeCount =
              (connectPosition16.unsafeCount + 1) & 255;
            connectPosition16.forbiddenCount =
              (connectPosition16.forbiddenCount + 1) & 255;
            targetBuffer[num111] = connectPosition16;
          } else if (flag8 && (flag11 ? num41 : num40) == 0) {
            connectPosition16.unsafeCount =
              (connectPosition16.unsafeCount + 1) & 255;
            targetBuffer[num111] = connectPosition16;
          }
        }
      }
      num80 = num81;
    }
  }
}
