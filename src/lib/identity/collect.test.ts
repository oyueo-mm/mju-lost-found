import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const unstable_update = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth, unstable_update }));
const recordIdentityConsent = vi.fn();
const syncIdentityFromHints = vi.fn();
vi.mock("./service", () => ({ recordIdentityConsent, syncIdentityFromHints }));

const { consentAndCollectIdentity } = await import("./collect");
const { CURRENT_IDENTITY_CONSENT_VERSION } = await import("@/lib/auth/terms");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consentAndCollectIdentity", () => {
  const hints = { name: "홍길동", department: "컴퓨터공학과", nameSource: "google_display_name", departmentSource: "google_display_name" };

  it("records the consent first, then collects from this session's hints, then drops them", async () => {
    auth.mockResolvedValueOnce({ identityHints: hints });
    syncIdentityFromHints.mockResolvedValueOnce("created");

    expect(await consentAndCollectIdentity(5)).toBe("created");
    expect(recordIdentityConsent).toHaveBeenCalledWith(5);
    expect(syncIdentityFromHints).toHaveBeenCalledWith({ id: 5, identityConsentVersion: CURRENT_IDENTITY_CONSENT_VERSION }, hints);
    expect(recordIdentityConsent.mock.invocationCallOrder[0]).toBeLessThan(syncIdentityFromHints.mock.invocationCallOrder[0]);
    expect(unstable_update).toHaveBeenCalledWith({ clearIdentityHints: true });
  });

  it("keeps the consent but stores nothing (and keeps the hints) when nothing usable came from Google", async () => {
    auth.mockResolvedValueOnce({ identityHints: { name: "홍길동", department: null, nameSource: "google_profile" } });
    syncIdentityFromHints.mockResolvedValueOnce("skipped");

    expect(await consentAndCollectIdentity(5)).toBe("skipped");
    expect(recordIdentityConsent).toHaveBeenCalledWith(5);
    expect(unstable_update).not.toHaveBeenCalled();
  });
});
