import { prisma } from "@/lib/db/prisma";
import type { NotificationType as PrismaNotificationType } from "@/generated/prisma/client";

// This module only ever reads/updates Notification rows -- it never
// creates one and never imports @/lib/match/service (or any other domain
// service) to do so. Creation stays exactly where Phase 7 put it (inside
// createMatch()'s own transaction); see this file's module comment intent
// in the Phase 9 report for why that boundary matters (no domain needs to
// import another just to fire a notification).

// Prisma's generated enum values are the ASCII identifiers (MATCH,
// MESSAGE, ...) -- @map only renames the DB column value, not what the
// client returns (same situation as LostPostStatus/FoundPostStatus in
// posts/service.ts). Every notification is exposed using the legacy's
// actual lowercase string values instead, since that's what the type
// genuinely means and what a future UI label lookup keys off of.
const NOTIFICATION_TYPE_FROM_DB: Record<PrismaNotificationType, string> = {
  MESSAGE: "message",
  MATCH: "match",
  REPORT_PROCESSED: "report_processed",
  POST_DELETED: "post_deleted",
  MESSAGE_HIDDEN: "message_hidden",
  USER_SUSPENDED: "user_suspended",
};

// Same Korean labels as the legacy pages/8_알림.py's TYPE_LABELS.
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  message: "새 메시지",
  match: "새 매칭",
  report_processed: "신고 처리 결과",
  post_deleted: "게시물 삭제 제재",
  message_hidden: "메시지 숨김 제재",
  user_suspended: "계정 정지",
};

export type NotificationDTO = {
  id: number;
  type: string;
  title: string;
  content: string;
  relatedType: string | null;
  relatedId: number | null;
  isRead: boolean;
  createdAt: Date;
};

type NotificationRow = {
  id: number;
  type: PrismaNotificationType;
  title: string;
  content: string;
  relatedType: string | null;
  relatedId: number | null;
  isRead: boolean;
  createdAt: Date;
};

function toNotificationDTO(row: NotificationRow): NotificationDTO {
  return { ...row, type: NOTIFICATION_TYPE_FROM_DB[row.type] };
}

export type PagedNotifications = {
  items: NotificationDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Always scoped to userId in the query itself (never filtered client-side
// or in application code after a broader fetch) -- ordered createdAt
// desc, id desc, matching the legacy list_notifications_by_user() and the
// index already declared on Notification in schema.prisma.
export async function listNotifications(
  userId: number,
  { page, limit }: { page: number; limit: number },
): Promise<PagedNotifications> {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
  ]);
  return {
    items: rows.map(toNotificationDTO),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// A single COUNT query scoped to userId's own unread notifications --
// never a full row fetch, matching the legacy count_unread_notifications().
export async function getUnreadNotificationCount(userId: number): Promise<number> {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

export type NotificationMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" };

// Mirrors legacy mark_notification_as_read(): ownership is checked
// explicitly first (for a clean, specific not_found/forbidden result),
// then re-enforced in the UPDATE's own WHERE clause -- the same
// belt-and-suspenders pattern every ownership check in this project uses,
// so a bypassed/direct call still can't touch another user's
// notification. Re-marking an already-read notification is a no-op
// success, not an error (idempotent, same as legacy).
export async function markNotificationAsRead(
  id: number,
  userId: number,
): Promise<NotificationMutationResult<NotificationDTO>> {
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };
  if (existing.isRead) return { kind: "ok", data: toNotificationDTO(existing) };

  await prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
  return { kind: "ok", data: toNotificationDTO({ ...existing, isRead: true }) };
}

// DB-level bulk update (updateMany), never a fetch-all-then-update-each-
// row loop -- scoped entirely by the WHERE clause, so no other user's
// notifications are ever touched. Returns the number of rows updated,
// same as legacy mark_all_notifications_as_read().
export async function markAllNotificationsAsRead(userId: number): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return count;
}
