// Shared between server (upload token validation, Route Handlers) and
// client (ImageUploader's UX-only pre-check) -- no server-only or
// Prisma import here on purpose, so a "use client" component can import
// it directly. The server-side checks in /api/upload are what actually
// enforce this; the client copy only avoids an obviously-doomed upload
// attempt and a slow round trip.

// Public bucket (see src/lib/images/supabaseAdmin.ts's publicUrlFor() doc
// comment for why public is the right choice here) -- the name itself
// isn't sensitive, so it's fine in a shared/client-reachable module too.
export const POST_IMAGES_BUCKET = "post-images";

export const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const EXTENSION_BY_CONTENT_TYPE: Record<AllowedImageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedImageContentType(value: string): value is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}

export function extensionForContentType(type: AllowedImageContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[type];
}
