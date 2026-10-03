"use client";

import { useI18n } from "@/lib/i18n/client";

// Shown next to the name of an admin-approved external account
// (User.userType EXTERNAL_VERIFIED) so other users can tell they're talking
// to verified campus staff / a partner rather than a student. Never shown
// for @mju.ac.kr (STUDENT) or test-mode accounts.
export function ExternalVerifiedBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
      {t("user.badge.externalVerified")}
    </span>
  );
}
