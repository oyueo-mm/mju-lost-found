import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";

import { getPaginationItems } from "./paginationItems";

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

  // First/last page always shown, the current page's neighbors around it,
  // and "…" for the gaps (see getPaginationItems). Two variants of the same
  // list: ±2 neighbors from `sm` up, ±1 on narrow screens -- only one is
  // ever displayed (the other is display:none, so screen readers skip it
  // too).
  function pageList(siblings: number, className: string) {
    return (
      <div className={className}>
        {getPaginationItems(page, totalPages, siblings).map((item) =>
          typeof item !== "number" ? (
            <span key={item} aria-hidden="true" className="px-1.5 py-1.5 text-muted-foreground">
              …
            </span>
          ) : item === page ? (
            <span
              key={item}
              aria-current="page"
              className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground"
            >
              {item}
            </span>
          ) : (
            <Link key={item} href={hrefFor(item)} className="rounded-lg px-3 py-1.5 text-foreground hover:bg-muted">
              {item}
            </Link>
          ),
        )}
      </div>
    );
  }

  return (
    <nav className="flex items-center justify-center gap-2 text-sm">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="rounded-lg px-3 py-1.5 text-foreground hover:bg-muted">
          {t("search.pagination.prev")}
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-muted-foreground/50">{t("search.pagination.prev")}</span>
      )}

      {pageList(2, "hidden items-center gap-1 sm:flex")}
      {pageList(1, "flex items-center gap-1 sm:hidden")}

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
