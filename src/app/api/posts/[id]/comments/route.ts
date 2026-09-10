import { NextRequest } from "next/server";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { postTypeSchema } from "@/lib/posts/schema";
import { createCommentSchema } from "@/lib/comment/schema";
import { createComment, listCommentsForPost } from "@/lib/comment/service";

function parseParams(idParam: string, searchParams: URLSearchParams) {
  const id = Number(idParam);
  const typeResult = postTypeSchema.safeParse(searchParams.get("type"));
  if (!Number.isInteger(id) || !typeResult.success) return null;
  return { id, type: typeResult.data };
}

// GET is public -- comments are as public as the post itself (same
// "read paths never require auth" policy as posts/service.ts), no
// requireUserForApi() gate here.
export const GET = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: idParam } = await params;
    const parsed = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsed) return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");

    const data = await listCommentsForPost(parsed.type, parsed.id);
    return jsonOk(data);
  },
);

export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { id: idParam } = await params;
    const parsed = parseParams(idParam, request.nextUrl.searchParams);
    if (!parsed) return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "잘못된 요청 본문입니다.");
    }
    const result = createCommentSchema.safeParse(body);
    if (!result.success) {
      return jsonError(400, result.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const created = await createComment(auth.user, parsed.type, parsed.id, result.data);
    switch (created.kind) {
      case "ok":
        return jsonOk(created.data, { status: 201 });
      case "post_not_found":
        return jsonError(404, "게시물을 찾을 수 없습니다.");
      case "parent_not_found":
        return jsonError(404, "답글을 달 댓글을 찾을 수 없습니다.");
      case "forbidden":
        switch (created.reason) {
          case "organization_not_found":
            return jsonError(404, "단체를 찾을 수 없습니다.");
          case "organization_inactive":
            return jsonError(403, "비활성화된 단체 명의로는 댓글을 작성할 수 없습니다.");
          case "organization_not_member":
            return jsonError(403, "해당 단체의 구성원만 단체 명의로 댓글을 작성할 수 있습니다.");
          default:
            return jsonError(403, "정지된 계정은 댓글을 작성할 수 없습니다.");
        }
      case "not_found":
        return jsonError(404, "게시물을 찾을 수 없습니다.");
    }
  },
);
