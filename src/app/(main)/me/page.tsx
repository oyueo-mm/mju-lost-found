import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/auth";
import { getUnreadNotificationCount } from "@/lib/notification/service";
import { isAdmin } from "@/lib/moderation/service";
import { UserIcon, ChevronRightIcon, BellIcon, ShieldIcon, LogoutIcon } from "@/components/icons";
import type { ReactNode } from "react";

// Phase 17: "내 정보" -- the hub this phase's Navigation redesign
// consolidates every personal-account feature into (내 게시물/매칭/알림/
// 관리자/로그아웃), matching the exact structure this phase's own spec
// lays out (section 6-5/7). None of the linked pages were rebuilt or
// moved -- /posts/mine, /matches, /notifications, /admin/reports all keep
// their existing routes/behavior unchanged; this page only adds a single
// front door to them plus a profile summary and sign-out, none of which
// existed as a combined page before.
function MenuRow({ href, icon, label, meta }: { href: string; icon: ReactNode; label: string; meta?: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b border-border px-4 py-3.5 text-sm transition-colors last:border-b-0 hover:bg-muted"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1 font-medium text-foreground">{label}</span>
      {meta}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default async function MePage() {
  // "mypost" is the closest existing LoginReason to this personal-account
  // hub -- no new reason was added just for this page (see
  // src/lib/auth/session.ts's own comment on why that union stays closed).
  const user = await requireReadyUser("mypost", "/me");

  let unreadNotifications = 0;
  try {
    unreadNotifications = await getUnreadNotificationCount(user.id);
  } catch (error) {
    console.error("Failed to load unread notification count", error);
  }

  const admin = isAdmin(user);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">내 정보</h1>

      <section className="flex items-center gap-4 rounded-card border border-border bg-card p-5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <UserIcon className="size-7" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">{user.nickname ?? "닉네임 미설정"}</span>
          <span className="text-sm text-muted-foreground">{user.email}</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-card border border-border bg-card">
        <MenuRow href="/posts/mine" icon={<UserIcon className="size-4.5" />} label="내 게시물" />
        <MenuRow href="/matches" icon={<ShieldIcon className="size-4.5" />} label="매칭" />
        <MenuRow
          href="/notifications"
          icon={<BellIcon className="size-4.5" />}
          label="알림"
          meta={
            unreadNotifications > 0 && (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                {unreadNotifications}
              </span>
            )
          }
        />
      </section>

      {admin && (
        <section className="overflow-hidden rounded-card border border-primary/30 bg-card">
          <MenuRow href="/admin" icon={<ShieldIcon className="size-4.5 text-primary" />} label="관리자 센터" />
        </section>
      )}

      <form
        action={async () => {
          "use server";
          // Phase 31: explicit, rather than relying on next-auth's default
          // (redirect back to the current page) -- signOut() from /me
          // would otherwise land back on /me, which requireReadyUser()
          // immediately bounces to /login since there's no session left.
          // Landing on "/" instead shows LandingHero (see Home()'s own
          // !user branch), which is the intended logged-out experience.
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-card border border-border bg-card px-4 py-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
        >
          <LogoutIcon className="size-4.5" />
          로그아웃
        </button>
      </form>
    </div>
  );
}
