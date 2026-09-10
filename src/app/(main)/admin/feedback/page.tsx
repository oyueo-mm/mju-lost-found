import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listFeedbackForAdmin } from "@/lib/feedback/service";
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackStatusValue,
} from "@/lib/feedback/schema";
import { ChatBubbleIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

const PAGE_SIZE = 20;

// Phase 11-5: admin-only feedback queue -- same page-level requireAdmin()
// gate + status-filter-tabs-via-Link pattern admin/reports/page.tsx
// already established (no client state, no new dependency: the filter is
// just which URL is loaded). listFeedbackForAdmin() re-checks isAdmin()
// itself regardless of this page's own gate.
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const admin = await requireAdmin();

  const { status: statusParam, page: pageParam } = await searchParams;
  const status = FEEDBACK_STATUSES.find((s) => s === statusParam);
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listFeedbackForAdmin(admin, { status, page, limit: PAGE_SIZE });
  const { items, total, totalPages } = result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  function filterHref(nextStatus?: FeedbackStatusValue) {
    return nextStatus ? `/admin/feedback?status=${nextStatus}` : "/admin/feedback";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ChatBubbleIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">서비스 의견</h1>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={filterHref()} className={!status ? "font-semibold underline" : "text-muted-foreground"}>
          전체
        </Link>
        {FEEDBACK_STATUSES.map((s) => (
          <Link key={s} href={filterHref(s)} className={status === s ? "font-semibold underline" : "text-muted-foreground"}>
            {FEEDBACK_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        {page}페이지 · {items.length}건 표시 (전체 {total}건)
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">조건에 맞는 의견이 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {items.map((f) => (
            <Link
              key={f.id}
              href={`/admin/feedback/${f.id}`}
              className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-muted"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground">
                  {FEEDBACK_CATEGORY_LABELS[f.category]} · {f.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  작성자: {f.author.nickname ?? "알 수 없음"} · 작성일: {formatDate(f.createdAt)}
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                {FEEDBACK_STATUS_LABELS[f.status]}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={`${filterHref(status)}${status ? "&" : "?"}page=${page - 1}`} className="underline">
            이전 페이지
          </Link>
        )}
        {page < totalPages && (
          <Link href={`${filterHref(status)}${status ? "&" : "?"}page=${page + 1}`} className="underline">
            다음 페이지
          </Link>
        )}
      </div>
    </div>
  );
}
