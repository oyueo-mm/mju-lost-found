"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

export function MobileSearchLink() {
  const { t } = useI18n();
  return (
    <Link href="/search" className="rounded-full px-2 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary md:hidden">
      {t("nav.search")}
    </Link>
  );
}
