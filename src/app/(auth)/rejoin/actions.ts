"use server";

import { getRejoinIdentityId } from "@/lib/auth/session";
import { signIn, signOut } from "@/lib/auth/auth";
import { submitRejoinRequest } from "@/lib/auth/rejoin";

export type SubmitRejoinState = { error: string } | { ok: true };

// The held identity comes only from the server-signed session cookie set at
// sign-in (auth.ts jwt callback) -- never from anything the form sends.
export async function submitRejoinAction(reason: string): Promise<SubmitRejoinState> {
  const identityId = await getRejoinIdentityId();
  if (!identityId) return { error: "다시 로그인한 뒤 요청해주세요." };
  const result = await submitRejoinRequest(identityId, reason);
  if (result.kind === "invalid") return { error: result.error };
  if (result.kind === "not_allowed") return { error: "이미 요청을 보냈거나 요청할 수 없는 상태입니다." };
  return { ok: true };
}

// After approval: a fresh Google sign-in creates the new account
// (auth/user.ts::resolveSignIn).
export async function startNewAccountAction(): Promise<void> {
  await signIn("google", { redirectTo: "/" });
}

export async function leaveRejoinAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
