// 시간대 분석 날짜 선택: any set of KST days, up to MAX_SELECTED_DAYS,
// chosen on one calendar (components/admin/HourlyDayPicker) and carried in
// the URL as `d` -- runs of days as "from~to", joined by commas
// ("2026-10-12~2026-10-18,2026-10-20"). Shared by the calendar, the page and
// the export action, so all three read the same days. No imports: the
// calendar is a client component.

// The heatmap's row limit; the calendar refuses more and says so.
export const MAX_SELECTED_DAYS = 31;
// No `d` in the URL: the last week, today included.
export const DEFAULT_SELECTED_DAYS = 7;
export const EARLIEST_SELECTABLE_DAY = "2024-01-01";
const DAY_MS = 86_400_000;

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export const selectableDay = (day: string, today: string) => day >= EARLIEST_SELECTABLE_DAY && day <= today;

// Every day from a to b, both included, in order (either may come first).
export function daysBetween(a: string, b: string, limit = 400): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let d = from; d <= to && out.length < limit; d = addDays(d, 1)) out.push(d);
  return out;
}

export const lastDays = (today: string, n: number) => daysBetween(addDays(today, 1 - n), today);

// Consecutive runs of sorted, unique days.
export function dayRuns(days: string[]): [string, string][] {
  const runs: [string, string][] = [];
  for (const d of [...new Set(days)].sort()) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  return runs;
}

export const encodeDays = (days: string[]) => dayRuns(days).map(([a, b]) => (a === b ? a : `${a}~${b}`)).join(",");

// Unknown or malformed parts are dropped; a run is expanded up to `limit` days.
export function decodeDays(param: string, limit = 400): string[] {
  const out = new Set<string>();
  for (const part of param.split(",").slice(0, limit)) {
    const [a, b = a] = part.trim().split("~");
    if (!isRealDay(a) || !isRealDay(b)) continue;
    for (const d of daysBetween(a, b, limit)) {
      if (out.size >= limit) break;
      out.add(d);
    }
  }
  return [...out].sort();
}

const md = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

// "10/12~10/18, 10/20" (with the year when the days span two years).
export function describeDays(days: string[]): string {
  const runs = dayRuns(days);
  const years = new Set(days.map((d) => d.slice(0, 4)));
  const label = (d: string) => (years.size > 1 ? `${d.slice(2, 4)}.${md(d)}` : md(d));
  return runs.map(([a, b]) => (a === b ? label(a) : `${label(a)}~${label(b)}`)).join(", ");
}

// The days the URL asks for, as the page and the export read them: no `d`
// means the last DEFAULT_SELECTED_DAYS days; an empty `d` means none.
// Days after today or before the earliest day are left out; more than the
// limit (only from a hand-made URL) keeps the latest ones and says so.
export function resolveSelection(param: string | null | undefined, today: string): { days: string[]; notice: string | null } {
  if (param === null || param === undefined) return { days: lastDays(today, DEFAULT_SELECTED_DAYS), notice: null };
  const days = decodeDays(param).filter((d) => selectableDay(d, today));
  if (days.length <= MAX_SELECTED_DAYS) return { days, notice: null };
  return {
    days: days.slice(-MAX_SELECTED_DAYS),
    notice: `날짜는 최대 ${MAX_SELECTED_DAYS}일까지 고를 수 있어 가장 최근 ${MAX_SELECTED_DAYS}일만 반영했습니다(요청 ${days.length}일).`,
  };
}

// A click or drag from `a` to `b`: add those days, or take them away.
// Days that can't be chosen (after today) are skipped.
export type DragMode = "add" | "remove";
export function applyRange(selected: ReadonlySet<string>, a: string, b: string, mode: DragMode, today: string): Set<string> {
  const next = new Set(selected);
  for (const d of daysBetween(a, b)) {
    if (!selectableDay(d, today)) continue;
    if (mode === "add") next.add(d);
    else next.delete(d);
  }
  return next;
}

// The 6 x 7 days shown for a month ("YYYY-MM"), Monday first, with the
// neighbouring months' days filling the first and last weeks.
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}
