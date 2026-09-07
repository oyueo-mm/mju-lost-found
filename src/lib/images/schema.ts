import { z } from "zod";

// What the client sends after its own direct-to-Storage upload (via
// uploadToSignedUrl(), see src/lib/images/supabaseBrowser.ts) finishes --
// just the path, which the server re-validates and re-derives the public
// URL from itself (see src/lib/images/service.ts::setPostImage). Unlike
// the earlier Vercel Blob design, the client never gets to assert a URL --
// only a path, which is meaningless without the matching post/ownership
// check anyway.
export const attachImageSchema = z.object({
  path: z.string().min(1, "path가 필요합니다."),
  // Phase G-4: optional hint naming a *different* Storage object the
  // client uploaded on an earlier, failed attempt at this same attach call
  // (e.g. a retry after this endpoint returned an error last time) -- see
  // src/lib/images/service.ts::setPostImage's own comment for how this is
  // re-validated server-side before anything is deleted. Omitted entirely
  // on a normal (first-attempt) attach.
  previousAttemptPath: z.string().min(1).optional(),
});
export type AttachImageInput = z.infer<typeof attachImageSchema>;
