import { describe, expect, it } from "vitest";

import { CATEGORIES } from "./schema";
import { LEGACY_CATEGORY_TO_CODE, planCategoryMigration } from "./categoryMigration";
import { isCategoryCode } from "./categoryTaxonomy";

const plan = (category: string, title: string, description = "") => planCategoryMigration({ category, title, description });

describe("LEGACY_CATEGORY_TO_CODE", () => {
  it("maps every legacy category except 기타, to a real code", () => {
    expect(Object.keys(LEGACY_CATEGORY_TO_CODE).sort()).toEqual(CATEGORIES.filter((c) => c !== "기타").sort());
    for (const code of Object.values(LEGACY_CATEGORY_TO_CODE)) expect(isCategoryCode(code)).toBe(true);
    expect(LEGACY_CATEGORY_TO_CODE["기타"]).toBeUndefined();
  });
});

describe("planCategoryMigration", () => {
  it("auto-confirms a 1:1 legacy category when the suggestion agrees", () => {
    expect(plan("전자기기", "흰색 에어팟 주웠어요")).toMatchObject({
      legacyCategoryCode: "electronics",
      autoCategoryCode: "electronics",
      reviewReason: null,
      suggestion: { category: "electronics", subcategory: "electronics.earphones" },
    });
  });

  it("auto-confirms the legacy category when there is no suggestion, flagging it", () => {
    expect(plan("의류", "이거 주인 찾아요")).toMatchObject({
      autoCategoryCode: "clothing",
      reviewReason: null,
      suggestion: null,
      ambiguities: ["no_suggestion"],
    });
  });

  it("keeps a generic-title post's category but marks it category_only", () => {
    expect(plan("카드", "카드 한 장 주웠어요")).toMatchObject({
      autoCategoryCode: "card_id",
      reviewReason: null,
      ambiguities: ["category_only"],
    });
  });

  it("never auto-applies a policy move to another category", () => {
    expect(plan("카드", "목걸이 카드지갑 잃어버렸어요")).toMatchObject({
      legacyCategoryCode: "card_id",
      autoCategoryCode: null,
      reviewReason: "category_conflict",
      suggestion: { category: "wallet", subcategory: "wallet.card_case" },
    });
    expect(plan("액세서리", "에어팟 실리콘 커버만 잃어버렸어요")).toMatchObject({
      autoCategoryCode: null,
      reviewReason: "category_conflict",
    });
  });

  it("never maps legacy 기타 to living in bulk -- always review", () => {
    expect(plan("기타", "검정 장우산 분실")).toMatchObject({
      legacyCategoryCode: null,
      autoCategoryCode: null,
      reviewReason: "legacy_other",
      suggestion: { category: "living", subcategory: "living.umbrella" },
    });
    expect(plan("기타", "공학용 계산기 잃어버렸어요")).toMatchObject({
      autoCategoryCode: null,
      reviewReason: "legacy_other",
      suggestion: { category: "stationery" },
    });
    expect(plan("기타", "이거 주인 찾아요")).toMatchObject({
      autoCategoryCode: null,
      reviewReason: "legacy_other",
      ambiguities: ["no_suggestion"],
    });
  });

  it("sends a legacy value outside the known list to review", () => {
    expect(plan("우산", "검정 장우산 분실")).toMatchObject({ autoCategoryCode: null, reviewReason: "unknown_legacy" });
  });

  it("never auto-confirms a subcategory (the plan only carries it as a suggestion)", () => {
    const result = plan("전자기기", "흰색 에어팟 주웠어요");
    expect(result).not.toHaveProperty("autoSubcategory");
    expect(result.suggestion?.subcategory).toBe("electronics.earphones");
  });

  it("flags description-only suggestions", () => {
    expect(plan("가방", "행정동 벤치에서 주웠어요", "베이지색 배낭이 놓여 있었어요").ambiguities).toEqual(["description_only"]);
  });
});
