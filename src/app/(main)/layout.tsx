import { redirect } from "next/navigation";

import { Header } from "@/components/layout/Header";
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
      {/* pb-20: clears BottomNav's fixed height on mobile so the last bit
          of page content is never hidden underneath it; md:pb-0 removes
          that reservation once BottomNav itself is hidden (md:hidden). */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-20 md:px-6 md:py-10 md:pb-10">{children}</main>
      <BottomNav unreadChatCount={unreadChat} isAdmin={Boolean(user && isAdmin(user))} />
    </div>
  );
}
