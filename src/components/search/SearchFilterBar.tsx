"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CAMPUSES, CATEGORIES } from "@/lib/posts/schema";
import type { PostListType, PostType, SortOption } from "@/lib/posts/schema";
import { AISearchPanel } from "./AISearchPanel";
import { SearchModeToggle, type SearchUiMode } from "./SearchModeToggle";
import { SearchIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { campusLabelKey, categoryLabelKey } from "@/lib/i18n/labels";
import type { TranslationKey } from "@/lib/i18n/translate";

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
  // 검색 기본 모드 UX 수정 Phase: URL에 `mode`가 전혀 없는 첫 방문에서
  // 이 토글이 시작할 모드. 기본값 "ai"는 /search의 기존 동작 그대로다
  // (이 prop을 생략하는 유일한 호출자). /lost, /found는 "keyword"를
  // 넘긴다 -- 두 페이지는 listQuerySchema의 `mode` 필드 자체가 이미
  // "keyword"를 기본값으로 두고 있어(schema.ts 참고) 서버가 방금
  // 렌더링해 children으로 내려준 결과가 항상 키워드 검색 결과인데,
  // 이 토글의 클라이언트 쪽 초기 상태가 그것과 무관하게 "ai"였던 것이
  // 문제였다 -- mode="ai"인 동안은 `{mode !== "ai" && children}`이
  // children을 숨기므로, 게시판에 처음 들어갔을 때 이미 불러온 목록
  // 대신 텅 빈 AI 검색창이 보이는 결과가 됐다. 서버가 이미 내려준
  // 기본값과 클라이언트 초기 상태를 일치시키는 것뿐, 두 모드의 실제
  // 검색 로직/우선순위(URL의 명시적 mode가 항상 최우선)는 그대로다.
  defaultMode?: SearchUiMode;
};

// 검색 대상 및 게시글 목록 UX 개선 Phase: 습득물이 먼저 나오는 순서로
// 재배치했다 -- 이 서비스는 "잃어버린 물건을 찾기 위한" 검색이 기본
// 시나리오이므로(§1), 셀렉트 목록의 첫 항목도 그 기본값(습득물)과
// 일치시킨다. 값 자체(all/lost/found)와 이 배열을 쓰는 다른 곳(엄격한
// listQuerySchema 등)은 전혀 바뀌지 않았다 -- 순서만 바뀌었다. export한
// 이유는 HomeSearchBar도 정확히 같은 3개 선택지를 같은 순서로 보여줘야
// 하기 때문(§3) -- 새 목록을 따로 만들지 않고 이 배열 하나를 공유한다.
// 다국어(i18n) Phase: value(all/lost/found)는 listQuerySchema가 검증하는
// 값이라 그대로 두고, 화면에 보이는 라벨만 번역 키로 바꿨다 -- 순서도
// 그대로다(습득물 먼저).
export const TYPE_OPTIONS: { value: PostListType; labelKey: TranslationKey }[] = [
  { value: "found", labelKey: "search.type.found" },
  { value: "lost", labelKey: "search.type.lost" },
  { value: "all", labelKey: "search.type.all" },
];

const SORT_OPTIONS: { value: SortOption; labelKey: TranslationKey }[] = [
  { value: "latest", labelKey: "search.sort.latest" },
  { value: "oldest", labelKey: "search.sort.oldest" },
];

// AI 검색 고도화 Phase: 이 앱의 검색 방식은 정확히 둘 -- "키워드 검색"
// (기존 title/description contains 검색, AI 미사용, 텍스트 필수)과
// "AI 검색"(텍스트/이미지 중 하나 이상, AISearchPanel). 예전에 별도
// 라디오였던 "AI 의미 검색"과 "이미지로 검색"은 하나로 합쳐졌다 --
// listQuerySchema의 mode="semantic"이나 POST .../mode=image 자체가 없어진
// 것은 아니고(서버 쪽 함수는 그대로 재사용된다, aiService.ts 참고), 이
// UI에서 그 둘을 따로 고를 필요가 없어졌을 뿐이다. 토글 자체(라벨/모양)는
// SearchModeToggle이 소유 -- Home의 검색창과 정확히 같은 컴포넌트를 써서
// 화면마다 검색 UI가 다르게 보이지 않게 한다.

export function SearchFilterBar({
  basePath,
  showTypeFilter = false,
  statusOptions,
  defaultStatus,
  imageSearchEnabled = false,
  fixedType,
  children,
  defaultMode = "ai",
}: SearchFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const hasActiveFilters = ["q", "category", "campus", "status", "sort", "mode"].some((key) =>
    searchParams.get(key),
  );

  // mode/type need to be tracked as component state (not left as plain
  // uncontrolled defaultValue selects like the rest of this form) because
  // AISearchPanel (mode="ai") needs the current `type` as a live value,
  // not just at submit time -- AI 검색 never navigates (see handleSubmit's
  // own comment), so it has no other way to read the selected board.
  // AI 검색 UI 시안 개선 Phase: /search에서는 AI 검색이 이 서비스의 기본
  // 검색 경험이므로 URL에 mode가 전혀 없을 때(첫 방문) "ai"가 기본값이다.
  // 검색 기본 모드 UX 수정 Phase: 그 기본값을 호출자가 고를 수 있도록
  // `defaultMode` prop으로 뺐다 -- /lost, /found는 "keyword"를 넘긴다(위
  // defaultMode 자체의 comment 참고). URL에 `mode=ai`나 `mode=keyword`가
  // 명시돼 있으면 항상 그 값이 defaultMode보다 우선한다 -- 예전에 유효
  // 했던 `mode=semantic`/`mode=image` 북마크처럼 둘 다 아닌 값은
  // defaultMode로 떨어진다.
  const urlMode = searchParams.get("mode");
  const [mode, setMode] = useState<SearchUiMode>(
    urlMode === "ai" || urlMode === "keyword" ? urlMode : defaultMode,
  );
  // 검색 대상 및 게시글 목록 UX 개선 Phase §1/§6: URL에 `type`이 전혀 없는
  // 첫 방문(/search를 바로 열었을 때)의 기본 검색 대상은 습득물이다 --
  // 잃어버린 물건을 찾으려고 검색하는 서비스이므로 "찾고 있는 물건이
  // 실제로 등록돼 있는 게시판"이 기본값이어야 한다는 이번 Phase의 방향
  // 그대로. `type=all`/`type=lost`가 URL에 명시돼 있으면(필터를 바꿔서
  // 검색했다가 페이지를 새로고침한 경우 등) 그 값을 그대로 존중한다 --
  // 이 컴포넌트는 /lost, /found에서도 쓰이지만 그 두 페이지는 `type`
  // state를 전혀 읽지 않고 항상 자기 자신의 fixedType만 쓰므로(아래
  // aiSearchType 참고), 이 기본값 변경은 오직 /search에만 영향을 준다.
  const [type, setType] = useState<PostListType>((searchParams.get("type") as PostListType | null) ?? "found");
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
    {/* AI 검색 UI 시안 개선 Phase: 바깥 컨테이너를 <form>에서 <div>로 바꿨다
        -- AISearchPanel이 이제 자기 자신의 <form>(엔터로 검색 가능)을
        가지므로, 예전처럼 그 전체를 다시 <form>으로 감싸면 <form> 중첩이
        된다(유효하지 않은 HTML). 키워드 모드에서만 실제 제출이 필요한
        필드들을 안쪽의 별도 <form>으로 묶었다 -- handleSubmit이 읽는
        FormData의 모양은 그대로다. */}
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      {/* Home의 검색창과 똑같은 SearchModeToggle -- 화면마다 검색 UI가
          다른 제품처럼 보이지 않도록 라벨/모양을 한 곳에서만 정의한다.
          imageSearchEnabled=false인 호출자는 없지만(현재 /search, /lost,
          /found 모두 항상 켜서 부른다), 그 값을 존중하는 기존 계약은
          그대로 유지한다 -- AI 검색을 쓸 수 없는 곳이라면 토글 자체를
          숨기고 조용히 키워드 검색만 보여준다.
          검색 UX 최종 리뷰 Phase: AI 모드의 게시판 select를 토글과 같은
          줄에 둔다 -- Home(HomeSearchBar)이 토글+대상 select를 한 줄에
          두는 것과 똑같은 배치라, 화면마다 "토글 따로, select 따로 아래
          줄"처럼 다르게 보이던 것을 통일했다(리뷰에서 발견된 유일한 UI
          불일치, §6). 키워드 모드의 게시판 select는 원래도 category/
          campus/sort와 한 줄에 묶여 있던 기존 필터 그룹이라 그대로 둔다
          -- 그 자체는 이번 Phase의 지적 대상이 아니었다. */}
      {imageSearchEnabled && (
        <div className="flex flex-wrap items-center gap-1.5">
          <SearchModeToggle mode={mode} onChange={setMode} />
          {mode === "ai" && showTypeFilter && (
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PostListType)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm"
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {mode === "ai" && imageSearchEnabled ? (
        <AISearchPanel type={aiSearchType} />
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* AI 검색 입력창(AISearchPanel)과 같은 pill 모양 -- 모드를
              바꿔도 "검색창"이라는 형태 자체는 그대로 유지되고, 그 안의
              보조 입력(사진 첨부 vs 없음)만 달라진다는 걸 시각적으로
              보여준다. */}
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 shadow-sm transition-colors focus-within:border-primary">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              name="q"
              type="text"
              placeholder={t("search.placeholder")}
              defaultValue={searchParams.get("q") ?? ""}
              maxLength={100}
              className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t("common.search")}
            </button>
          </div>

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
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            )}

            <select
              name="category"
              aria-label={t("search.filter.category")}
              defaultValue={currentCategory}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              <option value="">{t("search.filter.categoryAll")}</option>
              {currentCategory && !(CATEGORIES as readonly string[]).includes(currentCategory) && (
                <option value={currentCategory}>{currentCategory}</option>
              )}
              {/* 다국어(i18n) Phase: value는 항상 DB에 저장된 한국어
                  원문이고(그래야 검색/필터가 그대로 동작한다), 표시
                  라벨만 번역한다 -- labels.ts의 categoryLabelKey가
                  목록에 없는 값에는 null을 돌려주므로 예전 자유 입력
                  카테고리는 원문 그대로 보인다. */}
              {CATEGORIES.map((c) => {
                const key = categoryLabelKey(c);
                return (
                  <option key={c} value={c}>
                    {key ? t(key) : c}
                  </option>
                );
              })}
            </select>

            {statusOptions && (
              <select
                name="status"
                defaultValue={currentStatus}
                className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
              >
                <option value="">{t("search.filter.statusAll")}</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}

            <select
              name="campus"
              aria-label={t("search.filter.campus")}
              defaultValue={currentCampus}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              <option value="">{t("search.filter.campusAll")}</option>
              {CAMPUSES.map((c) => {
                const key = campusLabelKey(c);
                return (
                  <option key={c} value={c}>
                    {key ? t(key) : c}
                  </option>
                );
              })}
            </select>

            <select
              name="sort"
              aria-label={t("search.filter.sort")}
              defaultValue={searchParams.get("sort") ?? "latest"}
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => router.push(basePath)}
                className="self-center text-xs text-muted-foreground underline hover:text-foreground"
              >
                {t("search.resetFilters")}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
    {mode !== "ai" && children}
    </>
  );
}
