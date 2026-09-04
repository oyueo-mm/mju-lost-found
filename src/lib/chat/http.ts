// Reuses the generic (not actually post-specific despite the folder name)
// response/auth helpers already established in src/lib/posts/http.ts,
// rather than duplicating jsonOk/jsonError/withErrorHandling/
// requireUserForApi for a third domain (posts, match, now chat).
export { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
export { chatMutationResultToResponse } from "./response";
