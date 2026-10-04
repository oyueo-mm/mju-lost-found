import { describe, expect, it, vi } from "vitest";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/auth/terms";

const getCurrentUser = vi.fn();
const recordRequiredConsents = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/user", () => ({ recordRequiredConsents }));
// Same reason as src/app/api/me/withdraw/route.test.ts: avoid pulling in
// the real @/lib/posts/http.ts's next-auth import chain.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});

const { POST } = await import("./route");

describe("POST /api/me/consent", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/로그인/);
    expect(recordRequiredConsents).not.toHaveBeenCalled();
  });

  // Both consents are recorded through the one combined call -- never two
  // separate requests (see recordRequiredConsents's own comment on why:
  // a partial success there must never happen).
  it("records both consents for the current user and returns the new timestamps/version", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    const consentedAt = new Date("2026-09-25T00:00:00Z");
    recordRequiredConsents.mockResolvedValueOnce({
      id: 7,
      privacyConsentAt: consentedAt,
      termsAcceptedAt: consentedAt,
      termsVersion: CURRENT_TERMS_VERSION,
    });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(recordRequiredConsents).toHaveBeenCalledWith(7, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION);
    expect(json.data.privacyConsentAt).toBe(consentedAt.toISOString());
    expect(json.data.termsAcceptedAt).toBe(consentedAt.toISOString());
    expect(json.data.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  // Does not require a nickname -- consent can be recorded before
  // onboarding (see session.ts's requireReadyUser ordering). This route
  // never calls requireUserForApi() (see route.ts's own comment), so
  // there's nothing to assert here beyond "a plain logged-in user is
  // enough" -- already covered by the test above using a user with no
  // nickname field at all.
  it("does not require a nickname to already be set", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 8, nickname: null });
    recordRequiredConsents.mockResolvedValueOnce({
      id: 8,
      privacyConsentAt: new Date(),
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    });

    const res = await POST();

    expect(res.status).toBe(200);
  });
});
