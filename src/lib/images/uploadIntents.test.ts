import { beforeEach, describe, expect, it, vi } from "vitest";

const intent = { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() };
const counts = { lostPost: vi.fn(), foundPost: vi.fn(), postImage: vi.fn(), message: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    uploadIntent: intent,
    lostPost: { count: counts.lostPost },
    foundPost: { count: counts.foundPost },
    postImage: { count: counts.postImage },
    message: { count: counts.message },
  },
}));
const removeChatImage = vi.fn<(path: string) => Promise<boolean>>(async () => true);
vi.mock("./chatStorage", () => ({ removeChatImage }));
const deletePostImagePaths = vi.fn<(paths: string[]) => Promise<boolean>>(async () => true);
vi.mock("./supabaseAdmin", () => ({ deletePostImagePaths, publicUrlFor: (p: string) => `https://x.supabase.co/storage/v1/object/public/post-images/${p}` }));

const { canOpenUpload, markUploadsAttached, sweepUnattachedUploads, OPEN_UPLOAD_CAP } = await import("./uploadIntents");

const POST_PATH = "posts/lost/7/0b8e1c4e-6a3b-4f53-9d43-8c7e2f9a1b2c.jpg";
const CHAT_PATH = "chat/3/1c8e1c4e-6a3b-4f53-9d43-8c7e2f9a1b2c.png";
const now = new Date("2026-11-22T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  for (const c of Object.values(counts)) c.mockResolvedValue(0);
});

describe("canOpenUpload (A-3)", () => {
  it("counts only open uploads of the last 24 hours, with a higher cap for staff", async () => {
    intent.count.mockResolvedValue(OPEN_UPLOAD_CAP.user - 1);
    expect(await canOpenUpload(5, "user", now)).toBe(true);
    expect(intent.count).toHaveBeenCalledWith({ where: { userId: 5, attachedAt: null, deletedAt: null, createdAt: { gt: new Date("2026-11-21T12:00:00Z") } } });
    intent.count.mockResolvedValue(OPEN_UPLOAD_CAP.user);
    expect(await canOpenUpload(5, "user", now)).toBe(false);
    expect(await canOpenUpload(5, "staff", now)).toBe(true);
  });
});

describe("markUploadsAttached (A-3)", () => {
  it("never throws: a missed mark is caught up by the sweep's reference check", async () => {
    intent.updateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(markUploadsAttached([POST_PATH])).resolves.toBeUndefined();
  });
});

describe("sweepUnattachedUploads (A-3)", () => {
  it("only looks at uploads still open a day after their URL was minted", async () => {
    intent.findMany.mockResolvedValue([]);
    await sweepUnattachedUploads(now);
    expect(intent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { attachedAt: null, deletedAt: null, createdAt: { lt: new Date("2026-11-21T12:00:00Z") } }, take: 200 }));
  });

  it("deletes an unreferenced upload in either bucket and records the deletion", async () => {
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images" }, { path: CHAT_PATH, bucket: "chat-images" }]);
    const result = await sweepUnattachedUploads(now);
    expect(deletePostImagePaths).toHaveBeenCalledWith([POST_PATH]);
    expect(removeChatImage).toHaveBeenCalledWith(CHAT_PATH);
    expect(intent.update).toHaveBeenCalledWith({ where: { path: POST_PATH }, data: { deletedAt: expect.any(Date) } });
    expect(result).toMatchObject({ examined: 2, deleted: 2, failed: 0 });
  });

  it("keeps a file some row references (post, gallery, or legacy chat URL) and marks it attached", async () => {
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images" }]);
    counts.postImage.mockResolvedValueOnce(1);
    const result = await sweepUnattachedUploads(now);
    expect(deletePostImagePaths).not.toHaveBeenCalled();
    expect(intent.update).toHaveBeenCalledWith({ where: { path: POST_PATH }, data: { attachedAt: expect.any(Date) } });
    expect(result).toMatchObject({ referenced: 1, deleted: 0 });
  });

  it("keeps a chat image a message uses", async () => {
    intent.findMany.mockResolvedValue([{ path: CHAT_PATH, bucket: "chat-images" }]);
    counts.message.mockResolvedValueOnce(1);
    await sweepUnattachedUploads(now);
    expect(removeChatImage).not.toHaveBeenCalled();
  });

  it("never deletes a path outside the app's naming scheme", async () => {
    intent.findMany.mockResolvedValue([{ path: "posts/lost/7/../../secret.jpg", bucket: "post-images" }, { path: "other/x.png", bucket: "chat-images" }]);
    const result = await sweepUnattachedUploads(now);
    expect(deletePostImagePaths).not.toHaveBeenCalled();
    expect(removeChatImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 2 });
  });

  it("does not record a deletion Storage did not confirm", async () => {
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images" }]);
    deletePostImagePaths.mockResolvedValueOnce(false);
    const result = await sweepUnattachedUploads(now);
    expect(intent.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, deleted: 0 });
  });
});
