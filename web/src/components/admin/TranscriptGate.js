"use client";

import { useState, useTransition } from "react";
import { approveTranscript } from "@/lib/admin-actions";

export default function TranscriptGate({ reportId, approved, needed, iApproved }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(iApproved);

  const count = approved + (done && !iApproved ? 1 : 0);

  return (
    <div className="card-dashed p-5 text-center">
      <p className="font-bold">채팅 내용은 관리자 전원 동의가 필요해요</p>
      <p className="mt-1 text-sm text-ink-soft">
        열람 동의 {count} / {needed}명
      </p>
      {!done ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await approveTranscript(reportId);
              if (r?.ok) setDone(true);
            })
          }
          className="btn btn-primary mt-3 px-4 py-2 text-sm"
        >
          {pending ? "처리 중…" : "열람 동의"}
        </button>
      ) : (
        <p className="mt-3 text-sm text-ink-faint">
          동의했어요. 다른 관리자의 동의를 기다리는 중이에요.
        </p>
      )}
    </div>
  );
}
