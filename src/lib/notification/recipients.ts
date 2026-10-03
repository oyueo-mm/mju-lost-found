import type { Prisma } from "@/generated/prisma/client";

// Who may receive a *new* notification: any user who isn't deactivated
// (User.deletedAt set by auth/user.ts::withdrawUser). A deactivated
// account can't sign in to read them, so nothing is queued for it; its
// existing notifications are left as they are. Every notification write
// in this app either goes through notifyUser() below (one recipient) or
// filters its recipient query with ACTIVE_RECIPIENT_WHERE (fan-outs:
// announcements, keyword alerts, admin/organization-manager fan-outs), so
// this rule lives in one place.
export const ACTIVE_RECIPIENT_WHERE = { deletedAt: null } as const satisfies Prisma.UserWhereInput;

type NotifyTx = { user: Pick<Prisma.TransactionClient["user"], "count">; notification: Pick<Prisma.TransactionClient["notification"], "create"> };

// Same argument shape as tx.notification.create(), so call sites only swap
// the function. Returns whether a notification was actually created.
export async function notifyUser(tx: NotifyTx, args: { data: Prisma.NotificationUncheckedCreateInput }): Promise<boolean> {
  const active = await tx.user.count({ where: { id: args.data.userId, ...ACTIVE_RECIPIENT_WHERE } });
  if (active === 0) return false;
  await tx.notification.create(args);
  return true;
}
