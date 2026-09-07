import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { searchPosts } from "@/lib/posts/service";
import { fetchPostsFromApi } from "@/lib/posts/searchApiClient";
import { DEFAULT_LIMIT, DEFAULT_PAGE, FOUND_STATUSES, listQuerySchema } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";

const STATUS_OPTIONS = FOUND_STATUSES.map((s) => ({ value: s, label: s }));

type SearchParams = Record<string, string | string[] | undefined>;

export default async function FoundListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = normalizeSearchParams(await searchParams);
  const parsed = listQuerySchema.safeParse({ ...raw, type: "found" });
  const baseQuery = parsed.success ? parsed.data : { type: "found" as const, page: DEFAULT_PAGE, limit: DEFAULT_LIMIT };
  // Phase 31: see the matching comment in lost/page.tsx -- no explicit
  // status filter defaults to "보관 중" (still in-progress) rather than
  // every status ever recorded.
  const query = { ...baseQuery, status: raw.status ?? FOUND_STATUSES[0] };
  // Phase 13-2: see the matching comment in lost/page.tsx -- previously
  // listFoundPosts() ignored `mode=semantic` entirely.
  const mode = parsed.success ? parsed.data.mode : "keyword";

  let posts;
  try {
    posts =
      mode === "semantic"
        ? await fetchPostsFromApi({ ...raw, type: "found" })
        : await searchPosts(query);
  } catch (error) {
    console.error("Failed to load found posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">습득물 게시판</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          게시물을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">습득물 게시판</h1>
        <LinkButton href="/found/new" size="sm">
          습득물 등록
        </LinkButton>
      </div>
      <SearchFilterBar
        basePath="/found"
        statusOptions={STATUS_OPTIONS}
        defaultStatus={FOUND_STATUSES[0]}
        imageSearchEnabled
        fixedType="found"
      >
        <SemanticSearchNotice mode={mode} />
        {posts.items.length === 0 ? (
          <EmptyState
            title={raw.q || raw.category || raw.campus || raw.status ? "검색 결과가 없어요." : "아직 등록된 습득물이 없어요."}
            description={
              raw.q || raw.category || raw.campus || raw.status
                ? "다른 검색어나 필터로 다시 시도해보세요."
                : "주운 물건을 등록해서 주인을 찾아주세요."
            }
            action={
              !(raw.q || raw.category || raw.campus || raw.status) && (
                <LinkButton href="/found/new">습득물 등록하기</LinkButton>
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
        <Pagination basePath="/found" currentSearchParams={raw} page={posts.page} totalPages={posts.totalPages} />
      </SearchFilterBar>
    </div>
  );
}
