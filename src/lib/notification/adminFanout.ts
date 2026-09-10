import type { NotificationType, Prisma } from "@/generated/prisma/client";

// Phase 12-9 §2: the one shared helper report/service.ts, feedback/
// service.ts, and moderation/appeals.ts each call, inside their own
// creation transaction, to notify every current Platform Admin the moment
// a new Report/Feedback/SuspensionAppeal is filed. Deliberately NOT added
// to notification/service.ts itself -- that module's own top comment says
// "never imports another domain's service to do so; creation stays inside
// the transaction of whichever domain caused it", and report/service.ts
// is itself imported BY moderation/service.ts, so routing this through
// either of those would risk a circular import. This file has zero
// dependencies on any other domain, so it's safe for all three (and any
// future "notify admins of X") to import without that risk.
//
// Reuses the exact fan-out shape announcement/service.ts's own
// createAnnouncement() already established (tx.notification.createMany +
// skipDuplicates: true) -- Notification's own
// @@unique([userId, type, relatedType, relatedId]) is what actually
// guarantees "중복 알림 방지", skipDuplicates is just defensive.
export async function fanOutToAdmins(
  tx: Prisma.TransactionClient,
  input: { type: NotificationType; title: string; content: string; relatedType: string; relatedId: number },
): Promise<void> {
  const admins = await tx.user.findMany({ where: { isAdmin: true }, select: { id: true } });
  if (admins.length === 0) return;

  await tx.notification.createMany({
    data: admins.map(({ id: userId }) => ({ userId, ...input })),
    skipDuplicates: true,
  });
}
