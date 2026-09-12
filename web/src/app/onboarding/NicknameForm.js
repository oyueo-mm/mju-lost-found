"use client";

import { useActionState } from "react";
import { setNickname } from "./actions";

export default function NicknameForm({ detectedMajor }) {
  const [state, formAction, pending] = useActionState(setNickname, null);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-semibold">닉네임</label>
        <input
          name="nickname"
          placeholder="한글/영문/숫자 2~20자"
          maxLength={20}
          autoFocus
          autoComplete="off"
          required
          className="field"
        />
      </div>

      {detectedMajor && (
        <p className="rounded-xl bg-sunken px-3 py-2 text-sm text-ink-soft">
          학과: <b className="text-ink">{detectedMajor}</b>{" "}
          <span className="text-xs text-ink-faint">(자동 인식됨)</span>
        </p>
      )}

      {state?.error && <p className="text-sm text-brand-deep">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full py-3"
      >
        {pending ? "저장 중…" : "시작하기"}
      </button>
    </form>
  );
}
