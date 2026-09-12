"use client";

import { useState, useTransition } from "react";
import { completeMatch } from "@/lib/match-actions";

export default function CompleteMatchButton({ matchId }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm("물건을 무사히 주고받았나요? 매칭이 완료 처리돼요.")) {
            startTransition(async () => {
              const r = await completeMatch(matchId);
              if (r?.error) setErr(r.error);
            });
          }
        }}
        className="btn btn-primary px-4 py-1.5 text-xs"
      >
        {pending ? "처리 중…" : "🎉 돌려받았어요"}
      </button>
      {err && <p className="mt-1 text-xs text-brand-deep">{err}</p>}
    </div>
  );
}
