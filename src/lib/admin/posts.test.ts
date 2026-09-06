import { beforeEach, describe, expect, it, vi } from "vitest";

const listLostPosts = vi.fn();
const listFoundPosts = vi.fn();
const deleteLostPost = vi.fn();
const deleteFoundPost = vi.fn();

vi.mock("@/lib/posts/service", () => ({ listLostPosts, listFoundPosts, deleteLostPost, deleteFoundPost }));
// isAdmin() itself is a one-line check, but moderation/service.ts also
// pulls in report/service.ts/report/targets.ts -- mocked wholesale here,
// same convention admin/users.test.ts already uses for this collaborator.
vi.mock("@/lib/moderation/service", () => ({ isAdmin: (u: { isAdmin: boolean }) => u.isAdmin }));

const { deletePostForAdmin, listPostsForAdmin } = await import("./posts");

const admin = { id: 1, isAdmin: true };
const nonAdmin = { id: 2, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPostsForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await listPostsForAdmin(nonAdmin as never, { type: "lost", page: 1, limit: 20 });
    expect(result).toEqual({ kind: "forbidden" });
    expect(listLostPosts).not.toHaveBeenCalled();
    expect(listFoundPosts).not.toHaveBeenCalled();
  });

  it("dispatches to listLostPosts for type=lost, forwarding filters unchanged", async () => {
    listLostPosts.mockResolvedValueOnce({ items: [{ id: 1 }], page: 1, limit: 20, total: 1, totalPages: 1 });

    const result = await listPostsForAdmin(admin as never, {
      type: "lost",
      q: "우산",
      category: "전자기기",
      authorQuery: "닉네임",
      page: 1,
      limit: 20,
    });

    expect(listLostPosts).toHaveBeenCalledWith({
      q: "우산",
      category: "전자기기",
      authorQuery: "닉네임",
      page: 1,
      limit: 20,
    });
    expect(listFoundPosts).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "ok", data: { items: [{ id: 1 }], page: 1, limit: 20, total: 1, totalPages: 1 } });
  });

  it("dispatches to listFoundPosts for type=found", async () => {
    listFoundPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await listPostsForAdmin(admin as never, { type: "found", page: 1, limit: 20 });

    expect(listFoundPosts).toHaveBeenCalledOnce();
    expect(listLostPosts).not.toHaveBeenCalled();
  });
});

describe("deletePostForAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const result = await deletePostForAdmin(nonAdmin as never, "lost", 1);
    expect(result).toEqual({ kind: "forbidden" });
    expect(deleteLostPost).not.toHaveBeenCalled();
  });

  it("deletes a LostPost the admin doesn't own, via asAdmin: true", async () => {
    deleteLostPost.mockResolvedValueOnce({ kind: "ok", data: { id: 5 } });

    const result = await deletePostForAdmin(admin as never, "lost", 5);

    expect(deleteLostPost).toHaveBeenCalledWith(5, admin.id, { asAdmin: true });
    expect(result).toEqual({ kind: "ok", data: { id: 5 } });
  });

  it("deletes a FoundPost the admin doesn't own, via asAdmin: true", async () => {
    deleteFoundPost.mockResolvedValueOnce({ kind: "ok", data: { id: 9 } });

    const result = await deletePostForAdmin(admin as never, "found", 9);

    expect(deleteFoundPost).toHaveBeenCalledWith(9, admin.id, { asAdmin: true });
    expect(result).toEqual({ kind: "ok", data: { id: 9 } });
  });

  it("returns not_found when the target post doesn't exist", async () => {
    deleteLostPost.mockResolvedValueOnce({ kind: "not_found" });

    const result = await deletePostForAdmin(admin as never, "lost", 999);

    expect(result).toEqual({ kind: "not_found" });
  });
});
