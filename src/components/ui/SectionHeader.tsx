import Link from "next/link";
import type { ReactNode } from "react";

import { ChevronRightIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

// Phase 17: "제목 + (선택) 전체 보기 링크" pattern shared by every Home
// section (최근 분실물/최근 습득물) and could be reused by any future list
// section with the same shape.
// 다국어(i18n) Phase: `hrefLabel`은 호출자가 넘기지 않으면 "전체 보기"를
// 현재 언어로 보여준다 -- 지금 이 컴포넌트를 쓰는 모든 호출자(Home의 두
// 섹션)가 이 기본값을 그대로 쓴다. `title`은 호출자가 이미 번역해서
// 넘기는 문자열이라 여기서 다시 번역하지 않는다.
export async function SectionHeader({
  title,
  href,
  hrefLabel,
  action,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  action?: ReactNode;
}) {
  const t = await getTranslator();

  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {href ? (
        <Link
          href={href}
          className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {hrefLabel ?? t("common.viewAll")}
          <ChevronRightIcon className="size-4" />
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
