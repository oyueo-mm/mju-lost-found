import { prisma } from "@/lib/db/prisma";
import { isAllowedEmail } from "@/lib/auth/domain";
import { isGoogleTestModeEnabled } from "@/lib/settings/service";
import { ExternalAccessStatus, UserType } from "@/generated/prisma/client";

// Who may use the service, decided only on the server:
//   1. an @mju.ac.kr Google account                      -> STUDENT
//   2. an email an admin approved (ExternalAccessGrant ACTIVE)
//                                                         -> EXTERNAL_VERIFIED
//   3. an email whose approval was revoked               -> refused, always
//      (even while the Google test mode setting is on)
//   4. any other account                                 -> only while the
//      admin "Google 테스트 모드" setting is on            -> EXTERNAL_TEST
// The test-mode setting itself is unchanged by this; it is just checked
// last.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function grantFor(email: string) {
  return prisma.externalAccessGrant.findUnique({
    where: { email: normalizeEmail(email) },
    select: { status: true },
  });
}

export type SignInDecision =
  | { allowed: true; userType: UserType }
  | { allowed: false; reason: "unverified_email" | "revoked" | "not_allowed" };

export async function decideSignIn(email: string | null | undefined, emailVerified: boolean | undefined): Promise<SignInDecision> {
  if (!email || emailVerified === false) return { allowed: false, reason: "unverified_email" };
  if (isAllowedEmail(email)) return { allowed: true, userType: UserType.STUDENT };

  const grant = await grantFor(email);
  if (grant?.status === ExternalAccessStatus.ACTIVE) return { allowed: true, userType: UserType.EXTERNAL_VERIFIED };
  if (grant?.status === ExternalAccessStatus.REVOKED) return { allowed: false, reason: "revoked" };

  let testModeEnabled = false;
  try {
    testModeEnabled = await isGoogleTestModeEnabled();
  } catch (error) {
    console.error("Failed to read googleTestModeEnabled -- failing closed:", error);
  }
  return testModeEnabled ? { allowed: true, userType: UserType.EXTERNAL_TEST } : { allowed: false, reason: "not_allowed" };
}

// The userType to store for an account that was just let in (sign-in
// already passed decideSignIn). Recomputed on every sign-in, so it always
// follows the current approval state.
export async function userTypeForEmail(email: string): Promise<UserType> {
  if (isAllowedEmail(email)) return UserType.STUDENT;
  const grant = await grantFor(email);
  return grant?.status === ExternalAccessStatus.ACTIVE ? UserType.EXTERNAL_VERIFIED : UserType.EXTERNAL_TEST;
}

// Re-checked on every request for a non-university account
// (session.ts::getCurrentUser), so revoking an approval takes effect
// immediately, not when the session cookie expires:
//   - an approval that was revoked blocks the account;
//   - an EXTERNAL_VERIFIED account needs its approval to still be ACTIVE.
// STUDENT accounts never reach this (no extra query for them).
export async function hasOngoingExternalAccess(user: { email: string; userType: UserType }): Promise<boolean> {
  const grant = await grantFor(user.email);
  if (grant?.status === ExternalAccessStatus.REVOKED) return false;
  if (user.userType === UserType.EXTERNAL_VERIFIED) return grant?.status === ExternalAccessStatus.ACTIVE;
  return true;
}
