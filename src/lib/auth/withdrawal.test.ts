import { describe, expect, it, vi } from "vitest";

const deletePostDerivedDataInTx = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/posts/service", () => ({
  deletePostDerivedDataInTx,
  deletePostRowInTx: vi.fn(),
  deletePostStorageObjects: vi.fn(),
}));
vi.mock("@/lib/images/chatStorage", () => ({ deleteChatImageSafely: vi.fn() }));
vi.mock("@/lib/auth/holdState", () => ({ openHoldReasons: vi.fn(), pendingReportsAbout: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ soleLeaderOrganizationNames: vi.fn() }));
vi.mock("@/lib/auth/withdrawnIdentity", () => ({
  CURRENT_IDENTITY_KEY_VERSION: 1,
  identityHmac: vi.fn(),
  identitySubject: vi.fn(),
}));
vi.mock("@/lib/comment/remove", () => ({ removeCommentInTx: vi.fn() }));
const deleteActivityMarks = vi.fn(async () => 0);
vi.mock("@/lib/metrics/record", () => ({ deleteActivityMarks }));
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: {},
  OrganizationRequestStatus: {},
  ReportTargetType: { USER: "USER", POST: "POST", COMMENT: "COMMENT", MESSAGE: "MESSAGE" },
}));

const { clearPostInTx, withdrawAccount } = await import("./withdrawal");
const { prisma } = (await import("@/lib/db/prisma")) as unknown as { prisma: Record<string, unknown> };
const holdState = await import("@/lib/auth/holdState");
const authUser = await import("@/lib/auth/user");

// 개인정보 감사: a withdrawn user's post that is kept as an emptied
// placeholder gets the same derived-data cleanup as a full delete.
describe("clearPostInTx", () => {
  function tx() {
    return {
      postImage: { findMany: vi.fn().mockResolvedValue([{ imageUrl: "https://x/a.jpg" }]), deleteMany: vi.fn() },
      lostPost: { findUnique: vi.fn().mockResolvedValue({ imageUrl: "https://x/cover.jpg" }), update: vi.fn() },
      foundPost: { findUnique: vi.fn().mockResolvedValue({ imageUrl: null }), update: vi.fn() },
      $executeRaw: vi.fn(),
    };
  }

  it("empties the post, drops its embeddings and its derived rows, and returns its Storage files", async () => {
    const t = tx();
    const urls = await clearPostInTx(t as never, "lost", 5, new Date("2026-10-08T00:00:00Z"));

    expect(t.lostPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ description: "", lostAt: null, lostDate: null }) }),
    );
    expect(t.$executeRaw).toHaveBeenCalledTimes(1);
    expect(deletePostDerivedDataInTx).toHaveBeenCalledWith(t, "lost", 5);
    expect(urls.sort()).toEqual(["https://x/a.jpg", "https://x/cover.jpg"]);
  });

  it("uses the found board for a found post", async () => {
    const t = tx();
    await clearPostInTx(t as never, "found", 9, new Date());

    expect(deletePostDerivedDataInTx).toHaveBeenCalledWith(t, "found", 9);
  });
});

// 회원탈퇴 also deletes the member's 이용 일자 기록 (ActivityDay), inside the
// same transaction and for this member only.
describe("withdrawAccount: 이용 일자 기록", () => {
  // Every model answers with "nothing there"; the user row exists.
  function fakeTx(user: Record<string, unknown>) {
    const empty = (model: string, method: string) =>
      method === "findMany" ? [] : method === "findUnique" ? (model === "user" ? user : null) : method === "count" ? 0 : { count: 0 };
    return new Proxy({} as Record<string, unknown>, {
      get: (_t, model: string) =>
        model === "$queryRaw" || model === "$executeRaw"
          ? async () => []
          : new Proxy({}, { get: (_m, method: string) => async () => empty(model, method) }),
    });
  }

  it("deletes this member's marks within the withdrawal transaction", async () => {
    const user = { id: 7, email: "a@mju.ac.kr", googleId: "g", deletedAt: null, withdrawnAt: null };
    const tx = fakeTx(user);
    prisma.$transaction = async (fn: (t: unknown) => unknown) => fn(tx);
    vi.mocked(authUser.soleLeaderOrganizationNames).mockResolvedValue([]);
    vi.mocked(holdState.pendingReportsAbout).mockResolvedValue([] as never);
    vi.mocked(holdState.openHoldReasons).mockResolvedValue([]);

    expect(await withdrawAccount(7)).toEqual({ kind: "ok", held: false });
    expect(deleteActivityMarks).toHaveBeenCalledTimes(1);
    const [db, ids] = deleteActivityMarks.mock.calls[0] as unknown as [unknown, number[]];
    expect(db).toBe(tx); // the transaction client, not the global one
    expect(ids).toEqual([7]);
  });

  it("deletes nothing when the withdrawal does not happen", async () => {
    deleteActivityMarks.mockClear();
    prisma.$transaction = async (fn: (t: unknown) => unknown) => fn(fakeTx({ id: 7, withdrawnAt: new Date() }));
    expect(await withdrawAccount(7)).toEqual({ kind: "not_found" });
    vi.mocked(authUser.soleLeaderOrganizationNames).mockResolvedValue(["단체"]);
    prisma.$transaction = async (fn: (t: unknown) => unknown) => fn(fakeTx({ id: 8, email: "b@mju.ac.kr", deletedAt: null, withdrawnAt: null }));
    expect(await withdrawAccount(8)).toEqual({ kind: "sole_leader_block", organizationNames: ["단체"] });
    expect(deleteActivityMarks).not.toHaveBeenCalled();
  });
});
