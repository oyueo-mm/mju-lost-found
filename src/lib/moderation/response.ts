// Split from http.ts for the same reason as every other domain's
// response.ts: no next-auth import chain, so tests can import this
// directly without pulling in next-auth.
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { AdminMutationResult } from "./service";

export function adminMutationResultToResponse<T>(result: AdminMutationResult<T>, successStatus = 200) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "forbidden":
      return jsonError(403, "관리자 권한이 필요합니다.");
    case "not_found":
      return jsonError(404, "신고를 찾을 수 없습니다.");
    case "already_processed":
      return jsonError(409, "이미 처리된 신고입니다.");
    case "invalid_action_type":
      return jsonError(400, "이 신고 대상에는 사용할 수 없는 조치입니다.");
    case "target_gone":
      return jsonError(409, "대상이 이미 삭제되어 조치를 적용할 수 없습니다.");
  }
}
