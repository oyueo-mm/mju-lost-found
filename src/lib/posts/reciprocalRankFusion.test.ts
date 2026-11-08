import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./reciprocalRankFusion";

const options = { key: (item: string) => item, tieBreak: (a: string, b: string) => a.localeCompare(b) };
describe("reciprocal rank fusion", () => {
  it("uses equal reciprocal contributions with k=60, not raw similarity scales", () => {
    const result = reciprocalRankFusion([{ items: ["a", "b", "c"] }, { items: ["b", "c", "d"] }], options);
    expect(result.map((entry) => entry.item)).toEqual(["b", "c", "a", "d"]);
    expect(result[0].score).toBeCloseTo(1 / 62 + 1 / 61);
    expect(result.find((entry) => entry.item === "a")!.score).toBeCloseTo(1 / 61);
  });
  it("counts one document only once per source and makes ties deterministic", () => {
    expect(reciprocalRankFusion([{ items: ["a", "a"] }, { items: ["b"] }], options)).toEqual([
      { item: "a", score: 1 / 61 }, { item: "b", score: 1 / 61 },
    ]);
    expect(reciprocalRankFusion([{ items: [] }, { items: [] }], options)).toEqual([]);
  });
  it("accepts a configurable k and source weights", () => {
    expect(reciprocalRankFusion([{ items: ["b"], weight: 2 }, { items: ["a"] }], { ...options, k: 10 })[0]).toEqual({ item: "b", score: 2 / 11 });
    expect(() => reciprocalRankFusion([], { ...options, k: -1 })).toThrow();
    expect(() => reciprocalRankFusion([{ items: [], weight: Infinity }], options)).toThrow();
  });
});
