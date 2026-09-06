import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const getChatRoomForUser = vi.fn();
const createSignedUploadUrl = vi.fn();

vi.mock("@/lib/chat/http", async () => {
  const response = await import("@/lib/posts/response");
  const chatResponse = await import("@/lib/chat/response");
  return { ...response, ...chatResponse, requireUserForApi };
});
vi.mock("@/lib/chat/service", () => ({ getChatRoomForUser }));
vi.mock("@/lib/images/supabaseAdmin", () => ({ createSignedUploadUrl }));

const { POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chat/[id]/upload", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/upload", {
        method: "POST",
        body: JSON.stringify({ contentType: "image/jpeg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(401);
    expect(getChatRoomForUser).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an unsupported content type before ever checking room membership", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/upload", {
        method: "POST",
        body: JSON.stringify({ contentType: "application/pdf" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(400);
    expect(getChatRoomForUser).not.toHaveBeenCalled();
  });

  // The core requirement: "일반 사용자가 다른 채팅방에 이미지를 업로드하지 못하도록
  // 기존 채팅방 권한 검증을 유지한다" -- a user who isn't a participant of
  // this room (getChatRoomForUser returning anything but "ok") never gets
  // a signed upload URL, regardless of being logged in.
  it("rejects a user who isn't a participant of the chat room", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "forbidden" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/upload", {
        method: "POST",
        body: JSON.stringify({ contentType: "image/jpeg" }),
      }),
      params("1"),
    );

    expect(res.status).toBe(403);
    expect(getChatRoomForUser).toHaveBeenCalledWith(1, sessionUser.id);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent chat room the same way as forbidden (never leaks which)", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "not_found" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/999/upload", {
        method: "POST",
        body: JSON.stringify({ contentType: "image/jpeg" }),
      }),
      params("999"),
    );

    expect(res.status).toBe(403);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a signed upload URL for a real participant", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    getChatRoomForUser.mockResolvedValueOnce({ kind: "ok", data: { id: 1, roomType: "direct" } });
    createSignedUploadUrl.mockResolvedValueOnce({ path: "chat/1/uuid.jpg", token: "tok" });

    const res = await POST(
      new NextRequest("http://localhost/api/chat/1/upload", {
        method: "POST",
        body: JSON.stringify({ contentType: "image/jpeg" }),
      }),
      params("1"),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ path: "chat/1/uuid.jpg", token: "tok" });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(expect.stringMatching(/^chat\/1\//));
  });
});
