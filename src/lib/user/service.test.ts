import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const lostPostCount = vi.fn();
const foundPostCount = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique },
    lostPost: { count: lostPostCount },
    foundPost: { count: foundPostCount },
  },
}));

const { getPublicProfile } = await import("./service");

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  findUnique.mockReset();
  lostPostCount.mockReset();
  foundPostCount.mockReset();
});

describe("getPublicProfile", () => {
  it("returns null for a malformed publicId without ever querying the DB", async () => {
    // Phase H-7: publicId is a native `uuid` DB column -- a non-UUID string
    // passed straight to Prisma would raise a raw Postgres error instead of
    // a clean not-found, so this must be rejected before any query runs.
    const result = await getPublicProfile("not-a-uuid");

    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null when no user has this publicId", async () => {
    findUnique.mockResolvedValueOnce(null);

    const result = await getPublicProfile(VALID_UUID);

    expect(result).toBeNull();
    expect(lostPostCount).not.toHaveBeenCalled();
  });

  it("returns nickname/publicId/createdAt/userId and the combined lost+found post count", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    findUnique.mockResolvedValueOnce({ id: 7, publicId: VALID_UUID, nickname: "닉네임", createdAt });
    lostPostCount.mockResolvedValueOnce(2);
    foundPostCount.mockResolvedValueOnce(3);

    const result = await getPublicProfile(VALID_UUID);

    // Phase H-8: userId is included for listPostsByUser() to consume
    // server-side (see PublicProfileDTO's own comment) -- it's never
    // rendered, but it IS part of the returned data shape now.
    expect(result).toEqual({ publicId: VALID_UUID, nickname: "닉네임", createdAt, postCount: 5, userId: 7 });
    expect(lostPostCount).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(foundPostCount).toHaveBeenCalledWith({ where: { userId: 7 } });
  });

  // Never selects/returns email, googleId, isAdmin, isSuspended, etc --
  // this is a *public* profile lookup, unlike every other User read in
  // this app.
  it("only selects the public-safe fields from the User row", async () => {
    findUnique.mockResolvedValueOnce({ id: 7, publicId: VALID_UUID, nickname: null, createdAt: new Date() });
    lostPostCount.mockResolvedValueOnce(0);
    foundPostCount.mockResolvedValueOnce(0);

    await getPublicProfile(VALID_UUID);

    expect(findUnique).toHaveBeenCalledWith({
      where: { publicId: VALID_UUID },
      select: { id: true, publicId: true, nickname: true, createdAt: true },
    });
  });
});
