import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { encodePostTargetId } from "@/lib/report/targets";
import { AdminActionProposalStatus, ReportStatus, ReportTargetType, type Prisma, type User } from "@/generated/prisma/client";

// 회원탈퇴: the sanction matters that keep a withdrawn person recognisable
// (WithdrawnIdentity). Shared by the withdrawal itself and by the release
// check that deletes the identity as soon as none of them is open any more.

export type HoldReason = "active_suspension" | "pending_report" | "pending_sanction_proposal" | "pending_appeal";

export function holdReasonsFor(state: {
  activeSuspension: boolean;
  pendingReports: number;
  pendingProposals: number;
  pendingAppeals: number;
}): HoldReason[] {
  const reasons: HoldReason[] = [];
  if (state.activeSuspension) reasons.push("active_suspension");
  if (state.pendingReports > 0) reasons.push("pending_report");
  if (state.pendingProposals > 0) reasons.push("pending_sanction_proposal");
  if (state.pendingAppeals > 0) reasons.push("pending_appeal");
  return reasons;
}

type Db = Pick<
  Prisma.TransactionClient,
  "lostPost" | "foundPost" | "comment" | "message" | "report" | "adminActionProposal" | "suspensionAppeal"
>;

// Pending reports on the user or on anything they wrote that still exists.
export async function pendingReportsAbout(db: Db, userId: number): Promise<{ targetType: ReportTargetType; targetId: number }[]> {
  const [lost, found, comments, messages] = [
    await db.lostPost.findMany({ where: { userId }, select: { id: true } }),
    await db.foundPost.findMany({ where: { userId }, select: { id: true } }),
    await db.comment.findMany({ where: { authorUserId: userId }, select: { id: true } }),
    await db.message.findMany({ where: { senderUserId: userId }, select: { id: true } }),
  ];
  return db.report.findMany({
    where: {
      status: ReportStatus.PENDING,
      OR: [
        { targetType: ReportTargetType.USER, targetId: userId },
        {
          targetType: ReportTargetType.POST,
          targetId: { in: [...lost.map((p) => encodePostTargetId("lost", p.id)), ...found.map((p) => encodePostTargetId("found", p.id))] },
        },
        { targetType: ReportTargetType.COMMENT, targetId: { in: comments.map((c) => c.id) } },
        { targetType: ReportTargetType.MESSAGE, targetId: { in: messages.map((m) => m.id) } },
      ],
    },
    select: { targetType: true, targetId: true },
  });
}

// A PENDING proposal past its expiresAt is already expired (proposals.ts
// flips that lazily), so it no longer counts as open.
export async function openHoldReasons(
  db: Db,
  user: Pick<User, "id" | "isSuspended" | "suspendedUntil">,
  pendingReports?: { targetType: ReportTargetType; targetId: number }[],
): Promise<HoldReason[]> {
  const reports = pendingReports ?? (await pendingReportsAbout(db, user.id));
  return holdReasonsFor({
    activeSuspension: isCurrentlySuspended(user),
    pendingReports: reports.length,
    pendingProposals: await db.adminActionProposal.count({
      where: { targetUserId: user.id, status: AdminActionProposalStatus.PENDING, expiresAt: { gt: new Date() } },
    }),
    pendingAppeals: await db.suspensionAppeal.count({ where: { userId: user.id, reviewedAt: null } }),
  });
}
