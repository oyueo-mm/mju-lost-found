import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { normalizeEmail } from "@/lib/auth/access";
import { openHoldReasons, pendingReportsAbout } from "@/lib/auth/holdState";
import { soleLeaderOrganizationNames } from "@/lib/auth/user";
import { CURRENT_IDENTITY_KEY_VERSION, identityHmac, identitySubject } from "@/lib/auth/withdrawnIdentity";
import { removeCommentInTx } from "@/lib/comment/remove";
import { deleteChatImageSafely } from "@/lib/images/chatStorage";
import { deletePostRowInTx, deletePostStorageObjects } from "@/lib/posts/service";
import { encodePostTargetId } from "@/lib/report/targets";
import { evidenceReleased, type ReportFacts } from "@/lib/retention/policy";
import { NotificationType, OrganizationRequestStatus, ReportTargetType, type Prisma } from "@/generated/prisma/client";

// 회원탈퇴 -- irreversible, unlike deactivation (auth/user.ts::withdrawUser,
// which stays as it was). The User row itself is kept, because ~30
// foreign keys RESTRICT its deletion and loosening them would cascade
// other people's data away; instead every direct identifier on it is
// removed. What remains (the same userId on reports, sanctions, chats) is
// pseudonymised, not anonymous.
//
// Per data:
// - User: e-mail -> withdrawn-<id>@withdrawn.invalid, name/nickname -> "탈퇴한
//   사용자", googleId/consents/lastLoginAt/nickname cooldown -> null, a new
//   publicId (old profile links stop resolving), isAdmin off, deletedAt +
//   withdrawnAt set. Suspension fields stay (sanction record).
// - Own notifications, keyword alerts, reactions, read markers, PostView
//   rows, rate-limit counters, memberships, pending organization requests,
//   the external-access approval: deleted.
// - Other users' notifications that spelled out this user's nickname: the
//   text is rewritten (matched exactly by the related message/comment/room/
//   appeal id, never by searching for the nickname).
// - Report evidence: anything with a pending report, or a report processed
//   less than 1 year ago, keeps its content (comment text, post content,
//   chat image) but is no longer shown; lib/retention removes it later.
// - Comments: removed through the usual tombstone rule (replies by others
//   are never cascaded).
// - Posts: evidence posts stay non-public with their content. Otherwise, a post other people commented on keeps an
//   empty, non-public row (so their comments aren't cascaded away) with
//   text, images and AI vectors removed; a post nobody else touched is
//   deleted. Chat rooms keep working off their own title snapshot, which is
//   replaced with a placeholder.
// - Chat: rooms and message text stay (the other participant's record of
//   the conversation), shown as from "탈퇴한 사용자"; images this user sent
//   are deleted unless the message has a pending report. No new messages
//   can be sent to them.
// - Feedback: deleted.
// - Reports, sanctions, appeals, AdminAccessLog: kept (pseudonymised
//   through the identifier-free User row).
// - A WithdrawnIdentity (HMAC only) is kept only if a sanction matter is
//   still open -- see auth/holdState.ts.
// What is kept here is later removed on schedule by lib/retention
// (chat text 90 days after withdrawal; report/sanction/appeal records and
// their evidence 1 year after they were processed).

export const WITHDRAWN_USER_LABEL = "탈퇴한 사용자";
export const WITHDRAWN_POST_TITLE = "탈퇴한 사용자의 게시글";
export const WITHDRAWN_IMAGE_TEXT = "(탈퇴로 삭제된 사진)";

export type WithdrawAccountResult =
  | { kind: "ok"; held: boolean }
  | { kind: "sole_leader_block"; organizationNames: string[] }
  | { kind: "not_found" };

type Tx = Prisma.TransactionClient;
type PostKind = "lost" | "found";

const reportKey = (type: ReportTargetType, id: number) => `${type}:${id}`;

export async function clearPostInTx(tx: Tx, kind: PostKind, id: number, removedAt: Date): Promise<string[]> {
  const where = kind === "lost" ? { lostPostId: id } : { foundPostId: id };
  const images = await tx.postImage.findMany({ where, select: { imageUrl: true } });
  const post =
    kind === "lost"
      ? await tx.lostPost.findUnique({ where: { id }, select: { imageUrl: true } })
      : await tx.foundPost.findUnique({ where: { id }, select: { imageUrl: true } });
  await tx.postImage.deleteMany({ where });
  const cleared = { title: WITHDRAWN_POST_TITLE, description: "", location: null, imageUrl: null, removedAt };
  if (kind === "lost") {
    await tx.lostPost.update({ where: { id }, data: { ...cleared, lostAt: null } });
    await tx.$executeRaw`UPDATE "LostPost" SET embedding = NULL, "imageEmbedding" = NULL WHERE id = ${id}`;
  } else {
    await tx.foundPost.update({ where: { id }, data: { ...cleared, foundAt: null } });
    await tx.$executeRaw`UPDATE "FoundPost" SET embedding = NULL, "imageEmbedding" = NULL WHERE id = ${id}`;
  }
  await tx.matchCandidateCache.deleteMany({ where: { sourceType: kind, sourcePostId: id } });
  const urls = new Set(images.map((i) => i.imageUrl));
  if (post?.imageUrl) urls.add(post.imageUrl);
  return [...urls];
}

export async function withdrawAccount(userId: number): Promise<WithdrawAccountResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.withdrawnAt) return { kind: "not_found" as const };

      const soleLeader = await soleLeaderOrganizationNames(tx, userId);
      if (soleLeader.length > 0) return { kind: "sole_leader_block" as const, organizationNames: soleLeader };

      const lostPosts = await tx.lostPost.findMany({ where: { userId }, select: { id: true } });
      const foundPosts = await tx.foundPost.findMany({ where: { userId }, select: { id: true } });
      const comments = await tx.comment.findMany({ where: { authorUserId: userId }, select: { id: true }, orderBy: { id: "desc" } });
      const messages = await tx.message.findMany({ where: { senderUserId: userId }, select: { id: true, content: true, imagePath: true } });
      const appealIds = (await tx.suspensionAppeal.findMany({ where: { userId }, select: { id: true } })).map((a) => a.id);
      const orgRoomIds = (
        await tx.chatRoom.findMany({ where: { initiatorUserId: userId, organizationId: { not: null } }, select: { id: true } })
      ).map((r) => r.id);
      const commentIds = comments.map((c) => c.id);
      const messageIds = messages.map((m) => m.id);

      const postTargetIds = [...lostPosts.map((p) => encodePostTargetId("lost", p.id)), ...foundPosts.map((p) => encodePostTargetId("found", p.id))];

      const pendingReports = await pendingReportsAbout(tx, userId);
      // Every report (any status) on this user's content, for the evidence rule.
      const allReports = await tx.report.findMany({
        where: {
          OR: [
            { targetType: ReportTargetType.POST, targetId: { in: postTargetIds } },
            { targetType: ReportTargetType.COMMENT, targetId: { in: commentIds } },
            { targetType: ReportTargetType.MESSAGE, targetId: { in: messageIds } },
          ],
        },
        select: { targetType: true, targetId: true, status: true, processedAt: true, createdAt: true },
      });
      const reportsOn = new Map<string, ReportFacts[]>();
      for (const r of allReports) {
        const k = reportKey(r.targetType, r.targetId);
        reportsOn.set(k, [...(reportsOn.get(k) ?? []), r]);
      }
      const evidenceNow = new Date();
      const isEvidence = (type: ReportTargetType, id: number) => {
        const reports = reportsOn.get(reportKey(type, id));
        return reports !== undefined && !evidenceReleased(reports, evidenceNow);
      };

      // ---- hold (only while a sanction matter is open) -- computed first,
      // so a missing secret aborts the whole withdrawal instead of letting
      // an open matter disappear.
      const reasons = await openHoldReasons(tx, user, pendingReports);
      if (reasons.length > 0) {
        await tx.withdrawnIdentity.create({
          data: {
            identityHmac: identityHmac(identitySubject(user)),
            keyVersion: CURRENT_IDENTITY_KEY_VERSION,
            withdrawnUserId: userId,
            reasons,
          },
        });
      }

      // ---- notifications
      await tx.notification.deleteMany({ where: { userId } });
      const rewrite = async (type: NotificationType, relatedType: string, ids: number[], content: string) => {
        if (ids.length > 0) await tx.notification.updateMany({ where: { type, relatedType, relatedId: { in: ids } }, data: { content } });
      };
      await rewrite(NotificationType.MESSAGE, "message", messageIds, `${WITHDRAWN_USER_LABEL}님이 메시지를 보냈습니다.`);
      await rewrite(NotificationType.COMMENT_REPLY, "comment", commentIds, `${WITHDRAWN_USER_LABEL}님이 회원님의 댓글에 답글을 남겼습니다.`);
      await rewrite(NotificationType.ORGANIZATION_CHAT_RECEIVED, "organization_chat_room", orgRoomIds, `${WITHDRAWN_USER_LABEL}님이 단체에 문의를 남겼습니다.`);
      await rewrite(NotificationType.SUSPENSION_APPEAL_RECEIVED, "suspension_appeal", appealIds, `${WITHDRAWN_USER_LABEL}님이 정지에 대해 이의를 제기했습니다.`);

      // ---- comments (newest first, so replies go before their parents)
      const now = new Date();
      for (const { id } of comments) {
        const comment = await tx.comment.findUnique({ where: { id }, select: { id: true, parentId: true, deletedAt: true } });
        if (!comment) continue; // already removed while walking up from a reply
        if (isEvidence(ReportTargetType.COMMENT, id)) {
          if (!comment.deletedAt) await tx.comment.update({ where: { id }, data: { deletedAt: now } });
          continue;
        }
        if (comment.deletedAt) {
          await tx.comment.deleteMany({ where: { id, replies: { none: {} } } });
          continue;
        }
        await removeCommentInTx(tx, comment);
      }

      // ---- posts
      const postUrls: string[] = [];
      const placeholderRoomIds: number[] = [];
      const posts: { kind: PostKind; id: number }[] = [
        ...lostPosts.map((p) => ({ kind: "lost" as const, id: p.id })),
        ...foundPosts.map((p) => ({ kind: "found" as const, id: p.id })),
      ];
      for (const { kind, id } of posts) {
        if (isEvidence(ReportTargetType.POST, encodePostTargetId(kind, id))) {
          if (kind === "lost") await tx.lostPost.update({ where: { id }, data: { removedAt: now } });
          else await tx.foundPost.update({ where: { id }, data: { removedAt: now } });
          continue;
        }
        const roomWhere = kind === "lost" ? { directLostPostId: id } : { directFoundPostId: id };
        placeholderRoomIds.push(...(await tx.chatRoom.findMany({ where: roomWhere, select: { id: true } })).map((r) => r.id));
        // Only other people's comments (or an evidence comment of this
        // user's, kept above) can be left at this point.
        const remainingComments = await tx.comment.count({ where: kind === "lost" ? { lostPostId: id } : { foundPostId: id } });
        if (remainingComments === 0) {
          postUrls.push(...((await deletePostRowInTx(tx, kind, id)) ?? []));
        } else {
          postUrls.push(...(await clearPostInTx(tx, kind, id, now)));
        }
      }
      if (placeholderRoomIds.length > 0) {
        await tx.chatRoom.updateMany({ where: { id: { in: placeholderRoomIds } }, data: { postTitle: WITHDRAWN_POST_TITLE } });
      }
      await tx.postView.deleteMany({
        where: {
          OR: [
            { viewerKey: `u:${userId}` },
            { postType: "lost", postId: { in: lostPosts.map((p) => p.id) } },
            { postType: "found", postId: { in: foundPosts.map((p) => p.id) } },
          ],
        },
      });

      // ---- chat
      await tx.messageReaction.deleteMany({ where: { userId } });
      await tx.chatRead.deleteMany({ where: { userId } });
      const chatPaths: string[] = [];
      for (const m of messages) {
        if (!m.imagePath || isEvidence(ReportTargetType.MESSAGE, m.id)) continue;
        chatPaths.push(m.imagePath);
        await tx.message.update({
          where: { id: m.id },
          data: { imagePath: null, ...(m.content.trim() === "" ? { content: WITHDRAWN_IMAGE_TEXT } : {}) },
        });
      }

      // ---- everything else that only belongs to this user
      await tx.keywordAlert.deleteMany({ where: { userId } });
      await tx.feedback.deleteMany({ where: { userId } });
      await tx.organizationMember.deleteMany({ where: { userId } });
      await tx.organizationJoinRequest.deleteMany({ where: { userId, status: OrganizationRequestStatus.PENDING } });
      await tx.organizationJoinRequest.updateMany({ where: { userId }, data: { message: null } });
      await tx.organizationCreationRequest.deleteMany({ where: { requestedByUserId: userId, status: OrganizationRequestStatus.PENDING } });
      await tx.organizationCreationRequest.updateMany({ where: { requestedByUserId: userId }, data: { contactEmail: "", purpose: "" } });
      await tx.rateLimitCounter.deleteMany({ where: { key: { contains: `:u:${userId}:` } } });
      // An approved outside account starts over: a new approval is needed.
      await tx.externalAccessGrant.deleteMany({ where: { email: normalizeEmail(user.email) } });

      // ---- the account itself: identifiers removed, row kept
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `withdrawn-${userId}@withdrawn.invalid`,
          name: WITHDRAWN_USER_LABEL,
          nickname: WITHDRAWN_USER_LABEL,
          googleId: null,
          publicId: randomUUID(),
          privacyConsentAt: null,
          termsAcceptedAt: null,
          termsVersion: null,
          lastLoginAt: null,
          nicknameChangeAvailableAt: null,
          isAdmin: false,
          deletedAt: user.deletedAt ?? now,
          withdrawnAt: now,
        },
      });

      return { kind: "ok" as const, held: reasons.length > 0, postUrls, chatPaths };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  if (result.kind !== "ok") return result;
  // Files go only after the commit (a rollback must not lose them).
  await deletePostStorageObjects(result.postUrls);
  await Promise.all(result.chatPaths.map((p) => deleteChatImageSafely(p)));
  return { kind: "ok", held: result.held };
}
