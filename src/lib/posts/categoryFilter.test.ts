import { describe, expect, it } from "vitest";

import { categoryCodeConditions } from "@/lib/ai/vectorSearch";
import { categoryFilterQuerySchema, listQuerySchema } from "./schema";

describe("listQuerySchema category filter", () => {
  it("accepts a main category alone (the whole category)", () => {
    const parsed = listQuerySchema.parse({ type: "found", categoryCode: "electronics" });
    expect(parsed.categoryCode).toBe("electronics");
    expect(parsed.subcategory).toBeUndefined();
  });

  it("accepts a subcategory and fills in its parent", () => {
    expect(listQuerySchema.parse({ type: "lost", categoryCode: "wallet", subcategory: "wallet.card_case" })).toMatchObject({
      categoryCode: "wallet",
      subcategory: "wallet.card_case",
    });
    expect(listQuerySchema.parse({ type: "lost", subcategory: "living.umbrella" })).toMatchObject({
      categoryCode: "living",
      subcategory: "living.umbrella",
    });
  });

  it("treats empty values as no filter", () => {
    const parsed = listQuerySchema.parse({ type: "found", categoryCode: "", subcategory: "" });
    expect(parsed.categoryCode).toBeUndefined();
    expect(parsed.subcategory).toBeUndefined();
  });

  it("rejects unknown codes and a subcategory outside the chosen category", () => {
    expect(listQuerySchema.safeParse({ type: "found", categoryCode: "전자기기" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ type: "found", subcategory: "electronics.drone" }).success).toBe(false);
    const mismatch = listQuerySchema.safeParse({ type: "found", categoryCode: "wallet", subcategory: "card_id.debit_card" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.message).toBe("소분류가 선택한 카테고리에 속하지 않습니다.");
  });

  it("keeps the legacy category param working unchanged", () => {
    expect(listQuerySchema.parse({ type: "found", category: "지갑" })).toMatchObject({ category: "지갑", categoryCode: undefined });
  });
});

describe("categoryFilterQuerySchema (AI search route)", () => {
  it("parses the same parameters from the URL, ignoring others", () => {
    expect(categoryFilterQuerySchema.parse({ categoryCode: "bag", subcategory: "bag.pouch", q: "x", period: "1w" })).toMatchObject({
      categoryCode: "bag",
      subcategory: "bag.pouch",
    });
    expect(categoryFilterQuerySchema.parse({})).toMatchObject({ categoryCode: undefined, subcategory: undefined });
    expect(categoryFilterQuerySchema.safeParse({ categoryCode: "bag", subcategory: "wallet.other" }).success).toBe(false);
  });
});

describe("categoryCodeConditions (vector search SQL)", () => {
  it("adds bound-parameter conditions for each given filter", () => {
    expect(categoryCodeConditions({})).toHaveLength(0);
    const main = categoryCodeConditions({ categoryCode: "electronics" });
    expect(main).toHaveLength(1);
    expect(main[0].sql).toBe("category_code = ?");
    expect(main[0].values).toEqual(["electronics"]);
    const both = categoryCodeConditions({ categoryCode: "electronics", subcategory: "electronics.earphones" });
    expect(both.map((c) => c.sql)).toEqual(["category_code = ?", "subcategory = ?"]);
    expect(both[1].values).toEqual(["electronics.earphones"]);
  });
});
