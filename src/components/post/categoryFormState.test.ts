import { describe, expect, it } from "vitest";

import { postCategoryLabel, postCategoryLabelKeys } from "@/lib/i18n/labels";
import { ko } from "@/lib/i18n/messages/ko";
import { categoryBodyFields, initialCategoryState, shouldShowSuggestion, suggestionKey } from "./categoryFormState";

describe("initialCategoryState", () => {
  it("starts empty for a new post", () => {
    expect(initialCategoryState()).toEqual({ categoryCode: null, subcategory: null, legacyUnmapped: null });
  });

  it("restores a migrated post's own codes", () => {
    expect(
      initialCategoryState({ category: "전자기기", categoryCode: "electronics", subcategory: "electronics.earphones" }),
    ).toEqual({ categoryCode: "electronics", subcategory: "electronics.earphones", legacyUnmapped: null });
    expect(initialCategoryState({ category: "기타", categoryCode: "living", subcategory: "living.other" })).toMatchObject({
      categoryCode: "living",
      subcategory: "living.other",
    });
  });

  it("drops a subcategory that doesn't belong to the stored category", () => {
    expect(initialCategoryState({ category: "지갑", categoryCode: "wallet", subcategory: "card_id.other" })).toMatchObject({
      categoryCode: "wallet",
      subcategory: null,
    });
  });

  it("shows an unmigrated post's legacy category as its 1:1 code with no subcategory", () => {
    expect(initialCategoryState({ category: "카드", categoryCode: null, subcategory: null })).toEqual({
      categoryCode: "card_id",
      subcategory: null,
      legacyUnmapped: null,
    });
  });

  it("never preselects living for legacy 기타 -- nothing is selected and the old value is reported", () => {
    expect(initialCategoryState({ category: "기타", categoryCode: null, subcategory: null })).toEqual({
      categoryCode: null,
      subcategory: null,
      legacyUnmapped: "기타",
    });
  });
});

describe("categoryBodyFields", () => {
  const initial = { categoryCode: "card_id" as const, subcategory: null };

  it("always sends the pair on create", () => {
    expect(categoryBodyFields(false, { categoryCode: "electronics", subcategory: null }, { categoryCode: null, subcategory: null })).toEqual({
      categoryCode: "electronics",
      subcategory: null,
    });
  });

  it("sends nothing on an edit that didn't change the selection (an unmigrated post stays unmigrated)", () => {
    expect(categoryBodyFields(true, { ...initial }, initial)).toEqual({});
  });

  it("sends the pair when the main category or the subcategory changed", () => {
    expect(categoryBodyFields(true, { categoryCode: "wallet", subcategory: "wallet.card_wallet" }, initial)).toEqual({
      categoryCode: "wallet",
      subcategory: "wallet.card_wallet",
    });
    expect(categoryBodyFields(true, { categoryCode: "card_id", subcategory: "card_id.transit_card" }, initial)).toEqual({
      categoryCode: "card_id",
      subcategory: "card_id.transit_card",
    });
  });

  it("never sends 'no category' (a legacy 기타 post left unselected keeps its legacy value)", () => {
    expect(categoryBodyFields(true, { categoryCode: null, subcategory: null }, { categoryCode: null, subcategory: null })).toEqual({});
  });
});

describe("shouldShowSuggestion", () => {
  const earphones = { category: "electronics" as const, subcategory: "electronics.earphones" as const, source: "title" as const };

  it("shows when the suggestion names another main category or an unpicked subcategory", () => {
    expect(shouldShowSuggestion(earphones, { categoryCode: "accessory", subcategory: null }, null)).toBe(true);
    expect(shouldShowSuggestion(earphones, { categoryCode: null, subcategory: null }, null)).toBe(true);
    expect(shouldShowSuggestion(earphones, { categoryCode: "electronics", subcategory: null }, null)).toBe(true);
    expect(shouldShowSuggestion(earphones, { categoryCode: "electronics", subcategory: "electronics.other" }, null)).toBe(true);
  });

  it("hides when the selection already matches, when dismissed, or with no suggestion", () => {
    expect(shouldShowSuggestion(earphones, { categoryCode: "electronics", subcategory: "electronics.earphones" }, null)).toBe(false);
    expect(shouldShowSuggestion(earphones, { categoryCode: "accessory", subcategory: null }, suggestionKey(earphones))).toBe(false);
    expect(shouldShowSuggestion(null, { categoryCode: null, subcategory: null }, null)).toBe(false);
  });

  it("doesn't nag about the subcategory when the suggestion has none", () => {
    const cardOnly = { category: "card_id" as const, subcategory: null, source: "title" as const };
    expect(shouldShowSuggestion(cardOnly, { categoryCode: "card_id", subcategory: null }, null)).toBe(false);
  });
});

describe("postCategoryLabelKeys (read compatibility)", () => {
  it("uses the taxonomy labels when categoryCode is set", () => {
    expect(postCategoryLabelKeys({ category: "기타", categoryCode: "living", subcategory: "living.umbrella" })).toEqual({
      categoryKey: "taxonomy.category.living",
      subcategoryKey: "taxonomy.subcategory.living.umbrella",
    });
    expect(postCategoryLabelKeys({ category: "지갑", categoryCode: "wallet", subcategory: null })).toEqual({
      categoryKey: "taxonomy.category.wallet",
      subcategoryKey: null,
    });
  });

  it("falls back to the legacy category for an unmigrated post", () => {
    expect(postCategoryLabelKeys({ category: "기타", categoryCode: null, subcategory: null })).toEqual({
      categoryKey: "category.기타",
      subcategoryKey: null,
    });
    expect(postCategoryLabelKeys({ category: "카드" })).toEqual({ categoryKey: "category.카드", subcategoryKey: null });
    expect(postCategoryLabelKeys({ category: "우산", categoryCode: null })).toEqual({ categoryKey: null, subcategoryKey: null });
  });

  it("formats '대분류 · 소분류' for cards and the detail page, with legacy fallback", () => {
    const t = (key: keyof typeof ko) => ko[key];
    expect(postCategoryLabel({ category: "전자기기", categoryCode: "electronics", subcategory: "electronics.earphones" }, t)).toBe(
      "전자기기 · 이어폰",
    );
    expect(postCategoryLabel({ category: "기타", categoryCode: "living", subcategory: "living.other" }, t)).toBe(
      "생활용품 · 기타 생활용품",
    );
    expect(postCategoryLabel({ category: "카드", categoryCode: "card_id", subcategory: null }, t)).toBe("카드·신분증");
    expect(postCategoryLabel({ category: "카드", categoryCode: null, subcategory: null }, t)).toBe("카드");
    expect(postCategoryLabel({ category: "우산" }, t)).toBe("우산");
  });

  it("ignores a subcategory under the wrong parent", () => {
    expect(postCategoryLabelKeys({ category: "지갑", categoryCode: "wallet", subcategory: "card_id.other" }).subcategoryKey).toBeNull();
  });
});
