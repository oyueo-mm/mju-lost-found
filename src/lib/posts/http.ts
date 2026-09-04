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
  if (user.nickname === null) {
    return { response: jsonError(403, "닉네임을 먼저 설정해주세요.") };
  }
  return { user };
}
