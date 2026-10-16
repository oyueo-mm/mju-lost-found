import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatEffectiveDate } from "@/lib/auth/terms";
import PrivacyPolicyHistoryPage from "@/app/(policy)/policy/privacy/history/page";
import { LATEST_PRIVACY_POLICY_REVISION, PRIVACY_POLICY_EFFECTIVE_DATE, PRIVACY_POLICY_REVISIONS } from "./privacyPolicy";

describe("개인정보처리방침 개정 이력", () => {
  it("is newest first, and its newest entry is the 시행일", () => {
    const dates = PRIVACY_POLICY_REVISIONS.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(PRIVACY_POLICY_EFFECTIVE_DATE).toBe(dates[0]);
    expect(LATEST_PRIVACY_POLICY_REVISION).toBe(PRIVACY_POLICY_REVISIONS[0]);
    for (const r of PRIVACY_POLICY_REVISIONS) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.summary.length).toBeGreaterThan(10);
      expect(["notice", "reconsent"]).toContain(r.consent);
    }
  });

  it("shows every registry entry in the dedicated history page", () => {
    const html = renderToStaticMarkup(PrivacyPolicyHistoryPage());
    const entries = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " "));
    expect(entries).toHaveLength(PRIVACY_POLICY_REVISIONS.length);
    PRIVACY_POLICY_REVISIONS.forEach((r, i) => {
      expect(entries[i]).toContain(formatEffectiveDate(r.date));
      expect(entries[i]).toContain(r.summary);
      expect(entries[i]).toContain(r.consent === "notice" ? "변경 안내로 시행" : "기존 회원 재동의");
    });
  });
});
