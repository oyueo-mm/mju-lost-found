import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { CATEGORY_CODES } from "@/lib/posts/categoryTaxonomy";
import { ko } from "@/lib/i18n/messages/ko";

// 운영 통계 > 카테고리별 현황: lost / found posts registered in the period, by
// main category (categoryCode). Counted exactly like the period's 분실물 /
// 습득물 등록 (report.ts): every row created in the KST range, temporarily
// hidden ones included (a deleted post has no row left). A post with no
// categoryCode yet (older posts before the taxonomy, awaiting review) is
// 미분류; a code the taxonomy no longer lists keeps its own row, so the
// rows always add up to the period's totals.

export const UNCLASSIFIED_LABEL = "미분류";

export type CategoryRow = {
  code: string | null;
  label: string;
  lost: number;
  found: number;
  total: number;
  // share of the period's lost / found registrations (null: none that period)
  lostShare: number | null;
  foundShare: number | null;
  // rank within each type by count (1 = most; ties share a rank; null: 0 posts)
  lostRank: number | null;
  foundRank: number | null;
};

const labelOf = (code: string | null) => {
  if (code === null) return UNCLASSIFIED_LABEL;
  const label = (ko as Record<string, string>)[`taxonomy.category.${code}`];
  return label ?? `알 수 없는 분류(${code})`;
};

// 1, 2, 2, 4 ... by count, descending; 0 has no rank
function ranks(values: number[]): (number | null)[] {
  return values.map((v) => (v === 0 ? null : values.filter((o) => o > v).length + 1));
}

// Every taxonomy category and 미분류 appear (0 when none), plus any other
// code found; ordered by total, then the taxonomy order (미분류 last).
export function categoryRows(counts: { type: "lost" | "found"; code: string | null; n: number }[]): CategoryRow[] {
  const codes: (string | null)[] = [...CATEGORY_CODES];
  for (const c of counts) if (c.code !== null && !codes.includes(c.code)) codes.push(c.code);
  codes.push(null);
  const sum = (type: "lost" | "found", code: string | null) => counts.filter((c) => c.type === type && c.code === code).reduce((a, c) => a + c.n, 0);
  const lost = codes.map((code) => sum("lost", code));
  const found = codes.map((code) => sum("found", code));
  const lostTotal = lost.reduce((a, n) => a + n, 0);
  const foundTotal = found.reduce((a, n) => a + n, 0);
  const lostRank = ranks(lost);
  const foundRank = ranks(found);
  const rows = codes.map((code, i) => ({
    code,
    label: labelOf(code),
    lost: lost[i],
    found: found[i],
    total: lost[i] + found[i],
    lostShare: lostTotal ? lost[i] / lostTotal : null,
    foundShare: foundTotal ? found[i] / foundTotal : null,
    lostRank: lostRank[i],
    foundRank: foundRank[i],
  }));
  // a stable sort: equal totals keep the taxonomy order
  return rows.sort((a, b) => b.total - a.total);
}

// created_at columns store UTC wall time without a zone
const kst = Prisma.raw(`(("created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')`);

// KST days [from, until)
export async function loadCategoryCounts(from: string, until: string): Promise<CategoryRow[]> {
  const rows = await prisma.$queryRaw<{ type: "lost" | "found"; code: string | null; n: bigint | number }[]>`
    SELECT 'lost' AS type, "category_code" AS code, count(*) AS n FROM "LostPost"
      WHERE ${kst} >= ${from}::date AND ${kst} < ${until}::date GROUP BY 2
    UNION ALL
    SELECT 'found', "category_code", count(*) FROM "FoundPost"
      WHERE ${kst} >= ${from}::date AND ${kst} < ${until}::date GROUP BY 2`;
  return categoryRows(rows.map((r) => ({ type: r.type, code: r.code, n: Number(r.n) })));
}
