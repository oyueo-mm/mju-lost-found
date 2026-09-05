import { extensionForContentType, type AllowedImageContentType } from "./config";
import type { PostType } from "@/lib/posts/schema";

// posts/{postType}/{postId}/{uuid}.{ext} -- the post must already exist
// (see src/lib/images/service.ts) so postId is always the post's real,
// numeric id, never a user-supplied filename or a client-invented value.
// The server (src/app/api/upload/route.ts) is the only thing that ever
// calls buildImagePathname() -- the browser just receives the result and
// later reports it back when attaching the image to a post (POST
// /api/posts/[id]/image), at which point parseImagePathname() re-validates
// it actually names the same (postType, postId) rather than trusting it.
const PATHNAME_PATTERN =
  /^posts\/(lost|found)\/(\d+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function buildImagePathname(
  postType: PostType,
  postId: number,
  contentType: AllowedImageContentType,
): string {
  const id = crypto.randomUUID();
  return `posts/${postType}/${postId}/${id}.${extensionForContentType(contentType)}`;
}

export function parseImagePathname(
  pathname: string,
): { postType: PostType; postId: number } | null {
  const match = PATHNAME_PATTERN.exec(pathname);
  if (!match) return null;
  return { postType: match[1] as PostType, postId: Number(match[2]) };
}

export function isValidImagePathname(pathname: string): boolean {
  return PATHNAME_PATTERN.test(pathname);
}
