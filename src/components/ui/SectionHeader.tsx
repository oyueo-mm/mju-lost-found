import Link from "next/link";
import type { ReactNode } from "react";

import { ChevronRightIcon } from "@/components/icons";

// Phase 17: "제목 + (선택) 전체 보기 링크" pattern shared by every Home
// section (최근 분실물/최근 습득물) and could be reused by any future list
// section with the same shape.
export function SectionHeader({
  title,
  href,
  hrefLabel = "전체 보기",
  action,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {href ? (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {hrefLabel}
          <ChevronRightIcon className="size-4" />
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
