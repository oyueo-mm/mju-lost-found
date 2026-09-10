import { getChatRoomForUser, getMessage } from "@/lib/chat/service";
import { getCommentPostRef } from "@/lib/comment/service";
import { getReportTargetRef } from "@/lib/report/service";
import { resolveMessageTarget, resolvePostTarget } from "@/lib/report/targets";
import { getAnnouncement } from "@/lib/announcement/service";
import { getOrganizationById } from "@/lib/organization/service";

// Resolves a notification's relatedType/relatedId into a link to navigate
// to, when there's something to link to. Kept out of
// src/lib/notification/service.ts on purpose (Phase 9 spec section 16):
// that service has no dependency on the chat/comment/report domains, and
// this function needs all of them -- so it lives here, one
// level up, imported by the page. Split into its own module (rather than
// inlined in page.tsx) so it can be unit-tested directly, same convention
// as this app's other route-local logic (see (auth)/onboarding/
// actions.ts + actions.test.ts).
//
// A missing/deleted related resource yields no link; the notification
// itself still renders normally either way -- this never throws.
//
// Phase E-4: `type` (the notification's own NotificationType, e.g.
// "message_hidden") was added because relatedType alone can't tell four
// of the seven types apart -- REPORT_PROCESSED/POST_DELETED/
// MESSAGE_HIDDEN/USER_SUSPENDED all share relatedType="report" and
// relatedId=Report.id (verified against the actual notification-creation
// code, not assumed -- see moderation/service.ts), but mean completely
// different things and go to completely different audiences (the
// reporter vs. the person who was sanctioned).
export async function resolveHref(
  userId: number,
  type: string | null,
  relatedType: string | null,
  relatedId: number | null,
): Promise<string | null> {
  if (relatedId === null) return null;

  // Phase J-2: relatedType "match" (NotificationType.MATCH) is no longer
  // produced -- the Match domain is gone. Historical rows can still exist,
  // and fall through to the final `return null` below: the notification
  // still renders, it just carries no link, same as any other
  // no-longer-resolvable target.

  // Phase M: relatedId is the Announcement's own id. No ownership/
  // membership check needed the way message/report links require --
  // getAnnouncement() is a public read (see that function's own comment),
  // same posture as resolvePostTarget's post links below. Returns null
  // (no crash, notification still renders) if the announcement was since
  // deleted -- same graceful-degradation precedent as the "match" case
  // just above.
  if (relatedType === "announcement") {
    const announcement = await getAnnouncement(relatedId);
    return announcement ? `/announcements/${announcement.id}` : null;
  }

  // Phase 12-4 §28: ORGANIZATION_REQUEST_PROCESSED (가입 신청 승인/거절)의
  // relatedType. Creation-request 알림(Phase 12-3, relatedType =
  // "organization_creation_request")과는 값이 다르다 -- 그쪽은 아직 이 함수가
  // 지원하지 않아 최종 return null로 떨어지고, 이번 가입 신청 알림은 단체
  // 자체(/organizations/[id])로 바로 연결한다는 최소 변경만 추가한다.
  // getOrganizationById는 인증/멤버십 여부와 무관한 공개 조회(단체 목록/
  // 프로필 페이지와 동일한 posture)이므로 별도 권한 재검증이 필요 없다.
  if (relatedType === "organization") {
    const organization = await getOrganizationById(relatedId);
    return organization ? `/organizations/${organization.id}` : null;
  }

  if (relatedType === "message") {
    // Phase 11: relatedId here is a Message id (see chat/service.ts's
    // sendMessage(), never a ChatRoom id) -- resolve it to the room, then
    // re-derive real access through the *same* authorization
    // getChatRoomForUser() already enforces everywhere else in the chat
    // domain (see the Phase 11 report's "권한/보안 검증" section). This
    // is the security-relevant part: even a tampered/stale relatedId can
    // never produce a link into a room this user isn't actually a
    // participant of, because that check runs again here regardless of
    // what the notification claims.
    const message = await getMessage(relatedId);
    if (!message) return null; // message (and likely its notification) no longer exists
    const room = await getChatRoomForUser(message.chatRoomId, userId);
    return room.kind === "ok" ? `/chat/${room.data.id}` : null;
  }

  if (relatedType === "comment") {
    // COMMENT_REPLY -- relatedId is the *reply* comment's own id (see
    // comment/service.ts's createComment(): `relatedId: created.id`,
    // never the parent's id). The #comment-{id} fragment relies purely on
    // the browser's native anchor scroll (see CommentSection.tsx's
    // matching `id={`comment-${comment.id}`}` on every comment card, both
    // top-level and reply) -- no client-side JS needed for this.
    const ref = await getCommentPostRef(relatedId);
    return ref ? `/post/${ref.postId}?type=${ref.postType}#comment-${relatedId}` : null;
  }

  if (relatedType === "report") {
    // USER_SUSPENDED needs no DB lookup at all -- it's always about the
    // current session user's own standing, and this app already has a
    // dedicated page for exactly that (see (auth)/suspended/page.tsx),
    // which itself reads the live isCurrentlySuspended() state rather
    // than trusting anything this link implies.
    if (type === "user_suspended") return "/suspended";

    // POST_DELETED means the post is gone by definition (that's the
    // sanction) -- resolvePostTarget would always return null here, so
    // skip the DB round-trip entirely rather than proving the obvious.
    if (type === "post_deleted") return null;

    if (type === "message_hidden") {
      // Phase E-4 security note: getReportTargetRef selects only
      // targetType/targetId -- never reporterUserId/reason/detail/
      // adminNote -- so resolving this link can never leak who filed the
      // report to the sanctioned user reading their own MESSAGE_HIDDEN
      // notification.
      const target = await getReportTargetRef(relatedId);
      // Defensive, not assumed: this Report's own targetType should
      // always be "message" for a MESSAGE_HIDDEN notification (that's
      // the only action applyReportAction() ever pairs with it), but this
      // re-checks rather than trusting the NotificationType label alone.
      if (!target || target.targetType !== "message") return null;
      const message = await resolveMessageTarget(target.targetId);
      if (!message) return null;
      const room = await getChatRoomForUser(message.chatRoomId, userId);
      return room.kind === "ok" ? `/chat/${room.data.id}` : null;
    }

    if (type === "report_processed") {
      // Reporter-facing: routes back to whatever they originally
      // reported (they already know what that was -- this exposes
      // nothing they didn't already have). Same narrow-select
      // getReportTargetRef as above.
      const target = await getReportTargetRef(relatedId);
      if (!target) return null;

      if (target.targetType === "post") {
        const post = await resolvePostTarget(target.targetId);
        return post ? `/post/${post.id}?type=${post.postKind}` : null;
      }
      if (target.targetType === "comment") {
        const ref = await getCommentPostRef(target.targetId);
        return ref ? `/post/${ref.postId}?type=${ref.postType}#comment-${target.targetId}` : null;
      }
      if (target.targetType === "message") {
        // The reporter of a message report is guaranteed (by D-2's own
        // room-membership check in createReport()) to have been a
        // participant of that room -- re-verified here regardless, same
        // "never trust the notification alone" rule as the plain
        // relatedType === "message" branch above.
        const message = await resolveMessageTarget(target.targetId);
        if (!message) return null;
        const room = await getChatRoomForUser(message.chatRoomId, userId);
        return room.kind === "ok" ? `/chat/${room.data.id}` : null;
      }
      // "user" target -- no public profile page exists in this app.
      return null;
    }

    // Phase 12-9 §2: admin-facing -- relatedId here is the Report's own
    // id (not a target ref), unlike the reporter-facing branches above.
    // /admin/reports/[id] re-checks isAdmin() itself (requireAdmin()),
    // same posture as every other admin link a notification can produce.
    if (type === "report_received") return `/admin/reports/${relatedId}`;

    return null;
  }

  // Phase 12-9 §2: admin-facing -- relatedId is the Feedback's own id.
  if (relatedType === "feedback" && type === "feedback_received") {
    return `/admin/feedback/${relatedId}`;
  }

  // Phase 12-9 §2: admin-facing -- relatedId is the SuspensionAppeal's own
  // id, but there's no per-appeal detail route (only the queue page, see
  // /admin/sanctions/page.tsx) -- links to the queue itself rather than
  // inventing a new route just for this link target.
  if (relatedType === "suspension_appeal" && type === "suspension_appeal_received") {
    return "/admin/sanctions";
  }

  return null;
}
