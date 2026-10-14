import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { $executeRaw: vi.fn(async () => 1), $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

const { activityActor, bucketOf, firstSeen, kstDay, LATENCY_BUCKETS_MS, normalizeRoute } = await import("./record");
const { bucketList, percentileLabel, periodStart } = await import("./dashboard");

describe("운영 통계 recording", () => {
  it("uses the KST calendar day", () => {
    expect(kstDay(new Date("2026-10-14T14:59:59Z"))).toBe("2026-10-14");
    expect(kstDay(new Date("2026-10-14T15:00:00Z"))).toBe("2026-10-15");
  });

  it("labels routes without ids, keeping only the search mode", () => {
    expect(normalizeRoute("POST", "https://x/api/posts/123/image?type=found")).toBe("POST /api/posts/[id]/image");
    expect(normalizeRoute("GET", "https://x/api/posts?mode=ai&q=지갑")).toBe("GET /api/posts?mode=ai");
    expect(normalizeRoute("GET", "https://x/api/chat/9f40fa95-2e24-41a6-af26-db21b8937085/messages")).toBe("GET /api/chat/[id]/messages");
    expect(normalizeRoute("GET", undefined)).toBe("GET (unknown)");
    expect(normalizeRoute("GET", "https://x/api/posts?q=비밀")).not.toContain("비밀");
  });

  it("puts a duration in the right histogram bucket", () => {
    expect(bucketOf(10)).toBe(0);
    expect(bucketOf(25)).toBe(0);
    expect(bucketOf(26)).toBe(1);
    expect(bucketOf(99999)).toBe(LATENCY_BUCKETS_MS.length);
  });

  it("counts the same search once within a few seconds", () => {
    expect(firstSeen("a", 1000)).toBe(true);
    expect(firstSeen("a", 5000)).toBe(false);
    expect(firstSeen("b", 5000)).toBe(true);
    expect(firstSeen("a", 20_001)).toBe(true);
  });

  it("names a member by an HMAC that is stable per secret and not the id", () => {
    const a = activityActor(7, "secret-1");
    expect(a).toBe(activityActor(7, "secret-1"));
    expect(a).not.toBe(activityActor(8, "secret-1"));
    expect(a).not.toBe(activityActor(7, "secret-2"));
    expect(a).not.toContain("7");
  });

  it("reads p50/p95 from the histogram as bucket upper bounds", () => {
    const buckets = new Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
    buckets[2] = 90; // ≤ 100ms
    buckets[5] = 10; // ≤ 800ms
    expect(percentileLabel(buckets, 0.5)).toBe("≤ 100ms");
    expect(percentileLabel(buckets, 0.95)).toBe("≤ 800ms");
    expect(percentileLabel(new Array(10).fill(0), 0.5)).toBe("-");
  });

  it("builds day/week/month periods ending with the current one", () => {
    expect(periodStart("2026-10-15", "week")).toBe("2026-10-12"); // Monday
    expect(periodStart("2026-10-15", "month")).toBe("2026-10-01");
    const days = bucketList("day", "2026-10-15");
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toBe("2026-10-15");
    expect(bucketList("month", "2026-10-15").slice(-2)).toEqual(["2026-09-01", "2026-10-01"]);
  });
});
