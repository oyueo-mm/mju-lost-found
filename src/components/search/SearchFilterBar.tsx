"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/Select";
import { CAMPUSES, type PostListType, type PostType, type SortOption } from "@/lib/posts/schema";
import { useI18n } from "@/lib/i18n/client";
import { campusLabelKey } from "@/lib/i18n/labels";
import type { TranslationKey } from "@/lib/i18n/translate";
import { fetchImagePosts, type ApiPagedResult } from "@/lib/posts/searchApiClient";
import { CategoryFilterSelects } from "./CategoryFilterSelects";
import { readCategoryFilterState, withCategoryFilterParams, type CategoryFilterState } from "./categoryFilterParams";
import { EventPeriodFilter } from "./EventPeriodFilter";
import { isPeriodRangeInvalid, readPeriodState, withPeriodParams, type PeriodState } from "./periodParams";
import { BoardViewToggle } from "./BoardViewToggle";
import { UnifiedSearchInput } from "./UnifiedSearchInput";
import { ImageSearchResults } from "./ImageSearchResults";
import { SearchResultsToolbarContext } from "./SearchResultsToolbarContext";
import { ChevronDownIcon, XIcon } from "@/components/icons";

type SearchFilterBarProps = {
  basePath: string;
  showTypeFilter?: boolean;
  statusOptions?: { value: string; label: string }[];
  defaultStatus?: string;
  imageSearchEnabled?: boolean;
  fixedType?: PostType;
  children: ReactNode;
  /** Compatibility for older callers; unified UI has no mode toggle. */
  defaultMode?: "ai" | "keyword";
  resultCount?: number;
};

export const TYPE_OPTIONS: { value: PostListType; labelKey: TranslationKey }[] = [
  { value: "found", labelKey: "search.type.found" },
  { value: "lost", labelKey: "search.type.lost" },
  { value: "all", labelKey: "search.type.all" },
];

const SORT_OPTIONS: { value: SortOption; labelKey: TranslationKey }[] = [
  { value: "relevance", labelKey: "search.sort.relevance" },
  { value: "latest", labelKey: "search.sort.latest" },
  { value: "oldest", labelKey: "search.sort.oldest" },
  { value: "views", labelKey: "search.sort.views" },
  { value: "comments", labelKey: "search.sort.comments" },
];


export function SearchFilterBar({ basePath, showTypeFilter = false, statusOptions, defaultStatus, imageSearchEnabled = false, fixedType, children, resultCount }: SearchFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const hasActiveFilters = ["q", "category", "categoryCode", "subcategory", "campus", "status", "sort", "period"].some((key) => searchParams.has(key));
  const [type, setType] = useState<PostListType>((searchParams.get("type") as PostListType | null) ?? "found");
  const keywordBoardType: PostListType = showTypeFilter ? type : (fixedType ?? "all");
  const [periodState, setPeriodState] = useState<PeriodState>(() => readPeriodState(searchParams));
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterState>(() => readCategoryFilterState(searchParams));
  const [sortChosen, setSortChosen] = useState(Boolean(searchParams.get("sort")));
  const [file, setFile] = useState<File | null>(null);
  const [imageResult, setImageResult] = useState<ApiPagedResult | null>(null);
  const [imagePending, setImagePending] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const imageParams = useRef("");
  useEffect(() => () => request.current?.abort(), []);

  async function runImage(params: URLSearchParams, page = 1) {
    request.current?.abort();
    if (!file) return;
    setImageError(null);
    setImageResult(null);
    setImagePending(false);
    if (params.get("type") === "all") { setImageError(t("aiSearch.typeConflict")); return; }
    const controller = new AbortController();
    request.current = controller;
    params.set("page", String(page));
    imageParams.current = params.toString();
    const url = new URLSearchParams(params);
    url.set("searchMode", "image");
    window.history.replaceState(null, "", `${basePath}?${url}`);
    setImagePending(true);
    try {
      const result = await fetchImagePosts(params, file, controller.signal);
      if (!controller.signal.aborted) setImageResult(result);
    } catch {
      if (!controller.signal.aborted) setImageError(t("common.networkError"));
    } finally { if (!controller.signal.aborted) setImagePending(false); }
  }

  function changeImage(next: File | null) {
    request.current?.abort();
    setFile(next);
    setImageResult(null);
    setImageError(null);
    setImagePending(false);
    if (!next && searchParams.get("searchMode") === "image") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("searchMode"); params.delete("page"); params.set("mode", searchParams.get("mode") === "keyword" ? "keyword" : "unified");
      router.push(`${basePath}?${params}`);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPeriodRangeInvalid(periodState)) return;
    const data = new FormData(event.currentTarget);
    let params = new URLSearchParams(searchParams.toString());
    for (const key of ["q", "campus", "status", "sort"]) {
      const value = data.get(key);
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
      else params.delete(key);
    }
    if (statusOptions && data.get("status") === "") params.set("status", "");
    params.set("type", keywordBoardType);
    if (keywordBoardType === "all") params.delete("status");
    if (!sortChosen) params.delete("sort");
    params.set("mode", searchParams.get("mode") === "keyword" ? "keyword" : "unified");
    params.delete("searchMode"); params.delete("page");
    params = new URLSearchParams(withCategoryFilterParams(params.toString(), categoryFilter));
    params = new URLSearchParams(withPeriodParams(params.toString(), periodState));
    if (file) { void runImage(params); return; }
    router.push(`${basePath}?${params}`);
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
    setSortChosen(Boolean(searchParams.get("sort")));
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
  // the search words and the applied 상태/캠퍼스 filters. Category,
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

  // Campus is always visible; only boards with status options need more filters.
  const hasMoreFilters = Boolean(statusOptions?.length);
  const foldedActive = statusOptions && statusParam !== null && statusParam !== defaultStatus ? 1 : 0;
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


  const displayCount = file ? imageResult?.total : resultCount;
  const renderToolbar = (count?: number) => (
    <div className="flex min-w-0 items-center justify-between gap-2" data-search-results-toolbar>
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" aria-live="polite">
        {typeof count === "number" && t("search.results.count", { count })}
      </p>
      {fixedType && <BoardViewToggle />}
      <Select
        key={urlKey}
        form={formId}
        name="sort"
        aria-label={t("search.filter.sort")}
        defaultValue={searchParams.get("sort") ?? (searchParams.get("q") ? "relevance" : "latest")}
        onChange={() => { setSortChosen(true); applySoon(); }}
        className="h-9 shrink-0 rounded-full bg-transparent px-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </Select>
    </div>
  );
  return (
    <SearchResultsToolbarContext.Provider value={renderToolbar}>
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex min-w-0 flex-col gap-2.5 sm:gap-3" aria-label={t("search.title")}>
        <form key={urlKey} id={formId} ref={formRef} onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-3" data-search-mode="unified">
          <UnifiedSearchInput file={file} onFileChange={changeImage} onImageError={setImageError} defaultQuery={searchParams.get("q") ?? ""} disabled={imagePending} allowImage={imageSearchEnabled} />
            <div className="flex flex-wrap items-center gap-2">
              {showTypeFilter && (
                <Select
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
                </Select>
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

              <Select
                name="campus"
                aria-label={t("search.filter.campus")}
                defaultValue={currentCampus}
                onChange={applySoon}
                className={chipClass(Boolean(campusParam))}
              >
                <option value="">{t("search.filter.campusAll")}</option>
                {CAMPUSES.map((c) => {
                  const key = campusLabelKey(c);
                  return <option key={c} value={c}>{key ? t(key) : c}</option>;
                })}
              </Select>

              {hasMoreFilters && <button
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
              </button>}
            </div>

            {hasMoreFilters && <div id={morePanelId} hidden={!moreOpen} className="flex flex-wrap items-center gap-2 rounded-card bg-muted/60 p-3">
              {statusOptions && (
                <Select
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
                </Select>
              )}
            </div>}

        </form>
        {(chips.length > 0 || hasActiveFilters) && (
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
                router.push(basePath);
              }}
              className="inline-flex min-h-9 items-center px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:min-h-8"
            >
              {t("search.resetFilters")}
            </button>
          </div>
        )}

      </section>
      {(file || typeof resultCount === "number") && renderToolbar(displayCount)}

      {imageError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-muted p-3 text-sm text-destructive">{imageError}</p>}
      {imagePending && <p role="status" className="text-sm text-muted-foreground">{t("common.searching")}</p>}
      {file ? imageResult && <ImageSearchResults result={imageResult} board={Boolean(fixedType)} pending={imagePending} onPage={(page) => void runImage(new URLSearchParams(imageParams.current), page)} /> : children}
    </div>
    </SearchResultsToolbarContext.Provider>
  );
}
