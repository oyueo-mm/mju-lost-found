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
          py-6/md:py-10 here is just this page's own content padding. */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6 md:py-10">{children}</main>
      <Footer />
      <BottomNav unreadChatCount={unreadChat} isAdmin={Boolean(user && isAdmin(user))} />
    </div>
  );
}
