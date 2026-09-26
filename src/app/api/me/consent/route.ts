import { getCurrentUser } from "@/lib/auth/session";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";
import { recordRequiredConsents } from "@/lib/auth/user";
import { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";

// 이용약관 동의 Phase: replaces the old POST /api/me/privacy-consent --
// one endpoint, one request, for the (auth)/privacy-consent screen's
// single "동의하고 계속하기" button, which now covers both privacy and
// terms consent from one click (see PrivacyConsentButton.tsx's own
// comment for why this must never be two sequential fetch() calls).
// Deliberately does NOT go through requireUserForApi() (same reasoning
// as the route this replaces) -- this is the one endpoint that's allowed
// to run for a user who hasn't consented to either document yet, since
// it's the only thing that can ever change that. Login is still required
// (getCurrentUser()), nickname is not.
export const POST = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "로그인이 필요합니다.");

  // recordRequiredConsents() ignores the client entirely beyond the
  // authenticated user's own id -- no body is read, no client-supplied
  // timestamp or version is ever trusted (see that function's own
  // comment for why). The current terms version is this server's own
  // constant, never something the client could influence.
  const updated = await recordRequiredConsents(user.id, CURRENT_TERMS_VERSION);
  return jsonOk({
    privacyConsentAt: updated.privacyConsentAt,
    termsAcceptedAt: updated.termsAcceptedAt,
    termsVersion: updated.termsVersion,
  });
});
