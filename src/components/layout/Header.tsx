import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/notification/service";
import { countUnreadMessagesForUser } from "@/lib/chat/service";
import { isAdmin } from "@/lib/moderation/service";
import { DesktopNav } from "./DesktopNav";
import { NotificationBell } from "./NotificationBell";
import { LogoMark } from "./Logo";
import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";
import { signOut } from "@/lib/auth/auth";
import { DesktopProfileDropdown } from "./DesktopNavDropdown";

async function signOutFromDesktopNav(formData: FormData) {
  "use server";
  void formData;
  await signOut({ redirectTo: "/" });
}

// A Server Component, not a client one: the current user is read here and
// only its nickname/email/unread count ever reach the rendered HTML -- no
// User object is ever serialized into a client bundle for this header.
// Fetching the unread counts here (rather than switching this header to a
// Client Component that polls) keeps that boundary exactly as it was
// before notifications existed -- see Phase 9 spec section 13. Phase 17:
// also renders BottomNav's sibling desktop nav and the chat-unread badge
// (countUnreadMessagesForUser, Phase 17) both surfaces share.
export async function Header() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslator()]);
  const compactProfileLocale = t.locale === "fr" || t.locale === "mn";

  let unreadNotifications = 0;
  let unreadChat = 0;
  if (user) {
    try {
      [unreadNotifications, unreadChat] = await Promise.all([
        getUnreadNotificationCount(user.id),
        countUnreadMessagesForUser(user.id),
      ]);
    } catch (error) {
      // A failed unread-count lookup shouldn't take down every page's
      // header -- the badges just don't show a count this time.
      console.error("Failed to load unread counts", error);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
      {/* Header 정렬 Phase: 임의의 새 최대 폭을 만들지 않고, 이 앱의 모든
          페이지가 이미 쓰는 공통 콘텐츠 폭을 그대로 재사용한다 -- Footer의
          콘텐츠 컨테이너((main)/layout.tsx의 <main>과 정확히 동일:
          `mx-auto w-full max-w-4xl px-4 md:px-6`)와 같은 값이라, Header의
          로고/우측 그룹이 Footer의 브랜드 블록/링크 열과 같은 좌우 기준선
          에서 시작·끝난다. <header> 자체(배경/border)는 이 div 밖에 있어
          화면 전체 폭을 유지한 채, 이 안쪽 콘텐츠만 들어온다.
          md 이상에서는 좌우를 동일한 유동 폭으로, 중앙 nav는 내용
          크기만큼(auto)만 차지하게 해 중앙 nav가 항상 viewport 기준
          정중앙에 오도록 한다(좌우 폭이 다르면 auto 트랙이 한쪽으로
          치우쳐 보인다). 좌우 트랙은 `minmax(0,1fr)`이 아니라
          `minmax(min-content,1fr)`다 -- 0을 하한으로 두면 좌/우 두 트랙이
          자기 콘텐츠 필요 폭과 무관하게 항상 "똑같이" 나뉘어(로고 147px
          vs 우측 115px처럼 필요 폭이 다른데도 동일 분배), 더 넓은 쪽
          (로고)이 부족한 폭만큼 시각적으로 nav를 침범하는 문제가 실제
          768px/2xl+에서 발생했다 -- min-content를 하한으로 주면 각
          트랙이 자기 콘텐츠보다 작아지는 일 자체가 없고, 남는 공간만
          1fr 비율로 나눠 가진다. 모바일은 기존 그대로 flex
          justify-between. */}
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 md:grid md:grid-cols-[minmax(min-content,1fr)_auto_minmax(min-content,1fr)] md:gap-2 md:px-6">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-1.5 font-semibold text-foreground sm:gap-2 md:min-w-0 md:justify-self-start">
          <LogoMark size={32} />
          {/* 브랜드명 통일 Phase: "MYONGJI L&F"는 짧아 모바일(320px)부터
              데스크톱까지 어느 locale/breakpoint에서도 겹치거나 잘리지
              않으므로, 이전의 "숨김" 정책을 모두 제거하고 항상 표시한다.
              가장 좁은 화면(320~400px)에서 알림/프로필과 겹치지 않도록
              글자 크기만 sm 미만에서 한 단계 줄인다. */}
          <span className="whitespace-nowrap text-sm sm:text-base">{t("brand.name")}</span>
        </Link>

        <DesktopNav
          unreadChatCount={unreadChat}
          isAdmin={Boolean(user && isAdmin(user))}
          onSignOut={signOutFromDesktopNav}
        />

        <div className="flex min-w-0 shrink-0 items-center gap-1.5 md:min-w-0 md:justify-self-end">
          {user ? (
            <>
              <NotificationBell unreadCount={unreadNotifications} />
              <DesktopProfileDropdown
                nickname={user.nickname ?? user.email}
                active={false}
                onSignOut={signOutFromDesktopNav}
                compact={compactProfileLocale}
              />
            </>
          ) : (
            <LinkButton href="/login" size="sm">
              {t("nav.login")}
            </LinkButton>
          )}
        </div>
      </div>
    </header>
  );
}
