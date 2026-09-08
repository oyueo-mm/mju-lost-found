import { beforeEach, describe, expect, it, vi } from "vitest";

const $queryRaw = vi.fn();
const $executeRaw = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, $executeRaw } }));

const {
  findSimilarPosts,
  findPostsBySemanticQuery,
  saveEmbedding,
  EmbeddingNotAvailableError,
  findSimilarPostsByImage,
  saveImageEmbedding,
  findPostsByImageQuery,
} = await import("./vectorSearch");

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

  // Phase O-2: a completed/closed post is a real answer already, not a
  // useful recommendation -- excluded from the candidate query itself
  // (never a post-hoc JS filter, same reasoning as the NULL-embedding
  // exclusion above).
  it("excludes completed FoundPost candidates when the source is a LostPost", async () => {
    $queryRaw
      .mockResolvedValueOnce([]) // main search: no rows
      .mockResolvedValueOnce([{ present: true }]); // hasEmbedding check: source has one, so this is a real (filtered) empty result

    await findSimilarPosts("lost", 1, 5);

    const [call] = $queryRaw.mock.calls[0];
    const sqlText = (call as TemplateStringsArray).join("?");
    expect(sqlText).toContain(`fp.status != '완료'::"FoundPostStatus"`);
  });

  it("excludes found (matched) LostPost candidates when the source is a FoundPost", async () => {
    $queryRaw
      .mockResolvedValueOnce([]) // main search: no rows
      .mockResolvedValueOnce([{ present: true }]); // hasEmbedding check: source has one, so this is a real (filtered) empty result

    await findSimilarPosts("found", 3, 5);

    const [call] = $queryRaw.mock.calls[0];
    const sqlText = (call as TemplateStringsArray).join("?");
    expect(sqlText).toContain(`lp.status != '찾음'::"LostPostStatus"`);
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

    it("applies a campus filter as a bound exact-match parameter (replaces the old location ILIKE filter)", async () => {
      $queryRaw.mockResolvedValueOnce([]);

      await findPostsBySemanticQuery("lost", [0.1], 10, { campus: "인문캠퍼스" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain("campus =");
      expect(sqlArg.values).toContain("인문캠퍼스");
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

      await findPostsBySemanticQuery("found", [0.1], 10, { category: "지갑", campus: "인문캠퍼스", status: "보관 중" });

      const [sqlArg] = $queryRaw.mock.calls[0];
      expect(sqlArg.sql).toContain(" AND ");
      expect(sqlArg.values).toEqual(
        expect.arrayContaining(["[0.1]", "지갑", "인문캠퍼스", "보관 중", 10]),
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

// Phase 32: image search's counterpart to findPostsBySemanticQuery -- same
// shape, `imageEmbedding` in place of `embedding`, so this mirrors that
// suite's own coverage rather than re-deriving it.
describe("findPostsByImageQuery", () => {
  it("searches LostPost (parameterized) for targetType=lost, excluding NULL imageEmbeddings", async () => {
    $queryRaw.mockResolvedValueOnce([{ id: 7, similarity: 0.5 }]);

    const results = await findPostsByImageQuery("lost", [0.1, 0.2, 0.3], 10);

    expect(results).toEqual([{ id: 7, score: expect.closeTo((0.5 + 1) / 2, 5) }]);
    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toContain('FROM "LostPost"');
    expect(sqlArg.sql).toContain('"imageEmbedding" IS NOT NULL');
    expect(sqlArg.sql).toContain('ORDER BY "imageEmbedding" <=>');
    expect(sqlArg.values).toContain("[0.1,0.2,0.3]");
    expect(sqlArg.values).toContain(10);
    expect(sqlArg.sql).not.toContain("0.1,0.2,0.3");
  });

  it("searches FoundPost for targetType=found", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findPostsByImageQuery("found", [0.4], 5);

    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toContain('FROM "FoundPost"');
  });

  it("orders by cosine distance ascending with an id tiebreaker for stable pagination", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findPostsByImageQuery("lost", [0.1], 10);

    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toMatch(/ORDER BY "imageEmbedding" <=> .*?, id/);
  });

  it("converts cosine similarity to the same 0-1 scale as findPostsBySemanticQuery", async () => {
    $queryRaw.mockResolvedValueOnce([
      { id: 1, similarity: 1 },
      { id: 2, similarity: 0 },
    ]);

    const results = await findPostsByImageQuery("lost", [0.1], 3);

    expect(results.map((r) => r.score)).toEqual([expect.closeTo(1, 5), expect.closeTo(0.5, 5)]);
  });

  it("returns an empty array (not an error) when nothing matches", async () => {
    $queryRaw.mockResolvedValueOnce([]);
    expect(await findPostsByImageQuery("lost", [0.1], 10)).toEqual([]);
  });

  it("applies category/campus/status/dateFrom/dateTo filters the same way findPostsBySemanticQuery does", async () => {
    $queryRaw.mockResolvedValueOnce([]);
    const dateFrom = new Date("2026-01-01");
    const dateTo = new Date("2026-01-31");

    await findPostsByImageQuery("found", [0.1], 10, {
      category: "지갑",
      campus: "인문캠퍼스",
      status: "보관 중",
      dateFrom,
      dateTo,
    });

    const [sqlArg] = $queryRaw.mock.calls[0];
    expect(sqlArg.sql).toContain(" AND ");
    expect(sqlArg.values).toEqual(
      expect.arrayContaining(["지갑", "인문캠퍼스", "보관 중", dateFrom, dateTo]),
    );
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

// Phase 15-2: image similarity search. Mirrors findSimilarPosts()'s own
// test suite -- same cross-board CTE shape, `imageEmbedding` column in
// place of `embedding`, same normalizeScore() conversion.
describe("findSimilarPostsByImage", () => {
  it("searches FoundPost.imageEmbedding (parameterized) when the source is a LostPost", async () => {
    $queryRaw.mockResolvedValueOnce([{ id: 5, similarity: 0.6 }]);

    const results = await findSimilarPostsByImage("lost", 1, 10);

    expect(results).toEqual([{ id: 5, score: expect.closeTo((0.6 + 1) / 2, 5) }]);
    const [call] = $queryRaw.mock.calls;
    expect(boundValues(call)).toEqual([1, 10]); // [sourcePostId, topK]
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('FROM "FoundPost"');
    expect(sqlText).toContain('"imageEmbedding"');
    expect(sqlText).not.toContain(" embedding "); // never the text column
  });

  it("searches LostPost.imageEmbedding when the source is a FoundPost", async () => {
    $queryRaw.mockResolvedValueOnce([{ id: 9, similarity: 0.2 }]);

    await findSimilarPostsByImage("found", 3, 10);

    const [call] = $queryRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('FROM "LostPost"');
  });

  it("excludes rows (both source and candidate) with a NULL imageEmbedding", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    const results = await findSimilarPostsByImage("lost", 1, 10);

    expect(results).toEqual([]);
    const [call] = $queryRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('"imageEmbedding" IS NOT NULL');
  });

  it("returns an empty array (not a thrown error) when the source post has no imageEmbedding yet", async () => {
    // Unlike findSimilarPosts(), there is no EmbeddingNotAvailableError
    // disambiguation here -- the caller already knows whether the post has
    // an image before ever calling this (see post/[id]/page.tsx).
    $queryRaw.mockResolvedValueOnce([]);

    await expect(findSimilarPostsByImage("lost", 1, 10)).resolves.toEqual([]);
  });

  it("respects the topK limit", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findSimilarPostsByImage("lost", 1, 4);

    const [call] = $queryRaw.mock.calls;
    expect(boundValues(call)).toEqual([1, 4]);
  });

  // Phase O-2: same completed/closed exclusion as findSimilarPosts() above,
  // applied to the image-similarity candidate query too.
  it("excludes completed FoundPost candidates when the source is a LostPost", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findSimilarPostsByImage("lost", 1, 10);

    const [call] = $queryRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain(`fp.status != '완료'::"FoundPostStatus"`);
  });

  it("excludes found (matched) LostPost candidates when the source is a FoundPost", async () => {
    $queryRaw.mockResolvedValueOnce([]);

    await findSimilarPostsByImage("found", 3, 10);

    const [call] = $queryRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain(`lp.status != '찾음'::"LostPostStatus"`);
  });
});

describe("saveImageEmbedding", () => {
  it("writes a vector to LostPost.imageEmbedding", async () => {
    await saveImageEmbedding("lost", 1, [0.1, 0.2, 0.3]);

    const [call] = $executeRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('UPDATE "LostPost"');
    expect(sqlText).toContain('"imageEmbedding"');
    expect(boundValues(call)).toEqual(["[0.1,0.2,0.3]", 1]);
  });

  it("writes a vector to FoundPost.imageEmbedding", async () => {
    await saveImageEmbedding("found", 2, [0.5]);

    const [call] = $executeRaw.mock.calls;
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain('UPDATE "FoundPost"');
    expect(sqlText).toContain('"imageEmbedding"');
  });

  it("clears an image embedding (null) instead of writing a vector literal", async () => {
    await saveImageEmbedding("lost", 1, null);

    const [call] = $executeRaw.mock.calls;
    expect(boundValues(call)).toEqual([null, 1]);
  });
});
