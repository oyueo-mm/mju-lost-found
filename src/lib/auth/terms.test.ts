import { describe, expect, it } from "vitest";

import {
  CURRENT_IDENTITY_CONSENT_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  formatEffectiveDate,
  isAcceptedIdentityConsentVersion,
  isAcceptedPrivacyVersion,
  PRIVACY_POLICY_EFFECTIVE_DATE,
} from "./terms";

// The 시행일 is the policy document's own date (set to the real Production
// day); the consent versions change only when the consent itself does.
describe("privacy policy 시행일", () => {
  it("is a real calendar day", () => {
    expect(PRIVACY_POLICY_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${PRIVACY_POLICY_EFFECTIVE_DATE}T00:00:00Z`).toISOString().slice(0, 10)).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
  });

  // An announced policy change moves only the 시행일: the consent versions
  // stay the Production ones, so no member is asked to consent again.
  it("is kept apart from the consent versions, which stay at the Production one", () => {
    expect(CURRENT_PRIVACY_VERSION).toBe("2026-10-14");
    expect(CURRENT_IDENTITY_CONSENT_VERSION).toBe("2026-10-14");
    expect(CURRENT_TERMS_VERSION).toBe("2026-10-04");
  });

  it("accepts the current consents and the Preview-only 2026-10-16 ones, nothing older", () => {
    for (const ok of ["2026-10-14", "2026-10-16"]) {
      expect(isAcceptedPrivacyVersion(ok)).toBe(true);
      expect(isAcceptedIdentityConsentVersion(ok)).toBe(true);
    }
    for (const no of [null, "2026-10-05", "2026-10-04", "2026-10-22"]) {
      expect(isAcceptedPrivacyVersion(no)).toBe(false);
      expect(isAcceptedIdentityConsentVersion(no)).toBe(false);
    }
  });

  it("is shown as a Korean date", () => {
    expect(formatEffectiveDate("2026-10-16")).toBe("2026년 10월 16일");
    expect(formatEffectiveDate("2026-11-02")).toBe("2026년 11월 2일");
  });
});
