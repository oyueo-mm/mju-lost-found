import { describe, expect, it } from "vitest";

import { CATEGORY_CODE_TO_LEGACY, resolveCategoryWrite } from "./categoryWrite";
import { CATEGORY_CODES } from "./categoryTaxonomy";
import { CATEGORIES, createFoundPostSchema, createLostPostSchema, updateFoundPostSchema, updateLostPostSchema } from "./schema";

const base = { title: "t", description: "d", location: "학생회관", campus: "인문캠퍼스", lostAt: null };

describe("CATEGORY_CODE_TO_LEGACY", () => {
  it("maps every main category to one of the 9 legacy values, living to 기타", () => {
    expect(Object.keys(CATEGORY_CODE_TO_LEGACY).sort()).toEqual([...CATEGORY_CODES].sort());
    for (const legacy of Object.values(CATEGORY_CODE_TO_LEGACY)) expect(CATEGORIES).toContain(legacy);
    expect(CATEGORY_CODE_TO_LEGACY).toMatchObject({
      electronics: "전자기기",
      wallet: "지갑",
      card_id: "카드",
      bag: "가방",
      clothing: "의류",
      accessory: "액세서리",
      book_document: "책",
      stationery: "필기구",
      living: "기타",
    });
  });
});

describe("resolveCategoryWrite", () => {
  it("dual-writes the legacy category from categoryCode, ignoring a client-sent category", () => {
    expect(resolveCategoryWrite({ categoryCode: "wallet", subcategory: "wallet.card_wallet", category: "카드" }, "create")).toEqual({
      ok: true,
      value: { category: "지갑", categoryCode: "wallet", subcategory: "wallet.card_wallet" },
    });
  });

  it("stores a missing subcategory as null, and keeps 'other' as other", () => {
    expect(resolveCategoryWrite({ categoryCode: "living" }, "create")).toEqual({
      ok: true,
      value: { category: "기타", categoryCode: "living", subcategory: null },
    });
    expect(resolveCategoryWrite({ categoryCode: "living", subcategory: "living.other" }, "create")).toEqual({
      ok: true,
      value: { category: "기타", categoryCode: "living", subcategory: "living.other" },
    });
  });

  it("rejects an unknown code or a subcategory under another parent", () => {
    expect(resolveCategoryWrite({ categoryCode: "전자기기" }, "create")).toMatchObject({ ok: false });
    expect(resolveCategoryWrite({ categoryCode: "card_id", subcategory: "wallet.card_wallet" }, "create")).toMatchObject({ ok: false });
    expect(resolveCategoryWrite({ categoryCode: "electronics", subcategory: "phone" }, "update")).toMatchObject({ ok: false });
  });

  it("rejects a subcategory without its categoryCode", () => {
    expect(resolveCategoryWrite({ subcategory: "electronics.phone" }, "update")).toMatchObject({ ok: false });
  });

  it("maps a legacy-only request 1:1, leaving 기타 and free text unclassified", () => {
    expect(resolveCategoryWrite({ category: "전자기기" }, "create")).toEqual({
      ok: true,
      value: { category: "전자기기", categoryCode: "electronics", subcategory: null },
    });
    expect(resolveCategoryWrite({ category: "기타" }, "create")).toEqual({
      ok: true,
      value: { category: "기타", categoryCode: null, subcategory: null },
    });
    expect(resolveCategoryWrite({ category: "우산" }, "update")).toEqual({
      ok: true,
      value: { category: "우산", categoryCode: null, subcategory: null },
    });
  });

  it("requires a category on create but leaves it untouched on an update that omits it", () => {
    expect(resolveCategoryWrite({}, "create")).toMatchObject({ ok: false });
    expect(resolveCategoryWrite({}, "update")).toEqual({ ok: true, value: null });
    expect(resolveCategoryWrite({ subcategory: null }, "update")).toEqual({ ok: true, value: null });
  });
});

describe("post schemas with categoryCode", () => {
  it("create: normalizes into category + categoryCode + subcategory", () => {
    const parsed = createLostPostSchema.parse({ ...base, categoryCode: "electronics", subcategory: "electronics.earphones" });
    expect(parsed).toMatchObject({ category: "전자기기", categoryCode: "electronics", subcategory: "electronics.earphones" });
    const found = createFoundPostSchema.parse({ ...base, lostAt: undefined, foundAt: null, categoryCode: "bag" });
    expect(found).toMatchObject({ category: "가방", categoryCode: "bag", subcategory: null });
  });

  it("create: still accepts a legacy-only body", () => {
    expect(createLostPostSchema.parse({ ...base, category: "지갑" })).toMatchObject({
      category: "지갑",
      categoryCode: "wallet",
      subcategory: null,
    });
  });

  it("create: rejects a missing category and a mismatched pair with a message", () => {
    const missing = createLostPostSchema.safeParse(base);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.message).toBe("카테고리를 선택해주세요.");
    const mismatch = createLostPostSchema.safeParse({ ...base, categoryCode: "card_id", subcategory: "wallet.card_wallet" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.message).toBe("소분류가 올바르지 않습니다.");
  });

  it("update: leaves all three category columns out when the body has no category", () => {
    const parsed = updateLostPostSchema.parse({ title: "new title" });
    expect(parsed).toEqual({ title: "new title" });
    expect(parsed).not.toHaveProperty("category");
    expect(parsed).not.toHaveProperty("categoryCode");
    expect(parsed).not.toHaveProperty("subcategory");
  });

  it("update: a category change writes all three, clearing the subcategory when omitted", () => {
    expect(updateFoundPostSchema.parse({ categoryCode: "stationery" })).toEqual({
      category: "필기구",
      categoryCode: "stationery",
      subcategory: null,
    });
    expect(updateFoundPostSchema.parse({ categoryCode: "stationery", subcategory: "stationery.calculator" })).toEqual({
      category: "필기구",
      categoryCode: "stationery",
      subcategory: "stationery.calculator",
    });
  });
});
