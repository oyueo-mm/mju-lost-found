import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { PostCard } from "@/components/post/PostCard";
import { searchPosts } from "@/lib/posts/service";
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

  let results;
  try {
    results = await searchPosts(query);
  } catch (error) {
    console.error("Failed to search posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">통합 검색</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          검색 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">통합 검색</h1>
      <SearchFilterBar basePath="/search" showTypeFilter />
      {results.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          검색 결과가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
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
    </div>
  );
}
