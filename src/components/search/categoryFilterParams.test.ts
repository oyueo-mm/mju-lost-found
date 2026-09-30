import { describe, expect, it } from "vitest";

import {
  EMPTY_CATEGORY_FILTER,
  categoryFilterToEntries,
  readCategoryFilterState,
  withCategoryFilterParams,
} from "./categoryFilterParams";

const read = (query: string) => readCategoryFilterState(new URLSearchParams(query));

describe("readCategoryFilterState", () => {
  it("reads a main category alone, and with its subcategory", () => {
    expect(read("categoryCode=electronics")).toEqual({ categoryCode: "electronics", subcategory: null, legacyCategory: null });
    expect(read("categoryCode=electronics&subcategory=electronics.earphones")).toEqual({
      categoryCode: "electronics",
      subcategory: "electronics.earphones",
      legacyCategory: null,
    });
  });

  it("derives the main category from a subcategory alone", () => {
    expect(read("subcategory=wallet.card_case")).toEqual({ categoryCode: "wallet", subcategory: "wallet.card_case", legacyCategory: null });
  });

  it("drops a subcategory that belongs to another main category, or an unknown code", () => {
    expect(read("categoryCode=wallet&subcategory=card_id.debit_card")).toEqual({ categoryCode: "wallet", subcategory: null, legacyCategory: null });
    expect(read("categoryCode=drones")).toEqual(EMPTY_CATEGORY_FILTER);
  });

  it("reads a legacy ?category= link as the matching main category (기타 -> 생활용품)", () => {
    expect(read(`category=${encodeURIComponent("지갑")}`)).toMatchObject({ categoryCode: "wallet", legacyCategory: null });
    expect(read(`category=${encodeURIComponent("기타")}`)).toMatchObject({ categoryCode: "living", legacyCategory: null });
  });

  it("keeps a legacy free-text category it can't map", () => {
    expect(read(`category=${encodeURIComponent("우산")}`)).toEqual({ ...EMPTY_CATEGORY_FILTER, legacyCategory: "우산" });
  });

  it("prefers categoryCode over a legacy category", () => {
    expect(read(`categoryCode=bag&category=${encodeURIComponent("지갑")}`)).toMatchObject({ categoryCode: "bag" });
  });
});

describe("categoryFilterToEntries / withCategoryFilterParams", () => {
  it("writes categoryCode and subcategory, or nothing for 전체", () => {
    expect(categoryFilterToEntries({ categoryCode: "bag", subcategory: null, legacyCategory: null })).toEqual([["categoryCode", "bag"]]);
    expect(categoryFilterToEntries({ categoryCode: "bag", subcategory: "bag.pouch", legacyCategory: null })).toEqual([
      ["categoryCode", "bag"],
      ["subcategory", "bag.pouch"],
    ]);
    expect(categoryFilterToEntries(EMPTY_CATEGORY_FILTER)).toEqual([]);
    expect(categoryFilterToEntries({ ...EMPTY_CATEGORY_FILTER, legacyCategory: "우산" })).toEqual([["category", "우산"]]);
  });

  it("replaces legacy and new category params while keeping the rest of the query", () => {
    const query = withCategoryFilterParams(
      `?q=${encodeURIComponent("에어팟")}&category=${encodeURIComponent("지갑")}&period=1w&searchMode=ai`,
      { categoryCode: "electronics", subcategory: "electronics.earphones", legacyCategory: null },
    );
    const params = new URLSearchParams(query);
    expect(params.get("category")).toBeNull();
    expect(params.get("categoryCode")).toBe("electronics");
    expect(params.get("subcategory")).toBe("electronics.earphones");
    expect(params.get("q")).toBe("에어팟");
    expect(params.get("period")).toBe("1w");
    expect(params.get("searchMode")).toBe("ai");
  });

  it("round-trips through the URL (refresh / share keeps the filter)", () => {
    const state = { categoryCode: "living" as const, subcategory: "living.umbrella" as const, legacyCategory: null };
    expect(readCategoryFilterState(new URLSearchParams(withCategoryFilterParams("", state)))).toEqual(state);
  });
});
