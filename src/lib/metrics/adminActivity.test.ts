import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

// Raw queries are told apart by their SQL; each returns what the test sets.
type Raw = { sql: string; values: unknown[] };
const raws: Raw[] = [];
let daily: unknown[] = [];
let totals: unknown[] = [];
let recent: unknown[] = [];
let visits: unknown[] = [];
let signIns: unknown[] = [];
let earliest: { log: string | null; presence: string | null } = { log: null, presence: null };
const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const q = Prisma.sql(strings, ...values);
  raws.push({ sql: q.sql, values: q.values });
  if (q.sql.includes("LEAST(")) return [earliest];
  if (q.sql.includes("GROUP BY 1, 2, 3")) return daily;
  if (q.sql.includes("max(e.at)")) return totals;
  if (q.sql.includes('"AdminVisit"')) return visits;
  if (q.sql.includes('WHERE "action" = ')) return signIns;
  return recent;
});
const user = { findMany: vi.fn(), aggregate: vi.fn() };
const metricDaily = { findFirst: vi.fn(), createMany: vi.fn(), findMany: vi.fn() };
const activityDay = { findMany: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw, user, metricDaily, activityDay } }));

const { loadAdminActivity, describeKind, describeTarget, ADMIN_ACTIVITY_SINCE_METRIC, ADMIN_PRESENCE_SINCE_METRIC } = await import("./adminActivity");
const { ADMIN_ACTIVITY_ACTIONS } = await import("@/lib/admin/activityLog");
const { activityActor } = await import("./record");

// 2026-10-17 21:00 KST: the 30 days are 9/18 .. 10/17; 활동일 collection
// began 10/15 03:35, so 10/15 is partial and earlier days 미측정
const NOW = new Date("2026-10-17T12:00:00Z");
const admin = (id: number, extra: object = {}) => ({ id, nickname: `관리자${id}`, isAdmin: true, lastLoginAt: null, lastActiveAt: null, withdrawnAt: null, ...extra });
// the per-admin queries (all but the record-start lookup)
const scoped = () => raws.filter((r) => !r.sql.includes("LEAST("));
const timelineQuery = () => raws.find((r) => r.sql.includes("ORDER BY e.at DESC"));

beforeEach(() => {
  vi.clearAllMocks();
  raws.length = 0;
  daily = [];
  totals = [];
  recent = [];
  visits = [];
  signIns = [];
  earliest = { log: null, presence: null };
  user.findMany.mockResolvedValue([admin(13), admin(20)]);
  user.aggregate.mockResolvedValue({ _min: { lastActiveAt: null } });
  metricDaily.findFirst.mockResolvedValue(null);
  activityDay.findMany.mockResolvedValue([]);
  metricDaily.findMany.mockResolvedValue([]);
});

describe("관리자 활동: who is shown", () => {
  it("an admin without the viewer right gets only their own rows, visits, sign-ins and timeline", async () => {
    await loadAdminActivity({ viewer: 13, all: false, filter: { admin: 20, day: null, kind: null }, now: NOW });
    expect(scoped()).toHaveLength(5);
    for (const r of scoped()) {
      expect(r.sql).toContain("AND e.admin_id =");
      expect(r.values).toContain(13);
      expect(r.values).not.toContain(20); // the filter's admin is ignored
    }
    expect(user.findMany.mock.calls[0][0].where).toEqual({ id: 13 });
  });

  it("a viewer sees every admin; the timeline filter's admin narrows only the timeline", async () => {
    await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(scoped().some((r) => r.sql.includes("AND e.admin_id ="))).toBe(false);
    raws.length = 0;
    await loadAdminActivity({ viewer: 13, all: true, filter: { admin: 20, day: null, kind: null }, now: NOW });
    expect(scoped().filter((r) => r.sql.includes("AND e.admin_id ="))).toEqual([timelineQuery()]);
    expect(timelineQuery()!.values).toContain(20);
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

describe("관리자 활동: 방문·로그인", () => {
  // recording began 10/16 10:00 KST (01:00 UTC)
  const since = () => {
    earliest = { log: null, presence: "2026-10-16T01:00:00.000Z" };
  };

  it("counts visits and sign-ins per admin and KST day; before recording began is 미측정", async () => {
    since();
    visits = [
      // 10/16 23:50 KST and 10/17 00:30 KST: two visits, two days
      { admin_id: 13, at: "2026-10-16T14:50:00.000Z", last: "2026-10-16T15:10:00.000Z" },
      { admin_id: 13, at: "2026-10-16T15:30:00.000Z", last: "2026-10-16T15:35:00.000Z" },
      { admin_id: 20, at: "2026-10-17T02:00:00.000Z", last: "2026-10-17T02:00:00.000Z" },
    ];
    signIns = [{ admin_id: 13, at: "2026-10-16T14:49:00.000Z" }];
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.presenceSince).toBe("2026-10-16 10:00");
    expect(r.presenceStatus.slice(-3)).toEqual(["none", "partial", "full"]);
    const a13 = r.admins.find((a) => a.id === 13)!;
    expect(a13.visits.slice(-3)).toEqual([null, 1, 1]);
    expect(a13.signIns.slice(-3)).toEqual([null, 1, 0]);
    expect([a13.visits7, a13.visits30, a13.signIns7]).toEqual([2, 2, 1]);
    expect(a13.lastVisit).toEqual({ start: new Date("2026-10-16T15:30:00.000Z"), last: new Date("2026-10-16T15:35:00.000Z") });
    expect(r.dailyVisits.slice(-3)).toEqual([null, 1, 2]);
    expect(r.presenceDays7).toBe(2);
  });

  it("all 미측정 (null, not 0) until recording begins", async () => {
    const r = await loadAdminActivity({ viewer: 13, all: false, now: NOW });
    // nothing recorded and the marker is written now: today only, partial
    expect(r.presenceSince).toBe("2026-10-17 21:00");
    expect(r.admins[0].visits.slice(-2)).toEqual([null, 0]);
    expect(r.admins[0].visits30).toBe(0);
    expect(metricDaily.createMany).toHaveBeenCalledWith({
      data: [{ day: new Date("2026-10-17T00:00:00Z"), metric: ADMIN_PRESENCE_SINCE_METRIC, value: 21 * 60 }],
      skipDuplicates: true,
    });
  });

  it("a day with a failed visit write is partial and reported", async () => {
    since();
    metricDaily.findMany.mockResolvedValue([{ metric: "admin.visit.record_failed", day: new Date("2026-10-17T00:00:00Z"), value: 1 }]);
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.visitFailures.at(-1)).toBe(1);
    expect(r.presenceStatus.at(-1)).toBe("partial");
    expect(r.recordFailures.at(-1)).toBe(0);
  });
});

describe("관리자 활동: 타임라인", () => {
  beforeEach(() => {
    earliest = { log: null, presence: "2026-10-10T00:00:00.000Z" };
    recent = [{ admin_id: 20, at: "2026-10-17T03:00:00.000Z", kind: "proposal.approved.grant_admin", target_type: "user", target_id: 31 }];
    signIns = [{ admin_id: 13, at: "2026-10-16T01:00:00.000Z" }];
    visits = [{ admin_id: 13, at: "2026-10-16T01:01:00.000Z", last: "2026-10-16T01:40:00.000Z" }];
  });

  it("merges tasks, sign-ins and visits, newest first, targets by id only", async () => {
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.timeline.map((e) => [e.kind, e.nickname, e.label, e.target])).toEqual([
      ["role", "관리자20", "관리자 지정 승인", "회원 #31"],
      ["visit", "관리자13", "방문", null],
      ["login", "관리자13", "로그인", null],
    ]);
    expect(r.timeline[1].until).toEqual(new Date("2026-10-16T01:40:00.000Z"));
    expect(r.timelineMatched).toBe(3);
  });

  it("filters by kind (no task query for login/visit) and by KST day", async () => {
    const logins = await loadAdminActivity({ viewer: 13, all: true, filter: { admin: null, day: null, kind: "login" }, now: NOW });
    expect(logins.timeline.map((e) => e.kind)).toEqual(["login"]);
    expect(timelineQuery()).toBeUndefined();
    raws.length = 0;
    const day = await loadAdminActivity({ viewer: 13, all: true, filter: { admin: null, day: "2026-10-16", kind: null }, now: NOW });
    expect(day.timeline.map((e) => e.kind)).toEqual(["visit", "login"]);
    // the task query is bounded by the KST day: 10/15 15:00 UTC .. 10/16 15:00 UTC
    expect(timelineQuery()!.values).toContain("2026-10-15T15:00:00.000Z");
    expect(timelineQuery()!.values).toContain("2026-10-16T15:00:00.000Z");
  });

  it("the 7-day period bounds the timeline to the last 7 KST days", async () => {
    const r = await loadAdminActivity({ viewer: 13, all: true, filter: { admin: null, day: null, kind: null, period: 7 }, now: NOW });
    expect(r.filter.period).toBe(7);
    // 10/11 00:00 KST = 10/10 15:00 UTC
    expect(timelineQuery()!.values).toContain("2026-10-10T15:00:00.000Z");
    expect(r.timeline.length).toBe(3);
  });

  it("ignores a day outside the last 30 days", async () => {
    const r = await loadAdminActivity({ viewer: 13, all: true, filter: { admin: null, day: "2025-01-01", kind: null }, now: NOW });
    expect(r.filter.day).toBeNull();
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

  it("sign-ins are never counted as tasks", async () => {
    await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    const events = raws.find((r) => r.sql.includes("GROUP BY 1, 2, 3"))!;
    expect(events.sql).toContain('FROM "AdminActivityLog" WHERE "action" <> ');
    expect(events.values).toContain("auth.sign_in");
  });

  it("marks days before the log began as partial; the log start is its marker or first row", async () => {
    earliest = { log: "2026-10-16T01:00:00.000Z", presence: null };
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(r.logSince).toBe("2026-10-16 10:00");
    expect(r.taskCoverage.slice(-3)).toEqual(["partial", "partial", "full"]);
  });

  it("a day with a failed log write is partial, and its failures are reported", async () => {
    earliest = { log: "2026-10-10T01:00:00.000Z", presence: null };
    metricDaily.findMany.mockResolvedValue([{ metric: "admin.activity.record_failed", day: new Date("2026-10-16T00:00:00Z"), value: 2 }]);
    const r = await loadAdminActivity({ viewer: 13, all: true, now: NOW });
    expect(metricDaily.findMany.mock.calls[0][0].where.metric).toEqual({ in: ["admin.activity.record_failed", "admin.visit.record_failed"] });
    expect(r.recordFailures.slice(-3)).toEqual([0, 2, 0]);
    expect(r.taskCoverage.slice(-3)).toEqual(["full", "partial", "full"]);
  });

  it("writes the start marker once, at the first view", async () => {
    await loadAdminActivity({ viewer: 13, all: false, now: NOW });
    expect(metricDaily.createMany).toHaveBeenCalledWith({
      data: [{ day: new Date("2026-10-17T00:00:00Z"), metric: ADMIN_ACTIVITY_SINCE_METRIC, value: 21 * 60 }],
      skipDuplicates: true,
    });
    metricDaily.findFirst.mockImplementation(async ({ where }: { where: { metric: string } }) => ({ day: new Date("2026-10-16T00:00:00Z"), value: where.metric ? 600 : 0 }));
    metricDaily.createMany.mockClear();
    const r = await loadAdminActivity({ viewer: 13, all: false, now: NOW });
    expect(metricDaily.createMany).not.toHaveBeenCalled();
    expect(r.logSince).toBe("2026-10-16 10:00");
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
    expect(describeKind("log.auth.sign_in")).toBeNull();
  });

  it("never names a person or shows content", () => {
    expect(describeTarget("post", 3)).toBe("분실물 게시글 #3");
    expect(describeTarget("report", null)).toBeNull();
    expect(describeTarget("something", 1)).toBeNull();
  });
});
