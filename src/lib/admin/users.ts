import { prisma } from "@/lib/db/prisma";
import { NotificationType, type User } from "@/generated/prisma/client";
import { isAdmin } from "@/lib/moderation/service";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import type { AdminUserAction } from "./schema";

// Phase 28-1: reuses the exact same User.isAdmin/isSuspended columns and
// isAdmin()/requireAdmin()/requireAdminForApi() gates every other
// admin-only feature already uses (see moderation/service.ts) -- no new
// schema, no new permission model, no new session/auth structure. This
// module only adds the user-list/promote/demote/suspend operations
// themselves.

export type AdminUserDTO = {
  id: number;
  email: string;
  nickname: string | null;
  isAdmin: boolean;
  isSuspended: boolean;
  suspendedUntil: Date | null;
  // Phase F-2: isSuspended/suspendedUntil above are kept as raw DB fields,
  // unchanged in meaning (isSuspended is a sticky "was suspended" flag that
  // an expired timed suspension never clears on its own -- see
  // auth/suspension.ts). This derived field is what the admin UI should
  // actually render against, computed with the exact same
  // isCurrentlySuspended() the authorization layer uses, so the list can
  // never show "정지됨" for a suspension that has already expired.
  currentlySuspended: boolean;
  createdAt: Date;
};

function toAdminUserDTO(row: User): AdminUserDTO {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    isAdmin: row.isAdmin,
    isSuspended: row.isSuspended,
    suspendedUntil: row.suspendedUntil,
    currentlySuspended: isCurrentlySuspended(row),
    createdAt: row.createdAt,
  };
}

export type AdminUserMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  // Requested safeguard: an admin can never demote or suspend their own
  // account through this feature (promoting/unsuspending yourself is
  // harmless and stays allowed -- there's nothing to protect against
  // there). Checked here, not just in the UI, so a direct API call can't
  // bypass it either.
  | { kind: "self" };

export type PagedAdminUsers = {
  items: AdminUserDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Mirrors moderation/service.ts::listReportsForAdmin()'s own re-check of
// isAdmin() even though the Route Handler already gated on it -- same
// belt-and-suspenders convention every admin-only function here follows.
export async function listUsersForAdmin(
  admin: User,
  { q, page, limit }: { q?: string; page: number; limit: number },
): Promise<AdminUserMutationResult<PagedAdminUsers>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { nickname: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { id: "asc" }, skip, take: limit }),
    prisma.user.count({ where }),
  ]);

  return {
    kind: "ok",
    data: {
      items: rows.map(toAdminUserDTO),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// Applies exactly one of the four toggles to one target user. Never
// derives suspendedUntil from anything but suspendDurationDays (undefined
// -> permanent, same convention as moderation/service.ts::
// applyReportAction's suspend_user branch) -- promote/demote/unsuspend
// ignore it entirely.
export async function updateUserByAdmin(
  admin: User,
  targetUserId: number,
  action: AdminUserAction,
  suspendDurationDays?: number,
): Promise<AdminUserMutationResult<AdminUserDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  if (targetUserId === admin.id && (action === "demote" || action === "suspend")) {
    return { kind: "self" };
  }

  const existing = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!existing) return { kind: "not_found" };

  const data: { isAdmin?: boolean; isSuspended?: boolean; suspendedUntil?: Date | null } = (() => {
    switch (action) {
      case "promote":
        return { isAdmin: true };
      case "demote":
        return { isAdmin: false };
      case "suspend":
        return {
          isSuspended: true,
          suspendedUntil: suspendDurationDays
            ? new Date(Date.now() + suspendDurationDays * 24 * 60 * 60 * 1000)
            : null,
        };
      case "unsuspend":
        return { isSuspended: false, suspendedUntil: null };
    }
  })();

  // Phase F-2: a direct suspend (unlike the report-flow's applyReportAction)
  // previously left the target with no notification at all -- fixed here by
  // creating the same USER_SUSPENDED notification, atomically with the
  // User update. relatedType/relatedId stay null: a direct suspend has no
  // Report backing it, and resolveHref.ts's existing relatedId===null guard
  // already renders that safely as a non-clickable notification with no
  // extra branching needed (E-4). The composite unique index on
  // Notification (userId, type, relatedType, relatedId) does not reject
  // repeated (null, null) pairs -- PostgreSQL unique indexes treat NULL as
  // distinct from NULL (verified against this project's own init migration,
  // a plain CREATE UNIQUE INDEX with no COALESCE trick), so re-suspending
  // the same user later just inserts another row, exactly as desired.
  if (action === "suspend") {
    const suspendDesc = suspendDurationDays ? `${suspendDurationDays}일 정지되었습니다.` : "영구 정지되었습니다.";
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: targetUserId }, data });
      await tx.notification.create({
        data: {
          userId: targetUserId,
          type: NotificationType.USER_SUSPENDED,
          title: "계정 정지 안내",
          content: `계정이 ${suspendDesc}`,
          relatedType: null,
          relatedId: null,
        },
      });
      return user;
    });
    return { kind: "ok", data: toAdminUserDTO(updated) };
  }

  const updated = await prisma.user.update({ where: { id: targetUserId }, data });
  return { kind: "ok", data: toAdminUserDTO(updated) };
}
