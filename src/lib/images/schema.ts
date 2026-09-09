import { z } from "zod";

import { MAX_IMAGES_PER_POST } from "./config";

// What the client sends after its own direct-to-Storage upload (via
// uploadToSignedUrl(), see src/lib/images/supabaseBrowser.ts) finishes --
// just the path, which the server re-validates and re-derives the public
// URL from itself (see src/lib/images/service.ts::setPostImage). Unlike
// the earlier Vercel Blob design, the client never gets to assert a URL --
// only a path, which is meaningless without the matching post/ownership
// check anyway.
//
// Phase 11-4C: PostForm.tsx (the sole caller of this shape at the time)
// only ever sent this exact single-`path` request. Phase 11-4D's
// multi-image UI now sends `paths` (below) instead for every new upload,
// but this branch is kept exactly as it was -- an old client, a cached
// page, or any other integration that still sends a single `path` must
// keep working forever, regardless of what's added alongside it.
const legacySingleAttachSchema = z.object({
  path: z.string().min(1, "path가 필요합니다."),
  // Phase G-4: optional hint naming a *different* Storage object the
  // client uploaded on an earlier, failed attempt at this same attach call
  // (e.g. a retry after this endpoint returned an error last time) -- see
  // src/lib/images/service.ts::setPostImage's own comment for how this is
  // re-validated server-side before anything is deleted. Omitted entirely
  // on a normal (first-attempt) attach.
  previousAttemptPath: z.string().min(1).optional(),
});

// Phase 11-4C: new, additive shape for attaching one or more images at
// once (each already uploaded directly to Storage the same way a single
// `path` is -- see /api/upload -- just called N times by a future UI). No
// existing caller sends this yet; it exists so /api/posts/[id]/image can
// grow multi-image support without a new route file or breaking
// PostForm.tsx's existing request. The array-length cap here is just a
// fast, obvious-request-rejection; the real, race-condition-safe limit is
// re-checked against a fresh DB count in attachPostImages() itself.
const multiAttachSchema = z.object({
  paths: z
    .array(z.string().min(1))
    .min(1, "paths가 필요합니다.")
    .max(MAX_IMAGES_PER_POST, `게시글에는 최대 ${MAX_IMAGES_PER_POST}장의 이미지만 등록할 수 있습니다.`),
});

export const attachImageSchema = z.union([multiAttachSchema, legacySingleAttachSchema]);
export type AttachImageInput = z.infer<typeof attachImageSchema>;

// Phase 11-4D: PATCH /api/posts/[id]/images's body -- the full, final
// ordered list of a post's own PostImage ids (index 0 becomes primary).
// Never a partial list: reorderPostImages() rejects anything that isn't
// exactly the same *set* of ids the post currently has (see that
// function's own comment), so there's no ambiguity about what happens to
// an id the caller omitted.
export const reorderImagesSchema = z.object({
  imageIds: z
    .array(z.number().int().positive())
    .min(1, "imageIds가 필요합니다.")
    .max(MAX_IMAGES_PER_POST),
});
export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;
