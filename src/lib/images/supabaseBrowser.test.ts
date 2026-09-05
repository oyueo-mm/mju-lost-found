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
});
