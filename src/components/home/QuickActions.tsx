import Link from "next/link";

import { BoxIcon, HandboxIcon, PlusIcon } from "@/components/icons";
import { getTranslator } from "@/lib/i18n/server";

// 홈 빠른 기능 바로가기 (Soft Card): 찾아보기 두 곳과 등록 두 곳. 탐색은
// 흰 카드 + 회색 아이콘, 등록은 연한 파란 카드 + 파란 아이콘으로 한눈에
// 구분한다. 모바일 2열, 데스크톱 4열. break-keep keeps Korean words whole;
// overflow-wrap:anywhere still lets a language without spaces (ja, zh) wrap
// at 320px instead of running past the card.
const ACTIONS = [
  { href: "/found", title: "landing.stats.browseFound", desc: "home.quick.found.desc", Icon: HandboxIcon, primary: false },
  { href: "/lost", title: "landing.stats.browseLost", desc: "home.quick.lost.desc", Icon: BoxIcon, primary: false },
  { href: "/lost/new", title: "landing.registerLost", desc: "home.quick.registerLost.desc", Icon: PlusIcon, primary: true },
  { href: "/found/new", title: "landing.registerFound", desc: "home.quick.registerFound.desc", Icon: PlusIcon, primary: true },
] as const;

export async function QuickActions() {
  const t = await getTranslator();
  return (
    <nav aria-label={t("landing.stats.browseFound") + " · " + t("landing.registerLost")} className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
      {ACTIONS.map(({ href, title, desc, Icon, primary }) => (
        <Link
          key={href}
          href={href}
          className={`flex min-h-16 min-w-0 flex-col gap-0.5 rounded-card border px-3.5 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:p-4 ${
            primary ? "border-primary/15 bg-primary-muted hover:border-primary/40" : "border-border bg-card hover:border-foreground/25"
          }`}
        >
          <span className="flex items-center gap-1.5 text-[0.9375rem] font-semibold break-keep [overflow-wrap:anywhere] text-foreground">
            <Icon aria-hidden="true" className={`size-[1.125rem] shrink-0 ${primary ? "text-primary" : "text-muted-foreground"}`} />
            {t(title)}
          </span>
          <span className="text-xs leading-snug break-keep [overflow-wrap:anywhere] text-muted-foreground">{t(desc)}</span>
        </Link>
      ))}
    </nav>
  );
}
