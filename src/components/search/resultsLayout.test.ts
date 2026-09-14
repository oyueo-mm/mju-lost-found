import { describe, expect, it } from "vitest";

import { SEARCH_RESULTS_GRID_CLASS } from "./resultsLayout";

describe("search results grid", () => {
  it("keeps two mobile columns and uses three wider desktop columns", () => {
    expect(SEARCH_RESULTS_GRID_CLASS).toContain("grid-cols-2");
    expect(SEARCH_RESULTS_GRID_CLASS).toContain("sm:grid-cols-3");
    expect(SEARCH_RESULTS_GRID_CLASS).not.toContain("items-start");
    expect(SEARCH_RESULTS_GRID_CLASS).not.toContain("lg:grid-cols-4");
  });
});
