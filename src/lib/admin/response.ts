// Split from any Route Handler file for the same reason as
// moderation/response.ts: no next-auth import chain, so tests can import
// this directly without pulling in next-auth.
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { AdminUserMutationResult } from "./users";
import type { AdminPostMutationResult } from "./posts";

export function adminUserMutationResultToResponse<T>(
  result: AdminUserMutationResult<T>,
  successStatus = 200,
) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "forbidden":
      return jsonError(403, "관리자 권한이 필요합니다.");
    case "not_found":
      return jsonError(404, "사용자를 찾을 수 없습니다.");
    case "self":
      return jsonError(400, "본인 계정에는 이 작업을 적용할 수 없습니다.");
    case "reason_required":
      return jsonError(400, "사용자 정지에는 사유 카테고리와 상세 사유가 모두 필요합니다.");
  }
}

export function adminPostMutationResultToResponse<T>(
  result: AdminPostMutationResult<T>,
  successStatus = 200,
) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "forbidden":
      return jsonError(403, "관리자 권한이 필요합니다.");
    case "not_found":
      return jsonError(404, "게시물을 찾을 수 없습니다.");
  }
}
