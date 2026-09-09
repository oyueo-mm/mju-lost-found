import { describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const recordPrivacyConsent = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/user", () => ({ recordPrivacyConsent }));
// Same reason as src/app/api/upload/route.test.ts: avoid pulling in the
// real @/lib/posts/http.ts's next-auth import chain.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});

const { POST } = await import("./route");

describe("POST /api/me/privacy-consent", () => {
  it("rejects an unauthenticated request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toMatch(/로그인/);
    expect(recordPrivacyConsent).not.toHaveBeenCalled();
  });

  it("records consent for the current user and returns the new timestamp", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 7 });
    const consentedAt = new Date("2026-09-25T00:00:00Z");
    recordPrivacyConsent.mockResolvedValueOnce({ id: 7, privacyConsentAt: consentedAt });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(recordPrivacyConsent).toHaveBeenCalledWith(7);
    expect(json.data.privacyConsentAt).toBe(consentedAt.toISOString());
  });

  // Does not require a nickname -- consent can be recorded before
  // onboarding (see session.ts's requireReadyUser ordering). This route
  // never calls requireUserForApi() (see route.ts's own comment), so
  // there's nothing to assert here beyond "a plain logged-in user is
  // enough" -- already covered by the test above using a user with no
  // nickname field at all.
  it("does not require a nickname to already be set", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 8, nickname: null });
    recordPrivacyConsent.mockResolvedValueOnce({ id: 8, privacyConsentAt: new Date() });

    const res = await POST();

    expect(res.status).toBe(200);
  });
});
