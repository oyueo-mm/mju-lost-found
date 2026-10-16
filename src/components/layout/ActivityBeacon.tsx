"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { markActiveAction } from "@/app/(main)/activityActions";
import { activityStep } from "@/lib/metrics/activityTime";

// 최근 활동 감지 (signed-in members only): tells the server this member is
// using the site -- on each screen shown, on returning to the tab, and on
// input (touch, click, scroll, key) while the screen is visible. A
// background tab reports nothing. Calls are skipped here when the server
// would not write anyway (activityTime.ts: within 5 minutes of the last
// report from this browser, same KST hour); the server decides again from
// the stored time, so several tabs or devices never write more often.
// Nothing about the screen or the input is sent -- only "active now".
const INPUT_CHECK_MS = 15_000;
let inFlight = false;
let memoryLast = 0; // when storage is unavailable

const keyOf = (userId: number) => `mju-find:active-at:${userId}`;

function readLast(key: string): number {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return memoryLast;
  }
}

function writeLast(key: string, at: number) {
  memoryLast = at;
  try {
    window.localStorage.setItem(key, String(at));
  } catch {
    // memory only
  }
}

function report(userId: number) {
  if (inFlight || document.visibilityState !== "visible") return;
  const key = keyOf(userId);
  const now = Date.now();
  const last = readLast(key);
  // (a stored time ahead of this clock is ignored, not waited out)
  if (last && last <= now && !activityStep(new Date(last), new Date(now)).write) return;
  inFlight = true;
  writeLast(key, now);
  markActiveAction()
    .catch(() => writeLast(key, last)) // failed: the next activity tries again
    .finally(() => {
      inFlight = false;
    });
}

export function ActivityBeacon({ userId }: { userId: number }) {
  const pathname = usePathname();

  useEffect(() => {
    report(userId);
  }, [userId, pathname]);

  useEffect(() => {
    let lastCheck = 0;
    const onInput = () => {
      const now = Date.now();
      if (now - lastCheck < INPUT_CHECK_MS) return;
      lastCheck = now;
      report(userId);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") report(userId);
    };
    const inputs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const type of inputs) window.addEventListener(type, onInput, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const type of inputs) window.removeEventListener(type, onInput);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  return null;
}
