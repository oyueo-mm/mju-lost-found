import { SearchFilterBar } from "@/components/search/SearchFilterBar";
import { Pagination } from "@/components/search/Pagination";
import { SemanticSearchNotice } from "@/components/search/SemanticSearchNotice";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Lost112Notice } from "@/components/search/Lost112Notice";
import { LinkButton } from "@/components/ui/Button";
import { BoardHeader } from "@/components/search/BoardHeader";
import { BOARD_RESULTS_GRID_CLASS } from "@/components/search/resultsLayout";
import { searchPosts } from "@/lib/posts/service";
import { fetchPostsFromApi } from "@/lib/posts/searchApiClient";
import { DEFAULT_LIMIT, DEFAULT_PAGE, FOUND_STATUSES, listQuerySchema } from "@/lib/posts/schema";
import { normalizeSearchParams } from "@/lib/posts/searchParams";
import { getTranslator } from "@/lib/i18n/server";
import { statusLabelKey } from "@/lib/i18n/labels";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function FoundListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = normalizeSearchParams(await searchParams);
  // 게시판 리디자인 Phase: `status=` (empty) is the filter's "상태 전체" --
  // every status. listQuerySchema rejects an empty status (and a rejected
  // parse drops every other filter too), so it is taken out before parsing
  // and applied below as "no status filter".
  const { status: rawStatus, ...rawWithoutStatus } = raw;
  const parseInput = rawStatus ? raw : rawWithoutStatus;
  const t = await getTranslator();
  // 다국어(i18n) Phase: lost/page.tsx의 같은 주석 참고 -- value는 DB의
  // 한국어 원문, label만 번역된다.
  const statusOptions = FOUND_STATUSES.map((s) => ({ value: s, label: t(statusLabelKey(s)) }));
  const parsed = listQuerySchema.safeParse({ ...parseInput, type: "found" });
  const baseQuery = parsed.success ? parsed.data : { type: "found" as const, page: DEFAULT_PAGE, limit: DEFAULT_LIMIT };
  // Phase 31: see the matching comment in lost/page.tsx -- no explicit
  // status filter defaults to "보관 중" (still in-progress) rather than
  // every status ever recorded.
  const query = { ...baseQuery, status: rawStatus === "" ? undefined : (rawStatus ?? FOUND_STATUSES[0]) };
  // Phase 13-2: see the matching comment in lost/page.tsx -- previously
  // listFoundPosts() ignored `mode=semantic` entirely.
  const mode = parsed.success ? parsed.data.mode : "keyword";

  let posts;
  try {
    posts =
      mode === "semantic"
        ? await fetchPostsFromApi({ ...parseInput, type: "found" })
        : await searchPosts(query);
  } catch (error) {
    console.error("Failed to load found posts", error);
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">{t("board.found.title")}</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          {t("board.loadError")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <BoardHeader
        title={t("board.found.title")}
        description={t("board.found.description")}
        newHref="/found/new"
        newLabel={t("board.found.new")}
      />
      <SearchFilterBar
        basePath="/found"
        statusOptions={statusOptions}
        defaultStatus={FOUND_STATUSES[0]}
        imageSearchEnabled
        fixedType="found"
        // 검색 기본 모드 UX 수정 Phase: 게시판에 처음 들어왔을 때는 이미
        // 서버가 불러온 게시글 목록(children)이 바로 보여야 한다 -- AI
        // 검색은 여전히 토글로 켤 수 있지만 기본은 키워드다.
        defaultMode="keyword"
        resultCount={posts.total}
      >
        <SemanticSearchNotice mode={mode} />
        {posts.items.length === 0 ? (
          <div className="flex flex-col gap-4">
            <EmptyState
              title={
                raw.q || raw.category || raw.categoryCode || raw.subcategory || raw.campus || raw.status || raw.period
                  ? t("search.empty.title")
                  : t("board.found.empty.title")
              }
              description={
                raw.q || raw.category || raw.categoryCode || raw.subcategory || raw.campus || raw.status || raw.period
                  ? t("search.empty.description")
                  : t("board.found.empty.description")
              }
              action={
                raw.q || raw.category || raw.categoryCode || raw.subcategory || raw.campus || raw.status || raw.period ? (
                  <LinkButton href="/found" variant="secondary">
                    {t("search.resetFilters")}
                  </LinkButton>
                ) : (
                  <LinkButton href="/found/new">{t("board.found.newCta")}</LinkButton>
                )
              }
            />
            <Lost112Notice />
          </div>
        ) : (
          <div className={BOARD_RESULTS_GRID_CLASS}>
            {posts.items.map((post) => (
              <PostCard key={post.id} post={post} variant="board" />
            ))}
          </div>
        )}
        <Pagination basePath="/found" currentSearchParams={raw} page={posts.page} totalPages={posts.totalPages} />
      </SearchFilterBar>
    </div>
  );
}
