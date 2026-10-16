import { describe, expect, it } from "vitest";

import { durationBucket, flowCounterChanges, markSent, pagesBucket, parseFlowUpdate, pendingUpdate, type FlowRecord } from "./flow";

const T0 = Date.UTC(2026, 9, 16, 1, 0, 0); // 10:00 KST
const record = (over: Partial<FlowRecord> = {}): FlowRecord => ({
  day: "2026-10-16",
  start: T0,
  first: "home",
  last: "home",
  pages: 1,
  active: T0,
  sent: null,
  sentDur: 0,
  ...over,
});

// Apply a series of updates to an in-memory MetricDaily.
function apply(updates: ReturnType<typeof pendingUpdate>[], device: "mobile" | "pc" = "mobile") {
  const counts = new Map<string, number>();
  for (const u of updates) if (u) for (const [m, n] of flowCounterChanges(u, device)) counts.set(m, (counts.get(m) ?? 0) + n);
  return Object.fromEntries([...counts].filter(([, n]) => n !== 0));
}

describe("방문 시간·이탈 buckets", () => {
  it("puts durations and page counts in the stated buckets", () => {
    expect([0, 9, 10, 29, 30, 59, 60, 179, 180, 299, 300, 599, 600, 5000].map(durationBucket)).toEqual([
      "lt10s", "lt10s", "10to30s", "10to30s", "30to60s", "30to60s", "1to3m", "1to3m", "3to5m", "3to5m", "5to10m", "5to10m", "10mplus", "10mplus",
    ]);
    expect([1, 2, 3, 4, 5, 9, 10, 40].map(pagesBucket)).toEqual(["1", "2", "3to4", "3to4", "5to9", "5to9", "10plus", "10plus"]);
  });
});

describe("each session counted once, at its latest known state", () => {
  it("moves a session between buckets as it goes on, ending where it ended", () => {
    let r = record();
    const sent: ReturnType<typeof pendingUpdate>[] = [];
    const report = () => {
      const u = pendingUpdate(r);
      sent.push(u);
      r = markSent(r, u);
    };
    report(); // first view: home, 0s
    r = { ...r, last: "lost", pages: 2, active: T0 + 20_000 };
    report();
    r = { ...r, active: T0 + 50_000 }; // input on the page (visible)
    r = { ...r, last: "post", pages: 3, active: T0 + 70_000 };
    report();
    expect(pendingUpdate(r)).toBeNull(); // nothing new: nothing sent
    expect(apply(sent)).toEqual({
      "visit.flow.sessions.mobile": 1,
      "visit.flow.open": 1,
      "visit.flow.exit.post.mobile": 1,
      "visit.flow.path.home.post": 1,
      "visit.flow.pages.3to4": 1,
      "visit.flow.dur.1to3m.mobile": 1,
      "visit.flow.endhour.10": 1,
      "visit.flow.dursec.mobile": 70,
    });
    // the browser starts its next session: this one is reported as ended
    const close = pendingUpdate(r, true);
    expect(apply([...sent, close])).toMatchObject({ "visit.flow.closed": 1 });
    expect(apply([...sent, close])["visit.flow.open"]).toBeUndefined();
  });

  it("a session whose reports were never sent is counted once when it is closed", () => {
    const r = record({ last: "found", pages: 2, active: T0 + 5_000 });
    expect(apply([pendingUpdate(r, true)], "pc")).toEqual({
      "visit.flow.sessions.pc": 1,
      "visit.flow.closed": 1,
      "visit.flow.exit.found.pc": 1,
      "visit.flow.path.home.found": 1,
      "visit.flow.pages.2": 1,
      "visit.flow.dur.lt10s.pc": 1,
      "visit.flow.endhour.10": 1,
      "visit.flow.dursec.pc": 5,
    });
  });

  it("caps a session's share of the duration total at 60 minutes", () => {
    const u = pendingUpdate(record({ active: T0 + 5 * 3600_000 }))!;
    expect(u.durSec).toBe(3600);
    expect(u.to.dur).toBe("10mplus");
  });
});

describe("server-side checks", () => {
  const to = { first: "home", exit: "lost", pages: "2", dur: "10to30s", hour: 10 };
  it("accepts well-formed reports about the last 7 days only", () => {
    expect(parseFlowUpdate({ day: "2026-10-16", init: true, to }, "2026-10-16")).not.toBeNull();
    expect(parseFlowUpdate({ day: "2026-10-09", from: to, to }, "2026-10-16")).not.toBeNull();
    expect(parseFlowUpdate({ day: "2026-10-08", init: true, to }, "2026-10-16")).toBeNull();
    expect(parseFlowUpdate({ day: "2026-10-17", init: true, to }, "2026-10-16")).toBeNull();
    expect(parseFlowUpdate({ day: "2026-10-16", to }, "2026-10-16")).toBeNull(); // neither init nor from
    expect(parseFlowUpdate({ day: "2026-10-16", init: true, to: { ...to, exit: "/post/12" } }, "2026-10-16")).toBeNull();
    expect(parseFlowUpdate({ day: "2026-10-16", init: true, to: { ...to, hour: 24 } }, "2026-10-16")).toBeNull();
    expect(parseFlowUpdate({ day: "2026-10-16", init: true, to, durSec: 99999 }, "2026-10-16")?.durSec).toBe(3600);
  });
});
