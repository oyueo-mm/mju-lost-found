import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const queries: { sql: string; values: unknown[] }[] = [];
let rows: unknown[] = [];
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = Prisma.sql(strings, ...values);
      queries.push({ sql: q.sql, values: q.values });
      return rows;
    }),
  },
}));

const { categoryReport, categoryRows, loadCategoryCounts, UNCLASSIFIED_LABEL } = await import("./categories");
const { CATEGORY_CODES } = await import("@/lib/posts/categoryTaxonomy");
const { CategoryStats } = await import("@/components/admin/CategoryStats");

describe("카테고리별 현황: categoryRows", () => {
  const sample = categoryRows([
    { type: "lost", code: "wallet", n: 3 },
    { type: "found", code: "wallet", n: 1 },
    { type: "found", code: "phone", n: 3 },
    { type: "lost", code: "card_id", n: 3 },
    { type: "lost", code: null, n: 2 },
    { type: "found", code: "retired_code", n: 1 },
  ]);

  it("lists every taxonomy category, 미분류 and unknown codes, so the rows add up to the totals", () => {
    expect(sample).toHaveLength(CATEGORY_CODES.length + 2);
    expect(sample.find((r) => r.code === null)!.label).toBe(UNCLASSIFIED_LABEL);
    expect(sample.find((r) => r.code === "retired_code")!.label).toBe("알 수 없는 분류(retired_code)");
    expect(sample.reduce((a, r) => a + r.lost, 0)).toBe(8);
    expect(sample.reduce((a, r) => a + r.found, 0)).toBe(5);
  });

  it("orders by total, ties in taxonomy order; shares and ranks per type (ties share a rank)", () => {
    expect(sample.slice(0, 4).map((r) => [r.label, r.total])).toEqual([
      ["지갑", 4],
      ["카드", 3],
      ["휴대폰", 3],
      ["미분류", 2],
    ]);
    const wallet = sample[0];
    expect([wallet.lostShare, wallet.lostRank, wallet.foundShare, wallet.foundRank]).toEqual([3 / 8, 1, 1 / 5, 2]);
    expect(sample.find((r) => r.code === "card_id")!.lostRank).toBe(1);
    expect(sample.find((r) => r.code === null)!.lostRank).toBe(3);
    expect(sample.find((r) => r.code === "bag")).toMatchObject({ total: 0, lostRank: null, foundRank: null, lostShare: 0 });
  });

  it("no posts: shares are null, not 0%", () => {
    const empty = categoryRows([]);
    expect(empty.every((r) => r.lostShare === null && r.foundShare === null && r.lostRank === null)).toBe(true);
  });
});

const totals = (rows: { lost: number; found: number }[]) => [rows.reduce((a, r) => a + r.lost, 0), rows.reduce((a, r) => a + r.found, 0)];

describe("카테고리별 현황: categoryReport (범위 x 기준)", () => {
  const report = categoryReport([
    { type: "found", code: "card_id", audience: "internal", inPeriod: true, n: 15 },
    { type: "found", code: "card_id", audience: "member", inPeriod: true, n: 2 },
    { type: "lost", code: "bag", audience: "member", inPeriod: true, n: 1 },
    { type: "lost", code: "living", audience: "internal", inPeriod: false, n: 1 },
    { type: "found", code: null, audience: "unclassified", inPeriod: false, n: 3 },
  ]);

  it("전체 counts admin and member posts (the item count); 일반 사용자 / 관리자 split them", () => {
    expect(totals(report.views.period.all)).toEqual([1, 17]);
    expect(totals(report.views.period.member)).toEqual([1, 2]);
    expect(totals(report.views.period.internal)).toEqual([0, 15]);
  });

  it("전체 누적 counts every post; a post of unknown role is in 전체 only, never guessed", () => {
    expect(totals(report.views.cumulative.all)).toEqual([2, 20]);
    expect(totals(report.views.cumulative.member)).toEqual([1, 2]);
    expect(totals(report.views.cumulative.internal)).toEqual([1, 15]);
    expect(report.unclassifiedAudience).toEqual({ period: 0, cumulative: 3 });
    // member + admin + unknown = 전체
    const [ml, mf] = totals(report.views.cumulative.member);
    const [il, iF] = totals(report.views.cumulative.internal);
    expect(ml + mf + il + iF + report.unclassifiedAudience.cumulative).toBe(22);
    expect(report.views.cumulative.all.find((r) => r.code === null)!.found).toBe(3);
  });
});

describe("카테고리별 현황: loadCategoryCounts", () => {
  it("reads every post of both tables once, with its event-time audience and whether it falls in the KST period", async () => {
    rows = [
      { type: "lost", code: "wallet", audience: "member", in_period: true, n: BigInt(2) },
      { type: "found", code: "wallet", audience: "internal", in_period: false, n: 4 },
      { type: "found", code: null, audience: null, in_period: true, n: 1 },
    ];
    const r = await loadCategoryCounts("2026-10-01", "2026-11-01");
    const q = queries[queries.length - 1];
    expect(q.sql).toContain('FROM "LostPost"');
    expect(q.sql).toContain('FROM "FoundPost"');
    expect(q.sql).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(q.sql).toContain("mju_legacy_audience");
    // no audience / status / hidden filter: the scope is applied afterwards
    expect(q.sql).not.toMatch(/WHERE|temp_hidden|deleted|status/);
    expect(q.values).toEqual(["2026-10-01", "2026-11-01", "2026-10-01", "2026-11-01"]);
    expect(r.views.period.member[0]).toMatchObject({ code: "wallet", lost: 2 });
    expect(totals(r.views.cumulative.all)).toEqual([2, 5]);
    expect(r.unclassifiedAudience.period).toBe(1);
  });

  it("a failed query is an error, not an empty table", async () => {
    const { prisma } = await import("@/lib/db/prisma");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("db down"));
    await expect(loadCategoryCounts("2026-10-01", "2026-11-01")).rejects.toThrow("db down");
  });
});

describe("카테고리별 현황 화면", () => {
  const report = categoryReport([
    { type: "lost", code: "wallet", audience: "member", inPeriod: true, n: 3 },
    { type: "found", code: "phone", audience: "internal", inPeriod: true, n: 1 },
    { type: "lost", code: null, audience: "member", inPeriod: true, n: 1 },
    { type: "found", code: "bag", audience: "unclassified", inPeriod: false, n: 2 },
  ]);

  it("paired bars for categories with posts, and the full table with shares and ranks (전체 by default)", () => {
    const html = renderToStaticMarkup(<CategoryStats report={report} scope="all" basis="period" periodLabel="이번 달" query="period=month" />);
    const bars = html.match(/<ul[^>]*aria-label="카테고리별 분실물·습득물 등록 비교"[\s\S]*?<\/ul>/)![0];
    expect([...bars.matchAll(/<li\b/g)]).toHaveLength(3);
    expect(html).toContain("분실물 4건·습득물 1건");
    expect(html).toContain("75.0%");
    expect(html).toContain("1위");
    expect(html).toContain("미분류");
    // every category is in the table, zero rows too
    expect(html).toContain("가방·파우치");
    // switches keep the page's parameters and mark the current choice
    expect(html).toContain('href="/admin/stats?period=month&amp;cs=member&amp;cb=period#category-stats"');
    expect(html).toContain('href="/admin/stats?period=month&amp;cs=all&amp;cb=cumulative#category-stats"');
    expect(html).toMatch(/aria-current="true"[^>]*>전체</);
  });

  it("일반 사용자 shows member posts only; 전체 누적 mentions posts of unknown role", () => {
    const member = renderToStaticMarkup(<CategoryStats report={report} scope="member" basis="period" periodLabel="이번 달" query="" />);
    expect(member).toContain("분실물 4건·습득물 0건");
    const cumulative = renderToStaticMarkup(<CategoryStats report={report} scope="all" basis="cumulative" periodLabel="이번 달" query="" />);
    expect(cumulative).toContain("분실물 4건·습득물 3건");
    expect(cumulative).toContain("역할을 확인할 수 없는 게시글 2건");
  });
});
