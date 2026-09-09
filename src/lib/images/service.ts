import { prisma } from "@/lib/db/prisma";
import type { PostType } from "@/lib/posts/schema";
import { saveImageEmbedding } from "@/lib/ai/vectorSearch";
import { deleteObjectSafely, publicUrlFor } from "./supabaseAdmin";
import { parseImagePathname } from "./pathname";
import { MAX_IMAGES_PER_POST } from "./config";

export type ImageMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid_path" }
  // Phase 11-4C: attachPostImages() only -- a fresh, transaction-scoped
  // recount put this attach over MAX_IMAGES_PER_POST.
  | { kind: "too_many_images" }
  // Phase 11-4D: reorderPostImages() only -- the submitted imageIds don't
  // name exactly the same set of PostImage rows the post currently has.
  | { kind: "invalid_order" };

export type PostImageDTO = {
  id: number;
  imageUrl: string;
  displayOrder: number;
  isPrimary: boolean;
};

// Phase 11-4C: thrown from inside attachPostImages()'s transaction to abort
// it (a thrown error rolls back everything Prisma has done in the
// transaction so far) and unwound into a typed `too_many_images` result by
// the catch block around it -- never lets a plain Error reach the caller
// as an unrelated 500.
class TooManyImagesError extends Error {}

function postImageWhere(type: PostType, id: number) {
  return type === "lost" ? { lostPostId: id } : { foundPostId: id };
}

async function findOwnedPost(type: PostType, id: number) {
  return type === "lost"
    ? prisma.lostPost.findUnique({ where: { id } })
    : prisma.foundPost.findUnique({ where: { id } });
}

// Attaches/replaces a post's image with one that has *already* finished
// uploading to Storage (the client only calls this after uploadToSignedUrl
// resolves) -- never uploads anything itself. The DB is updated to point
// at the new URL first, and only then is the old object deleted: if the
// old object were deleted first and this update somehow failed, the post
// would be left with neither image (see Phase 4 spec section 8/11).
//
// Phase 11-4C: PostForm.tsx -- this function's one real caller -- is still
// single-image-only, so this keeps its original "replace the post's one
// image" behavior byte-for-byte from the outside. Internally, it now also
// keeps the PostImage table in sync (LostPost/FoundPost.imageUrl is
// documented, since Phase 11-4B, as a cache of PostImage's current primary
// row): it replaces the post's existing primary row in place if one
// exists, or creates it if this is the post's first image ever. Any other
// (non-primary) PostImage row a future multi-image UI created is left
// untouched -- this call only ever meant "the image", never "the whole
// gallery".
export async function setPostImage(
  type: PostType,
  id: number,
  userId: number,
  upload: { path: string; previousAttemptPath?: string },
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

  await prisma.$transaction(async (tx) => {
    if (type === "lost") {
      await tx.lostPost.update({ where: { id }, data: { imageUrl: newUrl } });
    } else {
      await tx.foundPost.update({ where: { id }, data: { imageUrl: newUrl } });
    }

    const primary = await tx.postImage.findFirst({ where: { ...postImageWhere(type, id), isPrimary: true } });
    if (primary) {
      await tx.postImage.update({ where: { id: primary.id }, data: { imageUrl: newUrl } });
    } else {
      await tx.postImage.create({
        data: { ...postImageWhere(type, id), imageUrl: newUrl, displayOrder: 0, isPrimary: true },
      });
    }
  });

  if (previousUrl && previousUrl !== newUrl) {
    await deleteObjectSafely(previousUrl);
  }

  // Phase G-4: orphan cleanup for a *previous* upload attempt that finished
  // uploading to Storage but never got this far (e.g. this same attach call
  // failed last time, and the client re-uploaded to a new path on retry --
  // see PostForm.tsx's staleUploadPathRef). Never trusted at face value:
  // re-parsed and required to name this exact (type, id), same as `upload
  // .path` above, so a client can't use this field to make the server
  // delete an arbitrary object elsewhere in the bucket -- an
  // unrecognized/mismatched value is silently ignored (this is an optional
  // best-effort hint, not a required part of the request) rather than
  // failing the whole attach over it.
  if (upload.previousAttemptPath) {
    const parsedPrevious = parseImagePathname(upload.previousAttemptPath);
    if (
      parsedPrevious &&
      parsedPrevious.postType === type &&
      parsedPrevious.postId === id &&
      upload.previousAttemptPath !== upload.path
    ) {
      await deleteObjectSafely(publicUrlFor(upload.previousAttemptPath));
    }
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
  return { kind: "ok", data: { imageUrl: newUrl } };
}

// Phase 11-4C: adds one or more new images to a post's gallery (never
// replaces/removes an existing one -- see setPostImage above for the
// single-image "replace" call this is deliberately NOT). Not reachable yet
// from any real UI (PostForm.tsx only ever sends the legacy single `path`
// shape) -- exists so /api/posts/[id]/image's POST handler can grow
// multi-image support ahead of Phase 11-4D's UI without a breaking change.
export async function attachPostImages(
  type: PostType,
  id: number,
  userId: number,
  input: { paths: string[] },
): Promise<ImageMutationResult<{ images: PostImageDTO[]; imageUrl: string | null }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  const parsedPaths: string[] = [];
  for (const path of input.paths) {
    const parsed = parseImagePathname(path);
    if (!parsed || parsed.postType !== type || parsed.postId !== id) {
      return { kind: "invalid_path" };
    }
    parsedPaths.push(path);
  }

  let newPrimaryUrl: string | null = null;
  try {
    const images = await prisma.$transaction(async (tx) => {
      // Phase 11-4C: counted fresh, inside the transaction, right before
      // writing -- this is the check that actually guards against two
      // concurrent attach calls both having already passed
      // attachImageSchema's own (client-request-shape-only)
      // MAX_IMAGES_PER_POST cap.
      const currentCount = await tx.postImage.count({ where: postImageWhere(type, id) });
      if (currentCount + parsedPaths.length > MAX_IMAGES_PER_POST) {
        throw new TooManyImagesError();
      }

      const lastImage = await tx.postImage.findFirst({
        where: postImageWhere(type, id),
        orderBy: { displayOrder: "desc" },
      });
      const maxOrder = lastImage?.displayOrder ?? -1;
      const hasPrimary =
        (await tx.postImage.count({ where: { ...postImageWhere(type, id), isPrimary: true } })) > 0;

      const created: PostImageDTO[] = [];
      for (let i = 0; i < parsedPaths.length; i++) {
        const url = publicUrlFor(parsedPaths[i]);
        // Only the very first image this post has ever had becomes
        // primary -- an existing primary (from an earlier attach call) is
        // never silently overwritten by a later one.
        const isPrimary = !hasPrimary && i === 0;
        const row = await tx.postImage.create({
          data: { ...postImageWhere(type, id), imageUrl: url, displayOrder: maxOrder + 1 + i, isPrimary },
        });
        created.push({ id: row.id, imageUrl: row.imageUrl, displayOrder: row.displayOrder, isPrimary: row.isPrimary });
        if (isPrimary) newPrimaryUrl = url;
      }

      if (newPrimaryUrl) {
        if (type === "lost") {
          await tx.lostPost.update({ where: { id }, data: { imageUrl: newPrimaryUrl } });
        } else {
          await tx.foundPost.update({ where: { id }, data: { imageUrl: newPrimaryUrl } });
        }
      }

      return created;
    });

    return { kind: "ok", data: { images, imageUrl: newPrimaryUrl ?? existing.imageUrl } };
  } catch (error) {
    // Storage upload already happened before this call was ever made (see
    // the route layer) -- a DB failure here must not leave those objects
    // as permanent orphans. deleteObjectSafely() is documented to never
    // throw (see supabaseAdmin.ts), but this is wrapped in its own
    // try/catch anyway rather than trusting that from a distance: a
    // cleanup failure must never replace/mask the original `error` (or the
    // too_many_images result) below.
    try {
      await Promise.all(parsedPaths.map((path) => deleteObjectSafely(publicUrlFor(path))));
    } catch (cleanupError) {
      console.error(
        `Failed to clean up orphaned Storage objects after a failed image attach for ${type} post ${id}:`,
        cleanupError,
      );
    }
    if (error instanceof TooManyImagesError) return { kind: "too_many_images" };
    throw error;
  }
}

// Phase 11-4C: deletes exactly one PostImage row out of a post's gallery.
// If the deleted row was the primary image, the next-lowest-displayOrder
// remaining row (if any) is promoted to primary and the LostPost/
// FoundPost.imageUrl cache is updated to match; if none remain, the cache
// is set to null -- a post with zero images is a valid, fully-supported
// state, not an error.
export async function deletePostImage(
  type: PostType,
  id: number,
  userId: number,
  imageId: number,
): Promise<ImageMutationResult<{ imageUrl: string | null }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  const image = await prisma.postImage.findUnique({ where: { id: imageId } });
  // Cross-post deletion is rejected the same way a nonexistent image is --
  // from the caller's point of view there is no such image on *this* post
  // either way, and this must never leak whether imageId exists on some
  // other post.
  const belongsToThisPost =
    image !== null && (type === "lost" ? image.lostPostId === id : image.foundPostId === id);
  if (!image || !belongsToThisPost) return { kind: "not_found" };

  let finalImageUrl: string | null = existing.imageUrl;
  let promoted = false;

  await prisma.$transaction(async (tx) => {
    await tx.postImage.delete({ where: { id: imageId } });
    if (!image.isPrimary) return;

    const next = await tx.postImage.findFirst({
      where: postImageWhere(type, id),
      orderBy: { displayOrder: "asc" },
    });
    if (next) {
      await tx.postImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      finalImageUrl = next.imageUrl;
      promoted = true;
    } else {
      finalImageUrl = null;
    }

    if (type === "lost") {
      await tx.lostPost.update({ where: { id }, data: { imageUrl: finalImageUrl } });
    } else {
      await tx.foundPost.update({ where: { id }, data: { imageUrl: finalImageUrl } });
    }
  });

  await deleteObjectSafely(image.imageUrl);

  // Best-effort, matching clearPostImage's own treatment of this exact
  // side effect. Only cleared when the deleted image was primary AND
  // nothing was promoted to take its place (the post now truly has no
  // image) -- if a different existing image was promoted instead, its own
  // embedding still needs recomputing, which the route layer triggers the
  // same way setPostImage's attach path already does (an internal PUT
  // /api/posts/[id] request); clearing the column here first would just be
  // overwritten by that anyway.
  if (image.isPrimary && !promoted) {
    try {
      await saveImageEmbedding(type, id, null);
    } catch (error) {
      console.error(`Failed to clear image embedding for ${type} post ${id}:`, error);
    }
  }

  return { kind: "ok", data: { imageUrl: finalImageUrl } };
}

// DB is cleared first, Storage cleanup is best-effort after -- a failed
// Storage delete never blocks (or needs to be retried before) the post
// itself having no image anymore.
//
// Phase 11-4C: PostForm.tsx's "remove image" control has always meant
// "this post has no image anymore", not "remove only the cover photo of an
// otherwise-untouched gallery" -- so this now clears every PostImage row
// for the post, not just the imageUrl cache column. A future multi-image
// UI that wants to delete a single photo out of several uses the new
// per-image deletePostImage() above instead, which this function
// deliberately does not call into.
export async function clearPostImage(
  type: PostType,
  id: number,
  userId: number,
): Promise<ImageMutationResult<{ imageUrl: null }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  const previousUrl = existing.imageUrl;
  const images = await prisma.postImage.findMany({ where: postImageWhere(type, id) });

  await prisma.$transaction(async (tx) => {
    if (type === "lost") {
      await tx.lostPost.update({ where: { id }, data: { imageUrl: null } });
    } else {
      await tx.foundPost.update({ where: { id }, data: { imageUrl: null } });
    }
    await tx.postImage.deleteMany({ where: postImageWhere(type, id) });
  });

  // Phase G-4: best-effort, matching setPostImage's own treatment of this
  // exact side effect (that path delegates it to an internal best-effort
  // HTTP call; this one calls it directly since it has nothing else to
  // await either way). The imageUrl column above is the source of truth
  // for "does this post have an image" -- a transient failure clearing the
  // (separate, independent) imageEmbedding column must never turn an
  // already-committed image removal into a reported failure, which is what
  // an unguarded throw here used to do (withErrorHandling has no
  // transaction to roll the first write back with regardless).
  try {
    await saveImageEmbedding(type, id, null);
  } catch (error) {
    console.error(`Failed to clear image embedding for ${type} post ${id}:`, error);
  }

  // Every image this post had (the cache column's own URL plus every
  // gallery row's URL) gets a best-effort Storage cleanup attempt, deduped
  // so the common case (cache and the one PostImage row point at the same
  // object) never double-deletes the same path.
  const urlsToDelete = new Set<string>();
  if (previousUrl) urlsToDelete.add(previousUrl);
  for (const image of images) urlsToDelete.add(image.imageUrl);
  await Promise.all([...urlsToDelete].map((url) => deleteObjectSafely(url)));

  return { kind: "ok", data: { imageUrl: null } };
}

// Phase 11-4D: reassigns every one of a post's PostImage rows' displayOrder
// to match `imageIds`'s own order (index 0 -> displayOrder 0 -> primary),
// and syncs the LostPost/FoundPost.imageUrl cache to the new primary's URL.
// No Storage object is touched -- this only ever reorders existing rows,
// never attaches/deletes one (see attachPostImages/deletePostImage above
// for those). `imageIds` must name *exactly* the post's current set of
// PostImage ids (same members, any order) -- not a subset, not a superset,
// and not an id from a different post -- so there's never an ambiguous
// "what happens to the id I left out" question; the caller (PostForm, via
// PATCH /api/posts/[id]/images) always sends its full current gallery
// order for this exact reason.
export async function reorderPostImages(
  type: PostType,
  id: number,
  userId: number,
  imageIds: number[],
): Promise<ImageMutationResult<{ images: PostImageDTO[]; imageUrl: string | null }>> {
  const existing = await findOwnedPost(type, id);
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden" };

  const currentImages = await prisma.postImage.findMany({ where: postImageWhere(type, id) });
  const currentIds = new Set(currentImages.map((image) => image.id));
  const requestedIds = new Set(imageIds);
  const sameSet =
    imageIds.length === currentImages.length &&
    currentIds.size === requestedIds.size &&
    [...currentIds].every((imageId) => requestedIds.has(imageId));
  if (!sameSet) return { kind: "invalid_order" };

  let newPrimaryUrl: string | null = null;
  const images = await prisma.$transaction(async (tx) => {
    const updated: PostImageDTO[] = [];
    for (let i = 0; i < imageIds.length; i++) {
      const isPrimary = i === 0;
      const row = await tx.postImage.update({
        where: { id: imageIds[i] },
        data: { displayOrder: i, isPrimary },
      });
      updated.push({ id: row.id, imageUrl: row.imageUrl, displayOrder: row.displayOrder, isPrimary: row.isPrimary });
      if (isPrimary) newPrimaryUrl = row.imageUrl;
    }

    if (type === "lost") {
      await tx.lostPost.update({ where: { id }, data: { imageUrl: newPrimaryUrl } });
    } else {
      await tx.foundPost.update({ where: { id }, data: { imageUrl: newPrimaryUrl } });
    }

    return updated;
  });

  return { kind: "ok", data: { images, imageUrl: newPrimaryUrl } };
}
