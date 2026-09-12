"use client";

import { useState, useTransition } from "react";
import { setBetaMode } from "@/lib/admin-actions";

export default function BetaToggle({ initialOpen }) {
  const [open, setOpen] = useState(!!initialOpen);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(null);

  function toggle() {
    const next = !open;
    setErr(null);
    setOpen(next); // 낙관적
    startTransition(async () => {
      const r = await setBetaMode(next);
      if (r?.error) {
        setErr(r.error);
        setOpen(!next);
      }
    });
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold">베타 모드</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            켜짐: <b>@gmail.com</b> 도 로그인 가능 · 꺼짐: <b>@mju.ac.kr</b> 만
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="베타 모드"
          disabled={pending}
          onClick={toggle}
          className={`relative box-border inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            open ? "bg-brand" : "bg-line"
          } ${pending ? "opacity-60" : ""}`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              open ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <p className="mt-2 text-xs font-semibold text-ink-soft">
        현재: {open ? "베타 개방 (gmail 허용)" : "명지대 전용"}
      </p>
      {err && <p className="mt-1 text-xs text-brand-deep">{err}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        끄면 이미 gmail 로 로그인한 사용자도 다음 요청부터 차단돼요. 반영까지
        최대 30초 걸릴 수 있어요.
      </p>
    </section>
  );
}
