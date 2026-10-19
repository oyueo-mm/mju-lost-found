import { describe, expect, it } from "vitest";

import { buildInflow } from "./inflow";
import { channelOf, sanitizeUtm, siteLabel, siteOf } from "./visits";
import { inflowDataset } from "./export";

const r = (day: string, metric: string, n: number) => ({ day, metric, n });

describe("유입 경로", () => {
  it("accepts only short, plain UTM values -- no URLs, e-mails or long numbers", () => {
    expect(sanitizeUtm(" EveryTime ")).toBe("everytime");
    expect(sanitizeUtm("2026-fall")).toBe("2026-fall");
    expect(sanitizeUtm("poster_qr")).toBe("poster_qr");
    for (const bad of ["https://x.y", "a@b.c", "010-1234-5678", "01012345678", "2026-10-20", "x".repeat(33), "한글", ""]) expect(sanitizeUtm(bad)).toBeNull();
  });

  it("takes a valid utm_source before the referrer, and groups both by site", () => {
    expect(channelOf("instagram", "poster_qr")).toBe("utm.poster_qr");
    expect(channelOf("direct", null)).toBe("ref.direct");
    expect(siteOf("utm.everytime")).toBe("everytime");
    expect(siteOf("ref.everytime")).toBe("everytime");
    expect(siteOf("utm.ig")).toBe("instagram");
    expect(siteOf("utm.poster")).toBe("qr");
    expect(siteOf("utm.flyer")).toBe("utm:flyer");
    // no referrer is not a direct visit
    expect(siteOf("ref.direct")).toBe("unknown");
    expect(siteLabel("unknown")).toContain("확인 불가");
  });

  // source counters began 10-20 (partial); visit counting long before
  const rows = [
    r("2026-10-19", "visit.session.anon", 4),
    r("2026-10-19", "visit.ref.everytime", 3),
    r("2026-10-19", "visit.ref.direct", 1),
    r("2026-10-20", "visit.session.anon", 5),
    r("2026-10-20", "visit.src.ref.everytime.anon", 2), // started midday: only part of the day
    r("2026-10-21", "visit.session.anon", 3),
    r("2026-10-21", "visit.session.member", 2),
    r("2026-10-21", "visit.src.utm.everytime.anon", 1),
    r("2026-10-21", "visit.src.ref.everytime.member", 1),
    r("2026-10-21", "visit.src.ref.direct.anon", 2),
    r("2026-10-21", "visit.src.utm.poster_qr.member", 1),
    r("2026-10-21", "visit.entry.utm.everytime.post", 1),
    r("2026-10-21", "visit.entry.ref.everytime.home", 1),
    r("2026-10-21", "visit.entry.ref.direct.home", 2),
    r("2026-10-21", "visit.entry.utm.poster_qr.found", 1),
    r("2026-10-21", "visit.utm_source.everytime", 1),
    r("2026-10-21", "visit.utm_source.poster_qr", 1),
    r("2026-10-21", "visit.utm_medium.offline", 1),
    r("2026-10-19", "visit.utm_medium.stray", 9), // before the medium counter: ignored
  ];

  it("counts sessions by site and login state; days before collection are 미측정, the start day partial", () => {
    const x = buildInflow(["2026-10-21", "2026-10-19", "2026-10-20"], rows, "2026-10-20");
    expect(x.days).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(x.perDay.map((d) => d.coverage)).toEqual(["none", "partial", "full"]);
    expect(x.measuredDays).toBe(2);
    expect(x.total).toEqual({ anon: 5, member: 2, all: 7 });
    const et = x.sites.find((s) => s.site === "everytime")!;
    expect(et).toMatchObject({ total: 4, anon: 3, member: 1, viaUtm: 1, viaRef: 3, byDay: [0, 2, 2] });
    expect(x.sites.map((s) => s.site)).toEqual(["everytime", "unknown", "qr"]);
    expect(x.entries.map((e) => [e.kind, e.total])).toEqual([
      ["home", 3],
      ["post", 1],
      ["found", 1],
    ]);
    expect(x.utm.medium).toEqual([{ value: "offline", sessions: 1 }]);
    // the older referrer counter covers the chosen days with visit counting
    expect(x.legacyRefs.find((l) => l.label.includes("에브리타임"))?.sessions).toBe(3);
  });

  it("checks that a fully measured day's sources add up to its sessions", () => {
    const ok = buildInflow(["2026-10-21"], rows, "2026-10-20");
    expect(ok.perDay[0]).toMatchObject({ sessions: { anon: 3, member: 2 }, bySource: { anon: 3, member: 2 }, mismatch: false });
    const off = buildInflow(["2026-10-21"], rows.filter((x) => x.metric !== "visit.src.ref.direct.anon"), "2026-10-20");
    expect(off.perDay[0].mismatch).toBe(true);
    // the partial start day is never called a mismatch
    expect(buildInflow(["2026-10-20"], rows, "2026-10-20").perDay[0].mismatch).toBe(false);
  });

  it("nothing collected yet: every day 미측정, and the export says so", () => {
    const none = buildInflow(["2026-10-21"], rows, null);
    expect(none.measuredDays).toBe(0);
    expect(none.sites).toEqual([]);
    const ds = inflowDataset(none);
    expect(ds.tables[0].total).toBeUndefined();
    expect(ds.tables[1].rows[0]).toEqual(["2026-10-21", 5, null, "미측정"]);
    const some = inflowDataset(buildInflow(["2026-10-21"], rows, "2026-10-20"));
    expect(some.tables[0].total?.[1]).toBe(5);
  });
});
