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
vi.mock("@/generated/prisma/client", () => ({
  NotificationType: {},
  OrganizationRequestStatus: {},
  ReportTargetType: { USER: "USER", POST: "POST", COMMENT: "COMMENT", MESSAGE: "MESSAGE" },
}));

const { clearPostInTx } = await import("./withdrawal");

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
