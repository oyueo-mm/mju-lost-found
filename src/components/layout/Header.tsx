import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/notification/service";
import { countUnreadMessagesForUser } from "@/lib/chat/service";
import { isAdmin } from "@/lib/moderation/service";
import { DesktopNav } from "./DesktopNav";
import { NotificationBell } from "./NotificationBell";
import { LogoMark } from "./Logo";
import { UserIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/Button";

// A Server Component, not a client one: the current user is read here and
// only its nickname/email/unread count ever reach the rendered HTML -- no
// User object is ever serialized into a client bundle for this header.
// Fetching the unread counts here (rather than switching this header to a
// Client Component that polls) keeps that boundary exactly as it was
// before notifications existed -- see Phase 9 spec section 13. Phase 17:
// also renders BottomNav's sibling desktop nav and the chat-unread badge
// (countUnreadMessagesForUser, Phase 17) both surfaces share.
export async function Header() {
  const user = await getCurrentUser();

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
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-foreground">
          <LogoMark size={32} />
          <span className="hidden sm:inline">명지 스마트 분실물 센터</span>
        </Link>

        <DesktopNav unreadChatCount={unreadChat} isAdmin={Boolean(user && isAdmin(user))} />

        <div className="flex shrink-0 items-center gap-1.5">
          {user ? (
            <>
              <NotificationBell unreadCount={unreadNotifications} />
              <Link
                href="/me"
                className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium text-foreground hover:bg-muted"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserIcon className="size-4" />
                </span>
                <span className="hidden max-w-24 truncate sm:inline">{user.nickname ?? user.email}</span>
              </Link>
            </>
          ) : (
            <LinkButton href="/login" size="sm">
              로그인
            </LinkButton>
          )}
        </div>
      </div>
    </header>
  );
}
