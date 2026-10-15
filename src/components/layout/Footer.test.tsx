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
    expect(html).toMatch(/<a href="mailto:mjusmartlostfound@gmail\.com"[^>]*>mjusmartlostfound@gmail\.com<\/a>/);
  });

  it("labels it in the current language", async () => {
    locale = "en";
    const html = await render();

    expect(html).toContain(en["footer.contact"]);
    expect(html).toContain('href="mailto:mjusmartlostfound@gmail.com"');
  });

  it("lists the team and developer mailboxes (no GitHub link) and says it is a student-run, unofficial service", async () => {
    locale = "ko";
    const html = await render();

    expect(html).not.toContain("github.com");
    expect(html).not.toContain("GitHub");
    // 운영팀, 개발자: two separate contacts.
    expect(html).toContain(ko["footer.developerContact"]);
    expect(html).toContain('href="mailto:oyueo.mm@mju.ac.kr"');
    expect(html).not.toContain("oyeo.mm@");
    expect(html).toContain(ko["footer.disclaimer"]);
    expect(ko["footer.disclaimer"]).toMatch(/공식 서비스가 아닌.*학생이 개발·운영/);
  });
});

describe("Footer layout", () => {
  it("orders brand + menus, then contacts, then policy links and copyright", async () => {
    locale = "ko";
    const html = await render();

    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const brand = at(ko["footer.tagline"]);
    const menus = at(`aria-label="${ko["footer.section.service"]}"`);
    const contacts = at("mailto:mjusmartlostfound@gmail.com");
    const developer = at("mailto:oyueo.mm@mju.ac.kr");
    const terms = at('href="/policy/terms"');
    const copyright = at("특정 게시물·메시지");

    expect(brand).toBeLessThan(menus);
    expect(menus).toBeLessThan(contacts);
    expect(contacts).toBeLessThan(developer);
    expect(developer).toBeLessThan(terms);
    expect(terms).toBeLessThan(copyright);
  });

  it("shows the description once and drops the redundant credit line", async () => {
    locale = "ko";
    const html = await render();

    expect(html.split(ko["footer.tagline"])).toHaveLength(2);
    expect(html.split(ko["footer.disclaimer"])).toHaveLength(2);
    expect(html).not.toContain("Created by MJU students");
    // Policy links appear once (not in both the menus and the bottom row).
    expect(html.split('href="/policy/privacy"')).toHaveLength(2);
  });
});
