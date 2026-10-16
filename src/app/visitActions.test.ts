import { beforeEach, describe, expect, it, vi } from "vitest";

let userAgent: string | null = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
let ip = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "user-agent" ? userAgent : name === "x-forwarded-for" ? `${ip}, 10.0.0.1` : null) }),
}));
let ipCounter = 0;

const counts = new Map<string, number>();
let audience: "anon" | "member" | "internal" = "anon";
vi.mock("@/lib/metrics/record", () => ({
  addDailyCount: (metric: string, n = 1) => counts.set(metric, (counts.get(metric) ?? 0) + n),
  currentAudience: async () => audience,
}));

const { recordVisitsAction } = await import("./visitActions");

// The counters these tests compare exactly; visit.start.* (start hour, first
// screen) are checked on their own below.
const counted = () => Object.fromEntries([...counts].filter(([k]) => !k.startsWith("visit.start.")));

beforeEach(() => {
  counts.clear();
  audience = "anon";
  userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
  ip = `203.0.113.${++ipCounter}`; // a fresh client per test (the per-minute limit is per client)
});

describe("방문 통계 server action", () => {
  it("counts a signed-out session start with its referrer and UTM, then plain views", async () => {
    await recordVisitsAction([
      { kind: "home", sessionStart: true, ref: "everytime", utmSource: "everytime", utmCampaign: "launch" },
      { kind: "found", sessionStart: false },
      { kind: "post", sessionStart: false },
    ]);
    expect(counts.get("visit.start.page.home")).toBe(1);
    expect(counted()).toEqual({
      "visit.pv.anon": 3,
      "visit.page.home.anon": 1,
      "visit.page.found.anon": 1,
      "visit.page.post.anon": 1,
      "visit.session.anon": 1,
      "visit.ref.everytime": 1,
      "visit.utm_source.everytime": 1,
      "visit.utm_campaign.launch": 1,
      "visit.device.mobile.pv": 3,
      "visit.device.mobile.session": 1,
    });
  });

  it("decides signed in / out on the server", async () => {
    audience = "member";
    await recordVisitsAction([{ kind: "lost", sessionStart: true, ref: "direct" }]);
    expect(counts.get("visit.pv.member")).toBe(1);
    expect(counts.get("visit.session.member")).toBe(1);
    expect(counts.has("visit.pv.anon")).toBe(false);
  });

  it("keeps admins' views apart", async () => {
    audience = "internal";
    await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct" }, { kind: "lost", sessionStart: false }]);
    expect(Object.fromEntries(counts)).toEqual({ "visit.internal.pv": 2 });
  });

  it("drops bots, unknown kinds, unsafe UTM values and anything past the per-call cap", async () => {
    userAgent = "Mozilla/5.0 (compatible; Googlebot/2.1)";
    await recordVisitsAction([{ kind: "home", sessionStart: true }]);
    expect(counts.size).toBe(0);

    userAgent = "Mozilla/5.0 Safari";
    await recordVisitsAction([
      { kind: "admin", sessionStart: false },
      { kind: "home", sessionStart: true, ref: "https://evil.example", utmSource: "<script>", utmCampaign: "에브리타임" },
      "not an object",
    ]);
    expect(counted()).toEqual({
      "visit.pv.anon": 1,
      "visit.page.home.anon": 1,
      "visit.session.anon": 1,
      "visit.ref.other": 1,
      "visit.device.other.pv": 1,
      "visit.device.other.session": 1,
    });

    counts.clear();
    await recordVisitsAction(Array.from({ length: 50 }, () => ({ kind: "home", sessionStart: false })));
    expect(counts.get("visit.pv.anon")).toBe(20);

    counts.clear();
    await recordVisitsAction("nonsense");
    await recordVisitsAction([]);
    expect(counts.size).toBe(0);
  });

  it("an opted-out browser: admin views stay internal, anyone else's are dropped", async () => {
    audience = "internal";
    expect(await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct" }], { optedOut: true })).toEqual({ admin: true });
    expect(Object.fromEntries(counts)).toEqual({ "visit.internal.pv": 1 });

    counts.clear();
    for (const who of ["anon", "member"] as const) {
      audience = who;
      expect(await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct" }], { optedOut: true })).toEqual({ admin: false });
    }
    expect(counts.size).toBe(0);

    // not opted out: counted as usual, and the reply says "not an admin"
    expect(await recordVisitsAction([{ kind: "home", sessionStart: false }])).toEqual({ admin: false });
    expect(Object.fromEntries([...counts].filter(([k]) => !k.startsWith("visit.member.hour.")))).toEqual({ "visit.pv.member": 1, "visit.page.home.member": 1, "visit.device.mobile.pv": 1 });
    expect([...counts.keys()].filter((k) => k.startsWith("visit.member.hour."))).toHaveLength(1); // 사용자 통계: by hour
  });

  it("caps one client at 60 events a minute, without affecting another client", async () => {
    for (let i = 0; i < 5; i++) await recordVisitsAction(Array.from({ length: 20 }, () => ({ kind: "home", sessionStart: false })));
    expect(counts.get("visit.pv.anon")).toBe(60);
    ip = "198.51.100.77";
    await recordVisitsAction([{ kind: "home", sessionStart: false }]);
    expect(counts.get("visit.pv.anon")).toBe(61);
  });

  it("counts at most 30 distinct UTM campaigns a day; later new ones as etc", async () => {
    for (let i = 0; i < 40; i++) {
      ip = `192.0.2.${i}`;
      await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct", utmCampaign: `spam${i}` }]);
    }
    const campaigns = [...counts.keys()].filter((k) => k.startsWith("visit.utm_campaign."));
    expect(campaigns.length).toBeLessThanOrEqual(31);
    expect(counts.get("visit.utm_campaign.etc")).toBeGreaterThanOrEqual(10);
    // an already-seen campaign keeps its own name
    ip = "192.0.2.250";
    await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct", utmCampaign: "spam0" }]);
    expect(counts.get("visit.utm_campaign.spam0")).toBe(2);
  });

  it("splits the same views and sessions by device, never adding to the totals", async () => {
    userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct" }, { kind: "lost", sessionStart: false }], { touch: true });
    expect(counts.get("visit.device.tablet.session")).toBe(1); // iPadOS: Mac User-Agent with a touch screen
    expect(counts.get("visit.device.tablet.pv")).toBe(2);
    expect(counts.get("visit.pv.anon")).toBe(2);
    expect(counts.get("visit.session.anon")).toBe(1);

    counts.clear();
    ip = "198.51.100.9";
    await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct" }]); // same Mac, no touch
    expect(counts.get("visit.device.pc.session")).toBe(1);

    counts.clear();
    audience = "internal";
    await recordVisitsAction([{ kind: "home", sessionStart: true, ref: "direct" }]);
    expect([...counts.keys()].some((k) => k.startsWith("visit.device."))).toBe(false); // admins stay out
  });

  it("counts start hour and first screen with each session, and applies flow reports on their own day", async () => {
    await recordVisitsAction([{ kind: "lost", sessionStart: true, ref: "direct" }], {
      flow: [
        { day: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), init: true, to: { first: "lost", exit: "lost", pages: "1", dur: "lt10s", hour: 10 } },
        { day: "2000-01-01", init: true, to: { first: "lost", exit: "lost", pages: "1", dur: "lt10s", hour: 10 } }, // too old: dropped
      ],
    });
    expect(counts.get("visit.start.page.lost")).toBe(1);
    expect([...counts.keys()].filter((k) => k.startsWith("visit.start.hour.")).length).toBe(1);
    expect(counts.get("visit.flow.sessions.mobile")).toBe(1);
    expect(counts.get("visit.flow.exit.lost.mobile")).toBe(1);

    // a report without page views (a backgrounded tab) is accepted too
    counts.clear();
    ip = "198.51.100.30";
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const s1 = { first: "lost", exit: "lost", pages: "1", dur: "lt10s", hour: 10 };
    await recordVisitsAction([], { flow: [{ day: today, from: s1, to: { ...s1, dur: "30to60s" }, durSec: 40 }] });
    expect(Object.fromEntries(counts)).toEqual({
      "visit.flow.dur.lt10s.mobile": -1,
      "visit.flow.dur.30to60s.mobile": 1,
      "visit.flow.dursec.mobile": 40,
    });

    // admins and opted-out browsers: nothing
    counts.clear();
    audience = "internal";
    await recordVisitsAction([], { flow: [{ day: today, init: true, to: s1 }] });
    expect(counts.size).toBe(0);
  });
});

