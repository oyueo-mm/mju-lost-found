import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const lostPostUpdate = vi.fn();
const foundPostUpdate = vi.fn();
const $transaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    postView: { findUnique, create },
    lostPost: { update: lostPostUpdate },
    foundPost: { update: foundPostUpdate },
    $transaction,
  },
}));

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));

// Minimal fake cookie jar -- just enough for resolveViewerKey()'s
// get/set, same shape next/headers' real cookies() store exposes.
const cookieGet = vi.fn();
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet, set: cookieSet }),
}));

vi.mock("node:crypto", () => ({ randomUUID: () => "anon-uuid-1" }));

const { recordPostViewAction } = await import("./views");

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(null);
  cookieGet.mockReturnValue(undefined);
});

describe("recordPostViewAction -- signed-in viewers", () => {
  it("사용자 A가 게시글 1을 봄 -> +1", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null); // no prior view

    await recordPostViewAction("lost", 1);

    expect(findUnique).toHaveBeenCalledWith({
      where: { postType_postId_viewerKey: { postType: "lost", postId: 1, viewerKey: "u:1" } },
    });
    expect(create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 1, viewerKey: "u:1" } });
    expect(lostPostUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { viewCount: { increment: 1 } } });
  });

  it("사용자 A가 다시 게시글 1을 봄 -> 변화 없음", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce({ id: 99, postType: "lost", postId: 1, viewerKey: "u:1", viewedAt: new Date() });

    await recordPostViewAction("lost", 1);

    expect(create).not.toHaveBeenCalled();
    expect(lostPostUpdate).not.toHaveBeenCalled();
  });

  it("사용자 A가 게시글 2를 봄 -> +1 (별도 게시글은 별도로 카운트)", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("lost", 2);

    expect(findUnique).toHaveBeenCalledWith({
      where: { postType_postId_viewerKey: { postType: "lost", postId: 2, viewerKey: "u:1" } },
    });
    expect(lostPostUpdate).toHaveBeenCalledWith({ where: { id: 2 }, data: { viewCount: { increment: 1 } } });
  });

  it("사용자 B가 게시글 1을 봄 -> +1 (다른 사용자는 독립적으로 카운트)", async () => {
    getCurrentUser.mockResolvedValue({ id: 2 });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("lost", 1);

    expect(findUnique).toHaveBeenCalledWith({
      where: { postType_postId_viewerKey: { postType: "lost", postId: 1, viewerKey: "u:2" } },
    });
    expect(create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 1, viewerKey: "u:2" } });
    expect(lostPostUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { viewCount: { increment: 1 } } });
  });

  it("does not re-count after any amount of time -- no time window, unlike the pre-Phase-L behavior", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
    findUnique.mockResolvedValueOnce({ id: 99, postType: "lost", postId: 1, viewerKey: "u:1", viewedAt: longAgo });

    await recordPostViewAction("lost", 1);

    expect(create).not.toHaveBeenCalled();
    expect(lostPostUpdate).not.toHaveBeenCalled();
  });

  it("increments FoundPost.viewCount for a found-board post", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("found", 7);

    expect(create).toHaveBeenCalledWith({ data: { postType: "found", postId: 7, viewerKey: "u:1" } });
    expect(foundPostUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { viewCount: { increment: 1 } } });
    expect(lostPostUpdate).not.toHaveBeenCalled();
  });
});

describe("recordPostViewAction -- logged-out viewers", () => {
  it("mints a long-lived anon cookie and counts the first view", async () => {
    cookieGet.mockReturnValue(undefined);
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("lost", 1);

    expect(cookieSet).toHaveBeenCalledWith(
      "anon_uid",
      "anon-uuid-1",
      expect.objectContaining({ sameSite: "lax", path: "/" }),
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { postType_postId_viewerKey: { postType: "lost", postId: 1, viewerKey: "a:anon-uuid-1" } },
    });
    expect(create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 1, viewerKey: "a:anon-uuid-1" } });
  });

  it("reuses an existing anon cookie instead of minting a new one", async () => {
    cookieGet.mockReturnValue({ value: "existing-anon-id" });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("lost", 1);

    expect(cookieSet).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 1, viewerKey: "a:existing-anon-id" } });
  });

  it("does not increment on a repeat anon view", async () => {
    cookieGet.mockReturnValue({ value: "existing-anon-id" });
    findUnique.mockResolvedValueOnce({ id: 1, postType: "lost", postId: 1, viewerKey: "a:existing-anon-id", viewedAt: new Date() });

    await recordPostViewAction("lost", 1);

    expect(create).not.toHaveBeenCalled();
    expect(lostPostUpdate).not.toHaveBeenCalled();
  });
});

describe("recordPostViewAction -- failure handling", () => {
  it("swallows a concurrent duplicate-create race (unique constraint) without incrementing or throwing", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null); // both racers see no prior row
    $transaction.mockRejectedValueOnce(new Error("Unique constraint failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordPostViewAction("lost", 1)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("never throws back to the caller when the post was deleted mid-flight", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockRejectedValueOnce(new Error("post gone"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordPostViewAction("lost", 999)).resolves.toBeUndefined();

    errorSpy.mockRestore();
  });
});
