import { beforeEach, describe, expect, it, vi } from "vitest";

const intent = { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() };
const counts = { lostPost: vi.fn(), foundPost: vi.fn(), postImage: vi.fn(), message: vi.fn() };
const owners = { lostPost: vi.fn(), foundPost: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    uploadIntent: intent,
    lostPost: { count: counts.lostPost, findUnique: owners.lostPost },
    foundPost: { count: counts.foundPost, findUnique: owners.foundPost },
    postImage: { count: counts.postImage },
    message: { count: counts.message },
  },
}));
const removeChatImage = vi.fn<(path: string) => Promise<boolean>>(async () => true);
vi.mock("./chatStorage", () => ({ removeChatImage }));
const deletePostImagePaths = vi.fn<(paths: string[]) => Promise<boolean>>(async () => true);
vi.mock("./supabaseAdmin", () => ({ deletePostImagePaths, publicUrlFor: (p: string) => `https://x.supabase.co/storage/v1/object/public/post-images/${p}` }));

const { canOpenUpload, markUploadsAttached, sweepUnattachedUploads, sweepModeFromEnv, OPEN_UPLOAD_CAP, SWEEP_MAX_DELETES_PER_RUN } = await import("./uploadIntents");

const POST_PATH = "posts/lost/7/0b8e1c4e-6a3b-4f53-9d43-8c7e2f9a1b2c.jpg";
const CHAT_PATH = "chat/3/1c8e1c4e-6a3b-4f53-9d43-8c7e2f9a1b2c.png";
const now = new Date("2026-11-22T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  for (const c of Object.values(counts)) c.mockResolvedValue(0);
  // the post in POST_PATH (lost 7) belongs to the uploader (user 11)
  owners.lostPost.mockResolvedValue({ userId: 11 });
  owners.foundPost.mockResolvedValue({ userId: 11 });
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
    await sweepUnattachedUploads(now, 200, "delete");
    expect(intent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { attachedAt: null, deletedAt: null, createdAt: { lt: new Date("2026-11-21T12:00:00Z") } }, take: 200 }));
  });

  it("deletes an unreferenced upload in either bucket and records the deletion", async () => {
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images", userId: 11 }, { path: CHAT_PATH, bucket: "chat-images", userId: 11 }]);
    const result = await sweepUnattachedUploads(now, 200, "delete");
    expect(deletePostImagePaths).toHaveBeenCalledWith([POST_PATH]);
    expect(removeChatImage).toHaveBeenCalledWith(CHAT_PATH);
    expect(intent.update).toHaveBeenCalledWith({ where: { path: POST_PATH }, data: { deletedAt: expect.any(Date) } });
    expect(result).toMatchObject({ examined: 2, deleted: 2, failed: 0 });
  });

  it("keeps a file some row references (post, gallery, or legacy chat URL) and marks it attached", async () => {
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images", userId: 11 }]);
    counts.postImage.mockResolvedValueOnce(1);
    const result = await sweepUnattachedUploads(now, 200, "delete");
    expect(deletePostImagePaths).not.toHaveBeenCalled();
    expect(intent.update).toHaveBeenCalledWith({ where: { path: POST_PATH }, data: { attachedAt: expect.any(Date) } });
    expect(result).toMatchObject({ referenced: 1, deleted: 0 });
  });

  it("keeps a chat image a message uses", async () => {
    intent.findMany.mockResolvedValue([{ path: CHAT_PATH, bucket: "chat-images", userId: 11 }]);
    counts.message.mockResolvedValueOnce(1);
    await sweepUnattachedUploads(now, 200, "delete");
    expect(removeChatImage).not.toHaveBeenCalled();
  });

  it("never deletes a path outside the app's naming scheme", async () => {
    intent.findMany.mockResolvedValue([{ path: "posts/lost/7/../../secret.jpg", bucket: "post-images", userId: 11 }, { path: "other/x.png", bucket: "chat-images", userId: 11 }]);
    const result = await sweepUnattachedUploads(now, 200, "delete");
    expect(deletePostImagePaths).not.toHaveBeenCalled();
    expect(removeChatImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: 2 });
  });

  it("does not record a deletion Storage did not confirm", async () => {
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images", userId: 11 }]);
    deletePostImagePaths.mockResolvedValueOnce(false);
    const result = await sweepUnattachedUploads(now, 200, "delete");
    expect(intent.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, deleted: 0 });
  });

  it("by default (no UPLOAD_SWEEP_MODE=delete) only reports: no Storage call, no row written", async () => {
    expect(sweepModeFromEnv({})).toBe("dry-run");
    expect(sweepModeFromEnv({ UPLOAD_SWEEP_MODE: "delete" })).toBe("delete");
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images", userId: 11 }, { path: CHAT_PATH, bucket: "chat-images", userId: 11 }]);
    counts.message.mockResolvedValueOnce(1); // the chat image is referenced
    const result = await sweepUnattachedUploads(now, 200, "dry-run");
    expect(deletePostImagePaths).not.toHaveBeenCalled();
    expect(removeChatImage).not.toHaveBeenCalled();
    expect(intent.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: "dry-run", examined: 2, wouldDelete: 1, referenced: 1, deleted: 0, halted: null });
  });

  it("halts the whole run on a post whose owner is not the uploader -- nothing is deleted", async () => {
    owners.lostPost.mockResolvedValueOnce({ userId: 99 });
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images", userId: 11 }, { path: CHAT_PATH, bucket: "chat-images", userId: 11 }]);
    const result = await sweepUnattachedUploads(now, 200, "delete");
    expect(deletePostImagePaths).not.toHaveBeenCalled();
    expect(removeChatImage).not.toHaveBeenCalled();
    expect(intent.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ownershipMismatch: 1, halted: "ownership_mismatch", deleted: 0 });
  });

  it("halts when a run would delete more files than is normal", async () => {
    intent.findMany.mockResolvedValue(Array.from({ length: SWEEP_MAX_DELETES_PER_RUN + 1 }, (_, i) => ({ path: `chat/3/${String(i).padStart(8, "0")}-6a3b-4f53-9d43-8c7e2f9a1b2c.png`, bucket: "chat-images", userId: 11 })));
    const result = await sweepUnattachedUploads(now, 500, "delete");
    expect(removeChatImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ halted: "too_many_candidates", deleted: 0, wouldDelete: SWEEP_MAX_DELETES_PER_RUN + 1 });
  });

  it("a post that no longer exists does not block removing its never-attached upload", async () => {
    owners.lostPost.mockResolvedValueOnce(null);
    intent.findMany.mockResolvedValue([{ path: POST_PATH, bucket: "post-images", userId: 11 }]);
    const result = await sweepUnattachedUploads(now, 200, "delete");
    expect(deletePostImagePaths).toHaveBeenCalledWith([POST_PATH]);
    expect(result).toMatchObject({ deleted: 1, halted: null });
  });
});
