import { LEGACY_CATEGORY_TO_CODE } from "./categoryMigration";
import { validateCategorySelection, type CategoryCode, type SubcategoryCode } from "./categoryTaxonomy";
import type { CATEGORIES } from "./schema";

// Dual-write of a post's category while the legacy free-text `category`
// column is still what search filters, keyword alerts and embeddings read:
// every create/update that sets a category writes the new
// categoryCode/subcategory AND the matching legacy value. The legacy
// column keeps its meaning (one of the 9 old values); only "living" has no
// same-named old value and is written as "기타".
export const CATEGORY_CODE_TO_LEGACY: Readonly<Record<CategoryCode, (typeof CATEGORIES)[number]>> = {
  electronics: "전자기기",
  wallet: "지갑",
  card_id: "카드",
  bag: "가방",
  clothing: "의류",
  accessory: "액세서리",
  book_document: "책",
  stationery: "필기구",
  living: "기타",
};

export type ResolvedCategoryWrite = {
  category: string;
  categoryCode: CategoryCode | null;
  subcategory: SubcategoryCode | null;
};

export type CategoryWriteInput = {
  category?: string;
  categoryCode?: string;
  subcategory?: string | null;
};

export type CategoryWriteResult =
  | { ok: true; value: ResolvedCategoryWrite | null } // null: update leaves the category untouched
  | { ok: false; message: string };

// Normalizes the category part of a create/update request:
//   - categoryCode (current clients): validated with its subcategory; the
//     legacy `category` is derived from it (any client-sent `category` is
//     ignored). A missing subcategory is stored as null (unclassified).
//   - only `category` (clients from before the taxonomy): kept as-is, with
//     categoryCode from the safe 1:1 legacy mapping -- legacy "기타" or a
//     free-text value stays unclassified (categoryCode null), never "living".
//   - neither: an error on create; "no change" on update.
// A subcategory is only accepted together with its categoryCode, so a
// stored subcategory can never end up under a different parent.
export function resolveCategoryWrite(input: CategoryWriteInput, mode: "create" | "update"): CategoryWriteResult {
  if (input.categoryCode !== undefined) {
    const selection = validateCategorySelection(input.categoryCode, input.subcategory ?? null);
    if (!selection.ok) {
      return {
        ok: false,
        message: selection.error === "invalid_category" ? "카테고리를 선택해주세요." : "소분류가 올바르지 않습니다.",
      };
    }
    const { category: categoryCode, subcategory } = selection.value;
    return { ok: true, value: { category: CATEGORY_CODE_TO_LEGACY[categoryCode], categoryCode, subcategory } };
  }
  if (input.subcategory !== undefined && input.subcategory !== null) {
    return { ok: false, message: "소분류는 대분류와 함께 보내야 합니다." };
  }
  if (input.category !== undefined) {
    const legacy = input.category.trim();
    const categoryCode = Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_TO_CODE, legacy) ? LEGACY_CATEGORY_TO_CODE[legacy] : null;
    return { ok: true, value: { category: legacy, categoryCode, subcategory: null } };
  }
  if (mode === "create") return { ok: false, message: "카테고리를 선택해주세요." };
  return { ok: true, value: null };
}
