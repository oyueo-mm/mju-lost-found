import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/auth";
import { withdrawUser } from "@/lib/auth/user";
import { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";

// Phase 10: deliberately does NOT go through requireUserForApi() (same
// reasoning as POST /api/me/privacy-consent) -- withdrawal only needs an
// authenticated session, not a "ready" (consented + nicknamed) one, and
// getCurrentUser() itself is the real authorization here: the id it
// resolves comes from the server-verified session, never from any
// client-supplied field, so this route has no way to withdraw any account
// other than the caller's own.
export const POST = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "로그인이 필요합니다.");

  const result = await withdrawUser(user.id);
  // Phase 12-2: a user who is the sole LEADER of a still-ACTIVE
  // organization can't withdraw until they appoint a successor -- see
  // withdrawUser()'s own comment. This never touches the session/DB row
  // (no signOut below either), so the account stays exactly as it was.
  if (result.kind === "sole_leader_block") {
    return jsonError(
      409,
      `다음 단체의 유일한 대표 관리자이므로 탈퇴할 수 없습니다. 먼저 다른 구성원에게 대표 관리자 권한을 위임해주세요: ${result.organizationNames.join(", ")}`,
    );
  }

  // Clears the session cookie right away instead of leaving a still-
  // "valid" JWT pointing at a now-deletedAt row for getCurrentUser() to
  // reject on the *next* request -- both are safe (see session.ts's own
  // comment), but this gives the browser an immediately logged-out state
  // rather than a stale cookie that merely stops working.
  await signOut({ redirect: false });

  return jsonOk({ withdrawn: true });
});
