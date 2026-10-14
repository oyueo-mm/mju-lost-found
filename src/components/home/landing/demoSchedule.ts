// Timing rules for the landing demos (DemoPlayer), kept as plain functions
// so they can be tested without a browser.

// A finished demo stays on its final frame this long before replaying.
export const DEMO_HOLD_MS = 8000;
// Auto-replays per visit. Each return to the section starts the count
// again. A cap keeps the page from moving forever while someone reads (cf.
// WCAG 2.2.2, moving content that starts by itself) -- raise it here if
// endless looping is wanted.
export const DEMO_MAX_AUTO_REPLAYS = 2;
// Gap kept between one demo finishing and another starting.
export const DEMO_GAP_MS = 400;

// One demo plays at a time: a demo that wants to (re)play while another is
// running waits until that one ends plus a short gap. Returns how long to
// wait (0 = play now).
export function waitBeforePlay(now: number, busyUntil: number): number {
  return now < busyUntil ? busyUntil - now + DEMO_GAP_MS : 0;
}

// Whether to schedule another automatic replay after the one that just
// started (replaysSoFar counts automatic replays in this visit).
export function shouldScheduleReplay(loop: boolean, replaysSoFar: number): boolean {
  return loop && replaysSoFar < DEMO_MAX_AUTO_REPLAYS;
}
