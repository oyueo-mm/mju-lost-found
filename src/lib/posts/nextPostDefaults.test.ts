import { beforeEach, describe, expect, it, vi } from "vitest";

const lostPost = { findFirst: vi.fn() };
const foundPost = { findFirst: vi.fn() };
vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost } }));

const { loadNextPostDefaults } = await import("./nextPostDefaults");

const orgs = [{ organizationId: 10 }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadNextPostDefaults", () => {
  it("carries over only the campus and 게시 주체 of the poster's own previous post", async () => {
    foundPost.findFirst.mockResolvedValueOnce({ campus: "자연캠퍼스", organizationId: 10 });

    expect(await loadNextPostDefaults("found", "5", 7, orgs)).toEqual({ campus: "자연캠퍼스", organizationId: 10 });
    expect(foundPost.findFirst).toHaveBeenCalledWith({
      where: { id: 5, userId: 7 },
      select: { campus: true, organizationId: true },
    });
    expect(lostPost.findFirst).not.toHaveBeenCalled();
  });

  it("drops an organization the poster can no longer post as", async () => {
    lostPost.findFirst.mockResolvedValueOnce({ campus: "인문캠퍼스", organizationId: 99 });

    expect(await loadNextPostDefaults("lost", "5", 7, orgs)).toEqual({ campus: "인문캠퍼스", organizationId: null });
  });

  it("returns nothing for someone else's post or a missing one", async () => {
    foundPost.findFirst.mockResolvedValueOnce(null);

    expect(await loadNextPostDefaults("found", "5", 7, orgs)).toBeNull();
  });

  it("ignores a missing or malformed ?after without querying", async () => {
    for (const param of [undefined, "", "abc", "-1", "0", "1.5", "99999999999999999999"]) {
      expect(await loadNextPostDefaults("found", param, 7, orgs)).toBeNull();
    }
    expect(foundPost.findFirst).not.toHaveBeenCalled();
  });
});
