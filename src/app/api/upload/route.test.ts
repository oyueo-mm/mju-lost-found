import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const isCurrentlySuspended = vi.fn();
const getLostPost = vi.fn();
const getFoundPost = vi.fn();
const handleUpload = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/suspension", () => ({ isCurrentlySuspended }));
vi.mock("@/lib/posts/service", () => ({ getLostPost, getFoundPost }));
// Mocked wholesale (see route.test.ts elsewhere) so this never loads the
// real @/lib/posts/http.ts, which imports next-auth through
// @/lib/auth/session -- next-auth doesn't resolve under Vitest's plain
// Node ESM outside of Next's own bundler.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response };
});
vi.mock("@vercel/blob/client", () => ({ handleUpload }));

const { POST } = await import("./route");

const readyUser = { id: 1, nickname: "닉네임", isSuspended: false, suspendedUntil: null };

function requestWith(body: unknown) {
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function callOnBeforeGenerateToken(pathname: string) {
  let captured: ((p: string, c: string | null, m: boolean) => Promise<unknown>) | undefined;
  handleUpload.mockImplementationOnce(async (opts) => {
    captured = opts.onBeforeGenerateToken;
    return { type: "blob.generate-client-token", clientToken: "token" };
  });
  await POST(requestWith({ type: "blob.generate-client-token", payload: { pathname } }));
  return captured!(pathname, null, false);
}

beforeEach(() => {
  vi.clearAllMocks();
  isCurrentlySuspended.mockReturnValue(false);
});

describe("POST /api/upload", () => {
  it("rejects an unauthenticated upload request", async () => {
    getCurrentUser.mockResolvedValueOnce(null);

    await expect(callOnBeforeGenerateToken("posts/lost/1/11111111-1111-1111-1111-111111111111.jpg")).rejects.toThrow(
      "로그인이 필요합니다.",
    );
  });

  it("rejects an upload for a post the user doesn't own", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getLostPost.mockResolvedValueOnce({ author: { id: 999 } });

    await expect(
      callOnBeforeGenerateToken("posts/lost/1/11111111-1111-1111-1111-111111111111.jpg"),
    ).rejects.toThrow("본인 게시물에만");
  });

  it("rejects a malformed pathname", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);

    await expect(callOnBeforeGenerateToken("../../etc/passwd")).rejects.toThrow("잘못된 업로드 경로");
  });

  it("grants a token for the owner's own post", async () => {
    getCurrentUser.mockResolvedValueOnce(readyUser);
    getLostPost.mockResolvedValueOnce({ author: { id: 1 } });

    const result = (await callOnBeforeGenerateToken(
      "posts/lost/1/11111111-1111-1111-1111-111111111111.jpg",
    )) as { allowedContentTypes: string[]; maximumSizeInBytes: number };

    expect(result.allowedContentTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(result.maximumSizeInBytes).toBe(10 * 1024 * 1024);
  });
});
