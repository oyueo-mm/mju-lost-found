"use client";

import { useEffect, useState } from "react";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useI18n } from "@/lib/i18n/client";
import { fetchPostsFromApi, type ApiPagedResult } from "@/lib/posts/searchApiClient";
import { Lost112Notice } from "./Lost112Notice";
import { Pagination } from "./Pagination";
import { BOARD_RESULTS_GRID_CLASS, SEARCH_RESULTS_GRID_CLASS } from "./resultsLayout";

export function SemanticSearchResults({ params, basePath, board = false }: {
  params: Record<string, string>;
  basePath: string;
  board?: boolean;
}) {
  const { t } = useI18n();
  const query = new URLSearchParams(params).toString();
  const [state, setState] = useState<{ query: string; result?: ApiPagedResult; error?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    fetchPostsFromApi(Object.fromEntries(new URLSearchParams(query)), controller.signal).then(
      (result) => { if (!controller.signal.aborted) setState({ query, result }); },
      () => { if (!controller.signal.aborted) setState({ query, error: true }); },
    );
    return () => controller.abort();
  }, [query]);

  if (state?.query !== query) return <p role="status">{t("common.loading")}</p>;
  if (state.error) return <p role="alert" className="rounded-card bg-destructive-muted p-10 text-center text-sm text-destructive">{t("search.error")}</p>;
  const result = state.result!;
  return (
    <>
      <p className="text-sm text-muted-foreground" aria-live="polite">{t("search.results.count", { count: result.total })}</p>
      {result.items.length === 0 ? (
        <div className="flex flex-col gap-4">
          <EmptyState title={t("search.empty.title")} description={t("search.empty.description")} />
          <Lost112Notice />
        </div>
      ) : (
        <div className={board ? BOARD_RESULTS_GRID_CLASS : SEARCH_RESULTS_GRID_CLASS}>
          {result.items.map((post) => <PostCard key={`${post.type}-${post.id}`} post={post} variant={board ? "board" : "default"} />)}
        </div>
      )}
      <Pagination basePath={basePath} currentSearchParams={params} page={result.page} totalPages={result.totalPages} />
    </>
  );
}
