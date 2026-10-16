import { prisma } from "@/lib/db/prisma";
import { addPeriods } from "./dashboard";
import { kstDay, kstHour, TRAFFIC_HOURLY_SINCE_METRIC, USER_HOURLY_SINCE_METRIC } from "./record";
import { kstNow, type Coverage } from "./report";
import { hourlySince } from "./userReport";

// 시간대 분석 (/admin/stats?tab=hourly): the whole service's use by KST day
// and hour, for comparing days (a festival, a promotion post, an incident)
// hour by hour. Read-only, aggregates only: every value is a MetricDaily
// counter -- nothing per member is read here (a member's own latest
// activity time is User.lastActiveAt, shown on the admin user page only).
//
// Different things, never added together:
// - 페이지뷰: screens shown, by login state at each view (visit.member.hour /
//   visit.anon.hour). Admins' views are not counted.
// - 방문 세션: visits started in that hour (visit.start.hour; a visit is 30
//   minutes without a view or a new day -- not a person).
// - 활성 회원: members with at least one detected signed-in activity in that
//   hour (active.member.hour, admins out). A distinct count per hour only:
//   the sum over hours or days is member-hours, not people.
// - 로그인 완료: completed Google sign-ins (auth.login.hour); a 30-day
//   session means most visits never sign in again.
//
// Each counter has its own collection start per environment: a marker row
// (record.ts *_SINCE_METRIC, KST day + minute) or, without one, its first
// recorded day (a partial day). Before it every cell is 미측정 (null),
// never 0; the start hour itself is 부분 측정. Hours not reached yet today
// are "future" -- neither 0 nor 미측정.

export const HOURLY_METRICS = [
  { key: "pv", label: "페이지뷰(전체)", short: "페이지뷰", unit: "회" },
  { key: "pvMember", label: "로그인 회원 페이지뷰", short: "회원 페이지뷰", unit: "회" },
  { key: "pvAnon", label: "비로그인 페이지뷰", short: "비로그인 페이지뷰", unit: "회" },
  { key: "session", label: "방문 세션(시작)", short: "방문 세션", unit: "회" },
  { key: "active", label: "시간대별 활성 회원", short: "활성 회원", unit: "명" },
  { key: "login", label: "로그인 완료", short: "로그인 완료", unit: "회" },
] as const;
export type HourlyMetric = (typeof HOURLY_METRICS)[number]["key"];
export const isHourlyMetric = (v: unknown): v is HourlyMetric => HOURLY_METRICS.some((m) => m.key === v);
export const metricInfo = (key: HourlyMetric) => HOURLY_METRICS.find((m) => m.key === key)!;

type Counter = Exclude<HourlyMetric, "pv">;
const COUNTERS: Record<Counter, { prefix: string; start: "user" | "traffic" | "data" }> = {
  pvMember: { prefix: "visit.member.hour.", start: "user" },
  pvAnon: { prefix: "visit.anon.hour.", start: "traffic" },
  session: { prefix: "visit.start.hour.", start: "data" },
  active: { prefix: "active.member.hour.", start: "traffic" },
  login: { prefix: "auth.login.hour.", start: "user" },
};
const COUNTER_KEYS = Object.keys(COUNTERS) as Counter[];

export type CellStatus = Coverage | "future";
export type Since = { day: string; minute: number | null };
export type MetricCells = {
  since: string | null; // "YYYY-MM-DD HH:MM", or the day alone when only known from the data
  values: (number | null)[][]; // [day][hour]; null = 미측정 or future
  status: CellStatus[][];
};
export type HourlyCells = {
  days: string[];
  today: string;
  nowHour: number;
  generatedAt: string;
  metrics: Record<HourlyMetric, MetricCells>;
};

const asDay = (b: Date | string) => (typeof b === "string" ? b.slice(0, 10) : b.toISOString().slice(0, 10));
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const sinceText = (since: Since | null) => (!since ? null : since.minute === null ? since.day : `${since.day} ${hhmm(since.minute)}`);

// One cell's status for a counter that began at `since`.
export function cellStatus(since: Since | null, day: string, hour: number, today: string, nowHour: number): CellStatus {
  if (day > today || (day === today && hour > nowHour)) return "future";
  if (!since || day < since.day) return "none";
  if (day > since.day) return "full";
  if (since.minute === null) return "partial";
  const startHour = Math.floor(since.minute / 60);
  if (hour < startHour) return "none";
  if (hour === startHour) return since.minute % 60 === 0 ? "full" : "partial";
  return "full";
}

// 페이지뷰(전체) = 회원 + 비로그인, hour by hour: measured only where both
// are; where one of them is, that part is shown as 부분 측정.
function combine(a: MetricCells, b: MetricCells): MetricCells {
  const values = a.values.map((row, d) => row.map((v, h) => (v === null && b.values[d][h] === null ? null : (v ?? 0) + (b.values[d][h] ?? 0))));
  const status = a.status.map((row, d) =>
    row.map((s, h): CellStatus => {
      const t = b.status[d][h];
      if (s === "future") return "future";
      if (s === "full" && t === "full") return "full";
      if (s === "none" && t === "none") return "none";
      return "partial";
    }),
  );
  return { since: [a.since, b.since].filter((x): x is string => !!x).sort().at(-1) ?? null, values, status };
}

// Pure: counter rows + collection starts -> cells for `days`.
export function buildCells(
  days: string[],
  rows: { day: string; metric: string; n: number }[],
  starts: Record<Counter, Since | null>,
  now: Date,
): HourlyCells {
  const today = kstDay(now);
  const nowHour = kstHour(now);
  const index = new Map(days.map((d, i) => [d, i]));
  const metrics = {} as Record<HourlyMetric, MetricCells>;
  for (const key of COUNTER_KEYS) {
    const raw = days.map(() => Array.from({ length: 24 }, () => 0));
    const seen = days.map(() => Array.from({ length: 24 }, () => false));
    const { prefix } = COUNTERS[key];
    for (const r of rows) {
      if (!r.metric.startsWith(prefix)) continue;
      const hour = Number(r.metric.slice(prefix.length));
      const d = index.get(r.day);
      if (d === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23 || r.metric.length !== prefix.length + 2) continue;
      raw[d][hour] += r.n;
      seen[d][hour] = true;
    }
    const since = starts[key];
    const status = days.map((day, d) =>
      Array.from({ length: 24 }, (_, h): CellStatus => {
        const s = cellStatus(since, day, h, today, nowHour);
        // counts written before the marker (an instance that started
        // earlier) still show: measured at least in part
        return s === "none" && seen[d][h] ? "partial" : s;
      }),
    );
    const values = raw.map((row, d) => row.map((v, h) => (status[d][h] === "none" || status[d][h] === "future" ? null : v)));
    metrics[key] = { since: sinceText(since), values, status };
  }
  metrics.pv = combine(metrics.pvMember, metrics.pvAnon);
  return { days, today, nowHour, generatedAt: kstNow(now), metrics };
}

export function daysFrom(from: string, until: string): string[] {
  const out: string[] = [];
  for (let d = from; d < until && out.length < 400; d = addPeriods(d, "day", 1)) out.push(d);
  return out;
}

export async function loadHourlyCells(days: string[], { now = new Date() } = {}): Promise<HourlyCells> {
  const wanted = [...new Set(days)].sort();
  const [rows, markers, firsts] = await Promise.all([
    wanted.length
      ? prisma.$queryRaw<{ day: Date | string; metric: string; n: bigint | number }[]>`
          SELECT "day", "metric", "value" AS n FROM "MetricDaily"
          WHERE "day" = ANY(${wanted}::date[])
            AND ("metric" LIKE 'visit.member.hour.%' OR "metric" LIKE 'visit.anon.hour.%' OR "metric" LIKE 'visit.start.hour.%'
              OR "metric" LIKE 'active.member.hour.%' OR "metric" LIKE 'auth.login.hour.%')`.catch(() => [])
      : Promise.resolve([]),
    prisma.$queryRaw<{ metric: string; day: Date | string; value: number }[]>`
      SELECT DISTINCT ON ("metric") "metric", "day", "value" FROM "MetricDaily"
      WHERE "metric" IN (${USER_HOURLY_SINCE_METRIC}, ${TRAFFIC_HOURLY_SINCE_METRIC})
      ORDER BY "metric", "day"`.catch(() => []),
    prisma.$queryRaw<Record<Counter, Date | string | null>[]>`
      SELECT min("day") FILTER (WHERE "metric" LIKE 'visit.member.hour.%') AS "pvMember",
             min("day") FILTER (WHERE "metric" LIKE 'visit.anon.hour.%') AS "pvAnon",
             min("day") FILTER (WHERE "metric" LIKE 'visit.start.hour.%') AS "session",
             min("day") FILTER (WHERE "metric" LIKE 'active.member.hour.%') AS "active",
             min("day") FILTER (WHERE "metric" LIKE 'auth.login.hour.%') AS "login"
      FROM "MetricDaily" WHERE "metric" LIKE '%.hour.%'`.catch(() => []),
  ]);
  const marker = (metric: string): Since | null => {
    const m = markers.find((r) => r.metric === metric);
    return m ? { day: asDay(m.day), minute: Number(m.value) } : null;
  };
  const first = (key: Counter) => (firsts[0]?.[key] ? asDay(firsts[0][key]!) : null);
  const starts = Object.fromEntries(
    COUNTER_KEYS.map((key) => {
      const firstDay = first(key);
      const kind = COUNTERS[key].start;
      // user: the marker came after the counters on Preview (see
      // userReport hourlySince); traffic: marker and counters came together
      const since =
        kind === "user"
          ? hourlySince(marker(USER_HOURLY_SINCE_METRIC), firstDay)
          : kind === "traffic"
            ? (marker(TRAFFIC_HOURLY_SINCE_METRIC) ?? (firstDay ? { day: firstDay, minute: null } : null))
            : firstDay
              ? { day: firstDay, minute: null }
              : null;
      return [key, since];
    }),
  ) as Record<Counter, Since | null>;
  return buildCells(
    wanted,
    rows.map((r) => ({ day: asDay(r.day), metric: r.metric, n: Number(r.n) })),
    starts,
    now,
  );
}

// ---------- summaries (pure) ----------

const worst = (statuses: CellStatus[]): CellStatus => {
  const past = statuses.filter((s) => s !== "future");
  if (!past.length) return "future";
  if (past.every((s) => s === "full")) return "full";
  if (past.every((s) => s === "none")) return "none";
  return "partial";
};
const sumOrNull = (values: (number | null)[]) => (values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));

// Hour-of-day profile: each hour summed over the given day rows.
export function byHour(cells: MetricCells, rows: number[] = cells.values.map((_, i) => i)): { values: (number | null)[]; status: CellStatus[] } {
  const values = Array.from({ length: 24 }, (_, h) => sumOrNull(rows.map((d) => cells.values[d][h])));
  const status = Array.from({ length: 24 }, (_, h) => worst(rows.map((d) => cells.status[d][h])));
  return { values, status };
}

// 오전 (0-11시) / 오후 (12-23시) / 하루 합계 of one day row.
export function halves(cells: MetricCells, d: number) {
  const part = (from: number, to: number) => {
    const hours = Array.from({ length: to - from }, (_, k) => from + k);
    return { value: sumOrNull(hours.map((h) => cells.values[d][h])), status: worst(hours.map((h) => cells.status[d][h])) };
  };
  return { am: part(0, 12), pm: part(12, 24), day: part(0, 24) };
}

// The busiest hour of a profile (first one on a tie); null without counts.
export function peakHour(values: (number | null)[]): { hour: number; n: number } | null {
  let best = -1;
  values.forEach((v, h) => {
    if (v !== null && v > 0 && (best < 0 || v > values[best]!)) best = h;
  });
  return best < 0 ? null : { hour: best, n: values[best]! };
}

// The period's total of a metric, with how much of it was measured.
export function totalOf(cells: MetricCells): { value: number | null; status: CellStatus } {
  return { value: sumOrNull(cells.values.flat()), status: worst(cells.status.flat()) };
}

// How much of the chosen days' past hours a metric measured: hours fully
// measured, in part, not at all; and the days with at least one measured hour.
export function measuredOf(cells: MetricCells): { hours: number; full: number; partial: number; none: number; days: number } {
  const past = cells.status.flat().filter((s) => s !== "future");
  return {
    hours: past.length,
    full: past.filter((s) => s === "full").length,
    partial: past.filter((s) => s === "partial").length,
    none: past.filter((s) => s === "none").length,
    days: cells.status.filter((row) => row.some((s) => s === "full" || s === "partial")).length,
  };
}

// The busiest single day-hour (first one on a tie); null without counts.
export function peakCell(cells: MetricCells): { d: number; hour: number; n: number } | null {
  let best: { d: number; hour: number; n: number } | null = null;
  cells.values.forEach((row, d) =>
    row.forEach((v, hour) => {
      if (v !== null && v > 0 && (!best || v > best.n)) best = { d, hour, n: v };
    }),
  );
  return best;
}
