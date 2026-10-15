"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CAMPUSES } from "@/lib/posts/schema";
import type { PostListType, PostType, SortOption } from "@/lib/posts/schema";
import { AISearchPanel } from "./AISearchPanel";
import { CategoryFilterSelects } from "./CategoryFilterSelects";
import {
  categoryFilterToEntries,
  readCategoryFilterState,
  withCategoryFilterParams,
  type CategoryFilterState,
} from "./categoryFilterParams";
import { EventPeriodFilter } from "./EventPeriodFilter";
import { isPeriodRangeInvalid, periodStateToEntries, readPeriodState, withPeriodParams, type PeriodState } from "./periodParams";
import { resolveSearchUiMode, SEARCH_MODE_PARAM, withSearchMode } from "./searchModeParams";
import { SearchModeToggle, type SearchUiMode } from "./SearchModeToggle";
import { ChevronDownIcon, SearchIcon, XIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { campusLabelKey } from "@/lib/i18n/labels";
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
  // 게시판 리디자인 Phase: total matching posts, shown next to the sort
  // order above the results (keyword mode). Omitted -> no count.
  resultCount?: number;
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
  resultCount,
}: SearchFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const hasActiveFilters = ["q", "category", "categoryCode", "subcategory", "campus", "status", "sort", "mode", "period"].some((key) =>
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
  // 검색 모드 URL 상태 Phase: the mode now lives in the URL
  // (`searchMode=ai|keyword`, see searchModeParams.ts for why not `mode`)
  // and is derived from it on every render, so a refresh, a shared link and
  // the back/forward buttons all restore it. Switching pushes a history
  // entry (Next.js syncs native pushState with useSearchParams) and keeps
  // every other parameter -- period, category, type, ... -- untouched.
  const mode: SearchUiMode = resolveSearchUiMode(searchParams, defaultMode);

  function changeMode(next: SearchUiMode) {
    if (next === mode) return;
    const query = withSearchMode(window.location.search, next, defaultMode);
    window.history.pushState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }

  // Where a keyword submit / 필터 초기화 navigates must still say "keyword"
  // on a page whose default is AI (/search) -- otherwise it reopens in AI.
  const keepModeParam = (params: URLSearchParams) => {
    if (mode !== defaultMode) params.set(SEARCH_MODE_PARAM, mode);
    return params;
  };
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
  // The board the keyword filters apply to (the period label names its
  // time field): /search's type select, otherwise the page's fixed board.
  const keywordBoardType: PostListType = showTypeFilter ? type : (fixedType ?? "all");

  // 기간 검색 필터 (분실/습득 시점 기준): seeded from the URL (the source of
  // truth, so shared links keep the filter) and shared by both modes.
  // Keyword mode applies it on submit like every other filter here; AI
  // mode (which never navigates) sends it with each search and mirrors it
  // into the current URL right away so the address bar stays shareable.
  const [periodState, setPeriodState] = useState<PeriodState>(() => readPeriodState(searchParams));
  // 카테고리 대분류 -> 소분류 필터: same URL-backed pattern as the period
  // filter above (categoryFilterParams.ts), shared by both modes.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterState>(() => readCategoryFilterState(searchParams));
  const aiFilterQuery = new URLSearchParams([
    ...periodStateToEntries(periodState),
    ...categoryFilterToEntries(categoryFilter),
  ]).toString();

  function handleAiPeriodChange(next: PeriodState) {
    setPeriodState(next);
    const query = withPeriodParams(window.location.search, next);
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }

  function handleAiCategoryChange(next: CategoryFilterState) {
    setCategoryFilter(next);
    const query = withCategoryFilterParams(window.location.search, next);
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Phase 32/AI 검색 고도화: AI 검색 mode never navigates -- AISearchPanel
    // (rendered below in place of the usual query/filter fields) has its
    // own submit button and does its own client-side fetch instead.
    if (mode === "ai") return;

    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();

    for (const key of ["q", "type", "campus", "status", "sort", "mode"]) {
      const value = formData.get(key);
      if (typeof value === "string" && value.trim() !== "") {
        params.set(key, value.trim());
      }
    }
    // "상태 전체" on a board is an explicit `status=` -- dropping the empty
    // value would fall back to the board's default (in-progress) status,
    // so choosing 전체 used to change nothing. The pages already read an
    // empty status as "every status".
    if (statusOptions && formData.get("status") === "") params.set("status", "");
    for (const [key, value] of categoryFilterToEntries(categoryFilter)) params.set(key, value);
    // An inverted custom range is shown inline by EventPeriodFilter; don't
    // navigate to a URL the server would reject.
    if (isPeriodRangeInvalid(periodState)) return;
    for (const [key, value] of periodStateToEntries(periodState)) params.set(key, value);
    keepModeParam(params);
    // A new search always starts from page 1 -- keeping the old page
    // number here could point past the end of the new result set.

    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  const currentStatus = searchParams.get("status") ?? defaultStatus ?? "";
  const currentCampus = searchParams.get("campus") ?? "";

  // ---------- 게시판 리디자인 Phase: applied filters, chips, auto-apply ----------
  // The URL is the applied state. Filters are applied as soon as a select
  // changes (the search text still needs Enter / 검색), so what the chips
  // and the results show never drifts from what is selected.
  const urlKey = searchParams.toString();
  const formId = `search-filter-${useId().replace(/:/g, "")}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [applyTick, setApplyTick] = useState(0);
  useEffect(() => {
    if (applyTick > 0) formRef.current?.requestSubmit();
  }, [applyTick]);
  const applySoon = () => setApplyTick((n) => n + 1);

  // After a navigation (chip removed, 필터 초기화, back/forward) the
  // state-backed filters follow the URL again -- they used to keep the old
  // selection until a full reload.
  const [syncedUrlKey, setSyncedUrlKey] = useState(urlKey);
  if (syncedUrlKey !== urlKey) {
    setSyncedUrlKey(urlKey);
    setPeriodState(readPeriodState(searchParams));
    setCategoryFilter(readCategoryFilterState(searchParams));
    if (showTypeFilter) setType((searchParams.get("type") as PostListType | null) ?? "found");
  }

  function navigateWithout(keys: readonly string[]) {
    const params = new URLSearchParams(window.location.search);
    for (const key of [...keys, "page"]) params.delete(key);
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  const statusParam = searchParams.get("status");
  // Removable chips only for what the visible controls don't already show:
  // the search words and the folded 상태/캠퍼스 filters. Category,
  // subcategory and period are their own highlighted chips right above,
  // and repeating them made the search area twice as tall on a phone.
  const chips: { key: string; label: string; remove: readonly string[] }[] = [];
  const q = searchParams.get("q");
  if (q) chips.push({ key: "q", label: `“${q}”`, remove: ["q"] });
  // A status chip only when it differs from the board's default (the
  // default is part of what the board is, not a filter the user added).
  if (statusOptions && statusParam !== null && statusParam !== defaultStatus) {
    const label = statusParam === "" ? t("search.filter.statusAll") : (statusOptions.find((o) => o.value === statusParam)?.label ?? statusParam);
    chips.push({ key: "status", label, remove: ["status"] });
  }
  const campusParam = searchParams.get("campus");
  if (campusParam) {
    const key = campusLabelKey(campusParam);
    chips.push({ key: "campus", label: key ? t(key) : campusParam, remove: ["campus"] });
  }

  // 자주 쓰는 필터(카테고리, 기간, /search의 게시판)는 늘 보이고, 상태·캠퍼스는
  // "필터" 버튼 뒤에 접는다 -- 하나라도 걸려 있으면 처음부터 펼친다.
  const foldedActive = (statusOptions && statusParam !== null && statusParam !== defaultStatus ? 1 : 0) + (campusParam ? 1 : 0);
  // Starts closed even when one of them is set: the count on the button
  // and the chips below already say what is applied, and an open panel
  // made the search area much taller on a phone.
  const [moreOpen, setMoreOpen] = useState(false);
  const morePanelId = `${formId}-more`;

  // 40px tall on a phone (touch), 36px from sm. field-sizing: a select is
  // as wide as its current value, not its longest option (where supported).
  const chipBase =
    "h-10 max-w-full rounded-full border px-3 text-[13px] text-foreground field-sizing-content transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-9 sm:px-3.5 sm:text-sm";
  const chipClass = (active: boolean) =>
    `${chipBase} ${active ? "border-primary/50 bg-primary-muted font-medium text-primary" : "border-border bg-card"}`;

  function handlePeriodChipChange(next: PeriodState) {
    setPeriodState(next);
    // A custom range waits until both ends are picked and in order.
    if (next.period !== "custom" || (next.from && next.to && !isPeriodRangeInvalid(next))) applySoon();
  }

  const searchInputClass =
    "flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pr-1.5 pl-4 shadow-sm transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10";

  return (
    <>
      {/* 게시판 리디자인 Phase: no outer card box any more -- the search
          input is the one strong element (taller, with a focus ring), the
          AI/키워드 switch is a single segmented control above it, and the
          filters sit under it as light chips. */}
      <section className="flex flex-col gap-2.5 sm:gap-3" aria-label={t("search.mode.label")}>
        {imageSearchEnabled && (
          <div className="flex flex-wrap items-center gap-2">
            <SearchModeToggle mode={mode} onChange={changeMode} />
            {mode === "ai" && showTypeFilter && (
              <select
                aria-label={t("home.searchTargetLabel")}
                value={type}
                onChange={(e) => setType(e.target.value as PostListType)}
                className={chipClass(false)}
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
          <AISearchPanel
            type={aiSearchType}
            extraQuery={aiFilterQuery}
            cardVariant={fixedType ? "board" : "default"}
            belowInput={
              <div className="flex flex-wrap items-center gap-2">
                <CategoryFilterSelects
                  value={categoryFilter}
                  onChange={handleAiCategoryChange}
                  selectClassName={chipClass(Boolean(categoryFilter.categoryCode || categoryFilter.legacyCategory))}
                  emptyLabel={t("search.filter.category")}
                  subcategoryEmptyLabel={t("search.filter.subcategory")}
                />
                <EventPeriodFilter
                  value={periodState}
                  onChange={handleAiPeriodChange}
                  boardType={aiSearchType}
                  controlClassName={chipClass(Boolean(periodState.period))}
                  compactEmptyLabel
                />
              </div>
            }
          />
        ) : (
          <form key={urlKey} id={formId} ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className={searchInputClass}>
              <SearchIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <input
                name="q"
                type="search"
                aria-label={t("search.placeholder")}
                placeholder={t("search.placeholder")}
                defaultValue={searchParams.get("q") ?? ""}
                maxLength={100}
                className="h-10 w-full min-w-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              <button
                type="submit"
                className="h-10 shrink-0 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t("common.search")}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {showTypeFilter && (
                <select
                  name="type"
                  aria-label={t("home.searchTargetLabel")}
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as PostListType);
                    applySoon();
                  }}
                  className={chipClass(false)}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              )}

              {/* 카테고리 대분류-소분류: value는 언어와 무관한 taxonomy code이고
                  라벨만 번역한다. 예전 ?category= 링크는 대응하는 대분류로
                  읽힌다(categoryFilterParams.ts). */}
              <CategoryFilterSelects
                value={categoryFilter}
                onChange={(next) => {
                  setCategoryFilter(next);
                  applySoon();
                }}
                selectClassName={chipClass(Boolean(categoryFilter.categoryCode || categoryFilter.legacyCategory))}
                emptyLabel={t("search.filter.category")}
                subcategoryEmptyLabel={t("search.filter.subcategory")}
              />

              <EventPeriodFilter
                value={periodState}
                onChange={handlePeriodChipChange}
                boardType={keywordBoardType}
                controlClassName={chipClass(Boolean(periodState.period))}
                compactEmptyLabel
              />

              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls={morePanelId}
                onClick={() => setMoreOpen((open) => !open)}
                className={`${chipClass(foldedActive > 0)} inline-flex items-center gap-1.5`}
              >
                {t("search.filter.toggle")}
                {foldedActive > 0 && (
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                    {foldedActive}
                  </span>
                )}
                <ChevronDownIcon aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${moreOpen ? "rotate-180" : ""}`} />
              </button>
            </div>

            <div id={morePanelId} hidden={!moreOpen} className="flex flex-wrap items-center gap-2 rounded-card bg-muted/60 p-3">
              {statusOptions && (
                <select
                  name="status"
                  aria-label={t("search.filter.status")}
                  defaultValue={currentStatus}
                  onChange={applySoon}
                  className={chipClass(statusParam !== null && statusParam !== defaultStatus)}
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
                onChange={applySoon}
                className={chipClass(Boolean(campusParam))}
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
            </div>
          </form>
        )}

        {mode !== "ai" && (chips.length > 0 || hasActiveFilters) && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex min-h-9 max-w-full items-center gap-0.5 rounded-full bg-primary-muted pr-1 pl-3 text-xs font-medium text-primary sm:min-h-8"
              >
                <span className="truncate">{chip.label}</span>
                <button
                  type="button"
                  onClick={() => navigateWithout(chip.remove)}
                  aria-label={t("search.filter.remove", { label: chip.label })}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:size-6"
                >
                  <XIcon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                const query = keepModeParam(new URLSearchParams()).toString();
                router.push(query ? `${basePath}?${query}` : basePath);
              }}
              className="inline-flex min-h-9 items-center px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:min-h-8"
            >
              {t("search.resetFilters")}
            </button>
          </div>
        )}
      </section>

      {mode !== "ai" && (
        <>
          {/* Results toolbar: how many posts, and the sort order (still a
              field of the filter form above, through form=). */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {typeof resultCount === "number" && t("search.results.count", { count: resultCount })}
            </p>
            <select
              key={urlKey}
              form={formId}
              name="sort"
              aria-label={t("search.filter.sort")}
              defaultValue={searchParams.get("sort") ?? "latest"}
              onChange={applySoon}
              className="h-9 rounded-full bg-transparent px-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
          {children}
        </>
      )}
    </>
  );
}
