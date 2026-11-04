import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));

const { QuickActions } = await import("./QuickActions");
const html = renderToStaticMarkup(await QuickActions());

describe("홈 빠른 기능 바로가기", () => {
  it("browses the two boards first, then the two post forms", () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/found", "/lost", "/lost/new", "/found/new"]);
  });

  it("gives every shortcut a title and a short description", () => {
    for (const text of [ko["landing.stats.browseFound"], ko["landing.stats.browseLost"], ko["landing.registerLost"], ko["landing.registerFound"], ko["home.quick.found.desc"], ko["home.quick.lost.desc"]]) {
      expect(html).toContain(text);
    }
  });

  it("is two columns on a phone and four from md, with no gradient or heavy shadow", () => {
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("md:grid-cols-4");
    expect(html).not.toMatch(/gradient|shadow-(md|lg|xl)/);
  });
});
