"use client";

import { useRef, useState, useTransition } from "react";
import { replyInquiry } from "@/lib/inquiry-actions";

export default function InquiryReplyForm({ inquiryId }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(null);
  const ref = useRef(null);

  function submit(e) {
    e.preventDefault();
    const body = new FormData(e.currentTarget).get("body");
    setErr(null);
    startTransition(async () => {
      const r = await replyInquiry(inquiryId, body);
      if (r?.error) setErr(r.error);
      else ref.current?.reset();
    });
  }

  return (
    <form ref={ref} onSubmit={submit} className="mt-4 space-y-2">
      <textarea
        name="body"
        required
        rows={3}
        maxLength={2000}
        placeholder="답장을 입력하세요. 운영팀에게 전달돼요."
        className="field"
      />
      {err && <p className="text-xs text-brand-deep">{err}</p>}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full py-2.5 text-sm"
      >
        {pending ? "보내는 중…" : "답장 보내기"}
      </button>
    </form>
  );
}
