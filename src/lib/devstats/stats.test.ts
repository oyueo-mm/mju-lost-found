import { describe, expect, it } from "vitest";

import type { DevCommit } from "./github";
import { autoUnit, buildDevReport, kstDayOf, parseDevSelection } from "./stats";

const commit = (sha: string, authoredAt: string, author: "a" | "b" | "c", over: Partial<DevCommit> = {}): DevCommit => ({
  sha,
  title: sha,
  body: "",
  authoredAt,
  committedAt: authoredAt,
  url: `https://github.com/x/y/commit/${sha}`,
  author:
    author === "a"
      ? { key: "gh:oyueo-mm", login: "oyueo-mm", name: "oyueo-mm", profileUrl: "https://github.com/oyueo-mm" }
      : author === "b"
        ? { key: "gh:jihwan26", login: "jihwan26", name: "박지환", profileUrl: "https://github.com/jihwan26" }
        : { key: "mail:0123456789ab", login: null, name: "Someone", profileUrl: null },
  merge: false,
  parents: [],
  ...over,
});

const TODAY = "2026-10-19";
const commits = [
  commit("c1", "2026-10-18T15:30:00Z", "a"), // 10-19 00:30 KST
  commit("c2", "2026-10-18T14:59:00Z", "a"), // 10-18 23:59 KST
  commit("c3", "2026-10-10T01:00:00Z", "b", { merge: true }),
  commit("c4", "2026-09-12T08:53:00Z", "b"),
  commit("c5", "2026-06-01T00:00:00Z", "c"),
];

describe("개발 통계", () => {
  it("counts KST days of the authored time", () => {
    expect(kstDayOf("2026-10-18T15:30:00Z")).toBe("2026-10-19");
    expect(kstDayOf("2026-10-18T14:59:00Z")).toBe("2026-10-18");
  });

  it("filters by period and lists every author, newest activity first", () => {
    const r = buildDevReport(commits, { selection: { kind: "preset", period: "30" }, today: TODAY });
    expect(r.from).toBe("2026-09-20");
    expect(r.commits.map((c) => c.sha)).toEqual(["c1", "c2", "c3"]);
    expect(r.totals).toMatchObject({ commits: 3, activeDays: 3, authors: 2, merges: 1 });
    expect(r.authors.map((a) => [a.key, a.commits, a.activeDays, a.allTime])).toEqual([
      ["gh:oyueo-mm", 2, 2, 2],
      ["gh:jihwan26", 1, 1, 2],
      ["mail:0123456789ab", 0, 0, 1],
    ]);
    expect(r.unit).toBe("day");
    // only authors with commits in the period get a series
    expect(r.series.map((s) => s.label)).toEqual(["oyueo-mm", "jihwan26"]);
    expect(r.series[0].values.reduce((a, n) => a + n, 0)).toBe(2);
  });

  it("narrows to one developer; the author list stays complete", () => {
    const r = buildDevReport(commits, { selection: { kind: "preset", period: "all" }, today: TODAY, author: "gh:jihwan26" });
    expect(r.from).toBe("2026-06-01");
    expect(r.commits.map((c) => c.sha)).toEqual(["c3", "c4"]);
    expect(r.totals).toMatchObject({ commits: 2, authors: 1 });
    expect(r.authors).toHaveLength(3);
    expect(r.series).toHaveLength(1);
    expect(Object.values(r.heat.counts).reduce((a, n) => a + n, 0)).toBe(2);
    // an unknown filter shows everyone
    expect(buildDevReport(commits, { selection: { kind: "preset", period: "all" }, today: TODAY, author: "gh:nobody" }).author).toBeNull();
  });

  it("buckets by week (Monday) and month, and picks a unit from the span", () => {
    const week = buildDevReport(commits, { selection: { kind: "preset", period: "90" }, today: TODAY, unit: "week" });
    expect(week.buckets[0]).toBe("2026-07-20");
    expect(week.buckets.at(-1)).toBe("2026-10-19");
    const month = buildDevReport(commits, { selection: { kind: "preset", period: "all" }, today: TODAY, unit: "month" });
    expect(month.buckets).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(month.series.find((s) => s.key === "gh:jihwan26")!.values).toEqual([0, 0, 0, 1, 1]);
    expect(autoUnit("2026-09-20", TODAY)).toBe("day");
    expect(autoUnit("2026-07-22", TODAY)).toBe("week");
    expect(autoUnit("2025-10-20", TODAY)).toBe("month");
  });

  it("draws the heatmap over at least 12 weeks and at most a year, from a Monday", () => {
    const short = buildDevReport(commits, { selection: { kind: "preset", period: "30" }, today: TODAY });
    expect(short.heat.from).toBe("2026-07-27");
    expect(new Date(`${short.heat.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(short.heat.counts["2026-10-19"]).toBe(1);
    expect(short.heat.max).toBe(1);
    const old = buildDevReport([...commits, commit("c0", "2024-01-01T00:00:00Z", "c")], { selection: { kind: "preset", period: "all" }, today: TODAY });
    expect(old.heat.from).toBe("2025-10-20");
  });

  it("any range (past 31 days), one day, or chosen days with gaps -- KST days", () => {
    const long = buildDevReport(commits, { selection: { kind: "range", from: "2026-06-01", to: "2026-10-10" }, today: TODAY });
    expect(long.commits.map((c) => c.sha)).toEqual(["c3", "c4", "c5"]);
    expect(long.unit).toBe("week");
    expect(long.label).toContain("132일");
    // 10-18 23:59 KST and 10-19 00:30 KST fall on different days
    const one = buildDevReport(commits, { selection: { kind: "range", from: "2026-10-19", to: "2026-10-19" }, today: TODAY });
    expect(one.commits.map((c) => c.sha)).toEqual(["c1"]);
    expect(one.label).toBe("2026-10-19 하루");
    const days = buildDevReport(commits, { selection: { kind: "days", days: ["2026-10-10", "2026-10-18"] }, today: TODAY, unit: "day" });
    expect(days.commits.map((c) => c.sha)).toEqual(["c2", "c3"]);
    expect(days.buckets).toEqual(["2026-10-10", "2026-10-18"]);
    expect(days.heat.only).toEqual(["2026-10-10", "2026-10-18"]);
    expect(Object.keys(days.heat.counts).sort()).toEqual(["2026-10-10", "2026-10-18"]);
    // too many day buckets for the span: a coarser unit
    expect(buildDevReport(commits, { selection: { kind: "range", from: "2024-01-01", to: TODAY }, today: TODAY, unit: "day" }).unit).toBe("week");
  });

  it("reads the URL: chosen days, else a range, else a preset; bad values fall back with a notice", () => {
    expect(parseDevSelection({}, TODAY)).toEqual({ selection: { kind: "preset", period: "90" }, notice: null });
    expect(parseDevSelection({ dp: "365" }, TODAY).selection).toEqual({ kind: "preset", period: "365" });
    expect(parseDevSelection({ df: "2025-01-01", dt: "2026-10-19", dp: "30" }, TODAY).selection).toEqual({ kind: "range", from: "2025-01-01", to: "2026-10-19" });
    expect(parseDevSelection({ df: "2026-10-01", dt: "2026-12-01" }, TODAY)).toMatchObject({ selection: { kind: "range", to: TODAY }, notice: expect.stringContaining("오늘") });
    expect(parseDevSelection({ df: "2026-10-10", dt: "2026-10-01" }, TODAY)).toMatchObject({ selection: { kind: "preset" }, notice: expect.stringContaining("늦습니다") });
    expect(parseDevSelection({ dd: "2026-10-01,2026-10-05~2026-10-06", df: "2026-01-01", dt: "2026-02-01" }, TODAY).selection).toEqual({ kind: "days", days: ["2026-10-01", "2026-10-05", "2026-10-06"] });
    expect(parseDevSelection({ dd: "2026-08-01~2026-10-19" }, TODAY)).toMatchObject({ selection: { kind: "days", days: expect.any(Array) }, notice: expect.stringContaining("31일") });
    expect(parseDevSelection({ dd: "2026-12-01" }, TODAY).selection).toEqual({ kind: "preset", period: "90" });
  });
});
