import { auth, unstable_update } from "@/lib/auth/auth";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { recordIdentityConsent, syncIdentityFromHints, type IdentitySyncResult } from "./service";

// 실명·소속 자동 수집 at the moment of consent (가입 동의 screen or
// /me/identity): records the member's optional consent, then stores the
// name and affiliation from this session's Google display name hints -- no
// form, no typing. When there is nothing usable (not a school Workspace
// account, a name without the "이름/신분/소속" form, or a session from before
// the hints existed) nothing is stored ("skipped") and the caller decides
// what to show. Once stored, the hints are dropped from the session cookie.
export async function consentAndCollectIdentity(userId: number): Promise<IdentitySyncResult> {
  await recordIdentityConsent(userId);
  const session = await auth();
  const result = await syncIdentityFromHints(
    { id: userId, identityConsentVersion: CURRENT_IDENTITY_CONSENT_VERSION },
    session?.identityHints,
  );
  if (result !== "skipped") {
    try {
      await unstable_update({ clearIdentityHints: true } as Parameters<typeof unstable_update>[0]);
    } catch {
      // Only tidying -- the values are stored either way.
    }
  }
  return result;
}
