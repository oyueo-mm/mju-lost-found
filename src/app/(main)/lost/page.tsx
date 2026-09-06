import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
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
        <h1 className="text-xl font-semibold text-foreground">분실물 게시판</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          게시물을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">분실물 게시판</h1>
        <LinkButton href="/lost/new" size="sm">
          분실물 등록
        </LinkButton>
      </div>
      <SearchFilterBar basePath="/lost" statusOptions={STATUS_OPTIONS} />
      <SemanticSearchNotice mode={mode} />
      {posts.items.length === 0 ? (
        <EmptyState
          title={raw.q || raw.category || raw.location || raw.status ? "검색 결과가 없어요." : "아직 등록된 분실물이 없어요."}
          description={
            raw.q || raw.category || raw.location || raw.status
              ? "다른 검색어나 필터로 다시 시도해보세요."
              : "가장 먼저 물건을 등록해보세요."
          }
          action={
            !(raw.q || raw.category || raw.location || raw.status) && (
              <LinkButton href="/lost/new">분실물 등록하기</LinkButton>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {posts.items.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
      <Pagination basePath="/lost" currentSearchParams={raw} page={posts.page} totalPages={posts.totalPages} />
    </div>
  );
}
