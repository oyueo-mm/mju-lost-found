import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findMany: vi.fn() };
const foundPost = { findMany: vi.fn() };
const matchCandidateCache = { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() };
const findSimilarPosts = vi.fn();
const findSimilarPostsByImage = vi.fn();

class FakeEmbeddingNotAvailableError extends Error {}

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost, matchCandidateCache } }));
vi.mock("@/lib/ai/vectorSearch", () => ({
  findSimilarPosts,
  findSimilarPostsByImage,
  EmbeddingNotAvailableError: FakeEmbeddingNotAvailableError,
}));

const { findPostRecommendations, invalidateRecommendationCache } = await import("./service");

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

beforeEach(() => {
  vi.clearAllMocks();
  matchCandidateCache.findUnique.mockResolvedValue(null);
  findSimilarPostsByImage.mockResolvedValue([]);
});

describe("findPostRecommendations", () => {
  it("searches the opposite board via pgvector (lost source -> found candidates)", async () => {
    findSimilarPosts.mockResolvedValueOnce([]);

    await findPostRecommendations("lost", 1);

    expect(findSimilarPosts).toHaveBeenCalledWith("lost", 1, expect.any(Number));
    expect(findSimilarPostsByImage).toHaveBeenCalledWith("lost", 1, expect.any(Number));
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
    // A single candidate is trivially tied with itself on the image signal
    // (min === max), so it normalizes to 1 -- see minMaxNormalize()'s tie case.
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 5, score: 0.7 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([expect.objectContaining({ id: 5, score: 1 })]);
  });

  it("propagates a real (non-embedding) failure from the text search", async () => {
    findSimilarPosts.mockRejectedValueOnce(new Error("connection reset"));

    await expect(findPostRecommendations("lost", 1)).rejects.toThrow("connection reset");
  });

  it("enriches a text-only candidate with fully hydrated post details", async () => {
    // Same tie case as the image-only test above -- a lone text candidate
    // normalizes to 1.
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(foundPost.findMany).toHaveBeenCalledWith({
      where: { id: { in: [5] } },
      include: { user: { select: { id: true, nickname: true, publicId: true } } },
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 5,
        type: "found",
        title: "습득한 지갑",
        status: "보관 중",
        author: { id: 2, nickname: "홍길동", publicId: "pub-2" },
        score: 1,
      }),
    ]);
  });

  // Phase O-4: text/image cosine similarity sit on different absolute
  // scales (Phase O-3's finding), so each signal is min-max normalized
  // across the current candidate union before averaging -- never a plain
  // average of the raw scores.
  it("averages normalized text and image scores when a candidate appears in both rankings", async () => {
    findSimilarPosts.mockResolvedValueOnce([
      { id: 5, score: 0.6 },
      { id: 6, score: 0.8 },
      { id: 7, score: 1.0 },
    ]);
    findSimilarPostsByImage.mockResolvedValueOnce([
      { id: 5, score: 0.5 },
      { id: 6, score: 0.7 },
      { id: 7, score: 0.9 },
    ]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 }), row({ id: 6 }), row({ id: 7 })]);

    const result = await findPostRecommendations("lost", 1);

    // Each signal spans the same min/max, so normalized text === normalized
    // image for every id here, and the average equals that shared value:
    // id5 -> 0, id6 -> 0.5, id7 -> 1.
    const byId = new Map(result.map((r) => [r.id, r.score]));
    expect(byId.get(5)).toBeCloseTo(0, 5);
    expect(byId.get(6)).toBeCloseTo(0.5, 5);
    expect(byId.get(7)).toBeCloseTo(1, 5);
  });

  // Phase O-3's concrete finding: a candidate whose only advantage is
  // having a (structurally inflated) image score used to outrank a
  // no-image candidate with genuinely higher text relevance. Normalizing
  // each signal within its own candidate set before averaging fixes this.
  it("no longer lets a raw high image score outrank a no-image candidate with better relative text relevance", async () => {
    findSimilarPosts.mockResolvedValueOnce([
      { id: 5, score: 0.65 }, // has an image; weaker text match
      { id: 6, score: 0.75 }, // no image; stronger text match
    ]);
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 5, score: 0.95 }]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 }), row({ id: 6 })]);

    const result = await findPostRecommendations("lost", 1);

    const byId = new Map(result.map((r) => [r.id, r.score]));
    // Old plain-average behavior: id5 = (0.65+0.95)/2 = 0.8 > id6 = 0.75 (wrong).
    // Normalized: text min/max = [0.65, 0.75] -> id5=0, id6=1; image is a
    // singleton -> id5's image normalizes to 1 (tie case).
    // id5 = avg(0, 1) = 0.5, id6 = 1 (text-only, untouched by image).
    expect(byId.get(6)).toBeGreaterThan(byId.get(5)!);
    expect(byId.get(5)).toBeCloseTo(0.5, 5);
    expect(byId.get(6)).toBeCloseTo(1, 5);
  });

  it("handles a tied signal (all candidates score identically) without producing NaN or Infinity", async () => {
    findSimilarPosts.mockResolvedValueOnce([
      { id: 5, score: 0.7 },
      { id: 6, score: 0.7 },
    ]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 }), row({ id: 6 })]);

    const result = await findPostRecommendations("lost", 1);

    for (const r of result) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBe(1); // tied signal -> treated as equally maximal, not 0
    }
  });

  it("drops a ranked candidate that no longer exists (deleted since ranking)", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.8 }, { id: 6, score: 0.7 }]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 })]); // id 6 no longer exists

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([expect.objectContaining({ id: 5 })]);
  });
});

describe("findPostRecommendations -- ranking cache", () => {
  it("returns a cached ranking without calling findSimilarPosts again, but re-fetches fresh post rows", async () => {
    matchCandidateCache.findUnique.mockResolvedValueOnce({
      id: 1,
      sourceType: "lost",
      sourcePostId: 1,
      candidates: [{ id: 5, score: 0.9 }],
      computedAt: new Date(),
    });
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5, title: "최신 제목" })]);

    const result = await findPostRecommendations("lost", 1);

    expect(findSimilarPosts).not.toHaveBeenCalled();
    expect(findSimilarPostsByImage).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: 5, title: "최신 제목", score: 0.9 })]);
  });

  it("computes and writes the (normalized) ranking to the cache on a cache miss", async () => {
    // Lone candidate -> tie case -> normalizes to 1, same as the earlier
    // text-only test.
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    await findPostRecommendations("lost", 1);

    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceType_sourcePostId: { sourceType: "lost", sourcePostId: 1 } },
        create: expect.objectContaining({ candidates: [{ id: 5, score: 1 }] }),
      }),
    );
  });

  it("caches an empty ranking too, so a post with genuinely no candidates isn't re-searched every view", async () => {
    findSimilarPosts.mockResolvedValueOnce([]);

    await findPostRecommendations("lost", 1);

    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ candidates: [] }) }),
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
