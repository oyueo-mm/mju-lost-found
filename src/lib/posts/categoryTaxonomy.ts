// Two-level item taxonomy (대분류 > 소분류), keyed by stable internal codes.
//
// Codes, never Korean display strings, are what will be stored and
// validated: labels live only in the i18n dictionaries
// (`taxonomy.category.<code>` / `taxonomy.subcategory.<code>`, see
// i18n/labels.ts), so renaming a label never requires a data migration.
//
// This module is not wired into the DB, forms, search or AI yet -- the
// legacy free-text `category` column and CATEGORIES (./schema.ts) are still
// the live values.
//
// Subcategory semantics:
//   - null            -> unclassified (nobody has picked a subcategory yet)
//   - "<category>.other" -> deliberately classified as "기타 …" of that category
// The two are never interchangeable: null means "unknown", `.other` means
// "known, and it is none of the listed kinds".

// Main category code -> its subcategory keys, both in display order. The last
// entry of every category is "other".
export const TAXONOMY = {
  electronics: ["phone", "earphones", "laptop_tablet", "charger_cable_battery", "peripheral_storage", "other"],
  wallet: ["card_wallet", "bifold_long", "other"],
  card_id: ["student_id", "payment_card", "transit_card", "other"],
  bag: ["backpack", "tote_eco", "pouch", "shopping_bag", "other"],
  clothing: ["top_outer", "bottom", "hat", "scarf_gloves", "shoes", "other"],
  accessory: ["glasses", "watch_jewelry", "hair", "keyring_charm", "other"],
  book_document: ["textbook", "general_book", "notebook", "document_file", "other"],
  stationery: ["pencil_case", "pen_pencil", "calculator", "other"],
  living: ["key", "umbrella", "tumbler_bottle", "hobby_sports", "other"],
} as const;

type Taxonomy = typeof TAXONOMY;

export type CategoryCode = keyof Taxonomy;

// Full subcategory code, always prefixed by its parent: "electronics.phone".
export type SubcategoryCode = {
  [C in CategoryCode]: `${C}.${Taxonomy[C][number]}`;
}[CategoryCode];

export const CATEGORY_CODES = Object.keys(TAXONOMY) as CategoryCode[];

const SUBCATEGORIES_BY_CATEGORY: Record<CategoryCode, readonly SubcategoryCode[]> = Object.fromEntries(
  CATEGORY_CODES.map((category) => [
    category,
    TAXONOMY[category].map((sub) => `${category}.${sub}` as SubcategoryCode),
  ]),
) as Record<string, readonly SubcategoryCode[]> as Record<CategoryCode, readonly SubcategoryCode[]>;

export const SUBCATEGORY_CODES: readonly SubcategoryCode[] = CATEGORY_CODES.flatMap(
  (category) => SUBCATEGORIES_BY_CATEGORY[category],
);

const PARENT_BY_SUBCATEGORY = new Map<string, CategoryCode>(
  CATEGORY_CODES.flatMap((category) => SUBCATEGORIES_BY_CATEGORY[category].map((sub) => [sub, category] as const)),
);

export function isCategoryCode(value: unknown): value is CategoryCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TAXONOMY, value);
}

export function isSubcategoryCode(value: unknown): value is SubcategoryCode {
  return typeof value === "string" && PARENT_BY_SUBCATEGORY.has(value);
}

export function subcategoriesOf(category: CategoryCode): readonly SubcategoryCode[] {
  return SUBCATEGORIES_BY_CATEGORY[category];
}

export function parentCategoryOf(subcategory: SubcategoryCode): CategoryCode {
  return PARENT_BY_SUBCATEGORY.get(subcategory)!;
}

export function otherSubcategoryOf(category: CategoryCode): SubcategoryCode {
  return `${category}.other` as SubcategoryCode;
}

// True only for a deliberate "기타 …" choice -- false for null (unclassified).
export function isOtherSubcategory(subcategory: SubcategoryCode | null): boolean {
  return subcategory !== null && subcategory.endsWith(".other");
}

export type CategorySelection = {
  category: CategoryCode;
  subcategory: SubcategoryCode | null;
};

export type CategorySelectionError = "invalid_category" | "invalid_subcategory" | "subcategory_mismatch";

export type CategorySelectionResult =
  | { ok: true; value: CategorySelection }
  | { ok: false; error: CategorySelectionError };

// Validates a (category, subcategory) pair from untrusted input. A missing
// subcategory (null/undefined) is valid and stays null (unclassified); it is
// never coerced to "<category>.other". Anything else -- including "" -- must
// be a known subcategory code whose parent is `category`.
export function validateCategorySelection(category: unknown, subcategory: unknown): CategorySelectionResult {
  if (!isCategoryCode(category)) return { ok: false, error: "invalid_category" };
  if (subcategory === null || subcategory === undefined) {
    return { ok: true, value: { category, subcategory: null } };
  }
  if (!isSubcategoryCode(subcategory)) return { ok: false, error: "invalid_subcategory" };
  if (parentCategoryOf(subcategory) !== category) return { ok: false, error: "subcategory_mismatch" };
  return { ok: true, value: { category, subcategory } };
}

export function isValidCategorySelection(category: unknown, subcategory: unknown): boolean {
  return validateCategorySelection(category, subcategory).ok;
}
