import Link from "next/link";

import { requireReadyUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/auth";
import { getUnreadNotificationCount } from "@/lib/notification/service";
import { isAdmin } from "@/lib/moderation/service";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { UserIcon, ChevronRightIcon, BellIcon, ShieldIcon, LogoutIcon, ChatBubbleIcon, PlusIcon } from "@/components/icons";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { InstallAppPrompt } from "@/components/settings/InstallAppPrompt";
import { NicknameSettings } from "@/components/settings/NicknameSettings";
import { CopyPublicId } from "@/components/settings/CopyPublicId";
import type { ReactNode } from "react";

// Phase 17: "내 정보" -- the hub this phase's Navigation redesign
// consolidates every personal-account feature into (내 게시물/알림/
// 관리자/로그아웃), matching the exact structure this phase's own spec
// lays out (section 6-5/7). None of the linked pages were rebuilt or
// moved -- /posts/mine, /notifications, /admin/reports all keep their
// existing routes/behavior unchanged; this page only adds a single front
// door to them plus a profile summary and sign-out, none of which existed
// as a combined page before. Phase J-2 dropped the 매칭 row along with the
// Match domain (/matches no longer exists).
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

  let myOrganizations: Awaited<ReturnType<typeof getMyOrganizationMemberships>> = [];
  try {
    myOrganizations = await getMyOrganizationMemberships(user.id);
  } catch (error) {
    console.error("Failed to load organization memberships", error);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">내 정보</h1>

      <section className="flex items-center gap-4 rounded-card border border-border bg-card p-5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <UserIcon className="size-7" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-foreground">{user.nickname ?? "닉네임 미설정"}</span>
          <span className="text-sm text-muted-foreground">{user.email}</span>
          {/* Phase I section 6: same publicId /profile/[publicId] already
              shows -- User.id itself is never rendered anywhere, here or
              on the public profile (see user/service.ts's own
              PublicProfileDTO comment). */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className="truncate text-xs text-muted-foreground">ID: {user.publicId}</span>
            <CopyPublicId publicId={user.publicId} />
          </div>
        </div>
      </section>

      {/* Phase H-7: nickname is set once during onboarding (see
          onboarding/NicknameForm.tsx) but can now be changed any number of
          times from here -- duplicate nicknames are allowed by design (see
          NicknameSettings/actions.ts's own comments), so this never blocks
          on a uniqueness conflict the way onboarding's initial set did.
          Phase I section 7: now also cooldown-gated -- see
          NicknameSettings/me/actions.ts's own comments. */}
      <NicknameSettings currentNickname={user.nickname ?? ""} nicknameChangeAvailableAt={user.nicknameChangeAvailableAt} />

      {/* Phase H-8: "내 활동" -- 내가 쓴 게시글(기존 /posts/mine, 라벨만 통일) +
          내가 쓴 댓글(신규 /me/comments). 두 페이지 모두 세션의 본인 id만 사용,
          기존 권한/데이터는 그대로. */}
      <p className="px-1 text-xs font-medium text-muted-foreground">내 활동</p>
      <section className="overflow-hidden rounded-card border border-border bg-card">
        <MenuRow href="/posts/mine" icon={<UserIcon className="size-4.5" />} label="내가 쓴 게시글" />
        <MenuRow href="/me/comments" icon={<ChatBubbleIcon className="size-4.5" />} label="내가 쓴 댓글" />
        {/* Phase 11-5: "서비스 개선 제안" -- 제출 폼과 "내가 보낸 의견" 목록이
            함께 있는 /feedback으로 연결. Report(신고)와 혼동하지 않도록
            별도 아이콘/문구를 쓴다. */}
        <MenuRow href="/feedback" icon={<ChatBubbleIcon className="size-4.5" />} label="서비스 개선 제안" />
        {/* Phase 12-4: 단체 목록 -- 가입 신청은 이 목록에서 개별 단체 프로필로
            들어가 진행한다(§4/§6). */}
        <MenuRow href="/organizations" icon={<ShieldIcon className="size-4.5" />} label="단체 목록" />
        {/* Phase 12-3: 단체 생성 신청 -- /organizations/create가 폼과 대기
            중인 신청 상태를 함께 보여주므로 별도의 "내 신청 목록" 페이지는
            만들지 않는다. */}
        <MenuRow href="/organizations/create" icon={<PlusIcon className="size-4.5" />} label="단체 생성 신청" />
      </section>

      {/* Phase 12-4 §23: 내가 가입한 단체 -- 단체명/역할/상태만 노출하고
          클릭하면 해당 단체 프로필로 이동한다. 멤버십이 없으면 섹션 자체를
          숨긴다(admin 센터 섹션과 동일하게 조건부 렌더링). */}
      {myOrganizations.length > 0 && (
        <>
          <p className="px-1 text-xs font-medium text-muted-foreground">내 단체</p>
          <section className="overflow-hidden rounded-card border border-border bg-card">
            {myOrganizations.map((membership) => (
              <MenuRow
                key={membership.organizationId}
                href={`/organizations/${membership.organizationId}`}
                icon={<ShieldIcon className="size-4.5" />}
                label={membership.organizationName}
                meta={
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {membership.role === "leader" ? "대표 관리자" : membership.role === "admin" ? "관리자" : "구성원"}
                    {membership.organizationStatus === "inactive" ? " · 비활성" : ""}
                  </span>
                }
              />
            ))}
          </section>
        </>
      )}

      <section className="overflow-hidden rounded-card border border-border bg-card">
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

      <InstallAppPrompt />

      <ThemeSettings />

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

      {/* Phase 10: small, quiet text link -- not a MenuRow, not styled to
          draw the eye the way the rest of this page's menu sections are.
          The actual confirmation (checkbox + destructive button) lives on
          the page this links to, not here. */}
      <Link
        href="/me/withdraw"
        className="text-center text-xs text-muted-foreground underline hover:text-destructive"
      >
        회원 탈퇴
      </Link>
    </div>
  );
}
