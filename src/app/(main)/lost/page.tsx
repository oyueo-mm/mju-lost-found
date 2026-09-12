import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Lost112Notice } from "@/components/search/Lost112Notice";
import { LinkButton } from "@/components/ui/Button";
import { searchPosts } from "@/lib/posts/service";
import { fetchPostsFromApi } from "@/lib/posts/searchApiClient";
import { DEFAULT_LIMIT, DEFAULT_PAGE, LOST_STATUSES, listQuerySchema } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";
import { getTranslator } from "@/lib/i18n/server";
import { statusLabelKey } from "@/lib/i18n/labels";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LostListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = normalizeSearchParams(await searchParams);
  const t = await getTranslator();
  // 다국어(i18n) Phase: `value`는 언제나 DB에 저장된 한국어 원문 그대로다
  // (listQuerySchema가 검증하는 값이므로 절대 번역하지 않는다) -- 화면에
  // 보이는 `label`만 현재 언어로 바뀐다.
  const statusOptions = LOST_STATUSES.map((s) => ({ value: s, label: t(statusLabelKey(s)) }));
  // `type` is always "lost" here regardless of the URL -- this board's
  // identity isn't user-controlled the way it is on /search.
  const parsed = listQuerySchema.safeParse({ ...raw, type: "lost" });
  const baseQuery = parsed.success ? parsed.data : { type: "lost" as const, page: DEFAULT_PAGE, limit: DEFAULT_LIMIT };
  // Phase 31: no explicit status filter defaults to "찾는 중" (still
  // in-progress) rather than every status ever recorded -- browsing this
  // board is about items still being looked for, not archived "찾음"
  // posts. LOST_STATUSES[0] is that in-progress status by construction
  // (see its own definition). Only applied when `status` is absent from
  // the URL -- an explicit ?status=찾음 still works exactly as before.
  const query = { ...baseQuery, status: raw.status ?? LOST_STATUSES[0] };
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
        <h1 className="text-xl font-semibold text-foreground">{t("board.lost.title")}</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          {t("board.loadError")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">{t("board.lost.title")}</h1>
        <LinkButton href="/lost/new" size="sm">
          {t("board.lost.new")}
        </LinkButton>
      </div>
      <SearchFilterBar
        basePath="/lost"
        statusOptions={statusOptions}
        defaultStatus={LOST_STATUSES[0]}
        imageSearchEnabled
        fixedType="lost"
        // 검색 기본 모드 UX 수정 Phase: 게시판에 처음 들어왔을 때는 이미
        // 서버가 불러온 게시글 목록(children)이 바로 보여야 한다 -- AI
        // 검색은 여전히 토글로 켤 수 있지만 기본은 키워드다.
        defaultMode="keyword"
      >
        <SemanticSearchNotice mode={mode} />
        {posts.items.length === 0 ? (
          <div className="flex flex-col gap-4">
            <EmptyState
              title={
                raw.q || raw.category || raw.campus || raw.status
                  ? t("search.empty.title")
                  : t("board.lost.empty.title")
              }
              description={
                raw.q || raw.category || raw.campus || raw.status
                  ? t("search.empty.description")
                  : t("board.lost.empty.description")
              }
              action={
                !(raw.q || raw.category || raw.campus || raw.status) && (
                  <LinkButton href="/lost/new">{t("board.lost.newCta")}</LinkButton>
                )
              }
            />
            <Lost112Notice />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {posts.items.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
        <Pagination basePath="/lost" currentSearchParams={raw} page={posts.page} totalPages={posts.totalPages} />
      </SearchFilterBar>
    </div>
  );
}
