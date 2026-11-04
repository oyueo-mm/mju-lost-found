"use client";

import { useI18n } from "@/lib/i18n/client";
import { THANK_TAGS, type ThankTag } from "@/lib/thanks/eligibility";

// The 칭찬 태그 a 감사 후기 carries, read-only (chat cards, 받은 감사 후기, the
// public profile). Unknown codes are ignored; nothing renders without tags.
export function ThankTagList({ tags }: { tags: readonly string[] }) {
  const { t } = useI18n();
  const shown = THANK_TAGS.filter((code) => tags.includes(code));
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("thanks.tags.question")}>
      {shown.map((code: ThankTag) => (
        <li key={code} className="rounded-full bg-primary-muted px-2.5 py-0.5 text-xs font-medium break-keep text-primary">
          {t(`thanks.tag.${code}`)}
        </li>
      ))}
    </ul>
  );
}
