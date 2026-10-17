import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));
// the real search panel (client); stood in for by a marker
vi.mock("@/components/home/HomeSearchBar", () => ({ HomeSearchBar: ({ variant }: { variant?: string }) => <form data-testid="home-search" data-variant={variant} /> }));

const { Hero } = await import("./Hero");
const html = renderToStaticMarkup(await Hero());
const at = (needle: string) => {
  const i = html.indexOf(needle);
  if (i < 0) throw new Error(`missing: ${needle}`);
  return i;
};

describe("비로그인 홈 첫 화면", () => {
  it("leads with a two-line headline (second line in the brand colour), one short line, then the search", () => {
    expect(ko["landing.searchHeadline"]).toBe("잃어버린 물건,\n여기서 찾아보세요.");
    expect(html).toMatch(/<h1[^>]*><span class="block">잃어버린 물건,<\/span><span class="text-headline-accent block">여기서 찾아보세요\.<\/span><\/h1>/);
    expect(html).toMatch(/<h1[^>]*break-keep/); // never split inside a word
    expect(at("여기서 찾아보세요.")).toBeLessThan(at(ko["landing.subtitle"]));
    expect(at(ko["landing.subtitle"])).toBeLessThan(at('data-variant="landing"'));
    // two short lines, no promise that AI finds or returns the item
    expect(ko["landing.subtitle"].split("\n")).toHaveLength(2);
    expect(ko["landing.subtitle"]).not.toMatch(/찾아드|반드시|보장/);
  });

  it("then posting, lost and found side by side; no sign-in link or repeated 'no sign-in' note", () => {
    expect(at('data-variant="landing"')).toBeLessThan(at('href="/lost/new"'));
    expect(at('href="/lost/new"')).toBeLessThan(at('href="/found/new"'));
    expect(html).toContain(ko["landing.registerLost"]);
    expect(html).toContain(ko["landing.registerFound"]);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("로그인 없이");
  });

  it("says it is an unofficial student-run service", () => {
    expect(html).toContain(ko["landing.badge"]);
    expect(ko["landing.badge"]).toContain("비공식");
  });

  it("starts its glow right under the header: cancels <main>'s top padding, full width on phones", () => {
    expect(html).toMatch(/<section class="[^"]*-mt-6[^"]*md:-mt-10/);
    expect(html).toMatch(/<section class="[^"]*-mx-4[^"]*md:-mx-6/);
  });
});
