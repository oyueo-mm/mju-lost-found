"use client";

import { useT } from "@/i18n/client";

const STYLES = {
  "찾는 중": "bg-brand-tint text-brand-deep",
  찾음: "bg-sunken text-ink-faint",
  "보관 중": "bg-brand-tint text-brand-deep",
  완료: "bg-sunken text-ink-faint",
};

// DB 에는 한국어 상태값이 저장되고, 표시만 현재 언어로.
export default function StatusBadge({ status }) {
  const t = useT();
  return (
    <span className={`chip ${STYLES[status] || "bg-sunken text-ink-soft"}`}>
      {t(`status.${status}`)}
    </span>
  );
}
