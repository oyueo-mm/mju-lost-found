"use client";

import { useState } from "react";

// Phase I section 6: "복사할 수 있는 UI면 좋다" -- a small clipboard-copy
// affordance next to the publicId text already rendered by the caller.
// Browser Clipboard API only, no new dependency. Never touches
// User.id -- this only ever receives/copies the already-public publicId
// string the page itself passed in.
export function CopyPublicId({ publicId }: { publicId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable -- silently no-op, the
      // publicId text is still visible/selectable by hand regardless.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs font-medium text-primary hover:opacity-80"
    >
      {copied ? "복사됨" : "복사"}
    </button>
  );
}
