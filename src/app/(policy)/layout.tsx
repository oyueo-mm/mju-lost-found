import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { BottomNav } from "@/components/layout/BottomNav";
import { getCurrentUser } from "@/lib/auth/session";
import { countUnreadMessagesForUser } from "@/lib/chat/service";
import { isAdmin } from "@/lib/moderation/service";

// 필수 동의 게이트 우회 점검 Phase: /policy/terms, /policy/community,
// /policy/privacy need to stay readable in *every* account state --
// logged out, not yet consented, not yet onboarded, or suspended -- per
// this phase's own explicit requirement. (main)/layout.tsx enforces all
// three of those gates as a blanket redirect for everything it wraps, and
// pulling these three pages out into their own route group (this file)
// is what actually keeps them out of that gate's reach, rather than
// carving a pathname exception into (main)/layout.tsx's own check (which
// this phase's instructions explicitly ask to avoid in favor of a
// structural fix). Route groups like this one don't add a URL segment --
// /policy/terms is served by src/app/(policy)/policy/terms/page.tsx
// exactly the same way it used to be served from
// src/app/(main)/policy/terms/page.tsx, just without inheriting
// (main)'s gates.
//
// Otherwise a near-duplicate of (main)/layout.tsx's own render: same
// Header/Footer/BottomNav shell, same unread-chat-count/isAdmin wiring
// for a signed-in visitor (so the header/bottom nav look identical to
// every other page), just with none of that layout's redirect() calls --
// this layout never blocks rendering for any reason.
export default async function PolicyLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

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
      <main className="mx-auto w-full max-w-4xl min-h-[calc(100dvh-var(--header-height))] flex-1 px-4 py-6 md:min-h-0 md:px-6 md:py-10">
        {children}
      </main>
      <Footer />
      <BottomNav unreadChatCount={unreadChat} isAdmin={Boolean(user && isAdmin(user))} />
    </div>
  );
}
