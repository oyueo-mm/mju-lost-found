"use client";

import { useEffect, useSyncExternalStore } from "react";

import { defaultOptOutForAdmin, STATS_OPT_OUT_EVENT as EVENT, STATS_OPT_OUT_KEY, STATS_OPT_OUT_SET_KEY } from "@/components/layout/VisitBeacon";

const read = () => {
  try {
    return window.localStorage.getItem(STATS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
};
const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

// 내 방문 통계에서 제외 (this browser). Admin accounts are already counted
// apart on the server while signed in; this keeps the same browser out after
// sign-out too. Shown only to admins (/admin/stats), so the first visit here
// turns it on by default; unticking it is remembered. Stored only in this
// browser.
export function StatsOptOutToggle() {
  const optedOut = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => defaultOptOutForAdmin(), []);
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={optedOut}
        onChange={(e) => {
          try {
            if (e.target.checked) window.localStorage.setItem(STATS_OPT_OUT_KEY, "1");
            else window.localStorage.removeItem(STATS_OPT_OUT_KEY);
            window.localStorage.setItem(STATS_OPT_OUT_SET_KEY, "manual");
          } catch {
            // no storage: nothing to remember
          }
          window.dispatchEvent(new Event(EVENT));
        }}
      />
      내 방문 통계에서 제외(이 브라우저, 로그아웃한 뒤에도 유지)
    </label>
  );
}
