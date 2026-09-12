"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { useT, useLocale } from "@/i18n/client";

// "3분 전" 을 살아 있게 — 30초마다 다시 계산. 인터벌은 컴포넌트 수와 무관하게 1개만 돈다.
const listeners = new Set();
let timer = null;
function subscribe(fn) {
  listeners.add(fn);
  if (!timer) {
    timer = setInterval(() => listeners.forEach((l) => l()), 30_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const INTL_LOCALE = { ko: "ko-KR", en: "en-US", zh: "zh-CN", vi: "vi-VN", mn: "mn-MN" };

function render(value, t, locale, now = Date.now()) {
  if (!value) return "";
  const d = new Date(value);
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hourAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("time.dayAgo", { n: day });
  return d.toLocaleDateString(INTL_LOCALE[locale] || "ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
  });
}

export default function TimeAgo({ value, className = "" }) {
  const t = useT();
  const locale = useLocale();
  // 서버 렌더 값으로 시작 → 마운트 후 클라이언트 시계로 갱신
  const [text, setText] = useState(() => render(value, t, locale));

  useEffect(() => {
    const update = () => setText(render(value, t, locale));
    update();
    const unsub = subscribe(update);
    const onVisible = () => document.visibilityState === "visible" && update();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [value, t, locale]);

  return (
    <time
      dateTime={value}
      title={formatDateTime(value)}
      suppressHydrationWarning
      className={`num ${className}`}
    >
      {text}
    </time>
  );
}
