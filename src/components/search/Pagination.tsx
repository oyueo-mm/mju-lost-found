import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";

type PaginationProps = {
  basePath: string;
  currentSearchParams: Record<string, string | undefined>;
  page: number;
  totalPages: number;
};

// Server Component: URL query params are the only source of truth for
// page state (see Phase 6 spec section 13), so page links are plain
// <Link>s that preserve every other current filter, not client state.
export async function Pagination({ basePath, currentSearchParams, page, totalPages }: PaginationProps) {
  if (totalPages <= 1) return null;
  const t = await getTranslator();

  function hrefFor(targetPage: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(currentSearchParams)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  const windowStart = Math.max(1, page - 2);
  const windowEnd = Math.min(totalPages, windowStart + 4);
  const pageNumbers = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, i) => windowStart + i,
  );

  return (
    <nav className="flex items-center justify-center gap-2 text-sm">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="rounded-lg px-3 py-1.5 text-foreground hover:bg-muted">
          {t("search.pagination.prev")}
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-muted-foreground/50">{t("search.pagination.prev")}</span>
      )}

      {pageNumbers.map((n) =>
        n === page ? (
          <span key={n} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground">
            {n}
          </span>
        ) : (
          <Link key={n} href={hrefFor(n)} className="rounded-lg px-3 py-1.5 text-foreground hover:bg-muted">
            {n}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className="rounded-lg px-3 py-1.5 text-foreground hover:bg-muted">
          {t("search.pagination.next")}
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-muted-foreground/50">{t("search.pagination.next")}</span>
      )}
    </nav>
  );
}
