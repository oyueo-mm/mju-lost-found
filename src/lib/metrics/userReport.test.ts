import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins for the tables the loader reads. $queryRaw is told
// apart by its SQL text.
type Member = { id: number; createdAt: Date; withdrawnAt: Date | null; deletedAt: Date | null; isAdmin: boolean; isSuspended: boolean; nickname: string | null; privacyConsentVersion: string | null; termsVersion: string | null; userType: string };
let members: Member[] = [];
let activity: { day: string; actor: string }[] = [];
let metrics: { metric: string; n: number }[] = [];
let firstDays: { pv: string | null; login: string | null } = { pv: null, login: null };
let sinceRows: { day: string; value: number }[] = [];
let posters: number[] = [];
let chatters: number[] = [];
let newPosters: number[] = [];
let newChatters: number[] = [];

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findMany: async () => members },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "ActivityDay"')) return activity;
      if (sql.includes("min(\"day\") FILTER")) return [firstDays];
      if (sql.includes("LIMIT 1")) return sinceRows;
      if (sql.includes('FROM "MetricDaily"')) return metrics;
      if (sql.includes('JOIN "User" u ON u."id" = p."user_id"')) return newPosters.map((id) => ({ id }));
      if (sql.includes('JOIN "User" u ON u."id" = m."sender_user_id"')) return newChatters.map((id) => ({ id }));
      if (sql.includes('FROM "Message"')) return chatters.map((id) => ({ id }));
      if (sql.includes('"LostPost"')) return posters.map((id) => ({ id }));
      throw new Error(`unexpected query: ${sql}`);
    },
  },
}));

const { loadUserReport, retentionExclusions, windowNote } = await import("./userReport");
const { activityActor } = await import("./record");

const member = (id: number, createdAt: string, over: Partial<Member> = {}): Member => ({
  id,
  createdAt: new Date(createdAt),
  withdrawnAt: null,
  deletedAt: null,
  isAdmin: false,
  isSuspended: false,
  nickname: `m${id}`,
  privacyConsentVersion: "2026-10-14",
  termsVersion: "2026-10-04",
  userType: "STUDENT",
  ...over,
});
const active = (id: number, ...days: string[]) => days.map((day) => ({ day, actor: activityActor(id) }));
const NOW = new Date("2026-10-31T03:00:00Z"); // 2026-10-31 12:00 KST

beforeEach(() => {
  members = [];
  activity = [];
  metrics = [];
  firstDays = { pv: null, login: null };
  sinceRows = [];
  posters = chatters = newPosters = newChatters = [];
});

describe("사용자 통계: 가입 (KST)", () => {
  it("puts a sign-up on its KST day and hour, across midnight, month and year ends", async () => {
    members = [
      member(1, "2026-10-15T14:59:59Z"), // 10-15 23:59 KST
      member(2, "2026-10-15T15:00:00Z"), // 10-16 00:00 KST
      member(3, "2026-09-30T15:30:00Z"), // 10-01 00:30 KST (month boundary)
      member(4, "2025-12-31T15:00:00Z"), // 2026-01-01 00:00 KST (year boundary)
      member(5, "2026-10-20T03:00:00Z", { withdrawnAt: new Date("2026-10-25T01:00:00Z") }),
    ];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.signups.inRange).toBe(4); // 1, 2, 3, 5 (4 is in January)
    expect(r.signups.perBucket[r.buckets.indexOf("2026-10-15")]).toBe(1);
    expect(r.signups.perBucket[r.buckets.indexOf("2026-10-16")]).toBe(1);
    expect(r.signups.perBucket[r.buckets.indexOf("2026-10-01")]).toBe(1);
    expect(r.signups.byHour[23]).toBe(1);
    expect(r.signups.byHour[0]).toBe(2);
    expect(r.signups.cumulative[r.buckets.indexOf("2026-10-14")]).toBe(2); // 3 and 4 by then
    expect(r.signups.cumulative[r.buckets.length - 1]).toBe(5); // withdrawn included
    expect(r.accounts).toMatchObject({ total: 5, current: 4, withdrawn: 1 });
    expect(r.withdrawals.inRange).toBe(1);
    const year = await loadUserReport({ from: "2026-01-01", until: "2026-01-02", unit: "day" }, { now: NOW });
    expect(year.signups.inRange).toBe(1);
  });

  it("counts onboarding from the current state only (consent + nickname)", async () => {
    members = [member(1, "2026-10-16T00:00:00Z"), member(2, "2026-10-16T00:00:00Z", { privacyConsentVersion: "2026-10-05" }), member(3, "2026-10-16T00:00:00Z", { nickname: null })];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.accounts).toMatchObject({ onboarded: 1, notOnboarded: 2 });
  });
});

describe("사용자 통계: 활동", () => {
  it("counts distinct members (no double counting), leaves admins out and splits new / existing", async () => {
    members = [member(1, "2026-10-10T00:00:00Z"), member(2, "2026-10-28T00:00:00Z"), member(9, "2026-10-01T00:00:00Z", { isAdmin: true })];
    activity = [...active(1, "2026-10-28", "2026-10-29", "2026-10-30"), ...active(2, "2026-10-28", "2026-10-30"), ...active(9, "2026-10-30")];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.activity.unique).toBe(2);
    expect(r.activity.dau).toBe(0); // 10-31: nobody yet
    expect(r.activity.wau).toBe(2);
    expect(r.activity.perBucket[r.buckets.indexOf("2026-10-30")]).toBe(2);
    expect(r.activity.newPerBucket[r.buckets.indexOf("2026-10-30")]).toBe(1); // member 2, signed up 10-28
    expect(r.activity.existingPerBucket[r.buckets.indexOf("2026-10-30")]).toBe(1);
    expect(r.activity.repeat).toEqual({ active: 2, multiDay: 2 });
    // before ActivityDay began: 미측정, never 0
    expect(r.activity.perBucket[r.buckets.indexOf("2026-10-14")]).toBeNull();
    expect(r.activity.coverage).toBe("partial");
    const week = await loadUserReport({ from: "2026-10-26", until: "2026-11-01", unit: "week" }, { now: NOW });
    expect(week.activity.perBucket).toEqual([2]); // distinct per week, not the sum of days
  });

  it("returns 재방문 only for sign-ups whose 7 days are over and that began with ActivityDay", async () => {
    members = [
      member(1, "2026-10-16T01:00:00Z"), // returns on 10-20
      member(2, "2026-10-17T01:00:00Z"), // never returns
      member(3, "2026-10-29T01:00:00Z"), // window not over yet
      member(4, "2026-10-10T01:00:00Z"), // before ActivityDay began
    ];
    activity = [...active(1, "2026-10-16", "2026-10-20"), ...active(2, "2026-10-17")];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.activity.retention).toMatchObject({ cohort: 4, eligible: 2, returned: 1, pending: 1, beforeCollection: 1, expired: 0 });
  });

  it("shows hourly member page views and sign-ins only from their first day", async () => {
    metrics = [
      { metric: "visit.member.hour.21", n: 5 },
      { metric: "auth.login.hour.09", n: 2 },
    ];
    firstDays = { pv: "2026-10-20", login: "2026-10-20" };
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.hourly.memberPv?.[21]).toBe(5);
    expect(r.hourly.logins?.[9]).toBe(2);
    expect(r.hourly.memberPvCoverage).toBe("partial");
    const before = await loadUserReport({ from: "2026-10-01", until: "2026-10-10", unit: "day" }, { now: NOW });
    expect(before.hourly.memberPv).toBeNull();
  });
});

describe("사용자 통계: 참여", () => {
  it("matches posters / chatters with active members member by member, admins out", async () => {
    members = [member(1, "2026-10-16T00:00:00Z"), member(2, "2026-10-20T00:00:00Z"), member(3, "2026-09-01T00:00:00Z"), member(9, "2026-10-01T00:00:00Z", { isAdmin: true })];
    activity = [...active(1, "2026-10-21"), ...active(2, "2026-10-22")];
    posters = [1, 3, 9];
    chatters = [2];
    newPosters = [1];
    newChatters = [2];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.participation).toEqual({
      posters: 2, // 1 and 3 (admin 9 out)
      chatters: 1,
      activeWithPost: 1, // member 3 posted but has no active day
      activeWithChat: 1,
      newSignups: 2, // 1 and 2 (admin out of the cohort)
      newActive: 2,
      newBeforeCollection: 0,
      newPosted: 1,
      newChatted: 1,
    });
  });
});

describe("사용자 통계: 회원 수 (B4)", () => {
  it("keeps deactivated accounts in 현재 가입 but apart from 이용 가능, without changing 누적 = 현재 + 탈퇴", async () => {
    members = [
      member(1, "2026-10-16T00:00:00Z"),
      member(2, "2026-10-16T00:00:00Z", { deletedAt: new Date("2026-10-20T00:00:00Z") }), // deactivated
      member(3, "2026-10-16T00:00:00Z", { deletedAt: new Date("2026-10-21T00:00:00Z"), withdrawnAt: new Date("2026-10-21T00:00:00Z") }), // withdrawn
      member(4, "2026-10-16T00:00:00Z", { nickname: null }),
    ];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.accounts).toMatchObject({ total: 4, current: 3, available: 2, deactivated: 1, withdrawn: 1, onboarded: 1, notOnboarded: 1 });
    expect(r.accounts.available + r.accounts.deactivated).toBe(r.accounts.current);
    expect(r.accounts.onboarded + r.accounts.notOnboarded).toBe(r.accounts.available);
    expect(r.signups.inRange).toBe(4); // sign-ups and withdrawals keep their meaning
    expect(r.withdrawals.inRange).toBe(1);
  });
});

describe("사용자 통계: 신규·기존 (B2)", () => {
  it("puts each member on one side per period, so 신규 + 기존 = the period's distinct count", async () => {
    members = [
      member(1, "2026-10-16T01:00:00Z"), // new until 10-22, existing from 10-23
      member(2, "2026-09-01T01:00:00Z"), // existing
      member(3, "2026-10-26T01:00:00Z"), // new
    ];
    activity = [...active(1, "2026-10-17", "2026-10-22", "2026-10-25"), ...active(2, "2026-10-17", "2026-10-28"), ...active(3, "2026-10-27")];
    for (const unit of ["day", "week", "month"] as const) {
      const r = await loadUserReport({ from: "2026-10-12", until: "2026-11-01", unit }, { now: NOW });
      r.activity.perBucket.forEach((all, i) => {
        if (all === null) return;
        expect(r.activity.newPerBucket[i]! + r.activity.existingPerBucket[i]!).toBe(all);
      });
    }
    const month = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "month" }, { now: NOW });
    expect(month.activity.perBucket).toEqual([3]);
    expect(month.activity.newPerBucket).toEqual([2]); // 1 (new on 10-17 although existing on 10-25) and 3
    expect(month.activity.existingPerBucket).toEqual([1]);
    const week = await loadUserReport({ from: "2026-10-19", until: "2026-10-26", unit: "week" }, { now: NOW });
    expect(week.activity.perBucket).toEqual([1]); // member 1: new on 10-22, existing on 10-25
    expect(week.activity.newPerBucket).toEqual([1]);
    expect(week.activity.existingPerBucket).toEqual([0]);
  });
});

describe("사용자 통계: 재방문 (B1)", () => {
  it("tells 집계 대기 from 미측정, even for a window that is over but reaches before ActivityDay", async () => {
    members = [
      member(1, "2026-10-16T01:00:00Z"), // eligible, returns on 10-20
      member(2, "2026-10-17T01:00:00Z"), // eligible, never returns
      member(3, "2026-10-15T01:00:00Z"), // window 10-16..10-22: fully measured -> eligible
      member(4, "2026-10-14T01:00:00Z"), // window 10-15..10-21 is over, but 10-15 began at 03:35 -> 미측정
      member(5, "2026-10-02T01:00:00Z"), // before ActivityDay -> 미측정
      member(6, "2026-10-29T01:00:00Z"), // window not over -> 집계 대기
      member(7, "2026-10-20T01:00:00Z", { isAdmin: true }), // admins out
    ];
    activity = [...active(1, "2026-10-16", "2026-10-20"), ...active(2, "2026-10-17"), ...active(4, "2026-10-18")];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.activity.retention).toEqual({ cohort: 6, eligible: 3, returned: 1, pending: 1, beforeCollection: 2, expired: 0, nextReadyDay: "2026-11-06" });
    expect(retentionExclusions(r.activity.retention!)).toEqual([
      "집계 대기 1명(7일이 아직 안 지남, 2026-11-06부터 산출)",
      "미측정 2명(재방문 기간에 활동 기록 시작 전 날짜 포함)",
    ]);
    // the day before 2026-11-06 the window is still running
    const wait = await loadUserReport({ from: "2026-10-29", until: "2026-10-30", unit: "day" }, { now: new Date("2026-11-05T03:00:00Z") });
    expect(wait.activity.retention).toMatchObject({ eligible: 0, pending: 1 });
    const ready = await loadUserReport({ from: "2026-10-29", until: "2026-10-30", unit: "day" }, { now: new Date("2026-11-06T03:00:00Z") });
    expect(ready.activity.retention).toMatchObject({ eligible: 1, pending: 0, nextReadyDay: null });
  });

  it("counts a window whose marks are past the 400-day retention as 미측정, and shows that activity as 미측정, not 0", async () => {
    const later = new Date("2027-12-31T03:00:00Z"); // retained from 2026-11-26
    members = [member(1, "2026-10-20T01:00:00Z"), member(2, "2026-12-01T01:00:00Z")];
    activity = [...active(2, "2026-12-03")];
    const old = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: later });
    expect(old.activity.retention).toMatchObject({ cohort: 1, eligible: 0, expired: 1, beforeCollection: 0 });
    expect(old.activity.unique).toBeNull();
    expect(old.activity.perBucket.every((v) => v === null)).toBe(true);
    expect(old.activity.coverage).toBe("none");
    expect(old.activity.expiredInRange).toBe(true);
    const span = await loadUserReport({ from: "2026-11-20", until: "2026-12-10", unit: "day" }, { now: later });
    expect(span.activity.coverage).toBe("partial");
    expect(span.activity.perBucket[span.buckets.indexOf("2026-11-25")]).toBeNull();
    expect(span.activity.perBucket[span.buckets.indexOf("2026-11-26")]).toBe(0);
    expect(span.activity.retention).toMatchObject({ eligible: 1, returned: 1 });
  });
});

describe("사용자 통계: DAU·WAU·MAU 부분 측정", () => {
  it("marks a window reaching before ActivityDay as partial, and the start day itself", async () => {
    members = [member(1, "2026-09-01T00:00:00Z")];
    activity = [...active(1, "2026-10-16")];
    const at = new Date("2026-10-16T05:00:00Z");
    const r = await loadUserReport({ from: "2026-10-16", until: "2026-10-17", unit: "day" }, { now: at });
    expect(r.activity.windows).toEqual({ dau: "full", wau: "partial", mau: "partial" });
    expect(r.activity.dau).toBe(1);
    expect(windowNote(r.activity.windows.wau, 7, r.activity)).toBe("기준일 포함 7일 · 부분 측정(2026-10-15 03:35부터만 기록)");
    expect(windowNote(r.activity.windows.dau, 1, r.activity)).toBe("2026-10-16 기준");
    const first = await loadUserReport({ from: "2026-10-15", until: "2026-10-16", unit: "day" }, { now: at });
    expect(first.activity.windows.dau).toBe("partial"); // began at 03:35
    const before = await loadUserReport({ from: "2026-10-01", until: "2026-10-15", unit: "day" }, { now: at });
    expect(before.activity).toMatchObject({ refDay: null, dau: null, wau: null, mau: null });
    const later = await loadUserReport({ from: "2026-11-20", until: "2026-11-21", unit: "day" }, { now: new Date("2026-11-21T03:00:00Z") });
    expect(later.activity.windows).toEqual({ dau: "full", wau: "full", mau: "full" });
  });
});

describe("사용자 통계: 시간대별 수집 시작 (B3)", () => {
  it("starts at this environment's marker: 0 when nothing was recorded since, 미측정 before", async () => {
    sinceRows = [{ day: "2026-10-20", value: 10 * 60 + 5 }];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.hourly.logins).toEqual(Array(24).fill(0));
    expect(r.hourly.loginTotal).toBe(0);
    expect(r.hourly.memberPvTotal).toBe(0);
    expect(r.hourly.loginCoverage).toBe("partial");
    expect(r.hourly.loginSince).toBe("2026-10-20 10:05");
    const after = await loadUserReport({ from: "2026-10-21", until: "2026-10-22", unit: "day" }, { now: NOW });
    expect(after.hourly.loginCoverage).toBe("full");
    const before = await loadUserReport({ from: "2026-10-01", until: "2026-10-20", unit: "day" }, { now: NOW });
    expect(before.hourly).toMatchObject({ logins: null, loginTotal: null, memberPv: null, memberPvTotal: null });
  });

  it("falls back to the first recorded day (time unknown) when the data predates the marker, and to 수집 전 without either", async () => {
    sinceRows = [{ day: "2026-10-22", value: 600 }];
    firstDays = { pv: "2026-10-16", login: null };
    metrics = [{ metric: "visit.member.hour.21", n: 2 }];
    const r = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(r.hourly.memberPvSince).toBe("2026-10-16");
    expect(r.hourly.memberPvTotal).toBe(2);
    expect(r.hourly.loginSince).toBe("2026-10-22 10:00");
    // counts on the marker's own day may predate it: day only
    sinceRows = [{ day: "2026-10-16", value: 17 * 60 + 30 }];
    const same = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(same.hourly.memberPvSince).toBe("2026-10-16");
    expect(same.hourly.loginSince).toBe("2026-10-16 17:30");
    expect(same.hourly.loginTotal).toBe(0);
    sinceRows = [];
    firstDays = { pv: null, login: null };
    const none = await loadUserReport({ from: "2026-10-01", until: "2026-11-01", unit: "day" }, { now: NOW });
    expect(none.hourly).toMatchObject({ memberPvSince: null, loginSince: null, memberPv: null, logins: null });
  });
});
