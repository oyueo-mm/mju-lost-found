// Phase 17: maps the four real status strings this app ever stores
// (LostPostStatus/FoundPostStatus, see prisma/schema.prisma) to the
// design system's semantic colors -- "in progress" statuses (찾는 중/보관
// 중) read as warning (amber), "resolved" statuses (찾음/완료) read as
// success (green). An unrecognized string (should never happen, but this
// stays defensive rather than crashing on it) falls back to muted/neutral
// instead of guessing a color.
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

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {status}
    </span>
  );
}
