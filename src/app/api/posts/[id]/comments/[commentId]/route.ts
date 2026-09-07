import { NextRequest } from "next/server";

import { jsonError, jsonOk, requireUserForApi, withErrorHandling } from "@/lib/posts/http";
import { updateCommentSchema } from "@/lib/comment/schema";
import { deleteComment, updateComment } from "@/lib/comment/service";

// [id] (the post id) is not actually needed by update/delete (a comment
// id alone is enough to find and authorize the row -- see
// comment/service.ts), but it stays part of the URL so this route nests
// under /api/posts/[id]/comments/* consistently with every other
// per-post sub-resource in this API (matches/candidates, image).
export const PATCH = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { commentId: commentIdParam } = await params;
    const commentId = Number(commentIdParam);
    if (!Number.isInteger(commentId)) return jsonError(400, "잘못된 댓글 id입니다.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "잘못된 요청 본문입니다.");
    }
    const parsed = updateCommentSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }

    const result = await updateComment(auth.user.id, commentId, parsed.data);
    switch (result.kind) {
      case "ok":
        return jsonOk(result.data);
      case "not_found":
      case "post_not_found":
      // updateComment never actually returns these two (they're only ever
      // produced by createComment) -- handled here purely so this switch
      // stays exhaustive over the shared CommentMutationResult<T> type.
      case "parent_not_found":
        return jsonError(404, "댓글을 찾을 수 없습니다.");
      case "forbidden":
        return jsonError(403, "본인 댓글만 수정할 수 있습니다.");
    }
  },
);

export const DELETE = withErrorHandling(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) => {
    const auth = await requireUserForApi();
    if ("response" in auth) return auth.response;

    const { commentId: commentIdParam } = await params;
    const commentId = Number(commentIdParam);
    if (!Number.isInteger(commentId)) return jsonError(400, "잘못된 댓글 id입니다.");

    const result = await deleteComment(auth.user, commentId);
    switch (result.kind) {
      case "ok":
        return jsonOk(result.data);
      case "not_found":
      case "post_not_found":
      // deleteComment never actually returns these two -- see the
      // matching comment in the PATCH handler above.
      case "parent_not_found":
        return jsonError(404, "댓글을 찾을 수 없습니다.");
      case "forbidden":
        return jsonError(403, "본인 댓글만 삭제할 수 있습니다.");
    }
  },
);
