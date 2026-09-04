import { z } from "zod";

// What the client sends after its own direct-to-Blob upload (via
// @vercel/blob/client's upload()) finishes -- just enough to look the
// blob up and re-validate it server-side (see isOurBlobUrl in blob.ts).
// The actual bytes never pass through this server.
export const attachImageSchema = z.object({
  url: z.string().url("올바른 URL이 아닙니다."),
  pathname: z.string().min(1, "pathname이 필요합니다."),
});
export type AttachImageInput = z.infer<typeof attachImageSchema>;
