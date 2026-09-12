"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitInquiry } from "@/lib/inquiry-actions";
import { INQUIRY_CATEGORIES } from "@/lib/inquiry";

export default function InquiryForm() {
  const [state, action, pending] = useActionState(submitInquiry, null);
  const ref = useRef(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="card space-y-3 p-4">
      <div>
        <label className="mb-1 block text-sm font-semibold">분류</label>
        <select name="category" required defaultValue="" className="field">
          <option value="" disabled>
            선택하세요
          </option>
          {INQUIRY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold">문의 내용</label>
        <textarea
          name="message"
          required
          rows={4}
          maxLength={2000}
          placeholder="불편한 점이나 개선 아이디어를 자유롭게 적어주세요."
          className="field"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-brand-deep">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm font-semibold text-brand">
          문의가 접수됐어요. 답변이 등록되면 알림으로 알려드릴게요.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full py-2.5 text-sm"
      >
        {pending ? "보내는 중…" : "문의 보내기"}
      </button>
    </form>
  );
}
