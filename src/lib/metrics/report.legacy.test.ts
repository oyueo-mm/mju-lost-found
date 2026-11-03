import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// 운영 통계 must keep counting the period before the event-time role snapshot
// (2026-11-03 on Production): rows without a stored mark are classified from
// the admin history in SQL, and the pre-v3 counters (already split into
// member / anon / admin when collected) are read as they were.
const sqls: string[] = [];
const rows = (sql: string) => {
  if (sql.includes("meta.since.audience_snapshot")) return [{ day: "2026-11-03" }];
  if (sql.includes('FROM "LostPost"') && sql.includes("mju_legacy_audience")) return [{ bucket: "2026-10-20", n: 3 }];
  if (sql.includes('FROM "User"') && sql.includes("mju_legacy_signup_audience")) return [{ bucket: "2026-10-20", n: 2 }];
  if (sql.includes(`"metric" LIKE 'visit.%'`)) return [{ bucket: "2026-10-20", metric: "visit.pv.member", n: 40 }, { bucket: "2026-10-20", metric: "visit.pv.anon", n: 60 }];
  return [];
};
const model = new Proxy({}, { get: () => async () => [] });
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy(
    {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Prisma.sql(strings, ...values).sql; // nested fragments rendered
        sqls.push(sql);
        return rows(sql);
      },
    },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : model) },
  ),
}));
const { loadReport } = await import("./report");

describe("운영 통계: 역할 기록 도입 전 기간", () => {
  it("counts pre-snapshot posts and sign-ups and keeps the period measured", async () => {
    const r = await loadReport({ from: "2026-10-15", until: "2026-11-01", unit: "day" }, { now: new Date("2026-11-03T12:00:00Z") });
    expect(r.totals.lost).toBe(3);
    expect(r.totals.signups).toBe(2);
    expect(r.totalCoverage.lost).not.toBe("none");
    expect(r.totals.pvMember).toBe(40);
    expect(r.totals.pvAnon).toBe(60);
  });
  it("classifies unstamped rows in SQL instead of requiring a stored member mark", () => {
    const core = sqls.filter((s) => s.includes('FROM "LostPost"') || s.includes('FROM "FoundPost"') || s.includes('FROM "ChatRoom"') || s.includes('FROM "Message"'));
    expect(core.length).toBeGreaterThan(0);
    for (const s of core) {
      expect(s).not.toMatch(/WHERE "activity_audience" = 'member'/);
      expect(s).toContain("COALESCE(\"activity_audience\", mju_legacy_audience(");
    }
  });
});
