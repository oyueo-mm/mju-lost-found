import { describe, expect, it } from "vitest";

import { resolveSearchUiMode, withSearchMode } from "./searchModeParams";

const p = (query: string) => new URLSearchParams(query);
const asObject = (query: string) => Object.fromEntries(new URLSearchParams(query));

describe("resolveSearchUiMode", () => {
  it("uses the page default when the URL says nothing (/lost·/found keyword, /search AI)", () => {
    expect(resolveSearchUiMode(p(""), "keyword")).toBe("keyword");
    expect(resolveSearchUiMode(p("q=지갑"), "ai")).toBe("ai");
  });

  it("lets searchMode override the default either way", () => {
    expect(resolveSearchUiMode(p("searchMode=ai"), "keyword")).toBe("ai");
    expect(resolveSearchUiMode(p("searchMode=keyword"), "ai")).toBe("keyword");
  });

  it("still honors older links that used mode=ai / mode=keyword", () => {
    expect(resolveSearchUiMode(p("mode=ai"), "keyword")).toBe("ai");
    expect(resolveSearchUiMode(p("mode=keyword&type=found"), "ai")).toBe("keyword");
  });

  it("prefers searchMode over a legacy mode and ignores unrelated mode values", () => {
    expect(resolveSearchUiMode(p("searchMode=keyword&mode=ai"), "ai")).toBe("keyword");
    expect(resolveSearchUiMode(p("mode=semantic"), "ai")).toBe("ai");
    expect(resolveSearchUiMode(p("searchMode=bogus"), "keyword")).toBe("keyword");
  });
});

describe("withSearchMode", () => {
  it("writes searchMode only when it differs from the page default", () => {
    expect(withSearchMode("", "ai", "keyword")).toBe("searchMode=ai");
    expect(withSearchMode("searchMode=ai", "keyword", "keyword")).toBe("");
    expect(withSearchMode("", "keyword", "ai")).toBe("searchMode=keyword");
  });

  it("keeps every other search parameter (period, category, type, ...)", () => {
    const next = withSearchMode(
      "q=지갑&type=found&category=지갑&period=custom&from=2026-09-20&to=2026-09-25&unknownTime=include",
      "ai",
      "keyword",
    );
    expect(asObject(next)).toEqual({
      q: "지갑",
      type: "found",
      category: "지갑",
      period: "custom",
      from: "2026-09-20",
      to: "2026-09-25",
      unknownTime: "include",
      searchMode: "ai",
    });
  });

  it("drops a legacy UI-mode `mode` but leaves other `mode` values alone", () => {
    expect(asObject(withSearchMode("mode=keyword&category=지갑", "ai", "keyword"))).toEqual({ category: "지갑", searchMode: "ai" });
    expect(asObject(withSearchMode("mode=semantic&q=a", "keyword", "ai"))).toEqual({ mode: "semantic", q: "a", searchMode: "keyword" });
  });

  it("round-trips with resolveSearchUiMode", () => {
    for (const defaultMode of ["ai", "keyword"] as const) {
      for (const mode of ["ai", "keyword"] as const) {
        expect(resolveSearchUiMode(p(withSearchMode("period=1w", mode, defaultMode)), defaultMode)).toBe(mode);
      }
    }
  });
});
