import { prisma } from "@/lib/db/prisma";
import { NotificationType as PrismaNotificationType, type User } from "@/generated/prisma/client";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { fanOutToAdmins } from "@/lib/notification/adminFanout";
import { isAdmin } from "./service";

// Phase I section 4: deliberately minimal, per this phase's own spec
// ("운영자가 승인/거절하는 복잡한 workflow가 현재 구조상 과도하다면... 최소한의
// 구조로 구현") -- see SuspensionAppeal's own schema.prisma comment for the
// full reasoning. One appeal is either not yet reviewed or reviewed; there
// is no separate approve/reject outcome to record, and unsuspending the
// user (if the admin agrees) is a plain, already-existing action
// (UserActionButtons' "정지 해제"), not something this module drives.

export type SuspensionAppealDTO = {
  id: number;
  content: string;
  createdAt: Date;
  reviewedAt: Date | null;
};

function toAppealDTO(row: { id: number; content: string; createdAt: Date; reviewedAt: Date | null }): SuspensionAppealDTO {
  return { id: row.id, content: row.content, createdAt: row.createdAt, reviewedAt: row.reviewedAt };
}

export type AppealMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_suspended" }
  | { kind: "already_pending" }
  | { kind: "blank_content" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

// Called only from the suspended user's own page (see (auth)/suspended/
// actions.ts) -- `user` always comes from the server-verified session,
// never a client-supplied id, so this can only ever file an appeal for the
// caller's own account. Rejects if the account isn't actually currently
// suspended (nothing to appeal), or if an earlier appeal is still
// unreviewed (one at a time -- prevents someone from resubmitting a wall
// of appeals while waiting).
export async function submitSuspensionAppeal(user: User, content: string): Promise<AppealMutationResult<SuspensionAppealDTO>> {
  if (!isCurrentlySuspended(user)) return { kind: "not_suspended" };

  const trimmed = content.trim();
  if (!trimmed) return { kind: "blank_content" };

  const existingPending = await prisma.suspensionAppeal.findFirst({
    where: { userId: user.id, reviewedAt: null },
  });
  if (existingPending) return { kind: "already_pending" };

  // Phase 12-9 §2: create + admin fan-out in one transaction -- see
  // report/service.ts's createReport's own identical comment.
  const created = await prisma.$transaction(async (tx) => {
    const appeal = await tx.suspensionAppeal.create({
      data: { userId: user.id, content: trimmed },
    });
    await fanOutToAdmins(tx, {
      type: PrismaNotificationType.SUSPENSION_APPEAL_RECEIVED,
      title: "새 이의제기가 접수되었습니다",
      content: `${user.nickname ?? "사용자"}님이 정지에 대해 이의를 제기했습니다.`,
      relatedType: "suspension_appeal",
      relatedId: appeal.id,
    });
    return appeal;
  });
  return { kind: "ok", data: toAppealDTO(created) };
}

// The suspended user's own most recent appeal (any status) -- lets
// (auth)/suspended/page.tsx show "제출됨, 검토 대기 중" vs "검토 완료" vs no
// appeal filed yet, per this phase's own "본인에게 제출 상태 표시" requirement.
export async function getLatestAppealForUser(userId: number): Promise<SuspensionAppealDTO | null> {
  const row = await prisma.suspensionAppeal.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toAppealDTO(row) : null;
}

export type SuspensionAppealAdminDTO = SuspensionAppealDTO & {
  targetUser: { id: number; publicId: string; nickname: string | null } | null;
  reviewedByNickname: string | null;
};

export type PagedSuspensionAppeals = {
  items: SuspensionAppealAdminDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// "운영자가 이의신청을 확인할 수 있는 구조" -- unreviewed first (an admin's
// queue, same "pending first" shape listReportsForAdmin() already uses),
// then everything else newest-first.
export async function listSuspensionAppealsForAdmin(
  admin: User,
  { page, limit }: { page: number; limit: number },
): Promise<AppealMutationResult<PagedSuspensionAppeals>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const skip = (page - 1) * limit;
  const [pendingRows, reviewedRows, total] = await Promise.all([
    prisma.suspensionAppeal.findMany({
      where: { reviewedAt: null },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, publicId: true, nickname: true } }, reviewedBy: { select: { nickname: true } } },
    }),
    prisma.suspensionAppeal.findMany({
      where: { reviewedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, publicId: true, nickname: true } }, reviewedBy: { select: { nickname: true } } },
    }),
    prisma.suspensionAppeal.count(),
  ]);

  const rows = [...pendingRows, ...reviewedRows].slice(skip, skip + limit);
  const items: SuspensionAppealAdminDTO[] = rows.map((row) => ({
    ...toAppealDTO(row),
    targetUser: row.user,
    reviewedByNickname: row.reviewedBy?.nickname ?? null,
  }));

  return { kind: "ok", data: { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

// Marks one appeal reviewed -- the only admin-side workflow step this
// phase implements (see this file's own top comment). Does not itself
// unsuspend anyone; an admin who agrees still uses the existing "정지 해제"
// action separately.
export async function markSuspensionAppealReviewed(admin: User, appealId: number): Promise<AppealMutationResult<SuspensionAppealDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const existing = await prisma.suspensionAppeal.findUnique({ where: { id: appealId } });
  if (!existing) return { kind: "not_found" };

  const updated = await prisma.suspensionAppeal.update({
    where: { id: appealId },
    data: { reviewedAt: new Date(), reviewedByUserId: admin.id },
  });
  return { kind: "ok", data: toAppealDTO(updated) };
}
