// Split from http.ts for the same reason as posts/response.ts and
// match/response.ts: no next-auth import chain, so tests can import this
// directly without pulling in next-auth (which doesn't resolve under
// Vitest's plain Node ESM outside of Next's own bundler).
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { ChatMutationResult } from "./service";

export function chatMutationResultToResponse<T>(
  result: ChatMutationResult<T>,
  successStatus = 200,
) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "not_found":
      return jsonError(404, "채팅방을 찾을 수 없습니다.");
    case "match_not_found":
      return jsonError(404, "매칭을 찾을 수 없습니다.");
    case "forbidden":
      return jsonError(403, "이 채팅방에 접근할 권한이 없습니다.");
    case "invalid_content":
      return jsonError(400, "메시지를 입력해주세요.");
  }
}
