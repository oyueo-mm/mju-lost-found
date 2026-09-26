import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";

const requireUser = vi.fn();
const updateMany = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

// hasRequiredConsents() is pure logic (no DB/next-auth import, see
// session.ts's own comment) -- reimplemented here rather than mocked as a
// vi.fn(), so these tests exercise the real predicate against whatever
// consent fields each mocked requireUser() result carries, the same way
// session.test.ts does for the real session.ts module.
function hasRequiredConsents(user: {
  privacyConsentAt?: Date | null;
  termsAcceptedAt?: Date | null;
  termsVersion?: string | null;
}): boolean {
  return (
    (user.privacyConsentAt ?? null) !== null &&
    (user.termsAcceptedAt ?? null) !== null &&
    user.termsVersion === CURRENT_TERMS_VERSION
  );
}

vi.mock("@/lib/auth/session", () => ({ requireUser, hasRequiredConsents }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { updateMany } } }));
vi.mock("next/navigation", () => ({ redirect }));

const { setNicknameAction } = await import("./actions");

// 이용약관 동의 Phase: every existing test below now also carries a
// "ready" consent state (already consented to privacy + the current
// terms version) -- these tests are about the nickname-write logic, not
// consent, so they represent a user who has already cleared that gate,
// same as before this phase's own consent fields existed.
const readyConsent = { privacyConsentAt: new Date(), termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION };

beforeEach(() => {
  requireUser.mockReset();
  updateMany.mockReset();
  redirect.mockClear();
});

describe("setNicknameAction", () => {
  it("only ever updates the current session's own user (id comes from requireUser(), never the form)", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: null, ...readyConsent });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const form = new FormData();
    form.set("nickname", "새닉네임");
    // Even if a form somehow carried a userId field, the action never reads
    // one -- requireUser() is the only source of the id used in the write.
    form.set("userId", "999");

    await expect(setNicknameAction(null, form)).rejects.toThrow("REDIRECT:/");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7, nickname: null },
      data: { nickname: "새닉네임" },
    });
  });

  it("rejects an invalid nickname server-side without writing to the DB", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: null, ...readyConsent });

    const form = new FormData();
    form.set("nickname", "a"); // too short

    const result = await setNicknameAction(null, form);

    expect(result?.error).toBeTruthy();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing and redirects home if the user already has a nickname", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: "이미설정됨", ...readyConsent });

    const form = new FormData();
    form.set("nickname", "다른닉네임");

    await expect(setNicknameAction(null, form)).rejects.toThrow("REDIRECT:/");
    expect(updateMany).not.toHaveBeenCalled();
  });

  // Phase H-7: duplicate nicknames are allowed by design now (User.nickname's
  // old @unique constraint was dropped -- public identity is publicId
  // instead), so there is no longer a "nickname already taken" error path
  // to test here; a successful update always redirects home, even if
  // another user already has the same nickname.
  it("allows setting a nickname another user already has", async () => {
    requireUser.mockResolvedValueOnce({ id: 7, nickname: null, ...readyConsent });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const form = new FormData();
    form.set("nickname", "중복닉네임");

    await expect(setNicknameAction(null, form)).rejects.toThrow("REDIRECT:/");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7, nickname: null },
      data: { nickname: "중복닉네임" },
    });
  });

  // 이용약관 동의 Phase: this is the exact gap this phase's own analysis
  // found -- a direct call to this Server Action, bypassing the
  // onboarding *page*'s own redirect chain, must still be blocked when
  // required consent is missing, not just rely on the page never
  // rendering the form. No DB write ever happens in any of these cases.
  describe("blocks nickname-setting when required consent is missing (bypassing the page)", () => {
    it("redirects to /privacy-consent when privacy consent is missing", async () => {
      requireUser.mockResolvedValueOnce({
        id: 7,
        nickname: null,
        privacyConsentAt: null,
        termsAcceptedAt: new Date(),
        termsVersion: CURRENT_TERMS_VERSION,
      });

      const form = new FormData();
      form.set("nickname", "새닉네임");

      await expect(setNicknameAction(null, form)).rejects.toThrow(
        "REDIRECT:/privacy-consent?callbackUrl=%2Fonboarding",
      );
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("redirects to /privacy-consent when terms consent was never given", async () => {
      requireUser.mockResolvedValueOnce({
        id: 7,
        nickname: null,
        privacyConsentAt: new Date(),
        termsAcceptedAt: null,
        termsVersion: null,
      });

      const form = new FormData();
      form.set("nickname", "새닉네임");

      await expect(setNicknameAction(null, form)).rejects.toThrow(
        "REDIRECT:/privacy-consent?callbackUrl=%2Fonboarding",
      );
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("redirects to /privacy-consent when the stored terms version is stale", async () => {
      requireUser.mockResolvedValueOnce({
        id: 7,
        nickname: null,
        privacyConsentAt: new Date(),
        termsAcceptedAt: new Date(),
        termsVersion: "2025-01-01",
      });

      const form = new FormData();
      form.set("nickname", "새닉네임");

      await expect(setNicknameAction(null, form)).rejects.toThrow(
        "REDIRECT:/privacy-consent?callbackUrl=%2Fonboarding",
      );
      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
