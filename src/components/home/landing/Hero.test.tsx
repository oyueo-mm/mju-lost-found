import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));
// the real search panel (client); stood in for by a marker
vi.mock("@/components/home/HomeSearchBar", () => ({ HomeSearchBar: ({ variant }: { variant?: string }) => <form data-testid="home-search" data-variant={variant} /> }));
vi.mock("../HomeSearch", () => ({ HomeSearchProvider: ({ children }: { children: ReactNode }) => children, HomeSearchResults: () => null }));

const { Hero } = await import("./Hero");
const html = renderToStaticMarkup(await Hero());
const at = (needle: string) => {
  const i = html.indexOf(needle);
  if (i < 0) throw new Error(`missing: ${needle}`);
  return i;
};

describe("홈 첫 화면 (Soft Card)", () => {
  it("leads with a two-line black headline, one short line, then the search", () => {
    expect(ko["landing.searchHeadline"]).toBe("잃어버린 물건,\n다시 찾을 수 있게.");
    expect(html).toMatch(/<h1[^>]*><span class="block">잃어버린 물건,<\/span><span class="block">다시 찾을 수 있게\.<\/span><\/h1>/);
    expect(html).toMatch(/<h1[^>]*break-keep/); // never split inside a word
    expect(at("다시 찾을 수 있게.")).toBeLessThan(at(ko["landing.subtitle"]));
    expect(at(ko["landing.subtitle"])).toBeLessThan(at('data-variant="landing"'));
    expect(ko["landing.subtitle"]).toBe("명지대 분실물과 습득물을 한곳에서 검색하고, 연락하고, 돌려받으세요.");
    // no promise that AI finds or returns the item
    expect(ko["landing.subtitle"]).not.toMatch(/찾아드|반드시|보장/);
  });

  it("is a plain soft card: no gradient, glow, blur or accent-coloured headline line", () => {
    expect(html).not.toMatch(/gradient|blur|text-headline-accent|bg-primary\/10/);
    expect(html).toMatch(/<section class="[^"]*rounded-3xl[^"]*border[^"]*bg-muted/);
    expect(html).not.toMatch(/<section class="[^"]*-mt-/); // no negative margins reaching under the header
  });

  it("keeps the search anchor LandingStickyCta watches, and has no badge, sign-in link or 'no sign-in' note", () => {
    expect(html).toContain('id="landing-hero-cta"');
    expect(html.slice(0, html.indexOf("<h1"))).not.toMatch(/<span|<p/);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("로그인 없이");
    expect(html).not.toContain("비공식");
    expect(ko["footer.disclaimer"]).toContain("공식 서비스가 아닌");
  });
});
