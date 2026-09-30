// URL <-> UI state for the 카테고리 대분류 -> 소분류 search filter. The URL is
// the source of truth (categoryCode / subcategory -- see posts/schema.ts's
// categoryFilterQuerySchema), so paging, refresh and shared links keep the
// filter in keyword and AI search alike. Pure, so it's unit-testable
// without a DOM.
//
// Legacy links (`?category=지갑`, from before the taxonomy) are read as the
// matching main category for display, and rewritten to categoryCode on the
// next search. A legacy free-text value outside the 9 is kept as-is.
import {
  isCategoryCode,
  isSubcategoryCode,
  parentCategoryOf,
  type CategoryCode,
  type SubcategoryCode,
} from "@/lib/posts/categoryTaxonomy";
import { CATEGORY_CODE_TO_LEGACY } from "@/lib/posts/categoryWrite";

export const CATEGORY_FILTER_PARAM_KEYS = ["category", "categoryCode", "subcategory"] as const;

export type CategoryFilterState = {
  categoryCode: CategoryCode | null; // null = 전체 카테고리
  subcategory: SubcategoryCode | null; // null = 그 대분류 전체
  // A legacy ?category= value with no taxonomy code (old free text): kept so
  // the filter isn't silently dropped; only set while categoryCode is null.
  legacyCategory: string | null;
};

export const EMPTY_CATEGORY_FILTER: CategoryFilterState = { categoryCode: null, subcategory: null, legacyCategory: null };

const LEGACY_TO_CODE: ReadonlyMap<string, CategoryCode> = new Map(
  (Object.entries(CATEGORY_CODE_TO_LEGACY) as [CategoryCode, string][]).map(([code, legacy]) => [legacy, code]),
);

type ParamReader = { get(key: string): string | null };

// Tolerant read: an unknown code falls back to "no filter" here (the server
// still rejects a malformed URL with its own message). A subcategory implies
// its own parent; one that contradicts the given categoryCode is dropped.
export function readCategoryFilterState(params: ParamReader): CategoryFilterState {
  const code = params.get("categoryCode") ?? "";
  const sub = params.get("subcategory") ?? "";
  if (isCategoryCode(code)) {
    const subcategory = isSubcategoryCode(sub) && parentCategoryOf(sub) === code ? sub : null;
    return { categoryCode: code, subcategory, legacyCategory: null };
  }
  if (isSubcategoryCode(sub)) return { categoryCode: parentCategoryOf(sub), subcategory: sub, legacyCategory: null };
  const legacy = (params.get("category") ?? "").trim();
  if (!legacy) return EMPTY_CATEGORY_FILTER;
  const mapped = LEGACY_TO_CODE.get(legacy);
  return mapped ? { categoryCode: mapped, subcategory: null, legacyCategory: null } : { ...EMPTY_CATEGORY_FILTER, legacyCategory: legacy };
}

// The URL parameters for a state -- categoryCode (+ subcategory), or the kept
// legacy value, or nothing for 전체.
export function categoryFilterToEntries(state: CategoryFilterState): [string, string][] {
  if (state.categoryCode) {
    const entries: [string, string][] = [["categoryCode", state.categoryCode]];
    if (state.subcategory) entries.push(["subcategory", state.subcategory]);
    return entries;
  }
  return state.legacyCategory ? [["category", state.legacyCategory]] : [];
}

// Replaces the category parameters (legacy included) in an existing query
// string, keeping every other parameter as it is.
export function withCategoryFilterParams(search: string, state: CategoryFilterState): string {
  const params = new URLSearchParams(search);
  for (const key of CATEGORY_FILTER_PARAM_KEYS) params.delete(key);
  for (const [key, value] of categoryFilterToEntries(state)) params.set(key, value);
  return params.toString();
}
