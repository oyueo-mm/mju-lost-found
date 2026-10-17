import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AdminActivityReport, AdminActivityRow } from "@/lib/metrics/adminActivity";
import { AdminActivityView, type DashboardOptions } from "./AdminActivityView";

const zero = { report: 0, content: 0, sanction: 0, role: 0, review: 0, operations: 0, access: 0 };
// 9/18 .. 10/17; 방문·로그인 recorded from 10/16 (index 28)
const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10));
const presence = (v: number) => days.map((_, i) => (i < 28 ? null : v));
const row = (id: number, extra: Partial<AdminActivityRow> = {}): AdminActivityRow => ({
  id,
  nickname: `관리자${id}`,
  isAdmin: true,
  lastLoginAt: new Date("2026-10-17T01:02:03Z"),
  lastActiveAt: null,
  lastTaskAt: null,
  activeDays7: 2,
  activeDays30: 2,
  strip: days.map((_, i) => (i < 27 ? "none" : i === 29 ? "active" : "inactive")),
  tasks30: { ...zero, report: 3 },
  tasksAll: { ...zero, report: 5, operations: 1 },
  tasksByDay: days.map((_, i) => (i === 29 ? 3 : 0)),
  visits: presence(2),
  signIns: presence(1),
  visits7: 4,
  visits30: 4,
  signIns7: 2,
  signIns30: 2,
  lastVisit: { start: new Date("2026-10-17T02:00:00Z"), last: new Date("2026-10-17T02:37:00Z") },
  ...extra,
});
const report = (admins: AdminActivityRow[], extra: Partial<AdminActivityReport> = {}): AdminActivityReport => ({
  today: "2026-10-17",
  days,
  dayStatus: days.map((_, i) => (i < 27 ? "none" : i === 27 ? "partial" : "full")),
  measuredDays7: 3,
  measuredDays30: 3,
  dailyTasks: days.map(() => ({ ...zero })),
  taskCoverage: days.map(() => "partial"),
  dailyActiveAdmins: days.map((_, i) => (i < 27 ? null : 1)),
  dailyVisits: presence(2),
  dailySignIns: presence(1),
  presenceStatus: days.map((_, i) => (i < 28 ? "none" : i === 28 ? "partial" : "full")),
  presenceDays7: 2,
  presenceDays30: 2,
  admins,
  // 10/17 11:00 KST (Sat) twice, and 10/16 09:30 KST (Fri)
  visitEvents: [
    { adminId: 13, at: new Date("2026-10-17T02:00:00Z") },
    { adminId: 13, at: new Date("2026-10-17T02:45:00Z") },
    { adminId: 20, at: new Date("2026-10-16T00:30:00Z") },
  ],
  signInEvents: [{ adminId: 13, at: new Date("2026-10-17T01:59:00Z") }],
  timeline: [
    { at: new Date("2026-10-17T03:04:00Z"), adminId: 13, nickname: "관리자13", kind: "report", label: "신고 처리 (조치)", target: "신고 #9" },
    { at: new Date("2026-10-17T02:00:00Z"), adminId: 13, nickname: "관리자13", kind: "visit", label: "방문", target: null, until: new Date("2026-10-17T02:37:00Z") },
    { at: new Date("2026-10-16T01:59:00Z"), adminId: 13, nickname: "관리자13", kind: "login", label: "로그인", target: null },
  ],
  timelineMatched: 3,
  timelineCapped: false,
  filter: { admin: null, day: null, kind: null, period: 30 },
  logSince: "2026-10-17 21:00",
  presenceSince: "2026-10-16 10:00",
  recordFailures: days.map(() => 0),
  visitFailures: days.map(() => 0),
  lastActiveSince: "2026-10-17 01:39",
  ...extra,
});
const options = (o: Partial<DashboardOptions> = {}): DashboardOptions => ({ period: 30, hourMetric: "visit", dayMetric: "task", ...o });
const render = (r: AdminActivityReport, all: boolean, o: Partial<DashboardOptions> = {}) =>
  renderToStaticMarkup(<AdminActivityView report={r} viewer={13} all={all} options={options(o)} />);
const section = (html: string, title: string) => {
  const i = html.indexOf(`>${title}</h2>`);
  return html.slice(i, html.indexOf("</section>", i));
};

describe("관리자 활동 대시보드: 권한", () => {
  it("an admin without the viewer right: own summary and detail, no admin choice, no comparison", () => {
    const html = render(report([row(13)]), false);
    expect(html).toContain("내 기록만 표시합니다");
    expect(html).toContain("내 활동 요약");
    expect(html).not.toContain('name="a"');
    expect(html).not.toContain("관리자별 비교");
    expect(html).not.toContain("관리자별 시간대");
  });

  it("a viewer with no admin chosen: summary of all, comparison, admin choice", () => {
    const html = render(report([row(13), row(20, { tasksByDay: days.map(() => 0), visits: presence(1) })]), true);
    expect(html).toContain("전체 관리자 요약");
    expect(html).toMatch(/<select name="a"/);
    expect(html).toContain("관리자별 비교");
    expect(html).toContain("관리자별 시간대 방문 시작 비교");
  });

  it("a viewer with an admin chosen: that admin's summary and detail, a way back", () => {
    const html = render(report([row(13), row(20)], { filter: { admin: 20, day: null, kind: null, period: 30 } }), true);
    expect(html).toContain("관리자20 활동 요약");
    expect(html).not.toContain("관리자별 비교");
    expect(html).toContain("← 전체 관리자 비교");
  });
});

describe("관리자 활동 대시보드: 지표", () => {
  it("summary keeps work and presence apart; 30 days", () => {
    const html = render(report([row(13), row(20, { tasksByDay: days.map(() => 0) })]), true);
    const summary = section(html, "전체 관리자 요약");
    expect(summary).toContain("관리 작업 (업무)");
    expect(summary).toContain("3건"); // 13's 3 tasks; 20 none
    expect(summary).toContain("방문 (접속)");
    expect(summary).toContain("8회"); // 2 per measured day x 2 days x 2 admins
    expect(summary).toContain("측정된 2일 중");
  });

  it("7-day period: only the last 7 days", () => {
    const html = render(report([row(13)]), false, { period: 7 });
    expect(html).toContain("최근 7일");
    expect(html).toContain('aria-current="true"');
  });

  it("comparison ranks by tasks only, and says presence is not work", () => {
    const html = render(report([row(13, { tasksByDay: days.map(() => 0) }), row(20, { visits: presence(9) })]), true);
    const cmp = section(html, "관리자별 비교");
    expect(cmp).toContain("순위는 완료된 관리 작업 건수로만 매깁니다");
    // 20 has 3 tasks and ranks first; 13 has more... no tasks -> no rank
    expect(cmp.indexOf("관리자20")).toBeLessThan(cmp.indexOf("관리자13"));
    expect(cmp).toContain(">–</td>");
  });

  it("daily heatmap: 미측정 (hatched, no link) vs 0 vs counts; a cell links to that day's timeline", () => {
    const html = render(report([row(13)]), false);
    const daily = section(html, "일별 활동");
    expect(daily).toContain('title="방문 2026-09-18: 미측정"');
    expect(daily).toContain("방문 2026-10-17: 2회");
    expect(daily).toContain('href="/admin/stats?tab=admins&amp;p=30&amp;hm=visit&amp;dm=task&amp;day=2026-10-17#timeline"');
    // tasks before the log began: counted, marked 일부 미측정
    expect(daily).toContain("관리 작업 2026-10-17: 3건 (일부 미측정)");
  });

  it("hours: one count per visit, at its start, in KST; weekday x hour grid", () => {
    const html = render(report([row(13), row(20)]), true);
    const hours = section(html, "시간대별 방문·로그인");
    expect(hours).toContain("방문 시작 3회");
    expect(hours).toContain("가장 많은 시간대 11시");
    expect(hours).toContain("토 11시");
    expect(hours).toContain("요일 × 시간대 방문 시작");
    expect(hours).toContain("관리 작업을 한 시각과는 다른 지표");
  });

  it("hours, sign-ins", () => {
    const html = render(report([row(13)]), false, { hourMetric: "login" });
    expect(section(html, "시간대별 방문·로그인")).toContain("로그인 1회 · 가장 많은 시간대 10시");
  });
});

describe("관리자 활동 대시보드: 타임라인", () => {
  it("grouped by day, newest first, coloured by kind, visits with their span", () => {
    const html = render(report([row(13)]), false);
    const timeline = html.slice(html.indexOf('id="timeline"'));
    expect(timeline.indexOf("2026-10-17 (토)")).toBeLessThan(timeline.indexOf("2026-10-16 (금)"));
    expect(timeline).toContain("11:00 ~ 11:37 (약 37분)");
    // sign-in: a hollow blue dot (visits filled blue); tasks have their own colours
    expect(timeline).toMatch(/border-chart-1 bg-card"[^>]*><\/span><time[^>]*>10:59/);
    expect(timeline).toContain('action="/admin/stats#timeline"');
    expect(timeline).toContain('name="p" value="30"');
  });

  it("says when tasks or visits could not be recorded", () => {
    const failures = days.map((_, i) => (i === 28 ? 2 : 0));
    const html = render(report([row(13)], { recordFailures: failures, visitFailures: failures }), false);
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(2);
    expect(html).toContain("10/16");
  });
});
