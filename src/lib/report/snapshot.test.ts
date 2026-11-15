import { beforeEach, describe, expect, it, vi } from "vitest";

const report = { update: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { report } }));
const copyToEvidence = vi.fn(async () => true);
const removeReportEvidence = vi.fn(async () => true);
vi.mock("./evidenceStorage", async () => {
  const actual = await vi.importActual<typeof import("./evidenceStorage")>("./evidenceStorage");
  return { evidencePathFor: actual.evidencePathFor, parseEvidencePath: actual.parseEvidencePath, copyToEvidence, removeReportEvidence };
});
const PUBLIC = "https://proj.supabase.co/storage/v1/object/public/post-images/";
vi.mock("@/lib/images/supabaseAdmin", () => ({
  pathnameFromPublicUrl: (url: string) => (url.startsWith(PUBLIC) ? url.slice(PUBLIC.length) : null),
}));

const { captureTarget, preserveEvidenceImages, purgeReportSnapshot, readSnapshot } = await import("./snapshot");
const { evidencePathFor, parseEvidencePath } = await import("./evidenceStorage");

const UUID = "11111111-1111-1111-1111-111111111111";
const at = new Date("2026-11-15T03:00:00Z");
const fn = <T>(value: T) => vi.fn(async () => value);

function tx(overrides: Record<string, unknown> = {}) {
  const gallery = overrides.postImage as { findMany?: () => Promise<unknown[]> } | undefined;
  return {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join("").includes('"PostImage"') ? await gallery?.findMany?.() ?? [] : []),
    lostPost: { findUnique: fn(null) },
    foundPost: { findUnique: fn(null) },
    postImage: { findMany: fn([]) },
    message: { findUnique: fn(null) },
    comment: { findUnique: fn(null) },
    thankNote: { findUnique: fn(null) },
    user: { findUnique: fn(null) },
    ...overrides,
  } as never;
}

const lostPost = {
  id: 5, userId: 2, title: "지갑", description: "검은 지갑", category: "지갑", location: "도서관", campus: "인문캠퍼스",
  status: "SEARCHING", imageUrl: null, createdAt: at, updatedAt: at, user: { nickname: "작성자" },
};

beforeEach(() => vi.clearAllMocks());

describe("captureTarget", () => {
  it("captures a lost post's text, author and every gallery image in display order", async () => {
    const t = tx({
      lostPost: { findUnique: fn(lostPost) },
      postImage: { findMany: fn([{ imageUrl: `${PUBLIC}posts/lost/5/${UUID}.jpg` }, { imageUrl: `${PUBLIC}posts/lost/5/${UUID.replace(/1/g, "2")}.webp` }]) },
    });
    const captured = await captureTarget(t, "post", 5);
    expect(captured?.snapshot).toMatchObject({
      v: 1,
      subjectUserId: 2,
      target: { kind: "post", postKind: "lost", postId: 5, title: "지갑", description: "검은 지갑", status: "찾는 중", createdAt: at.toISOString() },
      images: [],
    });
    expect(captured?.sources).toEqual([
      { bucket: "post-images", path: `posts/lost/5/${UUID}.jpg` },
      { bucket: "post-images", path: `posts/lost/5/${UUID.replace(/1/g, "2")}.webp` },
    ]);
  });

  it("reads a negative post target id as a found post and falls back to its single imageUrl", async () => {
    const found = { ...lostPost, id: 9, status: "KEEPING", imageUrl: `${PUBLIC}posts/found/9/${UUID}.png` };
    const t = tx({ foundPost: { findUnique: fn(found) } });
    const captured = await captureTarget(t, "post", -9);
    expect(captured?.snapshot.target).toMatchObject({ kind: "post", postKind: "found", postId: 9, status: "보관 중" });
    expect(captured?.sources).toEqual([{ bucket: "post-images", path: `posts/found/9/${UUID}.png` }]);
  });

  it("marks a foreign (legacy Blob) image URL as uncopyable without keeping the URL", async () => {
    const t = tx({ lostPost: { findUnique: fn({ ...lostPost, imageUrl: "https://x.public.blob.vercel-storage.com/a.jpg" }) } });
    const captured = await captureTarget(t, "post", 5);
    expect(captured?.sources).toEqual([{ bucket: "post-images", path: null }]);
    expect(JSON.stringify(captured?.snapshot)).not.toContain("blob.vercel-storage");
  });

  it("captures a chat message with its image path only when the path names the message's own room", async () => {
    const message = { id: 3, chatRoomId: 4, senderUserId: 6, content: "욕설", imagePath: `chat/4/${UUID}.jpg`, createdAt: at, editedAt: null, hiddenAt: null, sender: { nickname: "보낸이" } };
    const captured = await captureTarget(tx({ message: { findUnique: fn(message) } }), "message", 3);
    expect(captured?.snapshot).toMatchObject({ subjectUserId: 6, target: { kind: "message", chatRoomId: 4, content: "욕설", hidden: false } });
    expect(captured?.sources).toEqual([{ bucket: "chat-images", path: `chat/4/${UUID}.jpg` }]);

    const other = await captureTarget(tx({ message: { findUnique: fn({ ...message, imagePath: `chat/5/${UUID}.jpg` }) } }), "message", 3);
    expect(other?.sources).toEqual([{ bucket: "chat-images", path: null }]);
  });

  it("captures comments, thank notes and users without images", async () => {
    const comment = { id: 1, authorUserId: 2, lostPostId: null, foundPostId: 8, parentId: null, content: "댓글", createdAt: at, updatedAt: at, author: { nickname: "a" } };
    expect((await captureTarget(tx({ comment: { findUnique: fn(comment) } }), "comment", 1))?.snapshot).toMatchObject({
      subjectUserId: 2, target: { kind: "comment", postType: "found", postId: 8, content: "댓글" },
    });
    const note = { id: 1, senderUserId: 3, body: "고마워요", tags: ["kind"], createdAt: at, sender: { nickname: "s" }, receiver: { nickname: "r" } };
    expect((await captureTarget(tx({ thankNote: { findUnique: fn(note) } }), "thank_note", 1))?.snapshot).toMatchObject({
      subjectUserId: 3, target: { kind: "thank_note", body: "고마워요", tags: ["kind"] },
    });
    const captured = await captureTarget(tx({ user: { findUnique: fn({ id: 4, nickname: "닉" }) } }), "user", 4);
    expect(captured).toEqual({ snapshot: { v: 1, subjectUserId: 4, target: { kind: "user", nickname: "닉" }, images: [] }, sources: [] });
  });

  it("returns null when the target vanished", async () => {
    expect(await captureTarget(tx(), "post", 5)).toBeNull();
    expect(await captureTarget(tx(), "message", 5)).toBeNull();
  });
});

describe("preserveEvidenceImages", () => {
  const base = { v: 1, subjectUserId: 2, target: { kind: "user" as const, nickname: null }, images: [] };

  it("copies each image into reports/{id}/{index}.{ext} and records the outcome", async () => {
    copyToEvidence.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const snapshot = await preserveEvidenceImages(42, {
      snapshot: base,
      sources: [
        { bucket: "post-images", path: `posts/lost/5/${UUID}.jpg` },
        { bucket: "chat-images", path: `chat/4/${UUID}.webp` },
        { bucket: "post-images", path: null },
      ],
    });
    expect(copyToEvidence).toHaveBeenNthCalledWith(1, "post-images", `posts/lost/5/${UUID}.jpg`, "reports/42/0.jpg");
    expect(copyToEvidence).toHaveBeenNthCalledWith(2, "chat-images", `chat/4/${UUID}.webp`, "reports/42/1.webp");
    expect(snapshot.images).toEqual([
      { index: 0, source: "post", status: "copied", path: "reports/42/0.jpg" },
      { index: 1, source: "chat", status: "failed", path: null, retryPath: `chat/4/${UUID}.webp` },
      { index: 2, source: "post", status: "unsupported", path: null },
    ]);
    expect(report.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { targetSnapshot: snapshot } });
  });

  it("never throws when saving the outcome fails", async () => {
    report.update.mockRejectedValueOnce(new Error("db down"));
    await expect(preserveEvidenceImages(42, { snapshot: base, sources: [{ bucket: "post-images", path: `posts/lost/5/${UUID}.jpg` }] })).resolves.toBeTruthy();
  });
});

describe("purgeReportSnapshot", () => {
  it("removes the evidence first, then the snapshot (report row kept)", async () => {
    expect(await purgeReportSnapshot(7, at)).toBe(true);
    expect(removeReportEvidence).toHaveBeenCalledWith(7);
    expect(report.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { targetSnapshot: expect.anything(), snapshotPurgedAt: at } });
  });

  it("keeps the snapshot when the evidence couldn't be removed", async () => {
    removeReportEvidence.mockResolvedValueOnce(false);
    expect(await purgeReportSnapshot(7, at)).toBe(false);
    expect(report.update).not.toHaveBeenCalled();
  });
});

describe("readSnapshot / evidence paths", () => {
  it("accepts a stored snapshot and rejects anything malformed (old reports: null)", () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot([])).toBeNull();
    expect(readSnapshot({ v: 1, target: { kind: "user" } })).toBeNull();
    expect(readSnapshot({ v: 1, subjectUserId: 2, target: { kind: "user", nickname: "a" }, images: [{ index: 0, path: "reports/1/0.jpg" }, "x"] })).toEqual({
      v: 1, subjectUserId: 2, target: { kind: "user", nickname: "a" }, images: [{ index: 0, path: "reports/1/0.jpg" }],
    });
  });

  it("only ever builds or accepts reports/{id}/{index}.{jpg|png|webp}", () => {
    expect(evidencePathFor(3, 0, "jpeg")).toBe("reports/3/0.jpg");
    expect(evidencePathFor(3, 1, "gif")).toBeNull();
    expect(parseEvidencePath("reports/3/1.png")).toEqual({ reportId: 3, index: 1 });
    for (const bad of ["reports/3/../x.jpg", "chat/3/0.jpg", "reports/3/0.jpg/x", "/reports/3/0.jpg", "reports/x/0.jpg"]) {
      expect(parseEvidencePath(bad)).toBeNull();
    }
  });
});
