"use client";

import { useSyncExternalStore } from "react";

import { STATS_OPT_OUT_KEY } from "@/components/layout/VisitBeacon";

const EVENT = "mju-find:stats-opt-out";
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

// 방문 통계에서 이 브라우저 제외 (개발·테스트용). Admin accounts are already
// counted apart on the server; this covers a developer or tester browsing
// signed out or with a member test account. Stored only in this browser.
export function StatsOptOutToggle() {
  const optedOut = useSyncExternalStore(subscribe, read, () => false);
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={optedOut}
        onChange={(e) => {
          try {
            if (e.target.checked) window.localStorage.setItem(STATS_OPT_OUT_KEY, "1");
            else window.localStorage.removeItem(STATS_OPT_OUT_KEY);
          } catch {
            // no storage: nothing to remember
          }
          window.dispatchEvent(new Event(EVENT));
        }}
      />
      이 브라우저의 방문을 통계에서 제외(개발·테스트용, 로그아웃 상태 포함)
    </label>
  );
}
