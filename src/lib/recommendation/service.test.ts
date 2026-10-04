import { beforeEach, describe, expect, it, vi } from "vitest";

import { AI_SIMILARITY_SCALE_ID, aiSimilarity } from "@/lib/ai/rankFusion";

const lostPost = { findMany: vi.fn() };
const foundPost = { findMany: vi.fn() };
const matchCandidateCache = { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() };
const findSimilarPosts = vi.fn();
const findSimilarPostsByImage = vi.fn();
const findCandidateCosines = vi.fn();

class FakeEmbeddingNotAvailableError extends Error {}

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost, matchCandidateCache } }));
vi.mock("@/lib/ai/vectorSearch", () => ({
  findSimilarPosts,
  findSimilarPostsByImage,
  findCandidateCosines,
  EmbeddingNotAvailableError: FakeEmbeddingNotAvailableError,
}));

const { applyRecommendationMinimum, findPostRecommendations, invalidateRecommendationCache, RECOMMENDATION_MIN_AI_SIMILARITY } =
  await import("./service");

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 5,
  userId: 2,
  title: "습득한 지갑",
  description: "검은색 지갑을 주웠어요",
  category: "지갑",
  location: "학생회관",
  campus: "인문캠퍼스",
  status: "KEEPING",
  imageUrl: null,
  foundAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  viewCount: 0,
  user: { id: 2, nickname: "홍길동", publicId: "pub-2" },
  ...overrides,
});

const d3 = (text: number | null, image: number | null) => aiSimilarity(text, image)!.score;

beforeEach(() => {
  vi.clearAllMocks();
  matchCandidateCache.findUnique.mockResolvedValue(null);
  findSimilarPostsByImage.mockResolvedValue([]);
  findCandidateCosines.mockResolvedValue([]);
});

describe("findPostRecommendations", () => {
  it("searches the opposite board via pgvector (lost source -> found candidates)", async () => {
    findSimilarPosts.mockResolvedValueOnce([]);

    await findPostRecommendations("lost", 1);

    expect(findSimilarPosts).toHaveBeenCalledWith("lost", 1, expect.any(Number));
    expect(findSimilarPostsByImage).toHaveBeenCalledWith("lost", 1, expect.any(Number));
    expect(findCandidateCosines).not.toHaveBeenCalled(); // empty pool -> nothing to score
    expect(foundPost.findMany).not.toHaveBeenCalled(); // no candidates -> no enrichment query needed
  });

  it("works symmetrically for a FoundPost source (candidates come from LostPost)", async () => {
    findSimilarPosts.mockResolvedValueOnce([]);

    await findPostRecommendations("found", 1);

    expect(findSimilarPosts).toHaveBeenCalledWith("found", 1, expect.any(Number));
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty list when no text or image candidates are found", async () => {
    findSimilarPosts.mockResolvedValueOnce([]);

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([]);
  });

  it("returns an empty list (not an error) when the source post has no text embedding yet", async () => {
    findSimilarPosts.mockRejectedValueOnce(new FakeEmbeddingNotAvailableError("no embedding"));

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([]);
  });

  it("still returns image-only recommendations when the source has no text embedding", async () => {
    findSimilarPosts.mockRejectedValueOnce(new FakeEmbeddingNotAvailableError("no embedding"));
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 5, score: 0.95 }]);
    findCandidateCosines.mockResolvedValueOnce([{ id: 5, text: null, image: 0.9 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([expect.objectContaining({ id: 5, score: d3(null, 0.9) })]);
  });

  it("propagates a real (non-embedding) failure from the text search", async () => {
    findSimilarPosts.mockRejectedValueOnce(new Error("connection reset"));

    await expect(findPostRecommendations("lost", 1)).rejects.toThrow("connection reset");
  });

  it("enriches a candidate with fully hydrated post details and its absolute AI 유사도", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    findCandidateCosines.mockResolvedValueOnce([{ id: 5, text: 0.74, image: null }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(foundPost.findMany).toHaveBeenCalledWith({
      where: { id: { in: [5] }, tempHiddenAt: null },
      include: {
        user: { select: { id: true, nickname: true, publicId: true, userType: true } },
        organization: { select: { id: true, name: true } },
      },
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 5,
        type: "found",
        title: "습득한 지갑",
        status: "보관 중",
        author: { id: 2, nickname: "홍길동", publicId: "pub-2" },
        score: d3(0.74, null),
      }),
    ]);
    // A lone candidate is no longer normalized to 1 (the old relative score).
    expect(result[0].score).toBeLessThan(1);
  });

  // D3-pool: the pool is the text top-K ∪ the image top-K, unchanged, but
  // both signals are fetched for every pooled candidate and the pool is
  // re-sorted by AI 유사도.
  it("scores the text ∪ image candidate pool with both signals and sorts it by AI 유사도", async () => {
    findSimilarPosts.mockResolvedValueOnce([
      { id: 5, score: 0.85 },
      { id: 6, score: 0.8 },
    ]);
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 7, score: 0.97 }]);
    findCandidateCosines.mockResolvedValueOnce([
      { id: 5, text: 0.7, image: null },
      { id: 6, text: 0.6, image: 0.95 }, // made only the text top-K, but has a strong image match
      { id: 7, text: 0.3, image: 0.94 },
    ]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 }), row({ id: 6 }), row({ id: 7 })]);

    const result = await findPostRecommendations("lost", 1);

    expect(findCandidateCosines).toHaveBeenCalledWith("lost", 1, [5, 6, 7]);
    expect(result.map((r) => r.id)).toEqual([6, 5, 7]);
    expect(result.map((r) => r.score)).toEqual([d3(0.6, 0.95), d3(0.7, null), d3(0.3, 0.94)]);
  });

  // 추천 최소 AI 유사도 Phase.
  it("hides candidates whose AI 유사도 is below RECOMMENDATION_MIN_AI_SIMILARITY", async () => {
    findSimilarPosts.mockResolvedValueOnce([
      { id: 5, score: 0.85 },
      { id: 6, score: 0.7 },
    ]);
    findCandidateCosines.mockResolvedValueOnce([
      { id: 5, text: 0.7, image: null }, // D3 0.53 -- shown
      { id: 6, text: 0.5, image: null }, // D3 0.22 -- hidden
    ]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 })]);

    const result = await findPostRecommendations("lost", 1);

    expect(d3(0.5, null)).toBeLessThan(RECOMMENDATION_MIN_AI_SIMILARITY);
    expect(foundPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [5] }, tempHiddenAt: null } }));
    expect(result.map((r) => r.id)).toEqual([5]);
  });

  it("keeps a candidate scoring exactly the minimum", () => {
    expect(applyRecommendationMinimum([{ id: 1, score: RECOMMENDATION_MIN_AI_SIMILARITY }])).toEqual([
      { id: 1, score: RECOMMENDATION_MIN_AI_SIMILARITY },
    ]);
  });

  it("returns the empty ('추천 없음') state when every candidate is below the minimum", async () => {
    findSimilarPosts.mockResolvedValueOnce([
      { id: 5, score: 0.7 },
      { id: 6, score: 0.66 },
    ]);
    findCandidateCosines.mockResolvedValueOnce([
      { id: 5, text: 0.5, image: null },
      { id: 6, text: 0.33, image: null },
    ]);

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([]);
    expect(foundPost.findMany).not.toHaveBeenCalled();
  });

  it("drops a ranked candidate that no longer exists (deleted since ranking)", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.8 }, { id: 6, score: 0.7 }]);
    findCandidateCosines.mockResolvedValueOnce([
      { id: 5, text: 0.7, image: null },
      { id: 6, text: 0.65, image: null },
    ]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 })]); // id 6 no longer exists

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([expect.objectContaining({ id: 5 })]);
  });
});

describe("findPostRecommendations -- ranking cache", () => {
  it("returns a current-scale cached ranking without searching again, but re-fetches fresh post rows", async () => {
    matchCandidateCache.findUnique.mockResolvedValueOnce({
      id: 1,
      sourceType: "lost",
      sourcePostId: 1,
      candidates: { scale: AI_SIMILARITY_SCALE_ID, ranking: [{ id: 5, score: 0.42 }] },
      computedAt: new Date(),
    });
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5, title: "최신 제목" })]);

    const result = await findPostRecommendations("lost", 1);

    expect(findSimilarPosts).not.toHaveBeenCalled();
    expect(findSimilarPostsByImage).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: 5, title: "최신 제목", score: 0.42 })]);
  });

  it("treats a pre-D3 relative-score row (bare array) as a miss and overwrites it", async () => {
    matchCandidateCache.findUnique.mockResolvedValueOnce({
      id: 1,
      sourceType: "lost",
      sourcePostId: 1,
      candidates: [{ id: 5, score: 1 }],
      computedAt: new Date(),
    });
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    findCandidateCosines.mockResolvedValueOnce([{ id: 5, text: 0.74, image: null }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(findSimilarPosts).toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: 5, score: d3(0.74, null) })]);
    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          candidates: { scale: AI_SIMILARITY_SCALE_ID, ranking: [{ id: 5, score: d3(0.74, null) }] },
        }),
      }),
    );
  });

  it("caches the full ranking but applies the minimum when reading it", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.85 }, { id: 6, score: 0.7 }]);
    findCandidateCosines.mockResolvedValueOnce([
      { id: 5, text: 0.7, image: null },
      { id: 6, text: 0.5, image: null },
    ]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 })]);

    await findPostRecommendations("lost", 1);

    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          candidates: { scale: AI_SIMILARITY_SCALE_ID, ranking: [{ id: 5, score: d3(0.7, null) }, { id: 6, score: d3(0.5, null) }] },
        }),
      }),
    );

    matchCandidateCache.findUnique.mockResolvedValueOnce({
      id: 1,
      sourceType: "lost",
      sourcePostId: 1,
      candidates: { scale: AI_SIMILARITY_SCALE_ID, ranking: [{ id: 5, score: 0.53 }, { id: 6, score: 0.2 }] },
      computedAt: new Date(),
    });
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 })]);

    const cached = await findPostRecommendations("lost", 1);

    expect(cached.map((r) => r.id)).toEqual([5]);
  });

  it("treats a row from a different scale (e.g. changed baselines) as a miss", async () => {
    matchCandidateCache.findUnique.mockResolvedValueOnce({
      id: 1,
      sourceType: "lost",
      sourcePostId: 1,
      candidates: { scale: "d3:text=0.3:image=0.6", ranking: [{ id: 5, score: 0.9 }] },
      computedAt: new Date(),
    });
    findSimilarPosts.mockResolvedValueOnce([]);

    await findPostRecommendations("lost", 1);

    expect(findSimilarPosts).toHaveBeenCalled();
  });

  it("computes and writes the scale-tagged ranking to the cache on a cache miss", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    findCandidateCosines.mockResolvedValueOnce([{ id: 5, text: 0.74, image: null }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    await findPostRecommendations("lost", 1);

    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceType_sourcePostId: { sourceType: "lost", sourcePostId: 1 } },
        create: expect.objectContaining({
          candidates: { scale: AI_SIMILARITY_SCALE_ID, ranking: [{ id: 5, score: d3(0.74, null) }] },
        }),
      }),
    );
  });

  it("caches an empty ranking too, so a post with genuinely no candidates isn't re-searched every view", async () => {
    findSimilarPosts.mockResolvedValueOnce([]);

    await findPostRecommendations("lost", 1);

    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ candidates: { scale: AI_SIMILARITY_SCALE_ID, ranking: [] } }),
      }),
    );
  });
});

describe("invalidateRecommendationCache", () => {
  it("deletes the cache row for the given source post", async () => {
    await invalidateRecommendationCache("found", 7);

    expect(matchCandidateCache.deleteMany).toHaveBeenCalledWith({
      where: { sourceType: "found", sourcePostId: 7 },
    });
  });
});
