import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AdminActivityReport, AdminActivityRow } from "@/lib/metrics/adminActivity";
import { AdminActivityView } from "./AdminActivityView";

const zero = { report: 0, content: 0, sanction: 0, role: 0, review: 0, operations: 0, access: 0 };
const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 18 + i)).toISOString().slice(0, 10));
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
  admins,
  history: [{ at: new Date("2026-10-17T03:04:00Z"), adminId: 13, nickname: "관리자13", category: "report", label: "신고 처리 (조치)", target: "신고 #9" }],
  historyFrom: days[0],
  logSince: "2026-10-17 21:00",
  lastActiveSince: "2026-10-17 01:39",
  ...extra,
});

describe("관리자 활동 화면", () => {
  it("an admin without the viewer right: own card, no admin filter, says so", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13)])} viewer={13} all={false} focus={null} />);
    expect(html).toContain("내 기록만 표시합니다");
    expect(html).toContain("내 관리 활동");
    expect(html).not.toContain('aria-label="관리자 선택"');
    expect(html).not.toContain("작업 이력</a>");
    expect(html).toContain(">나<");
  });

  it("a viewer: every admin, history filter, a former admin marked", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13), row(5, { isAdmin: false })])} viewer={13} all focus={5} />);
    expect(html).toContain("관리자별 현황");
    expect(html).toContain('aria-label="관리자 선택"');
    expect(html).toContain('href="/admin/stats?tab=admins&amp;a=5#history"');
    expect(html).toContain("현재 관리자 아님");
    expect(html).toContain("· 관리자5");
  });

  it("KST times; 활동일 with the measured days; 미측정 never shown as 0", () => {
    const html = renderToStaticMarkup(
      <AdminActivityView report={report([row(13), row(20, { activeDays7: null, activeDays30: null, lastLoginAt: null })], { lastActiveSince: null })} viewer={13} all focus={null} />,
    );
    expect(html).toContain("2026-10-17 10:02"); // 01:02 UTC
    expect(html).toContain("2026-10-17 12:04"); // history, 03:04 UTC
    expect(html).toContain("(측정된 3일 중)");
    expect(html).toContain("미측정");
    expect(html).toContain("기록 없음");
    expect(html).toContain('title="2026-09-18: 미측정"');
  });

  it("marks categories with tasks recorded only from the log start as 일부 미측정", () => {
    const html = renderToStaticMarkup(<AdminActivityView report={report([row(13)])} viewer={13} all={false} focus={null} />);
    expect(html).toContain('title="일부 미측정"');
    expect(html).toContain("2026-10-17 21:00</b>부터 기록합니다");
    expect(html).toContain("추정하지 않음");
  });
});
