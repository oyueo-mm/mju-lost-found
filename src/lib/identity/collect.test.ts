import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const unstable_update = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth, unstable_update }));
const syncIdentityFromHints = vi.fn();
vi.mock("./service", () => ({ syncIdentityFromHints }));

const { collectIdentityAfterConsent } = await import("./collect");
const { CURRENT_IDENTITY_CONSENT_VERSION } = await import("@/lib/auth/terms");

beforeEach(() => {
  vi.clearAllMocks();
});

// Called right after the required 개인정보 동의 (이름·소속 included) is
// recorded -- it only collects, it never records a consent itself.
describe("collectIdentityAfterConsent", () => {
  const hints = { name: "홍길동", department: "컴퓨터공학과", nameSource: "google_display_name", departmentSource: "google_display_name" };

  it("collects from this session's hints with the current consent, then drops them", async () => {
    auth.mockResolvedValueOnce({ identityHints: hints });
    syncIdentityFromHints.mockResolvedValueOnce("created");

    expect(await collectIdentityAfterConsent(5)).toBe("created");
    expect(syncIdentityFromHints).toHaveBeenCalledWith({ id: 5, identityConsentVersion: CURRENT_IDENTITY_CONSENT_VERSION }, hints);
    expect(unstable_update).toHaveBeenCalledWith({ clearIdentityHints: true });
  });

  it("stores nothing (and keeps the hints) when nothing usable came from Google", async () => {
    auth.mockResolvedValueOnce({ identityHints: { name: "홍길동", department: null, nameSource: "google_profile" } });
    syncIdentityFromHints.mockResolvedValueOnce("skipped");

    expect(await collectIdentityAfterConsent(5)).toBe("skipped");
    expect(unstable_update).not.toHaveBeenCalled();
  });
});
