import { describe, expect, it } from "vitest";

import {
  CURRENT_IDENTITY_CONSENT_VERSION,
  CURRENT_PRIVACY_VERSION,
  formatEffectiveDate,
  PRIVACY_POLICY_EFFECTIVE_DATE,
} from "./terms";

// The 시행일 is the one switch for the release: the policy shows it and both
// consent versions follow it, so they can never drift apart.
describe("privacy policy 시행일", () => {
  it("is a real calendar day", () => {
    expect(PRIVACY_POLICY_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${PRIVACY_POLICY_EFFECTIVE_DATE}T00:00:00Z`).toISOString().slice(0, 10)).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
  });

  it("is what the privacy and 이름·소속 consent versions are", () => {
    expect(CURRENT_PRIVACY_VERSION).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
    expect(CURRENT_IDENTITY_CONSENT_VERSION).toBe(PRIVACY_POLICY_EFFECTIVE_DATE);
  });

  it("is shown as a Korean date", () => {
    expect(formatEffectiveDate("2026-10-16")).toBe("2026년 10월 16일");
    expect(formatEffectiveDate("2026-11-02")).toBe("2026년 11월 2일");
  });
});
