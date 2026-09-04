import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findUnique: vi.fn(), findMany: vi.fn() };
const foundPost = { findUnique: vi.fn(), findMany: vi.fn() };
const rankCandidates = vi.fn();

// No `match` key at all on the mocked prisma object -- if
// findMatchCandidates ever touched prisma.match (e.g. to auto-create one),
// this would throw "Cannot read properties of undefined", proving AI
// candidate generation never writes a Match on its own.
vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("@/lib/ai/matching", () => ({ rankCandidates }));

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
    expect(rankCandidates).not.toHaveBeenCalled();
  });

  it("rejects a requester who doesn't own the source post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post({ userId: 999 }));

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "forbidden" });
    expect(rankCandidates).not.toHaveBeenCalled();
  });

  it("queries the opposite board for candidates", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    foundPost.findMany.mockResolvedValueOnce([]);

    await findMatchCandidates("lost", 1, 1);

    expect(foundPost.findMany).toHaveBeenCalled();
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty result when the candidate pool is empty, without calling the AI ranker", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    foundPost.findMany.mockResolvedValueOnce([]);

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "ok", data: [] });
    expect(rankCandidates).not.toHaveBeenCalled();
  });

  it("enriches ranked candidates with post details", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    foundPost.findMany.mockResolvedValueOnce([
      post({ id: 5, title: "습득한 지갑", category: "지갑", location: "학생회관" }),
    ]);
    rankCandidates.mockResolvedValueOnce([{ id: 5, type: "found", score: 0.87 }]);

    const result = await findMatchCandidates("lost", 1, 1);

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

  it("returns ai_unavailable when the ranker throws, instead of propagating the error", async () => {
    lostPost.findUnique.mockResolvedValueOnce(post());
    foundPost.findMany.mockResolvedValueOnce([post({ id: 5 })]);
    rankCandidates.mockRejectedValueOnce(new Error("provider down"));

    const result = await findMatchCandidates("lost", 1, 1);

    expect(result).toEqual({ kind: "ai_unavailable" });
  });

  it("works symmetrically for a FoundPost source (candidates come from LostPost)", async () => {
    foundPost.findUnique.mockResolvedValueOnce(post({ userId: 1 }));
    lostPost.findMany.mockResolvedValueOnce([]);

    const result = await findMatchCandidates("found", 1, 1);

    expect(result).toEqual({ kind: "ok", data: [] });
    expect(lostPost.findMany).toHaveBeenCalled();
  });
});
