import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));
// the real search panel (client); stood in for by a marker
vi.mock("@/components/home/HomeSearchBar", () => ({ HomeSearchBar: () => <form data-testid="home-search" /> }));

const { Hero } = await import("./Hero");
const html = renderToStaticMarkup(await Hero());
const at = (needle: string) => {
  const i = html.indexOf(needle);
  if (i < 0) throw new Error(`missing: ${needle}`);
  return i;
};

describe("비로그인 홈 첫 화면", () => {
  it("leads with the search: headline, what works without an account, then the search itself", () => {
    expect(at(ko["landing.searchHeadline"])).toBeLessThan(at(ko["landing.subtitle"]));
    expect(at(ko["landing.subtitle"])).toBeLessThan(at('data-testid="home-search"'));
    expect(ko["landing.searchHeadline"]).toBe("명지대에서 잃어버린 물건, 여기서 찾아보세요.");
    // no promise that AI finds or returns the item
    expect(ko["landing.subtitle"]).toContain("로그인 없이");
    expect(ko["landing.subtitle"]).not.toMatch(/찾아드|반드시|보장/);
  });

  it("posting a found item comes second (the usual sign-in, then back), signing in is only a text link", () => {
    expect(at('data-testid="home-search"')).toBeLessThan(at('href="/found/new"'));
    expect(html).toContain(ko["landing.registerFound"]);
    const login = html.match(/<a[^>]*href="\/login"[^>]*>/g) ?? [];
    expect(login).toHaveLength(1);
    expect(login[0]).not.toMatch(/bg-primary|rounded-full|h-1[01]/); // a link, not a button
    expect(at('href="/found/new"')).toBeLessThan(at('href="/login"'));
  });

  it("says what needs an account, and that it is an unofficial student-run service", () => {
    expect(html).toContain(ko["landing.accessNote"]);
    expect(ko["landing.accessNote"]).toMatch(/등록.*채팅.*알림/);
    expect(html).toContain(ko["landing.badge"]);
    expect(ko["landing.badge"]).toContain("비공식");
  });
});
