import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cs2RoadCurveCurviness } from "../src/core/cs2-road-curviness";
import type { CS2RoadCurve } from "../src/core/cs2-net-geometry";

const oracle = JSON.parse(
  readFileSync(
    new URL("./fixtures/cs2-road-curviness-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  source: {
    classification: string;
    gameSha256: string;
    mvid: string;
    methods: { token: number; ilSha256: string }[];
  };
  cases: {
    name: string;
    input: { curve: CS2RoadCurve; length: number | string; width: number };
    expected: number | string;
  }[];
};

describe("direct original lane curvature", () => {
  it("records the original DLL and exact CalculateCurviness method identities", () => {
    expect(oracle.source.classification).toContain("direct original Game.dll");
    expect(oracle.source.gameSha256).toBe(
      "721e7e17bf74299aa2b988c1bd07e90874bb8bc72d263229500c4bf639e7e4ee",
    );
    expect(oracle.source.mvid).toBe("36b776ac-5007-4e06-81b3-242b2abfd5b6");
    expect(oracle.source.methods.length).toBeGreaterThan(1);
    for (const method of oracle.source.methods) {
      expect(method.token).toBeGreaterThan(0);
      expect(method.ilSha256).toHaveLength(64);
    }
  });
  for (const row of oracle.cases)
    it(row.name, () => {
      const before = structuredClone(row.input),
        actual = cs2RoadCurveCurviness(
          row.input.curve,
          Number(row.input.length),
          row.input.width,
        );
      if (row.expected === "NaN") expect(actual).toBeNaN();
      else expect(actual).toBe(Math.fround(Number(row.expected)));
      expect(row.input).toEqual(before);
    });
});
