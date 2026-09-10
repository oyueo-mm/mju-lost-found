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
  updateFoundPostSchema,
  updateLostPostSchema,
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

  // Phase P-5: null means "the poster doesn't know" -- a genuine, distinct
  // state from a required non-empty string, never coerced from/to an
  // empty string. See schema.prisma's own comment on LostPost.location/
  // lostAt for why this isn't a "미상" placeholder string instead.
  it("accepts location: null (위치 미상)", () => {
    const result = createLostPostSchema.safeParse({ ...validLost, location: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.location).toBeNull();
  });

  it("accepts lostAt: null (시간 미상)", () => {
    const result = createLostPostSchema.safeParse({ ...validLost, lostAt: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lostAt).toBeNull();
  });

  it("accepts both location and lostAt as null at once", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, location: null, lostAt: null }).success).toBe(true);
  });

  it("still rejects an empty-string location -- null is the only accepted 'unknown' value", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, location: "" }).success).toBe(false);
  });

  it("still rejects lostAt: 'not-a-date' even though null is allowed", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, lostAt: "not-a-date" }).success).toBe(false);
  });

  // Phase 12-5 §6/§7: organizationId is genuinely optional (omitted ==
  // personal post, unchanged existing behavior) and, when present, only
  // shape-validated here -- existence/ACTIVE/membership is
  // validateOrganizationPosting()'s job, not zod's.
  it("accepts a payload with no organizationId at all (personal post)", () => {
    const result = createLostPostSchema.safeParse(validLost);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBeUndefined();
  });

  it("accepts organizationId: null (explicit personal post)", () => {
    const result = createLostPostSchema.safeParse({ ...validLost, organizationId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBeNull();
  });

  it("accepts a positive integer organizationId", () => {
    const result = createLostPostSchema.safeParse({ ...validLost, organizationId: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBe(10);
  });

  it("rejects a non-positive organizationId", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, organizationId: 0 }).success).toBe(false);
    expect(createLostPostSchema.safeParse({ ...validLost, organizationId: -1 }).success).toBe(false);
  });

  it("rejects a non-integer organizationId", () => {
    expect(createLostPostSchema.safeParse({ ...validLost, organizationId: 1.5 }).success).toBe(false);
  });
});

describe("updateLostPostSchema", () => {
  // Phase P-5: an edit can move a post from a known value back to
  // 미상 (explicit null) or from 미상 to a known value (a real string/date)
  // -- both must round-trip through the same partial-update schema an
  // unrelated field-only edit already uses.
  it("accepts changing location to null (known -> 미상)", () => {
    expect(updateLostPostSchema.safeParse({ location: null }).success).toBe(true);
  });

  it("accepts changing location from null to a real value (미상 -> known)", () => {
    const result = updateLostPostSchema.safeParse({ location: "학생회관 2층" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.location).toBe("학생회관 2층");
  });

  it("accepts changing lostAt to null (known -> 미상)", () => {
    expect(updateLostPostSchema.safeParse({ lostAt: null }).success).toBe(true);
  });

  it("accepts changing lostAt from null to a real value (미상 -> known)", () => {
    const result = updateLostPostSchema.safeParse({ lostAt: "2026-02-01T09:00" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lostAt).toBeInstanceOf(Date);
  });

  it("still allows omitting location/lostAt entirely (unchanged)", () => {
    expect(updateLostPostSchema.safeParse({ title: "새 제목" }).success).toBe(true);
  });

  // Phase 12-7 §4: reverses Phase 12-5's §10 "fixed at creation" policy --
  // organizationId is now a genuinely editable field, shape-validated the
  // same as on create (positive integer, or null for 개인).
  it("accepts a positive integer organizationId on update", () => {
    const result = updateLostPostSchema.safeParse({ title: "새 제목", organizationId: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBe(10);
  });

  it("accepts organizationId: null on update (단체 -> 개인)", () => {
    const result = updateLostPostSchema.safeParse({ title: "새 제목", organizationId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBeNull();
  });

  it("omitting organizationId on update leaves it absent (attribution unchanged)", () => {
    const result = updateLostPostSchema.safeParse({ title: "새 제목" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("organizationId");
  });
});

describe("createFoundPostSchema", () => {
  it("rejects a LostPost status value", () => {
    const validFound = { ...validLost, foundAt: validLost.lostAt };
    expect(
      createFoundPostSchema.safeParse({ ...validFound, status: "찾는 중" }).success,
    ).toBe(false);
  });

  it("accepts location: null and foundAt: null (위치/시간 미상)", () => {
    const validFound = { ...validLost, foundAt: validLost.lostAt };
    const result = createFoundPostSchema.safeParse({ ...validFound, location: null, foundAt: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBeNull();
      expect(result.data.foundAt).toBeNull();
    }
  });
});

describe("updateFoundPostSchema", () => {
  it("accepts changing foundAt to null and back to a real value", () => {
    expect(updateFoundPostSchema.safeParse({ foundAt: null }).success).toBe(true);
    const result = updateFoundPostSchema.safeParse({ foundAt: "2026-02-01T09:00" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.foundAt).toBeInstanceOf(Date);
  });

  // See updateLostPostSchema's own identical tests -- same shape/reasoning.
  it("accepts a positive integer organizationId on update", () => {
    const result = updateFoundPostSchema.safeParse({ title: "새 제목", organizationId: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBe(10);
  });

  it("accepts organizationId: null on update (단체 -> 개인)", () => {
    const result = updateFoundPostSchema.safeParse({ title: "새 제목", organizationId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBeNull();
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
