"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CATEGORIES, SEARCH_MODES } from "@/lib/posts/schema";
import type { PostListType, SearchMode, SortOption } from "@/lib/posts/schema";

type StatusOption = { value: string; label: string };

type SearchFilterBarProps = {
  basePath: string; // where the form navigates to on submit, e.g. "/lost", "/search"
  showTypeFilter?: boolean; // the 게시판 selector only makes sense on /search
  // Board-specific (Phase 9): LostPost's two statuses differ from
  // FoundPost's, and listQuerySchema rejects a status filter when
  // type=all (see its own superRefine) -- so this is only ever passed by
  // /lost and /found, each with their own two options, never by /search.
  statusOptions?: StatusOption[];
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

export function SearchFilterBar({ basePath, showTypeFilter = false, statusOptions }: SearchFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasActiveFilters = ["q", "category", "location", "status", "sort", "mode"].some((key) =>
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
  const [mode, setMode] = useState<SearchMode>((searchParams.get("mode") as SearchMode | null) ?? "keyword");
  const [type, setType] = useState<PostListType>((searchParams.get("type") as PostListType | null) ?? "all");
  // Only meaningful when showTypeFilter is true (/search) -- everywhere
  // else (/lost, /found) `type` is fixed server-side to one board and
  // never rendered as a selector at all, so this can never actually be
  // true there regardless of this component's own `type` state.
  const semanticBlockedByType = showTypeFilter && mode === "semantic" && type === "all";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (semanticBlockedByType) return;

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "type", "category", "location", "status", "sort", "mode"]) {
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
  const currentStatus = searchParams.get("status") ?? "";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
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
      </div>

      <input
        name="q"
        type="text"
        placeholder={mode === "semantic" ? "예: 검은색 에어팟을 도서관에서 잃어버렸어요" : "검색어를 입력하세요"}
        defaultValue={searchParams.get("q") ?? ""}
        maxLength={100}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
      />

      {semanticBlockedByType && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          AI 의미 검색은 분실물 또는 습득물 게시판을 선택한 경우에만 사용할 수 있습니다.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {showTypeFilter && (
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as PostListType)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
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
          defaultValue={currentCategory}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
          >
            <option value="">상태 전체</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        <input
          name="location"
          type="text"
          placeholder="위치"
          defaultValue={searchParams.get("location") ?? ""}
          maxLength={200}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
        />

        <select
          name="sort"
          defaultValue={searchParams.get("sort") ?? "latest"}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-transparent"
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
          className="ml-auto rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
        >
          검색
        </button>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => router.push(basePath)}
          className="self-start text-xs text-zinc-500 underline dark:text-zinc-400"
        >
          필터 초기화
        </button>
      )}
    </form>
  );
}
