"use client";

import { KIND_CONFIG } from "@/lib/constants";
import { useT } from "@/i18n/client";

// 게시물 종류 태그 — 습득(앰버) / 분실(블루). 어디서나 동일하게.
export default function KindTag({ kind, className = "" }) {
  const t = useT();
  const cfg = KIND_CONFIG[kind];
  if (!cfg) return null;
  const tone =
    kind === "found"
      ? "bg-amber-tint text-amber-deep"
      : "bg-brand-tint text-brand-deep";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-bold leading-none ${tone} ${className}`}
    >
      {t(`kind.${kind}`)}
    </span>
  );
}
