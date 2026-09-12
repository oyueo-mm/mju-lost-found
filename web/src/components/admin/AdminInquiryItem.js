"use client";

import { useState, useTransition } from "react";
import { answerInquiry, closeInquiry } from "@/lib/inquiry-actions";
import InquiryThread from "@/components/InquiryThread";

export default function AdminInquiryItem({ inquiry: q }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(null);
  const [replying, setReplying] = useState(false);

  const needsAnswer =
    q.status === "open" ||
    (q.messages.length > 0 && !q.messages[q.messages.length - 1].staff);

  function submit(e) {
    e.preventDefault();
    const answer = new FormData(e.currentTarget).get("answer");
    setErr(null);
    startTransition(async () => {
      const r = await answerInquiry(q.id, answer);
      if (r?.error) setErr(r.error);
      else setReplying(false);
    });
  }

  return (
    <li className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-soft">
          {q.category} · {q.authorNickname || "?"}
        </span>
        <span
          className={`chip ${
            q.status === "answered"
              ? "bg-brand-tint text-brand-deep"
              : q.status === "closed"
                ? "bg-sunken text-ink-faint"
                : "bg-amber-tint text-amber-deep"
          }`}
        >
          {q.status === "answered"
            ? "답변 완료"
            : q.status === "closed"
              ? "종료"
              : "미답변"}
        </span>
      </div>

      <div className="mt-3">
        <InquiryThread messages={q.messages} meRight={false} />
      </div>

      {q.status !== "closed" && (
        <div className="mt-3">
          {replying || needsAnswer ? (
            <form onSubmit={submit} className="space-y-2">
              <textarea
                name="answer"
                required
                rows={3}
                maxLength={2000}
                placeholder="답변을 입력하세요. 이용자에게 알림으로 전달돼요."
                className="field"
              />
              {err && <p className="text-xs text-brand-deep">{err}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="btn btn-primary px-3 py-1.5 text-xs"
                >
                  {pending ? "저장 중…" : "답변 등록"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => closeInquiry(q.id))}
                  className="btn px-3 py-1.5 text-xs text-ink-faint hover:bg-sunken"
                >
                  종료
                </button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReplying(true)}
                className="btn btn-ghost px-3 py-1.5 text-xs"
              >
                답변 추가
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => closeInquiry(q.id))}
                className="btn px-3 py-1.5 text-xs text-ink-faint hover:bg-sunken"
              >
                종료
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
