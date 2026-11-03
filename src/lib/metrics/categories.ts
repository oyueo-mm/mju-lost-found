import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { CATEGORY_CODES } from "@/lib/posts/categoryTaxonomy";
import { ko } from "@/lib/i18n/messages/ko";
import { tableAudienceSql } from "./legacyAudience";

// 운영 통계 > 카테고리별 현황: lost / found posts by main category
// (categoryCode). This is an item count (물품 현황), not member activity: by
// default every post is counted, whoever wrote it. The scope narrows it to
// posts written as a member or as an administrator (event-time audience,
// legacyAudience.ts); a legacy post whose author's role at the time cannot be
// shown is in 전체 only, never guessed into either. The basis is the period's
// registrations (rows created in the KST range) or everything the DB holds
// now (누적). Temporarily hidden posts are included (a deleted post has no
// row left). A post with no categoryCode yet is 미분류; a code the taxonomy no
// longer lists keeps its own row, so the rows always add up to the totals.

export const UNCLASSIFIED_LABEL = "미분류";

export const CATEGORY_SCOPES = ["all", "member", "internal"] as const;
export type CategoryScope = (typeof CATEGORY_SCOPES)[number];
export const CATEGORY_SCOPE_LABELS: Record<CategoryScope, string> = { all: "전체", member: "일반 사용자", internal: "관리자" };
export const CATEGORY_BASES = ["period", "cumulative"] as const;
export type CategoryBasis = (typeof CATEGORY_BASES)[number];
export const CATEGORY_BASIS_LABELS: Record<CategoryBasis, string> = { period: "조회 기간 등록", cumulative: "전체 누적" };
export const isCategoryScope = (v: unknown): v is CategoryScope => (CATEGORY_SCOPES as readonly unknown[]).includes(v);
export const isCategoryBasis = (v: unknown): v is CategoryBasis => (CATEGORY_BASES as readonly unknown[]).includes(v);

export type CategoryRow = {
  code: string | null;
  label: string;
  lost: number;
  found: number;
  total: number;
  // share of the lost / found posts counted (null: none)
  lostShare: number | null;
  foundShare: number | null;
  // rank within each type by count (1 = most; ties share a rank; null: 0 posts)
  lostRank: number | null;
  foundRank: number | null;
};

// One group of posts: type, main category, event-time audience, and whether it
// was created in the period.
export type CategoryCount = { type: "lost" | "found"; code: string | null; audience: "member" | "internal" | "unclassified"; inPeriod: boolean; n: number };

export type CategoryReport = {
  counts: CategoryCount[];
  // rows per basis and scope
  views: Record<CategoryBasis, Record<CategoryScope, CategoryRow[]>>;
  // posts in 전체 whose author's role at the time is unknown (in neither scope)
  unclassifiedAudience: Record<CategoryBasis, number>;
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

const inScope = (scope: CategoryScope, c: CategoryCount) => scope === "all" || c.audience === scope;
const inBasis = (basis: CategoryBasis, c: CategoryCount) => basis === "cumulative" || c.inPeriod;

export function categoryReport(counts: CategoryCount[]): CategoryReport {
  const views = Object.fromEntries(
    CATEGORY_BASES.map((basis) => [basis, Object.fromEntries(CATEGORY_SCOPES.map((scope) => [scope, categoryRows(counts.filter((c) => inBasis(basis, c) && inScope(scope, c)))]))]),
  ) as CategoryReport["views"];
  const unclassifiedAudience = Object.fromEntries(
    CATEGORY_BASES.map((basis) => [basis, counts.filter((c) => inBasis(basis, c) && c.audience === "unclassified").reduce((a, c) => a + c.n, 0)]),
  ) as CategoryReport["unclassifiedAudience"];
  return { counts, views, unclassifiedAudience };
}

// created_at columns store UTC wall time without a zone
const kst = Prisma.raw(`(("created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')`);

// Every post the DB holds, grouped; the period is KST days [from, until).
// A failure is thrown, never shown as 0.
export async function loadCategoryCounts(from: string, until: string): Promise<CategoryReport> {
  const rows = await prisma.$queryRaw<{ type: "lost" | "found"; code: string | null; audience: string | null; in_period: boolean; n: bigint | number }[]>`
    SELECT 'lost' AS type, "category_code" AS code, ${tableAudienceSql("LostPost")} AS audience,
        (${kst} >= ${from}::date AND ${kst} < ${until}::date) AS in_period, count(*) AS n
      FROM "LostPost" GROUP BY 2, 3, 4
    UNION ALL
    SELECT 'found', "category_code", ${tableAudienceSql("FoundPost")},
        (${kst} >= ${from}::date AND ${kst} < ${until}::date), count(*)
      FROM "FoundPost" GROUP BY 2, 3, 4`;
  return categoryReport(
    rows.map((r) => ({
      type: r.type,
      code: r.code,
      audience: r.audience === "member" || r.audience === "internal" ? r.audience : "unclassified",
      inPeriod: r.in_period === true,
      n: Number(r.n),
    })),
  );
}
