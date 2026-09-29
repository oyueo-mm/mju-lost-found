import { describe, expect, it } from "vitest";

import { getPaginationItems, type PaginationItem } from "./paginationItems";

// Compact rendering for readable assertions: ellipsis -> "…".
const show = (items: PaginationItem[]) => items.map((i) => (typeof i === "number" ? String(i) : "…")).join(" ");

describe("getPaginationItems", () => {
  it("matches the target layout: 1 … 4 5 [6] 7 8 … 20", () => {
    expect(show(getPaginationItems(6, 20, 2))).toBe("1 … 4 5 6 7 8 … 20");
  });

  it("uses one sibling on each side for the compact (mobile) layout", () => {
    expect(show(getPaginationItems(6, 20, 1))).toBe("1 … 5 6 7 … 20");
  });

  it("handles the first and last pages", () => {
    expect(show(getPaginationItems(1, 20, 2))).toBe("1 2 3 … 20");
    expect(show(getPaginationItems(20, 20, 2))).toBe("1 … 18 19 20");
    expect(show(getPaginationItems(1, 20, 1))).toBe("1 2 … 20");
    expect(show(getPaginationItems(20, 20, 1))).toBe("1 … 19 20");
  });

  it("fills a gap of exactly one page instead of showing an ellipsis", () => {
    // 1 _ 3: page 2 is shown rather than "1 … 3".
    expect(show(getPaginationItems(5, 20, 2))).toBe("1 2 3 4 5 6 7 … 20");
    expect(show(getPaginationItems(16, 20, 2))).toBe("1 … 14 15 16 17 18 19 20");
    expect(show(getPaginationItems(4, 20, 1))).toBe("1 2 3 4 5 … 20");
    expect(show(getPaginationItems(5, 20, 1))).toBe("1 … 4 5 6 … 20");
    expect(show(getPaginationItems(3, 20, 1))).toBe("1 2 3 4 … 20");
  });

  it("shows every page with no ellipsis when there are few pages", () => {
    expect(show(getPaginationItems(1, 1, 2))).toBe("1");
    expect(show(getPaginationItems(1, 2, 2))).toBe("1 2");
    expect(show(getPaginationItems(3, 5, 2))).toBe("1 2 3 4 5");
    expect(show(getPaginationItems(4, 7, 2))).toBe("1 2 3 4 5 6 7");
    expect(show(getPaginationItems(2, 3, 1))).toBe("1 2 3");
  });

  it("returns nothing when there are no pages", () => {
    expect(getPaginationItems(1, 0, 2)).toEqual([]);
  });

  it("clamps an out-of-range or invalid current page into range", () => {
    expect(show(getPaginationItems(99, 20, 2))).toBe("1 … 18 19 20");
    expect(show(getPaginationItems(0, 20, 2))).toBe("1 2 3 … 20");
    expect(show(getPaginationItems(-3, 20, 2))).toBe("1 2 3 … 20");
    expect(show(getPaginationItems(Number.NaN, 20, 2))).toBe("1 2 3 … 20");
  });

  it("gives the two ellipses distinct values so they can be used as React keys", () => {
    const items = getPaginationItems(10, 20, 1);
    expect(items).toEqual([1, "ellipsis-start", 9, 10, 11, "ellipsis-end", 20]);
  });

  it("never repeats or reorders a page number", () => {
    for (let total = 1; total <= 30; total++) {
      for (let page = 1; page <= total; page++) {
        for (const siblings of [0, 1, 2, 3]) {
          const nums = getPaginationItems(page, total, siblings).filter((i): i is number => typeof i === "number");
          expect(new Set(nums).size).toBe(nums.length);
          expect([...nums].sort((a, b) => a - b)).toEqual(nums);
          expect(nums[0]).toBe(1);
          expect(nums[nums.length - 1]).toBe(total);
          expect(nums).toContain(page);
        }
      }
    }
  });
});
