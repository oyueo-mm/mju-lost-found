"use client";

import { useActionState } from "react";
import { submitAppeal } from "@/lib/appeal-actions";
import { formatDateTime } from "@/lib/format";

export default function AppealForm({ existingText, existingAt, supportEmail }) {
  const [state, action, pending] = useActionState(submitAppeal, null);
  const done = state?.ok || existingText;

  if (done) {
    return (
      <div className="mt-5 rounded-lg border border-line bg-sunken p-4 text-left">
        <p className="text-sm font-bold">이의 제기가 접수됐어요</p>
        <p className="mt-1 text-xs text-ink-faint">
          {existingAt ? formatDateTime(existingAt) : "방금"} · 관리자가 확인 후
          알림으로 회신해요.
        </p>
        {existingText && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
            {existingText}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="mt-5 text-left">
      <label className="mb-1 block text-sm font-semibold">이의 제기</label>
      <textarea
        name="text"
        required
        minLength={10}
        maxLength={1000}
        rows={4}
        placeholder="정지 사유에 대해 이의가 있다면 상황을 자세히 적어주세요. 관리자가 확인 후 알림으로 회신해요."
        className="field"
      />
      {state?.error && (
        <p className="mt-1 text-xs text-brand-deep">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary mt-2 w-full py-2.5 text-sm"
      >
        {pending ? "보내는 중…" : "이의 제기 보내기"}
      </button>
      {supportEmail && (
        <a
          href={`mailto:${supportEmail}?subject=${encodeURIComponent(
            "[명지 분실물 센터] 계정 정지 문의",
          )}`}
          className="mt-2 block text-center text-xs text-ink-faint underline"
        >
          이메일로 문의하기 ({supportEmail})
        </a>
      )}
    </form>
  );
}
