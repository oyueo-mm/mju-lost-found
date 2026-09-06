import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { getCurrentUser } from "@/lib/auth/session";
import { countUnreadMessagesForUser } from "@/lib/chat/service";
import { isAdmin } from "@/lib/moderation/service";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
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
      {/* pb-20: clears BottomNav's fixed height on mobile so the last bit
          of page content is never hidden underneath it; md:pb-0 removes
          that reservation once BottomNav itself is hidden (md:hidden). */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 pb-20 md:px-6 md:py-10 md:pb-10">{children}</main>
      <BottomNav unreadChatCount={unreadChat} isAdmin={Boolean(user && isAdmin(user))} />
    </div>
  );
}
