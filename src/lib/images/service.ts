import { prisma } from "@/lib/db/prisma";
import type { PostType } from "@/lib/posts/schema";
import { deleteBlobSafely, isOurBlobUrl } from "./blob";

export type ImageMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_url" };

async function findOwnedPost(type: PostType, id: number) {
  return type === "lost"
    ? prisma.lostPost.findUnique({ where: { id } })
    : prisma.foundPost.findUnique({ where: { id } });
}

async function writeImageUrl(type: PostType, id: number, imageUrl: string | null) {
  if (type === "lost") {
    return prisma.lostPost.update({ where: { id }, data: { imageUrl } });
  }
  return prisma.foundPost.update({ where: { id }, data: { imageUrl } });
}

// Attaches/replaces a post's image with one that has *already* finished
// uploading to Blob storage (the client only calls this after its direct
// upload resolves) -- never uploads anything itself. The DB is updated to
// point at the new URL first, and only then is the old blob deleted: if
// the old blob were deleted first and this update somehow failed, the
// post would be left with neither image (see Phase 4 spec section 8).
export async function setPostImage(
  type: PostType,
  id: number,
  userId: number,
  upload: { url: string; pathname: string },
): Promise<ImageMutationResult<{ imageUrl: string }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };
  if (!isOurBlobUrl(upload.url, upload.pathname)) return { kind: "invalid_url" };

  const previousUrl = existing.imageUrl;
  const updated = await writeImageUrl(type, id, upload.url);

  if (previousUrl && previousUrl !== upload.url) {
    await deleteBlobSafely(previousUrl);
  }

  return { kind: "ok", data: { imageUrl: updated.imageUrl! } };
}

// DB is cleared first, Blob cleanup is best-effort after -- a failed Blob
// delete never blocks (or needs to be retried before) the post itself
// having no image anymore.
export async function clearPostImage(
  type: PostType,
  id: number,
  userId: number,
): Promise<ImageMutationResult<{ imageUrl: null }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  const previousUrl = existing.imageUrl;
  await writeImageUrl(type, id, null);

  if (previousUrl) {
    await deleteBlobSafely(previousUrl);
  }

  return { kind: "ok", data: { imageUrl: null } };
}
