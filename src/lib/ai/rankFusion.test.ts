import { describe, expect, it } from "vitest";

import { combineRankings, minMaxNormalize } from "./rankFusion";

// AI 검색 고도화 Phase: this module is the extracted, shared copy of
// recommendation/service.ts's original Phase O-3/O-4 combining math (see
// its own comment) -- recommendation/service.test.ts already exercises it
// indirectly through findPostRecommendations(); these tests pin the pure
// function's own behavior directly, since it's now a standalone module
// imported by two independent callers (recommendation/service.ts and
// posts/aiService.ts's searchPostsAI).
describe("minMaxNormalize", () => {
  it("rescales scores onto [0, 1] relative to the current candidate pool", () => {
    const result = minMaxNormalize(new Map([[1, 0.2], [2, 0.6], [3, 1.0]]));

    expect(result.get(1)).toBeCloseTo(0);
    expect(result.get(2)).toBeCloseTo(0.5);
    expect(result.get(3)).toBeCloseTo(1);
  });

  it("treats every candidate as equally maximal when all scores tie", () => {
    const result = minMaxNormalize(new Map([[1, 0.5], [2, 0.5]]));

    expect(result.get(1)).toBe(1);
    expect(result.get(2)).toBe(1);
  });
});

describe("combineRankings", () => {
  it("averages the normalized text and image scores for a candidate present in both", () => {
    const combined = combineRankings(
      [{ id: 1, score: 0.5 }, { id: 2, score: 1.0 }],
      [{ id: 1, score: 1.0 }, { id: 2, score: 0.5 }],
    );

    // id 1: text normalizes to 0, image normalizes to 1 -> avg 0.5.
    // id 2: text normalizes to 1, image normalizes to 0 -> avg 0.5.
    expect(combined.find((c) => c.id === 1)?.score).toBeCloseTo(0.5);
    expect(combined.find((c) => c.id === 2)?.score).toBeCloseTo(0.5);
  });

  it("uses whichever single signal a candidate has, without penalizing the missing one", () => {
    const combined = combineRankings([{ id: 1, score: 0.3 }], [{ id: 2, score: 0.9 }]);

    // Each is the lone candidate on its own signal -- a lone score always
    // normalizes to 1 (min === max tie case), so both end up equal despite
    // very different raw scores.
    expect(combined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, score: 1 }),
        expect.objectContaining({ id: 2, score: 1 }),
      ]),
    );
  });

  it("sorts by combined score descending, id ascending as a tiebreaker", () => {
    const combined = combineRankings(
      [{ id: 3, score: 0.9 }, { id: 1, score: 0.1 }],
      [],
    );

    expect(combined.map((c) => c.id)).toEqual([3, 1]);
  });

  it("returns an empty array when neither signal has any candidates", () => {
    expect(combineRankings([], [])).toEqual([]);
  });
});
