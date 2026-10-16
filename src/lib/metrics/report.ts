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
import { DURATION_BUCKETS, PAGES_BUCKETS, type DurationBucket, type PagesBucket } from "./flow";
import { DEVICE_KINDS, PAGE_KINDS, type DeviceKind, type PageKind } from "./visits";

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
// For a count whose start is only known from the data (its first recorded
// day): before that day 미측정, the first day itself partial.
export function coverageSinceDay(firstDay: string | null, from: string, until: string): Coverage {
  if (!firstDay || until <= firstDay) return "none";
  return from > firstDay ? "full" : "partial";
}

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

// 방문 시간·이탈 (lib/metrics/flow.ts) for the range. Start counts (hour,
// first screen, weekday) come with every session; the rest only from
// sessions whose browser reported their flow (flowSessions). Values are the
// latest known state of each session; today's include sessions still going.
export type FlowReport = {
  startSince: string | null; // first day with start-hour counts
  since: string | null; // first day with flow counts
  coverage: Coverage; // of the flow counts over the range
  startCoverage: Coverage;
  startHour: number[]; // 0..23, KST
  endHour: number[]; // 0..23, KST hour of the last confirmed activity
  startDow: number[]; // Mon..Sun, sessions started
  endDow: number[]; // Mon..Sun, flow sessions (a session ends on its start day)
  firstPage: Partial<Record<PageKind, number>>;
  exitPage: Partial<Record<PageKind, number>>;
  // page views of each screen over the days that have flow counts (the
  // 종료율 denominator: same days as its numerator)
  pageViewsSinceFlow: Partial<Record<PageKind, number>>;
  exitByDevice: Record<DeviceKind, Partial<Record<PageKind, number>>>;
  paths: { first: PageKind; last: PageKind; sessions: number }[];
  duration: Record<DurationBucket, number>;
  durationByDevice: Record<DeviceKind, Record<DurationBucket, number>>;
  durationSeconds: Record<DeviceKind, number>;
  flowSessions: Record<DeviceKind, number>;
  pages: Record<PagesBucket, number>;
  open: number; // 종료 미확인 (still going, or never came back)
  closed: number; // 종료 확인 (the browser later started a new session)
  // Data checks over the range (empty when the counts agree): a bucket
  // whose stored total is below zero, or a distribution whose total differs
  // from the flow sessions. Shown as a warning; the buckets themselves are
  // displayed at 0 at least.
  issues: string[];
};

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
  // 접속 기기: the same page views / sessions split by device class. Began
  // with its release, whose day is read from the data (first device row);
  // null values are 미측정.
  flow: FlowReport;
  device: {
    since: string | null;
    coverage: Coverage[];
    totalCoverage: Coverage;
    pv: Record<DeviceKind, (number | null)[]>;
    session: Record<DeviceKind, (number | null)[]>;
    totals: { pv: Record<DeviceKind, number | null>; session: Record<DeviceKind, number | null> };
  };
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
  let deviceSince: string | null = null;
  const devicePv = Object.fromEntries(DEVICE_KINDS.map((k) => [k, zeros()])) as Record<DeviceKind, (number | null)[]>;
  const deviceSession = Object.fromEntries(DEVICE_KINDS.map((k) => [k, zeros()])) as Record<DeviceKind, (number | null)[]>;
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
        const device = /^visit\.device\.([a-z]+)\.(pv|session)$/.exec(r.metric);
        if (device && (DEVICE_KINDS as readonly string[]).includes(device[1])) put((device[2] === "pv" ? devicePv : deviceSession)[device[1] as DeviceKind], [r]);
      }
    })(),
  ]);

  const [timings, capacity, firstDevice, flowFirsts, perDay] = await Promise.all([
    loadTimingsBetween(from, until),
    loadCapacity(),
    prisma.$queryRaw<{ day: Date | string | null }[]>`SELECT min("day") AS day FROM "MetricDaily" WHERE "metric" LIKE 'visit.device.%'`.catch(() => []),
    prisma.$queryRaw<{ start_day: Date | string | null; flow_day: Date | string | null }[]>`
      SELECT min("day") FILTER (WHERE "metric" LIKE 'visit.start.%') AS start_day, min("day") FILTER (WHERE "metric" LIKE 'visit.flow.%') AS flow_day
      FROM "MetricDaily" WHERE "metric" LIKE 'visit.start.%' OR "metric" LIKE 'visit.flow.%'`.catch(() => []),
    // per KST day (for weekdays): sessions started, and flow sessions
    prisma.$queryRaw<{ day: Date | string; starts: bigint | number | null; flows: bigint | number | null }[]>`
      SELECT "day",
        sum("value") FILTER (WHERE "metric" IN ('visit.session.anon', 'visit.session.member')) AS starts,
        sum("value") FILTER (WHERE "metric" LIKE 'visit.flow.sessions.%') AS flows
      FROM "MetricDaily"
      WHERE "day" >= ${from}::date AND "day" < ${until}::date
        AND ("metric" IN ('visit.session.anon', 'visit.session.member') OR "metric" LIKE 'visit.flow.sessions.%')
      GROUP BY 1`.catch(() => []),
  ]);
  deviceSince = firstDevice[0]?.day ? asDay(firstDevice[0].day) : null;
  const deviceCoverage = buckets.map((b) => {
    const span = bucketSpan(range, b);
    return coverageSinceDay(deviceSince, span.from, span.until);
  });
  for (const series of [devicePv, deviceSession]) {
    for (const kind of DEVICE_KINDS) deviceCoverage.forEach((c, i) => c === "none" && (series[kind][i] = null));
  }
  const deviceTotalCoverage = coverageSinceDay(deviceSince, from, until);
  const totalOf = (series: Record<DeviceKind, (number | null)[]>) =>
    Object.fromEntries(DEVICE_KINDS.map((k) => [k, deviceTotalCoverage === "none" ? null : series[k].reduce<number>((a, v) => a + (v ?? 0), 0)])) as Record<DeviceKind, number | null>;

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
    flow: await withPageViewsSinceFlow(flowReportOf(visitTotals, perDay, {
      startSince: flowFirsts[0]?.start_day ? asDay(flowFirsts[0].start_day) : null,
      since: flowFirsts[0]?.flow_day ? asDay(flowFirsts[0].flow_day) : null,
      from,
      until,
    }), from, until),
    device: {
      since: deviceSince,
      coverage: deviceCoverage,
      totalCoverage: deviceTotalCoverage,
      pv: devicePv,
      session: deviceSession,
      totals: { pv: totalOf(devicePv), session: totalOf(deviceSession) },
    },
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

// ---------- 방문 시간·이탈 ----------

const zero24 = () => Array.from({ length: 24 }, () => 0);
const zeroOf = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

// Monday = 0 .. Sunday = 6, for a KST calendar day.
export function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function flowReportOf(
  totals: Map<string, number>,
  perDay: { day: Date | string; starts: bigint | number | null; flows: bigint | number | null }[],
  { startSince, since, from, until }: { startSince: string | null; since: string | null; from: string; until: string },
): FlowReport {
  const out: FlowReport = {
    startSince,
    since,
    coverage: coverageSinceDay(since, from, until),
    startCoverage: coverageSinceDay(startSince, from, until),
    startHour: zero24(),
    endHour: zero24(),
    startDow: Array.from({ length: 7 }, () => 0),
    endDow: Array.from({ length: 7 }, () => 0),
    firstPage: {},
    exitPage: {},
    pageViewsSinceFlow: {},
    exitByDevice: Object.fromEntries(DEVICE_KINDS.map((d) => [d, {}])) as FlowReport["exitByDevice"],
    paths: [],
    duration: zeroOf(DURATION_BUCKETS),
    durationByDevice: Object.fromEntries(DEVICE_KINDS.map((d) => [d, zeroOf(DURATION_BUCKETS)])) as FlowReport["durationByDevice"],
    durationSeconds: zeroOf(DEVICE_KINDS),
    flowSessions: zeroOf(DEVICE_KINDS),
    pages: zeroOf(PAGES_BUCKETS),
    open: 0,
    closed: 0,
    issues: [],
  };
  const raw = new Map<string, number>(); // unclamped distribution totals
  const negatives: string[] = [];
  const isKind = (v: string): v is PageKind => (PAGE_KINDS as readonly string[]).includes(v);
  const isDevice = (v: string): v is DeviceKind => (DEVICE_KINDS as readonly string[]).includes(v);
  // A bucket is displayed at 0 at least; a stored total below zero (a report
  // applied to a state the server never had) is listed in `issues`.
  const pos = (n: number) => Math.max(0, n);
  for (const [metric, n] of totals) {
    const dist = /^visit\.flow\.(exit|path|pages|dur|endhour)\./.exec(metric)?.[1] ?? (metric === "visit.flow.open" || metric === "visit.flow.closed" ? "status" : null);
    if (dist) raw.set(dist, (raw.get(dist) ?? 0) + n);
    if (dist && n < 0) negatives.push(`${metric} = ${n}`);
  }
  for (const [metric, n] of totals) {
    let m: RegExpExecArray | null;
    if ((m = /^visit\.start\.hour\.(\d{2})$/.exec(metric))) out.startHour[Number(m[1])] += n;
    else if ((m = /^visit\.start\.page\.([a-z_]+)$/.exec(metric)) && isKind(m[1])) out.firstPage[m[1]] = (out.firstPage[m[1]] ?? 0) + n;
    else if ((m = /^visit\.flow\.endhour\.(\d{2})$/.exec(metric))) out.endHour[Number(m[1])] += pos(n);
    else if ((m = /^visit\.flow\.exit\.([a-z_]+)\.([a-z]+)$/.exec(metric)) && isKind(m[1]) && isDevice(m[2])) {
      out.exitPage[m[1]] = (out.exitPage[m[1]] ?? 0) + pos(n);
      out.exitByDevice[m[2]][m[1]] = (out.exitByDevice[m[2]][m[1]] ?? 0) + pos(n);
    } else if ((m = /^visit\.flow\.path\.([a-z_]+)\.([a-z_]+)$/.exec(metric)) && isKind(m[1]) && isKind(m[2])) {
      if (n > 0) out.paths.push({ first: m[1], last: m[2], sessions: n });
    } else if ((m = /^visit\.flow\.dur\.([a-z0-9]+)\.([a-z]+)$/.exec(metric)) && (DURATION_BUCKETS as readonly string[]).includes(m[1]) && isDevice(m[2])) {
      out.duration[m[1] as DurationBucket] += pos(n);
      out.durationByDevice[m[2]][m[1] as DurationBucket] += pos(n);
    } else if ((m = /^visit\.flow\.dursec\.([a-z]+)$/.exec(metric)) && isDevice(m[1])) out.durationSeconds[m[1]] += pos(n);
    else if ((m = /^visit\.flow\.sessions\.([a-z]+)$/.exec(metric)) && isDevice(m[1])) out.flowSessions[m[1]] += n;
    else if ((m = /^visit\.flow\.pages\.([a-z0-9]+)$/.exec(metric)) && (PAGES_BUCKETS as readonly string[]).includes(m[1])) out.pages[m[1] as PagesBucket] += pos(n);
    else if (metric === "visit.flow.open") out.open += pos(n);
    else if (metric === "visit.flow.closed") out.closed += pos(n);
  }
  for (const row of perDay) {
    const i = weekdayIndex(asDay(row.day));
    out.startDow[i] += Number(row.starts ?? 0);
    out.endDow[i] += Number(row.flows ?? 0);
  }
  out.paths.sort((a, b) => b.sessions - a.sessions);
  const sessions = DEVICE_KINDS.reduce((a, d) => a + out.flowSessions[d], 0);
  if (negatives.length) out.issues.push(`0보다 작은 구간 ${negatives.length}개 (화면에는 0으로 표시): ${negatives.slice(0, 5).join(", ")}${negatives.length > 5 ? " …" : ""}`);
  const names: Record<string, string> = { exit: "마지막 이용 화면", path: "첫→마지막 화면", pages: "본 화면 수", dur: "체류 시간", endhour: "종료 시간대", status: "종료 확인+미확인" };
  for (const [dist, label] of Object.entries(names)) {
    const total = raw.get(dist) ?? 0;
    if (sessions && total !== sessions) out.issues.push(`${label} 합계 ${total} ≠ 체류·이탈 집계 방문 ${sessions}`);
  }
  return out;
}

// Mean seconds over the flow sessions (all devices, or one).
export function meanDuration(flow: FlowReport, device?: DeviceKind): number | null {
  const devices: readonly DeviceKind[] = device ? [device] : DEVICE_KINDS;
  const sessions = devices.reduce<number>((a, d) => a + flow.flowSessions[d], 0);
  if (!sessions) return null;
  return Math.round(devices.reduce<number>((a, d) => a + flow.durationSeconds[d], 0) / sessions);
}

// The bucket holding the middle session (an exact median would need every
// session's duration, which is never stored).
export function medianBucket(distribution: Record<DurationBucket, number>): DurationBucket | null {
  const total = DURATION_BUCKETS.reduce((a, b) => a + distribution[b], 0);
  if (!total) return null;
  let seen = 0;
  for (const b of DURATION_BUCKETS) {
    seen += distribution[b];
    if (seen >= total / 2) return b;
  }
  return null;
}

export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}초`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

// The 종료율 denominator: page views of each screen on the days that have
// flow counts (from the first flow day; that first day is partial).
async function withPageViewsSinceFlow(flow: FlowReport, from: string, until: string): Promise<FlowReport> {
  if (!flow.since || flow.coverage === "none") return flow;
  const start = flow.since > from ? flow.since : from;
  const rows = await prisma.$queryRaw<{ metric: string; n: bigint | number }[]>`
    SELECT "metric", sum("value") AS n FROM "MetricDaily"
    WHERE "metric" LIKE 'visit.page.%' AND "day" >= ${start}::date AND "day" < ${until}::date
    GROUP BY 1`.catch(() => []);
  for (const r of rows) {
    const m = /^visit\.page\.([a-z_]+)\.(anon|member)$/.exec(r.metric);
    if (m && (PAGE_KINDS as readonly string[]).includes(m[1])) {
      const kind = m[1] as PageKind;
      flow.pageViewsSinceFlow[kind] = (flow.pageViewsSinceFlow[kind] ?? 0) + Number(r.n);
    }
  }
  return flow;
}

