import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findMany: vi.fn(), count: vi.fn() };
const foundPost = { findMany: vi.fn(), count: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));
vi.mock("@/generated/prisma/client", () => ({
  LostPostStatus: { SEARCHING: "SEARCHING", FOUND: "FOUND" },
  FoundPostStatus: { KEEPING: "KEEPING", COMPLETED: "COMPLETED" },
}));

// Phase 21: mode=semantic dispatch and findSimilarPostsByImageForDisplay
// moved to ./aiService (see that module's own test file for their
// coverage) -- this file now only covers ./service's plain (keyword-only)
// searchPosts, which has no @/lib/ai/* dependency at all any more.
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

  it("uses an exact match for campus (replaces the old free-text location filter)", async () => {
    await listFoundPosts({ page: 1, limit: 20, campus: "인문캠퍼스" });

    expect(foundPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ campus: "인문캠퍼스" }) }),
    );
  });

  // 기간 검색 필터 (분실/습득 시점 기준): lostAt / foundAt, never createdAt.
  describe("event-time period filter", () => {
    const eventFrom = new Date("2026-08-31T15:00:00.000Z");
    const eventTo = new Date("2026-09-15T14:59:59.999Z");

    it("filters LostPost by lostAt and excludes unknown (null) times by default", async () => {
      await listLostPosts({ page: 1, limit: 20, eventFrom, eventTo });

      const where = lostPost.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([{ lostAt: { gte: eventFrom, lte: eventTo } }]);
      expect(where).not.toHaveProperty("createdAt");
      expect(JSON.stringify(where)).not.toContain("foundAt");
    });

    it("filters FoundPost by foundAt", async () => {
      await listFoundPosts({ page: 1, limit: 20, eventFrom, eventTo });

      expect(foundPost.findMany.mock.calls[0][0].where.AND).toEqual([{ foundAt: { gte: eventFrom, lte: eventTo } }]);
    });

    it("adds unknown (null) times only when includeUnknownEventTime is on -- never via createdAt", async () => {
      await listLostPosts({ page: 1, limit: 20, eventFrom, eventTo, includeUnknownEventTime: true });

      const where = lostPost.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([{ OR: [{ lostAt: { gte: eventFrom, lte: eventTo } }, { lostAt: null }] }]);
      expect(JSON.stringify(where)).not.toContain("createdAt");
    });

    it("supports an open-ended range", async () => {
      await listLostPosts({ page: 1, limit: 20, eventFrom });

      expect(lostPost.findMany.mock.calls[0][0].where.AND).toEqual([{ lostAt: { gte: eventFrom } }]);
    });

    it("keeps the text search OR intact alongside the period (AND)", async () => {
      await listLostPosts({ page: 1, limit: 20, q: "지갑", eventFrom, eventTo, includeUnknownEventTime: true });

      const where = lostPost.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { title: { contains: "지갑", mode: "insensitive" } },
        { description: { contains: "지갑", mode: "insensitive" } },
      ]);
      expect(where.AND).toHaveLength(1);
    });

    it("type=all filters each board by its own field, in both the rows and the counts", async () => {
      lostPost.findMany.mockResolvedValueOnce([]);
      foundPost.findMany.mockResolvedValueOnce([]);
      lostPost.count.mockResolvedValueOnce(0);
      foundPost.count.mockResolvedValueOnce(0);

      await searchPosts({ type: "all", page: 1, limit: 20, eventFrom, eventTo });

      expect(lostPost.findMany.mock.calls[0][0].where.AND).toEqual([{ lostAt: { gte: eventFrom, lte: eventTo } }]);
      expect(foundPost.findMany.mock.calls[0][0].where.AND).toEqual([{ foundAt: { gte: eventFrom, lte: eventTo } }]);
      expect(lostPost.count.mock.calls[0][0].where.AND).toEqual([{ lostAt: { gte: eventFrom, lte: eventTo } }]);
      expect(foundPost.count.mock.calls[0][0].where.AND).toEqual([{ foundAt: { gte: eventFrom, lte: eventTo } }]);
    });

    it("adds no time condition without a range", async () => {
      await listLostPosts({ page: 1, limit: 20, includeUnknownEventTime: true });

      expect(lostPost.findMany.mock.calls[0][0].where).not.toHaveProperty("AND");
    });
  });

  it("combines q, category, and campus into a single where clause", async () => {
    await listLostPosts({ page: 1, limit: 20, q: "지갑", category: "지갑", campus: "인문캠퍼스" });

    expect(lostPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { title: { contains: "지갑", mode: "insensitive" } },
            { description: { contains: "지갑", mode: "insensitive" } },
          ],
          category: "지갑",
          campus: "인문캠퍼스",
          tempHiddenAt: null,
          removedAt: null,
        },
      }),
    );
  });

  it("omits filters entirely when none are given -- no accidental over-restriction", async () => {
    await listLostPosts({ page: 1, limit: 20 });

    // Only the always-on "not temporarily hidden" condition.
    expect(lostPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tempHiddenAt: null, removedAt: null } }));
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
