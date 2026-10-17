import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AdminActivityReport, AdminActivityRow } from "@/lib/metrics/adminActivity";
import { AdminActivityView } from "./AdminActivityView";

const zero = { report: 0, content: 0, sanction: 0, role: 0, review: 0, operations: 0, access: 0 };
const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10));
// 방문·로그인 recorded from 10/16 (index 28)
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
  timeline: [
    { at: new Date("2026-10-17T03:04:00Z"), adminId: 13, nickname: "관리자13", kind: "report", label: "신고 처리 (조치)", target: "신고 #9" },
    { at: new Date("2026-10-17T02:00:00Z"), adminId: 13, nickname: "관리자13", kind: "visit", label: "방문", target: null, until: new Date("2026-10-17T02:37:00Z") },
    { at: new Date("2026-10-17T01:59:00Z"), adminId: 13, nickname: "관리자13", kind: "login", label: "로그인", target: null },
  ],
  timelineMatched: 3,
  timelineCapped: false,
  filter: { admin: null, day: null, kind: null },
  logSince: "2026-10-17 21:00",
  presenceSince: "2026-10-16 10:00",
  recordFailures: days.map(() => 0),
  visitFailures: days.map(() => 0),
  lastActiveSince: "2026-10-17 01:39",
  ...extra,
});

describe("관리자 활동 화면", () => {
  it("an admin without the viewer right: own card, no admin filter, says so", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13)])} viewer={13} all={false} />);
    expect(html).toContain("내 기록만 표시합니다");
    expect(html).toContain("내 관리 활동");
    expect(html).not.toContain('name="a"');
    expect(html).not.toContain("타임라인</a>");
    expect(html).toContain(">나<");
  });

  it("a viewer: every admin, admin filter, a former admin marked", () => {
    const html = renderToStaticMarkup(
      <AdminActivityView report={report([row(13), row(5, { isAdmin: false })], { filter: { admin: 5, day: "2026-10-16", kind: "visit" } })} viewer={13} all />,
    );
    expect(html).toContain("관리자별 현황");
    expect(html).toMatch(/<select name="a"/);
    expect(html).toContain('href="/admin/stats?tab=admins&amp;a=5#timeline"');
    expect(html).toContain("현재 관리자 아님");
    expect(html).toContain("관리자5 · 2026-10-16 · 방문");
    expect(html).toContain("필터 해제");
  });

  it("visits, sign-ins and the 7-day table; 미측정 days are a dash, never 0", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13)])} viewer={13} all={false} />);
    expect(html).toContain("방문 (최근 7일)");
    expect(html).toContain("4회");
    expect(html).toContain("로그인 (최근 7일)");
    expect(html).toContain("최근 방문 시작");
    expect(html).toContain("2026-10-17 11:00"); // 02:00 UTC
    const week = html.match(/<caption class="sr-only">관리자13의 최근 7일[\s\S]*?<\/table>/)![0];
    expect(week).toContain('title="미측정">–');
    expect(html).toContain("30분 이상 활동이 없다가 다시 이용하면 새 방문");
    expect(html).toContain("2026-10-16 10:00</b>부터 기록합니다");
  });

  it("timeline: tasks, visits with their span, sign-ins, in KST", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13)])} viewer={13} all={false} />);
    const timeline = html.slice(html.indexOf('id="timeline"'));
    expect(timeline).toContain("2026-10-17 12:04"); // 03:04 UTC
    expect(timeline).toContain("11:00 ~ 11:37 (약 37분)");
    expect(timeline).toContain(">로그인</span>");
    expect(timeline).toContain("신고 #9");
    expect(timeline).toContain('action="/admin/stats#timeline"');
    expect(timeline).toContain('method="get"');
  });

  it("KST times; 활동일 with the measured days; 미측정 never shown as 0", () => {
    const html = renderToStaticMarkup(
      <AdminActivityView
        report={report([row(13), row(20, { activeDays7: null, activeDays30: null, lastLoginAt: null, visits7: null })], { lastActiveSince: null })}
        viewer={13}
        all
      />,
    );
    expect(html).toContain("2026-10-17 10:02"); // 01:02 UTC
    expect(html).toContain("(측정된 3일 중)");
    expect(html).toContain("미측정");
    expect(html).toContain("기록 없음");
    expect(html).toContain('title="2026-09-18: 미측정"');
  });

  it("marks categories with tasks recorded only from the log start as 일부 미측정", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13)])} viewer={13} all={false} />);
    expect(html).toContain('title="일부 미측정"');
    expect(html).toContain("2026-10-17 21:00</b>부터 기록합니다");
    expect(html).toContain("추정하지 않음");
    expect(html).not.toContain('role="alert"');
  });

  it("says when tasks or visits could not be recorded, and on which days", () => {
    const failures = days.map((_, i) => (i === 28 ? 2 : 0));
    const html = renderToStaticMarkup(
      <AdminActivityView report={report([row(13)], { recordFailures: failures, visitFailures: failures })} viewer={13} all={false} />,
    );
    expect([...html.matchAll(/role="alert"/g)]).toHaveLength(2);
    expect(html).toContain("완료된 관리 작업 2건의 기록을 저장하지 못했습니다");
    expect(html).toContain("방문·로그인 2건의 기록을 저장하지 못했습니다");
    expect(html).toContain("10/16");
    expect(html).toContain("[admin-activity]");
  });
});
