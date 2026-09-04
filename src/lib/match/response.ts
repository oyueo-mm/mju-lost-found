// Split from http.ts for the same reason as src/lib/posts/response.ts:
// this has no next-auth import chain, so tests can import it directly
// without pulling in next-auth (which doesn't resolve under Vitest's
// plain Node ESM outside of Next's own bundler).
import { jsonError, jsonOk } from "@/lib/posts/response";
import type { MatchMutationResult } from "./service";

export function matchMutationResultToResponse<T>(
  result: MatchMutationResult<T>,
  successStatus = 200,
) {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "not_found":
      return jsonError(404, "매칭을 찾을 수 없습니다.");
    case "lost_not_found":
      return jsonError(404, "분실물 게시물을 찾을 수 없습니다.");
    case "found_not_found":
      return jsonError(404, "습득물 게시물을 찾을 수 없습니다.");
    case "forbidden":
      return jsonError(
        403,
        result.reason === "suspended"
          ? "정지된 계정은 이 기능을 사용할 수 없습니다."
          : "본인 게시물에 대해서만 매칭을 확정하거나 취소할 수 있습니다.",
      );
  }
}
