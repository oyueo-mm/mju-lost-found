// Split from http.ts for the same reason as posts/response.ts and
// match/response.ts: no next-auth import chain, so tests can import this
// directly without pulling in next-auth (which doesn't resolve under
// Vitest's plain Node ESM outside of Next's own bundler).
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { ChatMutationResult } from "./service";

// Same message the legacy db._require_not_suspended() raises
// (SUSPENDED_ACCOUNT_MESSAGE) -- posts/response.ts keeps its own private
// copy of this exact string for the same reason, see that file's comment.
const SUSPENDED_ACCOUNT_MESSAGE = "정지된 계정은 이 기능을 사용할 수 없습니다.";

export function chatMutationResultToResponse<T>(
  result: ChatMutationResult<T>,
  successStatus = 200,
) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "not_found":
      // Doubles as "post not found" for getOrCreateDirectChatRoom() (Phase
      // 10) -- a deleted/nonexistent post and a deleted/nonexistent chat
      // room both surface the same way, which is fine: the caller only
      // ever passed one id, so there's no ambiguity about what wasn't found.
      return jsonError(404, "채팅방 또는 게시물을 찾을 수 없습니다.");
    case "match_not_found":
      return jsonError(404, "매칭을 찾을 수 없습니다.");
    case "forbidden":
      if (result.reason === "suspended") return jsonError(403, SUSPENDED_ACCOUNT_MESSAGE);
      if (result.reason === "self") return jsonError(403, "자기 자신의 게시물에는 채팅을 시작할 수 없습니다.");
      return jsonError(403, "이 채팅방에 접근할 권한이 없습니다.");
    case "invalid_content":
      return jsonError(400, "메시지를 입력해주세요.");
  }
}
