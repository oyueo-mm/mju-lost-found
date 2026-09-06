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

// Phase 28-3: chat/{chatRoomId}/{uuid}.{ext} -- same bucket (post-images)
// and signed-upload-URL mechanism as post images (see
// src/app/api/chat/[id]/upload/route.ts), just a different path prefix so
// the two never collide and parseChatImagePathname() below can't be
// tricked by a post's own pathname. The chat room must already exist and
// the uploader must already be verified as a participant (checked by that
// route via getChatRoomForUser(), the same membership check every other
// chat read/write path uses) before this is ever called.
const CHAT_PATHNAME_PATTERN =
  /^chat\/(\d+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function buildChatImagePathname(chatRoomId: number, contentType: AllowedImageContentType): string {
  const id = crypto.randomUUID();
  return `chat/${chatRoomId}/${id}.${extensionForContentType(contentType)}`;
}

// Re-validates a client-reported path actually names the chat room the
// message is being sent to -- same "never trust a client-supplied path
// beyond what upload minted it for" rule parseImagePathname() enforces for
// posts (see chat/service.ts::sendMessage's own call site).
export function parseChatImagePathname(pathname: string): { chatRoomId: number } | null {
  const match = CHAT_PATHNAME_PATTERN.exec(pathname);
  if (!match) return null;
  return { chatRoomId: Number(match[1]) };
}
