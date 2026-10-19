import { addDays } from "@/lib/metrics/daySelection";
import type { CommitAuthor, DevCommit } from "./github";

// 개발자 통계, computed from the cached commit list (pure): what the tab
// shows for a period and, optionally, one developer. Days are KST calendar
// days of the authored time (what GitHub's own activity graph uses).
// Commit counts describe how work was recorded, not how much was done or
// who did more -- the screen says so and never ranks by them.

export type DevPeriod = "30" | "90" | "365" | "all";
export const DEV_PERIODS: { key: DevPeriod; label: string; days: number | null }[] = [
  { key: "30", label: "30일", days: 30 },
  { key: "90", label: "90일", days: 90 },
  { key: "365", label: "1년", days: 365 },
  { key: "all", label: "전체", days: null },
];
export const isDevPeriod = (v: unknown): v is DevPeriod => DEV_PERIODS.some((p) => p.key === v);
export type DevUnit = "day" | "week" | "month";
export const isDevUnit = (v: unknown): v is DevUnit => v === "day" || v === "week" || v === "month";

const KST = 9 * 3600_000;
export const kstDayOf = (iso: string) => new Date(Date.parse(iso) + KST).toISOString().slice(0, 10);
export const kstTimeOf = (iso: string) => new Date(Date.parse(iso) + KST).toISOString().slice(11, 16);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
export const bucketOf = (day: string, unit: DevUnit) => (unit === "day" ? day : unit === "week" ? mondayOf(day) : `${day.slice(0, 7)}-01`);
const nextBucket = (b: string, unit: DevUnit) => {
  if (unit === "day") return addDays(b, 1);
  if (unit === "week") return addDays(b, 7);
  const [y, m] = b.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function autoUnit(from: string, to: string): DevUnit {
  const span = daysBetween(from, to) + 1;
  return span <= 45 ? "day" : span <= 210 ? "week" : "month";
}

export type DevAuthor = CommitAuthor & {
  names: string[]; // every commit name seen for this author
  commits: number; // in the period
  activeDays: number;
  first: string | null; // ISO, in the period
  last: string | null;
  allTime: number;
  series: number[]; // per bucket of the period
};

export type DevReport = {
  period: DevPeriod;
  unit: DevUnit;
  from: string; // KST day, inclusive
  to: string; // today
  author: string | null; // the filter (author key)
  authors: DevAuthor[]; // everyone with a commit (all time), newest activity first
  buckets: string[];
  // commits per bucket for each shown author (all, or the filtered one)
  series: { key: string; label: string; values: number[] }[];
  totals: { commits: number; activeDays: number; authors: number; merges: number; coAuthored: number; lastCommit: DevCommit | null };
  heat: { from: string; to: string; counts: Record<string, number>; max: number };
  commits: DevCommit[]; // the period's (filtered) commits, newest first
};

export function buildDevReport(
  all: DevCommit[],
  { period, unit: askedUnit, author, today }: { period: DevPeriod; unit?: DevUnit | null; author?: string | null; today: string },
): DevReport {
  const sorted = [...all].sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));
  const firstDay = sorted.length ? kstDayOf(sorted[sorted.length - 1].authoredAt) : today;
  const days = DEV_PERIODS.find((p) => p.key === period)!.days;
  const from = days === null ? firstDay : addDays(today, 1 - days);
  const unit = askedUnit ?? autoUnit(from, today);
  const inPeriod = sorted.filter((c) => {
    const d = kstDayOf(c.authoredAt);
    return d >= from && d <= today;
  });

  // authors, all time (so the filter lists everyone), stats in the period
  const byKey = new Map<string, DevAuthor>();
  for (const c of sorted) {
    let a = byKey.get(c.author.key);
    if (!a) {
      a = { ...c.author, names: [], commits: 0, activeDays: 0, first: null, last: null, allTime: 0, series: [] };
      byKey.set(c.author.key, a);
    }
    a.allTime++;
    if (!a.names.includes(c.author.name)) a.names.push(c.author.name);
  }
  const buckets: string[] = [];
  for (let b = bucketOf(from, unit); b <= today && buckets.length < 400; b = nextBucket(b, unit)) buckets.push(b);
  const index = new Map(buckets.map((b, i) => [b, i]));
  const authorDays = new Map<string, Set<string>>();
  for (const c of inPeriod) {
    const a = byKey.get(c.author.key)!;
    const d = kstDayOf(c.authoredAt);
    a.commits++;
    if (!a.last || c.authoredAt > a.last) a.last = c.authoredAt;
    if (!a.first || c.authoredAt < a.first) a.first = c.authoredAt;
    (authorDays.get(a.key) ?? authorDays.set(a.key, new Set()).get(a.key)!).add(d);
    if (!a.series.length) a.series = buckets.map(() => 0);
    const i = index.get(bucketOf(d, unit));
    if (i !== undefined) a.series[i]++;
  }
  const authors = [...byKey.values()]
    .map((a) => ({ ...a, activeDays: authorDays.get(a.key)?.size ?? 0, series: a.series.length ? a.series : buckets.map(() => 0) }))
    .sort((x, y) => (y.last ?? "").localeCompare(x.last ?? "") || x.name.localeCompare(y.name));

  const filter = author && byKey.has(author) ? author : null;
  const shown = filter ? inPeriod.filter((c) => c.author.key === filter) : inPeriod;
  const shownAuthors = authors.filter((a) => (filter ? a.key === filter : a.commits > 0));
  const label = (a: DevAuthor) => a.login ?? a.name;

  // heatmap: the period, but at least the last 12 weeks and at most a year
  const atLeast = addDays(today, -83);
  const atMost = addDays(today, -364);
  const heatFrom = mondayOf(from < atMost ? atMost : from < atLeast ? from : atLeast);
  const counts: Record<string, number> = {};
  for (const c of filter ? sorted.filter((x) => x.author.key === filter) : sorted) {
    const d = kstDayOf(c.authoredAt);
    if (d >= heatFrom && d <= today) counts[d] = (counts[d] ?? 0) + 1;
  }

  return {
    period,
    unit,
    from,
    to: today,
    author: filter,
    authors,
    buckets,
    series: shownAuthors.map((a) => ({ key: a.key, label: label(a), values: a.series })),
    totals: {
      commits: shown.length,
      activeDays: new Set(shown.map((c) => kstDayOf(c.authoredAt))).size,
      authors: new Set(shown.map((c) => c.author.key)).size,
      merges: shown.filter((c) => c.merge).length,
      coAuthored: shown.filter((c) => c.coAuthors.length > 0).length,
      lastCommit: shown[0] ?? null,
    },
    heat: { from: heatFrom, to: today, counts, max: Math.max(0, ...Object.values(counts)) },
    commits: shown,
  };
}
