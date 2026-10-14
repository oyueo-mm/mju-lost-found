import Link from "next/link";

import { LogoMark } from "@/components/layout/Logo";
import { LocaleSwitcher } from "@/components/layout/LocaleSwitcher";
import { FooterSections } from "@/components/layout/FooterSections";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";
import { DEVELOPER_EMAIL, DEVELOPER_MAILTO, REPOSITORY_URL, SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact";

// Phase 9: this app's first Footer -- there was none before (checked
// before writing this). Placed in (main)/layout.tsx, after <main> and
// before BottomNav, so it appears on every page that already gets the
// shared Header/BottomNav shell (home, /lost, /found, /post/[id], /chat,
// /me, /admin, ...) -- the (auth) route group (login/onboarding/privacy-
// consent/suspended/account-guide) has no shared layout at all and stays
// untouched, same as it's always been.
//
// Deliberately plain, not a Card: a footer is a page-level chrome element
// (same visual role as Header above it), not a piece of content floating
// inside the page -- wrapping it in `rounded-card border bg-card` would
// make it look like one more content card instead of the shared shell it
// actually is. It reuses only existing semantic tokens (bg-background,
// border-border, text-muted-foreground, text-primary, ...), the same
// `max-w-4xl` content width every page under (main) already uses, and no
// new colors/shadows/animation of its own.
//
// pb-20 (mobile) / md:pb-8: BottomNav is `fixed inset-x-0 bottom-0` (see
// that component), so whatever is at the very bottom of a fully-scrolled
// page needs its own clearance from it -- exactly the same reasoning
// (main)/layout.tsx's own `<main>` already uses `pb-20 md:pb-0` for.
const FOOTER_LINK_CLASS =
  "text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

// Footer 구조 개선 Phase: 예전에는 링크 6개짜리 "바로가기" nav 하나와
// 6개짜리 "도움말" nav 하나, 이렇게 라벨 없는 두 묶음이 나란히 있었다 --
// 이제는 제목이 있는 여러 섹션으로 나눠 각 섹션이 무엇을 모아둔 것인지
// 한눈에 보이게 한다. href/문구는 하나도 바꾸지 않았고("검색" ->
// "AI 검색"은 라벨 텍스트만 바뀐 것, 여전히 /search 그대로), 순서만
// 이 세 섹션으로 재배치했다. 새 링크는 "알림"(/notifications) 하나뿐 --
// 이미 실제로 존재하는 페이지이고, 이 앱에 없는 정보(GitHub 저장소 링크,
// 실제 연락처 등)를 지어내지는 않는다(아래 저작권 문구 옆 주석 참고,
// 이 파일이 처음 만들어질 때부터 있던 원칙 그대로).
//
// 다국어(i18n) Phase: 섹션 제목/링크 라벨이 이제 하드코딩된 한국어
// 문자열이 아니라 번역 키다 -- href와 순서, 섹션 구성은 하나도 바꾸지
// 않았다(이번 작업의 "Footer의 기존 링크와 안내 문구는 임의로 삭제하거나
// 변경하지 않는다" 제약 그대로). 한국어로 볼 때 나오는 문구도 예전과
// 글자 하나까지 동일하다(messages/ko.ts).
//
// Footer 안내 섹션 정리 Phase: "안내"에는 이용약관/개인정보처리방침/
// 운영정책(정책 문서)과 계정 안내/단체 이용 안내/서비스 개선 제안(사용자
// 도움말)이 성격이 다른데도 함께 있었다 -- 정책 문서 3개는 legalLinks로
// 따로 빼서 아래 FooterSections의 기존 정책 링크 영역(이전에는 모바일
// 전용, 이번에 데스크톱까지 재사용)에만 두고, 이 섹션에는 도움말 성격의
// 3개만 남긴다. href/라벨 텍스트는 하나도 바꾸지 않았다 -- 정책 링크
// 3개가 안내 섹션과 legalLinks 양쪽에 동시에 나타나던 모바일 아코디언의
// 중복도 이 분리로 함께 없어진다. (Footer 레이아웃 정리 Phase부터 정책
// 링크는 FooterSections가 아니라 이 파일의 하단 줄에서 직접 그린다.)
const FOOTER_SECTIONS: { titleKey: TranslationKey; links: { href: string; labelKey: TranslationKey }[] }[] = [
  {
    titleKey: "footer.section.service",
    links: [
      { href: "/", labelKey: "footer.link.home" },
      { href: "/lost", labelKey: "footer.link.lost" },
      { href: "/found", labelKey: "footer.link.found" },
      { href: "/search", labelKey: "footer.link.aiSearch" },
      { href: "/organizations", labelKey: "footer.link.organizations" },
    ],
  },
  {
    titleKey: "footer.section.community",
    links: [
      { href: "/chat", labelKey: "footer.link.chat" },
      { href: "/notifications", labelKey: "footer.link.notifications" },
    ],
  },
  {
    titleKey: "footer.section.guide",
    links: [
      { href: "/account-guide", labelKey: "footer.link.accountGuide" },
      { href: "/organizations/guide", labelKey: "footer.link.organizationGuide" },
      { href: "/feedback", labelKey: "footer.link.feedback" },
    ],
  },
];

// 안내 섹션에서 분리된 정책 문서 3개 -- href/라벨/순서 모두 예전 안내
// 섹션 안에 있던 그대로다.
const LEGAL_LINKS: { href: string; labelKey: TranslationKey }[] = [
  { href: "/policy/terms", labelKey: "footer.link.terms" },
  { href: "/policy/privacy", labelKey: "footer.link.privacy" },
  { href: "/policy/community", labelKey: "footer.link.community" },
];

export async function Footer() {
  const t = await getTranslator();
  const localizedSections = FOOTER_SECTIONS.map((section) => ({
    title: t(section.titleKey),
    links: section.links.map((link) => ({ href: link.href, label: t(link.labelKey) })),
  }));
  const legalLinks = LEGAL_LINKS.map((link) => ({ href: link.href, label: t(link.labelKey) }));

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-8 pb-20 md:px-6 md:pb-8">
        {/* Footer 레이아웃 정리 Phase: 위에서부터 세 줄 -- (1) 브랜드 소개 +
            서비스/커뮤니티/안내 메뉴, (2) 연락처 3개, (3) 정책 링크·언어
            선택·저작권. 예전에는 연락처/GitHub/약관까지 브랜드 칸 하나에
            몰려 왼쪽만 길고 오른쪽은 비어 있었다. 데스크톱에서는 브랜드 칸을
            조금 넓게 두고 메뉴 3개를 나란히, 모바일에서는 브랜드 블록 아래로
            메뉴(FooterSections 아코디언)가 이어진다. */}
        <div className="grid gap-8 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] md:gap-x-8">
          <div className="flex max-w-sm flex-col gap-2">
            <div className="flex items-center gap-2">
              <LogoMark size={24} />
              <span className="text-sm font-semibold text-foreground">{t("brand.name")}</span>
            </div>
            {/* Deliberately never claims official university operation --
                describes only what the service actually does. 한 줄 소개는
                이제 모든 화면 크기에서 한 번만 나온다(모바일에서 브랜드명을
                한 번 더 적던 중복 문구는 없앴다). */}
            <p className="text-xs text-muted-foreground">{t("footer.tagline")}</p>
            {/* Phase 12-9 §5: "이 학교 공식 서비스가 아니다" + "학생이
                개발·운영한다" 고지 -- 모든 화면 크기에서 보인다. 같은 사실을
                되풀이하던 "Created by MJU students" 줄은 이 문장과 중복이라
                뺐다. */}
            <p className="text-xs text-muted-foreground">{t("footer.disclaimer")}</p>
          </div>

          {/* 섹션 제목(text-foreground, font-semibold)이 그 아래 링크보다
              뚜렷하게 강조되고, 섹션 안 링크는 항상 세로로 쌓인다 -- 섹션이
              이미 가로로 놓이므로 링크까지 가로로 흐르면 소속이 헷갈린다.
              모바일에서는 아래 FooterSections 아코디언이 같은 목록을 보여준다. */}
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.titleKey} className="hidden flex-col gap-2.5 md:flex">
              <h3 className="text-xs font-semibold text-foreground">{t(section.titleKey)}</h3>
              <nav aria-label={t(section.titleKey)} className="flex flex-col gap-1.5 text-xs">
                {section.links.map((link) => (
                  <Link key={link.href} href={link.href} prefetch={false} className={FOOTER_LINK_CLASS}>
                    {t(link.labelKey)}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <FooterSections sections={localizedSections} />

        {/* 연락처: 운영팀 (the privacy policy's contact address, lib/contact.ts),
            개발자, and the public repository -- 데스크톱에서는 세 칸이 한 줄로,
            모바일에서는 세로로 쌓인다. 로그인하지 않은 방문자도 연락할 수 있게
            모든 화면 크기에서 보인다. 모바일에서는 바로 위 아코디언의 마지막
            구분선이 경계 역할을 하므로 상단 선은 데스크톱에서만 긋는다. */}
        <dl className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3 md:gap-8 md:border-t md:border-border md:pt-6">
          {[
            { label: t("footer.contact"), href: SUPPORT_MAILTO, text: SUPPORT_EMAIL },
            { label: t("footer.developerContact"), href: DEVELOPER_MAILTO, text: DEVELOPER_EMAIL },
            { label: "GitHub", href: REPOSITORY_URL, text: "oyueo-mm/mju-lost-found", external: true },
          ].map((c) => (
            <div key={c.href} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[11px]">{c.label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                <a
                  href={c.href}
                  {...(c.external ? { target: "_blank", rel: "noopener noreferrer", "aria-label": t("footer.github") } : {})}
                  className="text-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {c.text}
                </a>
              </dd>
            </div>
          ))}
        </dl>

        {/* 하단: 정책 링크 -> 언어 선택 -> 저작권. 데스크톱에서는 정책
            링크(왼쪽)와 언어 선택(오른쪽)이 한 줄에 놓이고 저작권이 그 아래,
            모바일에서는 이 순서대로 세로로 쌓인다. 언어 선택은 "설정
            컨트롤"이라 링크 목록인 메뉴 grid와는 계속 따로 둔다(i18n Phase §8). */}
        <div className="flex flex-col gap-4 border-t border-border pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
            <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {legalLinks.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false} className={FOOTER_LINK_CLASS}>
                  {link.label}
                </Link>
              ))}
            </nav>
            <LocaleSwitcher />
          </div>

          {/* No fabricated business registration number/address/phone --
              none of those exist in this app or its operation. The real
              contacts are listed above; problems with specific content still
              go through the in-app 신고 기능 (Report), pointed to from 운영정책. */}
          <p className="text-[11px] text-muted-foreground">
            {t("footer.copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
