import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";

const isGoogleTestModeEnabled = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => null),
  getRejoinIdentityId: vi.fn(async () => null),
  hasRequiredConsents: vi.fn(() => true),
  sanitizeCallbackUrl: (url?: string) => url,
}));
vi.mock("@/lib/settings/service", () => ({ isGoogleTestModeEnabled }));
vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));

const LoginPage = (await import("./page")).default;

async function render(searchParams: { error?: string } = {}) {
  const stream = await renderToReadableStream(await LoginPage({ searchParams: Promise.resolve(searchParams) }));
  await stream.allReady;
  return new Response(stream).text();
}

const count = (html: string, text: string) => html.split(text).length - 1;

beforeEach(() => {
  isGoogleTestModeEnabled.mockResolvedValue(false);
});

describe("login page", () => {
  it("shows the account restriction once after an AccessDenied rejection", async () => {
    const html = await render({ error: "AccessDenied" });

    expect(count(html, ko["auth.login.error.accessDenied"])).toBe(1);
    expect(html).not.toContain(ko["auth.login.domainNotice"]);
  });

  it("keeps the restriction notice on a normal visit and on other errors", async () => {
    expect(await render()).toContain(ko["auth.login.domainNotice"]);

    const other = await render({ error: "Configuration" });
    expect(other).toContain(ko["auth.login.error.default"]);
    expect(other).toContain(ko["auth.login.domainNotice"]);
  });

  it("links to the operator's mailbox for anyone who can't sign in", async () => {
    const html = await render({ error: "AccessDenied" });

    expect(html).toContain(ko["auth.login.troublePrompt"]);
    expect(html).toMatch(/<a href="mailto:mjusmartlostfound@gmail\.com"[^>]*>운영팀에 문의하기<\/a>/);
  });
});
