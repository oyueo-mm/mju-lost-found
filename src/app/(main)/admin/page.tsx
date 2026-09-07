import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { listReportsForAdmin } from "@/lib/moderation/service";
import { getAppSettings } from "@/lib/settings/service";
import { REPORT_STATUS_LABELS, REPORT_TARGET_TYPE_LABELS } from "@/lib/report/schema";
import { ShieldIcon } from "@/components/icons";
import { GoogleTestModeToggle } from "@/components/admin/GoogleTestModeToggle";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// Phase 17: "관리자 센터" landing -- a summary dashboard in front of the
// already-existing /admin/reports queue, exactly as this phase's own spec
// asks for ("실제 관리자 기능 전체를 구현하지 않는다... UI 구조만 만든다").
// Every number here is a real, already-possible query (report/user/post
// counts) -- none of it is mock data; this page adds no new mutation,
// permission check, or moderation action beyond what /admin/reports
// already does.
export default async function AdminDashboardPage() {
  const admin = await requireAdmin(); // redirects unless logged in, ready, and DB-flagged admin

  const [pendingResult, suspendedCount, lostCount, foundCount, userCount, appSettings] = await Promise.all([
    listReportsForAdmin(admin, { status: "pending", page: 1, limit: 5 }),
    prisma.user.count({ where: { isSuspended: true } }),
    prisma.lostPost.count(),
    prisma.foundPost.count(),
    // Phase 28-1: real count backing the new "사용자 관리" entry point below
    // -- same "every number here is a real query, never mock data" rule
    // this page's own top comment already states.
    prisma.user.count(),
    // Phase H-3: current Google 테스트 모드 상태, for GoogleTestModeToggle
    // below -- server-rendered so the admin always sees the real DB state
    // on load, never a stale/optimistic default.
    getAppSettings(),
  ]);

  const pending = pendingResult.kind === "ok" ? pendingResult.data : { items: [], total: 0 };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">관리자 센터</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          href="/admin/reports?status=pending"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">신고 대기</span>
          <span className="text-2xl font-bold text-foreground">{pending.total}</span>
        </Link>
        <Link
          href="/admin/users"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">전체 사용자</span>
          <span className="text-2xl font-bold text-foreground">{userCount}</span>
        </Link>
        {/* Phase I: now a real link -- /admin/sanctions (신고 처리와 별개의
            "제재 기록" 전체 목록 + 이의신청 큐, 이번 phase에서 신규 추가). */}
        <Link
          href="/admin/sanctions"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">제재 사용자</span>
          <span className="text-2xl font-bold text-foreground">{suspendedCount}</span>
        </Link>
        <Link
          href="/admin/posts"
          className="flex flex-col gap-1 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
        >
          <span className="text-xs text-muted-foreground">게시글</span>
          <span className="text-2xl font-bold text-foreground">{lostCount + foundCount}</span>
        </Link>
      </div>

      <section className="flex flex-col gap-3">
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
      </section>

      <GoogleTestModeToggle
        initialEnabled={appSettings.googleTestModeEnabled}
        updatedByNickname={appSettings.updatedByNickname}
        updatedAt={appSettings.updatedByNickname ? appSettings.updatedAt : null}
      />
    </div>
  );
}
