import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { apiCoverage, autoUnit, bucketsOf, bucketSpan, coverageOf, resolvePeriod, summarizeTimings } = await import("./report");
const { kstDay } = await import("./record");

const ok = (r: ReturnType<typeof resolvePeriod>) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("운영 통계 조회 기간 (KST)", () => {
  it("uses the KST calendar day", () => {
    expect(kstDay(new Date("2026-10-15T14:59:59Z"))).toBe("2026-10-15");
    expect(kstDay(new Date("2026-10-15T15:00:00Z"))).toBe("2026-10-16");
  });

  it("runs 오늘 / 이번 주 (Mon) / 이번 달 / 올해 up to today", () => {
    // 2026-10-16 is a Friday
    expect(ok(resolvePeriod({ preset: "today" }, "2026-10-16")).range).toEqual({ from: "2026-10-16", until: "2026-10-17", unit: "day" });
    expect(ok(resolvePeriod({ preset: "week" }, "2026-10-16")).range).toEqual({ from: "2026-10-12", until: "2026-10-17", unit: "day" });
    expect(ok(resolvePeriod({ preset: "month" }, "2026-10-16")).range).toEqual({ from: "2026-10-01", until: "2026-10-17", unit: "day" });
    expect(ok(resolvePeriod({ preset: "year" }, "2026-10-16")).range).toEqual({ from: "2026-01-01", until: "2026-10-17", unit: "month" });
    // week edges: Monday is its own start, Sunday belongs to the week before it
    expect(ok(resolvePeriod({ preset: "week" }, "2026-10-12")).range.from).toBe("2026-10-12");
    expect(ok(resolvePeriod({ preset: "week" }, "2026-10-18")).range.from).toBe("2026-10-12");
    // first day of a month / year: just today
    expect(ok(resolvePeriod({ preset: "month" }, "2026-11-01")).range).toEqual({ from: "2026-11-01", until: "2026-11-02", unit: "day" });
    expect(ok(resolvePeriod({ preset: "year" }, "2027-01-01")).range).toEqual({ from: "2027-01-01", until: "2027-01-02", unit: "day" });
    expect(ok(resolvePeriod({ preset: "week" }, "2026-10-16")).label).toBe("이번 주 (2026-10-12 ~ 2026-10-16)");
  });

  it("takes a custom range up to today, at most 366 days", () => {
    const custom = ok(resolvePeriod({ preset: "custom", from: "2026-09-01", to: "2026-10-15" }, "2026-10-16"));
    expect(custom.range).toEqual({ from: "2026-09-01", until: "2026-10-16", unit: "week" });
    expect(custom.label).toBe("9/1 ~ 10/15 (2026-09-01 ~ 2026-10-15)");
    expect(ok(resolvePeriod({ preset: "custom", from: "2026-10-16", to: "2026-10-16" }, "2026-10-16")).range.unit).toBe("day");
    for (const bad of [
      { from: "2026-10-10", to: "2026-10-01" },
      { from: "2026-10-01", to: "2026-10-17" },
      { from: "2025-10-01", to: "2026-10-16" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-13-01", to: "2026-10-01" },
      { from: undefined, to: "2026-10-01" },
    ]) {
      expect("error" in resolvePeriod({ preset: "custom", ...bad }, "2026-10-16")).toBe(true);
    }
  });

  it("picks the chart unit from the length", () => {
    expect(autoUnit("2026-10-01", "2026-11-01")).toBe("day"); // 31 days
    expect(autoUnit("2026-10-01", "2026-11-02")).toBe("week");
    expect(autoUnit("2026-01-01", "2026-07-03")).toBe("week"); // 183 days
    expect(autoUnit("2026-01-01", "2026-07-04")).toBe("month");
  });

  it("clips a week cut by the range to the range's own days", () => {
    const range = { from: "2026-09-02", until: "2026-10-17", unit: "week" as const };
    const buckets = bucketsOf(range);
    expect(buckets[0]).toBe("2026-08-31");
    expect(bucketSpan(range, buckets[0])).toEqual({ from: "2026-09-02", until: "2026-09-07" });
    expect(bucketSpan(range, buckets[buckets.length - 1])).toEqual({ from: "2026-10-12", until: "2026-10-17" });
  });
});

describe("미측정 구분", () => {
  it("marks periods before a count began as 미측정, the start day as partial", () => {
    // 방문 통계 began 2026-10-15 19:14 KST
    expect(coverageOf("visit", "2026-10-14", "2026-10-15")).toBe("none");
    expect(coverageOf("visit", "2026-10-15", "2026-10-16")).toBe("partial");
    expect(coverageOf("visit", "2026-10-16", "2026-10-17")).toBe("full");
    expect(coverageOf("visit", "2026-10-01", "2026-10-31")).toBe("partial");
    expect(coverageOf("completed", "2026-10-13", "2026-10-14")).toBe("full");
    expect(coverageOf("completed", "2026-10-12", "2026-10-13")).toBe("none");
    expect(coverageOf(null, "2020-01-01", "2020-01-02")).toBe("full");
  });

  it("says which part of a range the hourly API timings cover (since 10-15, last 90 days)", () => {
    expect(apiCoverage({ from: "2026-10-16", until: "2026-10-17", unit: "day" }, "2026-10-16")).toEqual({ coverage: "full", note: null });
    expect(apiCoverage({ from: "2026-10-01", until: "2026-10-17", unit: "day" }, "2026-10-16").coverage).toBe("partial");
    expect(apiCoverage({ from: "2026-10-01", until: "2026-10-15", unit: "day" }, "2026-10-16").coverage).toBe("none");
    const old = apiCoverage({ from: "2026-12-01", until: "2027-03-02", unit: "month" }, "2027-03-01");
    expect(old.coverage).toBe("partial");
    expect(old.note).toContain("최근 90일만 보관되어 2026-12-02 이후 값만 포함");
  });

  it("summarizes timings across routes (requests, error rate, mean, p95)", () => {
    const summary = summarizeTimings([
      { route: "GET /a", count: 3, errors: 1, avgMs: 100, p50: "", p95: "", totalMs: 300, buckets: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0] },
      { route: "GET /b", count: 1, errors: 0, avgMs: 900, p50: "", p95: "", totalMs: 900, buckets: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
    ]);
    expect(summary).toEqual({ count: 4, errors: 1, errorRate: 0.25, avgMs: 300, p95: "≤ 1600ms" });
    expect(summarizeTimings([])).toEqual({ count: 0, errors: 0, errorRate: null, avgMs: null, p95: "-" });
  });
});
