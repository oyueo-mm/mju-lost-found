import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real sharp, fake Storage: download() hands back whatever bytes a test
// put there, update() captures what would be written back.
const stored = new Map<string, Buffer>();
const update = vi.fn(async (path: string, body: Buffer) => {
  stored.set(path, body);
  return { data: { path }, error: null };
});
const download = vi.fn(async (path: string, options?: { cacheNonce?: string }) => {
  void options;
  const buf = stored.get(path);
  return buf ? { data: new Blob([new Uint8Array(buf)]), error: null } : { data: null, error: new Error("not found") };
});
const from = vi.fn((bucket: string) => (void bucket, { download, update }));
vi.mock("@/lib/supabase/adminClient", () => ({ getSupabaseAdminClient: () => ({ storage: { from } }) }));

const { sanitizeStoredImage } = await import("./sanitize");

const exifWithGps = { IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" } };
const photo = (format: "jpeg" | "png" | "webp", withExif: boolean) => {
  let img = sharp({ create: { width: 8, height: 6, channels: 3, background: "#4a7" } }).toFormat(format);
  if (withExif) img = img.withExif(exifWithGps);
  return img.toBuffer();
};

beforeEach(() => {
  stored.clear();
  vi.clearAllMocks();
});

describe("sanitizeStoredImage", () => {
  it("re-encodes a JPEG that carries EXIF (incl. GPS) and writes it back without any metadata", async () => {
    const original = await photo("jpeg", true);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    stored.set("posts/lost/1/a.jpg", original);

    const result = await sanitizeStoredImage("post-images", "posts/lost/1/a.jpg");

    expect(result).toEqual({ ok: true, rewritten: true });
    expect(update).toHaveBeenCalledWith("posts/lost/1/a.jpg", expect.any(Buffer), expect.objectContaining({ contentType: "image/jpeg", upsert: true }));
    const cleaned = await sharp(stored.get("posts/lost/1/a.jpg")!).metadata();
    expect(cleaned.exif).toBeUndefined();
    expect(cleaned.format).toBe("jpeg");
  });

  it("leaves an already clean image alone (the normal browser-re-encoded path)", async () => {
    stored.set("chat/3/b.webp", await photo("webp", false));

    expect(await sanitizeStoredImage("chat-images", "chat/3/b.webp", { cacheControl: "60" })).toEqual({ ok: true, rewritten: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the chat images' short cache lifetime when it does rewrite", async () => {
    stored.set("chat/3/c.webp", await photo("webp", true));

    await sanitizeStoredImage("chat-images", "chat/3/c.webp", { cacheControl: "60" });

    expect(update).toHaveBeenCalledWith("chat/3/c.webp", expect.any(Buffer), expect.objectContaining({ cacheControl: "60", contentType: "image/webp" }));
  });

  it("rejects bytes that aren't an image at all", async () => {
    stored.set("posts/lost/1/x.jpg", Buffer.from("<html><script>alert(1)</script></html>"));
    expect(await sanitizeStoredImage("post-images", "posts/lost/1/x.jpg")).toEqual({ ok: false, reason: "not_image" });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a real image whose type doesn't match its path (e.g. PNG uploaded as .jpg)", async () => {
    stored.set("posts/lost/1/y.jpg", await photo("png", false));
    expect(await sanitizeStoredImage("post-images", "posts/lost/1/y.jpg")).toEqual({ ok: false, reason: "format_mismatch" });
  });

  describe("decides the format from the bytes before sharp sees them (release B, H-3)", () => {
    const enc = (s: string) => Buffer.from(s, "utf8");
    it("refuses an SVG or HEIF file stored under an image name", async () => {
      stored.set("posts/lost/1/s.png", enc('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'));
      expect(await sanitizeStoredImage("post-images", "posts/lost/1/s.png")).toEqual({ ok: false, reason: "not_image" });
      stored.set("chat/3/h.jpg", Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]));
      expect(await sanitizeStoredImage("chat-images", "chat/3/h.jpg")).toEqual({ ok: false, reason: "not_image" });
      expect(update).not.toHaveBeenCalled();
    });
    it("refuses a real WebP stored as .jpg before decoding (MIME/extension disguise)", async () => {
      stored.set("posts/lost/1/w.jpg", await photo("webp", false));
      expect(await sanitizeStoredImage("post-images", "posts/lost/1/w.jpg")).toEqual({ ok: false, reason: "format_mismatch" });
    });
    it("still refuses a file whose header is right but whose body is corrupt", async () => {
      const header = (await photo("jpeg", false)).subarray(0, 40);
      stored.set("posts/lost/1/c.jpg", Buffer.concat([header, Buffer.alloc(64, 0x41)]));
      expect(await sanitizeStoredImage("post-images", "posts/lost/1/c.jpg")).toMatchObject({ ok: false });
      expect(update).not.toHaveBeenCalled();
    });
    it("keeps the pixel limit: an oversized but valid PNG is refused", async () => {
      const huge = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
      stored.set("posts/lost/1/huge.png", huge);
      expect(await sanitizeStoredImage("post-images", "posts/lost/1/huge.png")).toEqual({ ok: false, reason: "not_image" });
    });
  });

  it("rejects an object that was never uploaded", async () => {
    expect(await sanitizeStoredImage("post-images", "posts/lost/1/missing.webp")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects an object over the 10MB limit without decoding it", async () => {
    stored.set("posts/lost/1/big.png", Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(await sanitizeStoredImage("post-images", "posts/lost/1/big.png")).toEqual({ ok: false, reason: "too_large" });
  });
});
