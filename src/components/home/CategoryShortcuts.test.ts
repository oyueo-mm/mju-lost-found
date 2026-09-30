import { describe, expect, it } from "vitest";

import { categorySearchHref } from "./CategoryShortcuts";
import { listQuerySchema } from "@/lib/posts/schema";
import { CATEGORY_CODES } from "@/lib/posts/categoryTaxonomy";
import { resolveSearchUiMode } from "@/components/search/searchModeParams";

// 홈 카테고리 버그 수정 Phase: 이 바로가기는 "AI 검색을 실행하는 버튼"이
// 아니라 "이 카테고리 게시글을 보여달라"는 필터 버튼이다. 예전에는
// `/search?category=...`로만 보냈는데, /search의 SearchFilterBar는 URL에
// `mode`가 없으면 그 페이지의 defaultMode인 "ai"로 시작하고, AI 모드는
// 서버가 이미 렌더링해 내려준 키워드 결과를 통째로 숨긴다 -- 그래서
// 카테고리를 눌러도 텅 빈 AI 검색창만 보였다. 아래 테스트가 그 회귀를
// 막는다.
function paramsOf(href: string): URLSearchParams {
  const [path, query] = href.split("?");
  expect(path).toBe("/search");
  return new URLSearchParams(query);
}

describe("categorySearchHref", () => {
  it("asks /search for keyword mode explicitly, never AI mode", () => {
    const params = paramsOf(categorySearchHref("electronics"));
    expect(params.get("searchMode")).toBe("keyword");
    // /search's own default is AI -- the link must still open in keyword mode.
    expect(resolveSearchUiMode(params, "ai")).toBe("keyword");
  });

  it("uses the page's searchMode parameter, not the search API's legacy mode", () => {
    expect(paramsOf(categorySearchHref("electronics")).get("mode")).toBeNull();
  });

  it("filters by the taxonomy categoryCode, not the legacy category string", () => {
    for (const code of CATEGORY_CODES) {
      const params = paramsOf(categorySearchHref(code));
      expect(params.get("categoryCode")).toBe(code);
      expect(params.get("category")).toBeNull();
      expect(params.get("subcategory")).toBeNull();
    }
  });

  it("targets the 습득물 board, matching /search's own default", () => {
    expect(paramsOf(categorySearchHref("bag")).get("type")).toBe("found");
  });

  it("never invents a search term", () => {
    expect(paramsOf(categorySearchHref("wallet")).get("q")).toBeNull();
  });

  it("produces a query the server's own list schema accepts as a keyword search", () => {
    // 서버(/search/page.tsx)가 실제로 통과시키는 경로와 같은 검증이다 --
    // 여기서 통과해야 키워드 검색 결과가 렌더링된다.
    for (const code of CATEGORY_CODES) {
      const params = Object.fromEntries(paramsOf(categorySearchHref(code)));
      const parsed = listQuerySchema.safeParse({ type: "found", ...params });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.mode).toBe("keyword");
        expect(parsed.data.categoryCode).toBe(code);
        expect(parsed.data.type).toBe("found");
      }
    }
  });
});
