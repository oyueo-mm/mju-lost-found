import { describe, expect, it } from "vitest";

import { cosineSimilarity, DEFAULT_TOP_K, normalizeScore, rankCandidates } from "./matching";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for a zero vector instead of dividing by zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([0, 0], [0, 0]))).toBe(false);
  });
});

describe("normalizeScore", () => {
  it("maps cosine 1 to 1", () => {
    expect(normalizeScore(1)).toBeCloseTo(1);
  });

  it("maps cosine 0 to 0.5", () => {
    expect(normalizeScore(0)).toBeCloseTo(0.5);
  });

  it("maps cosine -1 to 0", () => {
    expect(normalizeScore(-1)).toBeCloseTo(0);
  });

  it("stays within [0, 1] even for an out-of-range input", () => {
    expect(normalizeScore(5)).toBeLessThanOrEqual(1);
    expect(normalizeScore(-5)).toBeGreaterThanOrEqual(0);
  });
});

describe("rankCandidates", () => {
  it("returns an empty array for an empty candidate list", async () => {
    expect(await rankCandidates("지갑", [])).toEqual([]);
  });

  it("ranks candidates by score, most similar first", async () => {
    const results = await rankCandidates("검은색 지갑을 학생회관에서 잃어버렸습니다", [
      { id: 1, type: "found", text: "검은색 지갑을 학생회관에서 주웠습니다", createdAt: new Date("2026-01-01") },
      { id: 2, type: "found", text: "아이폰 15 도서관에서 습득", createdAt: new Date("2026-01-01") },
    ]);

    expect(results[0].id).toBe(1); // shares far more text with the target
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("limits results to topK", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      type: "found" as const,
      text: `후보 게시물 ${i}`,
      createdAt: new Date("2026-01-01"),
    }));

    const results = await rankCandidates("지갑", candidates, 3);

    expect(results).toHaveLength(3);
  });

  it("defaults to DEFAULT_TOP_K when no limit is given", async () => {
    const candidates = Array.from({ length: DEFAULT_TOP_K + 5 }, (_, i) => ({
      id: i + 1,
      type: "found" as const,
      text: `후보 게시물 ${i}`,
      createdAt: new Date("2026-01-01"),
    }));

    const results = await rankCandidates("지갑", candidates);

    expect(results).toHaveLength(DEFAULT_TOP_K);
  });

  it("breaks a score tie deterministically by createdAt desc, then id desc", async () => {
    // Same text -> same score for every candidate below, so the sort is
    // decided entirely by the tiebreakers.
    const results = await rankCandidates("동일 텍스트", [
      { id: 1, type: "found", text: "동일 텍스트", createdAt: new Date("2026-01-01") },
      { id: 2, type: "found", text: "동일 텍스트", createdAt: new Date("2026-01-03") },
      { id: 3, type: "found", text: "동일 텍스트", createdAt: new Date("2026-01-02") },
    ]);

    expect(results.map((r) => r.id)).toEqual([2, 3, 1]); // newest createdAt first
  });

  it("each result only contains id/type/score -- no leaked internal fields", async () => {
    const results = await rankCandidates("지갑", [
      { id: 1, type: "lost", text: "지갑", createdAt: new Date() },
    ]);

    expect(Object.keys(results[0]).sort()).toEqual(["id", "score", "type"]);
  });
});
