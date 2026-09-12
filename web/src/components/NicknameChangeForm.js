"use client";

import { useActionState, useState } from "react";
import { changeNickname } from "@/lib/profile-actions";

export default function NicknameChangeForm({ current, changedAt }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(changeNickname, null);

  // 남은 쿨다운 계산 (30일)
  const COOLDOWN_DAYS = 30;
  const last = changedAt ? new Date(changedAt).getTime() : 0;
  const remainMs = last + COOLDOWN_DAYS * 24 * 60 * 60 * 1000 - Date.now();
  const locked = remainMs > 0;
  const remainText = locked
    ? `${Math.ceil(remainMs / (24 * 60 * 60 * 1000))}일 후 변경 가능`
    : null;

  if (state?.ok) {
    return <p className="mt-2 text-sm text-ink-faint">닉네임이 변경됐어요.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-sm font-semibold text-brand-strong"
      >
        닉네임 변경
        {locked && (
          <span className="ml-1 font-normal text-ink-faint">
            ({remainText})
          </span>
        )}
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input
        name="nickname"
        defaultValue={current || ""}
        placeholder="새 닉네임 (한글/영문/숫자 2~20자)"
        maxLength={20}
        autoComplete="off"
        required
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <p className="text-xs text-ink-faint">
        닉네임은 {COOLDOWN_DAYS}일에 한 번만 바꿀 수 있어요.
      </p>
      {state?.error && (
        <p className="text-xs text-brand-deep">{state.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || locked}
          className="btn btn-primary px-4 py-1.5 text-sm"
        >
          변경
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-ghost px-4 py-1.5 text-sm"
        >
          취소
        </button>
      </div>
    </form>
  );
}
