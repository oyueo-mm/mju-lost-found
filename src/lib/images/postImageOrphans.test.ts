import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ list, remove, getPublicUrl: (path: string) => ({ data: { publicUrl: `${PREFIX}${path}` } }) }));
vi.mock("@/lib/supabase/adminClient", () => ({ getSupabaseAdminClient: () => ({ storage: { from } }) }));

const postImage = { findMany: vi.fn() };
const lostPost = { findMany: vi.fn() };
const foundPost = { findMany: vi.fn() };
const message = { findMany: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { postImage, lostPost, foundPost, message } }));

const PREFIX = "https://project.supabase.co/storage/v1/object/public/post-images/";
const { classifyMessageImageRefs, selectPostImageOrphans, sweepPostImageOrphans } = await import("./postImageOrphans");

const NOW = new Date("2026-10-08T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
// Real post-image names: posts/{lost|found}/{id}/{uuid}.{ext}.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const postPath = (id: number, n: number) => `posts/lost/${id}/${uuid(n)}.webp`;

// 개인정보 감사: files left in the public post-images bucket after a failed
// delete or an abandoned upload.
describe("selectPostImageOrphans", () => {
  it("keeps referenced files, and only counts unreferenced ones older than the grace period", () => {
    const objects = [
      { path: postPath(1, 1), createdAt: new Date(hoursAgo(100)), size: 1 },
      { path: postPath(2, 2), createdAt: new Date(hoursAgo(25)), size: 2 },
      { path: postPath(3, 3), createdAt: new Date(hoursAgo(1)), size: 3 },
      { path: postPath(4, 4), createdAt: null, size: 4 },
    ];
    const result = selectPostImageOrphans(objects, new Set([postPath(1, 1)]), NOW, 24);

    expect(result.orphans.map((o) => o.path)).toEqual([postPath(2, 2)]);
    expect(result.recentUnreferenced.map((o) => o.path)).toEqual([postPath(3, 3)]);
    expect(result.unknownAgeUnreferenced.map((o) => o.path)).toEqual([postPath(4, 4)]);
  });

  it("never selects a file that isn't named like this app's post images", () => {
    const old = new Date(hoursAgo(1000));
    const foreign = [
      ".emptyFolderPlaceholder",
      "posts/lost/.emptyFolderPlaceholder",
      "manual-upload.jpg",
      "posts/lost/1/not-a-uuid.webp",
      "posts/other/1/" + uuid(1) + ".webp",
      "posts/lost/1/" + uuid(1) + ".gif",
      "chat/12/" + uuid(2) + ".webp",
    ].map((path) => ({ path, createdAt: old, size: 1 }));
    const result = selectPostImageOrphans(foreign, new Set(), NOW, 24);

    expect(result.orphans).toEqual([]);
    expect(result.unrecognizedPath.map((o) => o.path)).toEqual(foreign.map((o) => o.path));
  });
});

describe("classifyMessageImageRefs", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  });

  it("protects legacy post-images URLs, ignores chat-images paths, and flags anything else", () => {
    const refs = classifyMessageImageRefs([
      null,
      `chat/12/${uuid(5)}.webp`,
      `${PREFIX}chat/3/${uuid(6)}.jpg`,
      `${PREFIX}${postPath(9, 7)}`,
      "https://other.supabase.co/storage/v1/object/public/post-images/x.webp",
      "something-else",
    ]);

    expect([...refs.postImagePaths]).toEqual([`chat/3/${uuid(6)}.jpg`, postPath(9, 7)]);
    expect(refs.chatImagePaths).toBe(1);
    expect(refs.unclassifiable).toBe(2);
  });
});

describe("sweepPostImageOrphans", () => {
  const COVER = postPath(1, 10);
  const GALLERY = postPath(1, 11);
  const ORPHAN = postPath(1, 12);
  const UPLOADING = postPath(1, 13);
  const LEGACY_CHAT_POST = postPath(1, 14); // a post-shaped file only a message points at

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    // posts/ -> lost/ -> 1/ (folders have no id) -> files
    list.mockImplementation(async (prefix: string) => {
      if (prefix === "") return { data: [{ name: "posts", id: null }, { name: ".emptyFolderPlaceholder", id: "p", created_at: hoursAgo(500) }], error: null };
      if (prefix === "posts") return { data: [{ name: "lost", id: null }], error: null };
      if (prefix === "posts/lost") return { data: [{ name: "1", id: null }], error: null };
      return {
        data: [COVER, GALLERY, ORPHAN, LEGACY_CHAT_POST].map((p, i) => ({ name: p.split("/").pop(), id: `f${i}`, created_at: hoursAgo(48), metadata: { size: 10 } })).concat([
          { name: UPLOADING.split("/").pop()!, id: "u", created_at: hoursAgo(1), metadata: { size: 10 } },
        ]),
        error: null,
      };
    });
    postImage.findMany.mockResolvedValue([{ imageUrl: `${PREFIX}${GALLERY}` }]);
    lostPost.findMany.mockResolvedValue([{ imageUrl: `${PREFIX}${COVER}` }]);
    // A URL from another Supabase project is not this bucket's file.
    foundPost.findMany.mockResolvedValue([{ imageUrl: "https://other.supabase.co/storage/v1/object/public/post-images/x.webp" }]);
    message.findMany.mockResolvedValue([{ imagePath: `chat/7/${uuid(20)}.webp` }, { imagePath: `${PREFIX}${LEGACY_CHAT_POST}` }]);
  });

  it("dry run: reports the orphan and deletes nothing", async () => {
    const result = await sweepPostImageOrphans({ apply: false, now: NOW });

    expect(result.objects).toBe(6);
    expect(result.referenced).toBe(3);
    expect(result.orphans.map((o) => o.path)).toEqual([ORPHAN]);
    expect(result.recentUnreferenced.map((o) => o.path)).toEqual([UPLOADING]);
    expect(result.unrecognizedPath.map((o) => o.path)).toEqual([".emptyFolderPlaceholder"]);
    expect(result.messageRefs).toEqual({ postImagePaths: 1, chatImagePaths: 1, unclassifiable: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it("apply: deletes only the old unreferenced post image -- never a normal image, a legacy chat image or a foreign file", async () => {
    remove.mockResolvedValue({ data: [], error: null });

    const result = await sweepPostImageOrphans({ apply: true, now: NOW });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([ORPHAN]);
    expect(result).toMatchObject({ deleted: 1, failed: 0 });
  });

  it("apply: refuses to delete anything while a Message.image_url value can't be classified", async () => {
    message.findMany.mockResolvedValue([{ imagePath: "https://cdn.example.com/legacy.jpg" }]);

    await expect(sweepPostImageOrphans({ apply: true, now: NOW })).rejects.toThrow(/Refusing to delete/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("dry run still reports when a Message.image_url value can't be classified", async () => {
    message.findMany.mockResolvedValue([{ imagePath: "https://cdn.example.com/legacy.jpg" }]);

    const result = await sweepPostImageOrphans({ apply: false, now: NOW });

    expect(result.messageRefs.unclassifiable).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
