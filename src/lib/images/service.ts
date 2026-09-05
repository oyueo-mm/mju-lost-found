import { prisma } from "@/lib/db/prisma";
import type { PostType } from "@/lib/posts/schema";
import { saveImageEmbedding } from "@/lib/ai/vectorSearch";
import { deleteObjectSafely, publicUrlFor } from "./supabaseAdmin";
import { parseImagePathname } from "./pathname";

export type ImageMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_path" };

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
// uploading to Storage (the client only calls this after uploadToSignedUrl
// resolves) -- never uploads anything itself. The DB is updated to point
// at the new URL first, and only then is the old object deleted: if the
// old object were deleted first and this update somehow failed, the post
// would be left with neither image (see Phase 4 spec section 8/11).
export async function setPostImage(
  type: PostType,
  id: number,
  userId: number,
  upload: { path: string },
): Promise<ImageMutationResult<{ imageUrl: string }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  // The path was already validated once when the signed upload URL was
  // minted (see /api/upload's checks), but that doesn't stop a client from
  // attaching a *different* valid-looking path here that was never
  // actually theirs to use -- re-parsing it and requiring it to name
  // exactly this (type, id) is what closes that gap. This replaces (and is
  // strictly stronger than) the old design's isOurBlobUrl() check: instead
  // of trusting an attacker-suppliable URL string, the server derives the
  // URL itself from a path it has independently re-validated.
  const parsed = parseImagePathname(upload.path);
  if (!parsed || parsed.postType !== type || parsed.postId !== id) {
    return { kind: "invalid_path" };
  }

  const newUrl = publicUrlFor(upload.path);
  const previousUrl = existing.imageUrl;
  const updated = await writeImageUrl(type, id, newUrl);

  if (previousUrl && previousUrl !== newUrl) {
    await deleteObjectSafely(previousUrl);
  }

  // Phase 15-2: image-embedding computation is deliberately NOT called
  // from here. This module (and the /api/posts/[id]/image route that
  // calls it) has no SigLIP/onnxruntime files in its Vercel function
  // bundle -- adding them here was tried first and confirmed (via a real
  // deployment) to push the Hobby plan's 12-Serverless-Function cap, the
  // same class of problem Phase 13-2 hit for text search. Unlike that
  // case, there's no read-time fetch-delegation available (this *is* the
  // write path) -- so the caller (the API route) triggers embedding via an
  // internal request to PUT /api/posts/[id], which already carries the
  // model files for its own (text) embedding work. See that route's PUT
  // handler and next.config.ts's comment.
  return { kind: "ok", data: { imageUrl: updated.imageUrl! } };
}

// DB is cleared first, Storage cleanup is best-effort after -- a failed
// Storage delete never blocks (or needs to be retried before) the post
// itself having no image anymore.
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
  // No image left to embed -- unlike setPostImage's best-effort call
  // above, this is a plain, always-succeeds column write (no model
  // involved), so it isn't wrapped in a try/catch of its own.
  await saveImageEmbedding(type, id, null);

  if (previousUrl) {
    await deleteObjectSafely(previousUrl);
  }

  return { kind: "ok", data: { imageUrl: null } };
}
