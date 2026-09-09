import Link from "next/link";

import { LogoMark } from "@/components/layout/Logo";

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
const FOOTER_LINK_CLASS = "text-muted-foreground transition-colors hover:text-foreground";

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-8 pb-20 md:px-6 md:pb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex max-w-sm flex-col gap-2">
            <div className="flex items-center gap-2">
              <LogoMark size={24} />
              <span className="text-sm font-semibold text-foreground">명지 스마트 분실물 센터</span>
            </div>
            {/* Deliberately never claims official university operation
                (this phase's own explicit rule) -- describes only what the
                service actually does. */}
            <p className="text-xs text-muted-foreground">
              명지대학교 학생을 위한 분실물 등록·검색·연락 서비스입니다.
            </p>
          </div>

          {/* Phase 11-5: both nav blocks switch from a vertical stack to a
              horizontal, wrapping row from md: up (desktop/tablet) -- was
              flex-col at every width, which read as an unnecessarily tall
              column of links once there was room for a single row. flex-wrap
              keeps it from ever forcing horizontal scroll/overflow if the
              viewport is narrower than the full link list; mobile (<md)
              keeps the original vertical stack unchanged. */}
          <nav aria-label="바로가기" className="flex flex-col gap-1.5 text-xs sm:items-end md:flex-row md:items-center md:flex-wrap md:gap-x-4 md:gap-y-1.5">
            <Link href="/" className={FOOTER_LINK_CLASS}>
              홈
            </Link>
            <Link href="/lost" className={FOOTER_LINK_CLASS}>
              분실물
            </Link>
            <Link href="/found" className={FOOTER_LINK_CLASS}>
              습득물
            </Link>
            <Link href="/search" className={FOOTER_LINK_CLASS}>
              검색
            </Link>
            <Link href="/chat" className={FOOTER_LINK_CLASS}>
              채팅
            </Link>
          </nav>

          <nav aria-label="정책 및 안내" className="flex flex-col gap-1.5 text-xs sm:items-end md:flex-row md:items-center md:flex-wrap md:gap-x-4 md:gap-y-1.5">
            <Link href="/policy/terms" className={FOOTER_LINK_CLASS}>
              이용약관
            </Link>
            <Link href="/policy/privacy" className={FOOTER_LINK_CLASS}>
              개인정보처리방침
            </Link>
            <Link href="/policy/community" className={FOOTER_LINK_CLASS}>
              운영정책
            </Link>
            <Link href="/account-guide" className={FOOTER_LINK_CLASS}>
              계정 안내
            </Link>
          </nav>
        </div>

        {/* No fabricated business registration number/address/phone/
            support email -- none of those exist in this app or its
            operation, and this phase's own rule is not to invent them.
            The only real, in-app way to raise a problem with specific
            content is the existing 신고 기능 (Report), pointed to from
            운영정책 instead of repeated here. */}
        <p className="border-t border-border pt-4 text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} 명지 스마트 분실물 센터. 특정 게시물·메시지·사용자에 대한 문의는
          해당 화면의 신고 기능을 이용해주세요.
        </p>
      </div>
    </footer>
  );
}
