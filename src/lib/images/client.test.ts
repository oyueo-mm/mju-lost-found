import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();
const uploadChatImageToSignedUrl = vi.fn();
vi.mock("./supabaseBrowser", () => ({ uploadToSignedUrl, uploadChatImageToSignedUrl }));

const { ImageProcessingError, prepareImageForUpload, UploadRateLimitedError, uploadChatImage, uploadPostImage } = await import("./client");

// A fresh File per test: prepareImageForUpload() remembers its result per File.
let original: File;
const fetchMock = vi.fn();

// Minimal browser surface optimizeImageForUpload() uses: decode -> canvas
// -> toBlob. `reencoded` stands in for the canvas output, which carries no
// EXIF/location metadata.
function stubCanvas(reencoded: Blob | null) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })),
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (blob: Blob | null) => void) => cb(reencoded),
    }),
  });
}

beforeEach(() => {
  original = new File([new Uint8Array(16)], "photo.jpg", { type: "image/jpeg" });
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: { path: "posts/lost/1/x.webp", token: "tok" } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("image upload never sends the original file", () => {
  it("uploads the re-encoded image, not the original", async () => {
    const reencoded = new Blob([new Uint8Array(8)], { type: "image/webp" });
    stubCanvas(reencoded);

    await uploadPostImage("lost", 1, original);

    expect(uploadToSignedUrl).toHaveBeenCalledWith("posts/lost/1/x.webp", "tok", reencoded);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ contentType: "image/webp" });
  });

  it("stops (no upload credential, no upload) when the image can't be decoded", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("decode failed");
      }),
    );

    await expect(uploadPostImage("lost", 1, original)).rejects.toBeInstanceOf(ImageProcessingError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("stops when the canvas can't produce an image", async () => {
    stubCanvas(null);

    await expect(uploadChatImage(3, original)).rejects.toBeInstanceOf(ImageProcessingError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadChatImageToSignedUrl).not.toHaveBeenCalled();
  });

  it("uploads a chat image (re-encoded) to the private chat bucket, never the post bucket", async () => {
    const reencoded = new Blob([new Uint8Array(8)], { type: "image/webp" });
    stubCanvas(reencoded);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { path: "chat/3/x.webp", token: "tok" } }), { status: 200 }),
    );

    await uploadChatImage(3, original);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/3/upload");
    expect(uploadChatImageToSignedUrl).toHaveBeenCalledWith("chat/3/x.webp", "tok", reencoded);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("stops in a browser without createImageBitmap at all", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    await expect(uploadChatImage(3, original)).rejects.toBeInstanceOf(ImageProcessingError);
    expect(uploadChatImageToSignedUrl).not.toHaveBeenCalled();
  });
});

describe("upload rate limit", () => {
  it("surfaces a 429 as UploadRateLimitedError carrying the real remaining wait", async () => {
    stubCanvas(new Blob([new Uint8Array(8)], { type: "image/webp" }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "요청이 너무 많습니다. 4분 10초 후에 다시 시도해주세요.", retryAfterSeconds: 250 }), {
        status: 429,
        headers: { "Retry-After": "250" },
      }),
    );

    const error = await uploadPostImage("found", 1, original).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadRateLimitedError);
    expect((error as InstanceType<typeof UploadRateLimitedError>).retryAfterSeconds).toBe(250);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("falls back to the Retry-After header when the body has no retryAfterSeconds", async () => {
    stubCanvas(new Blob([new Uint8Array(8)], { type: "image/webp" }));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "90" } }));

    const error = await uploadPostImage("found", 1, original).catch((e: unknown) => e);

    expect((error as InstanceType<typeof UploadRateLimitedError>).retryAfterSeconds).toBe(90);
  });
});

// 등록 지연 개선: the photo step starts when a photo is picked and is reused at upload.
describe("prepareImageForUpload", () => {
  it("processes each picked photo once, and the upload reuses that result", async () => {
    const reencoded = new Blob([new Uint8Array(8)], { type: "image/webp" });
    stubCanvas(reencoded);

    const early = prepareImageForUpload(original);
    await uploadPostImage("lost", 1, original);

    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(await early).toEqual({ blob: reencoded, contentType: "image/webp" });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("posts/lost/1/x.webp", "tok", reencoded);
  });

  it("an early failure surfaces only at upload, as before", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decode failed"); }));
    void prepareImageForUpload(original);

    await expect(uploadPostImage("lost", 1, original)).rejects.toBeInstanceOf(ImageProcessingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
