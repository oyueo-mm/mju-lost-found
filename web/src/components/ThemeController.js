"use client";

import { useEffect } from "react";

// localStorage 값을 <html> 속성에 반영. 시스템 테마 변화 + 다른 탭 변경 감지.
export function applyTheme() {
  try {
    const r = document.documentElement;
    const m = localStorage.getItem("theme") || "system";
    const dark =
      m === "dark" ||
      (m === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    r.dataset.theme = dark ? "dark" : "light";

    const a = localStorage.getItem("accent");
    if (a && a !== "blue") r.dataset.accent = a;
    else delete r.dataset.accent;

    if (localStorage.getItem("contrast") === "high") r.dataset.contrast = "high";
    else delete r.dataset.contrast;
  } catch {
    /* noop */
  }
}

export default function ThemeController() {
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if ((localStorage.getItem("theme") || "system") === "system") applyTheme();
    };
    mq.addEventListener("change", onSystem);
    window.addEventListener("themechange", applyTheme);
    window.addEventListener("storage", applyTheme);
    return () => {
      mq.removeEventListener("change", onSystem);
      window.removeEventListener("themechange", applyTheme);
      window.removeEventListener("storage", applyTheme);
    };
  }, []);
  return null;
}
