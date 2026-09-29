// Split from any Route Handler file for the same reason as
// moderation/response.ts: no next-auth import chain, so tests can import
// this directly without pulling in next-auth.
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { AdminUserMutationResult } from "./users";
import type { AdminPostMutationResult } from "./posts";
import type { AdminProposalMutationResult } from "./proposals";

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
    // Phase 관리자 승인제: updateUserByAdmin() itself returned this instead
    // of applying the action -- the client should treat it as a distinct
    // "제안이 생성되었습니다" outcome, not a plain success, so this is a 202
    // (Accepted: recorded, not yet applied), never 200.
    case "proposal_created":
      return jsonOk(result.data, { status: 202 });
    case "last_admin":
      return jsonError(409, LAST_ADMIN_MESSAGE);
  }
}

export const LAST_ADMIN_MESSAGE = "활성 관리자가 0명이 되는 조치는 할 수 없습니다.";

export function adminActionProposalMutationResultToResponse<T>(
  result: AdminProposalMutationResult<T>,
  successStatus = 200,
) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "pending_more":
      return jsonOk(result.data, { status: successStatus });
    case "forbidden":
      return jsonError(403, "관리자 권한이 필요합니다.");
    case "not_found":
      return jsonError(404, "제안을 찾을 수 없습니다.");
    case "not_pending":
      return jsonError(409, "이미 처리되었거나 취소된 제안입니다.");
    case "expired":
      return jsonError(409, "만료된 제안입니다.");
    case "self_proposer":
      return jsonError(400, "제안자는 자신의 제안을 승인할 수 없습니다.");
    case "target_cannot_approve":
      return jsonError(400, "조치 대상 관리자는 이 제안을 승인할 수 없습니다.");
    case "already_approved":
      return jsonError(409, "이미 승인한 제안입니다.");
    case "reason_required":
      return jsonError(400, "정지 제안에는 사유 카테고리와 상세 사유가 모두 필요합니다.");
    case "last_admin":
      return jsonError(409, LAST_ADMIN_MESSAGE);
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
