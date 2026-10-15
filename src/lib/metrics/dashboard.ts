import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { LATENCY_BUCKETS_MS, kstDay } from "./record";

// 운영 통계 대시보드 (admin only, read-only). Counts come from the tables
// that already hold them; MetricDaily / ActivityDay / ApiMetricHourly hold
// only what nothing else records (see lib/metrics/record.ts). Every period
// is a KST calendar day / week (Mon) / month.

export type Granularity = "day" | "week" | "month";
export const PERIODS: Record<Granularity, number> = { day: 30, week: 12, month: 12 };

export const METRICS = [
  { key: "signups", label: "신규 가입" },
  { key: "active", label: "활성 회원(로그인)" },
  { key: "lost", label: "분실물 등록" },
  { key: "found", label: "습득물 등록" },
  { key: "searchKeyword", label: "키워드 검색" },
  { key: "searchSemantic", label: "자연어(AI) 검색" },
  { key: "searchImage", label: "이미지 검색" },
  { key: "recommend", label: "AI 추천 노출" },
  { key: "chatRooms", label: "신규 채팅방" },
  { key: "messages", label: "채팅 메시지" },
  { key: "completed", label: "완료 처리(작성자 표시)" },
] as const;
export type MetricKey = (typeof METRICS)[number]["key"];

// created_at columns store UTC wall time without a zone.
const kst = (column: string) => Prisma.raw(`(("${column}" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')`);

// Fixed sources only -- nothing here comes from the request.
const TIMESTAMP_SOURCES: Partial<Record<MetricKey, { table: string; where?: string }>> = {
  signups: { table: "User" },
  lost: { table: "LostPost" },
  found: { table: "FoundPost" },
  chatRooms: { table: "ChatRoom" },
  messages: { table: "Message" },
  // A poster marking the post 찾음/완료 and not putting it back since: the
  // latest status change of that post. Not a confirmed hand-over -- the app
  // records no such confirmation -- so it is never shown as one.
  completed: {
    table: "PostStatusChange",
    where: `"to_status" IN ('찾음', '완료') AND NOT EXISTS (SELECT 1 FROM "PostStatusChange" l WHERE l."post_type" = "PostStatusChange"."post_type" AND l."post_id" = "PostStatusChange"."post_id" AND l."created_at" > "PostStatusChange"."created_at")`,
  },
};
const DAILY_SOURCES: Partial<Record<MetricKey, string>> = {
  searchKeyword: "search.keyword",
  searchSemantic: "search.semantic",
  searchImage: "search.image",
  recommend: "recommend.shown",
};

export type Series = { buckets: string[]; values: Record<MetricKey, number[]> };

function addPeriods(day: string, unit: Granularity, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (unit === "day") d.setUTCDate(d.getUTCDate() + n);
  else if (unit === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function periodStart(day: string, unit: Granularity): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (unit === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (unit === "month") d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

export function bucketList(unit: Granularity, today = kstDay()): string[] {
  const last = periodStart(today, unit);
  return Array.from({ length: PERIODS[unit] }, (_, i) => addPeriods(last, unit, i - (PERIODS[unit] - 1)));
}

type Row = { bucket: Date | string; n: bigint | number };
const asDay = (b: Date | string) => (typeof b === "string" ? b.slice(0, 10) : b.toISOString().slice(0, 10));

export async function loadSeries(unit: Granularity, today = kstDay()): Promise<Series> {
  const buckets = bucketList(unit, today);
  const from = buckets[0];
  const until = addPeriods(buckets[buckets.length - 1], unit, 1);
  const trunc = Prisma.raw(`'${unit}'`);
  const values = Object.fromEntries(METRICS.map((m) => [m.key, buckets.map(() => 0)])) as Record<MetricKey, number[]>;
  const put = (key: MetricKey, rows: Row[]) => {
    for (const r of rows) {
      const i = buckets.indexOf(asDay(r.bucket));
      if (i >= 0) values[key][i] = Number(r.n);
    }
  };

  await Promise.all([
    ...Object.entries(TIMESTAMP_SOURCES).map(async ([key, src]) => {
      const where = src!.where ? Prisma.sql`AND ${Prisma.raw(src!.where)}` : Prisma.empty;
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT date_trunc(${trunc}, ${kst("created_at")})::date AS bucket, count(*) AS n
        FROM ${Prisma.raw(`"${src!.table}"`)}
        WHERE ${kst("created_at")} >= ${from}::date AND ${kst("created_at")} < ${until}::date ${where}
        GROUP BY 1`;
      put(key as MetricKey, rows);
    }),
    ...Object.entries(DAILY_SOURCES).map(async ([key, metric]) => {
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT date_trunc(${trunc}, "day")::date AS bucket, sum("value") AS n
        FROM "MetricDaily" WHERE "metric" = ${metric} AND "day" >= ${from}::date AND "day" < ${until}::date
        GROUP BY 1`.catch(() => [] as Row[]);
      put(key as MetricKey, rows);
    }),
    (async () => {
      // Distinct members per period (a member active on 5 days of a week is
      // one weekly active member).
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT date_trunc(${trunc}, "day")::date AS bucket, count(DISTINCT "actor") AS n
        FROM "ActivityDay" WHERE "day" >= ${from}::date AND "day" < ${until}::date
        GROUP BY 1`.catch(() => [] as Row[]);
      put("active", rows);
    })(),
  ]);
  return { buckets, values };
}

// 홍보 전후 비교: the `days` days before `pivot` vs `pivot` and the `days`
// days after it (pivot day included in "after").
export async function loadComparison(pivot: string, days: number): Promise<{ before: Record<MetricKey, number>; after: Record<MetricKey, number> }> {
  const ranges = { before: [addPeriods(pivot, "day", -days), pivot], after: [pivot, addPeriods(pivot, "day", days)] } as const;
  const out = { before: {}, after: {} } as { before: Record<MetricKey, number>; after: Record<MetricKey, number> };
  await Promise.all(
    (["before", "after"] as const).map(async (side) => {
      const [from, until] = ranges[side];
      const result = {} as Record<MetricKey, number>;
      await Promise.all([
        ...Object.entries(TIMESTAMP_SOURCES).map(async ([key, src]) => {
          const where = src!.where ? Prisma.sql`AND ${Prisma.raw(src!.where)}` : Prisma.empty;
          const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM ${Prisma.raw(`"${src!.table}"`)}
            WHERE ${kst("created_at")} >= ${from}::date AND ${kst("created_at")} < ${until}::date ${where}`;
          result[key as MetricKey] = Number(r.n);
        }),
        ...Object.entries(DAILY_SOURCES).map(async ([key, metric]) => {
          const rows = await prisma.$queryRaw<{ n: bigint | null }[]>`
            SELECT sum("value") AS n FROM "MetricDaily" WHERE "metric" = ${metric} AND "day" >= ${from}::date AND "day" < ${until}::date`.catch(() => []);
          result[key as MetricKey] = Number(rows[0]?.n ?? 0);
        }),
        (async () => {
          const rows = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(DISTINCT "actor") AS n FROM "ActivityDay" WHERE "day" >= ${from}::date AND "day" < ${until}::date`.catch(() => []);
          result.active = Number(rows[0]?.n ?? 0);
        })(),
      ]);
      out[side] = result;
    }),
  );
  return out;
}

// ---------- API / AI / DB timings ----------

export type TimingRow = { route: string; count: number; errors: number; avgMs: number; p50: string; p95: string };

// Upper bound of the bucket holding the q-quantile ("≤ 400ms"), or "> 6400ms".
export function percentileLabel(buckets: number[], q: number): string {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return "-";
  const target = Math.ceil(total * q);
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    seen += buckets[i];
    if (seen >= target) {
      return i < LATENCY_BUCKETS_MS.length ? `≤ ${LATENCY_BUCKETS_MS[i]}ms` : `> ${LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]}ms`;
    }
  }
  return "-";
}

export async function loadTimings(hours: number): Promise<TimingRow[]> {
  const rows = await prisma.$queryRaw<{ route: string; count: bigint; errors: bigint; total_ms: bigint; buckets: number[] }[]>`
    SELECT "route", sum("count") AS count, sum("errors") AS errors, sum("total_ms") AS total_ms,
      ARRAY(SELECT sum(b)::int FROM "ApiMetricHourly" h2, unnest(h2."buckets") WITH ORDINALITY AS u(b, i)
            WHERE h2."route" = h."route" AND h2."hour" >= now() AT TIME ZONE 'UTC' - make_interval(hours => ${hours})
            GROUP BY i ORDER BY i) AS buckets
    FROM "ApiMetricHourly" h
    WHERE "hour" >= now() AT TIME ZONE 'UTC' - make_interval(hours => ${hours})
    GROUP BY "route"
    ORDER BY sum("count") DESC`.catch(() => []);
  return rows.map((r) => {
    const count = Number(r.count);
    return {
      route: r.route,
      count,
      errors: Number(r.errors),
      avgMs: count ? Math.round(Number(r.total_ms) / count) : 0,
      p50: percentileLabel(r.buckets, 0.5),
      p95: percentileLabel(r.buckets, 0.95),
    };
  });
}

// Free-plan limits this service runs on (Supabase Free).
export const FREE_LIMITS_MB = { db: 500, storage: 1024 } as const;

export async function loadCapacity(): Promise<{ day: string; dbMb: number; storageMb: number } | null> {
  const rows = await prisma.$queryRaw<{ day: Date; metric: string; value: number }[]>`
    SELECT "day", "metric", "value" FROM "MetricDaily"
    WHERE "metric" IN ('capacity.db_mb', 'capacity.storage_mb')
      AND "day" = (SELECT max("day") FROM "MetricDaily" WHERE "metric" = 'capacity.db_mb')`.catch(() => []);
  if (rows.length === 0) return null;
  const pick = (m: string) => rows.find((r) => r.metric === m)?.value ?? 0;
  return { day: asDay(rows[0].day), dbMb: pick("capacity.db_mb"), storageMb: pick("capacity.storage_mb") };
}

// ---------- 방문 통계 (visit.* and search.*.<audience> in MetricDaily) ----------
// Page views and visit sessions from the browser beacon (see
// lib/metrics/visits.ts and app/visitActions.ts), and the searches split by
// who made them. A visit session is not a person: the same person on two
// devices, or after clearing site data, is two sessions.
export const VISIT_SERIES = [
  { key: "pvAnon", label: "페이지뷰(비로그인)", metrics: ["visit.pv.anon"] },
  { key: "pvMember", label: "페이지뷰(로그인)", metrics: ["visit.pv.member"] },
  { key: "sessionAnon", label: "방문 세션(비로그인)", metrics: ["visit.session.anon"] },
  { key: "sessionMember", label: "방문 세션(로그인)", metrics: ["visit.session.member"] },
  { key: "searchAnon", label: "검색(비로그인)", metrics: ["search.keyword.anon", "search.semantic.anon", "search.image.anon"] },
  { key: "searchMember", label: "검색(로그인)", metrics: ["search.keyword.member", "search.semantic.member", "search.image.member"] },
  { key: "internalPv", label: "관리자 페이지뷰(제외분)", metrics: ["visit.internal.pv"] },
] as const;
export type VisitSeriesKey = (typeof VISIT_SERIES)[number]["key"];

export type VisitBreakdown = {
  pages: { kind: string; anon: number; member: number }[];
  refs: { source: string; sessions: number }[];
  utmSources: { value: string; sessions: number }[];
  utmCampaigns: { value: string; sessions: number }[];
};
export type VisitStats = { buckets: string[]; values: Record<VisitSeriesKey, number[]>; breakdown: VisitBreakdown };

type MetricRow = { bucket: Date | string; metric: string; n: bigint | number };

function breakdownOf(totals: Map<string, number>): VisitBreakdown {
  const pages = new Map<string, { anon: number; member: number }>();
  const refs: VisitBreakdown["refs"] = [];
  const utmSources: VisitBreakdown["utmSources"] = [];
  const utmCampaigns: VisitBreakdown["utmCampaigns"] = [];
  for (const [metric, n] of totals) {
    const page = /^visit\.page\.([a-z_]+)\.(anon|member)$/.exec(metric);
    if (page) {
      const row = pages.get(page[1]) ?? { anon: 0, member: 0 };
      row[page[2] as "anon" | "member"] += n;
      pages.set(page[1], row);
    } else if (metric.startsWith("visit.ref.")) refs.push({ source: metric.slice(10), sessions: n });
    else if (metric.startsWith("visit.utm_source.")) utmSources.push({ value: metric.slice(17), sessions: n });
    else if (metric.startsWith("visit.utm_campaign.")) utmCampaigns.push({ value: metric.slice(19), sessions: n });
  }
  const bySize = <T extends { sessions: number }>(a: T, b: T) => b.sessions - a.sessions;
  return {
    pages: [...pages.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.anon + b.member - (a.anon + a.member)),
    refs: refs.sort(bySize),
    utmSources: utmSources.sort(bySize).slice(0, 20),
    utmCampaigns: utmCampaigns.sort(bySize).slice(0, 20),
  };
}

// One query for the whole range: per-period series plus the range's
// breakdown by page kind, referrer and UTM tag.
export async function loadVisitStats(unit: Granularity, today = kstDay()): Promise<VisitStats> {
  const buckets = bucketList(unit, today);
  const from = buckets[0];
  const until = addPeriods(buckets[buckets.length - 1], unit, 1);
  const trunc = Prisma.raw(`'${unit}'`);
  const rows = await prisma.$queryRaw<MetricRow[]>`
    SELECT date_trunc(${trunc}, "day")::date AS bucket, "metric", sum("value") AS n
    FROM "MetricDaily"
    WHERE ("metric" LIKE 'visit.%' OR "metric" LIKE 'search.%.%') AND "day" >= ${from}::date AND "day" < ${until}::date
    GROUP BY 1, 2`.catch(() => [] as MetricRow[]);

  const values = Object.fromEntries(VISIT_SERIES.map((s) => [s.key, buckets.map(() => 0)])) as Record<VisitSeriesKey, number[]>;
  const seriesOf = new Map<string, VisitSeriesKey>(VISIT_SERIES.flatMap((s) => s.metrics.map((m) => [m, s.key] as const)));
  const totals = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.n);
    totals.set(r.metric, (totals.get(r.metric) ?? 0) + n);
    const key = seriesOf.get(r.metric);
    const i = buckets.indexOf(asDay(r.bucket));
    if (key && i >= 0) values[key][i] += n;
  }
  return { buckets, values, breakdown: breakdownOf(totals) };
}

// 홍보 전후 비교 for the visit series: `days` days before `pivot` vs `pivot`
// and the `days` days after it.
export async function loadVisitComparison(
  pivot: string,
  days: number,
): Promise<{ before: Record<VisitSeriesKey, number>; after: Record<VisitSeriesKey, number> }> {
  const sum = async (from: string, until: string) => {
    const rows = await prisma.$queryRaw<{ metric: string; n: bigint | number }[]>`
      SELECT "metric", sum("value") AS n FROM "MetricDaily"
      WHERE ("metric" LIKE 'visit.%' OR "metric" LIKE 'search.%.%') AND "day" >= ${from}::date AND "day" < ${until}::date
      GROUP BY 1`.catch(() => []);
    const byMetric = new Map(rows.map((r) => [r.metric, Number(r.n)]));
    return Object.fromEntries(
      VISIT_SERIES.map((s) => [s.key, s.metrics.reduce((acc, m) => acc + (byMetric.get(m) ?? 0), 0)]),
    ) as Record<VisitSeriesKey, number>;
  };
  const [before, after] = await Promise.all([
    sum(addPeriods(pivot, "day", -days), pivot),
    sum(pivot, addPeriods(pivot, "day", days)),
  ]);
  return { before, after };
}
