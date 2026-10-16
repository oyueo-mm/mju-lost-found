import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/auth/terms";
import { addPeriods, periodStart } from "./dashboard";
import { activityActor, kstDay, USER_HOURLY_SINCE_METRIC } from "./record";
import {
  ACTIVITY_FIRST_FULL_DAY,
  activityCoverageOf,
  activityRetainedFrom,
  bucketSpan,
  bucketsOf,
  COLLECTION_SINCE,
  kstNow,
  sinceLabel,
  type Coverage,
  type ReportRange,
} from "./report";

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
// Accounts: 누적 = 현재 + 탈퇴; 현재 = 이용 가능 + 비활성화 (a deactivated
// account -- deletedAt without withdrawnAt -- can be reactivated, so it is
// still a member, shown apart; the onboarding / admin / suspended /
// external splits are of the 이용 가능 accounts).
// 미측정 is never 0: activity before ActivityDay began or past its 400-day
// retention, and the hourly counters before this environment's collection
// start (record.ts USER_HOURLY_SINCE_METRIC), are null.
//
// Per-member links (new vs existing, retention, who posted) recompute the
// HMAC of each member id in memory to match ActivityDay marks; nothing new
// is stored and only counts come out.
// 회원탈퇴 deletes the member's marks (auth/withdrawal.ts), so 활성 회원
// counts of past periods drop when someone withdraws, and a withdrawn
// sign-up's 재방문 is unknown -- left out as 탈퇴, never counted as "did
// not return".

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
  accounts: {
    total: number; // every account ever created (= current + withdrawn)
    current: number; // not withdrawn (= available + deactivated)
    available: number;
    deactivated: number;
    withdrawn: number;
    onboarded: number; // of available
    notOnboarded: number; // of available
    admins: number; // of available
    suspended: number; // of available
    external: number; // of available
  };
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
    retainedFrom: string; // days before it may already be deleted (400-day retention)
    expiredInRange: boolean; // part of the range is past retention (미측정)
    coverage: Coverage;
    perBucketCoverage: Coverage[];
    refDay: string | null; // the day DAU/WAU/MAU refer to
    windows: { dau: Coverage; wau: Coverage; mau: Coverage }; // partial: the window reaches unmeasured days
    dau: number | null;
    wau: number | null;
    mau: number | null;
    unique: number | null; // distinct members active in the range
    perBucket: (number | null)[]; // distinct per period
    newPerBucket: (number | null)[]; // of those: new on any of their active days in the period
    existingPerBucket: (number | null)[]; // the rest (new + existing = perBucket)
    memberDaysByDow: number[]; // sum of daily active members per weekday
    daysByDow: number[]; // measured days per weekday (for the average)
    repeat: { active: number; multiDay: number } | null; // active on 2+ days of the range
    // The range's sign-ups (admins out) by whether their return window --
    // the RETURN_WINDOW_DAYS days after the sign-up day -- can be judged:
    // eligible (over, measured end to end), pending (not over yet),
    // beforeCollection / expired (it reaches days without ActivityDay:
    // before it began, or past retention -- 미측정 even when over),
    // withdrawn (their marks were deleted at 회원탈퇴).
    retention: {
      cohort: number;
      eligible: number;
      returned: number;
      pending: number;
      beforeCollection: number;
      expired: number;
      withdrawn: number;
      nextReadyDay: string | null; // first day the earliest pending sign-up can be judged
    } | null;
  };
  hourly: {
    memberPvSince: string | null; // "YYYY-MM-DD HH:MM", or the day alone when only known from the data
    memberPvCoverage: Coverage;
    memberPv: number[] | null; // signed-in page views by KST hour
    memberPvTotal: number | null;
    loginSince: string | null;
    loginCoverage: Coverage;
    logins: number[] | null; // completed sign-ins by KST hour
    loginTotal: number | null;
  };
  participation: {
    posters: number; // distinct members who posted in the range
    chatters: number; // distinct members who sent a chat message in the range
    activeWithPost: number | null; // active members (range) who also posted in the range
    activeWithChat: number | null;
    newSignups: number; // signed up in the range (admins out)
    newActive: number | null; // of those: an active day on/after sign-up (activity measured)
    newBeforeCollection: number; // of those: signed up before ActivityDay began (earlier activity 미측정)
    newWithdrawn: number; // of those: withdrawn since (their activity marks are deleted)
    newPosted: number; // of those: posted after signing up (until now)
    newChatted: number;
  };
};

type MemberRow = {
  id: number;
  createdAt: Date;
  withdrawnAt: Date | null;
  deletedAt: Date | null;
  isAdmin: boolean;
  isSuspended: boolean;
  nickname: string | null;
  privacyConsentVersion: string | null;
  termsVersion: string | null;
  userType: string;
};

type Since = { day: string; minute: number | null };

// Collection start of the hourly counters: this environment's marker row.
// Counts on the marker's own day or earlier may come from a deployment
// before the marker existed (Preview ran the counters before it), so then
// the first recorded day is the start, its time unknown (a partial day).
export function hourlySince(marker: Since | null, firstDay: string | null): Since | null {
  if (marker && (!firstDay || marker.day < firstDay)) return marker;
  return firstDay ? { day: firstDay, minute: null } : null;
}

export function sinceCoverage(since: Since | null, from: string, until: string): Coverage {
  if (!since || until <= since.day) return "none";
  if (from > since.day || (from === since.day && since.minute === 0)) return "full";
  return "partial";
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const sinceText = (since: Since | null) => (!since ? null : since.minute === null ? since.day : `${since.day} ${hhmm(since.minute)}`);

// Why sign-ups' 7-day return can't be judged (yet), by reason; only reasons that apply.
export function retentionExclusions(ret: NonNullable<UserReport["activity"]["retention"]>): string[] {
  return [
    ret.pending ? `집계 대기 ${ret.pending}명(${RETURN_WINDOW_DAYS}일이 아직 안 지남${ret.nextReadyDay ? `, ${ret.nextReadyDay}부터 산출` : ""})` : null,
    ret.beforeCollection ? `미측정 ${ret.beforeCollection}명(재방문 기간에 활동 기록 시작 전 날짜 포함)` : null,
    ret.expired ? `미측정 ${ret.expired}명(보관기한 400일이 지나 활동 기록 삭제)` : null,
    ret.withdrawn ? `탈퇴 ${ret.withdrawn}명(탈퇴로 활동 기록 삭제)` : null,
  ].filter((s): s is string => s !== null);
}

// DAU / WAU / MAU basis; a window reaching days without activity marks is partial.
export function windowNote(coverage: Coverage, days: number, activity: UserReport["activity"]): string {
  const base = days === 1 ? (activity.refDay ? `${activity.refDay} 기준` : "미측정") : `기준일 포함 ${days}일`;
  if (coverage !== "partial" || !activity.refDay) return base;
  const start = addPeriods(activity.refDay, "day", 1 - days);
  const why = start < activity.retainedFrom && activity.retainedFrom > activity.since.slice(0, 10) ? `${activity.retainedFrom} 이전은 보관기한이 지나 제외` : `${activity.since}부터만 기록`;
  return `${base} · 부분 측정(${why})`;
}

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
  const activitySince = COLLECTION_SINCE.ops.slice(0, 10); // ActivityDay began with the 운영 지표 release
  const retainedFrom = activityRetainedFrom(today);
  const measuredFrom = activitySince > retainedFrom ? activitySince : retainedFrom; // first day that can hold marks
  const covered = (from: string, until: string) => activityCoverageOf(from, until, today);
  const refDay = (() => {
    const last = addPeriods(range.until, "day", -1);
    const d = last < today ? last : today;
    return d < measuredFrom ? null : d;
  })();
  const activityFrom = [range.from, refDay ? addPeriods(refDay, "day", -29) : range.from].sort()[0];

  const [members, activityRows, hourRows, firstDays, sinceRows, posters, chatters, newPosters, newChatters] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, createdAt: true, withdrawnAt: true, deletedAt: true, isAdmin: true, isSuspended: true, nickname: true, privacyConsentVersion: true, termsVersion: true, userType: true },
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
    prisma.$queryRaw<{ day: Date | string; value: number }[]>`
      SELECT "day", "value" FROM "MetricDaily" WHERE "metric" = ${USER_HOURLY_SINCE_METRIC} ORDER BY "day" LIMIT 1`.catch(() => []),
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
  const onboarded = (m: MemberRow) => !!m.nickname && m.privacyConsentVersion === CURRENT_PRIVACY_VERSION && m.termsVersion === CURRENT_TERMS_VERSION;
  const current = members.filter((m) => !m.withdrawnAt);
  const available = current.filter((m) => !m.deletedAt);
  const accounts = {
    total: members.length,
    current: current.length,
    available: available.length,
    deactivated: current.length - available.length,
    withdrawn: members.length - current.length,
    onboarded: available.filter(onboarded).length,
    notOnboarded: available.filter((m) => !onboarded(m)).length,
    admins: available.filter((m) => m.isAdmin).length,
    suspended: available.filter((m) => m.isSuspended).length,
    external: available.filter((m) => m.userType !== "STUDENT").length,
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
  const activityCoverage = covered(range.from, range.until);
  const perBucketCoverage = buckets.map((b) => {
    const span = bucketSpan(range, b);
    return covered(span.from, span.until);
  });
  const distinct = (rows: typeof marks) => new Set(rows.map((r) => r.actor)).size;
  const inRangeMarks = marks.filter((r) => inRange(r.day));
  const isNew = (r: (typeof marks)[number]) => {
    if (r.member === null) return false;
    const signed = signupDay.get(r.member)!;
    return r.day >= signed && r.day < addPeriods(signed, "day", NEW_MEMBER_DAYS);
  };
  // One member is either 신규 or 기존 in a period: 신규 when new on any of
  // its active days there (a member only ever goes from new to existing),
  // so 신규 + 기존 is the period's distinct count.
  const activityPerBucket = buckets.map((b, i) => {
    if (perBucketCoverage[i] === "none") return { all: null, fresh: null, existing: null };
    const rows = inRangeMarks.filter((r) => periodStart(r.day, range.unit) === b);
    const all = distinct(rows);
    const fresh = distinct(rows.filter(isNew));
    return { all, fresh, existing: all - fresh };
  });
  const memberDaysByDow = zeros(7);
  const daysByDow = zeros(7);
  for (let d = range.from > measuredFrom ? range.from : measuredFrom; d < range.until && d <= today; d = addPeriods(d, "day", 1)) {
    daysByDow[weekday(d)]++;
    memberDaysByDow[weekday(d)] += distinct(inRangeMarks.filter((r) => r.day === d));
  }
  const windowCount = (from: string, to: string) => distinct(marks.filter((r) => r.day >= from && r.day <= to));
  const perActorDays = new Map<string, number>();
  for (const r of inRangeMarks) perActorDays.set(r.actor, (perActorDays.get(r.actor) ?? 0) + 1);
  const cohort = members.filter((m) => !m.isAdmin && inRange(signupDay.get(m.id)!));
  const windowStatus = (m: MemberRow) => {
    if (m.withdrawnAt) return "withdrawn" as const;
    const first = addPeriods(signupDay.get(m.id)!, "day", 1);
    if (first < ACTIVITY_FIRST_FULL_DAY) return "beforeCollection" as const;
    if (first < retainedFrom) return "expired" as const;
    if (addPeriods(first, "day", RETURN_WINDOW_DAYS - 1) >= today) return "pending" as const;
    return "eligible" as const;
  };
  const statusOf = new Map(cohort.map((m) => [m.id, windowStatus(m)]));
  const countStatus = (s: ReturnType<typeof windowStatus>) => cohort.filter((m) => statusOf.get(m.id) === s).length;
  const eligible = cohort.filter((m) => statusOf.get(m.id) === "eligible");
  const pendingDays = cohort.filter((m) => statusOf.get(m.id) === "pending").map((m) => signupDay.get(m.id)!).sort();
  const activeDaysByMember = new Map<number, Set<string>>();
  for (const r of marks) {
    if (r.member === null) continue;
    let set = activeDaysByMember.get(r.member);
    if (!set) activeDaysByMember.set(r.member, (set = new Set()));
    set.add(r.day);
  }
  const returned = eligible.filter((m) => {
    const day = signupDay.get(m.id)!;
    const set = activeDaysByMember.get(m.id);
    if (!set) return false;
    for (let k = 1; k <= RETURN_WINDOW_DAYS; k++) if (set.has(addPeriods(day, "day", k))) return true;
    return false;
  }).length;
  const windows = refDay
    ? {
        dau: covered(refDay, addPeriods(refDay, "day", 1)),
        wau: covered(addPeriods(refDay, "day", -6), addPeriods(refDay, "day", 1)),
        mau: covered(addPeriods(refDay, "day", -29), addPeriods(refDay, "day", 1)),
      }
    : { dau: "none" as const, wau: "none" as const, mau: "none" as const };
  const windowValue = (c: Coverage, days: number) => (refDay && c !== "none" ? windowCount(addPeriods(refDay, "day", 1 - days), refDay) : null);

  // ---- hourly counters (from this environment's collection start on)
  const marker: Since | null = sinceRows[0] ? { day: asDay(sinceRows[0].day), minute: Number(sinceRows[0].value) } : null;
  const pvSince = hourlySince(marker, firstDays[0]?.pv ? asDay(firstDays[0].pv) : null);
  const loginSince = hourlySince(marker, firstDays[0]?.login ? asDay(firstDays[0].login) : null);
  const memberPv = zeros(24);
  const logins = zeros(24);
  for (const r of hourRows) {
    const pv = /^visit\.member\.hour\.(\d{2})$/.exec(r.metric);
    const lg = /^auth\.login\.hour\.(\d{2})$/.exec(r.metric);
    if (pv) memberPv[Number(pv[1])] += Number(r.n);
    if (lg) logins[Number(lg[1])] += Number(r.n);
  }
  const memberPvCoverage = sinceCoverage(pvSince, range.from, range.until);
  const loginCoverage = sinceCoverage(loginSince, range.from, range.until);
  const sum = (values: number[]) => values.reduce((a, v) => a + v, 0);

  // ---- participation
  const noAdmin = (rows: { id: number }[]) => new Set(rows.map((r) => Number(r.id)).filter((id) => !admins.has(id)));
  const posterSet = noAdmin(posters);
  const chatterSet = noAdmin(chatters);
  const activeMembers = new Set(inRangeMarks.map((r) => r.member).filter((m): m is number => m !== null));
  const newSet = new Set(cohort.map((m) => m.id));
  const newActive = cohort.filter((m) => {
    const set = activeDaysByMember.get(m.id);
    return !!set && [...set].some((d) => d >= signupDay.get(m.id)!);
  }).length;
  const newBeforeCollection = cohort.filter((m) => signupDay.get(m.id)! < activitySince).length;

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
      retainedFrom,
      expiredInRange: range.from < retainedFrom && retainedFrom > activitySince && range.until > activitySince,
      coverage: activityCoverage,
      perBucketCoverage,
      refDay,
      windows,
      dau: windowValue(windows.dau, 1),
      wau: windowValue(windows.wau, 7),
      mau: windowValue(windows.mau, 30),
      unique: activityCoverage === "none" ? null : distinct(inRangeMarks),
      perBucket: activityPerBucket.map((b) => b.all),
      newPerBucket: activityPerBucket.map((b) => b.fresh),
      existingPerBucket: activityPerBucket.map((b) => b.existing),
      memberDaysByDow,
      daysByDow,
      repeat: activityCoverage === "none" ? null : { active: perActorDays.size, multiDay: [...perActorDays.values()].filter((n) => n >= 2).length },
      retention: cohort.length
        ? {
            cohort: cohort.length,
            eligible: eligible.length,
            returned,
            pending: pendingDays.length,
            beforeCollection: countStatus("beforeCollection"),
            expired: countStatus("expired"),
            withdrawn: countStatus("withdrawn"),
            // the window of a sign-up on day D ends with D + RETURN_WINDOW_DAYS
            nextReadyDay: pendingDays.length ? addPeriods(pendingDays[0], "day", RETURN_WINDOW_DAYS + 1) : null,
          }
        : null,
    },
    hourly: {
      memberPvSince: sinceText(pvSince),
      memberPvCoverage,
      memberPv: memberPvCoverage === "none" ? null : memberPv,
      memberPvTotal: memberPvCoverage === "none" ? null : sum(memberPv),
      loginSince: sinceText(loginSince),
      loginCoverage,
      logins: loginCoverage === "none" ? null : logins,
      loginTotal: loginCoverage === "none" ? null : sum(logins),
    },
    participation: {
      posters: posterSet.size,
      chatters: chatterSet.size,
      activeWithPost: activityCoverage === "none" ? null : [...activeMembers].filter((m) => posterSet.has(m)).length,
      activeWithChat: activityCoverage === "none" ? null : [...activeMembers].filter((m) => chatterSet.has(m)).length,
      newSignups: cohort.length,
      newActive: cohort.length > newBeforeCollection ? newActive : null,
      newBeforeCollection,
      newWithdrawn: cohort.filter((m) => m.withdrawnAt).length,
      newPosted: [...noAdmin(newPosters)].filter((id) => newSet.has(id)).length,
      newChatted: [...noAdmin(newChatters)].filter((id) => newSet.has(id)).length,
    },
  };
}
