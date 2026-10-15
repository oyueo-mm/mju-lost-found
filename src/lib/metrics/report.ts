import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  addPeriods,
  breakdownOf,
  loadCapacity,
  METRICS,
  periodStart,
  percentileLabel,
  VISIT_SERIES,
  type Granularity,
  type MetricKey,
  type TimingRow,
  type VisitBreakdown,
  type VisitSeriesKey,
} from "./dashboard";
import { API_METRIC_RETENTION_DAYS } from "@/lib/retention/policy";
import { PERIOD_PRESETS, type PeriodPreset } from "./exportOptions";
import { kstDay } from "./record";

// 운영 통계 for any KST date range -- the one loader behind both the
// /admin/stats dashboard and its Excel/CSV export, so the two always show
// the same numbers. Read-only: aggregate SELECTs over the tables that
// already hold the counts; nothing per person leaves this module.

// When each kind of count began on Production (KST). Before these moments
// nothing was recorded: those periods are "미측정", never 0. Counts read
// from the service's own tables (가입, 게시글, 채팅) go back to the start.
export const COLLECTION_SINCE = {
  // 운영 지표: 검색·AI 추천·활성 회원·응답 시간 (release bde8915)
  ops: "2026-10-15T03:35",
  // 방문 통계 and the 로그인·비로그인 split of searches (release 8be50b6)
  visit: "2026-10-15T19:14",
  // 게시글 상태 변경 이력 (완료 처리)
  completed: "2026-10-13T00:00",
} as const;
export type CollectionSource = keyof typeof COLLECTION_SINCE;

// From this moment keyword searches on the board / search pages are counted
// too (before: only searches through the API). Counts before and after it
// are not directly comparable.
export const KEYWORD_BASIS_CHANGED_AT = "2026-10-15T19:14";

export const SOURCE_OF: Record<MetricKey | VisitSeriesKey, CollectionSource | null> = {
  signups: null,
  lost: null,
  found: null,
  chatRooms: null,
  messages: null,
  completed: "completed",
  active: "ops",
  searchKeyword: "ops",
  searchSemantic: "ops",
  searchImage: "ops",
  recommend: "ops",
  pvAnon: "visit",
  pvMember: "visit",
  sessionAnon: "visit",
  sessionMember: "visit",
  searchAnon: "visit",
  searchMember: "visit",
  internalPv: "visit",
};

export type Coverage = "full" | "partial" | "none";

// Is [from, until) (KST days, `until` exclusive) measured by `source`?
export function coverageOf(source: CollectionSource | null, from: string, until: string): Coverage {
  if (!source) return "full";
  const since = COLLECTION_SINCE[source];
  const sinceDay = since.slice(0, 10);
  const midDay = !since.endsWith("T00:00");
  if (until <= sinceDay) return "none";
  if (from > sinceDay) return "full";
  if (from === sinceDay) return midDay ? "partial" : "full";
  return "partial";
}

export const sinceLabel = (source: CollectionSource) => {
  const [day, time] = COLLECTION_SINCE[source].split("T");
  return time === "00:00" ? day : `${day} ${time}`;
};

export type ReportRange = { from: string; until: string; unit: Granularity };

export const MAX_RANGE_DAYS = 400;

export function daysBetween(from: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// 조회 기간 (KST): 오늘 / 이번 주 (월요일 시작) / 이번 달 / 올해 run up to
// today, inclusive; 사용자 지정 is any [from, to] up to today. The chart unit
// follows the length: up to 31 days by day, up to 26 weeks by week, longer
// by month. Daily counts are the finest the stores hold (MetricDaily is per
// day), so nothing is ever shown by hour.
export { PERIOD_PRESETS, type PeriodPreset };
export type PeriodSelection = { preset: PeriodPreset; from?: string; to?: string };
export const MAX_CUSTOM_DAYS = 366;
export const EARLIEST_DAY = "2024-01-01";

export function autoUnit(from: string, until: string): Granularity {
  const days = daysBetween(from, until);
  return days <= 31 ? "day" : days <= 183 ? "week" : "month";
}

const isDay = (v: string | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

export type ResolvedPeriod = { range: ReportRange; selection: PeriodSelection; label: string };

export function resolvePeriod(selection: PeriodSelection, today = kstDay()): ResolvedPeriod | { error: string } {
  const until = addPeriods(today, "day", 1);
  let from: string;
  let to = today;
  switch (selection.preset) {
    case "today":
      from = today;
      break;
    case "week":
      from = periodStart(today, "week");
      break;
    case "month":
      from = periodStart(today, "month");
      break;
    case "year":
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case "custom": {
      if (!isDay(selection.from) || !isDay(selection.to)) return { error: "시작일과 종료일을 모두 골라 주세요." };
      if (selection.from > selection.to) return { error: "시작일이 종료일보다 늦습니다." };
      if (selection.to > today) return { error: "종료일은 오늘 이후로 고를 수 없습니다." };
      if (selection.from < EARLIEST_DAY) return { error: `${EARLIEST_DAY} 이후로 골라 주세요.` };
      if (daysBetween(selection.from, addPeriods(selection.to, "day", 1)) > MAX_CUSTOM_DAYS) return { error: `기간은 최대 ${MAX_CUSTOM_DAYS}일까지 고를 수 있습니다.` };
      from = selection.from;
      to = selection.to;
      break;
    }
    default:
      return { error: "조회 기간을 확인해 주세요." };
  }
  const end = addPeriods(to, "day", 1);
  const preset = PERIOD_PRESETS.find((p) => p.key === selection.preset)!.label;
  const span = from === to ? `${from}` : `${from} ~ ${to}`;
  return {
    range: { from, until: selection.preset === "custom" ? end : until, unit: autoUnit(from, end) },
    selection: selection.preset === "custom" ? { preset: "custom", from, to } : { preset: selection.preset },
    label: selection.preset === "custom" ? `${md(from)} ~ ${md(to)} (${span})` : `${preset} (${span})`,
  };
}

export function bucketsOf(range: ReportRange): string[] {
  const out: string[] = [];
  for (let b = periodStart(range.from, range.unit); b < range.until && out.length <= MAX_RANGE_DAYS; b = addPeriods(b, range.unit, 1)) out.push(b);
  return out;
}

// A bucket's own days, clipped to the range.
export function bucketSpan(range: ReportRange, bucket: string): { from: string; until: string } {
  const end = addPeriods(bucket, range.unit, 1);
  return { from: bucket < range.from ? range.from : bucket, until: end > range.until ? range.until : end };
}

type Values<K extends string> = Record<K, (number | null)[]>;

export type Report = {
  range: ReportRange;
  buckets: string[];
  generatedAt: string; // KST "YYYY-MM-DD HH:mm"
  today: string; // KST day the report was made
  // null = 미측정 (that period is before the count began)
  core: Values<MetricKey>;
  visit: Values<VisitSeriesKey>;
  completedByType: { lost: (number | null)[]; found: (number | null)[] };
  coverage: Record<MetricKey | VisitSeriesKey, Coverage[]>;
  totals: Record<MetricKey | VisitSeriesKey, number | null>;
  totalCoverage: Record<MetricKey | VisitSeriesKey, Coverage>;
  breakdown: VisitBreakdown;
  // Admins' searches (search.*.internal): in the totals, in neither column.
  internalSearches: number;
  timings: TimingRow[];
  capacity: Awaited<ReturnType<typeof loadCapacity>>;
};

// created_at columns store UTC wall time without a zone.
const kst = (column: string) => Prisma.raw(`(("${column}" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')`);

const TIMESTAMP_SOURCES: { key: MetricKey; table: string }[] = [
  { key: "signups", table: "User" },
  { key: "lost", table: "LostPost" },
  { key: "found", table: "FoundPost" },
  { key: "chatRooms", table: "ChatRoom" },
  { key: "messages", table: "Message" },
];
// A poster marking the post 찾음/완료 and not putting it back since (the
// latest status change of that post). Not a confirmed hand-over.
const COMPLETED_WHERE = Prisma.raw(
  `"to_status" IN ('찾음', '완료') AND NOT EXISTS (SELECT 1 FROM "PostStatusChange" l WHERE l."post_type" = "PostStatusChange"."post_type" AND l."post_id" = "PostStatusChange"."post_id" AND l."created_at" > "PostStatusChange"."created_at")`,
);
const DAILY_SOURCES: Partial<Record<MetricKey, string>> = {
  searchKeyword: "search.keyword",
  searchSemantic: "search.semantic",
  searchImage: "search.image",
  recommend: "recommend.shown",
};

type Row = { bucket: Date | string; n: bigint | number };
const asDay = (b: Date | string) => (typeof b === "string" ? b.slice(0, 10) : b.toISOString().slice(0, 10));

export function kstNow(at = new Date()): string {
  return new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

export async function loadReport(range: ReportRange, { now = new Date() } = {}): Promise<Report> {
  const buckets = bucketsOf(range);
  const { from, until } = range;
  const trunc = Prisma.raw(`'${range.unit}'`);
  const zeros = () => buckets.map(() => 0 as number | null);
  const core = Object.fromEntries(METRICS.map((m) => [m.key, zeros()])) as Values<MetricKey>;
  const visit = Object.fromEntries(VISIT_SERIES.map((s) => [s.key, zeros()])) as Values<VisitSeriesKey>;
  const completedByType = { lost: zeros(), found: zeros() };
  const put = (target: (number | null)[], rows: Row[]) => {
    for (const r of rows) {
      const i = buckets.indexOf(asDay(r.bucket));
      if (i >= 0) target[i] = (target[i] ?? 0) + Number(r.n);
    }
  };
  let activeTotal = 0;
  let visitTotals = new Map<string, number>();

  await Promise.all([
    ...TIMESTAMP_SOURCES.map(async ({ key, table }) => {
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT date_trunc(${trunc}, ${kst("created_at")})::date AS bucket, count(*) AS n
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE ${kst("created_at")} >= ${from}::date AND ${kst("created_at")} < ${until}::date
        GROUP BY 1`;
      put(core[key], rows);
    }),
    (async () => {
      const rows = await prisma.$queryRaw<(Row & { post_type: string })[]>`
        SELECT date_trunc(${trunc}, ${kst("created_at")})::date AS bucket, "post_type", count(*) AS n
        FROM "PostStatusChange"
        WHERE ${kst("created_at")} >= ${from}::date AND ${kst("created_at")} < ${until}::date AND ${COMPLETED_WHERE}
        GROUP BY 1, 2`;
      put(core.completed, rows);
      put(completedByType.lost, rows.filter((r) => r.post_type === "lost"));
      put(completedByType.found, rows.filter((r) => r.post_type === "found"));
    })(),
    ...Object.entries(DAILY_SOURCES).map(async ([key, metric]) => {
      const rows = await prisma.$queryRaw<Row[]>`
        SELECT date_trunc(${trunc}, "day")::date AS bucket, sum("value") AS n
        FROM "MetricDaily" WHERE "metric" = ${metric} AND "day" >= ${from}::date AND "day" < ${until}::date
        GROUP BY 1`.catch(() => [] as Row[]);
      put(core[key as MetricKey], rows);
    }),
    (async () => {
      // Distinct members per period, and over the whole range (a member
      // active on 5 days of a week is one weekly active member).
      const [rows, total] = await Promise.all([
        prisma.$queryRaw<Row[]>`
          SELECT date_trunc(${trunc}, "day")::date AS bucket, count(DISTINCT "actor") AS n
          FROM "ActivityDay" WHERE "day" >= ${from}::date AND "day" < ${until}::date
          GROUP BY 1`.catch(() => [] as Row[]),
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(DISTINCT "actor") AS n FROM "ActivityDay" WHERE "day" >= ${from}::date AND "day" < ${until}::date`.catch(() => []),
      ]);
      put(core.active, rows);
      activeTotal = Number(total[0]?.n ?? 0);
    })(),
    (async () => {
      const rows = await prisma.$queryRaw<(Row & { metric: string })[]>`
        SELECT date_trunc(${trunc}, "day")::date AS bucket, "metric", sum("value") AS n
        FROM "MetricDaily"
        WHERE ("metric" LIKE 'visit.%' OR "metric" LIKE 'search.%.%') AND "day" >= ${from}::date AND "day" < ${until}::date
        GROUP BY 1, 2`.catch(() => []);
      const seriesOf = new Map<string, VisitSeriesKey>(VISIT_SERIES.flatMap((s) => s.metrics.map((m) => [m, s.key] as const)));
      visitTotals = new Map();
      for (const r of rows) {
        visitTotals.set(r.metric, (visitTotals.get(r.metric) ?? 0) + Number(r.n));
        const key = seriesOf.get(r.metric);
        if (key) put(visit[key], [r]);
      }
    })(),
  ]);

  const [timings, capacity] = await Promise.all([loadTimingsBetween(from, until), loadCapacity()]);

  // Periods before a count began are 미측정 (null), whatever the table holds.
  const coverage = {} as Report["coverage"];
  const totals = {} as Report["totals"];
  const totalCoverage = {} as Report["totalCoverage"];
  const all: [MetricKey | VisitSeriesKey, (number | null)[]][] = [...Object.entries(core), ...Object.entries(visit)] as never;
  for (const [key, values] of all) {
    const source = SOURCE_OF[key];
    coverage[key] = buckets.map((b) => {
      const span = bucketSpan(range, b);
      return coverageOf(source, span.from, span.until);
    });
    coverage[key].forEach((c, i) => {
      if (c === "none") values[i] = null;
    });
    totalCoverage[key] = coverageOf(source, from, until);
    totals[key] = totalCoverage[key] === "none" ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0);
  }
  totals.active = totalCoverage.active === "none" ? null : activeTotal;
  completedByType.lost.forEach((_, i) => {
    if (coverage.completed[i] === "none") completedByType.lost[i] = completedByType.found[i] = null;
  });

  return {
    range,
    buckets,
    generatedAt: kstNow(now),
    today: kstDay(now),
    core,
    visit,
    completedByType,
    coverage,
    totals,
    totalCoverage,
    breakdown: totalCoverage.pvAnon === "none" ? breakdownOf(new Map()) : breakdownOf(visitTotals),
    internalSearches: [...visitTotals].reduce((a, [m, n]) => (/^search\.[a-z]+\.internal$/.test(m) ? a + n : a), 0),
    timings,
    capacity,
  };
}

// API / AI / DB timings for the KST days [from, until). Hours are stored as
// UTC wall time.
export async function loadTimingsBetween(from: string, until: string): Promise<TimingRow[]> {
  const rows = await prisma.$queryRaw<{ route: string; count: bigint; errors: bigint; total_ms: bigint; buckets: number[] }[]>`
    SELECT "route", sum("count") AS count, sum("errors") AS errors, sum("total_ms") AS total_ms,
      ARRAY(SELECT sum(b)::int FROM "ApiMetricHourly" h2, unnest(h2."buckets") WITH ORDINALITY AS u(b, i)
            WHERE h2."route" = h."route" AND h2."hour" >= ${from}::timestamp - interval '9 hours' AND h2."hour" < ${until}::timestamp - interval '9 hours'
            GROUP BY i ORDER BY i) AS buckets
    FROM "ApiMetricHourly" h
    WHERE "hour" >= ${from}::timestamp - interval '9 hours' AND "hour" < ${until}::timestamp - interval '9 hours'
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
      totalMs: Number(r.total_ms),
      buckets: r.buckets,
    };
  });
}

// One line for a group of routes: requests, error rate, mean, p95.
export type TimingSummary = { count: number; errors: number; errorRate: number | null; avgMs: number | null; p95: string };
export function summarizeTimings(rows: TimingRow[]): TimingSummary {
  const count = rows.reduce((a, r) => a + r.count, 0);
  const errors = rows.reduce((a, r) => a + r.errors, 0);
  const totalMs = rows.reduce((a, r) => a + (r.totalMs ?? r.avgMs * r.count), 0);
  const merged: number[] = [];
  for (const r of rows) (r.buckets ?? []).forEach((n, i) => (merged[i] = (merged[i] ?? 0) + n));
  return {
    count,
    errors,
    errorRate: count ? errors / count : null,
    avgMs: count ? Math.round(totalMs / count) : null,
    p95: percentileLabel(merged, 0.95),
  };
}

// API 성능 통계 (ApiMetricHourly) is kept per hour, so any KST day range can
// be summed exactly -- but only for the last API_METRIC_RETENTION_DAYS days
// (older hours are deleted by the nightly clean-up) and only since the
// 운영 지표 release. Says which part of the range the numbers cover.
export function apiCoverage(range: ReportRange, today = kstDay()): { coverage: Coverage; note: string | null } {
  const kept = addPeriods(today, "day", -(API_METRIC_RETENTION_DAYS - 1));
  const since = coverageOf("ops", range.from, range.until);
  if (since === "none" || range.until <= kept) return { coverage: "none", note: `이 기간은 API 성능 기록이 없습니다(${sinceLabel("ops")}부터 집계, 최근 ${API_METRIC_RETENTION_DAYS}일만 보관).` };
  const notes: string[] = [];
  if (since === "partial") notes.push(`${sinceLabel("ops")}부터 집계`);
  if (range.from < kept) notes.push(`최근 ${API_METRIC_RETENTION_DAYS}일만 보관되어 ${kept} 이후 값만 포함`);
  return { coverage: notes.length ? "partial" : "full", note: notes.length ? `API 성능 통계는 ${notes.join(", ")}합니다.` : null };
}

export const isInternalRoute = (route: string) => route.startsWith("ai:") || route.startsWith("db:");

// Searches in the range that happened before the 로그인·비로그인 split began
// (counted in the totals only).
export function unsplitSearches(report: Report): number | null {
  const total = [report.totals.searchKeyword, report.totals.searchSemantic, report.totals.searchImage];
  if (total.every((v) => v === null)) return null;
  const sum = total.reduce<number>((a, v) => a + (v ?? 0), 0);
  return Math.max(0, sum - (report.totals.searchAnon ?? 0) - (report.totals.searchMember ?? 0) - report.internalSearches);
}
