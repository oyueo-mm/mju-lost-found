import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listSuspensionActionsForAdmin } from "@/lib/moderation/service";
import { listSuspensionAppealsForAdmin } from "@/lib/moderation/appeals";
import { AppealReviewButton } from "@/components/admin/AppealReviewButton";
import { ShieldIcon } from "@/components/icons";

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const PAGE_SIZE = 20;

// Phase I section 3: "제재 기록" -- every SUSPEND_USER ModerationAction
// (both the report-flow and direct-admin suspend paths write to the same
// table now, see moderation/service.ts's own comment), plus the section 4
// appeals queue on the same page (small enough not to need its own route,
// and keeps this phase's new admin surface to one page instead of two --
// see this phase's own "Vercel function 수가 12개를 넘지 않도록" constraint).
// Admin-only (requireAdmin()); a regular user has no way to reach this
// page or its data.
export default async function AdminSanctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const admin = await requireAdmin(); // redirects unless logged in, ready, and DB-flagged admin

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [sanctionsResult, appealsResult] = await Promise.all([
    listSuspensionActionsForAdmin(admin, { page, limit: PAGE_SIZE }),
    listSuspensionAppealsForAdmin(admin, { page: 1, limit: PAGE_SIZE }),
  ]);

  const sanctions =
    sanctionsResult.kind === "ok" ? sanctionsResult.data : { items: [], total: 0, totalPages: 1, page: 1 };
  const appeals = appealsResult.kind === "ok" ? appealsResult.data : { items: [], total: 0 };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">제재 기록</h1>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">이의신청</h2>
          <span className="text-xs text-muted-foreground">전체 {appeals.total}건</span>
        </div>
        {appeals.items.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            접수된 이의신청이 없어요.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {appeals.items.map((a) => (
              <div key={a.id} className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {a.targetUser?.nickname ?? "알 수 없음"}
                    </span>
                    <span className="text-xs text-muted-foreground">제출: {formatDateTime(a.createdAt)}</span>
                  </div>
                  {a.reviewedAt ? (
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      검토 완료
                      {a.reviewedByNickname && ` · ${a.reviewedByNickname}`}
                    </span>
                  ) : (
                    <AppealReviewButton appealId={a.id} />
                  )}
                </div>
                <p className="whitespace-pre-wrap text-foreground">{a.content}</p>
                {a.targetUser && (
                  <Link
                    href={`/profile/${a.targetUser.publicId}`}
                    className="w-fit text-xs font-medium text-primary hover:underline"
                  >
                    프로필 보기
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">정지 처리 내역</h2>
          <span className="text-xs text-muted-foreground">전체 {sanctions.total}건</span>
        </div>
        {sanctions.items.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            정지 처리 내역이 없어요.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card">
            {sanctions.items.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-1 border-b border-border px-4 py-3 text-sm last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{s.targetUser?.nickname ?? "알 수 없음"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.targetCurrentlySuspended
                        ? "bg-destructive-muted text-destructive"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {s.targetCurrentlySuspended ? "정지 중" : "해제/만료됨"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.viaReport ? "신고 처리" : "직접 정지"} · 처리자: {s.adminNickname ?? "알 수 없음"} · {formatDateTime(s.createdAt)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                    {s.reasonCategory ?? "미분류"}
                  </span>
                  <span>{s.reason ?? "상세 사유 없음"}</span>
                  <span>·</span>
                  <span>{s.expiresAt ? `만료: ${formatDateTime(s.expiresAt)}` : "영구 정지"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={`/admin/sanctions?page=${page - 1}`} className="underline">
              이전 페이지
            </Link>
          )}
          {page < sanctions.totalPages && (
            <Link href={`/admin/sanctions?page=${page + 1}`} className="underline">
              다음 페이지
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
