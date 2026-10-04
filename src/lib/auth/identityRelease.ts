import { prisma } from "@/lib/db/prisma";
import { openHoldReasons } from "@/lib/auth/holdState";
import { RejoinRequestStatus } from "@/generated/prisma/client";

// 회원탈퇴 보유정책: a WithdrawnIdentity exists only for an open sanction
// matter, and is deleted as soon as none is left (suspension over, reports
// processed, proposal decided, appeal reviewed). Called right after each of
// those admin actions, at sign-in for the identity being matched, and daily
// by lib/retention (which also catches a timed suspension simply running
// out). A still-pending rejoin request is moot once the hold is gone and is
// deleted with it; a processed one keeps its decision record (identityId
// becomes NULL) until lib/retention removes it.
export async function releaseResolvedWithdrawnIdentities(onlyIds?: number[]): Promise<number[]> {
  const holds = await prisma.withdrawnIdentity.findMany({
    where: onlyIds ? { id: { in: onlyIds } } : {},
    select: { id: true, withdrawnUser: { select: { id: true, isSuspended: true, suspendedUntil: true } } },
  });
  const released: number[] = [];
  for (const hold of holds) {
    if ((await openHoldReasons(prisma, hold.withdrawnUser)).length > 0) continue;
    await prisma.$transaction([
      prisma.rejoinRequest.deleteMany({ where: { identityId: hold.id, status: RejoinRequestStatus.PENDING } }),
      prisma.withdrawnIdentity.deleteMany({ where: { id: hold.id } }),
    ]);
    released.push(hold.id);
  }
  return released;
}

// For the admin actions that can end a hold: never lets a failure here
// break the action itself (the daily run retries).
export async function releaseResolvedWithdrawnIdentitiesSafely(): Promise<void> {
  try {
    await releaseResolvedWithdrawnIdentities();
  } catch (error) {
    console.error("Failed to release resolved withdrawn identities", error);
  }
}
