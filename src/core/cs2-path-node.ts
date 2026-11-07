const f = Math.fround;

/** Original PathNode bit layout. CurvePosition's conversion truncates, it does not round. */
export function cs2PackPathNode(input: {
  owner: number;
  lane: number;
  segment?: number;
  curvePosition?: number;
  secondary?: boolean;
}) {
  const lane =
    input.segment === undefined
      ? input.lane & 65535
      : ((input.segment & 255) << 8) | (input.lane & 255);
  const pos = BigInt(Math.trunc(f(f(input.curvePosition ?? 0) * 32767)));
  let packed = (BigInt(input.owner | 0) << 32n) | (pos << 16n) | BigInt(lane);
  if (input.secondary) packed |= 0x80000000n;
  return BigInt.asUintN(64, packed);
}
export function cs2ReadPathNode(packed: bigint) {
  return {
    owner: Number(BigInt.asIntN(32, packed >> 32n)),
    lane: Number(packed & 65535n),
    curvePosition: f(Number((packed >> 16n) & 32767n) * f(3.051851e-5)),
    secondary: (packed & 0x80000000n) !== 0n,
  };
}
export const cs2StripPathNodeCurve = (packed: bigint) =>
  packed & 0xffffffff8000ffffn;
