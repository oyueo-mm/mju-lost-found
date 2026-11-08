import type { AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";

vi.mock("next/navigation", () => ({ usePathname: () => "/search" }));
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));

import { DesktopNav } from "./DesktopNav";
import { MobileSearchLink } from "./MobileSearchLink";

describe("unified search navigation", () => {
  it("renders the desktop search as one direct link without a menu button", () => {
    const html = renderToStaticMarkup(<I18nProvider locale="ko" messages={ko}><DesktopNav unreadChatCount={0} onSignOut={() => {}} /></I18nProvider>);
    expect(html.match(/href="\/search"/g)).toHaveLength(1);
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("설명·사진 검색");
    expect(html).not.toContain("키워드 검색");
    expect(html).not.toContain("aria-haspopup");
  });
  it("renders the mobile header search as a single /search link", () => {
    const html = renderToStaticMarkup(<I18nProvider locale="ko" messages={ko}><MobileSearchLink /></I18nProvider>);
    expect(html).toContain('href="/search"');
    expect(html).toContain(">검색</a>");
    expect(html).toContain("md:hidden");
    expect(html).not.toContain("<button");
  });
});
