import { describe, expect, it } from "vitest";

import { categorySearchHref } from "./CategoryShortcuts";
import { CATEGORIES, listQuerySchema } from "@/lib/posts/schema";

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
    expect(paramsOf(categorySearchHref("전자기기")).get("mode")).toBe("keyword");
  });

  it("carries the category as the exact value stored in the DB, not a translated label", () => {
    for (const category of CATEGORIES) {
      expect(paramsOf(categorySearchHref(category)).get("category")).toBe(category);
    }
  });

  it("targets the 습득물 board, matching /search's own default", () => {
    expect(paramsOf(categorySearchHref("가방")).get("type")).toBe("found");
  });

  it("never invents a search term", () => {
    expect(paramsOf(categorySearchHref("지갑")).get("q")).toBeNull();
  });

  it("percent-encodes the Korean category so the link is a valid URL", () => {
    expect(categorySearchHref("전자기기")).toContain(`category=${encodeURIComponent("전자기기")}`);
  });

  it("produces a query the server's own list schema accepts as a keyword search", () => {
    // 서버(/search/page.tsx)가 실제로 통과시키는 경로와 같은 검증이다 --
    // 여기서 통과해야 키워드 검색 결과가 렌더링된다.
    for (const category of CATEGORIES) {
      const params = Object.fromEntries(paramsOf(categorySearchHref(category)));
      const parsed = listQuerySchema.safeParse({ type: "found", ...params });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.mode).toBe("keyword");
        expect(parsed.data.category).toBe(category);
        expect(parsed.data.type).toBe("found");
      }
    }
  });
});
