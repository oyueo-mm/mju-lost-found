import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { isAdmin } from "@/lib/moderation/service";
import { RejoinRequestStatus, WithdrawnIdentityStatus, type User } from "@/generated/prisma/client";

// 회원탈퇴: rejoin requests from a held withdrawn identity (see
// auth/withdrawnIdentity.ts). The requester has no account -- they are
// identified only by the held identity id their signed session carries.
// One request per hold: a rejected request keeps the person blocked, an
// approved one lets their next Google sign-in create a brand-new User.

export const REJOIN_REASON_MIN = 10;
export const REJOIN_REASON_MAX = 1000;

export const rejoinReasonSchema = z
  .string()
  .trim()
  .min(REJOIN_REASON_MIN, `사유를 ${REJOIN_REASON_MIN}자 이상 입력해주세요.`)
  .max(REJOIN_REASON_MAX, `사유는 ${REJOIN_REASON_MAX}자 이하로 입력해주세요.`);

export const reviewNoteSchema = z.string().trim().max(1000, "메모는 1000자 이하로 입력해주세요.");

export const HOLD_REASON_LABELS: Record<string, string> = {
  active_suspension: "탈퇴 당시 이용 정지 중",
  pending_report: "탈퇴 당시 미처리 신고",
  pending_sanction_proposal: "탈퇴 당시 진행 중인 제재 절차",
  pending_appeal: "탈퇴 당시 검토 전 이의신청",
};

export type RejoinState =
  | { kind: "none" }
  | { kind: "pending"; createdAt: Date }
  | { kind: "approved" }
  | { kind: "rejected"; reviewedAt: Date | null };

export async function getRejoinState(identityId: number): Promise<RejoinState | null> {
  const identity = await prisma.withdrawnIdentity.findUnique({
    where: { id: identityId },
    select: {
      status: true,
      rejoinRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true, reviewedAt: true, consumedAt: true } },
    },
  });
  if (!identity || identity.status !== WithdrawnIdentityStatus.ACTIVE) return null;
  const latest = identity.rejoinRequests[0];
  if (!latest) return { kind: "none" };
  if (latest.status === RejoinRequestStatus.PENDING) return { kind: "pending", createdAt: latest.createdAt };
  if (latest.status === RejoinRequestStatus.APPROVED) return { kind: "approved" };
  return { kind: "rejected", reviewedAt: latest.reviewedAt };
}

export type SubmitRejoinResult = { kind: "ok" } | { kind: "invalid"; error: string } | { kind: "not_allowed" };

export async function submitRejoinRequest(identityId: number, rawReason: string): Promise<SubmitRejoinResult> {
  const parsed = rejoinReasonSchema.safeParse(rawReason);
  if (!parsed.success) return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "사유를 확인해주세요." };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "WithdrawnIdentity" WHERE id = ${identityId} FOR UPDATE`;
    const identity = await tx.withdrawnIdentity.findUnique({
      where: { id: identityId },
      select: { status: true, _count: { select: { rejoinRequests: true } } },
    });
    if (!identity || identity.status !== WithdrawnIdentityStatus.ACTIVE || identity._count.rejoinRequests > 0) {
      return { kind: "not_allowed" as const };
    }
    await tx.rejoinRequest.create({ data: { identityId, reason: parsed.data } });
    return { kind: "ok" as const };
  });
}

export type RejoinRequestAdminDTO = {
  id: number;
  status: RejoinRequestStatus;
  reason: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedByNickname: string | null;
  reviewNote: string | null;
  consumedAt: Date | null;
  holdReasons: string[];
  withdrawnUserId: number;
  withdrawnAt: Date | null;
  suspendedUntil: Date | null;
  wasSuspended: boolean;
};

export async function listRejoinRequestsForAdmin(admin: User): Promise<RejoinRequestAdminDTO[] | null> {
  if (!isAdmin(admin)) return null;
  const rows = await prisma.rejoinRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      reviewedBy: { select: { nickname: true } },
      identity: {
        select: {
          reasons: true,
          withdrawnUserId: true,
          withdrawnUser: { select: { withdrawnAt: true, isSuspended: true, suspendedUntil: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    reviewedByNickname: r.reviewedBy?.nickname ?? null,
    reviewNote: r.reviewNote,
    consumedAt: r.consumedAt,
    holdReasons: r.identity.reasons,
    withdrawnUserId: r.identity.withdrawnUserId,
    withdrawnAt: r.identity.withdrawnUser.withdrawnAt,
    suspendedUntil: r.identity.withdrawnUser.suspendedUntil,
    wasSuspended: r.identity.withdrawnUser.isSuspended,
  }));
}

export type ReviewRejoinResult = { kind: "ok" } | { kind: "forbidden" } | { kind: "not_found" } | { kind: "already_reviewed" };

// The decision, who made it and when, plus an optional note, stay on the
// request row as its processing record.
export async function reviewRejoinRequest(
  admin: User,
  requestId: number,
  decision: "approve" | "reject",
  note: string,
): Promise<ReviewRejoinResult> {
  if (!isAdmin(admin)) return { kind: "forbidden" };
  const exists = await prisma.rejoinRequest.findUnique({ where: { id: requestId }, select: { id: true } });
  if (!exists) return { kind: "not_found" };
  const { count } = await prisma.rejoinRequest.updateMany({
    where: { id: requestId, status: RejoinRequestStatus.PENDING },
    data: {
      status: decision === "approve" ? RejoinRequestStatus.APPROVED : RejoinRequestStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedByUserId: admin.id,
      reviewNote: note.trim() || null,
    },
  });
  return count === 0 ? { kind: "already_reviewed" } : { kind: "ok" };
}
