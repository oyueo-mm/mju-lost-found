"use client";

import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n/client";

const PHONE = "(max-width: 767px)";

// The post's description. On a phone a long one is cut to 8 lines with a
// 더 보기 toggle, so the chat button and the photos below it are not pushed
// far down; the whole text is always one tap away. It renders in full until
// the browser has measured it (no JavaScript, a desktop, or a short text:
// nothing is ever hidden).
export function ExpandableDescription({ text, className = "" }: { text: string; className?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const phone = window.matchMedia(PHONE);
    const measure = () => {
      if (!phone.matches) return setLong(false);
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
      // measured unclamped: the text's own height against 8 lines
      el.style.display = "block";
      const lines = el.scrollHeight / lineHeight;
      el.style.display = "";
      setLong(lines > 8.5);
    };
    measure();
    phone.addEventListener("change", measure);
    return () => phone.removeEventListener("change", measure);
  }, [text]);

  const clamped = long && !expanded;
  return (
    <div className="flex flex-col items-start gap-1">
      <p ref={ref} className={`min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${clamped ? "line-clamp-[8]" : ""} ${className}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="min-h-9 rounded-md text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {expanded ? t("post.description.less") : t("post.description.more")}
        </button>
      )}
    </div>
  );
}
