import { describe, expect, it } from "vitest";
import { buildContentMeasurement, CONTENT_FIRST, CONTENT_PREFIX, CONTENT_PAIR_PREFIX, observationTime, isContentCollectionHost } from "./contentMeasurement";
import { buildInflow } from "./inflow";
import { inflowDataset } from "./export";

const day = "2026-11-10", content = "h_jonghap_guard_reg", campaign = "poster_2026_11";
const row = (day: string, metric: string, n: number) => ({ day, metric, n });
const first = { day, second: 12 * 3600 + 34 };

describe("Content measurement release boundary", () => {
  it("does not activate Production from a candidate URL before its live-domain promotion", () => {
    expect(isContentCollectionHost("mju-find.vercel.app", "production")).toBe(true);
    for (const host of [null, "candidate-123.vercel.app", "localhost:3000", "mju-find.vercel.app.evil.example"]) expect(isContentCollectionHost(host, "production")).toBe(false);
    expect(isContentCollectionHost("candidate-123.vercel.app", "preview")).toBe(true);
  });
  it("keeps same-day legacy and new counters apart in report and export without changing visit totals", () => {
    const rows = [row(day, CONTENT_FIRST, first.second), row(day, `visit.utm_content.${content}`, 100), row(day, `visit.utm_pair.${campaign}.${content}`, 100),
      row(day, CONTENT_PREFIX + content, 2), row(day, CONTENT_PAIR_PREFIX + campaign + "." + content, 2), row(day, "visit.utm_campaign.poster_2026_11", 102)];
    const untouched = structuredClone(rows);
    const report = buildInflow([day], rows, "2026-10-20", "2026-11-09", first);
    expect(report.content.contents).toEqual([{ value: content, sessions: 2 }]);
    expect(report.content.pairs).toEqual([{ campaign, content, sessions: 2 }]);
    expect(report.legacyContent.contents).toEqual([{ value: content, sessions: 100 }]);
    expect(report.legacyContent.markerDay).toBe("2026-11-09");
    expect(report.utm.campaign).toEqual([{ value: campaign, sessions: 102 }]);
    expect(report.total).toEqual(buildInflow([day], [], "2026-10-20").total);
    const tables = inflowDataset(report).tables;
    expect(tables.find(t => t.title === "캠페인 × Content (신규 측정만)")?.rows).toEqual([[campaign, content, 2]]);
    expect(tables.find(t => t.title?.startsWith("기존 캠페인 × Content"))?.rows).toEqual([[campaign, content, 100]]);
    expect(rows).toEqual(untouched);
  });
  it("does not treat an old marker or even orphan new counters as a measured interval", () => {
    const rows = [row(day, CONTENT_PREFIX + content, 99), row(day, "meta.since.utm_content", 1)];
    for (const globalFirst of [null, first]) {
      const report = buildContentMeasurement([day], rows, globalFirst);
      expect(report.contents).toEqual([]);
      expect(report.perDay[0]).toEqual({ day, coverage: "none", taggedSessions: null });
    }
  });
  it("shows rollback gaps, pre-release and future days as unmeasured rather than zero", () => {
    const days = ["2026-11-09", day, "2026-11-11", "2026-11-12", "2026-11-13"];
    const rows = [row(day, CONTENT_FIRST, 500), row(day, CONTENT_PREFIX + content, 1), row("2026-11-11", `visit.utm_content.${content}`, 7),
      row("2026-11-12", CONTENT_FIRST, 600), row("2026-11-12", CONTENT_PREFIX + content, 2)];
    const report = buildContentMeasurement(days, rows, { day, second: 500 });
    expect(report.measuredDays).toBe(2);
    expect(report.perDay.map(d => d.taggedSessions)).toEqual([null, 1, null, 2, null]);
    expect(report.perDay.map(d => d.coverage)).toEqual(["none", "partial", "none", "partial", "none"]);
    expect(report.contents[0].sessions).toBe(3);
    const exported = inflowDataset(buildInflow(days, rows, null, "2026-11-09", { day, second: 500 }));
    expect(exported.tables.find(t => t.title === "날짜별 신규 Content 측정 상태")?.rows[2]).toEqual(["2026-11-11", null, "미측정"]);
  });
  it("allows zero tagged sessions only on an observed day, always labelled partial", () => {
    const report = buildContentMeasurement([day], [row(day, CONTENT_FIRST, 0)], { day, second: 0 });
    expect(report.firstObservedAt).toBe("2026-11-10T00:00:00+09:00");
    expect(report.perDay).toEqual([{ day, coverage: "partial", taggedSessions: 0 }]);
  });
  it("uses stored observation time, never deployment date or today; rejects invalid markers", () => {
    expect(buildContentMeasurement([day], [], first).firstObservedAt).toBe("2026-11-10T12:00:34+09:00");
    expect(observationTime({ day, second: 86399 })).toBe("2026-11-10T23:59:59+09:00");
    for (const bad of [{ day, second: -1 }, { day, second: 86400 }, { day, second: 0.5 }, { day: "2026-02-30", second: 1 }]) expect(observationTime(bad)).toBeNull();
  });
});
