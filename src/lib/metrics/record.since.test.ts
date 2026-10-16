import { describe, expect, it, vi } from "vitest";

// $executeRaw is a tagged template: keep each statement's SQL and values.
const executeCalls: { sql: string; values: unknown[] }[] = [];
let failNext = false;
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      executeCalls.push({ sql: strings.join("?"), values });
      return Promise.resolve(1);
    }),
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    $transaction: vi.fn(async (ops: unknown[]) => {
      if (failNext) {
        failNext = false;
        throw new Error("db down");
      }
      return ops;
    }),
  },
}));
vi.mock("next/server", () => ({ after: () => {} }));

const { addDailyCount, flushTimings, kstMinuteOfDay, TRAFFIC_HOURLY_SINCE_METRIC, USER_HOURLY_SINCE_METRIC } = await import("./record");

const markerWrites = (marker: string = USER_HOURLY_SINCE_METRIC) => executeCalls.filter((c) => c.values.includes(marker));

describe("사용자 통계 시간대별 지표: this environment's collection start", () => {
  it("is written with the instance's first batch only, as a KST day and minute, never summed", async () => {
    failNext = true;
    addDailyCount("auth.login.hour.09");
    await expect(flushTimings()).rejects.toThrow("db down");
    // the failed batch did not count: the next one carries the marker again
    executeCalls.length = 0;
    await flushTimings();
    expect(markerWrites()).toHaveLength(1);
    const [write] = markerWrites();
    expect(write.sql).toContain("WHERE NOT EXISTS");
    expect(write.sql).toContain("LEAST");
    expect(write.values[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof write.values[2]).toBe("number");
    // 시간대 분석's counters (anon hourly views, hourly active members) and
    // User.lastActiveAt: their own marker, written the same way, same start
    const [traffic] = markerWrites(TRAFFIC_HOURLY_SINCE_METRIC);
    expect(markerWrites(TRAFFIC_HOURLY_SINCE_METRIC)).toHaveLength(1);
    expect(traffic.sql).toContain("WHERE NOT EXISTS");
    expect([traffic.values[0], traffic.values[2]]).toEqual([write.values[0], write.values[2]]);
    executeCalls.length = 0;
    addDailyCount("visit.member.hour.21");
    await flushTimings();
    expect(markerWrites()).toHaveLength(0);
    expect(markerWrites(TRAFFIC_HOURLY_SINCE_METRIC)).toHaveLength(0);
  });

  it("reads the minute of the KST day", () => {
    expect(kstMinuteOfDay(new Date("2026-10-16T07:47:30Z"))).toBe(16 * 60 + 47);
    expect(kstMinuteOfDay(new Date("2026-10-16T15:00:00Z"))).toBe(0);
  });
});
