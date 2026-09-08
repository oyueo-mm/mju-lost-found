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
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 5, score: 0.7 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([expect.objectContaining({ id: 5, score: 0.7 })]);
  });

  it("propagates a real (non-embedding) failure from the text search", async () => {
    findSimilarPosts.mockRejectedValueOnce(new Error("connection reset"));

    await expect(findPostRecommendations("lost", 1)).rejects.toThrow("connection reset");
  });

  it("enriches a text-only candidate with fully hydrated post details", async () => {
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
        score: 0.87,
      }),
    ]);
  });

  // Phase J-2 section 6: "존재하는 신호만 사용" -- a candidate present in
  // both rankings gets the plain average of its two scores; a candidate
  // present in only one keeps that single score untouched.
  it("averages text and image scores when a candidate appears in both rankings", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.8 }]);
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 5, score: 0.6 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    const result = await findPostRecommendations("lost", 1);

    expect(result).toEqual([expect.objectContaining({ id: 5, score: 0.7 })]);
  });

  it("keeps a candidate's single score untouched when only one signal ranks it", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.8 }]);
    findSimilarPostsByImage.mockResolvedValueOnce([{ id: 9, score: 0.6 }]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 5 }), row({ id: 9, title: "사진으로만 매칭" })]);

    const result = await findPostRecommendations("lost", 1);

    const byId = new Map(result.map((r) => [r.id, r.score]));
    expect(byId.get(5)).toBe(0.8);
    expect(byId.get(9)).toBe(0.6);
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

  it("computes and writes the ranking to the cache on a cache miss", async () => {
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    foundPost.findMany.mockResolvedValueOnce([row()]);

    await findPostRecommendations("lost", 1);

    expect(matchCandidateCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceType_sourcePostId: { sourceType: "lost", sourcePostId: 1 } },
        create: expect.objectContaining({ candidates: [{ id: 5, score: 0.87 }] }),
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
