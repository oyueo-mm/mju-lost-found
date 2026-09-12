"use client";

import { useState, useTransition } from "react";
import { confirmMatch } from "@/lib/match-actions";

export default function MatchConfirmButton({ lostPostId, foundPostId, score }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(null);

  return (
    <div className="shrink-0">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            confirm(
              "이 게시글과 매칭할까요? 확정하면 '내 정보 → 내 매칭'에 추가되고 두 글이 정리돼요.",
            )
          ) {
            startTransition(async () => {
              const r = await confirmMatch(lostPostId, foundPostId, score);
              if (r?.error) setErr(r.error);
            });
          }
        }}
        className="btn btn-primary px-3 py-1.5 text-xs"
      >
        {pending ? "확정 중…" : "매칭하기"}
      </button>
      {err && <p className="mt-1 text-xs text-brand-deep">{err}</p>}
    </div>
  );
}
