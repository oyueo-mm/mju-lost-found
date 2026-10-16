import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { compareForSort } = await import("./service");

// type=all merges two boards in memory with the same order the DB uses.
const post = (id: number, day: number, viewCount: number, commentCount: number) => ({
  id,
  createdAt: new Date(Date.UTC(2026, 9, day)),
  viewCount,
  commentCount,
});
const rows = [post(1, 1, 5, 0), post(2, 3, 9, 2), post(3, 2, 9, 7), post(4, 3, 0, 2), post(5, 3, 9, 2)];
const order = (sort: Parameters<typeof compareForSort>[0]) => [...rows].sort(compareForSort(sort)).map((r) => r.id);

describe("게시판 정렬 (type=all merge)", () => {
  it("orders by views or comments, ties newest first then by id", () => {
    expect(order("views")).toEqual([5, 2, 3, 1, 4]);
    expect(order("comments")).toEqual([3, 5, 4, 2, 1]);
  });
  it("keeps latest / oldest", () => {
    expect(order("latest")).toEqual([5, 4, 2, 3, 1]);
    expect(order(undefined)).toEqual([5, 4, 2, 3, 1]);
    expect(order("oldest")).toEqual([1, 3, 2, 4, 5]);
  });
});
