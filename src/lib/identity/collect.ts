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
// `identityConsentVersion`: the member's 이름·소속 consent as now on file
// (an earlier accepted one is kept, auth/user.ts recordRequiredConsents).
export async function collectIdentityAfterConsent(
  userId: number,
  identityConsentVersion: string | null = CURRENT_IDENTITY_CONSENT_VERSION,
): Promise<IdentitySyncResult> {
  const session = await auth();
  const hints = session?.identityHints;
  const result = await syncIdentityFromHints({ id: userId, identityConsentVersion }, hints);
  // Value-free: whether this session had hints, and whether they were a
  // display-name split the collection could use.
  console.info(
    "Identity collection after consent:",
    JSON.stringify({
      user: userId,
      hints: hints === undefined ? "none" : hints.nameSource === "google_display_name" && hints.departmentSource === "google_display_name" ? "display_name" : "unusable",
      result,
    }),
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
