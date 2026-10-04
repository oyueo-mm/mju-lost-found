import { createHmac } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { releaseResolvedWithdrawnIdentities } from "@/lib/auth/identityRelease";
import { RejoinRequestStatus, WithdrawnIdentityStatus, type Prisma } from "@/generated/prisma/client";

// 회원탈퇴: a withdrawn account keeps no e-mail or Google ID. When the
// withdrawal happened with a sanction matter still open (see
// auth/holdState.ts), only an HMAC of the Google account
// id is kept, so the same person signing in again is sent to a rejoin
// request instead of silently getting a fresh, unsanctioned account.
//
// HMAC-SHA256 under WITHDRAWN_IDENTITY_SECRET -- a server-only secret that
// is never stored in the DB and is separate from AUTH_SECRET -- so the
// stored value can't be reversed or recomputed from a DB copy alone (a
// plain/salted hash of a Google id could be brute-forced). keyVersion lets
// the secret be rotated later without losing older rows.
export const CURRENT_IDENTITY_KEY_VERSION = 1;

export class MissingIdentitySecretError extends Error {
  constructor() {
    super("WITHDRAWN_IDENTITY_SECRET is not configured");
  }
}

function identitySecret(): string {
  const secret = process.env.WITHDRAWN_IDENTITY_SECRET;
  if (!secret || secret.length < 32) throw new MissingIdentitySecretError();
  return secret;
}

// The account is keyed by its Google id ("sub"), which never changes for a
// Google account; the e-mail is only a fallback for an old row that never
// recorded a Google id.
export function identitySubject(account: { googleId: string | null; email: string }): string {
  return account.googleId ? `google:${account.googleId}` : `email:${account.email.trim().toLowerCase()}`;
}

export function identityHmac(subject: string): string {
  return createHmac("sha256", identitySecret()).update(subject).digest("hex");
}

export type HeldIdentity = {
  id: number;
  latestRequest: { id: number; status: RejoinRequestStatus; consumedAt: Date | null } | null;
};

// The active hold (if any) for a Google account signing in. Both the
// google-id and e-mail subjects are checked, matching identitySubject()'s
// fallback. With no holds at all nothing is computed, so a missing secret
// can't lock everyone out; with holds present a missing secret throws
// (fails closed) rather than letting a held account through.
export async function findHeldIdentity(account: { googleId: string; email: string }): Promise<HeldIdentity | null> {
  const anyHeld = await prisma.withdrawnIdentity.count({ where: { status: WithdrawnIdentityStatus.ACTIVE } });
  if (anyHeld === 0) return null;

  const hmacs = [identityHmac(identitySubject(account)), identityHmac(identitySubject({ googleId: null, email: account.email }))];
  const identity = await prisma.withdrawnIdentity.findFirst({
    where: {
      identityHmac: { in: hmacs },
      status: WithdrawnIdentityStatus.ACTIVE,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      id: true,
      rejoinRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, consumedAt: true } },
    },
  });
  if (!identity) return null;
  // The hold's purpose may have ended since the last check (e.g. a timed
  // suspension ran out) -- then it is deleted now and this is a normal
  // sign-up.
  if ((await releaseResolvedWithdrawnIdentities([identity.id])).length > 0) return null;
  return { id: identity.id, latestRequest: identity.rejoinRequests[0] ?? null };
}

// An approved request is used exactly once: the hold is deleted (nothing
// left to recognise; the request keeps its decision record with identityId
// NULL), and the caller then creates a brand-new User. The new User's id is
// not written anywhere here.
export async function consumeApprovedRejoin(tx: Prisma.TransactionClient, identityId: number, requestId: number): Promise<boolean> {
  const { count } = await tx.rejoinRequest.updateMany({
    where: { id: requestId, identityId, status: RejoinRequestStatus.APPROVED, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) return false;
  await tx.withdrawnIdentity.delete({ where: { id: identityId } });
  return true;
}
