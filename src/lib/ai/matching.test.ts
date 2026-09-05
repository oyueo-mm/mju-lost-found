import { describe, expect, it } from "vitest";

import { cosineSimilarity, normalizeScore } from "./matching";

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
