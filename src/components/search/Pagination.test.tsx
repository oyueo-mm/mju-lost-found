import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { Pagination } from "./Pagination";

describe("shared keyword/semantic pagination", () => {
  it("keeps semantic mode, filters and an explicit all-status selection in page links", () => {
    const html = renderToStaticMarkup(<I18nProvider locale="ko" messages={ko}>
      <Pagination basePath="/lost" currentSearchParams={{ mode: "semantic", searchMode: "keyword", status: "", categoryCode: "wallet" }} page={2} totalPages={3} />
    </I18nProvider>);
    expect(html).toContain("mode=semantic&amp;searchMode=keyword&amp;status=&amp;categoryCode=wallet&amp;page=3");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("이전");
  });
});
