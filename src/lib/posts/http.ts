import type { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import type { User } from "@/generated/prisma/client";
import { jsonError } from "./response";

export { jsonError, jsonOk, postMutationResultToResponse, withErrorHandling } from "./response";

// Route Handler equivalent of requireUser()/requireReadyUser() (see
// src/lib/auth/session.ts) -- those redirect, which only makes sense in a
// Server Component/Server Action; an API route returns a 401/403 JSON
// response instead. Returns the ready User, or a Response the caller
// should return immediately.
export async function requireUserForApi(): Promise<
  { user: User } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError(401, "로그인이 필요합니다.") };
  // Phase 8: same ordering as session.ts's requireReadyUser (consent
  // before nickname) -- every route this gates (posts/comments/chat/
  // chat-upload/reports/notifications) is exactly the "개인정보를 생성/
  // 처리하는" boundary this phase's spec asks to enforce server-side, not
  // just in the UI. POST /api/me/privacy-consent itself deliberately does
  // NOT go through this function (see that route) -- it can't require
  // consent to already exist in order to grant it.
  if (user.privacyConsentAt === null) {
    return { response: jsonError(403, "개인정보 수집·이용 동의가 필요합니다.") };
  }
  if (user.nickname === null) {
    return { response: jsonError(403, "닉네임을 먼저 설정해주세요.") };
  }
  return { user };
}
