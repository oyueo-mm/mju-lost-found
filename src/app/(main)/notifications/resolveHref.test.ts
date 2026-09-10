import { beforeEach, describe, expect, it, vi } from "vitest";

const getMessage = vi.fn();
const getChatRoomForUser = vi.fn();
const getCommentPostRef = vi.fn();
const getReportTargetRef = vi.fn();
const resolveMessageTarget = vi.fn();
const resolvePostTarget = vi.fn();
const getAnnouncement = vi.fn();
const getOrganizationById = vi.fn();

vi.mock("@/lib/chat/service", () => ({ getMessage, getChatRoomForUser }));
vi.mock("@/lib/comment/service", () => ({ getCommentPostRef }));
vi.mock("@/lib/report/service", () => ({ getReportTargetRef }));
vi.mock("@/lib/report/targets", () => ({ resolveMessageTarget, resolvePostTarget }));
vi.mock("@/lib/announcement/service", () => ({ getAnnouncement }));
vi.mock("@/lib/organization/service", () => ({ getOrganizationById }));

const { resolveHref } = await import("./resolveHref");

beforeEach(() => {
  vi.clearAllMocks();
});

// Phase J-2: the Match domain is gone, so no new relatedType="match"
// notification is ever created -- but historical rows can still exist and
// must still render (just without a link) rather than breaking the page.
describe("resolveHref -- legacy match notifications", () => {
  it("returns null for a historical match notification instead of throwing", async () => {
    expect(await resolveHref(1, "match", "match", 10)).toBeNull();
  });
});

// Phase M
describe("resolveHref -- announcement notifications", () => {
  it("links to the announcement detail page", async () => {
    getAnnouncement.mockResolvedValueOnce({ id: 42, title: "t", content: "c" });

    const href = await resolveHref(1, "announcement", "announcement", 42);

    expect(href).toBe("/announcements/42");
    expect(getAnnouncement).toHaveBeenCalledWith(42);
  });

  it("returns null (no crash) when the announcement was since deleted", async () => {
    getAnnouncement.mockResolvedValueOnce(null);

    expect(await resolveHref(1, "announcement", "announcement", 42)).toBeNull();
  });
});

// Phase 12-4 §28: ORGANIZATION_REQUEST_PROCESSED(가입 신청 승인/거절)
// notification -- relatedType="organization", relatedId는 조직 자체의 id.
describe("resolveHref -- organization join request notifications", () => {
  it("links to the organization profile page", async () => {
    getOrganizationById.mockResolvedValueOnce({ id: 10, name: "명지대학교 총학생회" });

    const href = await resolveHref(1, "ORGANIZATION_REQUEST_PROCESSED", "organization", 10);

    expect(href).toBe("/organizations/10");
    expect(getOrganizationById).toHaveBeenCalledWith(10);
  });

  it("returns null (no crash) when the organization was since deleted", async () => {
    getOrganizationById.mockResolvedValueOnce(null);
    expect(await resolveHref(1, "ORGANIZATION_REQUEST_PROCESSED", "organization", 10)).toBeNull();
  });
});

// Phase 11: message notifications -- relatedId is a Message id, resolved
// to its ChatRoom, with real access re-verified via getChatRoomForUser()
// (never trusted from the notification alone).
describe("resolveHref -- message notifications", () => {
  it("links to the chat room for a Direct-chat message notification", async () => {
    getMessage.mockResolvedValueOnce({ id: 100, chatRoomId: 200 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 200, roomType: "direct" } });

    const href = await resolveHref(1, "message", "message", 100);

    expect(href).toBe("/chat/200");
    expect(getMessage).toHaveBeenCalledWith(100);
    expect(getChatRoomForUser).toHaveBeenCalledWith(200, 1);
  });

  it("links to the chat room for a message notification in another room", async () => {
    getMessage.mockResolvedValueOnce({ id: 101, chatRoomId: 300 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 300, roomType: "direct" } });

    const href = await resolveHref(1, "message", "message", 101);

    expect(href).toBe("/chat/300");
  });

  it("returns null (safe fallback) when the message no longer exists", async () => {
    getMessage.mockResolvedValueOnce(null);

    const href = await resolveHref(1, "message", "message", 999);

    expect(href).toBeNull();
    expect(getChatRoomForUser).not.toHaveBeenCalled();
  });

  // Security-critical: this is what actually prevents a client from
  // reaching another user's room via a tampered/stale relatedId -- the
  // same getChatRoomForUser() authorization every other chat entry point
  // uses, re-run here regardless of what the notification claims.
  it("returns null when the current user isn't actually a participant of that room", async () => {
    getMessage.mockResolvedValueOnce({ id: 102, chatRoomId: 400 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "forbidden" });

    const href = await resolveHref(999, "message", "message", 102);

    expect(href).toBeNull();
  });

  it("returns null when the room itself no longer exists", async () => {
    getMessage.mockResolvedValueOnce({ id: 103, chatRoomId: 500 });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "not_found" });

    expect(await resolveHref(1, "message", "message", 103)).toBeNull();
  });
});

// Phase E-4: COMMENT_REPLY -- relatedId is the *reply* comment's own id.
describe("resolveHref -- comment_reply notifications", () => {
  it("links to the lost post with a #comment-{id} fragment", async () => {
    getCommentPostRef.mockResolvedValueOnce({ postId: 7, postType: "lost" });

    const href = await resolveHref(1, "comment_reply", "comment", 42);

    expect(href).toBe("/post/7?type=lost#comment-42");
    expect(getCommentPostRef).toHaveBeenCalledWith(42);
  });

  it("links to the found post with a #comment-{id} fragment", async () => {
    getCommentPostRef.mockResolvedValueOnce({ postId: 9, postType: "found" });

    const href = await resolveHref(1, "comment_reply", "comment", 43);

    expect(href).toBe("/post/9?type=found#comment-43");
  });

  it("returns null when the reply comment no longer exists", async () => {
    getCommentPostRef.mockResolvedValueOnce(null);
    expect(await resolveHref(1, "comment_reply", "comment", 999)).toBeNull();
  });
});

// Phase E-4: the four report-cluster types all share relatedType="report"
// and relatedId=Report.id -- `type` (the notification's own
// NotificationType) is what actually decides the destination and, for
// report_processed, which of the four Report.targetType branches applies.
describe("resolveHref -- report-cluster notifications", () => {
  describe("user_suspended", () => {
    it("links straight to /suspended, no DB lookup at all", async () => {
      const href = await resolveHref(1, "user_suspended", "report", 10);

      expect(href).toBe("/suspended");
      expect(getReportTargetRef).not.toHaveBeenCalled();
    });
  });

  describe("post_deleted", () => {
    it("always returns null, no DB lookup at all", async () => {
      const href = await resolveHref(1, "post_deleted", "report", 10);

      expect(href).toBeNull();
      expect(getReportTargetRef).not.toHaveBeenCalled();
    });
  });

  describe("message_hidden", () => {
    it("links to the chat room via the report's message target", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "message", targetId: 55 });
      resolveMessageTarget.mockResolvedValueOnce({ id: 55, senderUserId: 1, chatRoomId: 200 });
      getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 200 } });

      const href = await resolveHref(1, "message_hidden", "report", 10);

      expect(href).toBe("/chat/200");
      expect(getReportTargetRef).toHaveBeenCalledWith(10);
    });

    it("returns null for a chat room the current user isn't a participant of", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "message", targetId: 55 });
      resolveMessageTarget.mockResolvedValueOnce({ id: 55, senderUserId: 1, chatRoomId: 200 });
      getChatRoomForUser.mockResolvedValueOnce({ kind: "forbidden" });

      expect(await resolveHref(1, "message_hidden", "report", 10)).toBeNull();
    });

    it("returns null when the report itself no longer exists", async () => {
      getReportTargetRef.mockResolvedValueOnce(null);
      expect(await resolveHref(1, "message_hidden", "report", 999)).toBeNull();
    });
  });

  describe("report_processed", () => {
    it("routes to the reported post", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "post", targetId: 6 });
      resolvePostTarget.mockResolvedValueOnce({ postKind: "lost", id: 6, userId: 99 });

      const href = await resolveHref(1, "report_processed", "report", 10);

      expect(href).toBe("/post/6?type=lost");
      expect(resolvePostTarget).toHaveBeenCalledWith(6);
    });

    it("returns null when the reported post was itself deleted", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "post", targetId: 6 });
      resolvePostTarget.mockResolvedValueOnce(null);

      expect(await resolveHref(1, "report_processed", "report", 10)).toBeNull();
    });

    it("routes to the post a reported comment belongs to", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "comment", targetId: 42 });
      getCommentPostRef.mockResolvedValueOnce({ postId: 7, postType: "found" });

      const href = await resolveHref(1, "report_processed", "report", 10);

      expect(href).toBe("/post/7?type=found#comment-42");
      expect(getCommentPostRef).toHaveBeenCalledWith(42);
    });

    it("routes to the chat room a reported message belongs to", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "message", targetId: 55 });
      resolveMessageTarget.mockResolvedValueOnce({ id: 55, senderUserId: 2, chatRoomId: 300 });
      getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 300 } });

      const href = await resolveHref(1, "report_processed", "report", 10);

      expect(href).toBe("/chat/300");
    });

    it("returns null for a reported user target (no public profile page exists)", async () => {
      getReportTargetRef.mockResolvedValueOnce({ targetType: "user", targetId: 3 });

      expect(await resolveHref(1, "report_processed", "report", 10)).toBeNull();
      expect(resolvePostTarget).not.toHaveBeenCalled();
      expect(getCommentPostRef).not.toHaveBeenCalled();
    });

    it("returns null when the report itself no longer exists", async () => {
      getReportTargetRef.mockResolvedValueOnce(null);
      expect(await resolveHref(1, "report_processed", "report", 999)).toBeNull();
    });
  });

  // Security: getReportTargetRef is the only thing this file ever reads
  // off a Report row, and it must never be asked for (nor return) the
  // sensitive fields -- see report/service.test.ts's own coverage of
  // getReportTargetRef's actual `select`. This test only re-confirms the
  // call shape from resolveHref's side (id only, no extra args).
  it("only ever asks getReportTargetRef for the report id, nothing else", async () => {
    getReportTargetRef.mockResolvedValueOnce({ targetType: "post", targetId: 6 });
    resolvePostTarget.mockResolvedValueOnce({ postKind: "lost", id: 6, userId: 99 });

    await resolveHref(1, "report_processed", "report", 77);

    expect(getReportTargetRef).toHaveBeenCalledWith(77);
    expect(getReportTargetRef).toHaveBeenCalledTimes(1);
  });
});

describe("resolveHref -- other cases", () => {
  it("returns null for a null relatedId regardless of type", async () => {
    expect(await resolveHref(1, "comment_reply", "comment", null)).toBeNull();
    expect(await resolveHref(1, "message", "message", null)).toBeNull();
    expect(getCommentPostRef).not.toHaveBeenCalled();
    expect(getMessage).not.toHaveBeenCalled();
  });

  it("returns null for a relatedType this app has no link for", async () => {
    expect(await resolveHref(1, "match", "something_unknown", 10)).toBeNull();
  });

  it("returns null for a null relatedType", async () => {
    expect(await resolveHref(1, "match", null, 10)).toBeNull();
  });

  it("returns null for an unrecognized type within relatedType=report (safe default)", async () => {
    expect(await resolveHref(1, "some_future_report_type", "report", 10)).toBeNull();
    expect(getReportTargetRef).not.toHaveBeenCalled();
  });
});
