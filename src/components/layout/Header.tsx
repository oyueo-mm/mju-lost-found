import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/auth";
import { getUnreadNotificationCount } from "@/lib/notification/service";

const NAV_LINKS = [
  { href: "/", label: "홈" },
  { href: "/lost", label: "분실물" },
  { href: "/found", label: "습득물" },
  { href: "/search", label: "검색" },
] as const;

// A Server Component, not a client one: the current user is read here and
// only its nickname/email/unread count ever reach the rendered HTML -- no
// User object is ever serialized into a client bundle for this header.
// Fetching the unread count here (rather than switching this header to a
// Client Component that polls) keeps that boundary exactly as it was
// before notifications existed -- see Phase 9 spec section 13.
export async function Header() {
  const user = await getCurrentUser();

  let unreadCount = 0;
  if (user) {
    try {
      unreadCount = await getUnreadNotificationCount(user.id);
    } catch (error) {
      // A failed unread-count lookup shouldn't take down every page's
      // header -- the badge just doesn't show a count this time.
      console.error("Failed to load unread notification count", error);
    }
  }

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold text-zinc-900 dark:text-zinc-50">
          명지 스마트 분실물 센터
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-zinc-900 dark:hover:text-zinc-50">
              {link.label}
            </Link>
          ))}
          {user && (
            <Link href="/notifications" className="hover:text-zinc-900 dark:hover:text-zinc-50">
              알림{unreadCount > 0 ? ` (${unreadCount})` : ""}
            </Link>
          )}
          {user ? (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">
                {user.nickname ?? user.email}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <button
                  type="submit"
                  className="rounded-full border border-zinc-300 px-3 py-1 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
                >
                  로그아웃
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-zinc-300 px-3 py-1 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
            >
              로그인
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
