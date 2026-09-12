import { redirect } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BottomNav } from "@/components/layout/BottomNav";
import { getCurrentUser } from "@/lib/auth/session";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { countUnreadMessagesForUser } from "@/lib/chat/service";
import { isAdmin } from "@/lib/moderation/service";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Phase I section 1: "정지 사용자가 서비스의 일반 기능을 사용할 수 없도록
  // 한다" -- every page under this layout (home, /lost, /found, /post/[id],
  // /chat, /me, /admin, ...) now redirects a currently-suspended, logged-in
  // user to /suspended before rendering anything. /suspended itself lives
  // under the sibling (auth) route group (outside this layout), so this
  // can never loop. A logged-out visitor (user === null) is completely
  // unaffected -- this only ever fires for a real, currently-suspended
  // session, never gates the public browsing this app has always allowed.
  // The server-side blocks this phase's spec also asks to keep (post/
  // comment/chat/upload/report mutations already calling
  // isCurrentlySuspended() themselves) are untouched by this -- this is an
  // *additional*, UI-level wall, not a replacement for those checks.
  if (user && isCurrentlySuspended(user)) {
    redirect("/suspended");
  }

  // Phase 닉네임 필수: "닉네임 설정을 완료하기 전에는 서비스 이용 불가" --
  // every existing *write* path already enforced this via
  // requireReadyUser() (redirect("/onboarding") when nickname is null),
  // but a logged-in, not-yet-onboarded user could still freely browse
  // every public read page under this layout (home, /lost, /found,
  // /search, /post/[id], ...) without ever being routed through
  // onboarding. This closes that gap the same way the suspension check
  // above already does: one blanket redirect for every page this layout
  // wraps, server-side, so it can't be bypassed by only visiting pages
  // that don't call requireReadyUser themselves. /onboarding and
  // /privacy-consent both live under the sibling (auth) route group
  // (outside this layout), so this can never loop -- and onboarding's own
  // page redirects on to /privacy-consent first if consent isn't recorded
  // yet, exactly mirroring requireReadyUser's own check order. A
  // reactivated (previously deactivated) user is never affected here:
  // resolveOrCreateUser() never clears their nickname, so this only ever
  // fires for a genuinely brand-new account.
  if (user && user.nickname === null) {
    redirect("/onboarding");
  }

  let unreadChat = 0;
  if (user) {
    try {
      unreadChat = await countUnreadMessagesForUser(user.id);
    } catch (error) {
      console.error("Failed to load unread chat count", error);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Header />
      {/* Phase 9: BottomNav-clearance padding (pb-20/no-pb on md+) moved
          off this <main> and onto Footer below, now that Footer -- not
          this <main> -- is the last element in the page flow that a fully
          scrolled page can leave sitting under the fixed BottomNav. Plain
          py-6/md:py-10 here is just this page's own content padding.

          Footer 위치 개선 Phase: `flex-1`(이 <main>이 남는 세로 공간을
          차지하고 Footer를 화면 맨 아래로 밀어내는 기존 sticky-footer
          구조)은 그대로다 -- 실제로 데스크톱에서는 이미 의도대로 동작하고
          있었다(콘텐츠가 거의 없는 페이지에서도 Footer가 뷰포트 맨 아래에
          붙는다). 문제는 좁은 화면이었다: Footer의 4칸 grid가 모바일에서
          2칸(브랜드 블록은 2칸 전체)으로 접히면서 Footer 자체 높이가
          500px 안팎까지 커지는데, 그러면 "헤더 + 짧은 콘텐츠 + Footer"
          합계가 이미 화면 높이에 거의 도달해 `flex-1`이 나눠줄 여유
          공간이 사실상 남지 않는다 -- 그래서 /chat처럼 콘텐츠가 적은
          페이지에서 Footer가 첫 화면의 절반 이상을 차지한 채 콘텐츠
          바로 아래에 붙어 보였다(이번에 보고된 증상 그대로).

          그래서 좁은 화면에서만 <main>에 "첫 화면 한 장" 만큼의 최소
          높이를 보장한다 -- 콘텐츠가 그보다 짧아도 <main>이 그 공간을
          차지하므로 Footer는 항상 첫 화면 아래(스크롤해야 닿는 곳)에서
          시작한다. Footer 안에 높이를 늘리기 위한 빈 div를 넣거나
          (이번 작업에서 명시적으로 금지된 방식) Footer의 링크/문구를
          줄이지 않고, 레이아웃 한 줄만 바꾼다.

          --header-height는 globals.css가 이미 정의해 둔 sticky Header의
          실제 높이 토큰이다(Home의 compact 검색 바가 쓰던 것) -- 여기서
          새 매직 넘버를 만들지 않고 그대로 재사용한다. 단위는 vh가 아니라
          dvh: 모바일 브라우저의 주소창이 접혔다 펴질 때 실제로 보이는
          높이를 따라가므로, 주소창이 펼쳐진 상태에서 Footer 윗부분이
          어중간하게 걸쳐 보이는 일이 없다.

          md 이상에서는 min-h-0으로 되돌려 기존 데스크톱 동작을 그대로
          유지한다 -- 그쪽은 원래도 Footer가 뷰포트 맨 아래에 정확히
          붙고 있었고, 거기에까지 이 최소 높이를 적용하면 멀쩡하던
          Footer를 굳이 첫 화면 밖으로 밀어내게 된다. */}
      <main className="mx-auto w-full max-w-4xl min-h-[calc(100dvh-var(--header-height))] flex-1 px-4 py-6 md:min-h-0 md:px-6 md:py-10">
        {children}
      </main>
      <Footer />
      <BottomNav unreadChatCount={unreadChat} isAdmin={Boolean(user && isAdmin(user))} />
    </div>
  );
}
