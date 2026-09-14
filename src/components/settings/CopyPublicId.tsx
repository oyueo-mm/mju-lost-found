"use client";

import { useState } from "react";

import { useI18n } from "@/lib/i18n/client";

// Phase I section 6: "복사할 수 있는 UI면 좋다" -- a small clipboard-copy
// affordance next to the publicId text already rendered by the caller.
// Browser Clipboard API only, no new dependency. Never touches
// User.id -- this only ever receives/copies the already-public publicId
// string the page itself passed in.
export function CopyPublicId({ publicId }: { publicId: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"copy" | "copied" | "failed">("copy");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicId);
      setStatus("copied");
      setTimeout(() => setStatus("copy"), 1500);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus("copy"), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={t("profile.copyPublicId.aria")}
      className="text-xs font-medium text-primary hover:opacity-80"
    >
      {t(`profile.copyPublicId.${status}`)}
    </button>
  );
}
