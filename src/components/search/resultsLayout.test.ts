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
  it("is a 2-column grid on a phone (1 column in 목록형), 2 columns of rows on a tablet/laptop, 3 from 1280px", () => {
    expect(BOARD_RESULTS_GRID_CLASS).toMatch(/(^| )grid-cols-2( |$)/);
    expect(BOARD_RESULTS_GRID_CLASS).toContain("board-list:grid-cols-1");
    expect(BOARD_RESULTS_GRID_CLASS).toContain("sm:grid-cols-2");
    expect(BOARD_RESULTS_GRID_CLASS).toContain("xl:grid-cols-3");
    expect(BOARD_RESULTS_GRID_CLASS).not.toContain("grid-cols-4");
    // rows of equal-height cards from sm
    expect(BOARD_RESULTS_GRID_CLASS).toContain("sm:items-stretch");
    // natural card heights from sm, but a plain row-by-row grid (sort order kept)
    expect(BOARD_RESULTS_GRID_CLASS).toContain("items-start");
    expect(BOARD_RESULTS_GRID_CLASS).not.toMatch(/columns-|masonry/);
  });
});
