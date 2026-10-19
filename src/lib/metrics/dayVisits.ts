import { prisma } from "@/lib/db/prisma";
import { addDays, decodeDays, MAX_SELECTED_DAYS, selectableDay } from "./daySelection";
import { loadHourlyCells, type CellStatus, type HourlyCells } from "./hourly";
import { activityActor, kstDay } from "./record";
import { activityCoverageOf, coverageOf, kstNow, type Coverage } from "./report";

// 날짜별 방문 분석 (운영 통계): one KST day's visits in detail, next to the
// day before. Read-only and aggregate only, from counters already kept:
// - 페이지뷰 and 방문 세션 by login state: MetricDaily visit.pv.<aud> /
//   visit.session.<aud> (the same counters as 방문 분석).
// - 0-23시: the 시간대 분석 cells of the two days (loadHourlyCells).
// - 방문한 로그인 회원: distinct members with an ActivityDay mark that day,
//   admins out -- the only visitor count there is. Signed-out visitors are
//   never identified, so there is no signed-out visitor count: it is shown
//   as 수집하지 않음, never estimated from sessions.
// Admin use is left out everywhere (their page views are visit.internal.pv).
// Before a counter began the value is null (미측정), never 0.
//
// Today is still running, so it is compared with the previous day over the
// same finished hours (0시 to the hour before now) from the hourly cells;
// counts that are not kept by hour (sessions by login state, distinct
// members) are then not compared.

export type DayFigures = {
  day: string;
  visitCoverage: Coverage; // 페이지뷰·방문 세션
  pvAnon: number | null;
  pvMember: number | null;
  sessionAnon: number | null;
  sessionMember: number | null;
  membersCoverage: Coverage;
  members: number | null; // distinct signed-in members, admins out
};

export type CompareKey = "members" | "pv" | "pvMember" | "pvAnon" | "session" | "sessionMember" | "sessionAnon";
export type CompareRow = {
  key: CompareKey;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  partial: boolean; // either side only partly measured
  note: string | null; // why there is no comparison
};

export type DayVisitReport = {
  day: string;
  previous: string;
  today: string;
  isToday: boolean;
  nowHour: number;
  generatedAt: string;
  current: DayFigures;
  before: DayFigures;
  hourly: HourlyCells; // days = [previous, day]
  // "day": whole days; "hours": today vs the same finished hours of the day before
  basis: "day" | "hours" | "none";
  hours: number; // hours compared when basis is "hours" (0..hours-1)
  rows: CompareRow[];
};

const asDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const sum = (...v: (number | null)[]) => (v.every((x) => x === null) ? null : v.reduce<number>((a, x) => a + (x ?? 0), 0));

// The days the page asks for (`vd`, encoded like 시간대 분석's `d` --
// independent of it): absent means the last day of the chosen period, an
// empty value means none. Days after today are left out; past the limit
// the latest ones are kept and the page says so.
export function resolveVisitDays(param: string | null | undefined, fallback: string, today: string): { days: string[]; notice: string | null } {
  if (param === null || param === undefined) return { days: [fallback > today ? today : fallback], notice: null };
  const days = decodeDays(param).filter((d) => selectableDay(d, today));
  if (days.length <= MAX_SELECTED_DAYS) return { days, notice: null };
  return {
    days: days.slice(-MAX_SELECTED_DAYS),
    notice: `날짜는 최대 ${MAX_SELECTED_DAYS}일까지 고를 수 있어 가장 최근 ${MAX_SELECTED_DAYS}일만 반영했습니다(요청 ${days.length}일).`,
  };
}

// Change from `previous` to `current`: the difference, and the rate when
// the previous value is above 0 (from 0 there is no meaningful rate).
export function changeOf(current: number | null, previous: number | null): { diff: number | null; rate: number | null } {
  if (current === null || previous === null) return { diff: null, rate: null };
  return { diff: current - previous, rate: previous > 0 ? (current - previous) / previous : null };
}

// Sum of one metric's hours [0, hours) of a day row, with whether every
// one of them was measured in full.
function hoursSum(h: HourlyCells, key: keyof HourlyCells["metrics"], d: number, hours: number): { value: number | null; status: CellStatus } {
  const values = h.metrics[key].values[d].slice(0, hours);
  const status = h.metrics[key].status[d].slice(0, hours);
  if (status.every((s) => s === "none" || s === "future")) return { value: null, status: "none" };
  return { value: sum(...values), status: status.every((s) => s === "full") ? "full" : "partial" };
}

// Pure: the comparison rows for a day and the one before it.
export function compareRows(current: DayFigures, before: DayFigures, hourly: HourlyCells, basis: DayVisitReport["basis"], hours: number): CompareRow[] {
  const row = (key: CompareKey, label: string, unit: string, cur: number | null, prev: number | null, partial: boolean, note: string | null = null): CompareRow => ({
    key,
    label,
    unit,
    current: cur,
    previous: prev,
    partial,
    note,
  });
  if (basis === "hours") {
    const part = (key: "pv" | "pvMember" | "pvAnon" | "session") => {
      const c = hoursSum(hourly, key, 1, hours);
      const p = hoursSum(hourly, key, 0, hours);
      return { c: c.value, p: p.value, partial: c.status !== "full" || p.status !== "full" };
    };
    const pv = part("pv");
    const pvMember = part("pvMember");
    const pvAnon = part("pvAnon");
    const session = part("session");
    const notByHour = "시간대별로 나눠 저장하지 않아 진행 중인 날은 비교하지 않습니다.";
    return [
      row("members", "방문한 로그인 회원", "명", null, null, false, "하루가 끝나야 확정되는 수라 진행 중인 날은 비교하지 않습니다."),
      row("session", "방문 세션 합계", "회", session.c, session.p, session.partial),
      row("sessionMember", "로그인 상태로 시작", "회", null, null, false, notByHour),
      row("sessionAnon", "비로그인으로 시작", "회", null, null, false, notByHour),
      row("pv", "페이지뷰 합계", "회", pv.c, pv.p, pv.partial),
      row("pvMember", "로그인", "회", pvMember.c, pvMember.p, pvMember.partial),
      row("pvAnon", "비로그인", "회", pvAnon.c, pvAnon.p, pvAnon.partial),
    ];
  }
  const visitPartial = current.visitCoverage === "partial" || before.visitCoverage === "partial";
  const none = basis === "none" ? "오늘 0시대가 끝나면 비교합니다." : null;
  const pick = (v: number | null) => (basis === "none" ? null : v);
  return [
    row("members", "방문한 로그인 회원", "명", pick(current.members), pick(before.members), current.membersCoverage === "partial" || before.membersCoverage === "partial", none),
    row("session", "방문 세션 합계", "회", pick(sum(current.sessionMember, current.sessionAnon)), pick(sum(before.sessionMember, before.sessionAnon)), visitPartial, none),
    row("sessionMember", "로그인 상태로 시작", "회", pick(current.sessionMember), pick(before.sessionMember), visitPartial, none),
    row("sessionAnon", "비로그인으로 시작", "회", pick(current.sessionAnon), pick(before.sessionAnon), visitPartial, none),
    row("pv", "페이지뷰 합계", "회", pick(sum(current.pvMember, current.pvAnon)), pick(sum(before.pvMember, before.pvAnon)), visitPartial, none),
    row("pvMember", "로그인", "회", pick(current.pvMember), pick(before.pvMember), visitPartial, none),
    row("pvAnon", "비로그인", "회", pick(current.pvAnon), pick(before.pvAnon), visitPartial, none),
  ];
}

// Distinct members active on each day, admin accounts out: their marks are
// found by recomputing the HMAC of each admin id (marks are never linked to
// anyone else here).
// With `distinct`, also the members active on any of the days, counted
// once -- never the sum of the daily counts.
async function activeMembers(days: string[], distinct: boolean): Promise<{ byDay: Map<string, number>; distinct: number | null }> {
  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { id: true } });
  const adminActors = admins.map((a) => activityActor(a.id));
  const [counted, all] = await Promise.all([
    prisma.$queryRaw<{ day: Date | string; n: bigint | number }[]>`
      SELECT "day", count(DISTINCT "actor") AS n FROM "ActivityDay"
      WHERE "day" = ANY(${days}::date[]) AND NOT ("actor" = ANY(${adminActors}::text[]))
      GROUP BY 1`.catch(() => [] as { day: Date | string; n: bigint | number }[]),
    distinct
      ? prisma.$queryRaw<{ n: bigint | number }[]>`
          SELECT count(DISTINCT "actor") AS n FROM "ActivityDay"
          WHERE "day" = ANY(${days}::date[]) AND NOT ("actor" = ANY(${adminActors}::text[]))`.catch(() => null)
      : Promise.resolve(null),
  ]);
  return { byDay: new Map(counted.map((r) => [asDay(r.day), Number(r.n)])), distinct: all ? Number(all[0]?.n ?? 0) : null };
}

// Each day's figures; null (미측정) where a counter had not begun.
async function loadDayFigures(days: string[], today: string, distinct = false): Promise<{ figures: DayFigures[]; distinctMembers: number | null }> {
  const [counters, members] = await Promise.all([
    prisma.$queryRaw<{ day: Date | string; metric: string; n: bigint | number }[]>`
      SELECT "day", "metric", sum("value") AS n FROM "MetricDaily"
      WHERE "day" = ANY(${days}::date[])
        AND "metric" IN ('visit.pv.anon', 'visit.pv.member', 'visit.session.anon', 'visit.session.member')
      GROUP BY 1, 2`.catch(() => [] as { day: Date | string; metric: string; n: bigint | number }[]),
    activeMembers(days, distinct),
  ]);
  const value = (d: string, metric: string) => counters.filter((r) => asDay(r.day) === d && r.metric === metric).reduce((a, r) => a + Number(r.n), 0);
  const figures = days.map((d): DayFigures => {
    const visitCoverage = coverageOf("visit", d, addDays(d, 1));
    const membersCoverage = activityCoverageOf(d, addDays(d, 1), today);
    const v = (metric: string) => (visitCoverage === "none" ? null : value(d, metric));
    return {
      day: d,
      visitCoverage,
      pvAnon: v("visit.pv.anon"),
      pvMember: v("visit.pv.member"),
      sessionAnon: v("visit.session.anon"),
      sessionMember: v("visit.session.member"),
      membersCoverage,
      members: membersCoverage === "none" ? null : (members.byDay.get(d) ?? 0),
    };
  });
  return { figures, distinctMembers: members.distinct };
}

export async function loadDayVisits(day: string, { now = new Date() } = {}): Promise<DayVisitReport> {
  const today = kstDay(now);
  const previous = addDays(day, -1);
  const days = [previous, day];
  const [{ figures }, hourly] = await Promise.all([loadDayFigures(days, today), loadHourlyCells(days, { now })]);
  const [before, current] = figures;
  const isToday = day === today;
  const nowHour = hourly.nowHour;
  const basis: DayVisitReport["basis"] = !isToday ? "day" : nowHour > 0 ? "hours" : "none";
  return {
    day,
    previous,
    today,
    isToday,
    nowHour,
    generatedAt: kstNow(now),
    current,
    before,
    hourly,
    basis,
    hours: basis === "hours" ? nowHour : 24,
    rows: compareRows(current, before, hourly, basis, nowHour),
  };
}

// ---------- several days ----------

export type MultiDayReport = {
  days: string[]; // as chosen, in order
  today: string;
  generatedAt: string;
  figures: DayFigures[];
  measuredDays: number; // days with page views / sessions measured (at least in part)
  memberDays: number; // days with members measured
  totals: { pvMember: number | null; pvAnon: number | null; sessionMember: number | null; sessionAnon: number | null };
  // members are people per day: never added up across days
  members: {
    average: number | null; // mean of the measured days' counts
    peak: { day: string; n: number } | null;
    distinct: number | null; // active on any chosen day, counted once (null: some day unmeasured)
    distinctPartial: boolean; // a chosen day is only partly measured
  };
  includesToday: boolean;
};

const measured = (c: Coverage) => c !== "none";

export function summarizeDays(figures: DayFigures[], today: string, distinct: number | null): Omit<MultiDayReport, "generatedAt"> {
  const visitDays = figures.filter((f) => measured(f.visitCoverage));
  const memberFigures = figures.filter((f) => measured(f.membersCoverage));
  const total = (key: "pvMember" | "pvAnon" | "sessionMember" | "sessionAnon") => (visitDays.length ? visitDays.reduce((a, f) => a + (f[key] ?? 0), 0) : null);
  const peak = memberFigures.reduce<{ day: string; n: number } | null>((best, f) => (f.members !== null && (!best || f.members > best.n) ? { day: f.day, n: f.members } : best), null);
  const allMembersMeasured = memberFigures.length === figures.length;
  return {
    days: figures.map((f) => f.day),
    today,
    figures,
    measuredDays: visitDays.length,
    memberDays: memberFigures.length,
    totals: { pvMember: total("pvMember"), pvAnon: total("pvAnon"), sessionMember: total("sessionMember"), sessionAnon: total("sessionAnon") },
    members: {
      average: memberFigures.length ? memberFigures.reduce((a, f) => a + (f.members ?? 0), 0) / memberFigures.length : null,
      peak: peak && peak.n > 0 ? peak : null,
      // over days that are not all measured, a "distinct" count would read as complete: left out
      distinct: allMembersMeasured && figures.length ? distinct : null,
      distinctPartial: figures.some((f) => f.membersCoverage === "partial"),
    },
    includesToday: figures.some((f) => f.day === today),
  };
}

export async function loadMultiDayVisits(days: string[], { now = new Date() } = {}): Promise<MultiDayReport> {
  const today = kstDay(now);
  const sorted = [...new Set(days)].sort();
  const { figures, distinctMembers } = await loadDayFigures(sorted, today, true);
  return { ...summarizeDays(figures, today, distinctMembers), generatedAt: kstNow(now) };
}
