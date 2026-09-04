import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const deleteMatch = vi.fn();

vi.mock("@/lib/match/http", async () => {
  const response = await import("@/lib/posts/response");
  const matchResponse = await import("@/lib/match/response");
  return { ...response, ...matchResponse, requireUserForApi };
});
vi.mock("@/lib/match/service", () => ({ deleteMatch }));

const { DELETE } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/matches/[id]", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await DELETE(new NextRequest("http://localhost/api/matches/1", { method: "DELETE" }), params("1"));

    expect(res.status).toBe(401);
    expect(deleteMatch).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent match", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteMatch.mockResolvedValueOnce({ kind: "not_found" });

    const res = await DELETE(new NextRequest("http://localhost/api/matches/999", { method: "DELETE" }), params("999"));

    expect(res.status).toBe(404);
  });

  it("rejects deleting a match the user isn't party to", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteMatch.mockResolvedValueOnce({ kind: "forbidden", reason: "not_owner" });

    const res = await DELETE(new NextRequest("http://localhost/api/matches/1", { method: "DELETE" }), params("1"));

    expect(res.status).toBe(403);
  });

  it("deletes the match for an authorized party", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    deleteMatch.mockResolvedValueOnce({ kind: "ok", data: { id: 1 } });

    const res = await DELETE(new NextRequest("http://localhost/api/matches/1", { method: "DELETE" }), params("1"));

    expect(res.status).toBe(200);
    expect(deleteMatch).toHaveBeenCalledWith(1, sessionUser.id);
  });
});
