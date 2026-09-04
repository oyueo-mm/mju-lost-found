// Split from http.ts for the same reason as posts/match/chat's
// response.ts: no next-auth import chain, so tests can import this
// directly without pulling in next-auth (which doesn't resolve under
// Vitest's plain Node ESM outside of Next's own bundler).
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { CreateReportResult, ReportLookupResult } from "./service";

export function createReportResultToResponse(result: CreateReportResult) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: 201 });
    case "target_not_found":
      return jsonError(404, "신고 대상을 찾을 수 없습니다.");
    case "self_report":
      return jsonError(400, "자기 자신이 작성/소유한 대상은 신고할 수 없습니다.");
    case "duplicate":
      return jsonError(409, "이미 신고한 대상입니다.");
  }
}

export function reportLookupResultToResponse(result: ReportLookupResult) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data);
    case "not_found":
      return jsonError(404, "신고를 찾을 수 없습니다.");
    case "forbidden":
      return jsonError(403, "본인이 접수한 신고만 조회할 수 있습니다.");
  }
}
