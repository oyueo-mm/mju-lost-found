import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { bucketsOf, bucketSpan, coverageOf, dashboardRange, recentRange, summarizeTimings } = await import("./report");

describe("운영 통계 기간과 미측정 구분", () => {
  it("marks periods before a count began as 미측정, the start day as partial", () => {
    // 방문 통계 began 2026-10-15 19:14 KST
    expect(coverageOf("visit", "2026-10-14", "2026-10-15")).toBe("none");
    expect(coverageOf("visit", "2026-10-15", "2026-10-16")).toBe("partial");
    expect(coverageOf("visit", "2026-10-16", "2026-10-17")).toBe("full");
    expect(coverageOf("visit", "2026-10-01", "2026-10-31")).toBe("partial");
    // 완료 처리 began at the start of 2026-10-13
    expect(coverageOf("completed", "2026-10-13", "2026-10-14")).toBe("full");
    expect(coverageOf("completed", "2026-10-12", "2026-10-13")).toBe("none");
    // the service's own tables have no start
    expect(coverageOf(null, "2020-01-01", "2020-01-02")).toBe("full");
  });

  it("builds the dashboard's and the export's ranges", () => {
    expect(dashboardRange("day", "2026-10-15")).toEqual({ from: "2026-09-16", until: "2026-10-16", unit: "day" });
    expect(dashboardRange("week", "2026-10-15")).toEqual({ from: "2026-07-27", until: "2026-10-19", unit: "week" });
    expect(dashboardRange("month", "2026-10-15")).toEqual({ from: "2025-11-01", until: "2026-11-01", unit: "month" });
    expect(recentRange(7, "2026-10-15")).toEqual({ from: "2026-10-09", until: "2026-10-16", unit: "day" });
    expect(bucketsOf(dashboardRange("day", "2026-10-15"))).toHaveLength(30);
    expect(bucketsOf(dashboardRange("week", "2026-10-15"))).toHaveLength(12);
    expect(bucketsOf({ from: "2026-10-01", until: "2026-10-04", unit: "day" })).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("clips a bucket to the range", () => {
    const range = { from: "2026-10-14", until: "2026-10-16", unit: "week" as const };
    expect(bucketsOf(range)).toEqual(["2026-10-12"]);
    expect(bucketSpan(range, "2026-10-12")).toEqual({ from: "2026-10-14", until: "2026-10-16" });
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
