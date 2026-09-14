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
  it("renders the localized label and all four keyword chips", () => {
    const markup = renderHomeSearch();

    expect(markup).toContain("인기 검색어");
    for (const keyword of HOME_POPULAR_SEARCHES) {
      expect(markup).toMatch(
        new RegExp(`<button(?=[^>]*type="button")(?=[^>]*value="${keyword}")[^>]*>`),
      );
    }
  });

  it("keeps Home on the existing AI found search flow", () => {
    const markup = renderHomeSearch();

    expect(markup).toContain('data-search-mode="ai"');
    expect(markup).toContain('data-search-type="found"');
  });

  it("uses the clicked chip value as the submitted AI query", () => {
    expect(resolveAiSearchQuery("직접 입력한 검색어", "무선 이어폰")).toBe("무선 이어폰");
    expect(resolveAiSearchQuery("  휴대폰  ")).toBe("휴대폰");
  });

  it("uses the approved Korean keyword set for every locale", () => {
    expect(HOME_POPULAR_SEARCHES).toEqual(["카드", "지갑", "무선 이어폰", "휴대폰"]);
    expect(HOME_POPULAR_SEARCHES).not.toContain("에어팟");
    expect(HOME_POPULAR_SEARCHES).not.toContain("학생증");
    expect(HOME_POPULAR_SEARCHES).not.toContain("공학관");
    expect(HOME_POPULAR_SEARCHES).not.toContain("버즈");
  });
});
