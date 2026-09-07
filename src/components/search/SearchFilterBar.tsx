"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CAMPUSES, CATEGORIES, SEARCH_MODES } from "@/lib/posts/schema";
import type { PostListType, PostType, SearchMode, SortOption } from "@/lib/posts/schema";
import { ImageSearchPanel } from "./ImageSearchPanel";

type StatusOption = { value: string; label: string };

type SearchFilterBarProps = {
  basePath: string; // where the form navigates to on submit, e.g. "/lost", "/search"
  showTypeFilter?: boolean; // the 게시판 selector only makes sense on /search
  // Board-specific (Phase 9): LostPost's two statuses differ from
  // FoundPost's, and listQuerySchema rejects a status filter when
  // type=all (see its own superRefine) -- so this is only ever passed by
  // /lost and /found, each with their own two options, never by /search.
  statusOptions?: StatusOption[];
  // Phase 31: the status the *page* actually queries with when the URL
  // carries no explicit ?status= (see lost/found page.tsx) -- shown here
  // as this <select>'s default so it never lies about what's currently
  // filtered. Irrelevant (and unused) wherever statusOptions is omitted.
  defaultStatus?: string;
  // Phase 32/33: /search, /lost, and /found all pass this now.
  imageSearchEnabled?: boolean;
  // Phase 33: /lost and /found each fix the board server-side (never
  // rendered as a selector -- see showTypeFilter's own comment), so
  // ImageSearchPanel has no `type` state to read there the way /search's
  // own type <select> provides. Only meaningful when showTypeFilter is
  // false; ignored (the type <select>'s own state wins) otherwise.
  fixedType?: PostType;
  // Phase 32: the page's own (server-rendered) keyword/semantic results +
  // pagination, passed down so this component can hide them while
  // ImageSearchPanel owns the results area instead (image mode never
  // navigates, so the page itself has no way to know to hide them on its
  // own). /lost and /found don't pass this (their results stay siblings of
  // this component, exactly as before) -- omitted here renders nothing,
  // so their layout is completely unaffected.
  children?: ReactNode;
};

const TYPE_OPTIONS: { value: PostListType; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "lost", label: "분실물" },
  { value: "found", label: "습득물" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "latest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
];

// Legacy pages/1,2's exact two modes (st.radio(["키워드 검색", "AI 의미
// 검색"])) -- see docs/AI_SEMANTIC_SEARCH_DESIGN.md section 5. Reuses
// SEARCH_MODES (posts/schema.ts) rather than redeclaring the two values.
const MODE_LABELS: Record<SearchMode, string> = {
  keyword: "키워드 검색",
  semantic: "AI 의미 검색",
};

type LocalMode = SearchMode | "image";

export function SearchFilterBar({
  basePath,
  showTypeFilter = false,
  statusOptions,
  defaultStatus,
  imageSearchEnabled = false,
  fixedType,
  children,
}: SearchFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasActiveFilters = ["q", "category", "campus", "status", "sort", "mode"].some((key) =>
    searchParams.get(key),
  );

  // mode/type need to be tracked as component state (not left as plain
  // uncontrolled defaultValue selects like the rest of this form) only
  // because these two specific fields interact: mode=semantic is
  // rejected by listQuerySchema whenever type=all (see its superRefine --
  // there's no single pgvector column spanning both LostPost and
  // FoundPost, so a "search everything" semantic query has nothing valid
  // to rank against). Catching that combination here, before it ever
  // reaches the server, avoids a submit that silently comes back with the
  // wrong results instead of an explanation.
  const [mode, setMode] = useState<LocalMode>((searchParams.get("mode") as SearchMode | null) ?? "keyword");
  const [type, setType] = useState<PostListType>((searchParams.get("type") as PostListType | null) ?? "all");
  // Only meaningful when showTypeFilter is true (/search) -- everywhere
  // else (/lost, /found) `type` is fixed server-side to one board and
  // never rendered as a selector at all, so this can never actually be
  // true there regardless of this component's own `type` state.
  const semanticBlockedByType = showTypeFilter && mode === "semantic" && type === "all";
  // Phase 33: the board image search actually targets -- /search's own
  // type <select> when present, otherwise the page's fixed board
  // (/lost -> "lost", /found -> "found"). Never "all" once fixedType is
  // given, so the "select a board" warning below never fires on those two
  // pages.
  const imageSearchType: PostListType = showTypeFilter ? type : (fixedType ?? "all");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Phase 32: image mode never navigates -- ImageSearchPanel (rendered
    // below in place of the usual query/filter fields) has its own submit
    // button and does its own client-side fetch instead.
    if (semanticBlockedByType || mode === "image") return;

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "type", "category", "campus", "status", "sort", "mode"]) {
      const value = formData.get(key);
      if (typeof value === "string" && value.trim() !== "") {
        params.set(key, value.trim());
      }
    }
    // A new search always starts from page 1 -- keeping the old page
    // number here could point past the end of the new result set.

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  // Editing an existing post can leave a post's category outside
  // CATEGORIES (see PostForm's own handling of the same situation) -- if
  // the current filter value is one of those, it's kept selectable here
  // too rather than being silently reset to "전체" on the next render.
  const currentCategory = searchParams.get("category") ?? "";
  const currentStatus = searchParams.get("status") ?? defaultStatus ?? "";
  const currentCampus = searchParams.get("campus") ?? "";

  return (
    <>
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {SEARCH_MODES.map((m) => (
          <label key={m} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            {MODE_LABELS[m]}
          </label>
        ))}
        {imageSearchEnabled && (
          <label className="flex items-center gap-1.5">
            <input type="radio" name="mode" value="image" checked={mode === "image"} onChange={() => setMode("image")} />
            이미지로 검색
          </label>
        )}
      </div>

      {mode === "image" ? (
        <>
          {imageSearchType === "all" && (
            <p className="text-xs text-warning">
              이미지 검색은 분실물 또는 습득물 게시판을 선택한 경우에만 사용할 수 있습니다.
            </p>
          )}
          {showTypeFilter && (
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PostListType)}
              className="w-fit rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          <ImageSearchPanel type={imageSearchType} />
        </>
      ) : (
        <>
          <input
            name="q"
            type="text"
            placeholder={mode === "semantic" ? "예: 검은색 에어팟을 도서관에서 잃어버렸어요" : "검색어를 입력하세요"}
            defaultValue={searchParams.get("q") ?? ""}
            maxLength={100}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
          />

          {semanticBlockedByType && (
            <p className="text-xs text-warning">
              AI 의미 검색은 분실물 또는 습득물 게시판을 선택한 경우에만 사용할 수 있습니다.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {showTypeFilter && (
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as PostListType)}
                className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}

            <select
              name="category"
              aria-label="카테고리"
              defaultValue={currentCategory}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              <option value="">카테고리 전체</option>
              {currentCategory && !(CATEGORIES as readonly string[]).includes(currentCategory) && (
                <option value={currentCategory}>{currentCategory}</option>
              )}
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {statusOptions && (
              <select
                name="status"
                defaultValue={currentStatus}
                className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
              >
                <option value="">상태 전체</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}

            <select
              name="campus"
              aria-label="캠퍼스"
              defaultValue={currentCampus}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              <option value="">캠퍼스 전체</option>
              {CAMPUSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              name="sort"
              aria-label="정렬"
              defaultValue={searchParams.get("sort") ?? "latest"}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={semanticBlockedByType}
              className="ml-auto rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              검색
            </button>
          </div>
        </>
      )}

      {mode !== "image" && hasActiveFilters && (
        <button
          type="button"
          onClick={() => router.push(basePath)}
          className="self-start text-xs text-muted-foreground underline hover:text-foreground"
        >
          필터 초기화
        </button>
      )}
    </form>
    {mode !== "image" && children}
    </>
  );
}
