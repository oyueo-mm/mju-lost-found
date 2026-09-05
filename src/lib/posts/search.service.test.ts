import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findMany: vi.fn(), count: vi.fn() };
const foundPost = { findMany: vi.fn(), count: vi.fn() };
// Phase 12: semantic search's two collaborators, mocked wholesale --
// never loading the real ~106MB model or issuing a real $queryRaw in this
// fast unit-test suite, same convention as postEmbedding's own tests.
const embed = vi.fn();
const findPostsBySemanticQuery = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("@/generated/prisma/client", () => ({
  LostPostStatus: { SEARCHING: "SEARCHING", FOUND: "FOUND" },
  FoundPostStatus: { KEEPING: "KEEPING", COMPLETED: "COMPLETED" },
}));
vi.mock("@/lib/ai/embedding", () => ({ getEmbeddingProvider: () => ({ embed }) }));
vi.mock("@/lib/ai/vectorSearch", () => ({ findPostsBySemanticQuery }));

const { listLostPosts, listFoundPosts, searchPosts } = await import("./service");

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: "지갑을 잃어버렸어요",
    description: "검은색 가죽 지갑",
    category: "지갑",
    location: "학생회관",
    status: "SEARCHING",
    imageUrl: null,
    lostAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    user: { id: 1, nickname: "닉네임" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lostPost.findMany.mockResolvedValue([]);
  lostPost.count.mockResolvedValue(0);
  foundPost.findMany.mockResolvedValue([]);
  foundPost.count.mockResolvedValue(0);
});

describe("search logic -- filtering is always done in the DB query, never in JS", () => {
  it("builds a case-insensitive title-OR-description contains filter for q", async () => {
    await listLostPosts({ page: 1, limit: 20, q: "지갑" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { title: { contains: "지갑", mode: "insensitive" } },
            { description: { contains: "지갑", mode: "insensitive" } },
          ],
        }),
      }),
    );
    expect(lostPost.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });

  it("uses an exact match for category", async () => {
    await listLostPosts({ page: 1, limit: 20, category: "전자기기" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: "전자기기" }) }),
    );
  });

  it("uses a case-insensitive contains (partial) match for location", async () => {
    await listFoundPosts({ page: 1, limit: 20, location: "인문캠퍼스" });

    expect(foundPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ location: { contains: "인문캠퍼스", mode: "insensitive" } }),
      }),
    );
  });

  it("filters by createdAt range for dateFrom/dateTo", async () => {
    const dateFrom = new Date("2026-01-01");
    const dateTo = new Date("2026-01-31");

    await listLostPosts({ page: 1, limit: 20, dateFrom, dateTo });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: dateFrom, lte: dateTo } }) }),
    );
  });

  it("combines q, category, and location into a single where clause", async () => {
    await listLostPosts({ page: 1, limit: 20, q: "지갑", category: "지갑", location: "학생회관" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { title: { contains: "지갑", mode: "insensitive" } },
            { description: { contains: "지갑", mode: "insensitive" } },
          ],
          category: "지갑",
          location: { contains: "학생회관", mode: "insensitive" },
        },
      }),
    );
  });

  it("omits filters entirely when none are given -- no accidental over-restriction", async () => {
    await listLostPosts({ page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  // Phase 9: board status filter -- converts the Korean status string to
  // the board's own Prisma enum value (LostPost's "찾는 중"/"찾음" here,
  // FoundPost's separate "보관 중"/"완료" below), never the other board's.
  it("filters LostPost by status, converted to the Prisma enum value", async () => {
    await listLostPosts({ page: 1, limit: 20, status: "찾는 중" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "SEARCHING" }) }),
    );
  });

  it("filters FoundPost by status, converted to its own Prisma enum value", async () => {
    await listFoundPosts({ page: 1, limit: 20, status: "완료" });

    expect(foundPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });

  it("never applies a LostPost status value to a FoundPost query (or vice versa)", async () => {
    // listQuerySchema rejects this combination before it would ever reach
    // the service (see search.schema.test.ts), but this asserts the
    // service layer's own defense: a status string outside the given
    // board's map is simply not applied, never passed through as-is.
    await listFoundPosts({ page: 1, limit: 20, status: "찾는 중" });

    expect(foundPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ status: expect.anything() }) }),
    );
  });

  it("sorts latest (createdAt desc) by default", async () => {
    await listLostPosts({ page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
  });

  it("sorts oldest (createdAt asc) when requested", async () => {
    await listLostPosts({ page: 1, limit: 20, sort: "oldest" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    );
  });
});

describe("pagination", () => {
  it("computes totalPages from total/limit", async () => {
    lostPost.count.mockResolvedValueOnce(45);

    const result = await listLostPosts({ page: 1, limit: 20 });

    expect(result.totalPages).toBe(3);
  });

  it("reports totalPages of 1 even with zero results", async () => {
    const result = await listLostPosts({ page: 1, limit: 20 });
    expect(result.totalPages).toBe(1);
  });

  it("applies skip based on the requested page", async () => {
    await listLostPosts({ page: 2, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });
});

describe("searchPosts (type dispatch, including type=all merge)", () => {
  it("dispatches type=lost to listLostPosts's underlying query", async () => {
    await searchPosts({ type: "lost", page: 1, limit: 20 });
    expect(lostPost.findMany).toHaveBeenCalled();
    expect(foundPost.findMany).not.toHaveBeenCalled();
  });

  it("dispatches type=found to listFoundPosts's underlying query", async () => {
    await searchPosts({ type: "found", page: 1, limit: 20 });
    expect(foundPost.findMany).toHaveBeenCalled();
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("queries both tables for type=all and merges/sorts the results", async () => {
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "lost-old", createdAt: new Date("2026-01-01") }),
    ]);
    foundPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "found-new", createdAt: new Date("2026-01-05") }),
    ]);
    lostPost.count.mockResolvedValueOnce(1);
    foundPost.count.mockResolvedValueOnce(1);

    const result = await searchPosts({ type: "all", page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.items.map((p) => p.title)).toEqual(["found-new", "lost-old"]); // newest first
    expect(result.items[0].type).toBe("found");
    expect(result.items[1].type).toBe("lost");
  });

  it("applies the same filters to both tables in type=all mode", async () => {
    await searchPosts({ type: "all", page: 1, limit: 20, category: "전자기기" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: "전자기기" }) }),
    );
    expect(foundPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: "전자기기" }) }),
    );
  });

  it("never exceeds two distinct numeric ids in the same result set without disambiguating type", async () => {
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1, title: "lost-1" })]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 1, title: "found-1" })]);

    const result = await searchPosts({ type: "all", page: 1, limit: 20 });

    const keys = result.items.map((p) => `${p.type}-${p.id}`);
    expect(new Set(keys).size).toBe(result.items.length); // no collision once type is included
  });
});

// Phase 12: semantic search dispatch through the same searchPosts() entry
// point every caller (the API route, /search) already uses.
describe("searchPosts -- mode=semantic (Phase 12)", () => {
  it("defaults to keyword search when mode is omitted (no regression)", async () => {
    await searchPosts({ type: "lost", page: 1, limit: 20 });

    expect(embed).not.toHaveBeenCalled();
    expect(findPostsBySemanticQuery).not.toHaveBeenCalled();
    expect(lostPost.findMany).toHaveBeenCalled();
  });

  it("computes a query embedding and calls findPostsBySemanticQuery, never the keyword path", async () => {
    embed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    findPostsBySemanticQuery.mockResolvedValueOnce([]);

    await searchPosts({ type: "lost", mode: "semantic", q: "검은색 에어팟", page: 1, limit: 20 });

    expect(embed).toHaveBeenCalledWith("검은색 에어팟");
    expect(findPostsBySemanticQuery).toHaveBeenCalledWith("lost", [0.1, 0.2, 0.3], 10, expect.any(Object));
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("returns matched posts in similarity-ranked order with their score attached", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 2, score: 0.9 },
      { id: 1, score: 0.4 },
    ]);
    // findMany({id:{in:[2,1]}}) -- deliberately returned out of that order,
    // to prove the service re-sorts by the similarity ranking rather than
    // trusting the DB's own row order.
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "지갑 분실" }),
      row({ id: 2, title: "에어팟 분실" }),
    ]);

    // Query text deliberately shares no token with either title -- this
    // test is about row-order independence, not the Phase 13-2 lexical
    // tie-breaker (see the "hard-negative tie-breaker" describe block
    // below for that), so it must not incidentally trigger the bonus.
    const result = await searchPosts({ type: "lost", mode: "semantic", q: "분실물찾아요", page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([2, 1]);
    expect(result.items[0].score).toBeCloseTo(0.9);
    expect(result.items[1].score).toBeCloseTo(0.4);
    expect(result.total).toBe(2);
  });

  it("passes category/status/location/dateFrom/dateTo through to findPostsBySemanticQuery", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([]);
    const dateFrom = new Date("2026-01-01");
    const dateTo = new Date("2026-01-31");

    await searchPosts({
      type: "found",
      mode: "semantic",
      q: "지갑",
      page: 1,
      limit: 20,
      category: "지갑",
      location: "정문",
      status: "보관 중",
      dateFrom,
      dateTo,
    });

    expect(findPostsBySemanticQuery).toHaveBeenCalledWith(
      "found",
      [0.1],
      10,
      expect.objectContaining({ category: "지갑", location: "정문", status: "보관 중", dateFrom, dateTo }),
    );
  });

  it("returns an empty page (not an error) when nothing matches", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([]);

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "존재하지않는물건", page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    expect(lostPost.findMany).not.toHaveBeenCalled(); // no point fetching rows for zero ids
  });

  it("propagates an embedding provider failure instead of silently returning an empty result", async () => {
    embed.mockRejectedValueOnce(new Error("model unavailable"));

    await expect(
      searchPosts({ type: "lost", mode: "semantic", q: "에어팟", page: 1, limit: 20 }),
    ).rejects.toThrow("model unavailable");
  });

  it("drops a result whose post was deleted between the vector search and the row fetch, without erroring", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 1, score: 0.9 },
      { id: 2, score: 0.5 }, // this one will "not be found" below
    ]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 })]); // id 2 missing

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "에어팟", page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([1]);
    expect(result.total).toBe(1);
  });
});

// Phase 13-2: a real, reproduced hard-negative failure from Phase 13-1's
// real-DB evaluation (real ONNX model + real Supabase pgvector, not
// hypothetical) -- "카드지갑 분실" (a wallet post whose *description*
// happens to mention "학생증") outscored the actual "학생증 분실1" post for
// the query "학생증 잃어버렸어요", 0.912 vs 0.893. These tests use the same
// scores/titles, but via a mocked findPostsBySemanticQuery/findMany (no
// real model load), matching this file's existing convention.
describe("searchPosts -- semantic hard-negative tie-breaker (Phase 13-2)", () => {
  it("promotes a title-matching near-tie candidate above a higher-raw-score decoy that only matches in its description", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 2, score: 0.912 }, // "카드지갑 분실" -- raw semantic winner
      { id: 1, score: 0.893 }, // "학생증 분실1" -- the actual correct answer
    ]);
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "학생증 분실1", description: "학생증을 정문에서 잃어버렸어요" }),
      row({ id: 2, title: "카드지갑 분실", description: "카드지갑을 잃어버렸습니다. 학생증이 들어있어요" }),
    ]);

    const result = await searchPosts({
      type: "lost",
      mode: "semantic",
      q: "학생증 잃어버렸어요",
      page: 1,
      limit: 20,
    });

    // Title "학생증 분실1" contains the query token "학생증"; title "카드지갑
    // 분실" does not (only its description does) -- so only id=1 gets the
    // bonus, closing the 0.019 gap and taking rank 1.
    expect(result.items.map((p) => p.id)).toEqual([1, 2]);
    expect(result.items[0].score).toBeCloseTo(0.893 + 0.03);
    expect(result.items[1].score).toBeCloseTo(0.912); // decoy's score is untouched
  });

  it("does not override a real semantic gap just because a lower-ranked title happens to match", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 1, score: 0.95 }, // clearly the best semantic match, title doesn't match query tokens
      { id: 2, score: 0.6 }, // far behind, but its title literally contains a query token
    ]);
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "무선 이어폰 분실", description: "회색 무선 이어폰을 잃어버렸습니다" }),
      row({ id: 2, title: "학생증 지갑", description: "지갑을 주웠는데 안에 아무것도 없어요" }),
    ]);

    const result = await searchPosts({
      type: "lost",
      mode: "semantic",
      q: "학생증 잃어버렸어요",
      page: 1,
      limit: 20,
    });

    // 0.6 + 0.03 bonus (0.63) is still nowhere close to 0.95 -- the bonus
    // is a tie-breaker, not a general keyword override.
    expect(result.items.map((p) => p.id)).toEqual([1, 2]);
  });

  it("leaves ranking unchanged when neither title matches a query token", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 2, score: 0.7 },
      { id: 1, score: 0.6 },
    ]);
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "지갑 분실", description: "갈색 지갑을 잃어버렸어요" }),
      row({ id: 2, title: "가방 분실", description: "백팩을 잃어버렸어요" }),
    ]);

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "학생증", page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([2, 1]);
    expect(result.items[0].score).toBeCloseTo(0.7);
    expect(result.items[1].score).toBeCloseTo(0.6);
  });
});
