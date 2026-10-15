import { describe, expect, it } from "vitest";

import { BOARD_RESULTS_GRID_CLASS, SEARCH_RESULTS_GRID_CLASS } from "./resultsLayout";

describe("search results grid", () => {
  it("keeps two mobile columns and uses three wider desktop columns", () => {
    expect(SEARCH_RESULTS_GRID_CLASS).toContain("grid-cols-2");
    expect(SEARCH_RESULTS_GRID_CLASS).toContain("sm:grid-cols-3");
    expect(SEARCH_RESULTS_GRID_CLASS).not.toContain("items-start");
    expect(SEARCH_RESULTS_GRID_CLASS).not.toContain("lg:grid-cols-4");
  });
});

describe("board results grid", () => {
  it("is one list column on a phone, two cards on a tablet and three on a desktop", () => {
    expect(BOARD_RESULTS_GRID_CLASS).toContain("grid-cols-1");
    expect(BOARD_RESULTS_GRID_CLASS).toContain("sm:grid-cols-2");
    expect(BOARD_RESULTS_GRID_CLASS).toContain("lg:grid-cols-3");
    // natural card heights from sm, but a plain row-by-row grid (sort order kept)
    expect(BOARD_RESULTS_GRID_CLASS).toContain("lg:items-start");
    expect(BOARD_RESULTS_GRID_CLASS).not.toMatch(/columns-|masonry/);
  });
});
