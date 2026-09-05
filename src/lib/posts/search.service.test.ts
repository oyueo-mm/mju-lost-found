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

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "에어팟", page: 1, limit: 20 });

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
