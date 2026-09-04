import { describe, expect, it } from "vitest";

import {
  createFoundPostSchema,
  createLostPostSchema,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  listQuerySchema,
  MAX_LIMIT,
} from "./schema";

const validLost = {
  title: "지갑을 잃어버렸어요",
  description: "검은색 지갑입니다.",
  category: "지갑",
  location: "학생회관",
  lostAt: "2026-01-01T10:00",
};

describe("createLostPostSchema", () => {
  it("accepts a valid payload", () => {
    expect(createLostPostSchema.safeParse(validLost).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { title, ...rest } = validLost;
    void title;
    expect(createLostPostSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty title after trimming", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, title: "   " }).success).toBe(false);
  });

  it("rejects a non-string field (wrong data type)", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, title: 123 }).success).toBe(false);
  });

  it("rejects an invalid lostAt value", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, lostAt: "not-a-date" }).success).toBe(
      false,
    );
  });

  it("rejects a status value outside LostPostStatus", () => {
    expect(
      createLostPostSchema.safeParse({ ...validLost, status: "완료" }).success, // a FoundPost status
    ).toBe(false);
  });

  it("accepts a valid LostPost status", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, status: "찾음" }).success).toBe(true);
  });
});

describe("createFoundPostSchema", () => {
  it("rejects a LostPost status value", () => {
    const validFound = { ...validLost, foundAt: validLost.lostAt };
    expect(
      createFoundPostSchema.safeParse({ ...validFound, status: "찾는 중" }).success,
    ).toBe(false);
  });
});

describe("listQuerySchema", () => {
  it("requires a valid type", () => {
    expect(listQuerySchema.safeParse({ type: "banana" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ type: "lost" }).success).toBe(true);
  });

  it("falls back to defaults for missing page/limit", () => {
    const result = listQuerySchema.parse({ type: "lost" });
    expect(result.page).toBe(DEFAULT_PAGE);
    expect(result.limit).toBe(DEFAULT_LIMIT);
  });

  it("clamps an excessive limit instead of allowing an unbounded query", () => {
    const result = listQuerySchema.parse({ type: "lost", limit: "100000" });
    expect(result.limit).toBe(MAX_LIMIT);
  });
});
