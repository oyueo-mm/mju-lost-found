import Link from "next/link";

import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { searchPosts } from "@/lib/posts/service";
import { fetchPostsFromApi } from "@/lib/posts/searchApiClient";
import { DEFAULT_LIMIT, DEFAULT_PAGE, LOST_STATUSES, listQuerySchema } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";

const STATUS_OPTIONS = LOST_STATUSES.map((s) => ({ value: s, label: s }));

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LostListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = normalizeSearchParams(await searchParams);
  // `type` is always "lost" here regardless of the URL -- this board's
  // identity isn't user-controlled the way it is on /search.
  const parsed = listQuerySchema.safeParse({ ...raw, type: "lost" });
  const query = parsed.success ? parsed.data : { type: "lost" as const, page: DEFAULT_PAGE, limit: DEFAULT_LIMIT };
  // Phase 13-2: previously called listLostPosts() directly, which silently
  // ignored `mode=semantic` (the SearchFilterBar toggle had no effect on
  // this page -- see Phase 13-1's finding). Keyword mode reuses the same
  // searchPosts() every other caller goes through; semantic mode fetches
  // /api/posts instead of calling searchPosts() in-process -- see
  // searchApiClient.ts's comment for why (Vercel Hobby-plan function-count
  // limit).
  const mode = parsed.success ? parsed.data.mode : "keyword";

  let posts;
  try {
    posts =
      mode === "semantic"
        ? await fetchPostsFromApi({ ...raw, type: "lost" })
        : await searchPosts(query);
  } catch (error) {
    console.error("Failed to load lost posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">분실물 게시판</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          게시물을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">분실물 게시판</h1>
        <Link
          href="/lost/new"
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
        >
          분실물 등록
        </Link>
      </div>
      <SearchFilterBar basePath="/lost" statusOptions={STATUS_OPTIONS} />
      <SemanticSearchNotice mode={mode} />
      {posts.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {raw.q || raw.category || raw.location || raw.status
            ? "검색 결과가 없습니다."
            : "등록된 분실물 게시글이 없습니다."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.items.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
      <Pagination basePath="/lost" currentSearchParams={raw} page={posts.page} totalPages={posts.totalPages} />
    </div>
  );
}
