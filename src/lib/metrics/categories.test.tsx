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

const { categoryRows, loadCategoryCounts, UNCLASSIFIED_LABEL } = await import("./categories");
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
      ["휴대폰", 3],
      ["카드·신분증", 3],
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

describe("카테고리별 현황: loadCategoryCounts", () => {
  it("counts both tables by KST created day in [from, until), no status / hidden filter (same as 분실물·습득물 등록)", async () => {
    rows = [{ type: "lost", code: "wallet", n: BigInt(2) }];
    const r = await loadCategoryCounts("2026-10-01", "2026-11-01");
    const [q] = queries;
    expect(q.sql).toContain('FROM "LostPost"');
    expect(q.sql).toContain('FROM "FoundPost"');
    expect(q.sql).toContain("AT TIME ZONE 'Asia/Seoul'");
    expect(q.sql).not.toMatch(/temp_hidden|deleted|status/);
    expect(q.values).toEqual(["2026-10-01", "2026-11-01", "2026-10-01", "2026-11-01"]);
    expect(r[0]).toMatchObject({ code: "wallet", lost: 2 });
  });
});

describe("카테고리별 현황 화면", () => {
  it("paired bars for categories with posts, and the full table with shares and ranks", () => {
    const html = renderToStaticMarkup(
      <CategoryStats
        periodLabel="이번 달"
        rows={categoryRows([
          { type: "lost", code: "wallet", n: 3 },
          { type: "found", code: "phone", n: 1 },
          { type: "lost", code: null, n: 1 },
        ])}
      />,
    );
    const bars = html.match(/<ul[^>]*aria-label="카테고리별 분실물·습득물 등록 비교"[\s\S]*?<\/ul>/)![0];
    expect([...bars.matchAll(/<li\b/g)]).toHaveLength(3);
    expect(html).toContain("분실물 4건·습득물 1건");
    expect(html).toContain("75.0%");
    expect(html).toContain("1위");
    expect(html).toContain("미분류");
    // every category is in the table, zero rows too
    expect(html).toContain("가방·파우치");
  });
});
