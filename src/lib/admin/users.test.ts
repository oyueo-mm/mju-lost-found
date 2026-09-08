import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
// Phase F-2: suspend now runs inside a $transaction alongside a
// notification.create -- mocked the same interactive-callback shape as
// comment/service.test.ts's own $transaction mock, handing the tx object
// back as { user, notification } (both point at the same spies this file
// already asserts against, so every pre-F-2 assertion on user.update stays
// valid unchanged).
const notification = { create: vi.fn() };
// Phase I: a direct suspend now also creates a ModerationAction row inside
// the same transaction (see admin/users.ts's own comment on why) -- added
// to the tx object alongside user/notification, same shape.
const moderationAction = { create: vi.fn() };
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user, notification, moderationAction }));
// Phase P-1: getUserDetailForAdmin's own count queries -- separate spies
// per table, same convention as the rest of this mock.
const lostPost = { count: vi.fn() };
const foundPost = { count: vi.fn() };
const comment = { count: vi.fn(), findMany: vi.fn() };
const report = { count: vi.fn() };

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user, notification, moderationAction, lostPost, foundPost, comment, report, $transaction },
}));
// isAdmin() is a one-line `return user.isAdmin` in moderation/service.ts,
// but that module also pulls in report/service.ts and report/targets.ts --
// mocked wholesale here (same convention other route/service tests in this
// project already use for a same-domain collaborator) so this test file
// only ever depends on what it actually exercises.
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));
// Same convention as comment/service.test.ts's own mock of this module --
// only the members this file actually exercises are stubbed.
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: { USER_SUSPENDED: "USER_SUSPENDED" },
  ModerationActionType: { SUSPEND_USER: "SUSPEND_USER" },
  ReportTargetType: { USER: "USER" },
}));

const { listUsersForAdmin, updateUserByAdmin, getUserDetailForAdmin } = await import("./users");

const admin = { id: 1, isAdmin: true };
const nonAdmin = { id: 2, isAdmin: false };

const baseRow = {
  id: 5,
  email: "target@mju.ac.kr",
  nickname: "대상유저",
  publicId: "11111111-2222-3333-4444-555555555555",
  isAdmin: false,
  isSuspended: false,
  suspendedUntil: null,
  createdAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listUsersForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await listUsersForAdmin(nonAdmin as never, { page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(user.findMany).not.toHaveBeenCalled();
  });

  it("lists users with pagination", async () => {
    user.findMany.mockResolvedValueOnce([baseRow]);
    user.count.mockResolvedValueOnce(1);

    const result = await listUsersForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe(5);
      expect(result.data.total).toBe(1);
    }
  });

  it("derives currentlySuspended from isCurrentlySuspended(), not the raw isSuspended flag", async () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    user.findMany.mockResolvedValueOnce([
      { ...baseRow, id: 1, isSuspended: false, suspendedUntil: null }, // never suspended
      { ...baseRow, id: 2, isSuspended: true, suspendedUntil: null }, // permanent
      { ...baseRow, id: 3, isSuspended: true, suspendedUntil: future }, // active timed
      { ...baseRow, id: 4, isSuspended: true, suspendedUntil: past }, // expired timed
    ]);
    user.count.mockResolvedValueOnce(4);

    const result = await listUsersForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const byId = Object.fromEntries(result.data.items.map((u) => [u.id, u]));
    expect(byId[1].currentlySuspended).toBe(false);
    expect(byId[2].currentlySuspended).toBe(true);
    expect(byId[3].currentlySuspended).toBe(true);
    // The expired-timed user's raw isSuspended flag stays true (sticky,
    // audit-preserving, see auth/suspension.ts) but currentlySuspended must
    // reflect that the suspension has actually lapsed.
    expect(byId[4].isSuspended).toBe(true);
    expect(byId[4].currentlySuspended).toBe(false);
  });

  it("searches by email/nickname when q is given", async () => {
    user.findMany.mockResolvedValueOnce([]);
    user.count.mockResolvedValueOnce(0);

    await listUsersForAdmin(admin as never, { q: "target", page: 1, limit: 20 });

    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { contains: "target", mode: "insensitive" } },
            { nickname: { contains: "target", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  // Phase L
  it("also matches an exact publicId when q is UUID-shaped", async () => {
    user.findMany.mockResolvedValueOnce([]);
    user.count.mockResolvedValueOnce(0);
    const uuid = "11111111-2222-3333-4444-555555555555";

    await listUsersForAdmin(admin as never, { q: uuid, page: 1, limit: 20 });

    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { contains: uuid, mode: "insensitive" } },
            { nickname: { contains: uuid, mode: "insensitive" } },
            { publicId: uuid },
          ],
        },
      }),
    );
  });

  it("never passes a non-UUID q through to a publicId filter (would raise a raw Postgres uuid-parse error)", async () => {
    user.findMany.mockResolvedValueOnce([]);
    user.count.mockResolvedValueOnce(0);

    await listUsersForAdmin(admin as never, { q: "not-a-real-uuid", page: 1, limit: 20 });

    const call = user.findMany.mock.calls[0][0];
    expect(call.where.OR).toHaveLength(2);
    expect(call.where.OR.some((c: object) => "publicId" in c)).toBe(false);
  });

  it("includes publicId on every returned row", async () => {
    user.findMany.mockResolvedValueOnce([baseRow]);
    user.count.mockResolvedValueOnce(1);

    const result = await listUsersForAdmin(admin as never, { page: 1, limit: 20 });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.items[0].publicId).toBe(baseRow.publicId);
  });
});

describe("updateUserByAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await updateUserByAdmin(nonAdmin as never, 5, "promote");
    expect(result).toEqual({ kind: "forbidden" });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("blocks an admin from demoting themselves", async () => {
    const result = await updateUserByAdmin(admin as never, admin.id, "demote");
    expect(result).toEqual({ kind: "self" });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("blocks an admin from suspending themselves", async () => {
    const result = await updateUserByAdmin(admin as never, admin.id, "suspend");
    expect(result).toEqual({ kind: "self" });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("allows an admin to promote themselves (harmless, stays allowed)", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, id: admin.id });
    user.update.mockResolvedValueOnce({ ...baseRow, id: admin.id, isAdmin: true });

    const result = await updateUserByAdmin(admin as never, admin.id, "promote");

    expect(result.kind).toBe("ok");
    expect(user.update).toHaveBeenCalledWith({
      where: { id: admin.id },
      data: { isAdmin: true },
      include: { suspendedBy: { select: { nickname: true } } },
    });
  });

  it("returns not_found for a nonexistent target user", async () => {
    user.findUnique.mockResolvedValueOnce(null);
    const result = await updateUserByAdmin(admin as never, 999, "promote");
    expect(result).toEqual({ kind: "not_found" });
  });

  it("promotes a user to admin", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: true });

    const result = await updateUserByAdmin(admin as never, 5, "promote");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isAdmin: true },
      include: { suspendedBy: { select: { nickname: true } } },
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.isAdmin).toBe(true);
  });

  it("demotes another admin", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, isAdmin: true });
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: false });

    const result = await updateUserByAdmin(admin as never, 5, "demote");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isAdmin: false },
      include: { suspendedBy: { select: { nickname: true } } },
    });
    expect(result.kind).toBe("ok");
  });

  it("suspends permanently when no duration is given", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: null });

    await updateUserByAdmin(admin as never, 5, "suspend", undefined, "욕설/비방", "반복적인 욕설");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isSuspended: true, suspendedUntil: null, suspendedByUserId: admin.id },
      include: { suspendedBy: { select: { nickname: true } } },
    });
    expect(notification.create).toHaveBeenCalledWith({
      data: {
        userId: 5,
        type: "USER_SUSPENDED",
        title: "계정 정지 안내",
        content: "계정이 영구 정지되었습니다.",
        relatedType: null,
        relatedId: null,
      },
    });
  });

  // Phase F-2: 1일/3일/7일/30일 all go through the exact same code path --
  // one representative duration (7) covers the branch; the option *list*
  // itself (moderation/schema.ts's SUSPEND_DURATION_DAY_OPTIONS) is what
  // actually changed, not this function's logic.
  it("suspends for a fixed duration when suspendDurationDays is given, with a matching notification", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      user.findUnique.mockResolvedValueOnce(baseRow);
      user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

      await updateUserByAdmin(admin as never, 5, "suspend", 7, "욕설/비방", "반복적인 욕설");

      const call = user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 5 });
      expect(call.data.isSuspended).toBe(true);
      expect(call.data.suspendedUntil).toEqual(new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000));
      expect(notification.create).toHaveBeenCalledWith({
        data: {
          userId: 5,
          type: "USER_SUSPENDED",
          title: "계정 정지 안내",
          content: "계정이 7일 정지되었습니다.",
          relatedType: null,
          relatedId: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("suspends for 1 day (shortest new preset)", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

    await updateUserByAdmin(admin as never, 5, "suspend", 1, "욕설/비방", "반복적인 욕설");

    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: "계정이 1일 정지되었습니다." }) }),
    );
  });

  it("suspends for a custom duration outside the fixed presets (e.g. 45 days)", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

    await updateUserByAdmin(admin as never, 5, "suspend", 45, "욕설/비방", "반복적인 욕설");

    const call = user.update.mock.calls[0][0];
    expect(call.data.suspendedUntil).toBeInstanceOf(Date);
    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: "계정이 45일 정지되었습니다." }) }),
    );
  });

  // Phase H-3
  it("exposes suspendedByNickname on the returned DTO from the suspendedBy include", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({
      ...baseRow,
      isSuspended: true,
      suspendedByUserId: admin.id,
      suspendedBy: { nickname: "관리자닉네임" },
    });

    const result = await updateUserByAdmin(admin as never, 5, "suspend", undefined, "욕설/비방", "반복적인 욕설");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.suspendedByNickname).toBe("관리자닉네임");
  });

  it("does not create a notification (or use $transaction) for promote/demote/unsuspend", async () => {
    user.findUnique.mockResolvedValueOnce(baseRow);
    user.update.mockResolvedValueOnce({ ...baseRow, isAdmin: true });

    await updateUserByAdmin(admin as never, 5, "promote");

    expect($transaction).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it("unsuspends a user, clearing suspendedUntil", async () => {
    user.findUnique.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: new Date() });
    user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: false, suspendedUntil: null });

    await updateUserByAdmin(admin as never, 5, "unsuspend");

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { isSuspended: false, suspendedUntil: null, suspendedByUserId: null },
      include: { suspendedBy: { select: { nickname: true } } },
    });
  });

  // Phase I section 2/3.
  describe("required suspend reason", () => {
    it("rejects a suspend with neither reasonCategory nor reason, without touching the DB", async () => {
      const result = await updateUserByAdmin(admin as never, 5, "suspend");

      expect(result).toEqual({ kind: "reason_required" });
      expect(user.findUnique).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
    });

    it("rejects a suspend with only reasonCategory and a blank detail", async () => {
      const result = await updateUserByAdmin(admin as never, 5, "suspend", undefined, "욕설/비방", "   ");
      expect(result).toEqual({ kind: "reason_required" });
    });

    it("rejects a suspend with only the detail and no category", async () => {
      const result = await updateUserByAdmin(admin as never, 5, "suspend", undefined, undefined, "상세 사유만 있음");
      expect(result).toEqual({ kind: "reason_required" });
    });

    it("does not require a reason for unsuspend/promote/demote", async () => {
      user.findUnique.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: new Date() });
      user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: false, suspendedUntil: null });

      const result = await updateUserByAdmin(admin as never, 5, "unsuspend");

      expect(result.kind).toBe("ok");
    });

    // Phase I section 3: a direct suspend now also records a
    // ModerationAction (reportId: null, since there's no Report behind a
    // direct suspend) -- this is the one existing gap the phase's own spec
    // called out ("기존 report 기반 정지와 직접 사용자 정지 모두 사유를 기록할
    // 수 있도록 통합한다").
    it("creates a ModerationAction with reportId: null, the category, and the trimmed detail", async () => {
      user.findUnique.mockResolvedValueOnce(baseRow);
      user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true, suspendedUntil: null });

      await updateUserByAdmin(admin as never, 5, "suspend", undefined, "욕설/비방", "  반복적인 욕설  ");

      expect(moderationAction.create).toHaveBeenCalledWith({
        data: {
          reportId: null,
          targetType: "USER",
          targetId: 5,
          actionType: "SUSPEND_USER",
          reason: "반복적인 욕설",
          reasonCategory: "욕설/비방",
          adminUserId: admin.id,
          expiresAt: null,
        },
      });
    });

    it("stamps the ModerationAction's expiresAt to match the computed suspendedUntil for a timed suspension", async () => {
      const start = new Date("2026-01-01T00:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(start);
      try {
        user.findUnique.mockResolvedValueOnce(baseRow);
        user.update.mockResolvedValueOnce({ ...baseRow, isSuspended: true });

        await updateUserByAdmin(admin as never, 5, "suspend", 7, "욕설/비방", "반복적인 욕설");

        const call = moderationAction.create.mock.calls[0][0];
        expect(call.data.expiresAt).toEqual(new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("getUserDetailForAdmin", () => {
    it("rejects a non-admin caller", async () => {
      const result = await getUserDetailForAdmin(nonAdmin as never, 5);
      expect(result).toEqual({ kind: "forbidden" });
      expect(user.findUnique).not.toHaveBeenCalled();
    });

    it("returns not_found for a missing target user", async () => {
      user.findUnique.mockResolvedValueOnce(null);

      const result = await getUserDetailForAdmin(admin as never, 999);

      expect(result).toEqual({ kind: "not_found" });
    });

    it("returns grouped detail info, including counts and lastLoginAt, for a real target user", async () => {
      user.findUnique.mockResolvedValueOnce({
        ...baseRow,
        name: "홍길동",
        googleId: "google-sub-5",
        lastLoginAt: new Date("2026-02-01T00:00:00.000Z"),
      });
      lostPost.count.mockResolvedValueOnce(2);
      foundPost.count.mockResolvedValueOnce(1);
      comment.count.mockResolvedValueOnce(4);
      report.count.mockResolvedValueOnce(3); // reportsFiledCount
      report.count.mockResolvedValueOnce(1); // reportsAgainstCount
      comment.findMany.mockResolvedValueOnce([]);

      const result = await getUserDetailForAdmin(admin as never, 5);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data).toEqual(
        expect.objectContaining({
          name: "홍길동",
          googleLinked: true,
          lastLoginAt: new Date("2026-02-01T00:00:00.000Z"),
          lostPostCount: 2,
          foundPostCount: 1,
          commentCount: 4,
          reportsFiledCount: 3,
          reportsAgainstCount: 1,
        }),
      );
      expect(result.data.user.id).toBe(5);
      // Reports-against-this-user query targets the user directly (no
      // sign-encoding, unlike a post target) -- see report/targets.ts's
      // resolveUserTarget.
      expect(report.count).toHaveBeenNthCalledWith(2, { where: { targetType: "USER", targetId: 5 } });
    });

    it("reports googleLinked as false when the user never linked a Google account", async () => {
      user.findUnique.mockResolvedValueOnce({ ...baseRow, name: "홍길동", googleId: null, lastLoginAt: null });
      lostPost.count.mockResolvedValueOnce(0);
      foundPost.count.mockResolvedValueOnce(0);
      comment.count.mockResolvedValueOnce(0);
      report.count.mockResolvedValueOnce(0);
      report.count.mockResolvedValueOnce(0);
      comment.findMany.mockResolvedValueOnce([]);

      const result = await getUserDetailForAdmin(admin as never, 5);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.googleLinked).toBe(false);
      expect(result.data.lastLoginAt).toBeNull();
    });

    it("includes the target user's own comments (via listCommentsByUser), not just a count", async () => {
      user.findUnique.mockResolvedValueOnce({ ...baseRow, name: "홍길동", googleId: "google-sub-5", lastLoginAt: null });
      lostPost.count.mockResolvedValueOnce(0);
      foundPost.count.mockResolvedValueOnce(0);
      comment.count.mockResolvedValueOnce(1);
      report.count.mockResolvedValueOnce(0);
      report.count.mockResolvedValueOnce(0);
      comment.findMany.mockResolvedValueOnce([
        {
          id: 42,
          content: "댓글 내용",
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
          parentId: null,
          lostPost: { id: 7, title: "지갑 찾아요" },
          foundPost: null,
          parent: null,
        },
      ]);

      const result = await getUserDetailForAdmin(admin as never, 5);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.data.comments).toEqual([
        expect.objectContaining({ id: 42, content: "댓글 내용", post: { id: 7, type: "lost", title: "지갑 찾아요" } }),
      ]);
      // listCommentsByUser queries by the *target* user's id, not the admin's.
      expect(comment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { authorUserId: 5 } }));
    });
  });
});
