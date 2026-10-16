import { beforeEach, describe, expect, it, vi } from "vitest";

// 개인정보처리방침 2026-10-16 (이용 통계): announced, not re-consented. A
// member whose consents are the ones on Production keeps using the
// service -- the page gate (requireReadyUser, also the (main) layout's
// hasRequiredConsents), the write API gate (requireUserForApi: posts,
// comments, chat) and the 이름·소속 gate for posting / chatting
// (hasIdentityInfo) -- and nothing writes to their consent record.

const auth = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const identityCount = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique, update }, userIdentityInfo: { count: identityCount } } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/auth/access", () => ({ hasOngoingExternalAccess: vi.fn() }));

const { hasRequiredConsents, requireReadyUser } = await import("./session");
const { requireUserForApi } = await import("@/lib/posts/http");
const { hasIdentityInfo } = await import("@/lib/identity/service");

// Exactly what a fully onboarded Production member has on file.
const productionMember = {
  id: 1,
  nickname: "기존회원",
  userType: "STUDENT",
  deletedAt: null,
  isSuspended: false,
  suspendedUntil: null,
  privacyConsentAt: new Date("2026-10-14T03:00:00Z"),
  privacyConsentVersion: "2026-10-14",
  termsAcceptedAt: new Date("2026-10-14T03:00:00Z"),
  termsVersion: "2026-10-04",
  identityConsentVersion: "2026-10-14",
};

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "1" } });
  findUnique.mockReset();
  update.mockReset();
  identityCount.mockReset();
});

describe("기존 회원: 추가 동의 없이 이용", () => {
  for (const [name, member] of [
    ["a Production member (2026-10-14 consents)", productionMember],
    ["a Preview member who consented on 2026-10-16", { ...productionMember, privacyConsentVersion: "2026-10-16", identityConsentVersion: "2026-10-16" }],
  ] as const) {
    it(`lets ${name} browse, search, post and chat`, async () => {
      findUnique.mockResolvedValue(member);
      expect(hasRequiredConsents(member)).toBe(true); // (main) layout: browsing, search
      await expect(requireReadyUser()).resolves.toMatchObject({ id: 1 }); // write pages (post form, chat)
      expect(await requireUserForApi()).toEqual({ user: member }); // POST posts / comments / chat messages
      identityCount.mockResolvedValueOnce(1);
      expect(await hasIdentityInfo(1)).toBe(true); // 이름·소속 on file -> posting / chatting allowed
      expect(identityCount.mock.calls[0][0].where.user.identityConsentVersion.in).toContain(member.identityConsentVersion);
      expect(update).not.toHaveBeenCalled(); // their consent record is untouched
    });
  }

  it("still sends an account without the current consents to the consent screen", async () => {
    findUnique.mockResolvedValue({ ...productionMember, privacyConsentVersion: "2026-10-05" });
    await expect(requireReadyUser()).rejects.toThrow("REDIRECT:/privacy-consent");
    findUnique.mockResolvedValue({ ...productionMember, termsVersion: "2026-09-27" });
    await expect(requireReadyUser()).rejects.toThrow("REDIRECT:/privacy-consent");
  });
});
