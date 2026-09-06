import { describe, expect, it } from "vitest";

import {
  CAMPUSES,
  CATEGORIES,
  createFoundPostSchema,
  createLostPostSchema,
  DEFAULT_CAMPUS,
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
  campus: "인문캠퍼스",
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

  // Phase 31: campus is required (unlike category, there's no legacy
  // free-text data to stay compatible with) -- both a missing value and
  // one outside CAMPUSES are rejected.
  it("rejects a missing campus", () => {
    const { campus, ...rest } = validLost;
    void campus;
    expect(createLostPostSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a campus value outside CAMPUSES", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, campus: "다른캠퍼스" }).success).toBe(false);
  });

  it("accepts each value in CAMPUSES", () => {
    for (const c of CAMPUSES) {
      expect(createLostPostSchema.safeParse({ ...validLost, campus: c }).success).toBe(true);
    }
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

// Phase 9: the single canonical category list every create/edit form and
// search filter reads from -- this pins it to the legacy
// ui/common.py::CATEGORIES values so a future edit can't silently drift
// from what the old data was actually written with.
describe("CATEGORIES", () => {
  it("matches the legacy fixed category list exactly, in order", () => {
    expect(CATEGORIES).toEqual([
      "전자기기",
      "필기구",
      "책",
      "지갑",
      "카드",
      "의류",
      "가방",
      "액세서리",
      "기타",
    ]);
  });
});

// Phase 31: the two real MJU campuses -- pinned the same way CATEGORIES is
// above, and DEFAULT_CAMPUS must be one of CAMPUSES (the DB column's own
// default, see schema.prisma, is this exact string).
describe("CAMPUSES", () => {
  it("is exactly the two real MJU campuses", () => {
    expect(CAMPUSES).toEqual(["인문캠퍼스", "자연캠퍼스"]);
  });

  it("DEFAULT_CAMPUS is a member of CAMPUSES", () => {
    expect(CAMPUSES).toContain(DEFAULT_CAMPUS);
  });
});
