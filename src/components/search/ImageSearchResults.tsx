"use client";

import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Lost112Notice } from "./Lost112Notice";
import { BOARD_RESULTS_GRID_CLASS, SEARCH_RESULTS_GRID_CLASS } from "./resultsLayout";
import { useI18n } from "@/lib/i18n/client";
import type { ApiPagedResult } from "@/lib/posts/searchApiClient";

export function ImageSearchResults({ result, board, onPage, pending }: { result: ApiPagedResult; board: boolean; onPage: (page: number) => void; pending: boolean }) {
  const { t } = useI18n();
  return <div className="flex min-w-0 flex-col gap-4">
    {result.items.length === 0 ? <><EmptyState title={t("search.empty.title")} description={t("search.empty.description")} /><Lost112Notice /></> :
      <div className={board ? BOARD_RESULTS_GRID_CLASS : SEARCH_RESULTS_GRID_CLASS}>{result.items.map((post) => <PostCard key={`${post.type}-${post.id}`} post={post} variant={board ? "board" : "list"} hideEmptyThumbnail scoreDisplay="hidden" />)}</div>}
    {result.totalPages > 1 && <nav aria-label={t("search.pagination.label")} className="flex items-center justify-center gap-4 text-sm">
      <button type="button" disabled={pending || result.page <= 1} onClick={() => onPage(result.page - 1)} className="rounded-lg px-3 py-2 disabled:opacity-40">{t("search.pagination.prev")}</button>
      <span aria-live="polite">{result.page} / {result.totalPages}</span>
      <button type="button" disabled={pending || result.page >= result.totalPages} onClick={() => onPage(result.page + 1)} className="rounded-lg px-3 py-2 disabled:opacity-40">{t("search.pagination.next")}</button>
    </nav>}
  </div>;
}
