import type { AllowedImageContentType } from "./config";

// Release B (H-3): the image type is decided from the file's own first bytes
// before any decoder sees it. A client-declared Content-Type or a file
// extension is never enough -- an SVG, HEIF, GIF, TIFF or any other format a
// native decoder (libvips/librsvg/libheif) would happily parse must not reach
// one under an image/png label. Only the three formats this service accepts
// are recognised; everything else is null.
//
//   JPEG  FF D8 FF
//   PNG   89 50 4E 47 0D 0A 1A 0A
//   WebP  "RIFF" <4-byte size> "WEBP"

export const MAGIC_BYTES_NEEDED = 12;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, i) => bytes[offset + i] === value);
}

export function sniffImageType(bytes: Uint8Array): AllowedImageContentType | null {
  if (bytes.length < MAGIC_BYTES_NEEDED) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  // "RIFF" .... "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

// Reads only the first bytes of a Blob/File (no full copy).
export async function sniffBlobImageType(blob: Blob): Promise<AllowedImageContentType | null> {
  const head = new Uint8Array(await blob.slice(0, MAGIC_BYTES_NEEDED).arrayBuffer());
  return sniffImageType(head);
}

export class UnsupportedImageBytesError extends Error {
  constructor() {
    super("The data is not a JPEG, PNG or WebP image.");
    this.name = "UnsupportedImageBytesError";
  }
}
