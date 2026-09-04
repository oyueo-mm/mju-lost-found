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
