"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { isOutsideInitialView, observeViewCycle, prefersReducedMotion } from "@/components/ui/viewCycle";
import { DEMO_HOLD_MS, shouldScheduleReplay, waitBeforePlay } from "./demoSchedule";

// Shared by every DemoPlayer on the page: when the demo that is playing
// right now ends, and which one it is. Keeps two demos from moving at the
// same time.
let busyUntil = 0;
let busyOwner: object | null = null;

type DemoPlayerProps = {
  children: ReactNode;
  // Length of one run (last part's delay + its animation), so the player
  // knows when the final frame is reached.
  durationMs: number;
  // Feature demos replay after DEMO_HOLD_MS on the final frame; small
  // decorations (feature icons) only replay when the section comes back.
  loop?: boolean;
  className?: string;
  // A purely illustrative mockup (fake form/chat): hidden from screen
  // readers, the section's own text says what it shows.
  decorative?: boolean;
};

// 랜딩 애니메이션 재생기: sets data-demo on its wrapper, which the
// "Landing demos" CSS in globals.css keys on -- "ready" holds the parts in
// their start state, "play" runs the sequence once, no attribute shows the
// finished frame.
//
// - Plays when the demo comes into view; once it has left the screen
//   (fully, plus a margin -- see viewCycle.ts) it resets, so the next visit
//   plays from the start.
// - One demo moves at a time: a demo whose turn hasn't come yet shows its
//   finished frame and starts when the playing one ends (e.g. three cards
//   side by side play one after another).
// - loop: after a run, holds the final frame DEMO_HOLD_MS and plays again,
//   up to DEMO_MAX_AUTO_REPLAYS times per visit, only while on screen and
//   while the tab is visible.
// - Reduced motion, no IntersectionObserver, or no JS: no data-demo at all,
//   so the demo is simply shown complete.
// - A demo already on screen at load is not blanked out to play; it counts
//   as having just played.
export function DemoPlayer({ children, durationMs, loop = false, className = "", decorative = false }: DemoPlayerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;

    const self = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onScreen = false;
    let replays = 0;
    let replayDue = false;
    let shownAtLoad = !isOutsideInitialView(el);
    if (!shownAtLoad) el.dataset.demo = "ready";

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const releaseTurn = () => {
      if (busyOwner === self) {
        busyOwner = null;
        busyUntil = 0;
      }
    };
    const run = () => {
      // Restart the CSS animations: back to the start state, flush, play.
      el.dataset.demo = "ready";
      void el.offsetWidth;
      el.dataset.demo = "play";
      busyUntil = Date.now() + durationMs;
      busyOwner = self;
      if (shouldScheduleReplay(loop, replays)) later(durationMs + DEMO_HOLD_MS, () => tryPlay(true));
    };
    const later = (ms: number, fn: () => void) => {
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, ms);
    };
    // Plays now, or waits for the demo that is moving. While waiting it
    // shows its finished frame rather than an empty start state.
    const tryPlay = (isReplay: boolean) => {
      if (!onScreen) return;
      if (document.hidden) {
        replayDue = true;
        return;
      }
      const wait = busyOwner === self ? 0 : waitBeforePlay(Date.now(), busyUntil);
      if (wait > 0) {
        if (el.dataset.demo === "ready") delete el.dataset.demo;
        return later(wait, () => tryPlay(isReplay));
      }
      if (isReplay) replays += 1;
      run();
    };

    const stop = observeViewCycle(el, {
      onEnter: () => {
        onScreen = true;
        replays = 0;
        replayDue = false;
        clearTimer();
        if (shownAtLoad) {
          shownAtLoad = false;
          if (shouldScheduleReplay(loop, replays)) later(DEMO_HOLD_MS, () => tryPlay(true));
          return;
        }
        tryPlay(false);
      },
      onLeave: () => {
        onScreen = false;
        replayDue = false;
        shownAtLoad = false;
        clearTimer();
        releaseTurn();
        el.dataset.demo = "ready";
      },
    });
    const onVisibility = () => {
      if (!document.hidden && replayDue && onScreen) {
        replayDue = false;
        later(DEMO_HOLD_MS / 2, () => tryPlay(true));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      clearTimer();
      releaseTurn();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [durationMs, loop]);

  return (
    <div ref={ref} className={className} aria-hidden={decorative || undefined}>
      {children}
    </div>
  );
}
