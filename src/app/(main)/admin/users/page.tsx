import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listUsersForAdmin } from "@/lib/admin/users";
import { UserActionButtons } from "@/components/admin/UserActionButtons";
import { ShieldIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

const PAGE_SIZE = 20;

function pageHref(q: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("page", String(page));
  return `/admin/users?${params}`;
}

// Phase 28-1: same page-level gate (requireAdmin -- redirects unless
// logged in, ready, and DB-flagged admin) every other admin-only page in
// this app already uses, same list/pagination/search layout as
// /admin/reports (see that page's own comments for the underlying
// convention this mirrors).
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const admin = await requireAdmin();

  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listUsersForAdmin(admin, { q, page, limit: PAGE_SIZE });
  const { items, total, totalPages } =
    result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">사용자 관리</h1>
      </div>

      <form action="/admin/users" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="이메일 또는 닉네임 검색"
          className="w-full max-w-xs rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-foreground/30"
        >
          검색
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {page}페이지 · {items.length}명 표시 (전체 {total}명)
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">조건에 맞는 사용자가 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {items.map((u) => (
            <div
              key={u.id}
              className="flex flex-col gap-3 border-b border-border p-4 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{u.nickname ?? "(닉네임 없음)"}</span>
                  {u.isAdmin && (
                    <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[11px] font-medium text-primary">
                      관리자
                    </span>
                  )}
                  {u.isSuspended && (
                    <span className="rounded-full bg-destructive-muted px-2 py-0.5 text-[11px] font-medium text-destructive">
                      정지됨
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {u.email} · 가입일: {formatDate(u.createdAt)}
                  {u.isSuspended && (u.suspendedUntil ? ` · 정지 해제: ${formatDate(u.suspendedUntil)}` : " · 영구 정지")}
                </span>
              </div>

              <UserActionButtons user={u} isSelf={u.id === admin.id} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={pageHref(q, page - 1)} className="underline">
            이전 페이지
          </Link>
        )}
        {page < totalPages && (
          <Link href={pageHref(q, page + 1)} className="underline">
            다음 페이지
          </Link>
        )}
      </div>
    </div>
  );
}
