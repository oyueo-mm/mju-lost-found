import { auth, unstable_update } from "@/lib/auth/auth";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { syncIdentityFromHints, type IdentitySyncResult } from "./service";

// 이름·소속 자동 수집 right after the required 개인정보 동의 (which now
// covers 이름·소속 and is stamped by recordRequiredConsents): stores the
// name and affiliation from this session's Google display name hints -- no
// form, no extra step. When there is nothing usable (not a school Workspace
// account, a name without the "이름/신분/소속" form, or a session from
// before the hints existed) nothing is stored ("skipped"); posting/chatting
// then send the member to /me/identity. Once stored, the hints are dropped
// from the session cookie.
export async function collectIdentityAfterConsent(userId: number): Promise<IdentitySyncResult> {
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
