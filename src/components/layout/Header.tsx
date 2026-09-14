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
          <span className="hidden sm:inline">{t("brand.name")}</span>
        </Link>

        <DesktopNav
          unreadChatCount={unreadChat}
          isAdmin={Boolean(user && isAdmin(user))}
          onSignOut={signOutFromDesktopNav}
        />

        <div className="flex shrink-0 items-center gap-1.5">
          {user ? (
            <>
              <NotificationBell unreadCount={unreadNotifications} />
              <DesktopProfileDropdown
                nickname={user.nickname ?? user.email}
                active={false}
                onSignOut={signOutFromDesktopNav}
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
