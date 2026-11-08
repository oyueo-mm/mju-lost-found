import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { resolveAiSearchQuery } from "@/components/search/AISearchPanel";
import { HOME_POPULAR_SEARCHES, HomeSearchBar } from "./HomeSearchBar";
import { HomeSearchProvider, HomeSearchResults } from "./HomeSearch";

function renderHomeSearch(): string {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <HomeSearchProvider><HomeSearchBar /><HomeSearchResults><p>기존 추천 게시글</p></HomeSearchResults></HomeSearchProvider>
    </I18nProvider>,
  );
}

describe("HomeSearchBar popular searches", () => {
  it("renders popular keywords as inline search buttons and preserves the initial home slot", () => {
    const markup = renderHomeSearch();

    expect(markup).toContain("인기 검색어");
    for (const keyword of HOME_POPULAR_SEARCHES) {
      expect(markup).toContain(`value="${keyword}"`);
      expect(markup).not.toContain("href=\"/search");
    }
    expect(markup).toContain(">버즈</button>");
    expect(markup).toContain(">에어팟</button>");
    expect(markup).toContain("기존 추천 게시글");
    expect(markup).not.toContain("무선 이어폰");
  });

  it("opens the unified found search flow from Home", () => {
    const markup = renderHomeSearch();

    expect(markup).toContain('data-search-mode="unified"');
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
