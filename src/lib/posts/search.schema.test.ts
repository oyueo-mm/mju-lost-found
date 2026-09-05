import { describe, expect, it } from "vitest";

import { listQuerySchema, MAX_LIMIT, MAX_SEARCH_QUERY_LENGTH } from "./schema";

describe("listQuerySchema -- search/filter fields", () => {
  it("accepts a bare type with no filters", () => {
    const result = listQuerySchema.safeParse({ type: "lost" });
    expect(result.success).toBe(true);
  });

  it("accepts type=all", () => {
    expect(listQuerySchema.safeParse({ type: "all" }).success).toBe(true);
  });

  it("rejects a type outside lost/found/all", () => {
    expect(listQuerySchema.safeParse({ type: "banana" }).success).toBe(false);
  });

  it("accepts a normal q", () => {
    const result = listQuerySchema.safeParse({ type: "lost", q: "지갑" });
    expect(result.success && result.data.q).toBe("지갑");
  });

  it("rejects a q longer than the max length", () => {
    const result = listQuerySchema.safeParse({
      type: "lost",
      q: "a".repeat(MAX_SEARCH_QUERY_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a q exactly at the max length", () => {
    const result = listQuerySchema.safeParse({
      type: "lost",
      q: "a".repeat(MAX_SEARCH_QUERY_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("accepts category and location filters", () => {
    const result = listQuerySchema.safeParse({
      type: "lost",
      category: "전자기기",
      location: "인문캠퍼스",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid dateFrom/dateTo", () => {
    const result = listQuerySchema.safeParse({
      type: "lost",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid date", () => {
    const result = listQuerySchema.safeParse({ type: "lost", dateFrom: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("defaults sort to undefined (service applies the 'latest' default) when omitted", () => {
    const result = listQuerySchema.safeParse({ type: "lost" });
    expect(result.success && result.data.sort).toBeUndefined();
  });

  it("accepts sort=latest and sort=oldest", () => {
    expect(listQuerySchema.safeParse({ type: "lost", sort: "latest" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ type: "lost", sort: "oldest" }).success).toBe(true);
  });

  it("rejects an invalid sort value", () => {
    expect(listQuerySchema.safeParse({ type: "lost", sort: "random" }).success).toBe(false);
  });

  it("still clamps an excessive limit down to MAX_LIMIT (pre-existing pagination behavior, unchanged)", () => {
    const result = listQuerySchema.parse({ type: "lost", limit: "999999" });
    expect(result.limit).toBe(MAX_LIMIT);
  });

  it("still falls back to page 1 for an invalid page (pre-existing pagination behavior, unchanged)", () => {
    const result = listQuerySchema.parse({ type: "lost", page: "not-a-number" });
    expect(result.page).toBe(1);
  });
});

// Phase 9: board status filter. LostPost and FoundPost don't share a
// status vocabulary, so validity depends on `type` (checked in
// listQuerySchema's superRefine, not a flat z.enum()).
describe("listQuerySchema -- status filter (Phase 9)", () => {
  it("accepts a valid LostPost status when type=lost", () => {
    expect(listQuerySchema.safeParse({ type: "lost", status: "찾는 중" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ type: "lost", status: "찾음" }).success).toBe(true);
  });

  it("accepts a valid FoundPost status when type=found", () => {
    expect(listQuerySchema.safeParse({ type: "found", status: "보관 중" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ type: "found", status: "완료" }).success).toBe(true);
  });

  it("rejects a FoundPost status when type=lost (safe handling of a mismatched board)", () => {
    const result = listQuerySchema.safeParse({ type: "lost", status: "완료" });
    expect(result.success).toBe(false);
  });

  it("rejects a LostPost status when type=found", () => {
    const result = listQuerySchema.safeParse({ type: "found", status: "찾는 중" });
    expect(result.success).toBe(false);
  });

  it("rejects an arbitrary/unknown status value instead of crashing or ignoring it", () => {
    const result = listQuerySchema.safeParse({ type: "lost", status: "존재하지않는상태" });
    expect(result.success).toBe(false);
  });

  it("rejects status combined with type=all (no single board to validate it against)", () => {
    const result = listQuerySchema.safeParse({ type: "all", status: "찾는 중" });
    expect(result.success).toBe(false);
  });

  it("omitting status is still valid (no filter applied)", () => {
    expect(listQuerySchema.safeParse({ type: "lost" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ type: "all" }).success).toBe(true);
  });
});

// Phase 12: AI semantic search mode.
describe("listQuerySchema -- mode (Phase 12)", () => {
  it("defaults mode to 'keyword' when omitted", () => {
    const result = listQuerySchema.parse({ type: "lost" });
    expect(result.mode).toBe("keyword");
  });

  it("accepts mode=keyword explicitly, with or without q", () => {
    expect(listQuerySchema.safeParse({ type: "lost", mode: "keyword" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ type: "lost", mode: "keyword", q: "지갑" }).success).toBe(true);
  });

  it("accepts mode=semantic when type is a specific board and q is given", () => {
    expect(listQuerySchema.safeParse({ type: "lost", mode: "semantic", q: "검은색 지갑" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ type: "found", mode: "semantic", q: "검은색 지갑" }).success).toBe(true);
  });

  it("rejects an unrecognized mode value instead of silently falling back to keyword", () => {
    const result = listQuerySchema.safeParse({ type: "lost", mode: "fuzzy" });
    expect(result.success).toBe(false);
  });

  it("rejects mode=semantic combined with type=all", () => {
    const result = listQuerySchema.safeParse({ type: "all", mode: "semantic", q: "지갑" });
    expect(result.success).toBe(false);
  });

  it("rejects mode=semantic with no q", () => {
    const result = listQuerySchema.safeParse({ type: "lost", mode: "semantic" });
    expect(result.success).toBe(false);
  });

  it("rejects mode=semantic with a blank/whitespace-only q", () => {
    const result = listQuerySchema.safeParse({ type: "lost", mode: "semantic", q: "   " });
    expect(result.success).toBe(false);
  });
});
