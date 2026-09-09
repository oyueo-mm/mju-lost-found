import { getCurrentUser } from "@/lib/auth/session";
import { recordPrivacyConsent } from "@/lib/auth/user";
import { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";

// Phase 8: deliberately does NOT go through requireUserForApi() (see that
// function's own comment) -- this is the one endpoint that's allowed to
// run for a user who hasn't consented yet, since it's the only thing that
// can ever change that. Login is still required (getCurrentUser()), and
// nickname is not: consent can be given before onboarding, matching this
// phase's own "consent before nickname" ordering (session.ts's
// requireReadyUser).
export const POST = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "로그인이 필요합니다.");

  // recordPrivacyConsent() ignores the client entirely beyond the
  // authenticated user's own id -- no body is read, no client-supplied
  // timestamp is ever trusted (see that function's own comment for why).
  const updated = await recordPrivacyConsent(user.id);
  return jsonOk({ privacyConsentAt: updated.privacyConsentAt });
});
