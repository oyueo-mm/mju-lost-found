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

// Footer 구조 개선 Phase: 예전에는 링크 6개짜리 "바로가기" nav 하나와
// 6개짜리 "도움말" nav 하나, 이렇게 라벨 없는 두 묶음이 나란히 있었다 --
// 이제는 제목이 있는 여러 섹션으로 나눠 각 섹션이 무엇을 모아둔 것인지
// 한눈에 보이게 한다. href/문구는 하나도 바꾸지 않았고("검색" ->
// "AI 검색"은 라벨 텍스트만 바뀐 것, 여전히 /search 그대로), 순서만
// 이 세 섹션으로 재배치했다. 새 링크는 "알림"(/notifications) 하나뿐 --
// 이미 실제로 존재하는 페이지이고, 이 앱에 없는 정보(GitHub 저장소 링크,
// 실제 연락처 등)를 지어내지는 않는다(아래 저작권 문구 옆 주석 참고,
// 이 파일이 처음 만들어질 때부터 있던 원칙 그대로).
const FOOTER_SECTIONS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "서비스",
    links: [
      { href: "/", label: "홈" },
      { href: "/lost", label: "분실물 보기" },
      { href: "/found", label: "습득물 보기" },
      { href: "/search", label: "AI 검색" },
      { href: "/organizations", label: "단체" },
    ],
  },
  {
    title: "커뮤니티",
    links: [
      { href: "/chat", label: "채팅" },
      { href: "/notifications", label: "알림" },
    ],
  },
  {
    title: "안내",
    links: [
      { href: "/policy/terms", label: "이용약관" },
      { href: "/policy/privacy", label: "개인정보처리방침" },
      { href: "/policy/community", label: "운영정책" },
      { href: "/account-guide", label: "계정 안내" },
      { href: "/feedback", label: "서비스 개선 제안" },
      { href: "/organizations/guide", label: "단체 이용 안내" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-8 pb-20 md:px-6 md:pb-8">
        {/* Footer 구조 개선 Phase: 브랜드 블록 + 섹션들을 하나의 grid로 묶어
            데스크톱(md 이상)에서는 4칸이 한 줄로 나란히("가로 배치"), 그보다
            좁은 화면에서는 2칸씩 자연스럽게 다음 줄로 넘어간다("2열 또는
            1열로 wrapping") -- 브랜드 블록만 모바일에서 2칸을 다 차지하게
            해(col-span-2) 짧은 링크 묶음들과 나란히 눌리지 않도록 했다. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4 md:gap-x-8">
          <div className="col-span-2 flex max-w-sm flex-col gap-2 md:col-span-1">
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
            {/* Phase 12-9 §5: explicit "이 학교 공식 서비스가 아니다" +
                "학생이 자발적으로 만들었다" 고지 -- 학교 로고/브랜드는 이
                텍스트 한 줄 외에 새로 추가하지 않는다. 실제로 확인된 팀원
                이름/연락처가 없으므로(현재 프로젝트에 공개하기로 정해진
                정보 없음) 구체적인 개인정보는 넣지 않고, "학생이 만들었다"는
                사실만 표시한다. */}
            <p className="text-xs text-muted-foreground">
              명지대학교 학생들이 자발적으로 제작한 프로젝트이며, 명지대학교가 공식적으로 운영하는 서비스가 아닙니다.
            </p>
            <p className="text-[11px] text-muted-foreground/80">Created by MJU students</p>
          </div>

          {/* Footer 구조 개선 Phase: 섹션 제목(text-foreground, font-semibold)이
              그 아래 링크(text-muted-foreground, 더 작은 굵기)보다 뚜렷하게
              강조되도록 위계를 나눴다 -- 이전에는 두 nav 모두 제목 없이
              링크만 나열돼 있었다. 링크는 항상 세로로 쌓인다(가로 wrap이던
              이전 md: 레이아웃과 다른 점) -- 섹션 자체가 이미 grid로 가로
              배치되므로, 섹션 "안" 링크까지 가로로 흐르면 어느 링크가 어느
              섹션 소속인지 다시 헷갈리게 된다. */}
          {FOOTER_SECTIONS.map((section) => (
            <div key={section.title} className="flex flex-col gap-2.5">
              <h3 className="text-xs font-semibold text-foreground">{section.title}</h3>
              <nav aria-label={section.title} className="flex flex-col gap-1.5 text-xs">
                {section.links.map((link) => (
                  <Link key={link.href} href={link.href} className={FOOTER_LINK_CLASS}>
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
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
