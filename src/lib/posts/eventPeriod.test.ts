import { describe, expect, it } from "vitest";

import { kstDateOnly, kstEndOfDay, kstStartOfDay, resolveEventRange } from "./eventPeriod";

// "now" = 2026-09-30 20:00 UTC = 2026-10-01 05:00 KST, so "today" in KST is
// already the next UTC day -- this is exactly the case a UTC-based
// implementation would get wrong. Must hold in any process timezone (the
// suite is also run with TZ=UTC).
const NOW = new Date("2026-09-30T20:00:00.000Z");
const iso = (d: Date | undefined) => d?.toISOString();

describe("KST day boundaries", () => {
  it("maps a calendar date to its KST first and last instant", () => {
    expect(iso(kstStartOfDay("2026-10-01")!)).toBe("2026-09-30T15:00:00.000Z");
    expect(iso(kstEndOfDay("2026-10-01")!)).toBe("2026-10-01T14:59:59.999Z");
  });

  it("rejects malformed and non-existent dates", () => {
    expect(kstStartOfDay("2026-02-30")).toBeNull();
    expect(kstStartOfDay("2026-13-01")).toBeNull();
    expect(kstStartOfDay("2026-1-5")).toBeNull();
    expect(kstStartOfDay("not-a-date")).toBeNull();
    expect(kstStartOfDay("2028-02-29")).not.toBeNull(); // leap day
  });

  it("gives the KST calendar date of an instant", () => {
    expect(kstDateOnly(NOW)).toBe("2026-10-01");
    expect(kstDateOnly(new Date("2026-09-30T14:59:59.999Z"))).toBe("2026-09-30");
  });
});

describe("resolveEventRange", () => {
  it("returns null for 전체 (no period) and for a custom period with no dates", () => {
    expect(resolveEventRange({}, NOW)).toBeNull();
    expect(resolveEventRange({ period: "custom" }, NOW)).toBeNull();
  });

  it("today = the whole KST day", () => {
    const r = resolveEventRange({ period: "today" }, NOW)!;
    expect(iso(r.from)).toBe("2026-09-30T15:00:00.000Z"); // 10/01 00:00 KST
    expect(iso(r.to)).toBe("2026-10-01T14:59:59.999Z"); // 10/01 23:59:59.999 KST
  });

  it("3d / 1w / 1m count today as the first day", () => {
    expect(iso(resolveEventRange({ period: "3d" }, NOW)!.from)).toBe("2026-09-28T15:00:00.000Z"); // 09/29 KST
    expect(iso(resolveEventRange({ period: "1w" }, NOW)!.from)).toBe("2026-09-24T15:00:00.000Z"); // 09/25 KST
    expect(iso(resolveEventRange({ period: "1m" }, NOW)!.from)).toBe("2026-09-01T15:00:00.000Z"); // 09/02 KST
    for (const period of ["3d", "1w", "1m"] as const) {
      expect(iso(resolveEventRange({ period }, NOW)!.to)).toBe("2026-10-01T14:59:59.999Z");
    }
  });

  it("custom = start date 00:00 .. end date 23:59:59.999 KST", () => {
    const r = resolveEventRange({ period: "custom", from: "2026-09-01", to: "2026-09-15" }, NOW)!;
    expect(iso(r.from)).toBe("2026-08-31T15:00:00.000Z");
    expect(iso(r.to)).toBe("2026-09-15T14:59:59.999Z");
  });

  it("custom allows an open start or end", () => {
    expect(resolveEventRange({ period: "custom", from: "2026-09-01" }, NOW)).toEqual({
      from: new Date("2026-08-31T15:00:00.000Z"),
    });
    expect(resolveEventRange({ period: "custom", to: "2026-09-15" }, NOW)).toEqual({
      to: new Date("2026-09-15T14:59:59.999Z"),
    });
  });

  it("ignores from/to for presets", () => {
    expect(resolveEventRange({ period: "today", from: "2020-01-01", to: "2020-01-02" }, NOW)).toEqual(
      resolveEventRange({ period: "today" }, NOW),
    );
  });
});
