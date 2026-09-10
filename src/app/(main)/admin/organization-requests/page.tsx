import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listOrganizationCreationRequestsForAdmin } from "@/lib/organization/service";
import {
  ORGANIZATION_REQUEST_STATUSES,
  ORGANIZATION_REQUEST_STATUS_LABELS,
  type OrganizationRequestStatusValue,
} from "@/lib/organization/schema";
import { ShieldIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

const PAGE_SIZE = 20;

// Phase 12-3: admin-only 단체 생성 신청 큐 -- admin/feedback/page.tsx와
// 동일한 page-level requireAdmin() 게이트 + 상태 필터 탭(Link 기반, 클라이언트
// state 없음) 패턴. listOrganizationCreationRequestsForAdmin()이 isAdmin()을
// 자체 재검증하므로 이 페이지의 게이트는 첫 방어선일 뿐이다.
export default async function AdminOrganizationRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const admin = await requireAdmin();

  const { status: statusParam, page: pageParam } = await searchParams;
  const status = ORGANIZATION_REQUEST_STATUSES.find((s) => s === statusParam);
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listOrganizationCreationRequestsForAdmin(admin, { status, page, limit: PAGE_SIZE });
  const { items, total, totalPages } = result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  function filterHref(nextStatus?: OrganizationRequestStatusValue) {
    return nextStatus ? `/admin/organization-requests?status=${nextStatus}` : "/admin/organization-requests";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">단체 생성 신청</h1>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={filterHref()} className={!status ? "font-semibold underline" : "text-muted-foreground"}>
          전체
        </Link>
        {ORGANIZATION_REQUEST_STATUSES.map((s) => (
          <Link key={s} href={filterHref(s)} className={status === s ? "font-semibold underline" : "text-muted-foreground"}>
            {ORGANIZATION_REQUEST_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        {page}페이지 · {items.length}건 표시 (전체 {total}건)
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">조건에 맞는 신청이 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {items.map((r) => (
            <Link
              key={r.id}
              href={`/admin/organization-requests/${r.id}`}
              className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-muted"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium text-foreground">
                  {r.organizationType} · {r.organizationName}
                </span>
                <span className="text-xs text-muted-foreground">
                  신청자: {r.requester.nickname ?? "알 수 없음"} · 신청일: {formatDate(r.createdAt)}
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
                {ORGANIZATION_REQUEST_STATUS_LABELS[r.status]}
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
