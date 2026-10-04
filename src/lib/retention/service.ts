import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended } from "@/lib/auth/suspension";
import { releaseResolvedWithdrawnIdentities } from "@/lib/auth/identityRelease";
import { WITHDRAWN_IMAGE_TEXT, WITHDRAWN_POST_TITLE, clearPostInTx } from "@/lib/auth/withdrawal";
import { deleteChatImageSafely } from "@/lib/images/chatStorage";
import { deletePostRowInTx, deletePostStorageObjects } from "@/lib/posts/service";
import { encodePostTargetId } from "@/lib/report/targets";
import {
  ACCESS_LOG_MIN_RETENTION_DAYS,
  CHAT_TEXT_RETENTION_DAYS,
  RECORD_RETENTION_DAYS,
  daysBefore,
  evidenceReleased,
  type ReportFacts,
} from "@/lib/retention/policy";
import { AdminActionProposalStatus, ReportStatus, ReportTargetType, RejoinRequestStatus } from "@/generated/prisma/client";

// 회원탈퇴 보유정책 -- removes what withdrawAccount() kept once its period is
// over. Runs daily (GET /api/cron/retention, Vercel Cron). Only data tied
// to withdrawn accounts is touched; an active account's data follows the
// account. Nothing goes through a cascade: a message keeps its row with its
// text replaced, a post or comment others replied under keeps an empty row
// (the existing tombstone rules), and a report another user's sanction came
// from is detached (reportId NULL) rather than deleted with it.
//
//  - Chat text of a withdrawn sender: 90 days after the withdrawal.
//  - Report evidence (post/comment kept with its content, chat image and
//    text): until no report on it is pending, then 1 year after the last
//    processing (lib/retention/policy.ts::evidenceReleased).
//  - Processed reports, sanctions (ModerationAction), appeals and admin
//    action proposals about a withdrawn account, and reports it filed:
//    1 year after processing. Records about the account (and its evidence)
//    are kept while it is still suspended or its withdrawn hold is open.
//  - Rejoin request decisions: 1 year after review.
//  - AdminAccessLog: at least 1 year -- a report is removed only once every
//    access log on it is a year old (those logs go with it); others stay.
//  - WithdrawnIdentity: deleted as soon as its purpose ends
//    (auth/identityRelease.ts), re-checked here too.

export const EXPIRED_MESSAGE_TEXT = "(보유기간이 지나 삭제된 메시지)";

export type RetentionResult = {
  identitiesReleased: number;
  messagesExpired: number;
  chatImagesDeleted: number;
  postsPurged: number;
  commentsPurged: number;
  reportsDeleted: number;
  reportsDeferredForAccessLogs: number;
  actionsDeleted: number;
  appealsDeleted: number;
  proposalsDeleted: number;
  rejoinRequestsDeleted: number;
};

const key = (type: ReportTargetType, id: number) => `${type}:${id}`;

export async function runRetention(now: Date = new Date()): Promise<RetentionResult> {
  const result: RetentionResult = {
    identitiesReleased: (await releaseResolvedWithdrawnIdentities()).length,
    messagesExpired: 0,
    chatImagesDeleted: 0,
    postsPurged: 0,
    commentsPurged: 0,
    reportsDeleted: 0,
    reportsDeferredForAccessLogs: 0,
    actionsDeleted: 0,
    appealsDeleted: 0,
    proposalsDeleted: 0,
    rejoinRequestsDeleted: 0,
  };
  const recordCutoff = daysBefore(now, RECORD_RETENTION_DAYS);
  const accessLogCutoff = daysBefore(now, ACCESS_LOG_MIN_RETENTION_DAYS);
  const chatCutoff = daysBefore(now, CHAT_TEXT_RETENTION_DAYS);

  const withdrawn = await prisma.user.findMany({
    where: { withdrawnAt: { not: null } },
    select: { id: true, withdrawnAt: true, isSuspended: true, suspendedUntil: true, _count: { select: { withdrawnIdentities: true } } },
    orderBy: { id: "asc" },
  });

  for (const w of withdrawn) {
    const lost = await prisma.lostPost.findMany({ where: { userId: w.id }, select: { id: true, title: true, removedAt: true } });
    const found = await prisma.foundPost.findMany({ where: { userId: w.id }, select: { id: true, title: true, removedAt: true } });
    const comments = await prisma.comment.findMany({ where: { authorUserId: w.id }, select: { id: true, content: true, deletedAt: true } });
    const messages = await prisma.message.findMany({ where: { senderUserId: w.id }, select: { id: true, content: true, imagePath: true } });
    const postTargets = [...lost.map((p) => encodePostTargetId("lost", p.id)), ...found.map((p) => encodePostTargetId("found", p.id))];
    const targetsOfW = [
      { targetType: ReportTargetType.USER, targetId: w.id },
      { targetType: ReportTargetType.POST, targetId: { in: postTargets } },
      { targetType: ReportTargetType.COMMENT, targetId: { in: comments.map((c) => c.id) } },
      { targetType: ReportTargetType.MESSAGE, targetId: { in: messages.map((m) => m.id) } },
    ];

    const aboutW = await prisma.report.findMany({
      where: { OR: targetsOfW },
      select: { id: true, targetType: true, targetId: true, status: true, processedAt: true, createdAt: true },
    });
    const reportsOn = new Map<string, ReportFacts[]>();
    for (const r of aboutW) {
      const k = key(r.targetType, r.targetId);
      reportsOn.set(k, [...(reportsOn.get(k) ?? []), r]);
    }
    // A still-suspended account, or one whose hold is open, keeps the
    // records about it and their evidence: the matter is not over.
    const sanctionOpen = w._count.withdrawnIdentities > 0 || isCurrentlySuspended(w);
    const evidenceFree = (type: ReportTargetType, id: number) => {
      const reports = reportsOn.get(key(type, id));
      if (!reports) return true; // never reported: not evidence
      return !sanctionOpen && evidenceReleased(reports, now);
    };

    // ---- chat: text 90 days after withdrawal; images (only evidence ones
    // are left) once released
    const chatPaths: string[] = [];
    for (const m of messages) {
      if (!evidenceFree(ReportTargetType.MESSAGE, m.id)) continue;
      const dropImage = Boolean(m.imagePath);
      const expireText = w.withdrawnAt !== null && w.withdrawnAt <= chatCutoff && m.content !== EXPIRED_MESSAGE_TEXT;
      if (!dropImage && !expireText) continue;
      if (m.imagePath) chatPaths.push(m.imagePath);
      await prisma.message.update({
        where: { id: m.id },
        data: {
          ...(dropImage ? { imagePath: null } : {}),
          ...(expireText ? { content: EXPIRED_MESSAGE_TEXT } : m.content.trim() === "" ? { content: WITHDRAWN_IMAGE_TEXT } : {}),
        },
      });
      if (expireText) result.messagesExpired++;
    }
    await Promise.all(chatPaths.map((p) => deleteChatImageSafely(p)));
    result.chatImagesDeleted += chatPaths.length;

    // ---- posts kept with their content as evidence
    const postUrls: string[] = [];
    for (const [kind, rows] of [["lost", lost], ["found", found]] as const) {
      for (const p of rows) {
        if (!p.removedAt || p.title === WITHDRAWN_POST_TITLE) continue; // already emptied
        if (!evidenceFree(ReportTargetType.POST, encodePostTargetId(kind, p.id))) continue;
        const removedAt = p.removedAt;
        await prisma.$transaction(async (tx) => {
          const remaining = await tx.comment.count({ where: kind === "lost" ? { lostPostId: p.id } : { foundPostId: p.id } });
          if (remaining === 0) postUrls.push(...((await deletePostRowInTx(tx, kind, p.id)) ?? []));
          else postUrls.push(...(await clearPostInTx(tx, kind, p.id, removedAt)));
        });
        result.postsPurged++;
      }
    }
    await deletePostStorageObjects(postUrls);

    // ---- comments kept with their content as evidence (tombstone rule)
    for (const c of comments) {
      if (!c.deletedAt || c.content === "") continue;
      if (!evidenceFree(ReportTargetType.COMMENT, c.id)) continue;
      const { count } = await prisma.comment.deleteMany({ where: { id: c.id, replies: { none: {} } } });
      if (count === 0) await prisma.comment.update({ where: { id: c.id }, data: { content: "" } });
      result.commentsPurged++;
    }

    // ---- processed reports: about W (unless the matter is still open), and
    // ones W filed about others -- 1 year after processing
    const aboutIds = new Set(aboutW.map((r) => r.id));
    const expiredReports = await prisma.report.findMany({
      where: {
        status: { not: ReportStatus.PENDING },
        OR: [...(sanctionOpen ? [] : [{ id: { in: [...aboutIds] } }]), { reporterUserId: w.id }],
      },
      select: { id: true, processedAt: true, createdAt: true },
    });
    for (const r of expiredReports) {
      if ((r.processedAt ?? r.createdAt) > recordCutoff) continue;
      if ((await prisma.adminAccessLog.count({ where: { reportId: r.id, accessedAt: { gt: accessLogCutoff } } })) > 0) {
        result.reportsDeferredForAccessLogs++;
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.adminAccessLog.deleteMany({ where: { reportId: r.id } });
        if (aboutIds.has(r.id)) {
          result.actionsDeleted += (await tx.moderationAction.deleteMany({ where: { reportId: r.id } })).count;
        } else {
          // W reported someone else: that person's sanction record stays.
          await tx.moderationAction.updateMany({ where: { reportId: r.id }, data: { reportId: null } });
        }
        await tx.report.delete({ where: { id: r.id } });
      });
      result.reportsDeleted++;
    }

    if (sanctionOpen) continue;

    // ---- sanctions on W outside the report flow (direct suspensions, restores)
    result.actionsDeleted += (
      await prisma.moderationAction.deleteMany({ where: { reportId: null, createdAt: { lte: recordCutoff }, OR: targetsOfW } })
    ).count;

    // ---- appeals and admin action proposals about W
    result.appealsDeleted += (await prisma.suspensionAppeal.deleteMany({ where: { userId: w.id, reviewedAt: { lte: recordCutoff } } })).count;
    result.proposalsDeleted += (
      await prisma.adminActionProposal.deleteMany({
        where: {
          targetUserId: w.id,
          OR: [
            { status: AdminActionProposalStatus.EXECUTED, executedAt: { lte: recordCutoff } },
            { status: AdminActionProposalStatus.CANCELLED, cancelledAt: { lte: recordCutoff } },
            { status: { in: [AdminActionProposalStatus.EXPIRED, AdminActionProposalStatus.PENDING] }, expiresAt: { lte: recordCutoff } },
          ],
        },
      })
    ).count;
  }

  // ---- rejoin decisions (all belong to withdrawn accounts): 1 year after review
  result.rejoinRequestsDeleted = (
    await prisma.rejoinRequest.deleteMany({ where: { status: { not: RejoinRequestStatus.PENDING }, reviewedAt: { lte: recordCutoff } } })
  ).count;

  return result;
}
