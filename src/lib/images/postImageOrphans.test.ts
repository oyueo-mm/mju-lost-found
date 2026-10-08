import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ list, remove, getPublicUrl: (path: string) => ({ data: { publicUrl: `${PREFIX}${path}` } }) }));
vi.mock("@/lib/supabase/adminClient", () => ({ getSupabaseAdminClient: () => ({ storage: { from } }) }));

const postImage = { findMany: vi.fn() };
const lostPost = { findMany: vi.fn() };
const foundPost = { findMany: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { postImage, lostPost, foundPost } }));

const PREFIX = "https://project.supabase.co/storage/v1/object/public/post-images/";
const { selectPostImageOrphans, sweepPostImageOrphans } = await import("./postImageOrphans");

const NOW = new Date("2026-10-08T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

// 개인정보 감사: files left in the public post-images bucket after a failed
// delete or an abandoned upload.
describe("selectPostImageOrphans", () => {
  it("keeps referenced files, and only counts unreferenced ones older than the grace period", () => {
    const objects = [
      { path: "posts/lost/1/ref.webp", createdAt: new Date(hoursAgo(100)), size: 1 },
      { path: "posts/lost/2/old.webp", createdAt: new Date(hoursAgo(25)), size: 2 },
      { path: "posts/lost/3/new.webp", createdAt: new Date(hoursAgo(1)), size: 3 },
      { path: "posts/lost/4/unknown.webp", createdAt: null, size: 4 },
    ];
    const result = selectPostImageOrphans(objects, new Set(["posts/lost/1/ref.webp"]), NOW, 24);

    expect(result.orphans.map((o) => o.path)).toEqual(["posts/lost/2/old.webp"]);
    expect(result.recentUnreferenced.map((o) => o.path)).toEqual(["posts/lost/3/new.webp"]);
    expect(result.unknownAgeUnreferenced.map((o) => o.path)).toEqual(["posts/lost/4/unknown.webp"]);
  });
});

describe("sweepPostImageOrphans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    // posts/ -> lost/ -> 1/ (folders have no id) -> files
    list.mockImplementation(async (prefix: string) => {
      if (prefix === "") return { data: [{ name: "posts", id: null }], error: null };
      if (prefix === "posts") return { data: [{ name: "lost", id: null }], error: null };
      if (prefix === "posts/lost") return { data: [{ name: "1", id: null }], error: null };
      return {
        data: [
          { name: "cover.webp", id: "a", created_at: hoursAgo(48), metadata: { size: 10 } },
          { name: "gallery.webp", id: "b", created_at: hoursAgo(48), metadata: { size: 10 } },
          { name: "orphan.webp", id: "c", created_at: hoursAgo(48), metadata: { size: 10 } },
          { name: "uploading.webp", id: "d", created_at: hoursAgo(1), metadata: { size: 10 } },
        ],
        error: null,
      };
    });
    postImage.findMany.mockResolvedValue([{ imageUrl: `${PREFIX}posts/lost/1/gallery.webp` }]);
    lostPost.findMany.mockResolvedValue([{ imageUrl: `${PREFIX}posts/lost/1/cover.webp` }]);
    // A URL from another Supabase project is not this bucket's file.
    foundPost.findMany.mockResolvedValue([{ imageUrl: "https://other.supabase.co/storage/v1/object/public/post-images/x.webp" }]);
  });

  it("dry run: reports the orphan and deletes nothing", async () => {
    const result = await sweepPostImageOrphans({ apply: false, now: NOW });

    expect(result.objects).toBe(4);
    expect(result.referenced).toBe(2);
    expect(result.orphans.map((o) => o.path)).toEqual(["posts/lost/1/orphan.webp"]);
    expect(result.recentUnreferenced.map((o) => o.path)).toEqual(["posts/lost/1/uploading.webp"]);
    expect(remove).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
  });

  it("apply: deletes only the old unreferenced file", async () => {
    remove.mockResolvedValue({ data: [], error: null });

    const result = await sweepPostImageOrphans({ apply: true, now: NOW });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(["posts/lost/1/orphan.webp"]);
    expect(result).toMatchObject({ deleted: 1, failed: 0 });
  });
});
