"use client";

import { useActionState, useEffect, useState } from "react";
import { agreeToTerms } from "@/lib/legal-actions";

const ITEMS = [
  { key: "age14", label: "만 14세 이상입니다", href: null },
  { key: "terms", label: "이용약관에 동의합니다", href: "/terms" },
  {
    key: "privacy",
    label: "개인정보 수집·이용에 동의합니다",
    href: "/privacy",
  },
  {
    key: "overseas",
    label: "개인정보 국외 이전에 동의합니다",
    href: "/privacy#overseas",
  },
];

const STORE_KEY = "consent-checks";

export default function ConsentForm() {
  const [state, action, pending] = useActionState(agreeToTerms, null);
  const [checked, setChecked] = useState({});

  // 전문 보기로 이동했다 돌아와도 체크 상태 유지
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) setChecked(JSON.parse(saved));
    } catch {
      /* noop */
    }
  }, []);

  function update(next) {
    setChecked(next);
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* noop */
    }
  }

  const allOn = ITEMS.every((it) => checked[it.key]);

  return (
    <form action={action} className="mt-6 text-left">
      <label className="flex items-center gap-2.5 rounded-lg bg-sunken px-3.5 py-3 font-bold">
        <input
          type="checkbox"
          checked={allOn}
          onChange={(e) => {
            const v = e.target.checked;
            update(Object.fromEntries(ITEMS.map((it) => [it.key, v])));
          }}
          className="h-4 w-4 accent-[var(--color-brand)]"
        />
        전체 동의합니다
      </label>

      <div className="mt-1 divide-y divide-line-soft">
        {ITEMS.map((it) => (
          <div key={it.key} className="flex items-center gap-2.5 px-1 py-3">
            <input
              type="checkbox"
              name={it.key}
              checked={!!checked[it.key]}
              onChange={(e) =>
                update({ ...checked, [it.key]: e.target.checked })
              }
              className="h-4 w-4 shrink-0 accent-[var(--color-brand)]"
            />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-brand">[필수]</span>{" "}
              {it.label}
            </span>
            {it.href && (
              <a
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-ink-faint underline"
              >
                전문 보기
              </a>
            )}
          </div>
        ))}
      </div>

      {state?.error && (
        <p className="mt-2 text-sm text-brand-deep">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending || !allOn}
        className="btn btn-primary mt-4 w-full py-3"
      >
        {pending ? "처리 중…" : "동의하고 시작하기"}
      </button>
    </form>
  );
}
