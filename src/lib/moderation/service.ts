import { prisma } from "@/lib/db/prisma";
import {
  LostPostStatus as PrismaLostPostStatus,
  FoundPostStatus as PrismaFoundPostStatus,
  ModerationActionType as PrismaModerationActionType,
  NotificationType,
  Prisma,
  type ModerationAction,
  type Report,
  type User,
} from "@/generated/prisma/client";
import { TARGET_TYPE_FROM_DB, TARGET_TYPE_TO_DB, toReportDTO, type ReportDTO } from "@/lib/report/service";
import type { ReportStatusValue, ReportTargetType } from "@/lib/report/schema";
import { resolveMessageTarget, resolvePostTarget, resolveUserTarget } from "@/lib/report/targets";
import { TARGET_TYPE_TO_ACTION_TYPE, type ModerationActionTypeValue } from "./schema";

// Same duplication tradeoff as notification/service.ts's
// NOTIFICATION_TYPE_FROM_DB: posts/service.ts already has this exact
// mapping but doesn't export it, and this module only needs it for a
// read-only admin display value -- not worth widening posts/service.ts's
// public surface for two-entry lookup tables.
const LOST_STATUS_FROM_DB: Record<PrismaLostPostStatus, string> = {
  SEARCHING: "찾는 중",
  FOUND: "찾음",
};
const FOUND_STATUS_FROM_DB: Record<PrismaFoundPostStatus, string> = {
  KEEPING: "보관 중",
  COMPLETED: "완료",
};

const ACTION_TYPE_TO_DB: Record<ModerationActionTypeValue, PrismaModerationActionType> = {
  delete_post: PrismaModerationActionType.DELETE_POST,
  hide_message: PrismaModerationActionType.HIDE_MESSAGE,
  suspend_user: PrismaModerationActionType.SUSPEND_USER,
};
const ACTION_TYPE_FROM_DB: Record<PrismaModerationActionType, ModerationActionTypeValue> = {
  DELETE_POST: "delete_post",
  HIDE_MESSAGE: "hide_message",
  SUSPEND_USER: "suspend_user",
};

// DB-sourced admin check only -- the caller must have obtained `admin` via
// getCurrentUser()/requireUserForApi() moments earlier (always a fresh DB
// read, see src/lib/auth/session.ts), never from client-controlled state.
// Mirrors legacy db.is_admin()/_require_admin()'s "never trust the
// caller" rule.
export function isAdmin(user: Pick<User, "isAdmin">): boolean {
  return user.isAdmin;
}

export type ModerationActionDTO = {
  id: number;
  actionType: ModerationActionTypeValue;
  reason: string | null;
  adminNickname: string | null;
  createdAt: Date;
  expiresAt: Date | null;
};

function toModerationActionDTO(row: ModerationAction & { adminUser: { nickname: string | null } }): ModerationActionDTO {
  return {
    id: row.id,
    actionType: ACTION_TYPE_FROM_DB[row.actionType],
    reason: row.reason,
    adminNickname: row.adminUser.nickname,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// Type-specific summary of a report's target, or null if the target no
// longer exists (deleted post/message, since Report.targetId deliberately
// has no FK so the report survives that deletion) -- mirrors legacy
// _report_target_info() exactly, including that this reads Message.content
// directly (unmasked), never through listMessages()'s hidden-message
// placeholder -- an admin needs the real content to review a report even
// after the message has already been hidden.
export type ReportTargetInfo =
  | { kind: "post"; postKind: "lost" | "found"; title: string; description: string; category: string; location: string; status: string; authorNickname: string | null; createdAt: Date }
  | { kind: "message"; content: string; senderNickname: string | null; createdAt: Date; chatRoomId: number }
  | { kind: "user"; nickname: string | null };

async function loadTargetInfo(targetType: ReportTargetType, targetId: number): Promise<ReportTargetInfo | null> {
  if (targetType === "post") {
    const resolved = await resolvePostTarget(targetId);
    if (!resolved) return null;
    if (resolved.postKind === "lost") {
      const post = await prisma.lostPost.findUnique({
        where: { id: resolved.id },
        include: { user: { select: { nickname: true } } },
      });
      if (!post) return null;
      return {
        kind: "post",
        postKind: "lost",
        title: post.title,
        description: post.description,
        category: post.category,
        location: post.location,
        status: LOST_STATUS_FROM_DB[post.status],
        authorNickname: post.user.nickname,
        createdAt: post.createdAt,
      };
    }
    const post = await prisma.foundPost.findUnique({
      where: { id: resolved.id },
      include: { user: { select: { nickname: true } } },
    });
    if (!post) return null;
    return {
      kind: "post",
      postKind: "found",
      title: post.title,
      description: post.description,
      category: post.category,
      location: post.location,
      status: FOUND_STATUS_FROM_DB[post.status],
      authorNickname: post.user.nickname,
      createdAt: post.createdAt,
    };
  }

  if (targetType === "message") {
    const message = await prisma.message.findUnique({
      where: { id: targetId },
      include: { sender: { select: { nickname: true } } },
    });
    if (!message) return null;
    return {
      kind: "message",
      content: message.content,
      senderNickname: message.sender.nickname,
      createdAt: message.createdAt,
      chatRoomId: message.chatRoomId,
    };
  }

  const user = await prisma.user.findUnique({ where: { id: targetId }, select: { nickname: true } });
  if (!user) return null;
  return { kind: "user", nickname: user.nickname };
}

export type ReportAdminDTO = ReportDTO & {
  reporterNickname: string | null;
  processedByNickname: string | null;
  targetDeleted: boolean;
  targetInfo: ReportTargetInfo | null;
  moderationAction: ModerationActionDTO | null;
};

type ReportRowForAdmin = Report & {
  reporter: { nickname: string | null };
  processedBy: { nickname: string | null } | null;
  moderationAction: (ModerationAction & { adminUser: { nickname: string | null } }) | null;
};

async function toReportAdminDTO(row: ReportRowForAdmin): Promise<ReportAdminDTO> {
  const targetType = TARGET_TYPE_FROM_DB[row.targetType];
  const targetInfo = await loadTargetInfo(targetType, row.targetId);
  return {
    ...toReportDTO(row),
    reporterNickname: row.reporter.nickname,
    processedByNickname: row.processedBy?.nickname ?? null,
    targetDeleted: targetInfo === null,
    targetInfo,
    moderationAction: row.moderationAction ? toModerationActionDTO(row.moderationAction) : null,
  };
}

const REPORT_INCLUDE_FOR_ADMIN = {
  reporter: { select: { nickname: true } },
  processedBy: { select: { nickname: true } },
  moderationAction: { include: { adminUser: { select: { nickname: true } } } },
} as const;

export type AdminMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_processed" }
  | { kind: "invalid_action_type" }
  | { kind: "target_gone" };

export type PagedReportsForAdmin = {
  items: ReportAdminDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Mirrors legacy list_reports_for_admin(): pending reports first, newest
// first within each group. Re-checks admin status itself (see isAdmin())
// even though the Route Handler already gated on it -- same
// belt-and-suspenders pattern every admin-only legacy function uses.
export async function listReportsForAdmin(
  admin: User,
  {
    status,
    targetType,
    page,
    limit,
  }: { status?: ReportStatusValue; targetType?: ReportTargetType; page: number; limit: number },
): Promise<AdminMutationResult<PagedReportsForAdmin>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const where: Prisma.ReportWhereInput = {
    ...(status && { status: STATUS_TO_DB(status) }),
    ...(targetType && { targetType: TARGET_TYPE_TO_DB[targetType] }),
  };

  // Legacy orders pending reports first as one group, then every other
  // status together by date (`CASE WHEN status = 'pending' THEN 0 ELSE 1
  // END, created_at DESC`) -- not a 3-way split by status. Prisma has no
  // arbitrary CASE-expression orderBy, so this is reproduced as two
  // queries (pending, then everything else) concatenated before slicing
  // for pagination, same bounded-fetch-then-merge tradeoff Phase 6's
  // cross-table search uses: fine for an admin queue's realistic size, not
  // a design meant to scale to unbounded rows.
  const ADMIN_SCAN_CAP = 1000;
  // The pending/other split only makes sense when the caller hasn't
  // already pinned `status` to one value -- filtering to a single status
  // has nothing left to group, so it's a plain date-ordered query.
  const [pendingRows, otherRows, total] = await Promise.all([
    status
      ? Promise.resolve([])
      : prisma.report.findMany({
          where: { ...where, status: "PENDING" },
          include: REPORT_INCLUDE_FOR_ADMIN,
          orderBy: { createdAt: "desc" },
          take: ADMIN_SCAN_CAP,
        }),
    prisma.report.findMany({
      where: status ? where : { ...where, status: { not: "PENDING" } },
      include: REPORT_INCLUDE_FOR_ADMIN,
      orderBy: { createdAt: "desc" },
      take: ADMIN_SCAN_CAP,
    }),
    prisma.report.count({ where }),
  ]);

  const skip = (page - 1) * limit;
  const rows = [...pendingRows, ...otherRows].slice(skip, skip + limit);
  const items = await Promise.all(rows.map(toReportAdminDTO));
  return {
    kind: "ok",
    data: { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

function STATUS_TO_DB(status: ReportStatusValue) {
  return { pending: "PENDING", dismissed: "DISMISSED", actioned: "ACTIONED" }[status] as
    | "PENDING"
    | "DISMISSED"
    | "ACTIONED";
}

// Used only by the process route to derive the one valid actionType for a
// report before calling applyReportAction() -- actionType is never taken
// from the request body (see Phase 11 spec's "reporterId/moderatorId/
// target fields must never be trusted from the client" rule; the same
// applies to which action a target implies).
export async function getReportTargetType(id: number): Promise<ReportTargetType | null> {
  const report = await prisma.report.findUnique({ where: { id }, select: { targetType: true } });
  return report ? TARGET_TYPE_FROM_DB[report.targetType] : null;
}

export async function getReportForAdmin(admin: User, id: number): Promise<AdminMutationResult<ReportAdminDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const row = await prisma.report.findUnique({ where: { id }, include: REPORT_INCLUDE_FOR_ADMIN });
  if (!row) return { kind: "not_found" };
  return { kind: "ok", data: await toReportAdminDTO(row) };
}

// Mirrors legacy db.process_report(): records a "dismissed" decision.
// ("actioned" is never reached through this function -- that decision
// always goes through applyReportAction() below, which applies the real
// sanction atomically with the status change, exactly like legacy's UI
// never calling process_report(status="actioned") either.) The report
// must still be pending; the UPDATE's own `WHERE status = 'pending'` guard
// is the source of truth for that, not a separate pre-check, so a
// concurrent double-process can't both succeed.
export async function dismissReport(
  admin: User,
  reportId: number,
  adminNote?: string,
): Promise<AdminMutationResult<ReportDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return { kind: "not_found" };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.report.updateMany({
      where: { id: reportId, status: "PENDING" },
      data: {
        status: "DISMISSED",
        processedAt: new Date(),
        processedByUserId: admin.id,
        adminNote: adminNote?.trim() || null,
      },
    });
    if (result.count === 0) return null;

    await tx.notification.create({
      data: {
        userId: report.reporterUserId,
        type: NotificationType.REPORT_PROCESSED,
        title: "신고 처리 결과가 등록되었습니다",
        content: "신고하신 내용이 관리자에 의해 반려되었습니다.",
        relatedType: "report",
        relatedId: reportId,
      },
    });

    return tx.report.findUniqueOrThrow({ where: { id: reportId } });
  });

  if (!updated) return { kind: "already_processed" };
  return { kind: "ok", data: toReportDTO(updated) };
}

// Mirrors legacy db.apply_report_action(): processes a report as
// "actioned" *and* applies the real sanction (delete the post / hide the
// message / suspend the user) atomically -- both happen, or neither does.
// action_type must match the report's target_type per
// TARGET_TYPE_TO_ACTION_TYPE (post->delete_post, message->hide_message,
// user->suspend_user); a mismatch is rejected before the transaction even
// opens. Concurrency: the report's own `WHERE status = 'pending'` guard
// and ModerationAction.reportId's UNIQUE constraint both serve as the
// authoritative "only one admin action per report" gate -- whichever
// commits first wins, the loser's transaction rolls back entirely.
export async function applyReportAction(
  admin: User,
  reportId: number,
  actionType: ModerationActionTypeValue,
  { actionReason, adminNote, suspendDurationDays }: { actionReason?: string; adminNote?: string; suspendDurationDays?: number },
): Promise<AdminMutationResult<ReportDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return { kind: "not_found" };

  const targetType = TARGET_TYPE_FROM_DB[report.targetType];
  if (TARGET_TYPE_TO_ACTION_TYPE[targetType] !== actionType) {
    return { kind: "invalid_action_type" };
  }

  const trimmedReason = actionReason?.trim() || null;
  const trimmedNote = adminNote?.trim() || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      let expiresAt: Date | null = null;

      if (targetType === "post") {
        const resolved = await resolvePostTarget(report.targetId);
        if (!resolved) return { outcome: "target_gone" as const };
        if (resolved.postKind === "lost") {
          await tx.lostPost.delete({ where: { id: resolved.id } });
        } else {
          await tx.foundPost.delete({ where: { id: resolved.id } });
        }
        await tx.notification.create({
          data: {
            userId: resolved.userId,
            type: NotificationType.POST_DELETED,
            title: "게시물이 삭제되었습니다",
            content: "신고 접수된 게시물이 관리자 조치로 삭제되었습니다.",
            relatedType: "report",
            relatedId: reportId,
          },
        });
      } else if (targetType === "message") {
        const resolved = await resolveMessageTarget(report.targetId);
        if (!resolved) return { outcome: "target_gone" as const };
        await tx.message.update({
          where: { id: resolved.id },
          data: { hiddenAt: new Date(), hiddenByUserId: admin.id, hiddenReason: trimmedReason },
        });
        await tx.notification.create({
          data: {
            userId: resolved.senderUserId,
            type: NotificationType.MESSAGE_HIDDEN,
            title: "메시지가 숨김 처리되었습니다",
            content: "작성하신 메시지가 관리자 조치로 숨김 처리되었습니다.",
            relatedType: "report",
            relatedId: reportId,
          },
        });
      } else {
        const resolved = await resolveUserTarget(report.targetId);
        if (!resolved) return { outcome: "target_gone" as const };
        let suspendDesc = "영구 정지되었습니다.";
        if (suspendDurationDays !== undefined) {
          expiresAt = new Date(Date.now() + suspendDurationDays * 24 * 60 * 60 * 1000);
          suspendDesc = `${suspendDurationDays}일 정지되었습니다.`;
        }
        await tx.user.update({
          where: { id: resolved.id },
          data: { isSuspended: true, suspendedUntil: expiresAt },
        });
        await tx.notification.create({
          data: {
            userId: resolved.id,
            type: NotificationType.USER_SUSPENDED,
            title: "계정 정지 안내",
            content: `계정이 ${suspendDesc}`,
            relatedType: "report",
            relatedId: reportId,
          },
        });
      }

      await tx.moderationAction.create({
        data: {
          reportId,
          targetType: report.targetType,
          targetId: report.targetId,
          actionType: ACTION_TYPE_TO_DB[actionType],
          reason: trimmedReason,
          adminUserId: admin.id,
          expiresAt,
        },
      });

      const updateResult = await tx.report.updateMany({
        where: { id: reportId, status: "PENDING" },
        data: { status: "ACTIONED", processedAt: new Date(), processedByUserId: admin.id, adminNote: trimmedNote },
      });
      if (updateResult.count === 0) return { outcome: "already_processed" as const };

      await tx.notification.create({
        data: {
          userId: report.reporterUserId,
          type: NotificationType.REPORT_PROCESSED,
          title: "신고 처리 결과가 등록되었습니다",
          content: "신고하신 내용이 관리자 조치로 처리되었습니다.",
          relatedType: "report",
          relatedId: reportId,
        },
      });

      const finalReport = await tx.report.findUniqueOrThrow({ where: { id: reportId } });
      return { outcome: "ok" as const, report: finalReport };
    });

    if (result.outcome === "target_gone") return { kind: "target_gone" };
    if (result.outcome === "already_processed") return { kind: "already_processed" };
    return { kind: "ok", data: toReportDTO(result.report) };
  } catch (error) {
    // Two admins racing the same report: whichever's ModerationAction
    // INSERT loses the UNIQUE(reportId) constraint gets P2002 and its
    // entire transaction (including whatever mutation it already applied)
    // rolls back -- converted to the same already_processed result the
    // `WHERE status = 'pending'` guard produces for the non-racing case.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { kind: "already_processed" };
    }
    throw error;
  }
}
