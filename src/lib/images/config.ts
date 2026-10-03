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

// Private bucket for 1:1 / organization-inquiry chat images. Never served
// by public URL: the app stores only the object path (Message.imagePath)
// and hands images out through GET /api/chat/[id]/messages/[messageId]/image,
// which checks the viewer and redirects to a short-lived signed URL. Same
// type/size limits as post images. Created by
// scripts/ensureChatImagesBucket.ts (see docs/operations.md).
export const CHAT_IMAGES_BUCKET = "chat-images";

// How long (seconds) a signed chat-image URL stays valid, and how long the
// browser / Supabase CDN may cache the object (set at upload time). Kept
// equal so a deleted image can't outlive either for long.
export const CHAT_IMAGE_URL_TTL_SECONDS = 60;

export const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Phase 11-4C: server-side cap on how many PostImage rows one post may
// have -- re-checked against a fresh DB count at attach time (see
// src/lib/images/service.ts::attachPostImages), never trusted from the
// client's own request shape alone. Also used by attachImageSchema's own
// `paths` array length check below, so an obviously-too-large request is
// rejected before even reaching the DB.
export const MAX_IMAGES_PER_POST = 5;

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
