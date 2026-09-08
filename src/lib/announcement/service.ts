import { prisma } from "@/lib/db/prisma";
import { NotificationType, type User } from "@/generated/prisma/client";
import { isAdmin } from "@/lib/moderation/service";
import type { CreateAnnouncementInput, UpdateAnnouncementInput } from "./schema";

// Phase M: admin-authored announcements, delivered to every user through
// the existing Notification system (one row per user, fanned out inside
// the same transaction as the announcement insert -- see
// createAnnouncement() below) rather than inventing a separate "global
// feed" concept. See schema.prisma's own comment on the Announcement model
// for the full reasoning (why createdByUserId is nullable, why editing
// doesn't rewrite already-sent notifications, why deleting doesn't chase
// them down either).

export type AnnouncementDTO = {
  id: number;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  createdByNickname: string | null;
};

type AnnouncementRow = {
  id: number;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { nickname: string | null } | null;
};

function toAnnouncementDTO(row: AnnouncementRow): AnnouncementDTO {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByNickname: row.createdBy?.nickname ?? null,
  };
}

const WITH_AUTHOR = { createdBy: { select: { nickname: true } } } as const;

export type AnnouncementMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export type PagedAnnouncements = {
  items: AnnouncementDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Admin-only, same belt-and-suspenders isAdmin() re-check every other
// admin service function in this app makes regardless of the page-level
// gate the caller already passed through.
export async function listAnnouncementsForAdmin(
  admin: User,
  { page, limit }: { page: number; limit: number },
): Promise<AnnouncementMutationResult<PagedAnnouncements>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: WITH_AUTHOR,
    }),
    prisma.announcement.count(),
  ]);

  return {
    kind: "ok",
    data: {
      items: rows.map(toAnnouncementDTO),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// Public read -- this is what the notification's resolved href points at
// (see resolveHref.ts's "announcement" branch) and what the admin edit
// form pre-fills from. No admin check: any user (including logged-out) who
// clicks through from a notification link, or is handed the URL directly,
// can read an announcement's current content -- the same "public by
// design" posture /post/[id] and /profile/[publicId] already have.
export async function getAnnouncement(id: number): Promise<AnnouncementDTO | null> {
  if (!Number.isInteger(id)) return null;
  const row = await prisma.announcement.findUnique({ where: { id }, include: WITH_AUTHOR });
  return row ? toAnnouncementDTO(row) : null;
}

// Creates the Announcement and fans it out to every current user as a
// Notification, atomically (one transaction -- either both happen or
// neither does, so an announcement can never exist with zero
// notifications sent, or vice versa). skipDuplicates on the createMany is
// defensive only: the composite unique index on Notification
// (userId, type, relatedType, relatedId) already makes a second identical
// fan-out for the same announcement a no-op if this were ever retried,
// same protection createMatch()'s own notification insert relied on
// before the Match domain was removed.
export async function createAnnouncement(
  admin: User,
  input: CreateAnnouncementInput,
): Promise<AnnouncementMutationResult<AnnouncementDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const created = await prisma.$transaction(async (tx) => {
    const announcement = await tx.announcement.create({
      data: { title: input.title, content: input.content, createdByUserId: admin.id },
      include: WITH_AUTHOR,
    });

    const userIds = await tx.user.findMany({ select: { id: true } });
    if (userIds.length > 0) {
      await tx.notification.createMany({
        data: userIds.map(({ id: userId }) => ({
          userId,
          type: NotificationType.ANNOUNCEMENT,
          title: announcement.title,
          content: announcement.content,
          relatedType: "announcement",
          relatedId: announcement.id,
        })),
        skipDuplicates: true,
      });
    }

    return announcement;
  });

  return { kind: "ok", data: toAnnouncementDTO(created) };
}

// Editing only ever touches the Announcement row itself -- already-sent
// Notification rows keep their original title/content snapshot (see this
// module's own top comment for why), and no new notifications are sent on
// an edit.
export async function updateAnnouncement(
  admin: User,
  id: number,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementMutationResult<AnnouncementDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };

  const updated = await prisma.announcement.update({
    where: { id },
    data: { title: input.title, content: input.content },
    include: WITH_AUTHOR,
  });
  return { kind: "ok", data: toAnnouncementDTO(updated) };
}

// Deleting the Announcement row does NOT chase down and delete the
// Notification rows it fanned out -- same "leave it, resolveHref just
// stops resolving a link" graceful-degradation precedent this app already
// established when the Match domain was removed (see resolveHref.ts's own
// comment on relatedType "match"). Those notifications still show their
// original title/content; only the click-through link stops working.
export async function deleteAnnouncement(
  admin: User,
  id: number,
): Promise<AnnouncementMutationResult<{ id: number }>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };

  await prisma.announcement.delete({ where: { id } });
  return { kind: "ok", data: { id } };
}
