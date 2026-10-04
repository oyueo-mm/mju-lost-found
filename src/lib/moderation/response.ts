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
    case "not_rights_infringement":
      return jsonError(400, "임시 숨김은 개인정보 노출·사생활 침해·명예훼손·불법 성적 콘텐츠 신고에만 적용할 수 있습니다.");
    case "not_temp_hidden":
      return jsonError(409, "임시 숨김 상태가 아닙니다.");
    case "target_gone":
      return jsonError(409, "대상이 이미 삭제되어 조치를 적용할 수 없습니다.");
    case "reason_required":
      return jsonError(400, "사용자 정지에는 사유 카테고리와 상세 사유가 모두 필요합니다.");
    // Phase 관리자 승인제: this report's target is an admin -- nothing was
    // applied yet, an AdminActionProposal was created instead (see
    // applyReportAction()'s own comment). 202 (Accepted), never 200, same
    // convention as admin/response.ts's own "proposal_created" case.
    case "proposal_created":
      return jsonOk(result.data, { status: 202 });
    case "last_admin":
      return jsonError(409, "활성 관리자가 0명이 되는 조치는 할 수 없습니다.");
  }
}
