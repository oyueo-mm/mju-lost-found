// Reuses the generic (not actually post-specific despite the folder name)
// response/auth helpers already established in src/lib/posts/http.ts and
// response.ts, rather than duplicating jsonOk/jsonError/withErrorHandling/
// requireUserForApi for a second domain.
export { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
export { matchMutationResultToResponse } from "./response";
