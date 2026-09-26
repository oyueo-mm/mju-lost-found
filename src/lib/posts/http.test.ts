import { describe, expect, it, vi } from "vitest";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";

const getCurrentUser = vi.fn();

// hasRequiredConsents() is pure logic (see session.ts's own comment) --
// reimplemented here rather than mocked as a vi.fn(), so these tests
// exercise the real predicate against whatever consent fields each
// mocked getCurrentUser() result carries.
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

vi.mock("@/lib/auth/session", () => ({ getCurrentUser, hasRequiredConsents }));

const { requireUserForApi } = await import("./http");

async function statusOf(result: Awaited<ReturnType<typeof requireUserForApi>>): Promise<number | null> {
  if (!("response" in result)) return null;
  return result.response.status;
}

async function errorOf(result: Awaited<ReturnType<typeof requireUserForApi>>): Promise<string | undefined> {
  if (!("response" in result)) return undefined;
  const json = await result.response.json();
  return json.error;
}

const readyConsent = { privacyConsentAt: new Date(), termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION };

describe("requireUserForApi", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(401);
  });

  // Phase 8: checked before the nickname check -- an existing user (with
  // a nickname already set) who hasn't agreed to the privacy notice yet
  // must still be rejected, not let through on account of their nickname.
  it("rejects a logged-in user who hasn't agreed to the privacy notice yet, even with a nickname set", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 1, nickname: "닉네임", privacyConsentAt: null });

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(403);
    expect(await errorOf(result)).toMatch(/동의/);
  });

  // 이용약관 동의 Phase: same 403 boundary, now also covering the terms
  // consent -- missing entirely, or on file for a superseded version.
  it("rejects a privacy-consented user who never agreed to the terms", async () => {
    getCurrentUser.mockResolvedValueOnce({
      id: 1,
      nickname: "닉네임",
      privacyConsentAt: new Date(),
      termsAcceptedAt: null,
      termsVersion: null,
    });

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(403);
    expect(await errorOf(result)).toMatch(/동의/);
  });

  it("rejects a user whose stored terms version is stale", async () => {
    getCurrentUser.mockResolvedValueOnce({
      id: 1,
      nickname: "닉네임",
      privacyConsentAt: new Date(),
      termsAcceptedAt: new Date(),
      termsVersion: "2025-01-01",
    });

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(403);
    expect(await errorOf(result)).toMatch(/동의/);
  });

  it("rejects a consented user who hasn't set a nickname yet", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 1, nickname: null, ...readyConsent });

    const result = await requireUserForApi();

    expect(await statusOf(result)).toBe(403);
    expect(await errorOf(result)).toMatch(/닉네임/);
  });

  it("returns the user when consented and ready", async () => {
    const user = { id: 1, nickname: "닉네임", ...readyConsent };
    getCurrentUser.mockResolvedValueOnce(user);

    const result = await requireUserForApi();

    expect(result).toEqual({ user });
  });
});
