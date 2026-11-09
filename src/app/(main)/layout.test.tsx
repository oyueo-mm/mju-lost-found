import { beforeEach, expect, it, vi } from "vitest";

let user: { nickname: string | null; consented: boolean } | null;
let returnPath: string | null;
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => returnPath }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => user, getRejoinIdentityId: async () => null, hasRequiredConsents: (u: { consented: boolean }) => u.consented }));
vi.mock("@/lib/chat/service", () => ({ countUnreadMessagesForUser: async () => 0 }));
vi.mock("@/lib/metrics/record", () => ({ kstDay: () => "2026-11-09" }));
vi.mock("@/components/layout/Header", () => ({ Header: () => null }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/layout/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("@/components/post/DraftJanitor", () => ({ DraftJanitor: () => null }));
vi.mock("@/components/layout/ActivityBeacon", () => ({ ActivityBeacon: () => null }));
vi.mock("@/components/layout/PrivacyPolicyNotice", () => ({ PrivacyPolicyNotice: () => null }));
const { default: Layout } = await import("./layout");
beforeEach(() => { returnPath = "/found/new?utm_source=poster_qr&utm_campaign=h_guard01_register"; });

it("preserves registration at the parent nickname gate before the page renders", async () => {
  user = { nickname: null, consented: true };
  await expect(Layout({ children: null })).rejects.toThrow(`REDIRECT:/onboarding?callbackUrl=${encodeURIComponent(returnPath!)}`);
});

it("preserves registration at the parent consent gate", async () => {
  user = { nickname: null, consented: false };
  await expect(Layout({ children: null })).rejects.toThrow(`REDIRECT:/privacy-consent?callbackUrl=${encodeURIComponent(returnPath!)}`);
});

it("keeps the existing gate for pages without a registration destination", async () => {
  user = { nickname: null, consented: true };
  returnPath = "/admin";
  await expect(Layout({ children: null })).rejects.toThrow("REDIRECT:/onboarding");
});
