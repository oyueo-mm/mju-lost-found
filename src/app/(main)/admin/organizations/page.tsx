import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listOrganizationsForAdmin } from "@/lib/organization/service";
import { ORGANIZATION_STATUSES, ORGANIZATION_STATUS_LABELS } from "@/lib/organization/schema";
import { ShieldIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

const PAGE_SIZE = 20;

// Phase 12-6 §13: 기본값은 ACTIVE가 아니라 전체(ALL) -- 비활성 단체도
// 관리자 화면에서 바로 찾아 재활성화할 수 있어야 한다.
export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const admin = await requireAdmin(); // redirects unless logged in, ready, and DB-flagged admin

  const { status: statusParam, q, page: pageParam } = await searchParams;
  const status = ORGANIZATION_STATUSES.find((s) => s === statusParam);
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listOrganizationsForAdmin(admin, { status, q, page, limit: PAGE_SIZE });
  const { items, total, totalPages } =
    result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  function filterHref(next: { status?: string; q?: string }) {
    const params = new URLSearchParams();
    const nextStatus = "status" in next ? next.status : status;
    const nextQ = "q" in next ? next.q : q;
    if (nextStatus) params.set("status", nextStatus);
    if (nextQ) params.set("q", nextQ);
    return `/admin/organizations${params.toString() ? `?${params}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">단체 관리</h1>
        </div>
        {/* Phase 12-6 §14: 별도 신청 시스템을 다시 만들지 않고, 기존
            /admin/organization-requests로 이동하는 navigation만 제공한다. */}
        <Link
          href="/admin/organization-requests?status=pending"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          단체 생성 신청 →
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">상태</span>
          <div className="flex gap-2 text-sm">
            <Link href={filterHref({ status: undefined })} className={!status ? "font-semibold underline" : "text-muted-foreground"}>
              전체
            </Link>
            {ORGANIZATION_STATUSES.map((s) => (
              <Link
                key={s}
                href={filterHref({ status: s })}
                className={status === s ? "font-semibold underline" : "text-muted-foreground"}
              >
                {ORGANIZATION_STATUS_LABELS[s]}
              </Link>
            ))}
          </div>
        </div>

        <form action="/admin/organizations" className="flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="단체명 검색"
            className="w-full max-w-xs rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-foreground/30"
          >
            검색
          </button>
        </form>
      </div>

      <p className="text-sm text-muted-foreground">
        {page}페이지 · {items.length}개 표시 (전체 {total}개)
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">조건에 맞는 단체가 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {items.map((org) => (
            <Link
              key={org.id}
              href={`/admin/organizations/${org.id}`}
              className="flex flex-col gap-1 border-b border-border p-4 text-sm last:border-b-0 hover:bg-muted"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{org.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    org.status === "active" ? "bg-primary-muted text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ORGANIZATION_STATUS_LABELS[org.status]}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {org.organizationType}
                {org.scope ? ` · ${org.scope}` : ""} · 구성원 {org.memberCount}명 · 대표 관리자:{" "}
                {org.leader?.nickname ?? "없음"} · 생성일 {formatDate(org.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={`${filterHref({})}${filterHref({}).includes("?") ? "&" : "?"}page=${page - 1}`} className="underline">
            이전 페이지
          </Link>
        )}
        {page < totalPages && (
          <Link href={`${filterHref({})}${filterHref({}).includes("?") ? "&" : "?"}page=${page + 1}`} className="underline">
            다음 페이지
          </Link>
        )}
      </div>
    </div>
  );
}
