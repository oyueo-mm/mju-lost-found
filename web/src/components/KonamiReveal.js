"use client";

import { useEffect, useState } from "react";

export default function KonamiReveal() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      setOn(localStorage.getItem("mjido-boost") === "1");
    } catch {
      /* noop */
    }
  }, []);

  if (!on) return null;

  function dismiss() {
    try {
      localStorage.removeItem("mjido-boost");
    } catch {
      /* noop */
    }
    setOn(false);
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-line-soft pt-3">
      <p className="text-xs text-ink-faint">
        명지도 +100%p 받으셨죠? <b className="text-ink">응 구라야.</b> 거래 잘
        마치고 정직하게 올리세요.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-xs text-ink-faint underline transition hover:text-ink"
      >
        알겠어요
      </button>
    </div>
  );
}
