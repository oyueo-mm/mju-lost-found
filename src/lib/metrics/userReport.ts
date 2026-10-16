import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/auth/terms";
import { addPeriods, periodStart } from "./dashboard";
import { activityActor, kstDay } from "./record";
import { bucketSpan, bucketsOf, coverageOf, coverageSinceDay, kstNow, sinceLabel, type Coverage, type ReportRange } from "./report";

// 사용자 통계 (/admin/stats?tab=users): sign-ups and signed-in members'
// activity for a KST period. Read-only, aggregates only -- the member rows
// read here (id, timestamps, flags; never names or e-mails) are only
// counted, nothing per member leaves this module.
//
// Three different things, never mixed up:
// - 가입 (sign-up): a User row is created at the member's first Google
//   sign-in (User.created_at). Finishing onboarding (consent + nickname) has
//   no timestamp of its own (consent times are overwritten on re-consent),
//   so only its current state is counted.
// - 로그인 (sign-in): a completed Google sign-in, counted by KST hour from
//   its release on (MetricDaily auth.login.hour.<HH>). Most visits reuse a
//   30-day session and never sign in again, so this is not "activity".
// - 활동 (activity): a member using the site while signed in on a KST day
//   (ActivityDay: one HMAC'd mark per member per day, set by the browser
//   once signed in -- also after signing in midway through a visit). By
//   hour: signed-in page views (MetricDaily visit.member.hour.<HH>, from its
//   release on), judged at each view, not at the start of the visit.
// Admin accounts are left out of activity and participation (they are
// staff); sign-up counts include every account.
//
// Per-member links (new vs existing, retention, who posted) recompute the
// HMAC of each member id in memory to match ActivityDay marks; nothing new
// is stored and only counts come out.

const KST = 9 * 3600_000;
const kst = (column: string) => Prisma.raw(`(("${column}" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')`);
const kstHour = (d: Date) => new Date(d.getTime() + KST).getUTCHours();
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
const asDay = (b: Date | string) => (typeof b === "string" ? b.slice(0, 10) : b.toISOString().slice(0, 10));
const zeros = (n: number) => Array.from({ length: n }, () => 0);

// A member counts as 신규 for 7 days from the KST day of sign-up.
export const NEW_MEMBER_DAYS = 7;
// 재방문: active again on one of the 7 days after the sign-up day.
export const RETURN_WINDOW_DAYS = 7;

export type UserReport = {
  range: ReportRange;
  buckets: string[];
  generatedAt: string;
  today: string;
  accounts: { total: number; current: number; withdrawn: number; onboarded: number; notOnboarded: number; admins: number; suspended: number; external: number };
  signups: {
    inRange: number;
    perBucket: number[];
    cumulative: number[]; // accounts ever created up to the end of each period (withdrawn included)
    byHour: number[];
    byDow: number[];
    peakDay: { day: string; n: number } | null;
    peakDow: { dow: number; n: number } | null;
    peakHour: { hour: number; n: number } | null;
  };
  withdrawals: { inRange: number; perBucket: number[] };
  activity: {
    since: string; // ActivityDay began (운영 지표 release)
    coverage: Coverage;
    perBucketCoverage: Coverage[];
    refDay: string | null; // the day DAU/WAU/MAU refer to
    dau: number | null;
    wau: number | null;
    mau: number | null;
    unique: number | null; // distinct members active in the range
    perBucket: (number | null)[]; // distinct per period
    newPerBucket: (number | null)[]; // of those: within NEW_MEMBER_DAYS of sign-up
    existingPerBucket: (number | null)[];
    memberDaysByDow: number[]; // sum of daily active members per weekday
    daysByDow: number[]; // measured days per weekday (for the average)
    repeat: { active: number; multiDay: number } | null; // active on 2+ days of the range
    retention: { cohort: number; eligible: number; returned: number; excluded: number } | null;
  };
  hourly: {
    memberPvSince: string | null;
    memberPvCoverage: Coverage;
    memberPv: number[] | null; // signed-in page views by KST hour
    loginSince: string | null;
    loginCoverage: Coverage;
    logins: number[] | null; // completed sign-ins by KST hour
  };
  participation: {
    posters: number; // distinct members who posted in the range
    chatters: number; // distinct members who sent a chat message in the range
    activeWithPost: number | null; // active members (range) who also posted in the range
    activeWithChat: number | null;
    newSignups: number; // signed up in the range (admins out)
    newActive: number | null; // of those: an active day on/after sign-up (activity measured)
    newPosted: number; // of those: posted after signing up (until now)
    newChatted: number;
  };
};

type MemberRow = {
  id: number;
  createdAt: Date;
  withdrawnAt: Date | null;
  isAdmin: boolean;
  isSuspended: boolean;
  nickname: string | null;
  privacyConsentVersion: string | null;
  termsVersion: string | null;
  userType: string;
};

function peak<T>(values: number[], key: (i: number) => T): { k: T; n: number } | null {
  let best = -1;
  values.forEach((n, i) => {
    if (n > 0 && (best < 0 || n > values[best])) best = i;
  });
  return best < 0 ? null : { k: key(best), n: values[best] };
}

export async function loadUserReport(range: ReportRange, { now = new Date() } = {}): Promise<UserReport> {
  const today = kstDay(now);
  const buckets = bucketsOf(range);
  const indexOf = (day: string) => buckets.indexOf(periodStart(day, range.unit));
  const inRange = (day: string) => day >= range.from && day < range.until;
  const activitySince = "2026-10-15"; // ActivityDay began with the 운영 지표 release (COLLECTION_SINCE.ops)
  const refDay = (() => {
    const last = addPeriods(range.until, "day", -1);
    const d = last < today ? last : today;
    return d < activitySince ? null : d;
  })();
  const activityFrom = [range.from, refDay ? addPeriods(refDay, "day", -29) : range.from].sort()[0];

  const [members, activityRows, hourRows, firstDays, posters, chatters, newPosters, newChatters] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, createdAt: true, withdrawnAt: true, isAdmin: true, isSuspended: true, nickname: true, privacyConsentVersion: true, termsVersion: true, userType: true },
    }) as Promise<MemberRow[]>,
    prisma.$queryRaw<{ day: Date | string; actor: string }[]>`
      SELECT "day", "actor" FROM "ActivityDay" WHERE "day" >= ${activityFrom}::date AND "day" <= ${today}::date`.catch(() => []),
    prisma.$queryRaw<{ metric: string; n: bigint | number }[]>`
      SELECT "metric", sum("value") AS n FROM "MetricDaily"
      WHERE ("metric" LIKE 'visit.member.hour.%' OR "metric" LIKE 'auth.login.hour.%') AND "day" >= ${range.from}::date AND "day" < ${range.until}::date
      GROUP BY 1`.catch(() => []),
    prisma.$queryRaw<{ pv: Date | string | null; login: Date | string | null }[]>`
      SELECT min("day") FILTER (WHERE "metric" LIKE 'visit.member.hour.%') AS pv, min("day") FILTER (WHERE "metric" LIKE 'auth.login.hour.%') AS login
      FROM "MetricDaily" WHERE "metric" LIKE 'visit.member.hour.%' OR "metric" LIKE 'auth.login.hour.%'`.catch(() => []),
    prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT "user_id" AS id FROM (
        SELECT "user_id", "created_at" FROM "LostPost" UNION ALL SELECT "user_id", "created_at" FROM "FoundPost"
      ) p WHERE ${kst("created_at")} >= ${range.from}::date AND ${kst("created_at")} < ${range.until}::date`,
    prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT "sender_user_id" AS id FROM "Message"
      WHERE ${kst("created_at")} >= ${range.from}::date AND ${kst("created_at")} < ${range.until}::date`,
    // members who signed up in the range and posted / chatted after signing up (until now)
    prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT p."user_id" AS id FROM (
        SELECT "user_id", "created_at" FROM "LostPost" UNION ALL SELECT "user_id", "created_at" FROM "FoundPost"
      ) p JOIN "User" u ON u."id" = p."user_id"
      WHERE ((u."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul') >= ${range.from}::date
        AND ((u."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul') < ${range.until}::date AND p."created_at" >= u."created_at"`,
    prisma.$queryRaw<{ id: number }[]>`
      SELECT DISTINCT m."sender_user_id" AS id FROM "Message" m JOIN "User" u ON u."id" = m."sender_user_id"
      WHERE ((u."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul') >= ${range.from}::date
        AND ((u."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul') < ${range.until}::date AND m."created_at" >= u."created_at"`,
  ]);

  // ---- accounts and sign-ups
  const admins = new Set(members.filter((m) => m.isAdmin).map((m) => m.id));
  const onboarded = (m: MemberRow) => !m.withdrawnAt && !!m.nickname && m.privacyConsentVersion === CURRENT_PRIVACY_VERSION && m.termsVersion === CURRENT_TERMS_VERSION;
  const current = members.filter((m) => !m.withdrawnAt);
  const accounts = {
    total: members.length,
    current: current.length,
    withdrawn: members.length - current.length,
    onboarded: current.filter(onboarded).length,
    notOnboarded: current.filter((m) => !onboarded(m)).length,
    admins: current.filter((m) => m.isAdmin).length,
    suspended: current.filter((m) => m.isSuspended).length,
    external: current.filter((m) => m.userType !== "STUDENT").length,
  };
  const perBucket = zeros(buckets.length);
  const byHour = zeros(24);
  const byDow = zeros(7);
  const perDay = new Map<string, number>();
  const signupDay = new Map<number, string>();
  for (const m of members) {
    const day = kstDay(m.createdAt);
    signupDay.set(m.id, day);
    if (!inRange(day)) continue;
    const i = indexOf(day);
    if (i >= 0) perBucket[i]++;
    byHour[kstHour(m.createdAt)]++;
    byDow[weekday(day)]++;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const cumulative = buckets.map((b) => {
    const end = bucketSpan(range, b).until;
    return members.filter((m) => kstDay(m.createdAt) < end).length;
  });
  const days = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const withdrawalsPerBucket = zeros(buckets.length);
  let withdrawalsInRange = 0;
  for (const m of members) {
    if (!m.withdrawnAt) continue;
    const day = kstDay(m.withdrawnAt);
    if (!inRange(day)) continue;
    withdrawalsInRange++;
    const i = indexOf(day);
    if (i >= 0) withdrawalsPerBucket[i]++;
  }

  // ---- activity (ActivityDay), admins out, actors linked back in memory
  const actorToMember = new Map<string, number>();
  for (const m of members) actorToMember.set(activityActor(m.id), m.id);
  const marks = activityRows
    .map((r) => ({ day: asDay(r.day), member: actorToMember.get(r.actor) ?? null, actor: r.actor }))
    .filter((r) => r.member === null || !admins.has(r.member));
  const activityCoverage = coverageOf("ops", range.from, range.until);
  const perBucketCoverage = buckets.map((b) => {
    const span = bucketSpan(range, b);
    return coverageOf("ops", span.from, span.until);
  });
  const distinct = (rows: typeof marks) => new Set(rows.map((r) => r.actor)).size;
  const inRangeMarks = marks.filter((r) => inRange(r.day));
  const isNew = (r: (typeof marks)[number]) => {
    if (r.member === null) return false;
    const signed = signupDay.get(r.member)!;
    return r.day >= signed && r.day < addPeriods(signed, "day", NEW_MEMBER_DAYS);
  };
  const activityPerBucket = buckets.map((b, i) => {
    if (perBucketCoverage[i] === "none") return { all: null, fresh: null, existing: null };
    const rows = inRangeMarks.filter((r) => periodStart(r.day, range.unit) === b);
    return { all: distinct(rows), fresh: distinct(rows.filter(isNew)), existing: distinct(rows.filter((r) => !isNew(r))) };
  });
  const memberDaysByDow = zeros(7);
  const daysByDow = zeros(7);
  for (let d = range.from > activitySince ? range.from : activitySince; d < range.until && d <= today; d = addPeriods(d, "day", 1)) {
    daysByDow[weekday(d)]++;
    memberDaysByDow[weekday(d)] += distinct(inRangeMarks.filter((r) => r.day === d));
  }
  const windowCount = (from: string, to: string) => distinct(marks.filter((r) => r.day >= from && r.day <= to));
  const perActorDays = new Map<string, number>();
  for (const r of inRangeMarks) perActorDays.set(r.actor, (perActorDays.get(r.actor) ?? 0) + 1);
  // retention: members who signed up in the range, on/after ActivityDay began, whose
  // whole 7-day window after the sign-up day is already over
  const cohort = members.filter((m) => !m.isAdmin && inRange(signupDay.get(m.id)!));
  const eligible = cohort.filter((m) => {
    const day = signupDay.get(m.id)!;
    return day >= activitySince && addPeriods(day, "day", RETURN_WINDOW_DAYS) < today;
  });
  const actorsByMember = new Map<number, Set<string>>();
  for (const r of marks) {
    if (r.member === null) continue;
    let set = actorsByMember.get(r.member);
    if (!set) actorsByMember.set(r.member, (set = new Set()));
    set.add(r.day);
  }
  const returned = eligible.filter((m) => {
    const day = signupDay.get(m.id)!;
    const set = actorsByMember.get(m.id);
    if (!set) return false;
    for (let k = 1; k <= RETURN_WINDOW_DAYS; k++) if (set.has(addPeriods(day, "day", k))) return true;
    return false;
  }).length;

  // ---- hourly counters (from their own release on)
  const firstPv = firstDays[0]?.pv ? asDay(firstDays[0].pv) : null;
  const firstLogin = firstDays[0]?.login ? asDay(firstDays[0].login) : null;
  const memberPv = zeros(24);
  const logins = zeros(24);
  for (const r of hourRows) {
    const pv = /^visit\.member\.hour\.(\d{2})$/.exec(r.metric);
    const lg = /^auth\.login\.hour\.(\d{2})$/.exec(r.metric);
    if (pv) memberPv[Number(pv[1])] += Number(r.n);
    if (lg) logins[Number(lg[1])] += Number(r.n);
  }
  const memberPvCoverage = coverageSinceDay(firstPv, range.from, range.until);
  const loginCoverage = coverageSinceDay(firstLogin, range.from, range.until);

  // ---- participation
  const noAdmin = (rows: { id: number }[]) => new Set(rows.map((r) => Number(r.id)).filter((id) => !admins.has(id)));
  const posterSet = noAdmin(posters);
  const chatterSet = noAdmin(chatters);
  const activeMembers = new Set(inRangeMarks.map((r) => r.member).filter((m): m is number => m !== null));
  const newSet = new Set(cohort.map((m) => m.id));
  const newActive = cohort.filter((m) => {
    const set = actorsByMember.get(m.id);
    return !!set && [...set].some((d) => d >= signupDay.get(m.id)!);
  }).length;
  const measuredNew = cohort.some((m) => signupDay.get(m.id)! >= activitySince);

  return {
    range,
    buckets,
    generatedAt: kstNow(now),
    today,
    accounts,
    signups: {
      inRange: perBucket.reduce((a, n) => a + n, 0),
      perBucket,
      cumulative,
      byHour,
      byDow,
      peakDay: days.length ? { day: days[0][0], n: days[0][1] } : null,
      peakDow: peak(byDow, (i) => i) && { dow: peak(byDow, (i) => i)!.k, n: peak(byDow, (i) => i)!.n },
      peakHour: peak(byHour, (i) => i) && { hour: peak(byHour, (i) => i)!.k, n: peak(byHour, (i) => i)!.n },
    },
    withdrawals: { inRange: withdrawalsInRange, perBucket: withdrawalsPerBucket },
    activity: {
      since: sinceLabel("ops"),
      coverage: activityCoverage,
      perBucketCoverage,
      refDay,
      dau: refDay ? windowCount(refDay, refDay) : null,
      wau: refDay ? windowCount(addPeriods(refDay, "day", -6), refDay) : null,
      mau: refDay ? windowCount(addPeriods(refDay, "day", -29), refDay) : null,
      unique: activityCoverage === "none" ? null : distinct(inRangeMarks),
      perBucket: activityPerBucket.map((b) => b.all),
      newPerBucket: activityPerBucket.map((b) => b.fresh),
      existingPerBucket: activityPerBucket.map((b) => b.existing),
      memberDaysByDow,
      daysByDow,
      repeat: activityCoverage === "none" ? null : { active: perActorDays.size, multiDay: [...perActorDays.values()].filter((n) => n >= 2).length },
      retention: cohort.length ? { cohort: cohort.length, eligible: eligible.length, returned, excluded: cohort.length - eligible.length } : null,
    },
    hourly: {
      memberPvSince: firstPv,
      memberPvCoverage,
      memberPv: memberPvCoverage === "none" ? null : memberPv,
      loginSince: firstLogin,
      loginCoverage,
      logins: loginCoverage === "none" ? null : logins,
    },
    participation: {
      posters: posterSet.size,
      chatters: chatterSet.size,
      activeWithPost: activityCoverage === "none" ? null : [...activeMembers].filter((m) => posterSet.has(m)).length,
      activeWithChat: activityCoverage === "none" ? null : [...activeMembers].filter((m) => chatterSet.has(m)).length,
      newSignups: cohort.length,
      newActive: measuredNew ? newActive : null,
      newPosted: [...noAdmin(newPosters)].filter((id) => newSet.has(id)).length,
      newChatted: [...noAdmin(newChatters)].filter((id) => newSet.has(id)).length,
    },
  };
}
