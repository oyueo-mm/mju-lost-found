import { describe, expect, it } from "vitest";

import type { AdminActivityReport, AdminActivityRow } from "./adminActivity";
import { adminFigures, byHour, byWeekdayHour, eventsIn, kstHourOf, kstWeekdayOf, peaks, periodView, rankByTasks, totalsOf } from "./adminActivityStats";

const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10));
const report = {
  days,
  presenceStatus: days.map((_, i) => (i < 28 ? "none" : i === 28 ? "partial" : "full")),
  dayStatus: days.map((_, i) => (i < 27 ? "none" : "full")),
  taskCoverage: days.map(() => "full"),
} as unknown as AdminActivityReport;
const row = (id: number, tasks: number[], visits: (number | null)[], extra: Partial<AdminActivityRow> = {}) =>
  ({
    id,
    nickname: `관리자${id}`,
    isAdmin: true,
    lastLoginAt: null,
    lastActiveAt: null,
    lastTaskAt: null,
    strip: days.map((_, i) => (i < 27 ? "none" : i === 29 ? "active" : "inactive")),
    tasksByDay: tasks,
    visits,
    signIns: visits.map((v) => (v === null ? null : 1)),
    ...extra,
  }) as AdminActivityRow;
const pad = <T,>(tail: T[], fill: T): T[] => [...Array.from({ length: 30 - tail.length }, () => fill), ...tail];

describe("KST hour and weekday", () => {
  it("UTC 15:00 is the next KST day at 0시; 2026-10-18 is a Sunday", () => {
    expect(kstHourOf(new Date("2026-10-17T14:59:00Z"))).toBe(23);
    expect(kstHourOf(new Date("2026-10-17T15:00:00Z"))).toBe(0);
    expect(kstWeekdayOf(new Date("2026-10-17T14:59:00Z"))).toBe(5); // 토
    expect(kstWeekdayOf(new Date("2026-10-17T15:00:00Z"))).toBe(6); // 일
  });

  it("each visit counts once, in the hour and weekday it started", () => {
    const times = [new Date("2026-10-17T14:59:00Z"), new Date("2026-10-17T15:00:00Z"), new Date("2026-10-17T15:30:00Z")];
    const h = byHour(times);
    expect(h[23]).toBe(1);
    expect(h[0]).toBe(2);
    expect(h.reduce((a, n) => a + n, 0)).toBe(3);
    const g = byWeekdayHour(times);
    expect(g[5][23]).toBe(1);
    expect(g[6][0]).toBe(2);
    expect(peaks(h)).toEqual([0]);
    expect(peaks(Array(24).fill(0))).toEqual([]);
  });
});

describe("period views", () => {
  it("7 days: the last 7, with the measured days counted", () => {
    const v = periodView(report, 7);
    expect(v.days).toEqual(days.slice(23));
    expect(v.offset).toBe(23);
    expect(v.presenceDays).toBe(2);
    expect(v.activityDays).toBe(3);
  });

  it("events of the period by KST day, one admin or all", () => {
    const v = periodView(report, 7);
    const events = [
      { adminId: 1, at: new Date("2026-10-10T14:59:00Z") }, // 10/10 KST -- outside
      { adminId: 1, at: new Date("2026-10-10T15:00:00Z") }, // 10/11 KST -- first day
      { adminId: 2, at: new Date("2026-10-17T02:00:00Z") },
    ];
    expect(eventsIn(events, v, null)).toHaveLength(2);
    expect(eventsIn(events, v, 2)).toHaveLength(1);
  });

  it("figures: presence 미측정 (null) for a period with nothing recorded; tasks always counted", () => {
    const early = { ...report, presenceStatus: days.map(() => "none") } as unknown as AdminActivityReport;
    const f = adminFigures(row(1, pad([2], 0), days.map(() => null)), periodView(early, 7));
    expect(f.visits).toBeNull();
    expect(f.tasks).toBe(2);
    const g = adminFigures(row(1, pad([2, 0, 1], 0), pad([3, 0], null)), periodView(report, 7));
    expect([g.visits, g.signIns, g.tasks, g.activeDays]).toEqual([3, 2, 3, 1]);
  });

  it("ranks by tasks only (ties share a rank); totals keep presence and work apart", () => {
    const v = periodView(report, 30);
    const figs = [
      adminFigures(row(1, pad([1], 0), pad([9, 9], null)), v),
      adminFigures(row(2, pad([5], 0), pad([1, 0], null)), v),
      adminFigures(row(3, pad([1], 0), pad([0, 0], null), { isAdmin: false }), v),
    ];
    expect(rankByTasks(figs).map((r) => [r.id, r.rank])).toEqual([
      [2, 1],
      [1, 2],
      [3, 2],
    ]);
    expect(totalsOf(figs, v)).toEqual({ visits: 19, signIns: 6, tasks: 7, activeAdmins: 2 });
  });
});
