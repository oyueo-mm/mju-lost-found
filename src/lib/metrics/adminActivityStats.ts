import type { Coverage } from "./report";
import type { ActivityPeriod, AdminActivityReport, AdminActivityRow } from "./adminActivity";

// 관리자 활동 dashboard: everything below is computed from one
// AdminActivityReport (loadAdminActivity) for the chosen period (last 7 / 30
// KST days) and admin (null: every admin in scope). Pure functions -- no
// database, no new records.
//
// Three different things are never added together:
// - 방문: a visit (AdminVisit), counted once, at its start;
// - 로그인: a completed Google sign-in;
// - 관리 작업: a completed admin task (the audit records).
// A visit or a sign-in is presence, not work.

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;

const KST_MS = 9 * 3_600_000;
// KST hour 0-23 and weekday 0 = 월 ... 6 = 일
export function kstHourOf(at: Date): number {
  return new Date(at.getTime() + KST_MS).getUTCHours();
}
export function kstWeekdayOf(at: Date): number {
  return (new Date(at.getTime() + KST_MS).getUTCDay() + 6) % 7;
}
const kstDayOf = (at: Date) => new Date(at.getTime() + KST_MS).toISOString().slice(0, 10);

export type PeriodView = {
  days: string[];
  // index into report.days of the period's first day
  offset: number;
  presenceStatus: Coverage[];
  taskCoverage: Coverage[];
  dayStatus: Coverage[];
  // days of the period on which each record existed (0: none -> 미측정)
  presenceDays: number;
  activityDays: number;
};

export function periodView(report: AdminActivityReport, period: ActivityPeriod): PeriodView {
  const offset = report.days.length - period;
  const slice = <T>(a: T[]) => a.slice(offset);
  const presenceStatus = slice(report.presenceStatus);
  const dayStatus = slice(report.dayStatus);
  return {
    days: slice(report.days),
    offset,
    presenceStatus,
    taskCoverage: slice(report.taskCoverage),
    dayStatus,
    presenceDays: presenceStatus.filter((s) => s !== "none").length,
    activityDays: dayStatus.filter((s) => s !== "none").length,
  };
}

const sumOrNull = (values: (number | null)[]) => (values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));

// One admin's figures for the period (null: 미측정 for the whole period)
export type AdminPeriodFigures = {
  id: number;
  nickname: string;
  isAdmin: boolean;
  visits: number | null;
  signIns: number | null;
  tasks: number;
  activeDays: number | null;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  lastTaskAt: Date | null;
};

export function adminFigures(row: AdminActivityRow, view: PeriodView): AdminPeriodFigures {
  const slice = <T>(a: T[]) => a.slice(view.offset);
  return {
    id: row.id,
    nickname: row.nickname,
    isAdmin: row.isAdmin,
    visits: sumOrNull(slice(row.visits)),
    signIns: sumOrNull(slice(row.signIns)),
    tasks: slice(row.tasksByDay).reduce((a, n) => a + n, 0),
    activeDays: view.activityDays === 0 ? null : slice(row.strip).filter((s) => s === "active").length,
    lastLoginAt: row.lastLoginAt,
    lastActiveAt: row.lastActiveAt,
    lastTaskAt: row.lastTaskAt,
  };
}

// 관리자별 순위: by 관리 작업 (the work) only, never by visits or sign-ins;
// equal task counts share a rank.
export function rankByTasks(rows: AdminPeriodFigures[]): (AdminPeriodFigures & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.tasks - a.tasks || a.id - b.id);
  return sorted.map((r) => ({ ...r, rank: sorted.filter((o) => o.tasks > r.tasks).length + 1 }));
}

export type Totals = { visits: number | null; signIns: number | null; tasks: number; activeAdmins: number | null };

export function totalsOf(figures: AdminPeriodFigures[], view: PeriodView): Totals {
  return {
    visits: sumOrNull(figures.map((f) => f.visits)),
    signIns: sumOrNull(figures.map((f) => f.signIns)),
    tasks: figures.reduce((a, f) => a + f.tasks, 0),
    activeAdmins: view.activityDays === 0 ? null : figures.filter((f) => f.isAdmin && (f.activeDays ?? 0) > 0).length,
  };
}

// events (visit starts / sign-ins) of the period, of one admin or all
export function eventsIn(events: { adminId: number; at: Date }[], view: PeriodView, adminId: number | null): Date[] {
  const days = new Set(view.days);
  return events.filter((e) => (adminId === null || e.adminId === adminId) && days.has(kstDayOf(e.at))).map((e) => e.at);
}

export function byHour(times: Date[]): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const t of times) out[kstHourOf(t)] += 1;
  return out;
}

// rows 월..일, columns 0..23
export function byWeekdayHour(times: Date[]): number[][] {
  const out = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0));
  for (const t of times) out[kstWeekdayOf(t)][kstHourOf(t)] += 1;
  return out;
}

// the busiest cells (for the "가장 많은 시간대" line), ties all listed
export function peaks(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return max === 0 ? [] : values.flatMap((v, i) => (v === max ? [i] : []));
}
