import { describe, expect, it } from "vitest";

import {
  AI_SIMILARITY_IMAGE_BASELINE,
  AI_SIMILARITY_SCALE_ID,
  AI_SIMILARITY_TEXT_BASELINE,
  aiSimilarity,
  candidatePool,
  rankByAiSimilarity,
} from "./rankFusion";

// AI 유사도 척도 통일 Phase: this module is the one "AI 유사도" (D3) scale
// shared by recommendation/service.ts and posts/aiService.ts's AI 검색 --
// these tests pin the pure functions directly.
describe("aiSimilarity", () => {
  it("maps each signal's baseline cosine to 0 and cosine 1 to 1", () => {
    expect(aiSimilarity(AI_SIMILARITY_TEXT_BASELINE, null)?.score).toBeCloseTo(0);
    expect(aiSimilarity(1, null)?.score).toBeCloseTo(1);
    expect(aiSimilarity(null, AI_SIMILARITY_IMAGE_BASELINE)?.score).toBeCloseTo(0);
    expect(aiSimilarity(null, 1)?.score).toBeCloseTo(1);
  });

  it("is an absolute score -- the same cosine always yields the same value", () => {
    // text: (0.68 - 0.361) / (1 - 0.361) = 0.4992...
    expect(aiSimilarity(0.68, null)?.score).toBeCloseTo((0.68 - 0.361) / 0.639, 6);
  });

  it("averages the calibrated signals when both are present", () => {
    const text = (0.68 - 0.361) / 0.639;
    const image = (0.9 - 0.657) / 0.343;
    expect(aiSimilarity(0.68, 0.9)?.score).toBeCloseTo((text + image) / 2, 6);
  });

  it("clamps to [0, 1] but keeps the unclamped mean for tie-breaking", () => {
    const result = aiSimilarity(0.2, null)!;
    expect(result.score).toBe(0);
    expect(result.unclamped).toBeLessThan(0);
  });

  it("returns null when neither signal is available", () => {
    expect(aiSimilarity(null, null)).toBeNull();
  });
});

describe("rankByAiSimilarity", () => {
  it("sorts by AI 유사도 descending, never normalizing the top candidate to 1", () => {
    const ranked = rankByAiSimilarity([
      { id: 1, text: 0.5, image: null },
      { id: 2, text: 0.7, image: null },
    ]);

    expect(ranked.map((r) => r.id)).toEqual([2, 1]);
    expect(ranked[0].score).toBeLessThan(1);
  });

  it("does not let an image signal win on scale alone -- each signal is calibrated to its own baseline", () => {
    const ranked = rankByAiSimilarity([
      // Raw image cosine 0.70 is only just above the image baseline (0.657).
      { id: 1, text: 0.4, image: 0.7 },
      // Strong text match, no image.
      { id: 2, text: 0.75, image: null },
    ]);

    expect(ranked.map((r) => r.id)).toEqual([2, 1]);
  });

  it("orders candidates clamped to 0 by their unclamped value, not by id", () => {
    const ranked = rankByAiSimilarity([
      { id: 1, text: 0.1, image: null },
      { id: 2, text: 0.33, image: null },
    ]);

    expect(ranked.map((r) => r.id)).toEqual([2, 1]);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it("falls back to id ascending on an exact tie", () => {
    const ranked = rankByAiSimilarity([
      { id: 3, text: 0.6, image: null },
      { id: 1, text: 0.6, image: null },
    ]);

    expect(ranked.map((r) => r.id)).toEqual([1, 3]);
  });

  it("drops only candidates with no signal at all, and applies no threshold", () => {
    const ranked = rankByAiSimilarity([
      { id: 1, text: null, image: null },
      { id: 2, text: 0.05, image: null },
    ]);

    expect(ranked).toEqual([{ id: 2, score: 0 }]);
  });
});

describe("candidatePool", () => {
  it("unions every ranking's ids without duplicates", () => {
    expect(candidatePool([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])).toEqual([1, 2, 3]);
  });
});

describe("AI_SIMILARITY_SCALE_ID", () => {
  it("encodes both baselines, so changing either invalidates cached rankings", () => {
    expect(AI_SIMILARITY_SCALE_ID).toContain(String(AI_SIMILARITY_TEXT_BASELINE));
    expect(AI_SIMILARITY_SCALE_ID).toContain(String(AI_SIMILARITY_IMAGE_BASELINE));
  });
});
