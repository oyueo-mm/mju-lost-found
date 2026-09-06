import Link from "next/link";

import { requireAdmin } from "@/lib/auth/session";
import { listPostsForAdmin } from "@/lib/admin/posts";
import { CATEGORIES, postTypeSchema } from "@/lib/posts/schema";
import { AdminPostDeleteButton } from "@/components/admin/AdminPostDeleteButton";
import { ShieldIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

const PAGE_SIZE = 20;

function pageHref(params: { type: string; q?: string; category?: string; author?: string }, page: number): string {
  const search = new URLSearchParams();
  search.set("type", params.type);
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.author) search.set("author", params.author);
  search.set("page", String(page));
  return `/admin/posts?${search}`;
}

// Phase 28-2: same page-level gate (requireAdmin) and list/search/
// pagination layout every other admin-only page in this app already uses
// (see /admin/reports, /admin/users). Lost/Found are separate tables with
// independent id sequences (same reason every other per-post route
// requires `type`), so this page shows exactly one board at a time via a
// tab toggle, defaulting to "lost".
export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string; category?: string; author?: string; page?: string }>;
}) {
  const admin = await requireAdmin();

  const { type: typeParam, q, category, author, page: pageParam } = await searchParams;
  const typeResult = postTypeSchema.safeParse(typeParam);
  const type = typeResult.success ? typeResult.data : "lost";
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listPostsForAdmin(admin, {
    type,
    q,
    category,
    authorQuery: author,
    page,
    limit: PAGE_SIZE,
  });
  const { items, total, totalPages } =
    result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">게시글 관리</h1>
      </div>

      <div className="flex gap-2 text-sm">
        <Link
          href={pageHref({ type: "lost", q, category, author }, 1)}
          className={type === "lost" ? "font-semibold underline" : "text-muted-foreground"}
        >
          분실물
        </Link>
        <Link
          href={pageHref({ type: "found", q, category, author }, 1)}
          className={type === "found" ? "font-semibold underline" : "text-muted-foreground"}
        >
          습득물
        </Link>
      </div>

      <form action="/admin/posts" className="flex flex-wrap gap-2">
        <input type="hidden" name="type" value={type} />
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="제목 검색"
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <input
          type="text"
          name="author"
          defaultValue={author}
          placeholder="작성자 닉네임 검색"
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <select
          name="category"
          defaultValue={category ?? ""}
          className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        >
          <option value="">전체 카테고리</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:border-foreground/30"
        >
          검색
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {page}페이지 · {items.length}건 표시 (전체 {total}건)
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">조건에 맞는 게시물이 없습니다.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {items.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-2 border-b border-border p-4 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link href={`/post/${p.id}?type=${type}`} className="truncate font-medium text-foreground hover:underline">
                  {p.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {p.category} · 작성자: {p.author.nickname ?? "알 수 없음"} · 등록일: {formatDate(p.createdAt)} · 상태:{" "}
                  {p.status}
                </span>
              </div>

              <AdminPostDeleteButton id={p.id} type={type} title={p.title} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={pageHref({ type, q, category, author }, page - 1)} className="underline">
            이전 페이지
          </Link>
        )}
        {page < totalPages && (
          <Link href={pageHref({ type, q, category, author }, page + 1)} className="underline">
            다음 페이지
          </Link>
        )}
      </div>
    </div>
  );
}
