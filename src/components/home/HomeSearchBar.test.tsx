import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { resolveAiSearchQuery } from "@/components/search/AISearchPanel";
import { HOME_POPULAR_SEARCHES, HomeSearchBar } from "./HomeSearchBar";

function renderHomeSearch(): string {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <HomeSearchBar />
    </I18nProvider>,
  );
}

describe("HomeSearchBar popular searches", () => {
  it("renders the localized label and every chip as a link to 키워드 검색 for that word", () => {
    const markup = renderHomeSearch();

    expect(markup).toContain("인기 검색어");
    for (const keyword of HOME_POPULAR_SEARCHES) {
      const href = `/search?searchMode=keyword&amp;q=${encodeURIComponent(keyword)}`;
      expect(markup).toContain(`href="${href}"`);
      // no AI-search chip button any more
      expect(markup).not.toContain(`value="${keyword}"`);
    }
    expect(markup).toContain(">버즈</a>");
    expect(markup).toContain(">에어팟</a>");
    expect(markup).not.toContain("무선 이어폰");
  });

  it("keeps Home on the existing AI found search flow", () => {
    const markup = renderHomeSearch();

    expect(markup).toContain('data-search-mode="ai"');
    expect(markup).toContain('data-search-type="found"');
  });

  it("the AI panel's own quick searches (elsewhere) still submit the chip value", () => {
    expect(resolveAiSearchQuery("직접 입력한 검색어", "에어팟")).toBe("에어팟");
    expect(resolveAiSearchQuery("  휴대폰  ")).toBe("휴대폰");
  });

  it("uses the approved Korean keyword set for every locale", () => {
    expect(HOME_POPULAR_SEARCHES).toEqual(["카드", "지갑", "버즈", "에어팟", "휴대폰"]);
    expect(HOME_POPULAR_SEARCHES).not.toContain("무선 이어폰");
    expect(HOME_POPULAR_SEARCHES).not.toContain("학생증");
    expect(HOME_POPULAR_SEARCHES).not.toContain("공학관");
  });
});
