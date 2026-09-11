"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CAMPUSES, CATEGORIES } from "@/lib/posts/schema";
import type { PostListType, PostType, SortOption } from "@/lib/posts/schema";
import { AISearchPanel } from "./AISearchPanel";

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
  // Phase 32/33: /search, /lost, and /found all pass this now. AI 검색
  // 고도화 Phase: same prop, now gates the unified "AI 검색" tab
  // (AISearchPanel, text+image) instead of the old image-only tab -- every
  // existing call site already passes this, so nothing else changed.
  imageSearchEnabled?: boolean;
  // Phase 33: /lost and /found each fix the board server-side (never
  // rendered as a selector -- see showTypeFilter's own comment), so
  // AISearchPanel has no `type` state to read there the way /search's own
  // type <select> provides. Only meaningful when showTypeFilter is false;
  // ignored (the type <select>'s own state wins) otherwise.
  fixedType?: PostType;
  // Phase 32: the page's own (server-rendered) keyword results +
  // pagination, passed down so this component can hide them while
  // AISearchPanel owns the results area instead (AI 검색 never navigates,
  // so the page itself has no way to know to hide them on its own). /lost
  // and /found don't pass this (their results stay siblings of this
  // component, exactly as before) -- omitted here renders nothing, so
  // their layout is completely unaffected.
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

// AI 검색 고도화 Phase: 이 앱의 검색 방식은 이제 정확히 둘 -- "키워드
// 검색"(기존 title/description contains 검색, AI 미사용, 텍스트 필수)과
// "AI 검색"(텍스트/이미지 중 하나 이상, AISearchPanel). 예전에 별도
// 라디오였던 "AI 의미 검색"과 "이미지로 검색"은 하나로 합쳐졌다 --
// listQuerySchema의 mode="semantic"이나 POST .../mode=image 자체가 없어진
// 것은 아니고(서버 쪽 함수는 그대로 재사용된다, aiService.ts 참고), 이
// UI에서 그 둘을 따로 고를 필요가 없어졌을 뿐이다.
type LocalMode = "keyword" | "ai";
const MODE_LABELS: Record<LocalMode, string> = {
  keyword: "키워드 검색",
  ai: "AI 검색",
};

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
  // uncontrolled defaultValue selects like the rest of this form) because
  // AISearchPanel (mode="ai") needs the current `type` as a live value,
  // not just at submit time -- AI 검색 never navigates (see handleSubmit's
  // own comment), so it has no other way to read the selected board. AI 검색
  // 고도화 Phase: initial state only ever recognizes "ai" from the URL's
  // own `mode` param (an old bookmarked `?mode=semantic`/`?mode=image` link
  // simply falls back to "keyword", the safe default -- neither of those
  // values is a valid LocalMode any more, see this file's own LocalMode
  // comment).
  const [mode, setMode] = useState<LocalMode>(searchParams.get("mode") === "ai" ? "ai" : "keyword");
  const [type, setType] = useState<PostListType>((searchParams.get("type") as PostListType | null) ?? "all");
  // Phase 33: the board AI 검색 actually targets -- /search's own type
  // <select> when present, otherwise the page's fixed board (/lost ->
  // "lost", /found -> "found"). Never "all" once fixedType is given.
  const aiSearchType: PostListType = showTypeFilter ? type : (fixedType ?? "all");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Phase 32/AI 검색 고도화: AI 검색 mode never navigates -- AISearchPanel
    // (rendered below in place of the usual query/filter fields) has its
    // own submit button and does its own client-side fetch instead.
    if (mode === "ai") return;

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
      {/* UI/UX 최종 개선: 기본 브라우저 라디오 버튼 3개를 한 줄에 늘어놓던
          기존 모습은 이 앱의 다른 모든 "여러 선택지 중 하나" UI(단체 허브의
          활성/폐쇄 필터, 탭 등)가 이미 쓰는 segmented pill 스타일과 어긋나
          "이게 서로 배타적인 3가지 모드"라는 것이 한눈에 들어오지 않았다.
          접근성/폼 제출 방식(name="mode" 라디오, controlled)은 그대로 두고
          시각적 표현만 organizations/page.tsx의 기존 필터 pill과 동일한
          외형으로 맞춘다 -- 새 색이나 컴포넌트 없이 기존 토큰만 재사용. */}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="검색 방식">
        <label
          className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "keyword"
              ? "border-primary bg-primary-muted text-primary"
              : "border-border text-muted-foreground hover:border-foreground/30"
          }`}
        >
          <input
            type="radio"
            name="mode"
            value="keyword"
            checked={mode === "keyword"}
            onChange={() => setMode("keyword")}
            className="sr-only"
          />
          {MODE_LABELS.keyword}
        </label>
        {imageSearchEnabled && (
          <label
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "ai"
                ? "border-primary bg-primary-muted text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30"
            }`}
          >
            <input
              type="radio"
              name="mode"
              value="ai"
              checked={mode === "ai"}
              onChange={() => setMode("ai")}
              className="sr-only"
            />
            {MODE_LABELS.ai}
          </label>
        )}
      </div>

      {mode === "ai" ? (
        <>
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
          <AISearchPanel type={aiSearchType} />
        </>
      ) : (
        <>
          <input
            name="q"
            type="text"
            placeholder="검색어를 입력하세요"
            defaultValue={searchParams.get("q") ?? ""}
            maxLength={100}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
          />

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
              className="ml-auto rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              검색
            </button>
          </div>
        </>
      )}

      {mode !== "ai" && hasActiveFilters && (
        <button
          type="button"
          onClick={() => router.push(basePath)}
          className="self-start text-xs text-muted-foreground underline hover:text-foreground"
        >
          필터 초기화
        </button>
      )}
    </form>
    {mode !== "ai" && children}
    </>
  );
}
