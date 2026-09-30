import type { CategorySuggestion } from "@/lib/posts/categorySuggest";
import { LEGACY_CATEGORY_TO_CODE } from "@/lib/posts/categoryMigration";
import {
  isCategoryCode,
  isSubcategoryCode,
  parentCategoryOf,
  type CategoryCode,
  type SubcategoryCode,
} from "@/lib/posts/categoryTaxonomy";

// PostForm's category selection. subcategory null = "선택 안 함"
// (unclassified) -- a different thing from "<category>.other" (기타 ○○).
export type CategoryFormValue = {
  categoryCode: CategoryCode | null;
  subcategory: SubcategoryCode | null;
};

export type InitialCategoryState = CategoryFormValue & {
  // Set when an existing post's legacy category has no 1:1 code (legacy
  // "기타" or old free text) and it hasn't been migrated yet: nothing is
  // preselected and the form says the old value is kept unless one is chosen.
  legacyUnmapped: string | null;
};

// Seeds the picker. A migrated post restores its own codes; a post that
// isn't migrated yet shows its legacy category's 1:1 code with no
// subcategory; legacy "기타" is never shown as "living".
export function initialCategoryState(post?: {
  category: string;
  categoryCode?: string | null;
  subcategory?: string | null;
}): InitialCategoryState {
  if (!post) return { categoryCode: null, subcategory: null, legacyUnmapped: null };
  if (isCategoryCode(post.categoryCode)) {
    const subcategory =
      isSubcategoryCode(post.subcategory) && parentCategoryOf(post.subcategory) === post.categoryCode ? post.subcategory : null;
    return { categoryCode: post.categoryCode, subcategory, legacyUnmapped: null };
  }
  const legacy = post.category.trim();
  const mapped = Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_TO_CODE, legacy) ? LEGACY_CATEGORY_TO_CODE[legacy] : null;
  return mapped
    ? { categoryCode: mapped, subcategory: null, legacyUnmapped: null }
    : { categoryCode: null, subcategory: null, legacyUnmapped: post.category };
}

// The category part of the request body. Create always sends the pair.
// Edit sends it only when the selection changed -- so saving an
// unmigrated post without touching its category leaves it unmigrated
// (still waiting for review) instead of silently confirming the preview --
// and never sends "no category" (the legacy value is kept instead).
export function categoryBodyFields(
  isEdit: boolean,
  current: CategoryFormValue,
  initial: CategoryFormValue,
): { categoryCode: CategoryCode; subcategory: SubcategoryCode | null } | Record<string, never> {
  if (current.categoryCode === null) return {};
  if (isEdit && current.categoryCode === initial.categoryCode && current.subcategory === initial.subcategory) return {};
  return { categoryCode: current.categoryCode, subcategory: current.subcategory };
}

export function suggestionKey(suggestion: CategorySuggestion): string {
  return `${suggestion.category}|${suggestion.subcategory ?? ""}`;
}

// Whether to show the soft "이 분류에 더 가까워 보여요" prompt: only when the
// suggestion differs from the current selection (another main category,
// or a specific subcategory the user hasn't picked) and wasn't dismissed.
// It never changes the selection by itself.
export function shouldShowSuggestion(
  suggestion: CategorySuggestion | null,
  current: CategoryFormValue,
  dismissedKey: string | null,
): suggestion is CategorySuggestion {
  if (!suggestion || suggestionKey(suggestion) === dismissedKey) return false;
  if (suggestion.category !== current.categoryCode) return true;
  return suggestion.subcategory !== null && suggestion.subcategory !== current.subcategory;
}
