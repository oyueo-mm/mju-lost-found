import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/generated/prisma/client", () => ({
  LostPostStatus: { SEARCHING: "SEARCHING", FOUND: "FOUND" },
  FoundPostStatus: { KEEPING: "KEEPING", COMPLETED: "COMPLETED" },
}));

const { dateOnlyToDb, dbDateToDateOnly, kstTimeOnly, postEventDateTime } = await import("./eventDate");
const { resolveEventRange } = await import("./eventPeriod");
const { createFoundPostSchema, createLostPostSchema, updateLostPostSchema } = await import("./schema");
const { eventTimeWhere, toFoundPostDTO, toLostPostDTO } = await import("./service");
const { reviveDates } = await import("./reviveDates");

// 분실/습득 날짜/시각 분리. Every case must hold in any process timezone
// (the suite is also run with TZ=UTC).

const baseLost = {
  title: "지갑을 잃어버렸어요",
  description: "검은색 지갑입니다.",
  category: "지갑",
  location: "학생회관",
  campus: "인문캠퍼스",
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : d);

function dbRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    title: "t",
    description: "d",
    category: "지갑",
    location: null,
    campus: "인문캠퍼스",
    status: "SEARCHING" as const,
    imageUrl: null,
    lostAt: null,
    lostDate: null,
    createdAt: new Date("2026-10-06T00:00:00Z"),
    updatedAt: new Date("2026-10-06T00:00:00Z"),
    viewCount: 0,
    user: { id: 1, nickname: "n", publicId: "p", userType: "STUDENT" as const },
    organization: null,
    ...overrides,
  };
}

describe("create: the three 분실/습득 시점 states", () => {
  it("date + time -> both the date and the exact KST instant", () => {
    const parsed = createLostPostSchema.parse({ ...baseLost, lostDate: "2026-10-06", lostTime: "14:30" });
    expect(iso(parsed.lostDate)).toBe("2026-10-06T00:00:00.000Z");
    expect(iso(parsed.lostAt)).toBe("2026-10-06T05:30:00.000Z");
    expect(parsed).not.toHaveProperty("lostTime");
  });

  it("date only (시간 모름) -> the date, and no made-up time", () => {
    const parsed = createLostPostSchema.parse({ ...baseLost, lostDate: "2026-10-06", lostTime: null });
    expect(iso(parsed.lostDate)).toBe("2026-10-06T00:00:00.000Z");
    expect(parsed.lostAt).toBeNull();
  });

  it("date unknown -> both null", () => {
    const parsed = createLostPostSchema.parse({ ...baseLost, lostDate: null, lostTime: null });
    expect(parsed.lostDate).toBeNull();
    expect(parsed.lostAt).toBeNull();
  });

  it("applies the same rules to found posts", () => {
    const parsed = createFoundPostSchema.parse({ ...baseLost, foundDate: "2026-10-06", foundTime: null });
    expect(iso(parsed.foundDate)).toBe("2026-10-06T00:00:00.000Z");
    expect(parsed.foundAt).toBeNull();
  });

  it("rejects a time without a date, an invalid date or time, and a missing field", () => {
    expect(createLostPostSchema.safeParse({ ...baseLost, lostDate: null, lostTime: "10:00" }).success).toBe(false);
    expect(createLostPostSchema.safeParse({ ...baseLost, lostTime: "10:00" }).success).toBe(false);
    expect(createLostPostSchema.safeParse({ ...baseLost, lostDate: "2026-02-30", lostTime: null }).success).toBe(false);
    expect(createLostPostSchema.safeParse({ ...baseLost, lostDate: "2026-10-06", lostTime: "24:00" }).success).toBe(false);
    expect(createLostPostSchema.safeParse(baseLost).success).toBe(false);
  });
});

describe("KST date boundaries", () => {
  it("keeps the KST date for times right after midnight and right before the next one", () => {
    const early = createLostPostSchema.parse({ ...baseLost, lostDate: "2026-10-06", lostTime: "00:30" });
    expect(iso(early.lostAt)).toBe("2026-10-05T15:30:00.000Z"); // previous day in UTC
    expect(iso(early.lostDate)).toBe("2026-10-06T00:00:00.000Z");

    const late = createLostPostSchema.parse({ ...baseLost, lostDate: "2026-10-06", lostTime: "23:59" });
    expect(iso(late.lostAt)).toBe("2026-10-06T14:59:00.000Z");
    expect(iso(late.lostDate)).toBe("2026-10-06T00:00:00.000Z");
  });

  it("round-trips a DATE value without shifting the day", () => {
    expect(dbDateToDateOnly(dateOnlyToDb("2026-10-06"))).toBe("2026-10-06");
    expect(dbDateToDateOnly(dateOnlyToDb("2026-12-31"))).toBe("2026-12-31");
  });

  it("reads an instant's time back in KST", () => {
    expect(kstTimeOnly(new Date("2026-10-05T15:30:00.000Z"))).toBe("00:30");
  });
});

describe("period search uses the date, not the instant", () => {
  // now = 2026-10-06 01:00 KST (still 10-05 in UTC).
  const now = new Date("2026-10-05T16:00:00.000Z");
  const range = resolveEventRange({ period: "today" }, now)!;
  const where = eventTimeWhere("lostDate", { eventFrom: range.from, eventTo: range.to });

  it("filters the date column by the KST day", () => {
    expect(where.AND).toEqual([
      { lostDate: { gte: new Date("2026-10-06T00:00:00.000Z"), lte: new Date("2026-10-06T00:00:00.000Z") } },
    ]);
  });

  it("includes a date-only post on its day", () => {
    const dateOnly = createLostPostSchema.parse({ ...baseLost, lostDate: "2026-10-06", lostTime: null });
    const bounds = (where.AND![0] as { lostDate: { gte: Date; lte: Date } }).lostDate;
    expect(dateOnly.lostAt).toBeNull();
    expect(dateOnly.lostDate!.getTime()).toBeGreaterThanOrEqual(bounds.gte.getTime());
    expect(dateOnly.lostDate!.getTime()).toBeLessThanOrEqual(bounds.lte.getTime());
  });
});

describe("create -> read -> edit keeps the date and time", () => {
  function roundTrip(input: { lostDate: string | null; lostTime: string | null }) {
    const created = createLostPostSchema.parse({ ...baseLost, ...input });
    // What the DB hands back, through the DTO and the JSON API boundary.
    const dto = reviveDates(JSON.parse(JSON.stringify(toLostPostDTO(dbRow({ lostAt: created.lostAt, lostDate: created.lostDate })))));
    const shown = postEventDateTime(dto as Parameters<typeof postEventDateTime>[0]);
    // The edit form resubmits what it was prefilled with.
    const updated = updateLostPostSchema.parse({ lostDate: shown.date, lostTime: shown.time });
    return { created, shown, updated };
  }

  it("date + time", () => {
    const { created, shown, updated } = roundTrip({ lostDate: "2026-10-06", lostTime: "00:30" });
    expect(shown).toMatchObject({ date: "2026-10-06", time: "00:30" });
    expect(iso(updated.lostAt)).toBe(iso(created.lostAt));
    expect(iso(updated.lostDate)).toBe(iso(created.lostDate));
  });

  it("date only", () => {
    const { shown, updated } = roundTrip({ lostDate: "2026-10-06", lostTime: null });
    expect(shown).toEqual({ at: null, date: "2026-10-06", time: null });
    expect(updated.lostAt).toBeNull();
    expect(iso(updated.lostDate)).toBe("2026-10-06T00:00:00.000Z");
  });

  it("date unknown", () => {
    const { shown, updated } = roundTrip({ lostDate: null, lostTime: null });
    expect(shown).toEqual({ at: null, date: null, time: null });
    expect(updated).toMatchObject({ lostDate: null, lostAt: null });
  });

  it("an edit that doesn't touch the date leaves both columns alone", () => {
    const updated = updateLostPostSchema.parse({ title: "새 제목" });
    expect(updated).not.toHaveProperty("lostDate");
    expect(updated).not.toHaveProperty("lostAt");
  });
});

describe("backward compatibility", () => {
  it("a client sending only the legacy lostAt still gets the KST date", () => {
    const parsed = createLostPostSchema.parse({ ...baseLost, lostAt: "2026-10-06T00:30" });
    expect(iso(parsed.lostAt)).toBe("2026-10-05T15:30:00.000Z");
    expect(iso(parsed.lostDate)).toBe("2026-10-06T00:00:00.000Z");

    const unknown = createLostPostSchema.parse({ ...baseLost, lostAt: null });
    expect(unknown).toMatchObject({ lostAt: null, lostDate: null });
  });

  it("an existing post with only an instant still shows its KST date and time", () => {
    const dto = toLostPostDTO(dbRow({ lostAt: new Date("2026-10-05T15:30:00.000Z"), lostDate: null }));
    expect(postEventDateTime(dto)).toMatchObject({ date: "2026-10-06", time: "00:30" });
  });

  it("an existing post with neither stays unknown", () => {
    const dto = toFoundPostDTO({ ...dbRow({}), status: "KEEPING", foundAt: null, foundDate: null });
    expect(dto.foundDate).toBeNull();
    expect(postEventDateTime(dto)).toEqual({ at: null, date: null, time: null });
  });
});
