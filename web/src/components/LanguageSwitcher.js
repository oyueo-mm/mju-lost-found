"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, LOCALE_LABEL } from "@/i18n/locales";
import { useLocale } from "@/i18n/client";
import { setLocale } from "@/i18n/actions";

// 언어 선택 — 누르면 쿠키 저장 후 현재 페이지를 서버에서 다시 렌더.
export default function LanguageSwitcher({ className = "" }) {
  const current = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  function pick(l) {
    if (l === current) return;
    start(async () => {
      await setLocale(l);
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap gap-1 ${className}`} role="group" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          disabled={pending}
          onClick={() => pick(l)}
          aria-pressed={l === current}
          className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
            l === current
              ? "bg-sunken text-ink"
              : "text-ink-faint hover:bg-sunken hover:text-ink"
          }`}
        >
          {LOCALE_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
