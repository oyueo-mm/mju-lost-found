import { describe, expect, it, vi } from "vitest";
import { CONTENT_FIRST, CONTENT_PREFIX } from "./contentMeasurement";
const queries: { sql: string; values: unknown[] }[] = [];
let failFirstLookup = false;
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?"); queries.push({ sql, values });
    if (sql.includes("ORDER BY")) { if (failFirstLookup) throw new Error("lookup failed"); return [{ day: "2026-11-10", second: 43234 }]; }
    if (sql.includes("meta.since.utm_content")) return [{ day: "2026-11-09" }];
    if (sql.includes("GROUP BY")) return [
      { day: "2026-11-10", metric: CONTENT_FIRST, n: 43234 },
      { day: "2026-11-10", metric: CONTENT_PREFIX + "h_jonghap_guard_reg", n: 2 },
      { day: "2026-11-10", metric: "visit.utm_content.h_jonghap_guard_reg", n: 99 },
    ];
    return [{ day: "2026-10-20" }];
  },
} }));
const { loadInflow } = await import("./inflow");
describe("Content query boundary", () => {
  it("reads release markers independently from old metadata and queries daily observations", async () => {
    const report = await loadInflow(["2026-11-10", "2026-11-11"]);
    expect(report.content.firstObservedAt).toBe("2026-11-10T12:00:34+09:00");
    expect(report.content.contents[0].sessions).toBe(2);
    expect(report.legacyContent.contents[0].sessions).toBe(99);
    expect(report.legacyContent.markerDay).toBe("2026-11-09");
    expect(report.content.perDay[1].taggedSessions).toBeNull();
    expect(queries.find(q => q.sql.includes("GROUP BY"))?.values).toContain(CONTENT_FIRST);
    expect(queries.every(q => !/\b(INSERT|DELETE|UPDATE)\b/.test(q.sql))).toBe(true);
  });
  it("does not turn a failed metadata lookup into zero measured sessions", async () => {
    failFirstLookup = true;
    const report = await loadInflow(["2026-11-10"]);
    expect(report.content.since).toBeNull();
    expect(report.content.perDay[0].taggedSessions).toBeNull();
    expect(report.legacyContent.contents[0].sessions).toBe(99);
  });
});
