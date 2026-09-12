import Link from "next/link";
import { getSessionUser, isEmailPermitted, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unreadMessageCount, pendingReportCount } from "@/lib/alerts";
import { unreadGroupCount } from "@/lib/notif-group";
import { getT } from "@/i18n/server";
import LogoMark from "./LogoMark";
import NotificationBell from "./NotificationBell";
import NavMenu from "./NavMenu";

export default async function Header() {
  const t = await getT();
  const session = await getSessionUser();
  const loggedIn = Boolean(
    session &&
      (await isEmailPermitted(session.user.email)) &&
      session.profile?.nickname,
  );

  let unreadNotif = 0;
  let chatUnread = 0;
  let pendingReports = 0;
  let openInquiries = 0;
  const staff = loggedIn && isStaff(session.profile);

  if (loggedIn) {
    try {
      const admin = staff ? createAdminClient() : null;
      const [{ data: unread }, cu, pr, oi] = await Promise.all([
        session.supabase
          .from("notifications")
          .select("id, type, link, is_read, created_at")
          .eq("user_id", session.user.id)
          .eq("is_read", false)
          .order("created_at", { ascending: false })
          .limit(100),
        unreadMessageCount(session.supabase, session.user.id),
        staff ? pendingReportCount(admin) : Promise.resolve(0),
        staff
          ? admin
              .from("inquiries")
              .select("id", { count: "exact", head: true })
              .eq("status", "open")
              .then(({ count }) => count || 0)
          : Promise.resolve(0),
      ]);
      unreadNotif = unreadGroupCount(unread || []);
      chatUnread = cu;
      pendingReports = pr;
      openInquiries = oi;
    } catch {
      /* 테이블 없을 수 있음 */
    }
  }

  // 마우스만 올려도 펼쳐지는 드롭다운 (NavMenu). items 없는 항목은 그냥 링크.
  const navItems = [
    {
      href: "/",
      label: t("nav.board"),
      items: [
        { href: "/", icon: "package", label: t("nav.found"), desc: t("nav.foundDesc") },
        { href: "/?tab=lost", icon: "search", label: t("nav.lost"), desc: t("nav.lostDesc") },
        "divider",
        { href: "/found/new", icon: "plus", label: t("nav.foundNew") },
        { href: "/lost/new", icon: "plus", label: t("nav.lostNew") },
      ],
    },
    {
      href: "/search",
      label: t("nav.search"),
      items: [
        { href: "/search", icon: "sparkle", label: t("nav.aiSearch"), desc: t("nav.aiSearchDesc") },
        { href: "/search?mode=image", icon: "camera", label: t("nav.imageSearch"), desc: t("nav.imageSearchDesc") },
      ],
    },
    ...(loggedIn
      ? [
          { href: "/chat", label: t("nav.chat"), badge: chatUnread },
          {
            href: "/my",
            label: t("nav.my"),
            items: [
              { href: "/my", icon: "user", label: t("nav.my") },
              { href: "/my/posts", icon: "text", label: t("nav.myPosts") },
              { href: "/notifications", icon: "bell", label: t("nav.notifications"), badge: unreadNotif },
              { href: "/my/inquiries", icon: "chat", label: t("nav.inquiries") },
              "divider",
              { form: "/auth/signout", icon: "logout", label: t("common.logout") },
            ],
          },
        ]
      : []),
    ...(staff
      ? [
          {
            href: "/admin",
            label: t("nav.admin"),
            badge: pendingReports + openInquiries,
            items: [
              { href: "/admin/reports", icon: "shield", label: t("nav.adminReports"), badge: pendingReports },
              { href: "/admin/inquiries", icon: "chat", label: t("nav.adminInquiries"), badge: openInquiries },
              { href: "/admin/posts", icon: "text", label: t("nav.adminPosts") },
              { href: "/admin/users", icon: "user", label: t("nav.adminUsers") },
              { href: "/admin/notice", icon: "bell", label: t("nav.adminNotice") },
            ],
          },
        ]
      : []),
  ];

  // 브랜드명: 앞부분 일반, 뒷부분 파란색 ("명지 분실물센터" / "MJU Lost & Found")
  const brandA = t("brand.a");
  const brandB = t("brand.b");

  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <LogoMark size={28} />
          <span className="whitespace-nowrap text-[15px] font-extrabold tracking-tight">
            {brandA}
            {brandB && (
              <>
                {" "}
                <span className="text-brand">{brandB}</span>
              </>
            )}
          </span>
        </Link>

        <nav className="hidden items-center gap-0.5 text-sm font-medium text-ink-soft sm:flex">
          {navItems.map((it) => (
            <NavMenu key={it.href} {...it} />
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 text-sm sm:gap-1.5">
          {loggedIn ? (
            <>
              <NotificationBell
                userId={session.user.id}
                initialCount={unreadNotif}
              />
              <Link
                href="/my"
                aria-label={t("nav.my")}
                title={session.profile?.nickname || t("nav.my")}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-extrabold text-white transition hover:bg-brand-strong"
              >
                {session.profile?.nickname?.[0] || "명"}
              </Link>
              <form action="/auth/signout" method="post" className="hidden sm:block">
                <button
                  type="submit"
                  className="rounded-full px-2 py-1 text-ink-faint transition hover:text-ink"
                >
                  {t("common.logout")}
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn btn-primary px-4 py-2 text-sm">
              {t("common.login")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
