import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins: the ActivityDay marks (filtered by the days and the
// admin actors the query is given), the daily visit counters, and the
// hourly counters handed to the real buildCells().
let admins: number[] = [];
let marks: { day: string; actor: string }[] = [];
let counters: { day: string; metric: string; n: number }[] = [];
let hourRows: { day: string; metric: string; n: number }[] = [];

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findMany: async () => admins.map((id) => ({ id })) },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "ActivityDay"')) {
        const [days, adminActors] = values as [string[], string[]];
        const byDay = new Map<string, Set<string>>();
        for (const m of marks) {
          if (!days.includes(m.day) || adminActors.includes(m.actor)) continue;
          byDay.set(m.day, (byDay.get(m.day) ?? new Set()).add(m.actor));
        }
        return [...byDay].map(([day, set]) => ({ day, n: set.size }));
      }
      if (sql.includes("'visit.pv.anon'")) {
        const [days] = values as [string[]];
        return counters.filter((c) => days.includes(c.day));
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  },
}));
vi.mock("./hourly", async (importOriginal) => {
  const real = await importOriginal<typeof import("./hourly")>();
  const since = { day: "2026-10-16", minute: 0 };
  return {
    ...real,
    loadHourlyCells: async (days: string[], { now = new Date() } = {}) =>
      real.buildCells(days, hourRows, { pvMember: since, pvAnon: since, session: since, active: since, login: since }, now),
  };
});

const { changeOf, loadDayVisits, loadMultiDayVisits, resolveVisitDays } = await import("./dayVisits");
const { dayVisitsDataset, multiDayVisitsDataset } = await import("./export");
const { activityActor } = await import("./record");

const mark = (id: number, day: string) => ({ day, actor: activityActor(id) });
const c = (day: string, metric: string, n: number) => ({ day, metric, n });
const h = (day: string, kind: "member" | "anon" | "start", hour: number, n: number) => c(day, `visit.${kind}.hour.${String(hour).padStart(2, "0")}`, n);

beforeEach(() => {
  admins = [];
  marks = [];
  counters = [];
  hourRows = [];
});

describe("날짜별 방문 분석", () => {
  it("reads `vd` as days (single, runs, gaps), defaulting to the period's last day", () => {
    expect(resolveVisitDays(undefined, "2026-10-12", "2026-10-18")).toEqual({ days: ["2026-10-12"], notice: null });
    expect(resolveVisitDays(undefined, "2026-10-31", "2026-10-18").days).toEqual(["2026-10-18"]);
    expect(resolveVisitDays("2026-10-10", "2026-10-18", "2026-10-18").days).toEqual(["2026-10-10"]);
    expect(resolveVisitDays("2026-10-01~2026-10-02,2026-10-05,2026-10-19", "2026-10-18", "2026-10-18").days).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
    expect(resolveVisitDays("", "2026-10-18", "2026-10-18").days).toEqual([]);
    const many = resolveVisitDays("2026-08-01~2026-10-18", "2026-10-18", "2026-10-18");
    expect(many.days).toHaveLength(31);
    expect(many.days[0]).toBe("2026-09-18");
    expect(many.notice).toContain("31일");
  });

  it("gives a rate only from a previous value above 0", () => {
    expect(changeOf(12, 10)).toEqual({ diff: 2, rate: 0.2 });
    expect(changeOf(0, 4)).toEqual({ diff: -4, rate: -1 });
    expect(changeOf(3, 0)).toEqual({ diff: 3, rate: null });
    expect(changeOf(null, 4)).toEqual({ diff: null, rate: null });
  });

  it("compares a past day with the day before; members are distinct and admins are left out", async () => {
    admins = [9];
    marks = [mark(1, "2026-10-17"), mark(2, "2026-10-17"), mark(9, "2026-10-17"), mark(1, "2026-10-16")];
    counters = [
      c("2026-10-17", "visit.pv.anon", 30),
      c("2026-10-17", "visit.pv.member", 10),
      c("2026-10-17", "visit.session.anon", 6),
      c("2026-10-17", "visit.session.member", 2),
      c("2026-10-16", "visit.pv.anon", 20),
      c("2026-10-16", "visit.session.anon", 4),
    ];
    hourRows = [h("2026-10-17", "anon", 9, 30), h("2026-10-17", "member", 21, 10), h("2026-10-16", "anon", 10, 20)];
    const r = await loadDayVisits("2026-10-17", { now: new Date("2026-10-19T03:00:00Z") });
    expect(r.basis).toBe("day");
    expect(r.previous).toBe("2026-10-16");
    expect(r.current).toMatchObject({ members: 2, pvAnon: 30, pvMember: 10, sessionAnon: 6, sessionMember: 2, visitCoverage: "full" });
    expect(r.before).toMatchObject({ members: 1, pvAnon: 20, pvMember: 0, sessionMember: 0 });
    const row = (key: string) => r.rows.find((x) => x.key === key)!;
    expect(row("members")).toMatchObject({ current: 2, previous: 1, note: null });
    expect(row("pv")).toMatchObject({ current: 40, previous: 20 });
    expect(row("session")).toMatchObject({ current: 8, previous: 4 });
    expect(r.hourly.days).toEqual(["2026-10-16", "2026-10-17"]);
    expect(r.hourly.metrics.pv.values[1][9]).toBe(30);
  });

  it("compares today with the same finished hours of yesterday, and not what is only kept per day", async () => {
    hourRows = [
      h("2026-10-18", "anon", 1, 5),
      h("2026-10-18", "member", 13, 2),
      h("2026-10-18", "anon", 14, 50), // the hour still running: left out
      h("2026-10-18", "start", 1, 3),
      h("2026-10-17", "anon", 1, 4),
      h("2026-10-17", "anon", 20, 100), // after the same time yesterday: left out
      h("2026-10-17", "start", 2, 1),
    ];
    counters = [c("2026-10-18", "visit.pv.anon", 55), c("2026-10-18", "visit.pv.member", 2)];
    const r = await loadDayVisits("2026-10-18", { now: new Date("2026-10-18T05:30:00Z") }); // 14:30 KST
    expect(r).toMatchObject({ isToday: true, basis: "hours", hours: 14, nowHour: 14 });
    const row = (key: string) => r.rows.find((x) => x.key === key)!;
    expect(row("pv")).toMatchObject({ current: 7, previous: 4, note: null });
    expect(row("pvAnon")).toMatchObject({ current: 5, previous: 4 });
    expect(row("session")).toMatchObject({ current: 3, previous: 1 });
    expect(row("members").note).toContain("진행 중");
    expect(row("sessionMember").note).toContain("진행 중");
    // the day's own figures are the whole day so far
    expect(r.current.pvAnon).toBe(55);
  });

  it("leaves days before the visit counters began 미측정, never 0", async () => {
    // visit counters: 2026-10-15 19:14 KST; 활성 회원: 2026-10-15 03:35
    const r = await loadDayVisits("2026-10-15", { now: new Date("2026-10-19T03:00:00Z") });
    expect(r.current.visitCoverage).toBe("partial");
    expect(r.before).toMatchObject({ visitCoverage: "none", pvAnon: null, sessionMember: null, membersCoverage: "none", members: null });
    expect(r.rows.find((x) => x.key === "pv")).toMatchObject({ previous: null, partial: true });
  });

  it("exports the day without turning 수집하지 않음 or 비교 안 함 into 미측정", async () => {
    hourRows = [h("2026-10-18", "anon", 1, 5)];
    const r = await loadDayVisits("2026-10-18", { now: new Date("2026-10-18T05:30:00Z") });
    const ds = dayVisitsDataset(r);
    expect(ds.key).toBe("dayVisits");
    expect(ds.period).toContain("2026-10-18");
    expect(ds.tables[0].rows[0]).toEqual(["방문자(서로 다른 회원, 명)", r.current.members, "수집하지 않음", "—"]);
    const members = ds.tables[1].rows.find((row) => String(row[0]).startsWith("방문한 로그인 회원"))!;
    expect(members.slice(1, 5)).toEqual(["—", "—", "—", "—"]);
    // today: hours up to the current one
    expect(ds.tables[2].rows).toHaveLength(15);
  });

  it("compares several days: sums of what can be added, members never added up, 미측정 days left out", async () => {
    admins = [9];
    // 10-14: before the visit counters (미측정); 10-16, 10-17 measured
    counters = [
      c("2026-10-16", "visit.pv.anon", 10),
      c("2026-10-16", "visit.session.anon", 3),
      c("2026-10-17", "visit.pv.member", 4),
      c("2026-10-17", "visit.session.member", 1),
      c("2026-10-14", "visit.pv.anon", 99), // stray count before collection: not shown
    ];
    marks = [mark(1, "2026-10-16"), mark(2, "2026-10-16"), mark(1, "2026-10-17"), mark(9, "2026-10-17")];
    const r = await loadMultiDayVisits(["2026-10-17", "2026-10-14", "2026-10-16"], { now: new Date("2026-10-19T03:00:00Z") });
    expect(r.days).toEqual(["2026-10-14", "2026-10-16", "2026-10-17"]);
    expect(r.figures[0]).toMatchObject({ visitCoverage: "none", pvAnon: null, members: null });
    expect(r.measuredDays).toBe(2);
    expect(r.totals).toEqual({ pvMember: 4, pvAnon: 10, sessionMember: 1, sessionAnon: 3 });
    expect(r.figures.map((f) => f.members)).toEqual([null, 2, 1]);
    expect(r.members.average).toBe(1.5);
    expect(r.members.peak).toEqual({ day: "2026-10-16", n: 2 });
    // 10-14 has no member marks yet (before 03:35 that day was partial; 10-14 none): no distinct total
    expect(r.members.distinct).toBeNull();

    const measuredOnly = await loadMultiDayVisits(["2026-10-16", "2026-10-17"], { now: new Date("2026-10-19T03:00:00Z") });
    // members 1 and 2, each counted once -- not 2 + 1
    expect(measuredOnly.members.distinct).toBe(2);
    const ds = multiDayVisitsDataset(measuredOnly);
    expect(ds.tables[0].rows).toHaveLength(2);
    expect(ds.tables[0].total?.[1]).toBe("더하지 않음");
    expect(ds.tables[1].rows.find((row) => String(row[0]).startsWith("선택 기간"))?.[1]).toBe(2);
  });
});
