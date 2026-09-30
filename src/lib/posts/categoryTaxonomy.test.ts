import { describe, expect, it } from "vitest";

import { DICTIONARIES } from "@/lib/i18n/messages";
import { taxonomyCategoryLabelKey, taxonomySubcategoryLabelKey } from "@/lib/i18n/labels";
import {
  CATEGORY_CODES,
  SUBCATEGORY_CODES,
  TAXONOMY,
  isCategoryCode,
  isOtherSubcategory,
  isSubcategoryCode,
  isValidCategorySelection,
  otherSubcategoryOf,
  parentCategoryOf,
  subcategoriesOf,
  validateCategorySelection,
} from "./categoryTaxonomy";

describe("category taxonomy", () => {
  it("has the 9 confirmed main categories in display order", () => {
    expect(CATEGORY_CODES).toEqual([
      "electronics",
      "wallet",
      "card_id",
      "bag",
      "clothing",
      "accessory",
      "book_document",
      "stationery",
      "living",
    ]);
  });

  it("gives every category 3-6 subcategories ending in its own 'other'", () => {
    for (const category of CATEGORY_CODES) {
      const subs = subcategoriesOf(category);
      expect(subs.length).toBeGreaterThanOrEqual(3);
      expect(subs.length).toBeLessThanOrEqual(6);
      expect(subs.at(-1)).toBe(otherSubcategoryOf(category));
      expect(subs.filter(isOtherSubcategory)).toEqual([`${category}.other`]);
    }
    expect(SUBCATEGORY_CODES).toHaveLength(43);
  });

  it("uses unique codes that are prefixed by their parent and are plain ASCII", () => {
    expect(new Set(SUBCATEGORY_CODES).size).toBe(SUBCATEGORY_CODES.length);
    for (const sub of SUBCATEGORY_CODES) {
      expect(sub).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(sub.startsWith(`${parentCategoryOf(sub)}.`)).toBe(true);
    }
    for (const category of CATEGORY_CODES) expect(category).toMatch(/^[a-z_]+$/);
  });

  it("recognizes codes but not Korean labels, legacy category strings or bare subcategory keys", () => {
    expect(isCategoryCode("electronics")).toBe(true);
    expect(isCategoryCode("전자기기")).toBe(false);
    expect(isCategoryCode("기타")).toBe(false);
    expect(isCategoryCode("toString")).toBe(false);
    expect(isCategoryCode(null)).toBe(false);
    expect(isSubcategoryCode("electronics.phone")).toBe(true);
    expect(isSubcategoryCode("phone")).toBe(false);
    expect(isSubcategoryCode("휴대폰")).toBe(false);
    expect(isSubcategoryCode("electronics")).toBe(false);
  });

  it("maps each subcategory to its parent", () => {
    expect(parentCategoryOf("wallet.card_wallet")).toBe("wallet");
    expect(parentCategoryOf("living.key")).toBe("living");
    for (const category of CATEGORY_CODES) {
      for (const sub of TAXONOMY[category]) expect(parentCategoryOf(`${category}.${sub}` as never)).toBe(category);
    }
  });
});

describe("validateCategorySelection", () => {
  it("accepts a subcategory under its own parent", () => {
    expect(validateCategorySelection("electronics", "electronics.earphones")).toEqual({
      ok: true,
      value: { category: "electronics", subcategory: "electronics.earphones" },
    });
  });

  it("keeps a missing subcategory as null (unclassified), never as 'other'", () => {
    for (const missing of [null, undefined]) {
      const result = validateCategorySelection("bag", missing);
      expect(result).toEqual({ ok: true, value: { category: "bag", subcategory: null } });
    }
    const other = validateCategorySelection("bag", "bag.other");
    expect(other).toEqual({ ok: true, value: { category: "bag", subcategory: "bag.other" } });
    expect(isOtherSubcategory(null)).toBe(false);
    expect(isOtherSubcategory("bag.other")).toBe(true);
    expect(isOtherSubcategory("bag.pouch")).toBe(false);
  });

  it("rejects a subcategory from another category", () => {
    expect(validateCategorySelection("card_id", "wallet.card_wallet")).toEqual({ ok: false, error: "subcategory_mismatch" });
    expect(validateCategorySelection("wallet", "card_id.other")).toEqual({ ok: false, error: "subcategory_mismatch" });
  });

  it("rejects unknown categories and subcategories", () => {
    expect(validateCategorySelection("전자기기", null)).toEqual({ ok: false, error: "invalid_category" });
    expect(validateCategorySelection(undefined, "electronics.phone")).toEqual({ ok: false, error: "invalid_category" });
    expect(validateCategorySelection("electronics", "phone")).toEqual({ ok: false, error: "invalid_subcategory" });
    expect(validateCategorySelection("electronics", "")).toEqual({ ok: false, error: "invalid_subcategory" });
    expect(validateCategorySelection("electronics", "electronics.drone")).toEqual({ ok: false, error: "invalid_subcategory" });
    expect(isValidCategorySelection("stationery", "stationery.calculator")).toBe(true);
    expect(isValidCategorySelection("living", "stationery.calculator")).toBe(false);
  });
});

describe("taxonomy labels", () => {
  it("has a non-empty label for every category and subcategory in all 7 locales", () => {
    const keys = [...CATEGORY_CODES.map(taxonomyCategoryLabelKey), ...SUBCATEGORY_CODES.map(taxonomySubcategoryLabelKey)];
    expect(keys).toHaveLength(52);
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      for (const key of keys) {
        expect(dictionary[key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it("uses the confirmed Korean labels", () => {
    const { ko } = DICTIONARIES;
    expect(CATEGORY_CODES.map((code) => ko[taxonomyCategoryLabelKey(code)])).toEqual([
      "전자기기",
      "지갑",
      "카드·신분증",
      "가방·파우치",
      "의류",
      "액세서리",
      "도서·문서",
      "문구·학용품",
      "생활용품",
    ]);
    expect(subcategoriesOf("clothing").map((code) => ko[taxonomySubcategoryLabelKey(code)])).toEqual([
      "상의·아우터",
      "하의",
      "모자",
      "목도리·장갑",
      "신발",
      "기타 의류",
    ]);
    expect(ko[taxonomySubcategoryLabelKey("electronics.charger_cable_battery")]).toBe("충전기·케이블·보조배터리");
    expect(ko[taxonomySubcategoryLabelKey("living.other")]).toBe("기타 생활용품");
  });

  it("keeps labels distinct within each category in every locale", () => {
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      const categoryLabels = CATEGORY_CODES.map((code) => dictionary[taxonomyCategoryLabelKey(code)]);
      expect(new Set(categoryLabels).size, locale).toBe(categoryLabels.length);
      for (const category of CATEGORY_CODES) {
        const labels = subcategoriesOf(category).map((code) => dictionary[taxonomySubcategoryLabelKey(code)]);
        expect(new Set(labels).size, `${locale} ${category}`).toBe(labels.length);
      }
    }
  });
});
