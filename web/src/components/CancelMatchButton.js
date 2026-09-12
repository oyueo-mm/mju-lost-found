"use client";

import { useTransition } from "react";
import { cancelMatch } from "@/lib/match-actions";

export default function CancelMatchButton({ matchId }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("이 매칭을 취소할까요?")) {
          startTransition(() => cancelMatch(matchId));
        }
      }}
      className="btn px-3 py-1 text-xs text-ink-faint hover:bg-sunken hover:text-ink"
    >
      {pending ? "…" : "매칭 취소"}
    </button>
  );
}
