"use client";

import { useActionState, useRef } from "react";
import { sendNotice } from "@/lib/admin-actions";

export default function NoticeForm() {
  const [state, action, pending] = useActionState(sendNotice, null);
  const formRef = useRef(null);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(e) => {
        if (!confirm("전체 사용자에게 공지 알림을 보낼까요? 되돌릴 수 없어요.")) {
          e.preventDefault();
        }
      }}
      className="card space-y-3 p-4"
    >
      <div>
        <label className="mb-1 block text-sm font-semibold">제목</label>
        <input
          name="title"
          required
          maxLength={100}
          autoComplete="off"
          placeholder="예: 베타 서비스 점검 안내"
          className="field"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold">
          내용 <span className="font-normal text-ink-faint">(선택)</span>
        </label>
        <textarea
          name="body"
          rows={4}
          maxLength={1000}
          placeholder="공지 내용을 적어주세요."
          className="field"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold">
          관련 링크{" "}
          <span className="font-normal text-ink-faint">
            (선택 · 공지 상세에 “자세히 보기” 버튼으로 표시)
          </span>
        </label>
        <input
          name="link"
          autoComplete="off"
          placeholder="/help 처럼 / 로 시작하는 앱 내부 경로"
          className="field"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-brand-deep">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm font-semibold text-brand">
          {state.count}명에게 공지를 보냈어요.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full py-2.5 text-sm"
      >
        {pending ? "보내는 중…" : "전체 발송"}
      </button>
    </form>
  );
}
