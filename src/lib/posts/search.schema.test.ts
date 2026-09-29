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

  it("accepts category and campus filters", () => {
    const result = listQuerySchema.safeParse({
      type: "lost",
      category: "전자기기",
      campus: "인문캠퍼스",
    });
    expect(result.success).toBe(true);
  });

  // Phase 31: campus replaces the old free-text `location` search filter
  // with a fixed enum -- unlike location, an out-of-list value is rejected.
  it("rejects a campus value outside CAMPUSES", () => {
    const result = listQuerySchema.safeParse({ type: "lost", campus: "다른캠퍼스" });
    expect(result.success).toBe(false);
  });

  // 기간 검색 필터 (분실/습득 시점 기준).
  it("resolves a custom period into KST eventFrom/eventTo instants", () => {
    const result = listQuerySchema.safeParse({ type: "lost", period: "custom", from: "2026-09-01", to: "2026-09-15" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.eventFrom?.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(result.data.eventTo?.toISOString()).toBe("2026-09-15T14:59:59.999Z");
    expect(result.data.includeUnknownEventTime).toBe(false);
  });

  it("resolves a preset relative to now and honors unknownTime=include", () => {
    const result = listQuerySchema.safeParse({ type: "found", period: "1w", unknownTime: "include" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.eventFrom).toBeInstanceOf(Date);
    expect(result.data.eventTo).toBeInstanceOf(Date);
    expect(result.data.eventTo!.getTime() - result.data.eventFrom!.getTime()).toBe(7 * 24 * 60 * 60 * 1000 - 1);
    expect(result.data.includeUnknownEventTime).toBe(true);
  });

  it("applies no time filter without a period (unknownTime alone does nothing)", () => {
    const result = listQuerySchema.safeParse({ type: "lost", unknownTime: "include" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.eventFrom).toBeUndefined();
    expect(result.data.eventTo).toBeUndefined();
    expect(result.data.includeUnknownEventTime).toBeUndefined();
  });

  it("rejects an unknown period, a malformed or impossible date, and an inverted range", () => {
    expect(listQuerySchema.safeParse({ type: "lost", period: "forever" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ type: "lost", period: "custom", from: "not-a-date" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ type: "lost", period: "custom", from: "2026-02-30" }).success).toBe(false);
    const inverted = listQuerySchema.safeParse({ type: "lost", period: "custom", from: "2026-09-15", to: "2026-09-01" });
    expect(inverted.success).toBe(false);
    if (!inverted.success) expect(inverted.error.issues[0].path).toEqual(["to"]);
  });

  it("no longer filters by createdAt: the old dateFrom/dateTo parameters are ignored", () => {
    const result = listQuerySchema.safeParse({ type: "lost", dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("dateFrom");
    expect(result.data.eventFrom).toBeUndefined();
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

  // Phase 11-2: previously rejected -- both boards' embedding scores live
  // on the same comparable scale (same model, same normalizeScore), so
  // aiService.ts now merges them instead of the schema rejecting the
  // combination outright. status+type=all (tested above) is unaffected --
  // LostPost/FoundPost don't share a status vocabulary at all, so that
  // rejection is unrelated and still applies.
  it("accepts mode=semantic combined with type=all", () => {
    const result = listQuerySchema.safeParse({ type: "all", mode: "semantic", q: "지갑" });
    expect(result.success).toBe(true);
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
