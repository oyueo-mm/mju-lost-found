import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();
const from = vi.fn(() => ({ uploadToSignedUrl }));
const createClient = vi.fn(() => ({ storage: { from } }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { uploadToSignedUrl: uploadFn } = await import("./supabaseBrowser");

function makeFile(): File {
  return new File([new Uint8Array(4)], "test.jpg", { type: "image/jpeg" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("uploadToSignedUrl", () => {
  it("uploads to the post-images bucket at the given path/token", async () => {
    uploadToSignedUrl.mockResolvedValueOnce({ data: { path: "posts/lost/1/x.jpg" }, error: null });

    await uploadFn("posts/lost/1/x.jpg", "tok", makeFile());

    expect(from).toHaveBeenCalledWith("post-images");
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      "posts/lost/1/x.jpg",
      "tok",
      expect.any(File),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
  });

  it("throws when Supabase reports an upload failure", async () => {
    uploadToSignedUrl.mockResolvedValueOnce({ data: null, error: { message: "token expired" } });

    await expect(uploadFn("posts/lost/1/x.jpg", "tok", makeFile())).rejects.toBeTruthy();
  });

  // 이미지 업로드 최적화 Phase: 이제 File뿐 아니라 client.ts의
  // optimizeImageForUpload()가 만들어내는 순수 Blob(WebP로 재인코딩된
  // 결과, File이 아님)도 그대로 넘길 수 있어야 한다 -- File은 이미
  // Blob이므로 위 테스트는 그대로 통과하지만, 이 테스트는 File이 아닌
  // 일반 Blob에 대해서도 blob.type이 contentType으로 정확히 전달됨을
  // 별도로 고정한다.
  it("accepts a plain Blob (not just File) and uses its own type as contentType", async () => {
    uploadToSignedUrl.mockResolvedValueOnce({ data: { path: "posts/lost/1/x.webp" }, error: null });
    const blob = new Blob([new Uint8Array(4)], { type: "image/webp" });

    await uploadFn("posts/lost/1/x.webp", "tok", blob);

    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      "posts/lost/1/x.webp",
      "tok",
      blob,
      expect.objectContaining({ contentType: "image/webp" }),
    );
  });
});
