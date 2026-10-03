import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();
vi.mock("./supabaseBrowser", () => ({ uploadToSignedUrl }));

const { ImageProcessingError, uploadChatImage, uploadPostImage } = await import("./client");

const original = new File([new Uint8Array(16)], "photo.jpg", { type: "image/jpeg" });
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
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("stops in a browser without createImageBitmap at all", async () => {
    vi.stubGlobal("createImageBitmap", undefined);

    await expect(uploadChatImage(3, original)).rejects.toBeInstanceOf(ImageProcessingError);
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });
});
