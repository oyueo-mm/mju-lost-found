import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getChatImageForViewer = vi.fn();
const createChatImageSignedUrl = vi.fn();

vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({ getChatImageForViewer }));
vi.mock("@/lib/images/chatStorage", () => ({ createChatImageSignedUrl }));

const { GET } = await import("./route");

const viewer = { id: 1, nickname: "닉네임", isAdmin: false };
const call = (id: string, messageId: string) =>
  GET(new NextRequest(`http://localhost/api/chat/${id}/messages/${messageId}/image`), {
    params: Promise.resolve({ id, messageId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/chat/[id]/messages/[messageId]/image", () => {
  it("401 without a session, and never signs anything", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await call("1", "2");

    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(getChatImageForViewer).not.toHaveBeenCalled();
    expect(createChatImageSignedUrl).not.toHaveBeenCalled();
  });

  it("403 for a signed-in user who may not see this room", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: viewer });
    getChatImageForViewer.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await call("1", "2");

    expect(res.status).toBe(403);
    expect(createChatImageSignedUrl).not.toHaveBeenCalled();
  });

  it("404 when the message isn't in this room, has no image, or is hidden", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: viewer });
    getChatImageForViewer.mockResolvedValueOnce({ kind: "not_found" });

    const res = await call("1", "2");

    expect(res.status).toBe(404);
    expect(createChatImageSignedUrl).not.toHaveBeenCalled();
  });

  it("400 for non-numeric ids", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: viewer });

    const res = await call("abc", "2");

    expect(res.status).toBe(400);
    expect(getChatImageForViewer).not.toHaveBeenCalled();
  });

  it("checks access for exactly this room + message, then redirects to a short-lived signed URL that nothing may cache", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: viewer });
    getChatImageForViewer.mockResolvedValueOnce({ kind: "ok", path: "chat/1/a.webp" });
    createChatImageSignedUrl.mockResolvedValueOnce("https://storage.example/object/sign/chat-images/chat/1/a.webp?token=t");

    const res = await call("1", "2");

    expect(getChatImageForViewer).toHaveBeenCalledWith(1, 2, viewer);
    expect(createChatImageSignedUrl).toHaveBeenCalledWith("chat/1/a.webp");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example/object/sign/chat-images/chat/1/a.webp?token=t");
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
