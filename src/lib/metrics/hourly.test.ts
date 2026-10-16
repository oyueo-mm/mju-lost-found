import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));

const { buildCells, byHour, cellStatus, daysFrom, halves, loadHourlyCells, peakHour, totalOf } = await import("./hourly");

// 2026-10-17 14:30 KST
const NOW = new Date("2026-10-17T05:30:00Z");
const TODAY = "2026-10-17";
const none = { pvMember: null, pvAnon: null, session: null, active: null, login: null };

describe("시간대 분석: one cell's status", () => {
  const since = { day: "2026-10-16", minute: 17 * 60 + 27 }; // began 10/16 17:27
  it("is 미측정 before the start, 부분 측정 in the start hour, measured after", () => {
    expect(cellStatus(since, "2026-10-15", 23, TODAY, 14)).toBe("none");
    expect(cellStatus(since, "2026-10-16", 16, TODAY, 14)).toBe("none");
    expect(cellStatus(since, "2026-10-16", 17, TODAY, 14)).toBe("partial");
    expect(cellStatus(since, "2026-10-16", 18, TODAY, 14)).toBe("full");
    expect(cellStatus(since, "2026-10-17", 0, TODAY, 14)).toBe("full");
    expect(cellStatus({ day: "2026-10-16", minute: 18 * 60 }, "2026-10-16", 18, TODAY, 14)).toBe("full"); // on the hour
    expect(cellStatus(null, "2026-10-17", 3, TODAY, 14)).toBe("none");
  });

  it("is a whole partial day when only the first recorded day is known", () => {
    expect(cellStatus({ day: "2026-10-16", minute: null }, "2026-10-16", 0, TODAY, 14)).toBe("partial");
    expect(cellStatus({ day: "2026-10-16", minute: null }, "2026-10-16", 23, TODAY, 14)).toBe("partial");
  });

  it("leaves hours not reached yet as future -- neither 0 nor 미측정", () => {
    expect(cellStatus(since, TODAY, 14, TODAY, 14)).toBe("full"); // the current hour, in progress
    expect(cellStatus(since, TODAY, 15, TODAY, 14)).toBe("future");
    expect(cellStatus(null, TODAY, 15, TODAY, 14)).toBe("future");
    expect(cellStatus(since, "2026-10-18", 0, TODAY, 14)).toBe("future");
  });
});

describe("buildCells", () => {
  const days = ["2026-10-16", "2026-10-17"];
  const starts = {
    ...none,
    pvMember: { day: "2026-10-16", minute: null }, // known from the data only
    pvAnon: { day: "2026-10-17", minute: 9 * 60 + 5 }, // this release: 10/17 09:05
    session: { day: "2026-10-15", minute: null },
    active: { day: "2026-10-17", minute: 9 * 60 + 5 },
  };
  const rows = [
    { day: "2026-10-16", metric: "visit.member.hour.20", n: 4 },
    { day: "2026-10-17", metric: "visit.member.hour.10", n: 3 },
    { day: "2026-10-17", metric: "visit.anon.hour.10", n: 5 },
    { day: "2026-10-17", metric: "visit.anon.hour.09", n: 2 },
    { day: "2026-10-17", metric: "visit.anon.hour.08", n: 1 }, // an instance that started before the marker
    { day: "2026-10-17", metric: "visit.start.hour.10", n: 2 },
    { day: "2026-10-17", metric: "visit.flow.endhour.10", n: 9 }, // another measure: ignored
    { day: "2026-10-17", metric: "active.member.hour.10", n: 2 },
    { day: "2026-10-15", metric: "visit.anon.hour.10", n: 99 }, // outside the days asked
  ];
  const cells = buildCells(days, rows, starts, NOW);

  it("keeps 0, 미측정 (null) and 부분 측정 apart", () => {
    const anon = cells.metrics.pvAnon;
    expect(anon.values[0][10]).toBeNull(); // 10/16: before this counter began
    expect(anon.status[0][10]).toBe("none");
    expect(anon.values[1][7]).toBeNull(); // 10/17 07시: before the marker hour
    expect(anon.status[1][8]).toBe("partial"); // counts before the marker still show
    expect(anon.values[1][8]).toBe(1);
    expect(anon.status[1][9]).toBe("partial"); // the start hour
    expect(anon.values[1][11]).toBe(0); // measured, nothing happened
    expect(anon.status[1][11]).toBe("full");
    expect(anon.status[1][15]).toBe("future");
    expect(anon.values[1][15]).toBeNull();
    expect(cells.metrics.login.status[1].slice(0, 15).every((s) => s === "none")).toBe(true); // never began here
  });

  it("adds 페이지뷰(전체) from both parts, partial where only one was measured", () => {
    const pv = cells.metrics.pv;
    expect(pv.values[0][20]).toBe(4); // member only (anon not measured yet)
    expect(pv.status[0][20]).toBe("partial");
    expect(pv.values[1][10]).toBe(8);
    expect(pv.status[1][10]).toBe("full");
    expect(pv.status[1][15]).toBe("future");
    expect(pv.since).toBe("2026-10-17 09:05");
    expect(cells.metrics.session.values[1][10]).toBe(2); // visit.flow.endhour is not a session
  });

  it("summarises by hour, by half day and over the period", () => {
    const anonByHour = byHour(cells.metrics.pvAnon);
    expect(anonByHour.values[10]).toBe(5);
    expect(anonByHour.status[10]).toBe("partial"); // 10/16 unmeasured + 10/17 measured
    expect(anonByHour.status[15]).toBe("none"); // 10/16 unmeasured; 10/17 not reached
    const h = halves(cells.metrics.pvAnon, 1);
    expect(h.am).toEqual({ value: 8, status: "partial" });
    expect(h.pm).toEqual({ value: 0, status: "full" }); // 12~14시 measured, the rest still to come
    expect(peakHour(cells.metrics.pv.values[1])).toEqual({ hour: 10, n: 8 });
    expect(peakHour([null, 0, 0])).toBeNull();
    expect(totalOf(cells.metrics.active)).toEqual({ value: 2, status: "partial" });
    expect(totalOf(cells.metrics.login)).toEqual({ value: null, status: "none" });
  });

  it("lists KST days", () => {
    expect(daysFrom("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});

describe("loadHourlyCells", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("reads only the asked days' hour counters and each counter's collection start", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { day: new Date("2026-10-17T00:00:00Z"), metric: "visit.anon.hour.10", n: BigInt(3) },
        { day: new Date("2026-10-17T00:00:00Z"), metric: "auth.login.hour.10", n: 1 },
      ])
      .mockResolvedValueOnce([
        { metric: "meta.since.traffic_hourly", day: new Date("2026-10-17T00:00:00Z"), value: 9 * 60 + 5 },
        { metric: "meta.since.user_hourly", day: new Date("2026-10-16T00:00:00Z"), value: 17 * 60 + 27 },
      ])
      .mockResolvedValueOnce([{ pvMember: "2026-10-16", pvAnon: "2026-10-17", session: "2026-10-16", active: null, login: "2026-10-16" }]);
    const cells = await loadHourlyCells(["2026-10-17", "2026-10-16", "2026-10-17"], { now: NOW });
    const [strings, days] = queryRaw.mock.calls[0] as [TemplateStringsArray, string[]];
    expect(strings.join("?")).toContain(`"day" = ANY(?::date[])`);
    expect(days).toEqual(["2026-10-16", "2026-10-17"]);
    expect(cells.days).toEqual(["2026-10-16", "2026-10-17"]); // once each, in order
    expect(cells.metrics.pvAnon.values[1][10]).toBe(3);
    expect(cells.metrics.pvAnon.since).toBe("2026-10-17 09:05");
    // user marker on the counters' first day: that day is partial, its time unknown (userReport rule)
    expect(cells.metrics.login.since).toBe("2026-10-16");
    expect(cells.metrics.session.since).toBe("2026-10-16");
    expect(cells.metrics.active.since).toBe("2026-10-17 09:05"); // marker without counts yet
  });

  it("asks nothing for an empty list and treats a failed read as no data", async () => {
    queryRaw.mockImplementation(async () => {
      throw new Error("db down");
    });
    const cells = await loadHourlyCells([], { now: NOW });
    expect(cells.days).toEqual([]);
    expect(queryRaw.mock.calls).toHaveLength(2); // markers + first days only
  });
});
