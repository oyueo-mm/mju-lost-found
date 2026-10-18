import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Lost112Notice } from "@/components/search/Lost112Notice";
import { searchPosts } from "@/lib/posts/service";
import { recordDaily } from "@/lib/metrics/record";
import { SemanticSearchResults } from "@/components/search/SemanticSearchResults";
import { DEFAULT_LIMIT, DEFAULT_PAGE, listQuerySchema } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";
import { getTranslator } from "@/lib/i18n/server";
import { SEARCH_RESULTS_GRID_CLASS } from "@/components/search/resultsLayout";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = normalizeSearchParams(await searchParams);
  const t = await getTranslator();

  // Unlike /lost and /found, `type` here is user-selectable. 검색 대상 및
  // 게시글 목록 UX 개선 Phase §1/§6: 기본값은 "all"이 아니라 "found" --
  // 이 서비스는 잃어버린 물건을 찾기 위해 검색하는 것이 기본 시나리오라,
  // 별도로 대상을 바꾸지 않는 한 습득물 게시글을 검색한다. `raw.type`이
  // 있으면(사용자가 필터를 바꿨거나 그 상태로 북마크/새로고침한 경우)
  // 그 값이 이 기본값을 덮어쓴다 -- SearchFilterBar's own type state와
  // 정확히 같은 기본값 규칙.
  const parsed = listQuerySchema.safeParse({ type: "found", ...raw });
  const query = parsed.success
    ? parsed.data
    : { type: "found" as const, page: DEFAULT_PAGE, limit: DEFAULT_LIMIT };
  const mode = parsed.success ? parsed.data.mode : "keyword";

  // Semantic results load in the browser with its normal same-origin
  // session; models remain exclusively in the existing API functions.
  // 운영 통계: a keyword search made on this page (search words, first page)
  // -- the same rule /api/posts' searchPosts applies to its own requests.
  // That path and this one never overlap (this page calls the keyword-only
  // searchPosts directly; semantic mode goes through /api/posts and is
  // counted there), so nothing is counted twice.
  const searchWords = parsed.success ? parsed.data.q?.trim() : undefined;
  if (mode !== "semantic" && searchWords && (query.page ?? 1) === 1) {
    recordDaily("search.keyword", [query.type, searchWords, { ...query, q: undefined }]);
  }

  let results;
  try {
    results = mode === "semantic" ? null : await searchPosts(query);
  } catch (error) {
    console.error("Failed to search posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">{t("search.title")}</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          {t("search.error")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">{t("search.title")}</h1>
      {/* Phase 32: results+pagination passed as children so SearchFilterBar
          can hide them while its own "이미지로 검색" mode is active
          (ImageSearchPanel owns the results area then instead) -- see that
          component's own comment. Harmless for every other mode: rendered
          exactly as before, just one level deeper in the tree. */}
      <SearchFilterBar basePath="/search" showTypeFilter imageSearchEnabled defaultMode={mode === "semantic" ? "keyword" : "ai"} resultCount={results?.total}>
        <SemanticSearchNotice mode={mode} />
        {results === null ? (
          <SemanticSearchResults params={{ type: "found", ...raw }} basePath="/search" />
        ) : <>
        {results.items.length === 0 ? (
          <div className="flex flex-col gap-4">
            <EmptyState title={t("search.empty.title")} description={t("search.empty.description")} />
            <Lost112Notice />
          </div>
        ) : (
          <div className={SEARCH_RESULTS_GRID_CLASS}>
            {results.items.map((post) => (
              <PostCard key={`${post.type}-${post.id}`} post={post} />
            ))}
          </div>
        )}
        <Pagination
          basePath="/search"
          currentSearchParams={raw}
          page={results.page}
          totalPages={results.totalPages}
        />
        </>}
      </SearchFilterBar>
    </div>
  );
}
