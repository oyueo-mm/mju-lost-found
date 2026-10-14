"use client";

import { useEffect } from "react";

import { markActiveTodayAction } from "@/app/(main)/activityActions";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// Once per member per KST day and browser: tells the server this member was
// active today (운영 통계). The server dedupes again by its primary key, so
// several browsers or a cleared storage never count a member twice a day.
export function ActiveDayBeacon({ userId }: { userId: number }) {
  useEffect(() => {
    const today = new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
    const key = `mju-find:active-day:${userId}`;
    try {
      if (window.localStorage.getItem(key) === today) return;
    } catch {
      // No storage: the server's own dedupe still holds.
    }
    markActiveTodayAction()
      .then(() => {
        try {
          window.localStorage.setItem(key, today);
        } catch {
          // ignore
        }
      })
      .catch(() => {});
  }, [userId]);
  return null;
}
