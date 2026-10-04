import sharp, { type Metadata } from "sharp";

import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

import { CHAT_IMAGES_BUCKET, MAX_IMAGE_SIZE_BYTES, POST_IMAGES_BUCKET } from "./config";

// Server-side check of an image the browser uploaded straight to Storage
// (signed upload URL), run before the image is attached to a post or a
// chat message -- so calling the upload APIs directly can't get a
// non-image, or a photo still carrying EXIF/GPS, into the service.
//
//   - the object must decode as an image of the type its path claims
//     (.jpg -> JPEG, .png -> PNG, .webp -> WebP) and stay within the size
//     and pixel limits;
//   - if it carries EXIF / XMP / IPTC metadata (GPS location lives in
//     EXIF), it is re-encoded without it (orientation applied first) and
//     written back to the same path.
//
// The normal browser path already re-encodes on a canvas (lib/images/
// client.ts), which leaves no metadata, so those images are only decoded
// here, not re-encoded (no extra quality loss, little CPU).

type Bucket = typeof POST_IMAGES_BUCKET | typeof CHAT_IMAGES_BUCKET;
type Format = "jpeg" | "png" | "webp";

export type SanitizeResult =
  | { ok: true; rewritten: boolean }
  | { ok: false; reason: "missing" | "too_large" | "not_image" | "format_mismatch" };

const FORMAT_BY_EXTENSION: Record<string, Format> = { jpg: "jpeg", png: "png", webp: "webp" };
const CONTENT_TYPE: Record<Format, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
// Well above the 1920px the browser resizes to; stops decompression bombs.
const MAX_INPUT_PIXELS = 40_000_000;

export function hasRemovableMetadata(meta: { exif?: Buffer; xmp?: Buffer; iptc?: Buffer }): boolean {
  return Boolean(meta.exif || meta.xmp || meta.iptc);
}

export async function sanitizeStoredImage(
  bucket: Bucket,
  path: string,
  options: { cacheControl?: string } = {},
): Promise<SanitizeResult> {
  const expected = FORMAT_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""];
  if (!expected) return { ok: false, reason: "format_mismatch" };

  const storage = getSupabaseAdminClient().storage.from(bucket);
  // cacheNonce: always read the object as stored now, never a CDN-cached
  // copy (Storage caches downloads by URL).
  const { data: blob, error } = await storage.download(path, { cacheNonce: `${Date.now()}` });
  if (error || !blob) return { ok: false, reason: "missing" };
  if (blob.size > MAX_IMAGE_SIZE_BYTES) return { ok: false, reason: "too_large" };
  const input = Buffer.from(await blob.arrayBuffer());

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    return { ok: false, reason: "not_image" };
  }
  if (meta.format !== expected) return { ok: false, reason: "format_mismatch" };
  if (!hasRemovableMetadata(meta)) return { ok: true, rewritten: false };

  // sharp drops all metadata on output unless asked to keep it; rotate()
  // with no argument first applies the EXIF orientation so the photo
  // doesn't end up sideways once that tag is gone.
  const output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .toFormat(expected, expected === "png" ? {} : { quality: 90 })
    .toBuffer();
  const { error: writeError } = await storage.update(path, output, {
    contentType: CONTENT_TYPE[expected],
    upsert: true,
    ...(options.cacheControl && { cacheControl: options.cacheControl }),
  });
  if (writeError) throw new Error(`Failed to write sanitized image: ${writeError.message}`);
  return { ok: true, rewritten: true };
}
