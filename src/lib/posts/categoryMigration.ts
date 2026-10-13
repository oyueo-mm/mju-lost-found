import { suggestCategory, type CategorySuggestion } from "./categorySuggest";
import type { CategoryCode } from "./categoryTaxonomy";

// Plans how one existing post moves from the legacy free-text `category`
// column to the code-based `categoryCode`/`subcategory` columns
// (migration 20261018000000_add_post_category_code). Pure -- no DB access;
// scripts/categoryBackfill.ts feeds it rows and applies (or only reports)
// the result.
//
// Rules:
//   - Only a legacy category with a safe 1:1 code is auto-confirmed, and
//     only when suggestCategory() doesn't point at a different category
//     (the author's own choice is kept; a disagreement goes to review).
//   - Legacy "기타" has no 1:1 code -- it is never bulk-mapped to "living";
//     every such post goes to review with the suggestion as a candidate.
//   - A subcategory is never auto-confirmed: the suggestion is recorded as
//     a candidate only, and the stored `subcategory` stays null.

// Bump when RULES in categorySuggest.ts change, so stored candidates can be
// told apart from ones a newer suggester would produce.
export const CATEGORY_SUGGESTER_VERSION = "2026-10-13.1";

export const LEGACY_CATEGORY_TO_CODE: Readonly<Record<string, CategoryCode>> = {
  전자기기: "electronics",
  지갑: "wallet",
  카드: "card_id",
  가방: "bag",
  의류: "clothing",
  액세서리: "accessory",
  책: "book_document",
  필기구: "stationery",
};

// Categories split out of a legacy one (카테고리 개선): a 전자기기 post
// suggested as 휴대폰/이어폰, or a 액세서리 post suggested as 시계, agrees
// with its legacy value.
const SPLIT_FROM: Partial<Record<CategoryCode, CategoryCode>> = {
  phone: "electronics",
  earphones: "electronics",
  watch: "accessory",
};

export type CategoryReviewReason =
  // legacy "기타": needs a real main category
  | "legacy_other"
  // legacy value maps 1:1, but the suggestion names another category
  | "category_conflict"
  // legacy value outside the known 9 (free text from before the UI list)
  | "unknown_legacy";

// Why a plan is uncertain even if it doesn't block anything.
export type CategoryAmbiguity =
  // nothing matched the title or description
  | "no_suggestion"
  // only a generic word matched ("카드 한 장"): category, no subcategory
  | "category_only"
  // the title matched nothing; the hint came from the description
  | "description_only";

export type CategoryMigrationPlan = {
  legacyCategory: string;
  legacyCategoryCode: CategoryCode | null;
  suggestion: CategorySuggestion | null;
  // Value to write to categoryCode now; null = leave unclassified until review.
  autoCategoryCode: CategoryCode | null;
  reviewReason: CategoryReviewReason | null;
  ambiguities: CategoryAmbiguity[];
};

export function planCategoryMigration(post: {
  category: string;
  title: string;
  description: string | null;
}): CategoryMigrationPlan {
  const legacyCategory = post.category;
  const legacyCategoryCode = Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_TO_CODE, legacyCategory.trim())
    ? LEGACY_CATEGORY_TO_CODE[legacyCategory.trim()]
    : null;
  const suggestion = suggestCategory({ title: post.title, description: post.description });

  const ambiguities: CategoryAmbiguity[] = [];
  if (!suggestion) ambiguities.push("no_suggestion");
  else {
    if (suggestion.subcategory === null) ambiguities.push("category_only");
    if (suggestion.source === "description") ambiguities.push("description_only");
  }

  let reviewReason: CategoryReviewReason | null = null;
  if (legacyCategoryCode === null) {
    reviewReason = legacyCategory.trim() === "기타" ? "legacy_other" : "unknown_legacy";
  } else if (suggestion && (SPLIT_FROM[suggestion.category] ?? suggestion.category) !== legacyCategoryCode) {
    reviewReason = "category_conflict";
  }
  // When the suggestion is a category split out of the legacy one, it's the
  // more specific (and now correct) main category.
  const autoCategoryCode =
    reviewReason !== null ? null : suggestion && SPLIT_FROM[suggestion.category] ? suggestion.category : legacyCategoryCode;

  return {
    legacyCategory,
    legacyCategoryCode,
    suggestion,
    autoCategoryCode,
    reviewReason,
    ambiguities,
  };
}
