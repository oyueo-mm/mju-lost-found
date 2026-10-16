import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins for the tables the loader reads. $queryRaw is told
// apart by its SQL text.
type Member = { id: number; createdAt: Date; withdrawnAt: Date | null; isAdmin: boolean; isSuspended: boolean; nickname: string | null; privacyConsentVersion: string | null; termsVersion: string | null; userType: string };
let members: Member[] = [];
let activity: { day: string; actor: string }[] = [];
let metrics: { metric: string; n: number }[] = [];
let firstDays: { pv: string | null; login: string | null } = { pv: null, login: null };
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
      if (sql.includes('FROM "MetricDaily"')) return metrics;
      if (sql.includes('JOIN "User" u ON u."id" = p."user_id"')) return newPosters.map((id) => ({ id }));
      if (sql.includes('JOIN "User" u ON u."id" = m."sender_user_id"')) return newChatters.map((id) => ({ id }));
      if (sql.includes('FROM "Message"')) return chatters.map((id) => ({ id }));
      if (sql.includes('"LostPost"')) return posters.map((id) => ({ id }));
      throw new Error(`unexpected query: ${sql}`);
    },
  },
}));

const { loadUserReport } = await import("./userReport");
const { activityActor } = await import("./record");

const member = (id: number, createdAt: string, over: Partial<Member> = {}): Member => ({
  id,
  createdAt: new Date(createdAt),
  withdrawnAt: null,
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
    expect(r.activity.retention).toEqual({ cohort: 4, eligible: 2, returned: 1, excluded: 2 });
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
      newPosted: 1,
      newChatted: 1,
    });
  });
});
