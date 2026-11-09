import Link from "next/link";

import { requireAnyAdminPermission } from "@/lib/auth/session";
import { can, canAny } from "@/lib/permissions/check";
import { ITEM_PERMISSION_KEYS, PERMISSION_INFO } from "@/lib/permissions/definitions";
import { loadPermissionStates } from "@/lib/permissions/service";
import { prisma } from "@/lib/db/prisma";
import { ILLEGAL_SEXUAL_CONTENT_REASON } from "@/lib/report/schema";
import { listReportsForAdmin } from "@/lib/moderation/service";
import { getAppSettings } from "@/lib/settings/service";
import { listAdminActionProposalsForAdmin } from "@/lib/admin/proposals";
import { REPORT_STATUS_LABELS, REPORT_TARGET_TYPE_LABELS } from "@/lib/report/schema";
import { ShieldIcon } from "@/components/icons";
import { GoogleTestModeToggle } from "@/components/admin/GoogleTestModeToggle";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

// Phase 17: "관리자 센터" landing -- a summary dashboard in front of the
// already-existing /admin/reports queue, exactly as this phase's own spec
// asks for ("실제 관리자 기능 전체를 구현하지 않는다... UI 구조만 만든다").
// Every number here is a real, already-possible query (report/user/post
// counts) -- none of it is mock data; this page adds no new mutation,
// permission check, or moderation action beyond what /admin/reports
// already does.
export default async function AdminDashboardPage() {
  // Any admin permission opens the center; every tile and query below is limited to what this account may use.
  const admin = await requireAnyAdminPermission();
  const myPermissions = admin.isAdmin ? null : (await loadPermissionStates([admin.id])).get(admin.id)?.permissions ?? [];

  const [
    pendingResult,
    suspendedCount,
    lostCount,
    foundCount,
    userCount,
    announcementCount,
    pendingFeedbackCount,
    pendingOrganizationRequestCount,
    organizationCount,
    appSettings,
    proposalsResult,
    externalAccessCount,
    urgentPendingCount,
    pendingRejoinCount,
  ] = await Promise.all([
    can(admin, "reports.view") ? listReportsForAdmin(admin, { status: "pending", page: 1, limit: 5 }) : Promise.resolve({ kind: "forbidden" as const }),
    can(admin, "users.sanction") ? prisma.user.count({ where: { isSuspended: true } }) : Promise.resolve(0),
    canAny(admin, ["posts.manage", "posts.delete"]) ? prisma.lostPost.count() : Promise.resolve(0),
    canAny(admin, ["posts.manage", "posts.delete"]) ? prisma.foundPost.count() : Promise.resolve(0),
    // Phase 28-1: real count backing the new "사용자 관리" entry point below
    // -- same "every number here is a real query, never mock data" rule
    // this page's own top comment already states.
    can(admin, "users.view") ? prisma.user.count() : Promise.resolve(0),
    // Phase M: same rule, for the new "공지사항" tile below.
    can(admin, "settings.manage") ? prisma.announcement.count() : Promise.resolve(0),
    // Phase 11-5: same rule, for the new "서비스 의견" tile below -- counts
    // only 접수(RECEIVED) status, matching "신고 대기" tile's own "지금 봐야
    // 할 것" framing.
    can(admin, "settings.manage") ? prisma.feedback.count({ where: { status: "RECEIVED" } }) : Promise.resolve(0),
    // Phase 12-3: same rule, for the new "단체 생성 신청" tile below --
    // counts only PENDING requests.
    can(admin, "institutions.manage") ? prisma.organizationCreationRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    // Phase 12-6: same rule, for the new "단체 관리" tile below -- counts
    // every Organization regardless of status (ACTIVE+INACTIVE), matching
    // that tile's own "전체 단체를 관리한다" framing (unlike the pending-
    // request tile above, which intentionally counts only PENDING).
    can(admin, "institutions.manage") ? prisma.organization.count() : Promise.resolve(0),
    // Phase H-3: current Google 테스트 모드 상태, for GoogleTestModeToggle
    // below -- server-rendered so the admin always sees the real DB state
    // on load, never a stale/optimistic default.
    can(admin, "settings.manage") ? getAppSettings() : Promise.resolve({ googleTestModeEnabled: false, updatedByNickname: null, updatedAt: new Date(0) }),
    // Phase 관리자 승인제: same rule, for the new "관리자 조치 제안" tile
    // below -- counts only PENDING proposals, matching "신고 대기"/"서비스
    // 의견 (접수)" tiles' own "지금 봐야 할 것" framing.
    admin.isAdmin ? listAdminActionProposalsForAdmin(admin) : Promise.resolve({ kind: "forbidden" as const }),
    // External access Phase: currently approved external accounts, for the
    // "외부 관계자 승인" tile below.
    can(admin, "access.external") ? prisma.externalAccessGrant.count({ where: { status: "ACTIVE" } }) : Promise.resolve(0),
    // Legal pre-beta Phase: pending illegal-sexual-content reports, shown
    // first so they're handled before anything else.
    can(admin, "reports.view") ? prisma.report.count({ where: { status: "PENDING", reason: ILLEGAL_SEXUAL_CONTENT_REASON } }) : Promise.resolve(0),
    // 회원탈퇴: rejoin requests waiting for a decision.
    can(admin, "users.sanction") ? prisma.rejoinRequest.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
  ]);

  const pending = pendingResult.kind === "ok" ? pendingResult.data : { items: [], total: 0 };
  const pendingProposalCount =
    proposalsResult.kind === "ok" ? proposalsResult.data.filter((p) => p.status === "pending").length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">관리자 센터</h1>
      </div>

      <p className="text-xs text-muted-foreground">
        {myPermissions === null ? "전체 관리자 · 모든 관리 기능을 사용할 수 있어요." : `내 관리 권한: ${myPermissions.map((k) => PERMISSION_INFO[k].label).join(" · ")}`}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

        {canAny(admin, ITEM_PERMISSION_KEYS) && (
        <Link href="/items" className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 hover:border-primary"><span className="text-sm font-medium">기관 물품 현황</span><span className="text-xs text-muted-foreground">접수·보관·인계·반환</span></Link>
        )}
        {/* UI/UX 최종 개선: 지금 조치가 필요한 항목(대기 중인 신고/의견/
            생성 신청)은 warning 색으로, 단순 현황 수치(전체 사용자/게시글/
            공지/단체 수)는 기존처럼 foreground로 -- 7개 타일이 전부 같은
            시각적 무게를 가져서 "지금 봐야 할 것"이 묻히던 문제를, 새 색을
            추가하지 않고 이미 이 페이지의 "최근 신고" 배지가 쓰는 warning
            토큰만 재사용해 해결한다. */}
        {can(admin, "reports.view") && (
        <Link
          href="/admin/reports?status=pending"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">신고 대기</span>
          <span className={`text-2xl font-bold ${pending.total > 0 ? "text-warning" : "text-foreground"}`}>
            {pending.total}
          </span>
        </Link>
        )}
        {can(admin, "users.view") && (
        <Link
          href="/admin/users"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">전체 사용자</span>
          <span className="text-2xl font-bold text-foreground">{userCount}</span>
        </Link>
        )}
        {/* Phase I: now a real link -- /admin/sanctions (신고 처리와 별개의
            "제재 기록" 전체 목록 + 이의신청 큐, 이번 phase에서 신규 추가). */}
        {can(admin, "promotion.manage") && (
          <Link href="/admin/utm" className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 hover:border-foreground/30">
            <span className="text-xs text-muted-foreground">홍보 관리</span>
            <span className="text-sm font-semibold text-foreground">UTM 링크 생성</span>
          </Link>
        )}
        {can(admin, "users.sanction") && (
        <Link
          href="/admin/sanctions"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">제재 사용자</span>
          <span className="text-2xl font-bold text-foreground">{suspendedCount}</span>
        </Link>
        )}
        {canAny(admin, ["posts.manage", "posts.delete"]) && (
        <Link
          href="/admin/posts"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">게시글</span>
          <span className="text-2xl font-bold text-foreground">{lostCount + foundCount}</span>
        </Link>
        )}
        {/* Phase M: new tile -- /admin/announcements. Not a main-nav tab
            (this phase's own spec), just another entry point off this
            existing dashboard, same as every other tile here. */}
        {can(admin, "settings.manage") && (
        <Link
          href="/admin/announcements"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">공지사항</span>
          <span className="text-2xl font-bold text-foreground">{announcementCount}</span>
        </Link>
        )}
        {/* Phase 11-5: new tile -- /admin/feedback. Not a main-nav tab
            (same "새로운 탭을 추가하지 않는다" rule Phase M's own comment
            above states), just another entry point off this existing
            dashboard. */}
        {can(admin, "settings.manage") && (
        <Link
          href="/admin/feedback?status=received"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">서비스 의견 (접수)</span>
          <span className={`text-2xl font-bold ${pendingFeedbackCount > 0 ? "text-warning" : "text-foreground"}`}>
            {pendingFeedbackCount}
          </span>
        </Link>
        )}
        {/* Phase 12-3: new tile -- /admin/organization-requests. 동일한
            "새로운 탭을 추가하지 않는다" 원칙, 대시보드 타일로만 추가. */}
        {can(admin, "institutions.manage") && (
        <Link
          href="/admin/organization-requests?status=pending"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">단체 생성 신청 (대기)</span>
          <span
            className={`text-2xl font-bold ${pendingOrganizationRequestCount > 0 ? "text-warning" : "text-foreground"}`}
          >
            {pendingOrganizationRequestCount}
          </span>
        </Link>
        )}
        {/* Phase 12-6: new tile -- /admin/organizations. 동일한 "새로운
            탭을 추가하지 않는다" 원칙, 대시보드 타일로만 추가. */}
        {can(admin, "institutions.manage") && (
        <Link
          href="/admin/organizations"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">단체 관리</span>
          <span className="text-2xl font-bold text-foreground">{organizationCount}</span>
        </Link>
        )}
        {/* Phase 관리자 승인제: new tile -- /admin/proposals. 동일한 "새로운
            탭을 추가하지 않는다" 원칙, 대시보드 타일로만 추가. */}
        {admin.isAdmin && (
        <Link
          href="/admin/proposals"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">관리자 조치 제안 (대기)</span>
          <span className={`text-2xl font-bold ${pendingProposalCount > 0 ? "text-warning" : "text-foreground"}`}>
            {pendingProposalCount}
          </span>
        </Link>
        )}
        {can(admin, "reports.view") && (
        <Link
          href="/admin/reports?status=pending&urgent=1"
          className={`flex flex-col gap-1 rounded-card border bg-card p-4 transition-colors hover:border-foreground/30 ${urgentPendingCount > 0 ? "border-destructive" : "border-border"}`}
        >
          <span className="text-xs text-muted-foreground">긴급 신고 (불법 성적 콘텐츠, 대기)</span>
          <span className={`text-2xl font-bold ${urgentPendingCount > 0 ? "text-destructive" : "text-foreground"}`}>
            {urgentPendingCount}
          </span>
        </Link>
        )}
        {can(admin, "access.external") && (
        <Link
          href="/admin/external-access"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">외부 관계자 승인</span>
          <span className="text-2xl font-bold text-foreground">{externalAccessCount}</span>
        </Link>
        )}
        {canAny(admin, ["stats.operations", "stats.users", "stats.admins"]) && (
        <Link
          href="/admin/stats"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">운영 통계</span>
          <span className="text-sm font-semibold text-foreground">이용 현황·성능 보기</span>
        </Link>
        )}
        {can(admin, "users.sanction") && (
        <Link
          href="/admin/rejoin-requests"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">재가입 요청 (대기)</span>
          <span className="text-2xl font-bold text-foreground">{pendingRejoinCount}</span>
        </Link>
        )}
      </div>

      {can(admin, "reports.view") && <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">최근 신고</h2>
          <Link href="/admin/reports" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            전체 보기
          </Link>
        </div>
        {pending.items.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            대기 중인 신고가 없어요.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card">
            {pending.items.map((r) => (
              <Link
                key={r.id}
                href={`/admin/reports/${r.id}`}
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-muted"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-foreground">
                    {REPORT_TARGET_TYPE_LABELS[r.targetType]} 신고 · {r.reason}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                </div>
                <span className="shrink-0 rounded-full bg-warning-muted px-2.5 py-1 text-xs font-medium text-warning">
                  {REPORT_STATUS_LABELS[r.status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>}

      {can(admin, "settings.manage") && <GoogleTestModeToggle
        initialEnabled={appSettings.googleTestModeEnabled}
        updatedByNickname={appSettings.updatedByNickname}
        updatedAt={appSettings.updatedByNickname ? appSettings.updatedAt : null}
      />}
    </div>
  );
}
