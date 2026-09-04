// Reuses the generic auth/response helpers already established in
// src/lib/posts/http.ts, rather than duplicating jsonOk/jsonError/
// withErrorHandling/requireUserForApi for a fourth domain (posts, match,
// chat, now report).
export { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
export { createReportResultToResponse, reportLookupResultToResponse } from "./response";
