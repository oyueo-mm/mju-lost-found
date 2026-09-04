import { extensionForContentType, type AllowedImageContentType } from "./config";
import type { PostType } from "@/lib/posts/schema";

// posts/{postType}/{postId}/{uuid}.{ext} -- the post must already exist
// (see src/lib/images/service.ts) so postId is always the post's real,
// numeric id, never a user-supplied filename or a client-invented value.
// isValidImagePathname() is what actually enforces this shape server-side
// (in /api/upload's onBeforeGenerateToken) since @vercel/blob/client lets
// the browser propose the pathname -- this function just builds a
// pathname that will pass that check.
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
