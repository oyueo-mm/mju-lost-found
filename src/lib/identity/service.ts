import { prisma } from "@/lib/db/prisma";
import { CURRENT_IDENTITY_CONSENT_VERSION } from "@/lib/auth/terms";
import { resolveMessageTarget, resolvePostTarget, resolveUserTarget } from "@/lib/report/targets";
import type { User } from "@/generated/prisma/client";
import type { IdentityInput } from "./validation";
import { normalizeViewReason } from "./validation";

// 실명·학과 (UserIdentityInfo). Every read of these values goes through
// this file: the member's own (내 정보, the form) and an admin's, for a
// report, logged. Nothing here ever logs the values themselves.

export type OwnIdentityInfo = { realName: string; department: string; updatedAt: Date; consentVersion: string };

export async function getOwnIdentityInfo(userId: number): Promise<OwnIdentityInfo | null> {
  return prisma.userIdentityInfo.findUnique({
    where: { userId },
    select: { realName: true, department: true, updatedAt: true, consentVersion: true },
  });
}

// Required before posting or chatting (see requireIdentityForApi).
export async function hasIdentityInfo(userId: number): Promise<boolean> {
  return (await prisma.userIdentityInfo.count({ where: { userId } })) > 0;
}

// Saving the form is also the 실명·학과 수집·이용 동의 (the form's required
// checkbox), recorded with the current consent version and time.
export async function saveOwnIdentityInfo(userId: number, input: IdentityInput, now = new Date()): Promise<void> {
  const data = {
    realName: input.realName,
    department: input.department,
    consentVersion: CURRENT_IDENTITY_CONSENT_VERSION,
    consentedAt: now,
  };
  await prisma.userIdentityInfo.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

// The two people a report is about: who filed it, and who wrote what was
// reported (the reported member, for a USER report). Deleted comments
// still count -- a dispute can be about something already removed.
export async function reportPartyUserIds(
  reportId: number,
): Promise<{ reporterUserId: number; targetUserId: number | null } | null> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { reporterUserId: true, targetType: true, targetId: true },
  });
  if (!report) return null;
  let targetUserId: number | null = null;
  switch (report.targetType) {
    case "POST":
      targetUserId = (await resolvePostTarget(report.targetId))?.userId ?? null;
      break;
    case "MESSAGE":
      targetUserId = (await resolveMessageTarget(report.targetId))?.senderUserId ?? null;
      break;
    case "USER":
      targetUserId = (await resolveUserTarget(report.targetId))?.id ?? null;
      break;
    case "COMMENT":
      targetUserId =
        (await prisma.comment.findUnique({ where: { id: report.targetId }, select: { authorUserId: true } }))
          ?.authorUserId ?? null;
      break;
  }
  return { reporterUserId: report.reporterUserId, targetUserId };
}

export type AdminIdentityView = {
  nickname: string | null;
  realName: string | null;
  department: string | null;
  updatedAt: Date | null;
};

export type AdminIdentityViewResult =
  | { kind: "ok"; data: AdminIdentityView }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_reason" };

// An admin may see a member's 실명·학과 only while handling a report, only
// for that report's reporter or reported member, and only with a written
// reason. The log row is written in the same transaction as the read, so
// there is never a view without its record.
export async function viewIdentityForReport(
  admin: Pick<User, "id" | "isAdmin">,
  { reportId, targetUserId, reason }: { reportId: number; targetUserId: number; reason: unknown },
): Promise<AdminIdentityViewResult> {
  if (!admin.isAdmin) return { kind: "forbidden" };
  const normalizedReason = normalizeViewReason(reason);
  if (!normalizedReason) return { kind: "invalid_reason" };

  const parties = await reportPartyUserIds(reportId);
  if (!parties) return { kind: "not_found" };
  if (targetUserId !== parties.reporterUserId && targetUserId !== parties.targetUserId) return { kind: "forbidden" };

  return prisma.$transaction(async (tx) => {
    const member = await tx.user.findUnique({
      where: { id: targetUserId },
      select: {
        nickname: true,
        identityInfo: { select: { realName: true, department: true, updatedAt: true } },
      },
    });
    if (!member) return { kind: "not_found" as const };
    await tx.identityAccessLog.create({
      data: { adminUserId: admin.id, targetUserId, reportId, reason: normalizedReason },
    });
    return {
      kind: "ok" as const,
      data: {
        nickname: member.nickname,
        realName: member.identityInfo?.realName ?? null,
        department: member.identityInfo?.department ?? null,
        updatedAt: member.identityInfo?.updatedAt ?? null,
      },
    };
  });
}
