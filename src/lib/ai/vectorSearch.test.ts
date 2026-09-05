import { beforeEach, describe, expect, it, vi } from "vitest";

const $queryRaw = vi.fn();
const $executeRaw = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, $executeRaw } }));

const { findSimilarPosts, findPostsBySemanticQuery, saveEmbedding, EmbeddingNotAvailableError } =
  await import("./vectorSearch");

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

// Phase 12: free-text semantic search. Unlike findSimilarPosts()'s
// tagged-template calls (call = [stringsArray, ...boundValues]), this
// function calls $queryRaw(Prisma.sql`...`) -- a single Prisma.Sql
// argument whose own .values/.sql getters are the real, un-mocked
// Prisma.sql/join/raw output (only @/lib/db/prisma is mocked in this
// file, not @/generated/prisma/client), so these assertions inspect that
// object directly rather than a tagged-template call shape.
describe("findPostsBySemanticQuery", () => {
  it("searches LostPost (parameterized) for type=lost, excluding NULL embeddings", async () => {
    $queryRaw.mockResolvedValueOnce([{ id: 7, similarity: 0.5 }]);

    const results = await findPostsBySemanticQuery("lost", [0.1, 0.2, 0.3], 10);

    expect(results).toEqual([{ id: 7, score: expect.closeTo((0.5 + 1) / 2, 5) }]);
    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toContain('FROM "LostPost"');
    expect(sqlArg.sql).toContain("embedding IS NOT NULL");
    expect(sqlArg.sql).toContain("ORDER BY embedding <=>");
    // The query vector literal and topK are bound values, not spliced into
    // the SQL text -- proof this isn't string concatenation.
    expect(sqlArg.values).toContain("[0.1,0.2,0.3]");
    expect(sqlArg.values).toContain(10);
    expect(sqlArg.sql).not.toContain("0.1,0.2,0.3");
  });

  it("searches FoundPost for type=found", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findPostsBySemanticQuery("found", [0.4], 5);

    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toContain('FROM "FoundPost"');
  });

  it("orders by cosine distance ascending with an id tiebreaker for stable pagination", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findPostsBySemanticQuery("lost", [0.1], 10);

    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toMatch(/ORDER BY embedding <=> .*?, id/);
  });

  it("binds topK as LIMIT, never a different value", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findPostsBySemanticQuery("lost", [0.1], 3);

    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toContain("LIMIT");
    expect(sqlArg.values.at(-1)).toBe(3);
  });

  it("converts cosine similarity to the same 0-1 scale as findSimilarPosts", async () => {
    $queryRaw.mockResolvedValueOnce([
      { id: 1, similarity: 1 },
      { id: 2, similarity: 0 },
      { id: 3, similarity: -1 },
    ]);

    const results = await findPostsBySemanticQuery("lost", [0.1], 3);

    expect(results.map((r) => r.score)).toEqual([
      expect.closeTo(1, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(0, 5),
    ]);
  });

  it("returns an empty array (not an error) when nothing matches", async () => {
    $queryRaw.mockResolvedValueOnce([]);
    expect(await findPostsBySemanticQuery("lost", [0.1], 10)).toEqual([]);
  });

  describe("filters", () => {
    it("applies a category filter as a bound parameter", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("lost", [0.1], 10, { category: "지갑" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain("category =");
      expect(sqlArg.values).toContain("지갑");
    });

    it("applies a location filter as a case-insensitive contains, bound not spliced", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("lost", [0.1], 10, { location: "학생회관" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain("location ILIKE");
      expect(sqlArg.values).toContain("%학생회관%");
    });

    it("applies a status filter cast to the board's own Postgres enum type", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("lost", [0.1], 10, { status: "찾는 중" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain('::"LostPostStatus"');
      expect(sqlArg.values).toContain("찾는 중");
    });

    it("casts a FoundPost status filter to FoundPostStatus, not LostPostStatus", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("found", [0.1], 10, { status: "완료" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain('::"FoundPostStatus"');
      expect(sqlArg.sql).not.toContain('::"LostPostStatus"');
    });

    it("applies dateFrom/dateTo as bound createdAt range parameters", async () => {
      $queryRaw.mockResolvedValueOnce([]);
      const dateFrom = new Date("2026-01-01");
      const dateTo = new Date("2026-01-31");

      await findPostsBySemanticQuery("lost", [0.1], 10, { dateFrom, dateTo });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain("created_at >=");
      expect(sqlArg.sql).toContain("created_at <=");
      expect(sqlArg.values).toContain(dateFrom);
      expect(sqlArg.values).toContain(dateTo);
    });

    it("combines multiple filters in the same query (AND), all still bound", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("found", [0.1], 10, { category: "지갑", location: "정문", status: "보관 중" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain(" AND ");
      expect(sqlArg.values).toEqual(
        expect.arrayContaining(["[0.1]", "지갑", "%정문%", "보관 중", 10]),
      );
    });

    it("always excludes NULL-embedding posts regardless of other filters", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("lost", [0.1], 10, { category: "지갑" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain("embedding IS NOT NULL");
    });
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
