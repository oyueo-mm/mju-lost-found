import { describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const update = vi.fn();
const create = vi.fn();
const updateMany = vi.fn();
const findUniqueOrThrow = vi.fn();
const notificationDeleteMany = vi.fn();
// Phase 12-2: withdrawUser() now also locks/reads this user's own
// OrganizationMember(role=LEADER) rows before doing anything else -- see
// that function's own comment. $queryRaw defaults to "no leader
// memberships at all" (the overwhelmingly common case) so every existing
// test below is unaffected unless it explicitly sets these up.
const queryRaw = vi.fn();
const organizationFindUnique = vi.fn();
const organizationMemberCount = vi.fn();
// Same "run the callback against a fake tx object built from these same
// mocks" pattern as chat/service.test.ts's own $transaction mock --
// withdrawUser's tx.user.updateMany/findUniqueOrThrow are the exact same
// mock functions requireUserForApi-adjacent tests already assert against
// for the non-transactional recordPrivacyConsent above.
const $transaction = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({
    user: { updateMany, findUniqueOrThrow },
    notification: { deleteMany: notificationDeleteMany },
    organization: { findUnique: organizationFindUnique },
    organizationMember: { count: organizationMemberCount },
    $queryRaw: queryRaw,
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique, update, create, updateMany, findUniqueOrThrow }, $transaction },
}));

const { resolveOrCreateUser, recordPrivacyConsent, withdrawUser } = await import("./user");

queryRaw.mockResolvedValue([]);

describe("resolveOrCreateUser", () => {
  it("looks up an existing user by email (login) -- get-or-create, not duplicate-create", async () => {
    findUnique.mockResolvedValueOnce({
      id: 1,
      email: "existing@mju.ac.kr",
      nickname: "기존닉네임",
      deletedAt: null,
    });
    update.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr", nickname: "기존닉네임" });

    const user = await resolveOrCreateUser({
      email: "existing@mju.ac.kr",
      name: "Existing User",
      googleId: "google-sub-1",
    });

    expect(findUnique).toHaveBeenCalledWith({ where: { email: "existing@mju.ac.kr" } });
    // The existing row (with its already-set nickname) is what's updated,
    // not a fresh one -- the update branch, never create, runs for a row
    // that already exists.
    expect(create).not.toHaveBeenCalled();
    expect(user).toEqual({ id: 1, email: "existing@mju.ac.kr", nickname: "기존닉네임" });
  });

  it("creates a new user with a name fallback when Google reports no name", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: 2, email: "new@mju.ac.kr", nickname: null });

    await resolveOrCreateUser({ email: "new@mju.ac.kr", name: null, googleId: "google-sub-2" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "new@mju.ac.kr",
        name: "new", // falls back to the local part of the email
        googleId: "google-sub-2",
      }),
    });
  });

  it("records googleId on the update branch too, for a user re-linking/re-logging in", async () => {
    findUnique.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr", nickname: null, deletedAt: null });
    update.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr", nickname: null });

    await resolveOrCreateUser({
      email: "existing@mju.ac.kr",
      name: "Existing User",
      googleId: "google-sub-1",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ googleId: "google-sub-1" }),
      }),
    );
  });

  // Phase P-1: this function is only ever called from the jwt callback's
  // `account`-present branch (a real sign-in exchange), so stamping
  // lastLoginAt here is a true "last login", not "session still valid".
  it("stamps lastLoginAt on both the create and update branches", async () => {
    findUnique.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr", deletedAt: null });
    update.mockResolvedValueOnce({ id: 1, email: "existing@mju.ac.kr" });

    await resolveOrCreateUser({
      email: "existing@mju.ac.kr",
      name: "Existing User",
      googleId: "google-sub-1",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
    );

    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: 3, email: "brandnew@mju.ac.kr" });

    await resolveOrCreateUser({ email: "brandnew@mju.ac.kr", name: "New", googleId: "google-sub-3" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
    });
  });

  // Phase 비활성화: the entire point of this phase -- a previously
  // deactivated account (deletedAt set) signing back in with the same
  // Google account is reactivated in place, never re-created and never
  // stripped of its nickname/history.
  it("reactivates a deactivated user in place -- clears deletedAt, keeps nickname/history untouched", async () => {
    findUnique.mockResolvedValueOnce({
      id: 5,
      email: "returning@mju.ac.kr",
      nickname: "옛날닉네임",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    });
    update.mockResolvedValueOnce({ id: 5, email: "returning@mju.ac.kr", nickname: "옛날닉네임", deletedAt: null });

    const user = await resolveOrCreateUser({
      email: "returning@mju.ac.kr",
      name: "Returning User",
      googleId: "google-sub-5",
    });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ deletedAt: null }),
    });
    // nickname was never part of the update payload -- it's simply never
    // touched, so whatever it already was survives reactivation as-is.
    expect(update.mock.calls[0][0].data).not.toHaveProperty("nickname");
    expect(user.deletedAt).toBeNull();
  });

  it("does not touch deletedAt at all for a user who was never deactivated", async () => {
    findUnique.mockResolvedValueOnce({ id: 1, email: "active@mju.ac.kr", deletedAt: null });
    update.mockResolvedValueOnce({ id: 1, email: "active@mju.ac.kr", deletedAt: null });

    await resolveOrCreateUser({ email: "active@mju.ac.kr", name: "Active", googleId: "google-sub-1" });

    expect(update.mock.calls[0][0].data).not.toHaveProperty("deletedAt");
  });
});

describe("recordPrivacyConsent", () => {
  it("stamps privacyConsentAt with the server's own clock, only while it's still unset", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, privacyConsentAt: new Date() });

    await recordPrivacyConsent(5);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5, privacyConsentAt: null },
      data: { privacyConsentAt: expect.any(Date) },
    });
  });

  it("returns the fresh user row after recording consent", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, privacyConsentAt: new Date("2026-01-01T00:00:00Z") });

    const user = await recordPrivacyConsent(5);

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(user).toEqual({ id: 5, privacyConsentAt: new Date("2026-01-01T00:00:00Z") });
  });

  // Idempotent: a second call (double-submit, or hitting the API directly
  // after already consenting) must not overwrite the original consent
  // instant -- the where-clause's `privacyConsentAt: null` guard makes
  // updateMany match zero rows in that case, same "only if still unset"
  // pattern as onboarding/actions.ts's nickname write.
  it("does not overwrite an already-recorded consent timestamp", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const original = new Date("2025-06-01T00:00:00Z");
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, privacyConsentAt: original });

    const user = await recordPrivacyConsent(5);

    expect(user.privacyConsentAt).toEqual(original);
  });
});

describe("withdrawUser", () => {
  // Phase 비활성화: only deletedAt/isAdmin are ever written -- email,
  // googleId, name, and nickname are deliberately left untouched so the
  // same account can be reactivated later with all of its identity/history
  // intact (see resolveOrCreateUser's own reactivation branch).
  it("only sets deletedAt (and resets isAdmin) -- never touches email/googleId/name/nickname", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, deletedAt: new Date() });

    await withdrawUser(5);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5, deletedAt: null },
      data: {
        deletedAt: expect.any(Date),
        isAdmin: false,
      },
    });
  });

  // Notifications are private to this one user -- nobody else's data
  // references them, unlike everything else withdrawUser leaves alone
  // (posts/comments/messages/reports keep pointing at this id).
  it("deletes this user's own notifications when withdrawal actually happens", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrow.mockResolvedValueOnce({ id: 5, deletedAt: new Date() });

    await withdrawUser(5);

    expect(notificationDeleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
  });

  it("returns the fresh (deactivated) user row wrapped in an ok result, nickname intact", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    const deactivated = { id: 5, deletedAt: new Date("2026-01-01T00:00:00Z"), nickname: "기존닉네임" };
    findUniqueOrThrow.mockResolvedValueOnce(deactivated);

    const result = await withdrawUser(5);

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(result).toEqual({ kind: "ok", data: deactivated });
  });

  // Idempotent, same "only if still unset" guard as recordPrivacyConsent
  // above -- a second call must not touch an already-deactivated row again
  // (and, just as importantly, must not delete notifications a second
  // time either, since there's nothing left to deactivate).
  it("is a no-op (including no notification deletion) when already deactivated", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const alreadyDeactivated = { id: 5, deletedAt: new Date("2025-01-01T00:00:00Z") };
    findUniqueOrThrow.mockResolvedValueOnce(alreadyDeactivated);

    const result = await withdrawUser(5);

    expect(notificationDeleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "ok", data: alreadyDeactivated });
  });

  // Phase 12-2: the sole-LEADER block. queryRaw's default (set at the top
  // of this file) is "no leader memberships at all" -- every test above
  // this describe block never touches these mocks and is unaffected.
  describe("sole LEADER protection", () => {
    it("blocks withdrawal when the user is the sole LEADER of a still-ACTIVE organization", async () => {
      queryRaw.mockResolvedValueOnce([{ organizationId: 10 }]);
      organizationFindUnique.mockResolvedValueOnce({ name: "명지대학교 총학생회", status: "ACTIVE" });
      organizationMemberCount.mockResolvedValueOnce(1);

      const result = await withdrawUser(5);

      expect(result).toEqual({ kind: "sole_leader_block", organizationNames: ["명지대학교 총학생회"] });
      expect(updateMany).not.toHaveBeenCalled();
      expect(notificationDeleteMany).not.toHaveBeenCalled();
    });

    it("lists every organization this user is the sole LEADER of, not just the first", async () => {
      queryRaw.mockResolvedValueOnce([{ organizationId: 10 }, { organizationId: 20 }]);
      organizationFindUnique
        .mockResolvedValueOnce({ name: "총학생회", status: "ACTIVE" })
        .mockResolvedValueOnce({ name: "AI 동아리", status: "ACTIVE" });
      organizationMemberCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const result = await withdrawUser(5);

      expect(result).toEqual({ kind: "sole_leader_block", organizationNames: ["총학생회", "AI 동아리"] });
    });

    it("does not block when this user is a LEADER but not the only one", async () => {
      queryRaw.mockResolvedValueOnce([{ organizationId: 10 }]);
      organizationFindUnique.mockResolvedValueOnce({ name: "총학생회", status: "ACTIVE" });
      organizationMemberCount.mockResolvedValueOnce(2); // another LEADER exists
      updateMany.mockResolvedValueOnce({ count: 1 });
      findUniqueOrThrow.mockResolvedValueOnce({ id: 5, deletedAt: new Date() });

      const result = await withdrawUser(5);

      expect(result.kind).toBe("ok");
    });

    it("does not block when the sole-LEADER organization is already INACTIVE", async () => {
      queryRaw.mockResolvedValueOnce([{ organizationId: 10 }]);
      organizationFindUnique.mockResolvedValueOnce({ name: "해체된 동아리", status: "INACTIVE" });
      updateMany.mockResolvedValueOnce({ count: 1 });
      findUniqueOrThrow.mockResolvedValueOnce({ id: 5, deletedAt: new Date() });

      const result = await withdrawUser(5);

      expect(result.kind).toBe("ok");
      expect(organizationMemberCount).not.toHaveBeenCalled(); // 비활성 조직은 카운트할 필요조차 없음
    });

    it("locks this user's own LEADER rows before reading anything else (row lock ordering)", async () => {
      queryRaw.mockResolvedValueOnce([]);
      updateMany.mockResolvedValueOnce({ count: 1 });
      findUniqueOrThrow.mockResolvedValueOnce({ id: 5, deletedAt: new Date() });

      await withdrawUser(5);

      const queryRawOrder = queryRaw.mock.invocationCallOrder[0];
      const updateManyOrder = updateMany.mock.invocationCallOrder[0];
      expect(queryRawOrder).toBeLessThan(updateManyOrder);
    });
  });
});
