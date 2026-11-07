import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cs2FitRoadCurve,
  cs2FitRoadCurveFromLines,
  cs2FitRoadCurveThrough,
  cs2LinearizeRoadElevation,
  cs2OffsetRoadCurveLeftSmooth,
  cs2RoadCurveLength,
  cs2RoadCurvePosition,
  cs2RoadCurveTangent,
  cs2StraightRoadCurve,
  type CS2RoadCurve,
  type CS2RoadLine,
} from "../src/core/cs2-net-geometry";
import type { V } from "../src/core/types";

type Input = {
  start: V;
  end: V;
  startTangent: V;
  endTangent: V;
  middle: V;
  startLine: CS2RoadLine;
  endLine: CS2RoadLine;
  curve: CS2RoadCurve;
  offset: readonly [number, number];
};
type Case = {
  id: string;
  kind: "straight" | "lines" | "fit" | "through" | "offset" | "linearize";
  input: Input;
  expected: {
    curve: CS2RoadCurve;
    length: number;
    samples: { t: number; position: V; tangent: V }[];
  };
};
const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-net-geometry-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  provenance: {
    kind: string;
    sha256: string;
    mvid: string;
    methods: { name: string; token: number; ilSha256: string }[];
  };
  cases: Case[];
};
function construct(row: Case): CS2RoadCurve {
  const p = row.input;
  switch (row.kind) {
    case "straight":
      return cs2StraightRoadCurve(p.start, p.end);
    case "lines":
      return cs2FitRoadCurveFromLines(p.startLine, p.endLine);
    case "fit":
      return cs2FitRoadCurve(p.start, p.startTangent, p.endTangent, p.end);
    case "through":
      return cs2FitRoadCurveThrough(
        p.start,
        p.startTangent,
        p.middle,
        p.endTangent,
        p.end,
      );
    case "offset":
      return cs2OffsetRoadCurveLeftSmooth(p.curve, p.offset);
    case "linearize":
      return cs2LinearizeRoadElevation(p.curve);
  }
}
function compare(actual: unknown, expected: unknown, path = "result") {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(
      Math.abs((actual as number) - Math.fround(expected)),
      path,
    ).toBeLessThanOrEqual(Math.max(1e-6, Math.abs(expected) * 8e-7));
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((v, i) =>
      compare((actual as unknown[])[i], v, `${path}[${i}]`),
    );
  } else if (expected && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected))
      compare(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
      );
  } else expect(actual, path).toBe(expected);
}
describe("original NetUtils road construction geometry", () => {
  it("executes actual original assembly methods, including the private elevation helper", () => {
    expect(oracle.provenance.kind).toContain(
      "direct original Game.dll execution",
    );
    expect(oracle.provenance.sha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.provenance.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    for (const name of [
      "FitCurve",
      "StraightCurve",
      "OffsetCurveLeftSmooth",
      "LinearizeElevation",
    ])
      expect(
        oracle.provenance.methods.some(
          (m) => m.name === name && m.ilSha256.length === 64 && m.token > 0,
        ),
      ).toBe(true);
  });
  for (const row of oracle.cases)
    it(`${row.kind}: ${row.id}`, () => {
      const input = structuredClone(row.input),
        curve = construct(row);
      compare(curve, row.expected.curve, row.id + ".curve");
      compare(
        cs2RoadCurveLength(curve),
        row.expected.length,
        row.id + ".length",
      );
      for (const sample of row.expected.samples) {
        compare(
          cs2RoadCurvePosition(curve, sample.t),
          sample.position,
          row.id + ".position@" + sample.t,
        );
        compare(
          cs2RoadCurveTangent(curve, sample.t),
          sample.tangent,
          row.id + ".tangent@" + sample.t,
        );
      }
      expect(row.input).toEqual(input);
    });
  it("constructs the expected circular quarter turn rather than quadratic conversion", () => {
    const curve = cs2FitRoadCurveFromLines(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 100 },
      ],
      [
        { x: 100, y: 0, z: 100 },
        { x: 0, y: 0, z: 100 },
      ],
    );
    expect(curve[1].z).toBeCloseTo(55.22848, 4);
    expect(curve[2].x).toBeCloseTo(44.77152, 4);
  });
});
