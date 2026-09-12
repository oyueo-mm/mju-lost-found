"use client";

// Phase 17: maps the four real status strings this app ever stores
// (LostPostStatus/FoundPostStatus, see prisma/schema.prisma) to the
// design system's semantic colors -- "in progress" statuses (찾는 중/보관
// 중) read as warning (amber), "resolved" statuses (찾음/완료) read as
// success (green). An unrecognized string (should never happen, but this
// stays defensive rather than crashing on it) falls back to muted/neutral
// instead of guessing a color.
import { useI18n } from "@/lib/i18n/client";
import { statusLabelKeyOrNull } from "@/lib/i18n/labels";

const STATUS_TONE: Record<string, "warning" | "success"> = {
  "찾는 중": "warning",
  "찾음": "success",
  "보관 중": "warning",
  "완료": "success",
};

const TONE_CLASSES = {
  warning: "bg-warning-muted text-warning",
  success: "bg-success-muted text-success",
  neutral: "bg-muted text-muted-foreground",
} as const;

// 다국어(i18n) Phase: `status` prop은 계속 DB에 저장된 한국어 원문을
// 받는다(색상 결정도 그 값으로 한다) -- 눈에 보이는 글자만 번역한다.
// 목록에 없는 값은 기존처럼 원문을 그대로 보여준다(중립 색상과 같은
// 방어적 처리).
export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const { t } = useI18n();
  const tone = STATUS_TONE[status] ?? "neutral";
  const labelKey = statusLabelKeyOrNull(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {labelKey ? t(labelKey) : status}
    </span>
  );
}
