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
  { key: "active", label: "활성 이용자" },
  { key: "lost", label: "분실물 등록" },
  { key: "found", label: "습득물 등록" },
  { key: "searchKeyword", label: "키워드 검색" },
  { key: "searchSemantic", label: "자연어(AI) 검색" },
  { key: "searchImage", label: "이미지 검색" },
  { key: "recommend", label: "AI 추천 노출" },
  { key: "chatRooms", label: "신규 채팅방" },
  { key: "messages", label: "채팅 메시지" },
  { key: "returned", label: "반환 완료 처리" },
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
  returned: { table: "PostStatusChange", where: `"to_status" IN ('찾음', '완료')` },
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
