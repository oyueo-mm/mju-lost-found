import { beforeEach, describe, expect, it, vi } from "vitest";

const $queryRaw = vi.fn();
const $executeRaw = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, $executeRaw } }));

const { findSimilarPosts, saveEmbedding, EmbeddingNotAvailableError } = await import("./vectorSearch");

beforeEach(() => {
  vi.clearAllMocks();
});

// Tagged-template calls land as (stringsArray, ...boundValues) -- these
// helpers pull out just the bound values, which is what actually matters
// for SQL-injection safety (they're parameters, never concatenated into
// the string) and for asserting the right ids/limits were used.
function boundValues(call: unknown[]): unknown[] {
  return call.slice(1);
}

describe("findSimilarPosts", () => {
  it("searches FoundPost (parameterized) when the source is a LostPost", async () => {
    $queryRaw.mockResolvedValueOnce([{ id: 5, similarity: 0.6 }]);

    const results = await findSimilarPosts("lost", 1, 5);

    expect(results).toEqual([{ id: 5, score: expect.closeTo((0.6 + 1) / 2, 5) }]);
    const [call] = $queryRaw.mock.calls;
    expect(boundValues(call)).toEqual([1, 5]); // [sourcePostId, topK] -- both parameterized, never interpolated
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('FROM "FoundPost"');
    expect(sqlText).toContain('"LostPost"'); // the CTE looks up the source there
  });

  it("searches LostPost when the source is a FoundPost", async () => {
    $queryRaw.mockResolvedValueOnce([{ id: 9, similarity: 0.2 }]);

    await findSimilarPosts("found", 3, 5);

    const [call] = $queryRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('FROM "LostPost"');
    expect(sqlText).toContain('"FoundPost"');
  });

  it("converts pgvector cosine distance to the same 0-1 scale as the old brute-force scorer", async () => {
    $queryRaw.mockResolvedValueOnce([
      { id: 1, similarity: 1 }, // identical -> normalizeScore(1) = 1
      { id: 2, similarity: 0 }, // orthogonal -> normalizeScore(0) = 0.5
      { id: 3, similarity: -1 }, // opposite -> normalizeScore(-1) = 0
    ]);

    const results = await findSimilarPosts("lost", 1, 3);

    expect(results.map((r) => r.score)).toEqual([
      expect.closeTo(1, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(0, 5),
    ]);
  });

  it("returns an empty array (not an error) when the source has an embedding but genuinely no candidates match", async () => {
    $queryRaw
      .mockResolvedValueOnce([]) // main search: no rows
      .mockResolvedValueOnce([{ present: true }]); // hasEmbedding check: source does have one

    const results = await findSimilarPosts("lost", 1, 5);

    expect(results).toEqual([]);
  });

  it("throws EmbeddingNotAvailableError when the source post itself has no embedding yet", async () => {
    $queryRaw
      .mockResolvedValueOnce([]) // main search: no rows (the cross join with a null-embedding source yields none)
      .mockResolvedValueOnce([{ present: false }]); // hasEmbedding check: confirms why

    await expect(findSimilarPosts("lost", 1, 5)).rejects.toThrow(EmbeddingNotAvailableError);
  });
});

describe("saveEmbedding", () => {
  it("writes a vector to LostPost", async () => {
    await saveEmbedding("lost", 1, [0.1, 0.2, 0.3]);

    const [call] = $executeRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('UPDATE "LostPost"');
    expect(boundValues(call)).toEqual(["[0.1,0.2,0.3]", 1]);
  });

  it("writes a vector to FoundPost", async () => {
    await saveEmbedding("found", 2, [0.5]);

    const [call] = $executeRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('UPDATE "FoundPost"');
  });

  it("clears an embedding (null) instead of writing a vector literal", async () => {
    await saveEmbedding("lost", 1, null);

    const [call] = $executeRaw.mock.calls;
    expect(boundValues(call)).toEqual([null, 1]);
  });
});
