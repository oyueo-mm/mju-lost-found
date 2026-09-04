"use client";

import { useActionState } from "react";

import { setNicknameAction } from "./actions";
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "@/lib/auth/nickname";

export function NicknameForm() {
  const [state, formAction, pending] = useActionState(setNicknameAction, null);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      <input
        type="text"
        name="nickname"
        placeholder={`한글/영문/숫자 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자`}
        maxLength={NICKNAME_MAX_LENGTH}
        required
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
      />
      {state?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {pending ? "설정 중..." : "닉네임 설정하기 (변경 불가)"}
      </button>
    </form>
  );
}
