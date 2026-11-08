"use client";

import { useContext, useEffect, useState } from "react";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useI18n } from "@/lib/i18n/client";
import { fetchPostsFromApi, fetchImagePosts, type ApiPagedResult } from "@/lib/posts/searchApiClient";
import { Lost112Notice } from "./Lost112Notice";
import { Pagination } from "./Pagination";
import { BOARD_RESULTS_GRID_CLASS, SEARCH_RESULTS_GRID_CLASS } from "./resultsLayout";
import { SearchResultsToolbarContext } from "./SearchResultsToolbarContext";

export function SemanticSearchResults({ params, basePath, board = false, image }: {
  params: Record<string, string>;
  basePath: string;
  board?: boolean;
  image?: File;
}) {
  const { t } = useI18n();
  const renderToolbar = useContext(SearchResultsToolbarContext);
  const query = new URLSearchParams(params).toString();
  const [state, setState] = useState<{ query: string; image?: File; result?: ApiPagedResult; error?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    const request = image
      ? fetchImagePosts(new URLSearchParams(query), image, controller.signal)
      : fetchPostsFromApi(Object.fromEntries(new URLSearchParams(query)), controller.signal);
    request.then(
      (result) => { if (!controller.signal.aborted) setState({ query, image, result }); },
      () => { if (!controller.signal.aborted) setState({ query, image, error: true }); },
    );
    return () => controller.abort();
  }, [query, image]);

  if (state?.query !== query || state.image !== image) return <>{renderToolbar?.()}<p role="status">{t("common.loading")}</p></>;
  if (state.error) return <>{renderToolbar?.()}<p role="alert" className="rounded-card bg-destructive-muted p-10 text-center text-sm text-destructive">{t("search.error")}</p></>;
  const result = state.result!;
  return (
    <>
      {renderToolbar ? renderToolbar(result.total) : <p className="text-sm text-muted-foreground" aria-live="polite">{t("search.results.count", { count: result.total })}</p>}
      {result.search?.limited && <p className="text-xs text-muted-foreground">{t("search.unified.limited")}</p>}
      {result.items.length === 0 ? (
        <div className="flex flex-col gap-4">
          <EmptyState title={t("search.empty.title")} description={t("search.empty.description")} />
          <Lost112Notice />
        </div>
      ) : (
        <div className={board ? BOARD_RESULTS_GRID_CLASS : SEARCH_RESULTS_GRID_CLASS}>
          {result.items.map((post) => <PostCard key={`${post.type}-${post.id}`} post={post} variant={board ? "board" : "list"} hideEmptyThumbnail scoreDisplay="hidden" />)}
        </div>
      )}
      <Pagination basePath={basePath} currentSearchParams={params} page={result.page} totalPages={result.totalPages} />
    </>
  );
}
