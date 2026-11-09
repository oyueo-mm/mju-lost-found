"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SearchNavigationContext } from "@/components/search/SearchNavigationContext";
import { SemanticSearchResults } from "@/components/search/SemanticSearchResults";
import { useI18n } from "@/lib/i18n/client";

type HomeQuery = { query: string; image: File | null };
type HomeSearchState = {
  params: URLSearchParams;
  image: File | null;
  version: number;
};
const HomeSearchContext = createContext<{
  search: HomeSearchState | null;
  resetVersion: number;
  submit: (input: HomeQuery) => void;
  reset: () => void;
  clearResults: () => void;
  navigate: (href: string) => void;
} | null>(null);

export function useHomeSearch() { return useContext(HomeSearchContext); }

export function HomeSearchProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState<HomeSearchState | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  function reset() { setSearch(null); setResetVersion((value) => value + 1); }
  function submit({ query, image }: HomeQuery) {
    if (!query.trim() && !image) { reset(); return; }
    setSearch((current) => {
      const params = new URLSearchParams(current?.params);
      params.set("type", "found");
      params.set("mode", "unified");
      params.set("limit", "6");
      if (query.trim()) params.set("q", query.trim()); else params.delete("q");
      params.delete("page"); params.delete("searchMode");
      return { params, image, version: (current?.version ?? 0) + 1 };
    });
  }
  function navigate(href: string) {
    const params = new URL(href, window.location.origin).searchParams;
    // Pagination stays in the Hero instead of navigating away from home.
    if (!params.toString() || (!params.get("q")?.trim() && !search?.image)) { reset(); return; }
    setSearch((current) => current ? { ...current, params } : null);
  }
  return <HomeSearchContext.Provider value={{ search, resetVersion, submit, reset, clearResults: () => setSearch(null), navigate }}>{children}</HomeSearchContext.Provider>;
}

// Render no result container before a search, so Hero keeps its natural
// compact height. Text/image requests and the result list remain shared.
export function HomeSearchResults() {
  const home = useHomeSearch();
  const { t } = useI18n();
  if (!home?.search) return null;
  const { params, image, version } = home.search;
  return (
    <SearchNavigationContext.Provider value={{ push: home.navigate }}>
      <section className="flex min-w-0 flex-col gap-4" aria-label={t("search.title")} data-home-search-results>
        <SemanticSearchResults key={version} params={Object.fromEntries(params)} basePath="/" image={image ?? undefined} />
      </section>
    </SearchNavigationContext.Provider>
  );
}
