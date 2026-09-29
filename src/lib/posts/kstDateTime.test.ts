import { describe, expect, it } from "vitest";

import { interpretDateTimeLocalAsKst, nowAsKstDateTimeLocalValue, toKstDateTimeLocalValue } from "./kstDateTime";

// These must hold whatever timezone the process runs in (UTC on Vercel,
// KST on a developer machine) -- the suite is also run with TZ=UTC.
describe("interpretDateTimeLocalAsKst", () => {
  it("reads a datetime-local value as a KST wall-clock time", () => {
    const d = interpretDateTimeLocalAsKst("2026-09-30T14:00") as Date;
    expect(d.toISOString()).toBe("2026-09-30T05:00:00.000Z");
  });

  it("handles the day boundary (KST early morning is the previous UTC day)", () => {
    expect((interpretDateTimeLocalAsKst("2026-10-01T03:30") as Date).toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect((interpretDateTimeLocalAsKst("2026-01-01T00:00") as Date).toISOString()).toBe("2025-12-31T15:00:00.000Z");
  });

  it("accepts seconds and milliseconds", () => {
    expect((interpretDateTimeLocalAsKst("2026-09-30T14:00:30") as Date).toISOString()).toBe("2026-09-30T05:00:30.000Z");
    expect((interpretDateTimeLocalAsKst("2026-09-30T14:00:30.250") as Date).toISOString()).toBe("2026-09-30T05:00:30.250Z");
  });

  it("passes through null (시간 모름), Dates, and strings that already carry a timezone", () => {
    expect(interpretDateTimeLocalAsKst(null)).toBeNull();
    const date = new Date("2026-09-30T05:00:00.000Z");
    expect(interpretDateTimeLocalAsKst(date)).toBe(date);
    expect(interpretDateTimeLocalAsKst("2026-09-30T05:00:00.000Z")).toBe("2026-09-30T05:00:00.000Z");
    expect(interpretDateTimeLocalAsKst("2026-09-30T14:00+09:00")).toBe("2026-09-30T14:00+09:00");
    expect(interpretDateTimeLocalAsKst("not-a-date")).toBe("not-a-date");
  });
});

describe("toKstDateTimeLocalValue", () => {
  it("formats a stored instant back as the KST datetime-local value", () => {
    expect(toKstDateTimeLocalValue(new Date("2026-09-30T05:00:00.000Z"))).toBe("2026-09-30T14:00");
    expect(toKstDateTimeLocalValue(new Date("2026-09-30T18:30:00.000Z"))).toBe("2026-10-01T03:30");
  });

  it("round-trips with interpretDateTimeLocalAsKst", () => {
    for (const value of ["2026-09-30T14:00", "2026-10-01T00:05", "2026-02-28T23:59", "2028-02-29T12:00"]) {
      expect(toKstDateTimeLocalValue(interpretDateTimeLocalAsKst(value) as Date)).toBe(value);
    }
  });

  it("gives the create form's default as the current KST time", () => {
    const before = Date.now();
    const value = nowAsKstDateTimeLocalValue();
    const back = (interpretDateTimeLocalAsKst(value) as Date).getTime();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Truncated to the minute, so within one minute of "now".
    expect(before - back).toBeGreaterThanOrEqual(0);
    expect(before - back).toBeLessThan(60_000);
  });
});
