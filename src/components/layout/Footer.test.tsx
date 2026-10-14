import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { en } from "@/lib/i18n/messages/en";
import { ko } from "@/lib/i18n/messages/ko";

let locale: "ko" | "en" = "ko";
vi.mock("@/lib/i18n/server", () => ({
  getTranslator: vi.fn(async () => (locale === "ko" ? createTranslator("ko", ko) : createTranslator("en", en))),
}));
vi.mock("@/components/layout/LocaleSwitcher", () => ({ LocaleSwitcher: () => null }));

const { Footer } = await import("./Footer");

async function render() {
  const stream = await renderToReadableStream(await Footer());
  await stream.allReady;
  return new Response(stream).text();
}

// The Footer is part of the public shell (home, lists, policies), so this
// is the contact anyone can see without signing in.
describe("Footer contact", () => {
  it("shows the operator mailbox as a mailto link", async () => {
    locale = "ko";
    const html = await render();

    expect(html).toContain(ko["footer.contact"]);
    expect(html).toMatch(/<a href="mailto:oyeo\.mm@mju\.ac\.kr"[^>]*>oyeo\.mm@mju\.ac\.kr<\/a>/);
  });

  it("labels it in the current language", async () => {
    locale = "en";
    const html = await render();

    expect(html).toContain(en["footer.contact"]);
    expect(html).toContain('href="mailto:oyeo.mm@mju.ac.kr"');
  });

  it("links the public GitHub repository and says it is a student-run, unofficial service", async () => {
    locale = "ko";
    const html = await render();

    expect(html).toContain('href="https://github.com/oyueo-mm/mju-lost-found"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(ko["footer.github"]);
    expect(html).toContain(ko["footer.disclaimer"]);
    expect(ko["footer.disclaimer"]).toMatch(/공식 서비스가 아닌.*학생이 개발·운영/);
  });
});
