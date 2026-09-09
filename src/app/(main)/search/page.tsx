import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { searchPosts } from "@/lib/posts/service";
import { fetchPostsFromApi } from "@/lib/posts/searchApiClient";
import { DEFAULT_LIMIT, DEFAULT_PAGE, listQuerySchema } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = normalizeSearchParams(await searchParams);

  // Unlike /lost and /found, `type` here is user-selectable and defaults
  // to "all" (both boards) when not given.
  const parsed = listQuerySchema.safeParse({ type: "all", ...raw });
  const query = parsed.success
    ? parsed.data
    : { type: "all" as const, page: DEFAULT_PAGE, limit: DEFAULT_LIMIT };
  const mode = parsed.success ? parsed.data.mode : "keyword";

  // See searchApiClient.ts's comment (also linked from lost/found's pages)
  // -- semantic mode fetches /api/posts instead of calling searchPosts()
  // in-process, since only /api/posts's function bundle carries the
  // embedding model on Vercel. `raw.type` can be "lost", "found", or
  // (Phase 11-2) "all" -- aiService.ts's searchPosts() merges both
  // boards' semantic results itself when it's "all", so this page doesn't
  // need to know or care which case it is.
  let results;
  try {
    results = mode === "semantic" ? await fetchPostsFromApi(raw) : await searchPosts(query);
  } catch (error) {
    console.error("Failed to search posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">통합 검색</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          검색 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">통합 검색</h1>
      {/* Phase 32: results+pagination passed as children so SearchFilterBar
          can hide them while its own "이미지로 검색" mode is active
          (ImageSearchPanel owns the results area then instead) -- see that
          component's own comment. Harmless for every other mode: rendered
          exactly as before, just one level deeper in the tree. */}
      <SearchFilterBar basePath="/search" showTypeFilter imageSearchEnabled>
        <SemanticSearchNotice mode={mode} />
        {results.items.length === 0 ? (
          <EmptyState title="검색 결과가 없어요." description="다른 검색어나 필터로 다시 시도해보세요." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
      </SearchFilterBar>
    </div>
  );
}
