import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

// Raw queries are told apart by their SQL; each returns what the test sets.
type Raw = { sql: string; values: unknown[] };
const raws: Raw[] = [];
let daily: unknown[] = [];
let totals: unknown[] = [];
let recent: unknown[] = [];
const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = Prisma.sql(strings, ...values);
  raws.push({ sql: q.sql, values: q.values });
  return q.sql.includes("GROUP BY 1, 2, 3") ? daily : q.sql.includes("max(e.at)") ? totals : recent;
});
const user = { findMany: vi.fn(), aggregate: vi.fn() };
const metricDaily = { findFirst: vi.fn(), createMany: vi.fn(), findMany: vi.fn() };
const adminActivityLog = { aggregate: vi.fn() };
const activityDay = { findMany: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, user, metricDaily, adminActivityLog, activityDay } }));

const { loadAdminActivity, describeKind, describeTarget, ADMIN_ACTIVITY_SINCE_METRIC } = await import("./adminActivity");
const { ADMIN_ACTIVITY_ACTIONS } = await import("@/lib/admin/activityLog");
const { activityActor } = await import("./record");

// 2026-10-17 21:00 KST: the 30 days are 9/18 .. 10/17; 활동일 collection
// began 10/15 03:35, so 10/15 is partial and earlier days 미측정
const NOW = new Date("2026-10-17T12:00:00Z");
const admin = (id: number, extra: object = {}) => ({ id, nickname: `관리자${id}`, isAdmin: true, lastLoginAt: null, lastActiveAt: null, withdrawnAt: null, ...extra });
const adminFilters = () => raws.map((r) => (r.sql.includes("AND e.admin_id =") ? r.values.at(-1 - Number(r.sql.includes("LIMIT"))) : "all"));

beforeEach(() => {
  vi.clearAllMocks();
  raws.length = 0;
  daily = [];
  totals = [];
  recent = [];
  user.findMany.mockResolvedValue([admin(13), admin(20)]);
  user.aggregate.mockResolvedValue({ _min: { lastActiveAt: null } });
  metricDaily.findFirst.mockResolvedValue(null);
  adminActivityLog.aggregate.mockResolvedValue({ _min: { createdAt: null } });
  activityDay.findMany.mockResolvedValue([]);
  metricDaily.findMany.mockResolvedValue([]);
});

describe("관리자 활동: who is shown", () => {
  it("an admin without the viewer right gets only their own row and history", async () => {
    await loadAdminActivity({ viewer: 13, all: false, now: NOW });
    expect(raws).toHaveLength(3);
    expect(raws.every((r) => r.sql.includes("AND e.admin_id ="))).toBe(true);
    expect(adminFilters()).toEqual([13, 13, 13]);
    expect(user.findMany.mock.calls[0][0].where).toEqual({ id: 13 });
  });

  it("a viewer sees every admin; `focus` narrows only the history", async () => {
    await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(raws.some((r) => r.sql.includes("AND e.admin_id ="))).toBe(false);
    raws.length = 0;
    await loadAdminActivity({ viewer: 13, all: true, focus: 20, now: NOW });
    expect(adminFilters()).toEqual(["all", "all", 20]);
  });

  it("includes a former admin who has tasks on record, after the current admins", async () => {
    totals = [{ admin_id: 5, kind: "report.actioned", n: 2, last: "2026-10-01T00:00:00.000Z" }];
    user.findMany.mockResolvedValue([admin(5, { isAdmin: false }), admin(13)]);
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(user.findMany.mock.calls[0][0].where).toEqual({ OR: [{ isAdmin: true }, { id: { in: [5] } }] });
    expect(r.admins.map((a) => a.id)).toEqual([13, 5]);
    expect(r.admins[1].tasksAll.report).toBe(2);
  });
});

describe("관리자 활동: 활동일", () => {
  it("counts only measured days; before collection is 미측정, never 0", async () => {
    const mark = (id: number, day: string) => ({ actor: activityActor(id), day: new Date(`${day}T00:00:00Z`) });
    activityDay.findMany.mockResolvedValue([mark(13, "2026-10-15"), mark(13, "2026-10-17"), mark(20, "2026-10-16")]);
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.days[0]).toBe("2026-09-18");
    expect(r.days.at(-1)).toBe("2026-10-17");
    expect(r.dayStatus.slice(-4)).toEqual(["none", "partial", "full", "full"]);
    expect([r.measuredDays7, r.measuredDays30]).toEqual([3, 3]);
    const a13 = r.admins.find((a) => a.id === 13)!;
    expect([a13.activeDays7, a13.activeDays30]).toEqual([2, 2]);
    expect(a13.strip.slice(-4)).toEqual(["none", "active", "inactive", "active"]);
    expect(r.dailyActiveAdmins.slice(-4)).toEqual([null, 1, 1, 1]);
  });

  it("never reads or shows a withdrawn account's marks", async () => {
    user.findMany.mockResolvedValue([admin(13), admin(20, { isAdmin: false, withdrawnAt: new Date(), lastActiveAt: new Date() })]);
    await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(activityDay.findMany.mock.calls[0][0].where.actor.in).toEqual([activityActor(13)]);
  });
});

describe("관리자 활동: 관리 작업", () => {
  it("sums by category per day and per admin, from KST days", async () => {
    daily = [
      { admin_id: 13, kind: "report.dismissed", day: "2026-10-16", n: 2 },
      { admin_id: 13, kind: "moderation.suspend_user", day: "2026-10-16", n: 1 },
      { admin_id: 20, kind: "log.post.delete", day: "2026-10-17", n: 1 },
      { admin_id: 20, kind: "unknown.kind", day: "2026-10-17", n: 9 },
    ];
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.dailyTasks.at(-2)).toMatchObject({ report: 2, sanction: 1 });
    expect(r.dailyTasks.at(-1)).toMatchObject({ content: 1, report: 0 });
    expect(r.admins.find((a) => a.id === 20)!.tasks30.content).toBe(1);
    // KST day boundaries in SQL: UTC wall time + 9 hours
    expect(raws[0].sql).toContain("e.at + interval '9 hours'");
  });

  it("marks days before the log began as partial; the log start is its marker or first row", async () => {
    adminActivityLog.aggregate.mockResolvedValue({ _min: { createdAt: new Date("2026-10-16T01:00:00Z") } });
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.logSince).toBe("2026-10-16 10:00");
    expect(r.taskCoverage.slice(-3)).toEqual(["partial", "partial", "full"]);
  });

  it("a day with a failed log write is partial, and its failures are reported", async () => {
    adminActivityLog.aggregate.mockResolvedValue({ _min: { createdAt: new Date("2026-10-10T01:00:00Z") } });
    metricDaily.findMany.mockResolvedValue([{ day: new Date("2026-10-16T00:00:00Z"), value: 2 }]);
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(metricDaily.findMany.mock.calls[0][0].where.metric).toBe("admin.activity.record_failed");
    expect(r.recordFailures.slice(-3)).toEqual([0, 2, 0]);
    expect(r.taskCoverage.slice(-3)).toEqual(["full", "partial", "full"]);
  });

  it("writes the start marker once, at the first view", async () => {
    await loadAdminActivity({ viewer: 13, all: false, now: NOW });
    expect(metricDaily.createMany).toHaveBeenCalledWith({
      data: [{ day: new Date("2026-10-17T00:00:00Z"), metric: ADMIN_ACTIVITY_SINCE_METRIC, value: 21 * 60 }],
      skipDuplicates: true,
    });
    metricDaily.findFirst.mockImplementation(async ({ where }: { where: { metric: string } }) =>
      where.metric === ADMIN_ACTIVITY_SINCE_METRIC ? { day: new Date("2026-10-16T00:00:00Z"), value: 600 } : null,
    );
    metricDaily.createMany.mockClear();
    const r = await loadAdminActivity({ viewer: 13, all: false, now: NOW });
    expect(metricDaily.createMany).not.toHaveBeenCalled();
    expect(r.logSince).toBe("2026-10-16 10:00");
  });

  it("history: newest first as read, labelled, targets by id only", async () => {
    recent = [
      { admin_id: 20, at: "2026-10-17T03:00:00.000Z", kind: "proposal.approved.grant_admin", target_type: "user", target_id: 31 },
      { admin_id: 13, at: "2026-10-16T03:00:00.000Z", kind: "moderation.delete_post", target_type: "post", target_id: -7 },
    ];
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.history.map((h) => [h.nickname, h.category, h.label, h.target])).toEqual([
      ["관리자20", "role", "관리자 지정 승인", "회원 #31"],
      ["관리자13", "content", "게시글 삭제", "습득물 게시글 #7"],
    ]);
  });
});

describe("describeKind / describeTarget", () => {
  it("labels every logged action and every moderation type", () => {
    for (const key of Object.keys(ADMIN_ACTIVITY_ACTIONS)) expect(describeKind(`log.${key}`)).not.toBeNull();
    for (const t of ["delete_post", "hide_message", "suspend_user", "delete_comment", "temp_hide_post", "temp_hide_comment", "restore_post", "restore_comment"]) {
      expect(describeKind(`moderation.${t}`)).not.toBeNull();
    }
    expect(describeKind("moderation.suspend_user")?.category).toBe("sanction");
    expect(describeKind("proposal.cancelled.revoke_admin")).toEqual({ label: "관리자 해제 요청 취소", category: "role" });
    // a system step (executed / expired) is not an admin's task
    expect(describeKind("proposal.executed.grant_admin")).toBeNull();
    expect(describeKind("log.constructor")).toBeNull();
  });

  it("never names a person or shows content", () => {
    expect(describeTarget("post", 3)).toBe("분실물 게시글 #3");
    expect(describeTarget("report", null)).toBeNull();
    expect(describeTarget("something", 1)).toBeNull();
  });
});
