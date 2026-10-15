import { beforeEach, describe, expect, it, vi } from "vitest";

let userAgent: string | null = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => (name === "user-agent" ? userAgent : null) }) }));

const counts = new Map<string, number>();
let audience: "anon" | "member" | "internal" = "anon";
vi.mock("@/lib/metrics/record", () => ({
  addDailyCount: (metric: string, n = 1) => counts.set(metric, (counts.get(metric) ?? 0) + n),
  currentAudience: async () => audience,
}));

const { recordVisitsAction } = await import("./visitActions");

beforeEach(() => {
  counts.clear();
  audience = "anon";
  userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
});

describe("방문 통계 server action", () => {
  it("counts a signed-out session start with its referrer and UTM, then plain views", async () => {
    await recordVisitsAction([
      { kind: "home", sessionStart: true, ref: "everytime", utmSource: "everytime", utmCampaign: "launch" },
      { kind: "found", sessionStart: false },
      { kind: "post", sessionStart: false },
    ]);
    expect(Object.fromEntries(counts)).toEqual({
      "visit.pv.anon": 3,
      "visit.page.home.anon": 1,
      "visit.page.found.anon": 1,
      "visit.page.post.anon": 1,
      "visit.session.anon": 1,
      "visit.ref.everytime": 1,
      "visit.utm_source.everytime": 1,
      "visit.utm_campaign.launch": 1,
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
    expect(Object.fromEntries(counts)).toEqual({
      "visit.pv.anon": 1,
      "visit.page.home.anon": 1,
      "visit.session.anon": 1,
      "visit.ref.other": 1,
    });

    counts.clear();
    await recordVisitsAction(Array.from({ length: 50 }, () => ({ kind: "home", sessionStart: false })));
    expect(counts.get("visit.pv.anon")).toBe(20);

    counts.clear();
    await recordVisitsAction("nonsense");
    await recordVisitsAction([]);
    expect(counts.size).toBe(0);
  });
});
