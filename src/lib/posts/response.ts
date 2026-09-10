import { NextResponse } from "next/server";

import type { PostMutationResult } from "./service";

// Consistent JSON envelope for every Route Handler in this project:
// `{ data }` (optionally with `pagination`) on success, `{ error }` on
// failure. Never forwards a caught exception's message/stack -- callers
// pass their own safe, user-facing string.
//
// Split out from http.ts on purpose: this file has no next-auth import
// chain, so tests can import it directly without pulling in next-auth
// (which doesn't resolve under Vitest's plain Node ESM outside of Next's
// own bundler).
export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export function jsonOk<T>(data: T, init?: { status?: number }) {
  return NextResponse.json({ data }, { status: init?.status ?? 200 });
}

// Wraps a Route Handler so an unexpected failure (most commonly: no live
// DB in this phase) never reaches the client as a bare 500 with an empty
// body or a leaked stack trace -- it's logged server-side and turned into
// the same `{ error }` envelope every other response in this API uses.
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("Unhandled error in API route:", error);
      return jsonError(500, "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  };
}

// Same message the legacy db._require_not_suspended() raises
// (SUSPENDED_ACCOUNT_MESSAGE), reused verbatim for parity.
const SUSPENDED_ACCOUNT_MESSAGE = "정지된 계정은 이 기능을 사용할 수 없습니다.";

export function postMutationResultToResponse<T>(
  result: PostMutationResult<T>,
  successStatus = 200,
): NextResponse {
  switch (result.kind) {
    case "ok":
      return jsonOk(result.data, { status: successStatus });
    case "not_found":
      return jsonError(404, "게시물을 찾을 수 없습니다.");
    case "forbidden":
      switch (result.reason) {
        case "suspended":
          return jsonError(403, SUSPENDED_ACCOUNT_MESSAGE);
        case "organization_not_found":
          return jsonError(404, "단체를 찾을 수 없습니다.");
        case "organization_inactive":
          return jsonError(403, "비활성화된 단체 명의로는 게시할 수 없습니다.");
        case "organization_not_member":
          return jsonError(403, "해당 단체의 구성원만 단체 명의로 게시할 수 있습니다.");
        default:
          return jsonError(403, "본인 게시물만 수정/삭제할 수 있습니다.");
      }
  }
}
