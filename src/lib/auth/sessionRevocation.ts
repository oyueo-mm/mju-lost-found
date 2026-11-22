import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Security audit P-5 (2026-11-22): server-side revocation for the stateless
// Auth.js JWT sessions. Two checks, both made by getCurrentUser() on every
// request that resolves a member, so every page, API route and Server Action
// that already trusts getCurrentUser() honours them:
//
//  1. This device's sign-out. Every session cookie carries a random
//     realtimeSessionId from its sign-in on; Auth.js's signOut event already
//     records it as revoked in ChatRealtimeSession. A copy of that cookie
//     (stolen before sign-out) is refused from then on.
//  2. "모든 기기에서 로그아웃" / an administrator's forced sign-out. Sets
//     User.sessionsValidAfter; a cookie whose sign-in (authTime) is older is
//     refused. Cookies issued before this release carry no authTime and count
//     as signed in at 0, so a cut-off also ends them.
//
// Neither check deletes the cookie itself: the browser still holds it, but
// the server treats it exactly like "not signed in".

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SessionClaims = { authTime?: number | null; realtimeSessionId?: string | null };

/** True when the user's cut-off is later than this session's sign-in. */
export function signedInBeforeCutoff(user: { sessionsValidAfter?: Date | null }, claims: SessionClaims | null | undefined): boolean {
  if (!user.sessionsValidAfter) return false;
  const authTime = Number.isFinite(claims?.authTime) ? Number(claims!.authTime) : 0;
  return authTime * 1000 < user.sessionsValidAfter.getTime();
}

/** True when this session ID was signed out (or revoked with all others). */
export async function isSessionIdRevoked(userId: number, sessionId: string | null | undefined): Promise<boolean> {
  if (!sessionId || !UUID.test(sessionId)) return false;
  const row = await prisma.chatRealtimeSession.findFirst({
    where: { id: sessionId, userId, revokedAt: { not: null } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Ends every session of the user: the cut-off for cookies, plus the Realtime
 * sessions and grants (so chat delivery stops at once, not only at the next
 * token refresh) and every saved chat-push device. Whole seconds, so a
 * sign-in in a later second always passes.
 */
export async function revokeAllSessions(userId: number, tx?: Prisma.TransactionClient): Promise<Date> {
  const cutoff = new Date(Math.ceil(Date.now() / 1000) * 1000);
  const run = async (db: Prisma.TransactionClient) => {
    await db.user.update({ where: { id: userId }, data: { sessionsValidAfter: cutoff } });
    await db.$executeRaw`UPDATE "ChatRealtimeSession" SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE user_id=${userId} AND revoked_at IS NULL`;
    await db.$executeRaw`UPDATE "ChatRealtimeGrant" SET revoked_at=(now() AT TIME ZONE 'UTC') WHERE user_id=${userId} AND revoked_at IS NULL`;
    await db.pushSubscription.deleteMany({ where: { userId } });
  };
  if (tx) await run(tx);
  else await prisma.$transaction(run);
  return cutoff;
}
