import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findUnique: vi.fn(), findMany: vi.fn() };
const foundPost = { findUnique: vi.fn(), findMany: vi.fn() };
const findSimilarPosts = vi.fn();

class FakeEmbeddingNotAvailableError extends Error {}

// No `match` key at all on the mocked prisma object -- if
// findMatchCandidates ever touched prisma.match (e.g. to auto-create one),
// this would throw "Cannot read properties of undefined", proving AI
// candidate generation never writes a Match on its own.
vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("@/lib/ai/vectorSearch", () => ({
  findSimilarPosts,
  EmbeddingNotAvailableError: FakeEmbeddingNotAvailableError,
}));

const { findMatchCandidates } = await import("./candidates");

const post = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  userId: 1,
  title: "지갑",
  description: "검은색 지갑",
  category: "지갑",
  location: "학생회관",
  imageUrl: null,
  createdAt: new Date("2026-01-01"),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findMatchCandidates", () => {
  it("returns not_found for a nonexistent source post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);

    const result = await findMatchCandidates("lost", 999, 1);

    expect(result).toEqual({ kind: "not_found" });
    expect(findSimilarPosts).not.toHaveBeenCalled();
  });

  it("rejects a requester who doesn't own the source post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post({ userId: 999 }));

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "forbidden" });
    expect(findSimilarPosts).not.toHaveBeenCalled();
  });

  it("searches the opposite board via pgvector (lost source -> found candidates)", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    findSimilarPosts.mockResolvedValueOnce([]);

    await findMatchCandidates("lost", 1, 1);

    expect(findSimilarPosts).toHaveBeenCalledWith("lost", 1, expect.any(Number));
    expect(foundPost.findMany).not.toHaveBeenCalled(); // no candidates -> no enrichment query needed
  });

  it("returns an empty result when the vector search finds no candidates", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    findSimilarPosts.mockResolvedValueOnce([]);

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "ok", data: [] });
  });

  it("enriches ranked candidates with post details fetched by id", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    findSimilarPosts.mockResolvedValueOnce([{ id: 5, score: 0.87 }]);
    foundPost.findMany.mockResolvedValueOnce([
      post({ id: 5, title: "습득한 지갑", category: "지갑", location: "학생회관" }),
    ]);

    const result = await findMatchCandidates("lost", 1, 1);

    expect(foundPost.findMany).toHaveBeenCalledWith({ where: { id: { in: [5] } } });
    expect(result).toEqual({
      kind: "ok",
      data: [
        {
          postId: 5,
          type: "found",
          score: 0.87,
          title: "습득한 지갑",
          category: "지갑",
          location: "학생회관",
          imageUrl: null,
        },
      ],
    });
  });

  it("returns ai_unavailable when the source post has no embedding yet, without logging it as an error", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    findSimilarPosts.mockRejectedValueOnce(new FakeEmbeddingNotAvailableError("no embedding"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "ai_unavailable" });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns ai_unavailable and logs it when the vector search fails for a real reason", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    findSimilarPosts.mockRejectedValueOnce(new Error("connection reset"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "ai_unavailable" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("works symmetrically for a FoundPost source (candidates come from LostPost)", async () => {
    foundPost.findUnique.mockResolvedValueOnce(post({ userId: 1 }));
    findSimilarPosts.mockResolvedValueOnce([]);

    const result = await findMatchCandidates("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: [] });
    expect(findSimilarPosts).toHaveBeenCalledWith("found", 1, expect.any(Number));
  });
});
