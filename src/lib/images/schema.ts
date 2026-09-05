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
});
export type AttachImageInput = z.infer<typeof attachImageSchema>;
