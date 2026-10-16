import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
// The view-count increment is raw SQL inside an interactive transaction
// (so Prisma never touches updated_at); `rows` is how many posts it hit.
let rows = 1;
const executeRaw = vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>>(async () => rows);
const lostPostUpdate = vi.fn();
const foundPostUpdate = vi.fn();
const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: executeRaw, postView: { create } }));
// [table, id] of each increment
const increments = () => executeRaw.mock.calls.map(([strings, id]) => [/UPDATE "(\w+)" SET "view_count" = "view_count" \+ 1 WHERE "id" = $/.exec(strings.join(""))?.[1], id]);

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
let userAgent: string | null = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet, set: cookieSet }),
  headers: async () => ({ get: (name: string) => (name === "user-agent" ? userAgent : null) }),
}));

vi.mock("node:crypto", () => ({ randomUUID: () => "anon-uuid-1" }));

const { recordPostViewAction } = await import("./views");

beforeEach(() => {
  vi.clearAllMocks();
  rows = 1;
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
    expect(increments()).toEqual([["LostPost", 1]]);
  });

  it("사용자 A가 다시 게시글 1을 봄 -> 변화 없음", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce({ id: 99, postType: "lost", postId: 1, viewerKey: "u:1", viewedAt: new Date() });

    await recordPostViewAction("lost", 1);

    expect(create).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("사용자 A가 게시글 2를 봄 -> +1 (별도 게시글은 별도로 카운트)", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("lost", 2);

    expect(findUnique).toHaveBeenCalledWith({
      where: { postType_postId_viewerKey: { postType: "lost", postId: 2, viewerKey: "u:1" } },
    });
    expect(increments()).toEqual([["LostPost", 2]]);
  });

  it("사용자 B가 게시글 1을 봄 -> +1 (다른 사용자는 독립적으로 카운트)", async () => {
    getCurrentUser.mockResolvedValue({ id: 2 });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("lost", 1);

    expect(findUnique).toHaveBeenCalledWith({
      where: { postType_postId_viewerKey: { postType: "lost", postId: 1, viewerKey: "u:2" } },
    });
    expect(create).toHaveBeenCalledWith({ data: { postType: "lost", postId: 1, viewerKey: "u:2" } });
    expect(increments()).toEqual([["LostPost", 1]]);
  });

  it("does not re-count after any amount of time -- no time window, unlike the pre-Phase-L behavior", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
    findUnique.mockResolvedValueOnce({ id: 99, postType: "lost", postId: 1, viewerKey: "u:1", viewedAt: longAgo });

    await recordPostViewAction("lost", 1);

    expect(create).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("increments FoundPost.viewCount for a found-board post", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null);

    await recordPostViewAction("found", 7);

    expect(create).toHaveBeenCalledWith({ data: { postType: "found", postId: 7, viewerKey: "u:1" } });
    expect(increments()).toEqual([["FoundPost", 7]]);
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
    expect(executeRaw).not.toHaveBeenCalled();
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

describe("recordPostViewAction -- crawlers", () => {
  it("never counts a crawler or a request without a User-Agent", async () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", null]) {
      userAgent = ua;
      await recordPostViewAction("lost", 1);
    }
    userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("recordPostViewAction -- 수정일 (updated_at) is not touched by views", () => {
  it("increments view_count with plain SQL only -- never through prisma.<post>.update (which stamps updated_at)", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null);
    await recordPostViewAction("found", 3);
    const sql = executeRaw.mock.calls[0][0].join("?");
    expect(sql).toBe(`UPDATE "FoundPost" SET "view_count" = "view_count" + 1 WHERE "id" = ?`);
    expect(sql).not.toMatch(/updated_at/);
    expect(lostPostUpdate).not.toHaveBeenCalled();
    expect(foundPostUpdate).not.toHaveBeenCalled();
  });

  it("counts several different viewers once each (one increment per new viewer)", async () => {
    for (const id of [1, 2, 3]) {
      getCurrentUser.mockResolvedValue({ id });
      findUnique.mockResolvedValueOnce(null);
      await recordPostViewAction("lost", 5);
    }
    getCurrentUser.mockResolvedValue({ id: 2 }); // viewer 2 again: already counted
    findUnique.mockResolvedValueOnce({ id: 7, postType: "lost", postId: 5, viewerKey: "u:2", viewedAt: new Date() });
    await recordPostViewAction("lost", 5);
    expect(increments()).toEqual([["LostPost", 5], ["LostPost", 5], ["LostPost", 5]]);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("records no view for a post that no longer exists (nothing incremented, nothing saved)", async () => {
    getCurrentUser.mockResolvedValue({ id: 1 });
    findUnique.mockResolvedValueOnce(null);
    rows = 0;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordPostViewAction("lost", 404)).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
