import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostDTO } from "./service";

const { keyword, meaning, record } = vi.hoisted(() => ({ keyword: vi.fn(), meaning: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/images/supabaseAdmin", () => ({ deleteObjectSafely: vi.fn() }));
vi.mock("./service", async (original) => ({ ...await original<typeof import("./service")>(), searchPosts: keyword }));
vi.mock("./aiService", () => ({ searchTextCandidatesForFusion: meaning }));
vi.mock("@/lib/metrics/record", () => ({ recordDaily: record }));
const { searchUnifiedPosts } = await import("./unifiedSearch");
const q = "어제 도서관에서 검은색 반지갑을 잃어버렸어요";
const post = (id: number, type = "found", fields = {}) => ({
  id, type, title: `Post ${id}`, description: "wallet", createdAt: new Date(2026, 0, id), updatedAt: new Date(2026, 0, id), viewCount: id, commentCount: 10 - id, ...fields,
}) as PostDTO;
const pageOf = (items: PostDTO[], total = items.length) => ({ items, total, page: 1, limit: 100, totalPages: Math.max(1, Math.ceil(total / 100)) });

beforeEach(() => {
  vi.clearAllMocks();
  keyword.mockResolvedValue(pageOf([post(1), post(2), post(3)]));
  meaning.mockResolvedValue([post(2, "found", { score: 0.9 }), post(3), post(4)]);
});

describe("unified search orchestration", () => {
  it("runs semantic search only after a short query has zero total, sharing filters and pagination", async () => {
    keyword.mockResolvedValue({ ...pageOf([]), page: 2, limit: 2 });
    const allowSemantic = vi.fn(async () => {
      expect(keyword).toHaveBeenCalledOnce();
      return true;
    });
    const filters = { categoryCode: "stationery", campus: "인문캠퍼스", status: "보관 중", eventFrom: new Date("2026-09-01") };
    const result = await searchUnifiedPosts({ type: "found", q: "핑크색 무언가", page: 2, limit: 2, ...filters }, { allowSemantic });
    expect(result).toMatchObject({ total: 3, totalPages: 2, page: 2, search: { strategy: "semantic-fallback", limited: false } });
    expect(result.items.map((item) => item.id)).toEqual([4]);
    expect(result.items[0].score).toBeUndefined();
    expect(meaning).toHaveBeenCalledWith("found", "핑크색 무언가", expect.objectContaining(filters));
    expect(allowSemantic).toHaveBeenCalledOnce();
    expect(keyword).toHaveBeenCalledOnce();
  });
  it("does not charge the AI limiter for keyword hits or an empty page of an existing query", async () => {
    keyword.mockResolvedValue({ ...pageOf([], 20), page: 100, limit: 2 });
    const allowSemantic = vi.fn();
    const result = await searchUnifiedPosts({ type: "found", q: "지갑", page: 100, limit: 2 }, { allowSemantic });
    expect(result.search.strategy).toBe("keyword");
    expect(allowSemantic).not.toHaveBeenCalled();
    expect(meaning).not.toHaveBeenCalled();
  });
  it.each([false, "error"])("keeps a short keyword miss usable when AI is denied/unavailable: %s", async (decision) => {
    keyword.mockResolvedValue({ ...pageOf([]), limit: 20 });
    const allowSemantic = vi.fn(async () => { if (decision === "error") throw new Error("limiter unavailable"); return false; });
    expect(await searchUnifiedPosts({ type: "found", q: "핑크색 무언가", page: 1, limit: 20 }, { allowSemantic })).toMatchObject({ items: [], total: 0, search: { strategy: "keyword-fallback" } });
    expect(meaning).not.toHaveBeenCalled();
    expect(keyword).toHaveBeenCalledOnce();
  });
  it("returns the original empty keyword result when semantic fallback fails", async () => {
    keyword.mockResolvedValue({ ...pageOf([]), limit: 20 });
    meaning.mockRejectedValue(new Error("inference unavailable"));
    const result = await searchUnifiedPosts({ type: "found", q: "핑크색 무언가", page: 1, limit: 20 });
    expect(result).toMatchObject({ items: [], total: 0, totalPages: 1, search: { strategy: "keyword-fallback" } });
    expect(keyword).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
  });
  it("does not infer on a blank browse even when no posts exist", async () => {
    keyword.mockResolvedValue(pageOf([]));
    const allowSemantic = vi.fn();
    await searchUnifiedPosts({ type: "found", q: "  ", page: 1, limit: 20 }, { allowSemantic });
    expect(meaning).not.toHaveBeenCalled();
    expect(allowSemantic).not.toHaveBeenCalled();
  });
  it.each(["latest", "oldest", "views", "comments"] as const)("sorts the semantic fallback by explicit %s", async (sort) => {
    keyword.mockResolvedValue(pageOf([]));
    const result = await searchUnifiedPosts({ type: "found", q: "핑크색 무언가", page: 1, limit: 20, sort });
    expect(result.items.map((item) => item.id)).toEqual(sort === "oldest" || sort === "comments" ? [2, 3, 4] : [4, 3, 2]);
  });
  it("returns unchanged keyword pagination without any semantic work for short queries", async () => {
    const existing = { ...pageOf([post(1)], 33), page: 2, limit: 2, totalPages: 17 };
    keyword.mockResolvedValue(existing);
    expect(await searchUnifiedPosts({ type: "found", q: "검은색 지갑", page: 2, limit: 2 })).toMatchObject(existing);
    expect(meaning).not.toHaveBeenCalled();
    expect(keyword).toHaveBeenCalledOnce();
  });
  it("fuses before slicing, counts unique posts and never exposes an RRF percentage", async () => {
    const first = await searchUnifiedPosts({ type: "found", q, page: 1, limit: 2 });
    const second = await searchUnifiedPosts({ type: "found", q, page: 2, limit: 2 });
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual([2, 3, 1, 4]);
    expect(first).toMatchObject({ total: 4, totalPages: 2, search: { strategy: "hybrid", limited: false } });
    expect(first.items.every((item) => item.score === undefined)).toBe(true);
    expect(keyword.mock.calls.every(([input]) => input.page === 1 && input.limit === 100)).toBe(true);
    expect(record).toHaveBeenCalledOnce();
  });
  it("keeps lost and found posts with overlapping table ids", async () => {
    keyword.mockResolvedValue(pageOf([post(1, "lost")]));
    meaning.mockResolvedValue([post(1, "found")]);
    const result = await searchUnifiedPosts({ type: "all", q, page: 1, limit: 20 });
    expect(result.total).toBe(2);
    expect(new Set(result.items.map((item) => `${item.type}:${item.id}`)).size).toBe(2);
  });
  it.each(["latest", "oldest", "views", "comments"] as const)("respects explicit %s across the union", async (sort) => {
    const result = await searchUnifiedPosts({ type: "found", q, page: 1, limit: 20, sort });
    expect(result.items.map((item) => item.id)).toEqual(sort === "oldest" || sort === "comments" ? [1, 2, 3, 4] : [4, 3, 2, 1]);
    expect(keyword).toHaveBeenCalledWith(expect.objectContaining({ sort }));
  });
  it("passes identical filters to both sources and reports a bounded candidate union", async () => {
    const eventFrom = new Date("2026-11-01");
    keyword.mockResolvedValue(pageOf([post(1)], 500));
    const filters = { categoryCode: "wallet", subcategory: "wallet_fold", campus: "인문캠퍼스", status: "보관 중", eventFrom, includeUnknownEventTime: true };
    const result = await searchUnifiedPosts({ type: "found", q, page: 1, limit: 20, ...filters });
    expect(keyword).toHaveBeenCalledWith(expect.objectContaining(filters));
    expect(meaning).toHaveBeenCalledWith("found", q, expect.objectContaining(filters));
    expect(result.search.limited).toBe(true);
  });
  it("falls back to the full keyword count on AI failure, without a redundant page query", async () => {
    keyword.mockResolvedValue(pageOf([post(1), post(2), post(3), post(4)], 140));
    meaning.mockRejectedValue(new Error("unavailable"));
    const result = await searchUnifiedPosts({ type: "found", q, page: 2, limit: 2 });
    expect(result.items.map((item) => item.id)).toEqual([3, 4]);
    expect(result).toMatchObject({ total: 140, totalPages: 70, search: { strategy: "keyword-fallback", limited: false } });
    expect(keyword).toHaveBeenCalledOnce();
  });
  it("fetches the actual keyword page when a failure occurs beyond the candidate window", async () => {
    keyword.mockResolvedValueOnce(pageOf([post(1)], 140)).mockResolvedValueOnce({ ...pageOf([post(90)], 140), page: 6, limit: 20, totalPages: 7 });
    meaning.mockRejectedValue(new Error("unavailable"));
    const result = await searchUnifiedPosts({ type: "found", q, page: 6, limit: 20 });
    expect(result.items[0].id).toBe(90);
    expect(keyword).toHaveBeenLastCalledWith({ type: "found", q, page: 6, limit: 20 });
  });
  it("does not run inference when the API rate limit disables the semantic branch", async () => {
    const result = await searchUnifiedPosts({ type: "found", q, page: 1, limit: 20 }, { disableSemantic: true });
    expect(result.search.strategy).toBe("keyword-fallback");
    expect(meaning).not.toHaveBeenCalled();
  });
  it("returns a consistent empty result", async () => {
    keyword.mockResolvedValue(pageOf([])); meaning.mockResolvedValue([]);
    expect(await searchUnifiedPosts({ type: "found", q, page: 1, limit: 20 })).toMatchObject({ items: [], total: 0, totalPages: 1 });
  });
});
