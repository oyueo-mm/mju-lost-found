import { describe, expect, it } from "vitest";

import { isEnteredEnough } from "@/components/ui/viewCycle";
import { DEMO_GAP_MS, DEMO_MAX_AUTO_REPLAYS, shouldScheduleReplay, waitBeforePlay } from "./demoSchedule";

describe("landing demo schedule", () => {
  it("plays right away when no other demo is moving, otherwise after it ends plus a gap", () => {
    expect(waitBeforePlay(10_000, 0)).toBe(0);
    expect(waitBeforePlay(10_000, 9_000)).toBe(0);
    expect(waitBeforePlay(10_000, 12_000)).toBe(2_000 + DEMO_GAP_MS);
  });

  it("replays a looping demo only a limited number of times per visit, never a non-looping one", () => {
    const scheduled = Array.from({ length: 5 }, (_, replays) => shouldScheduleReplay(true, replays));
    expect(scheduled.filter(Boolean)).toHaveLength(DEMO_MAX_AUTO_REPLAYS);
    expect(scheduled[0]).toBe(true);
    expect(shouldScheduleReplay(false, 0)).toBe(false);
  });
});

describe("view cycle enter rule", () => {
  const entry = (isIntersecting: boolean, ratio: number, height: number, elementHeight = ratio ? height / ratio : 0) => ({
    isIntersecting,
    intersectionRatio: ratio,
    intersectionRect: { height },
    boundingClientRect: { height: elementHeight },
  });

  it("needs a real share of the element on screen, not just its edge", () => {
    expect(isEnteredEnough(entry(true, 0.05, 30), 800)).toBe(false);
    expect(isEnteredEnough(entry(true, 0.3, 200), 800)).toBe(true);
    expect(isEnteredEnough(entry(false, 0, 0), 800)).toBe(false);
  });

  it("counts an element taller than the screen once it fills 40% of the viewport", () => {
    expect(isEnteredEnough(entry(true, 0.15, 360), 800)).toBe(true);
    expect(isEnteredEnough(entry(true, 0.15, 200), 800)).toBe(false);
  });

  it("on a phone, waits until the section is well on screen (60% of it, or 22% of the viewport)", () => {
    // 248px card on an 844px phone: 149px needed
    expect(isEnteredEnough(entry(true, 72 / 248, 72, 248), 844, true)).toBe(false);
    expect(isEnteredEnough(entry(true, 150 / 248, 150, 248), 844, true)).toBe(true);
    // 746px section: 22% of 844 = 186px needed
    expect(isEnteredEnough(entry(true, 0.25, 186, 746), 844, true)).toBe(true);
    expect(isEnteredEnough(entry(true, 0.2, 149, 746), 844, true)).toBe(false);
    // desktop rule unchanged for the same entry
    expect(isEnteredEnough(entry(true, 72 / 248, 72, 248), 844)).toBe(true);
  });
});
